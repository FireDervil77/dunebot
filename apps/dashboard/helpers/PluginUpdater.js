const { ServiceManager } = require("dunebot-core");
const path = require("path");
const fs = require("fs");

/**
 * PluginUpdater – Automatisches Update-System für Plugin-Änderungen
 *
 * Pendant zum KernUpdater, aber für einzelne Plugins.
 * Führt JS/SQL-Dateien aus plugins/<name>/dashboard/updates/ aus.
 * Tracking via bestehende `plugin_migrations` Tabelle (migration_type = 'update').
 *
 * Update-Dateien werden alphabetisch sortiert ausgeführt (001_, 002_, ...).
 * Bereits ausgeführte Updates (success=TRUE) werden übersprungen.
 * Fehlgeschlagene Updates werden beim nächsten Start erneut versucht.
 *
 * JS-Format:
 *   module.exports = {
 *     version: "1.1.0",
 *     description: "Beschreibung",
 *     run: async (dbService, { Logger, ServiceManager }) => { ... }
 *   };
 *
 * SQL-Format:
 *   Beliebige SQL-Statements, getrennt durch Semikolon.
 *   Kommentare mit -- @version und -- @description möglich.
 *
 * @author FireDervil
 */

// Sentinel-Wert statt NULL für guild_id bei globalen Updates.
// NULL in MySQL UNIQUE KEY erlaubt Duplikate (NULL != NULL).
const GLOBAL_GUILD_ID = '__global__';
class PluginUpdater {
    /**
     * Führt alle ausstehenden Updates für ein Plugin aus.
     * @param {string} pluginName - Name des Plugins
     * @param {string} pluginsDir - Basis-Pfad zu plugins/
     * @returns {Promise<{executed: number, skipped: number, failed: number}>}
     */
    static async runForPlugin(pluginName, pluginsDir) {
        const Logger = ServiceManager.get("Logger");
        const dbService = ServiceManager.get("dbService");

        const updatesDir = path.join(pluginsDir, pluginName, "dashboard", "updates");

        if (!fs.existsSync(updatesDir)) {
            return { executed: 0, skipped: 0, failed: 0 };
        }

        const updates = this._loadUpdates(updatesDir, Logger);
        if (updates.length === 0) {
            return { executed: 0, skipped: 0, failed: 0 };
        }

        const stats = { executed: 0, skipped: 0, failed: 0 };

        for (const update of updates) {
            const alreadyDone = await this._isAlreadyExecuted(dbService, pluginName, update.filename);
            if (alreadyDone) {
                stats.skipped++;
                continue;
            }

            Logger.info(`[PluginUpdater] ${pluginName}: Führe ${update.filename} aus...`);

            try {
                const startTime = Date.now();

                if (update.type === "js") {
                    await update.run(dbService, { Logger, ServiceManager });
                } else {
                    await this._executeSQLUpdate(dbService, update.filePath, Logger);
                }

                const executionTime = Date.now() - startTime;
                await this._recordSuccess(dbService, pluginName, update.filename, update.version, executionTime);

                Logger.success(`[PluginUpdater] ${pluginName}: ✓ ${update.filename} (${executionTime}ms)`);
                stats.executed++;
            } catch (err) {
                Logger.error(`[PluginUpdater] ${pluginName}: ✗ ${update.filename}:`, err.message);
                await this._recordFailure(dbService, pluginName, update.filename, update.version, err.message);
                Logger.warn(`[PluginUpdater] ${pluginName}: Update ${update.filename} übersprungen — Plugin läuft trotzdem weiter.`);
                stats.failed++;
            }
        }

        if (stats.executed > 0) {
            Logger.success(`[PluginUpdater] ${pluginName}: ${stats.executed} Updates ausgeführt, ${stats.skipped} übersprungen, ${stats.failed} fehlgeschlagen`);
        }

        return stats;
    }

    // ─── Private ──────────────────────────────────────────────

