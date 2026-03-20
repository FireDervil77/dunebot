'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Einheitlicher Migration Runner für Kern- und Plugin-Migrationen.
 * Wird von Dashboard UND Bot beim Startup genutzt.
 * 
 * Migrationen sind JS-Dateien mit up(db) und optionalem down(db).
 * Dateiname-Format: YYYYMMDD_HHMMSS_beschreibung.js
 * 
 * Tracking via `migrations`-Tabelle mit Batch-Nummern und Checksums.
 */
class MigrationRunner {

    /**
     * @param {Object} dbService  - DBService-Instanz (query, rawQuery, transaction)
     * @param {Object} [options]
     * @param {string} options.scope  - 'kern' oder 'plugin'
     * @param {string} options.source - 'kern' oder Plugin-Name
     * @param {string} options.migrationsDir - Absoluter Pfad zum Migrations-Ordner
     * @param {Object} [options.logger] - Logger-Instanz (muss info/warn/error/success/debug haben)
     */
    constructor(dbService, options = {}) {
        this.db = dbService;
        this.scope = options.scope || 'kern';
        this.source = options.source || 'kern';
        this.migrationsDir = options.migrationsDir;
        this.logger = options.logger || console;
    }

    // ─── Public API ───────────────────────────────────────────

    /**
     * Hauptmethode: Führt alle ausstehenden Migrationen aus.
     * Idempotent — kann beliebig oft aufgerufen werden.
     * @returns {Promise<{executed: number, skipped: number, failed: number, errors: Array}>}
     */
    async run() {
        await this._ensureTable();

        const pending = await this._getPendingMigrations();
        if (pending.length === 0) {
            return { executed: 0, skipped: 0, failed: 0, errors: [] };
        }

        const batch = await this._getNextBatch();
        const tag = `[Migration][${this.scope}:${this.source}]`;
        this.logger.info(`${tag} ${pending.length} ausstehende Migration(en) gefunden (Batch ${batch})`);

        let executed = 0;
        let failed = 0;
        const errors = [];

        for (const migration of pending) {
            const startTime = Date.now();
            try {
                // Baselines nutzen CREATE TABLE IF NOT EXISTS → immer sicher ausführbar
                await migration.up(this.db);
                if (migration.baseline) {
                    this.logger.info(`${tag} ✓ Baseline: ${migration.filename}`);
                } else {
                    this.logger.info(`${tag} ✓ ${migration.filename}`);
                }

                await this._recordMigration(migration, batch, Date.now() - startTime);
                executed++;
            } catch (error) {
                failed++;
                errors.push({ filename: migration.filename, error: error.message });
                this.logger.error(`${tag} ✗ ${migration.filename}: ${error.message}`);

                await this._recordFailedMigration(migration, batch, Date.now() - startTime, error.message);
                // Weiter mit nächster Migration — nicht abbrechen
            }
        }

        if (executed > 0) {
            this.logger.success(`${tag} ${executed} Migration(en) ausgeführt` + (failed > 0 ? `, ${failed} fehlgeschlagen` : ''));
        }

        return { executed, skipped: 0, failed, errors };
    }

    /**
     * Gibt Status aller Migrationen zurück (für CLI).
     * @returns {Promise<Array<{filename: string, status: string, executed_at: Date|null, checksum_match: boolean}>>}
     */
    async status() {
        await this._ensureTable();

        const files = this._loadMigrationFiles();
        const executed = await this._getExecutedMigrations();
        const executedMap = new Map(executed.map(e => [e.filename, e]));

        return files.map(file => {
            const record = executedMap.get(file.filename);
            if (!record) {
                return { filename: file.filename, status: 'pending', executed_at: null, checksum_match: true };
            }

            const checksumMatch = !record.checksum || record.checksum === file.checksum;
            return {
                filename: file.filename,
                status: record.success === 0 ? 'failed' : 'done',
                executed_at: record.executed_at,
                checksum_match: checksumMatch
            };
        });
    }

