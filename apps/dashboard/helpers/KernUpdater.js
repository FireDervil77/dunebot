const { ServiceManager } = require("dunebot-core");
const path = require("path");
const fs = require("fs");

/**
 * KernUpdater – Automatisches Update-System für Kern-Änderungen
 *
 * Führt beim Dashboard-Start registrierte Updates sequenziell aus.
 * Jedes Update hat eine Version und wird nur einmal ausgeführt.
 * Der Fortschritt wird in der DB-Tabelle `kern_updates` gespeichert.
 *
 * Updates liegen als JS-Dateien in updates/ und werden nach Dateiname
 * sortiert ausgeführt (z.B. 001_rename_nav_items.js, 002_theme_nav.js).
 *
 * Jede Update-Datei exportiert:
 *   module.exports = {
 *     version: "1.0.1",
 *     description: "Beschreibung des Updates",
 *     run: async (dbService, services) => { ... }
 *   };
 *
 * @author FireDervil
 */
class KernUpdater {
    constructor() {
        this.updatesDir = path.join(__dirname, "..", "updates");
    }

    /**
     * Erstellt die kern_updates-Tabelle falls nicht vorhanden und
     * führt alle noch nicht ausgeführten Updates aus.
     */
    async run() {
        const Logger = ServiceManager.get("Logger");
        const dbService = ServiceManager.get("dbService");

        // 1. Tracking-Tabelle sicherstellen
        await this._ensureTable(dbService);

        // 2. Update-Dateien laden
        const updates = this._loadUpdates(Logger);
        if (updates.length === 0) {
            Logger.debug("[KernUpdater] Keine Updates gefunden.");
            return;
        }

        // 3. Bereits ausgeführte Updates laden
        const [executed] = await dbService.pool.execute(
            "SELECT filename FROM kern_updates WHERE status = 'done'"
        );
        const executedSet = new Set(executed.map((r) => r.filename));

        // 4. Ausstehende Updates filtern und ausführen
        const pending = updates.filter((u) => !executedSet.has(u.filename));
        if (pending.length === 0) {
            Logger.debug("[KernUpdater] Alle Updates bereits ausgeführt.");
            return;
        }

        Logger.info(
            `[KernUpdater] ${pending.length} ausstehende Updates gefunden.`
        );

        for (const update of pending) {
            await this._executeUpdate(update, dbService, Logger);
        }

        Logger.success(
            `[KernUpdater] Alle ${pending.length} Updates abgeschlossen.`
        );
    }

    // ─── Private ──────────────────────────────────────────────

    async _ensureTable(dbService) {
        await dbService.pool.execute(`
            CREATE TABLE IF NOT EXISTS kern_updates (
                id INT AUTO_INCREMENT PRIMARY KEY,
                filename VARCHAR(255) NOT NULL UNIQUE,
                version VARCHAR(50) DEFAULT NULL,
                description TEXT DEFAULT NULL,
                status ENUM('done', 'failed') NOT NULL DEFAULT 'done',
                error_message TEXT DEFAULT NULL,
                executed_at DATETIME DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
    }

    _loadUpdates(Logger) {
        if (!fs.existsSync(this.updatesDir)) {
            Logger.debug(
                `[KernUpdater] Updates-Verzeichnis nicht vorhanden: ${this.updatesDir}`
            );
            return [];
        }

        return fs
            .readdirSync(this.updatesDir)
            .filter((f) => f.endsWith(".js"))
            .sort() // Alphabetische/numerische Sortierung
            .map((filename) => {
                const filePath = path.join(this.updatesDir, filename);
                try {
                    delete require.cache[require.resolve(filePath)];
                    const mod = require(filePath);
                    return {
                        filename,
                        version: mod.version || "0.0.0",
                        description: mod.description || "",
                        run: mod.run,
                    };
                } catch (err) {
                    Logger.error(
                        `[KernUpdater] Fehler beim Laden von ${filename}:`,
                        err.message
                    );
                    return null;
                }
            })
            .filter(Boolean);
    }

    async _executeUpdate(update, dbService, Logger) {
        Logger.info(
            `[KernUpdater] Führe aus: ${update.filename} (v${update.version}) — ${update.description}`
        );

        try {
            await update.run(dbService, {
                ServiceManager,
                Logger,
            });

            await dbService.pool.execute(
                `INSERT INTO kern_updates (filename, version, description, status)
                 VALUES (?, ?, ?, 'done')
                 ON DUPLICATE KEY UPDATE status = 'done', executed_at = NOW()`,
                [update.filename, update.version, update.description]
            );

            Logger.success(`[KernUpdater] ✓ ${update.filename}`);
        } catch (err) {
            Logger.error(
                `[KernUpdater] ✗ ${update.filename} fehlgeschlagen:`,
                err.message
            );

            // Fehler speichern, aber nicht abbrechen
            await dbService.pool
                .execute(
                    `INSERT INTO kern_updates (filename, version, description, status, error_message)
                 VALUES (?, ?, ?, 'failed', ?)
                 ON DUPLICATE KEY UPDATE status = 'failed', error_message = ?, executed_at = NOW()`,
                    [
                        update.filename,
                        update.version,
                        update.description,
                        err.message,
                        err.message,
                    ]
                )
                .catch(() => {}); // DB-Logging best-effort

            // Weiterhin werfen damit der Startup-Log es sieht
            Logger.warn(
                `[KernUpdater] Update ${update.filename} übersprungen — Dashboard läuft trotzdem weiter.`
            );
        }
    }
}

module.exports = KernUpdater;