    /**
     * Lädt alle Update-Dateien (JS + SQL) aus dem Verzeichnis.
     */
    static _loadUpdates(updatesDir, Logger) {
        return fs
            .readdirSync(updatesDir)
            .filter((f) => f.endsWith(".js") || f.endsWith(".sql"))
            .sort()
            .map((filename) => {
                const filePath = path.join(updatesDir, filename);
                try {
                    if (filename.endsWith(".js")) {
                        delete require.cache[require.resolve(filePath)];
                        const mod = require(filePath);
                        return {
                            filename,
                            filePath,
                            type: "js",
                            version: mod.version || "0.0.0",
                            description: mod.description || "",
                            run: mod.run,
                        };
                    } else {
                        // SQL-Datei: Version/Description aus Kommentaren parsen
                        const content = fs.readFileSync(filePath, "utf8");
                        const versionMatch = content.match(/--\s*@version\s+(.+)/i);
                        const descMatch = content.match(/--\s*@description\s+(.+)/i);
                        return {
                            filename,
                            filePath,
                            type: "sql",
                            version: versionMatch ? versionMatch[1].trim() : "0.0.0",
                            description: descMatch ? descMatch[1].trim() : "",
                        };
                    }
                } catch (err) {
                    Logger.error(`[PluginUpdater] Fehler beim Laden von ${filename}:`, err.message);
                    return null;
                }
            })
            .filter(Boolean);
    }

    /**
     * Prüft ob ein Update bereits erfolgreich ausgeführt wurde.
     * Nutzt plugin_migrations mit guild_id = '__global__' (Sentinel für globale Updates).
     */
    static async _isAlreadyExecuted(dbService, pluginName, filename) {
        const [rows] = await dbService.pool.execute(
            `SELECT id FROM plugin_migrations 
             WHERE plugin_name = ? AND migration_file = ? AND guild_id = ? AND success = TRUE`,
            [pluginName, filename, GLOBAL_GUILD_ID]
        );
        return rows.length > 0;
    }

    /**
     * Führt eine SQL-Datei Statement für Statement aus.
     */
    static async _executeSQLUpdate(dbService, sqlFilePath, Logger) {
        let sql = fs.readFileSync(sqlFilePath, "utf8");

        // DELIMITER-Statements entfernen (nur für CLI, nicht für mysql2)
        sql = sql.replace(/DELIMITER\s+\$\$/gi, "");
        sql = sql.replace(/DELIMITER\s+;/gi, "");

        // Split: zuerst nach $$ (für TRIGGER/PROCEDURE), dann nach ;
        let statements;
        if (sql.includes("$$")) {
            statements = sql.split("$$");
        } else {
            statements = sql.split(";");
        }

        statements = statements
            .map((s) => s.trim())
            .filter((s) => s.length > 0 && !s.match(/^(--|\/\*)/));

        for (const statement of statements) {
            if (statement.trim().length === 0) continue;
            try {
                await dbService.query(statement);
            } catch (stmtError) {
                // "Already exists"-Fehler ignorieren (idempotent)
                if (
                    stmtError.code === "ER_TABLE_EXISTS_ERROR" ||
                    stmtError.code === "ER_DUP_KEYNAME" ||
                    stmtError.code === "ER_DUP_FIELDNAME" ||
                    stmtError.message.includes("already exists") ||
                    stmtError.message.includes("Duplicate column")
                ) {
                    Logger.debug(`[PluginUpdater] Statement übersprungen (existiert bereits): ${statement.substring(0, 60)}...`);
                    continue;
                }
                throw stmtError;
            }
        }
    }

    /**
     * Markiert ein Update als erfolgreich in plugin_migrations.
     */
    static async _recordSuccess(dbService, pluginName, filename, version, executionTimeMs) {
        await dbService.pool.execute(
            `INSERT INTO plugin_migrations 
                (plugin_name, guild_id, migration_file, migration_version, migration_type, execution_time_ms, success)
             VALUES (?, ?, ?, ?, 'update', ?, TRUE)
             ON DUPLICATE KEY UPDATE
                migration_version = VALUES(migration_version),
                executed_at = CURRENT_TIMESTAMP,
                execution_time_ms = VALUES(execution_time_ms),
                success = TRUE,
                error_log = NULL`,
            [pluginName, GLOBAL_GUILD_ID, filename, version, executionTimeMs]
        );
    }

    /**
     * Markiert ein Update als fehlgeschlagen in plugin_migrations.
     */
    static async _recordFailure(dbService, pluginName, filename, version, errorMessage) {
        await dbService.pool.execute(
            `INSERT INTO plugin_migrations 
                (plugin_name, guild_id, migration_file, migration_version, migration_type, success, error_log)
             VALUES (?, ?, ?, ?, 'update', FALSE, ?)
             ON DUPLICATE KEY UPDATE
                success = FALSE,
                error_log = VALUES(error_log),
                executed_at = CURRENT_TIMESTAMP`,
            [pluginName, GLOBAL_GUILD_ID, filename, version, errorMessage]
        );
    }
}

module.exports = PluginUpdater;