    /**
     * Rollback der letzten Batch (nur Migrationen mit down()).
     * @returns {Promise<{rolledBack: number, skipped: number, errors: Array}>}
     */
    async rollback() {
        await this._ensureTable();

        const lastBatch = await this._getLastBatch();
        if (!lastBatch) {
            this.logger.info(`[Migration][${this.scope}:${this.source}] Nichts zum Zurückrollen.`);
            return { rolledBack: 0, skipped: 0, errors: [] };
        }

        const rows = await this.db.query(
            `SELECT filename FROM migrations 
             WHERE scope = ? AND source = ? AND batch = ? AND success = 1
             ORDER BY filename DESC`,
            [this.scope, this.source, lastBatch]
        );

        const tag = `[Migration][${this.scope}:${this.source}]`;
        let rolledBack = 0;
        let skipped = 0;
        const errors = [];

        for (const row of rows) {
            const filePath = path.join(this.migrationsDir, row.filename);
            if (!fs.existsSync(filePath)) {
                this.logger.warn(`${tag} Datei nicht gefunden für Rollback: ${row.filename}`);
                skipped++;
                continue;
            }

            delete require.cache[require.resolve(filePath)];
            const migration = require(filePath);

            if (typeof migration.down !== 'function') {
                this.logger.warn(`${tag} Kein down() in ${row.filename} — übersprungen`);
                skipped++;
                continue;
            }

            try {
                await migration.down(this.db);
                await this.db.query(
                    `DELETE FROM migrations WHERE scope = ? AND source = ? AND filename = ?`,
                    [this.scope, this.source, row.filename]
                );
                this.logger.info(`${tag} ↩ ${row.filename}`);
                rolledBack++;
            } catch (error) {
                errors.push({ filename: row.filename, error: error.message });
                this.logger.error(`${tag} Rollback fehlgeschlagen: ${row.filename}: ${error.message}`);
            }
        }

        return { rolledBack, skipped, errors };
    }

    // ─── Statische Helfer ─────────────────────────────────────

    /**
     * Erstellt die migrations-Tabelle falls nötig.
     * Wird einmal pro App-Start aufgerufen.
     */
    static async ensureTable(dbService) {
        await dbService.query(`
            CREATE TABLE IF NOT EXISTS migrations (
                id INT AUTO_INCREMENT PRIMARY KEY,
                scope ENUM('kern', 'plugin') NOT NULL,
                source VARCHAR(100) NOT NULL,
                filename VARCHAR(255) NOT NULL,
                batch INT NOT NULL,
                success TINYINT(1) NOT NULL DEFAULT 1,
                error_message TEXT DEFAULT NULL,
                executed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                execution_time_ms INT DEFAULT 0,
                checksum VARCHAR(64) DEFAULT NULL,
                UNIQUE KEY unique_migration (scope, source, filename)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
    }

    /**
     * Führt Kern-Migrationen aus.
     * @param {Object} dbService
     * @param {Object} logger
     * @param {string} [projectRoot] - Projekt-Root (default: 6 Ebenen hoch von diesem File)
     * @returns {Promise<Object>}
     */
    static async runKern(dbService, logger, projectRoot) {
        const root = projectRoot || path.resolve(__dirname, '..', '..', '..');
        const migrationsDir = path.join(root, 'migrations', 'kern');

        if (!fs.existsSync(migrationsDir)) {
            logger.debug('[Migration] Kein Kern-Migrations-Ordner gefunden — übersprungen');
            return { executed: 0, skipped: 0, failed: 0, errors: [] };
        }

        const runner = new MigrationRunner(dbService, {
            scope: 'kern',
            source: 'kern',
            migrationsDir,
            logger
        });

        return runner.run();
    }

    /**
     * Führt Plugin-Migrationen für ein einzelnes Plugin aus.
     * @param {Object} dbService
     * @param {string} pluginName
     * @param {string} pluginsDir - Absoluter Pfad zum plugins/-Verzeichnis
     * @param {Object} logger
     * @returns {Promise<Object>}
     */
    static async runPlugin(dbService, pluginName, pluginsDir, logger) {
        const migrationsDir = path.join(pluginsDir, pluginName, 'migrations');

        if (!fs.existsSync(migrationsDir)) {
            return { executed: 0, skipped: 0, failed: 0, errors: [] };
        }

        const runner = new MigrationRunner(dbService, {
            scope: 'plugin',
            source: pluginName,
            migrationsDir,
            logger
        });

        return runner.run();
    }

    /**
     * Führt Migrationen für ALLE Plugins aus.
     * @param {Object} dbService
     * @param {string} pluginsDir - Absoluter Pfad zum plugins/-Verzeichnis
     * @param {Object} logger
     * @returns {Promise<Object>}
     */
    static async runAllPlugins(dbService, pluginsDir, logger) {
        if (!fs.existsSync(pluginsDir)) return { total: 0, results: {} };

        const dirs = fs.readdirSync(pluginsDir, { withFileTypes: true })
            .filter(d => d.isDirectory())
            .map(d => d.name)
            .sort();

        const results = {};
        let total = 0;

        for (const pluginName of dirs) {
            const result = await MigrationRunner.runPlugin(dbService, pluginName, pluginsDir, logger);
            if (result.executed > 0 || result.failed > 0) {
                results[pluginName] = result;
                total += result.executed;
            }
        }

        return { total, results };
    }

    /**
     * Erzeugt eine neue leere Migration-Datei.
     * @param {string} scope - 'kern' oder 'plugin'
     * @param {string} source - 'kern' oder Plugin-Name
     * @param {string} description - Kurzbeschreibung (wird zu Dateiname)
     * @param {string} baseDir - Basis-Verzeichnis (Projekt-Root oder plugins/)
     * @returns {string} Pfad zur erstellten Datei
     */
    static createMigrationFile(scope, source, description, baseDir) {
        const now = new Date();
        const timestamp = [
            now.getFullYear(),
            String(now.getMonth() + 1).padStart(2, '0'),
            String(now.getDate()).padStart(2, '0'),
            '_',
            String(now.getHours()).padStart(2, '0'),
            String(now.getMinutes()).padStart(2, '0'),
            String(now.getSeconds()).padStart(2, '0')
        ].join('');

        const safeName = description
            .toLowerCase()
            .replace(/[^a-z0-9_]+/g, '_')
            .replace(/^_|_$/g, '');

        const filename = `${timestamp}_${safeName}.js`;

        let dir;
        if (scope === 'kern') {
            dir = path.join(baseDir, 'migrations', 'kern');
        } else {
            dir = path.join(baseDir, source, 'migrations');
        }

        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        const filePath = path.join(dir, filename);
        const template = `'use strict';

module.exports = {
    description: '${description.replace(/'/g, "\\'")}',

    async up(db) {
        // Migration hier implementieren
        // Beispiel:
        // await db.query(\`
        //     ALTER TABLE my_table
        //     ADD COLUMN IF NOT EXISTS new_col VARCHAR(255) DEFAULT NULL
        // \`);
    },

    // Optional: Rollback
    // async down(db) {
    //     await db.query(\`ALTER TABLE my_table DROP COLUMN IF EXISTS new_col\`);
    // }
};
`;

        fs.writeFileSync(filePath, template, 'utf8');
        return filePath;
    }

    // ─── Private Methoden ─────────────────────────────────────

    async _ensureTable() {
        await MigrationRunner.ensureTable(this.db);
    }

    /**
     * Lädt alle .js Migrations-Dateien aus dem Verzeichnis.
     * @returns {Array<{filename, filePath, checksum, baseline, up, down}>}
     */
    _loadMigrationFiles() {
        if (!this.migrationsDir || !fs.existsSync(this.migrationsDir)) {
            return [];
        }

        return fs.readdirSync(this.migrationsDir)
            .filter(f => f.endsWith('.js'))
            .sort()
            .map(filename => {
                const filePath = path.join(this.migrationsDir, filename);
                const content = fs.readFileSync(filePath, 'utf8');
                const checksum = crypto.createHash('sha256').update(content).digest('hex');

                // Cache löschen für Hot-Reload
                delete require.cache[require.resolve(filePath)];
                const migration = require(filePath);

                return {
                    filename,
                    filePath,
                    checksum,
                    baseline: migration.baseline === true,
                    up: migration.up,
                    down: migration.down,
                    description: migration.description || ''
                };
            });
    }

    /**
     * Gibt bereits ausgeführte Migrationen aus der DB zurück.
     */
    async _getExecutedMigrations() {
        return this.db.query(
            `SELECT filename, checksum, success, executed_at FROM migrations WHERE scope = ? AND source = ?`,
            [this.scope, this.source]
        );
    }

    /**
     * Ermittelt ausstehende Migrationen (nicht in DB oder fehlgeschlagen).
     */
    async _getPendingMigrations() {
        const files = this._loadMigrationFiles();
        const executed = await this._getExecutedMigrations();
        const executedMap = new Map(executed.map(e => [e.filename, e]));

        const pending = [];
        const tag = `[Migration][${this.scope}:${this.source}]`;

        for (const file of files) {
            const record = executedMap.get(file.filename);

            if (!record) {
                // Neue Migration
                pending.push(file);
            } else if (record.success === 0) {
                // Fehlgeschlagene Migration → erneut versuchen
                this.logger.info(`${tag} Wiederhole fehlgeschlagene Migration: ${file.filename}`);
                // Alten Eintrag entfernen damit neuer geschrieben werden kann
                await this.db.query(
                    `DELETE FROM migrations WHERE scope = ? AND source = ? AND filename = ?`,
                    [this.scope, this.source, file.filename]
                );
                pending.push(file);
            } else if (record.checksum && record.checksum !== file.checksum) {
                // Checksum geändert — nur warnen, nicht erneut ausführen
                this.logger.warn(`${tag} ⚠ Checksum geändert: ${file.filename} — bereits ausgeführte Migration wurde nachträglich verändert!`);
            }
        }

        return pending;
    }

    async _getNextBatch() {
        const rows = await this.db.query(
            `SELECT COALESCE(MAX(batch), 0) + 1 AS next_batch FROM migrations`
        );
        return rows[0]?.next_batch || 1;
    }

    async _getLastBatch() {
        const rows = await this.db.query(
            `SELECT MAX(batch) AS last_batch FROM migrations WHERE scope = ? AND source = ? AND success = 1`,
            [this.scope, this.source]
        );
        return rows[0]?.last_batch || null;
    }

    async _recordMigration(migration, batch, executionTimeMs) {
        await this.db.query(
            `INSERT INTO migrations (scope, source, filename, batch, success, executed_at, execution_time_ms, checksum)
             VALUES (?, ?, ?, ?, 1, NOW(), ?, ?)
             ON DUPLICATE KEY UPDATE success = 1, error_message = NULL, executed_at = NOW(), execution_time_ms = VALUES(execution_time_ms), checksum = VALUES(checksum)`,
            [this.scope, this.source, migration.filename, batch, executionTimeMs, migration.checksum]
        );
    }

    async _recordFailedMigration(migration, batch, executionTimeMs, errorMessage) {
        await this.db.query(
            `INSERT INTO migrations (scope, source, filename, batch, success, error_message, executed_at, execution_time_ms, checksum)
             VALUES (?, ?, ?, ?, 0, ?, NOW(), ?, ?)
             ON DUPLICATE KEY UPDATE success = 0, error_message = VALUES(error_message), executed_at = NOW()`,
            [this.scope, this.source, migration.filename, batch, errorMessage, executionTimeMs, migration.checksum]
        );
    }
}

module.exports = MigrationRunner;
