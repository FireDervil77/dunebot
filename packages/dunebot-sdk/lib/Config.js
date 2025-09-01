const fs = require("fs");
const path = require("path");
const { ServiceManager } = require("dunebot-core");

/**
 * Konfigurationsverwaltung für Plugins
 * Bietet ein WordPress-ähnliches System zur Verwaltung von Plugin-Einstellungen
 * 
 * @author firedervil
 * @class Config
 */
class Config {
    /**
     * @param {string} pluginName - Name des Plugins
     * @param {string} baseDir - Basis-Verzeichnis des Plugins
     * @throws {Error} Wenn kein Plugin-Name angegeben wurde
     */
    constructor(pluginName, baseDir) {
        const Logger = ServiceManager.get('Logger');
        if (!pluginName) throw new Error("Plugin-Name ist erforderlich");
        this.pluginName = pluginName;
        this.baseDir = baseDir;
        
        // Mögliche Konfigurationspfade
        this.configPaths = [
            path.join(baseDir, "config.json"),                    // Im Plugin-Verzeichnis
            path.join(baseDir, "..", "config.json"),             // Eine Ebene höher
            path.join(baseDir, "..", "..", "config.json"),       // Zwei Ebenen höher
            path.join(process.cwd(), "plugins", pluginName, "config.json") // Absoluter Pfad
        ];
        
        // Den ersten existierenden Pfad finden
        this.configPath = this.configPaths.find(p => fs.existsSync(p));
        
        if (!this.configPath) {
            Logger.warn(`Keine config.json für Plugin ${pluginName} gefunden. Geprüfte Pfade:`, this.configPaths);
        } else {
            Logger.debug(`Config-Datei gefunden: ${this.configPath}`);
        }

        this.dbService = null;
        this.cache = {}; // Cache für Konfigurationswerte
        this.defaultContext = 'shared'; // Standardkontext für Konfigurationen
    }

    /**
     * Initialisiert die Konfiguration
     * @param {Object} dbService - Datenbank-Service
     * @param {string} [context='shared'] - Kontext der Konfiguration
     * @returns {Promise<Object>} Die geladene Konfiguration
     */
    async init(dbService, context = 'shared') {
        const Logger = ServiceManager.get('Logger');

        this.defaultContext = context;
        this.dbService = dbService; // dbService speichern

        // Lokale Konfiguration laden
        const localConfig = await this.#loadLocalConfig();
        
        if (!this.dbService) {
            Logger.debug(`Verwende lokale Konfiguration für ${this.pluginName}`);
            return localConfig;
        }

        try {
            // Prüfen, ob Konfigurationen für dieses Plugin existieren
            const [existingConfig] = await this.dbService.query(
                "SELECT * FROM configs WHERE plugin_name = ? AND context = ? LIMIT 1",
                [this.pluginName, context]
            );

            // Wenn keine Konfigurationen existieren, erstellen
            if (!existingConfig) {
                await this.#migrateLocalConfigToDB(localConfig, context);
                return localConfig;
            }

            // Konfigurationen aus der Datenbank laden
            Logger.debug(`Konfigurationseinträge für ${this.pluginName} existieren, lade aus DB`);
            return await this.get(context);
        } catch (error) {
            Logger.error(`Konfigurationsinitialisierung für ${this.pluginName} fehlgeschlagen:`, error);
            return localConfig;
        }
    }

    /**
     * Prüft und aktualisiert das Models
     * @private
     */
    async #checkAndUpdateModel() {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');

        try {
            // Prüfe Model-Version
            const [versionEntry] = await dbService.query(
                "SELECT * FROM configs WHERE plugin_name = ? AND config_key = '_model_version' AND context = 'internal' LIMIT 1",
                [this.pluginName]
            );
            const currentVersion = versionEntry ? parseFloat(versionEntry.config_value) : 0;
            
            // Model-Updates aus dem Verzeichnis laden
            const updatesDir = path.join(this.baseDir, 'models', 'updates');
            if (fs.existsSync(updatesDir)) {
                const updateFiles = fs.readdirSync(updatesDir)
                    .filter(file => file.endsWith('.js'))
                    .sort(); // Nach Dateiname sortieren
                
                // Updates ausführen
                for (const updateFile of updateFiles) {
                    try {
                        const update = require(path.join(updatesDir, updateFile));
                        if (update.version > currentVersion) {
                            Logger.info(`Führe Model-Update ${update.version} für Plugin ${this.pluginName} aus`);
                            // Hier sollte update.execute(dbService) ein natives SQL-Schema ausführen
                            await update.execute(dbService);
                            
                            // Version aktualisieren
                            await dbService.query(`
                                INSERT INTO configs (plugin_name, config_key, config_value, context)
                                VALUES (?, '_model_version', ?, 'internal')
                                ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)
                            `, [
                                this.pluginName,
                                update.version.toString()
                            ]);
                        }
                    } catch (updateError) {
                        Logger.error(`Fehler beim Ausführen des Model-Updates ${updateFile}:`, updateError);
                    }
                }
            }
        } catch (error) {
            Logger.error(`Fehler beim Überprüfen/Aktualisieren des Models für ${this.pluginName}:`, error);
        }
    }

    /**
     * Migriert eine lokale Konfiguration in die Datenbank
     * @param {Object} config - Die zu migrierende Konfiguration
     * @param {string} context - Der Kontext der Konfiguration
     * @private
     */
    async #migrateLocalConfigToDB(config, context) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');
        try {
            if (!config || Object.keys(config).length === 0) {
                Logger.warn(`Leere Konfiguration für Plugin ${this.pluginName}, keine Migration durchgeführt`);
                return;
            }
            
            Logger.debug(`Starte Migration der lokalen Konfiguration für ${this.pluginName}. Konfiguration:`, config);
            
            const flattened = this.#flattenConfig(config);
            Logger.debug(`Abgeflachte Konfiguration:`, flattened);
            
            // Zuerst prüfen, ob Einträge bereits existieren
            const existing = await dbService.query(
                "SELECT * FROM configs WHERE plugin_name = ? AND context = ?",
                [this.pluginName, context]
            );
            
            if (existing && existing.length > 0) {
                Logger.warn(`Es existieren bereits ${existing.length} Konfigurationseinträge für ${this.pluginName} (${context}). Überspringe Migration.`);
                return;
            }
            
            // Einträge in einer Transaktion erstellen
            const connection = await dbService.getConnection();
            try {
                await connection.beginTransaction();
                for (const [key, value] of Object.entries(flattened)) {
                    let stringValue;
                    if (value === null || value === undefined) {
                        stringValue = '';
                    } else if (typeof value === 'object') {
                        stringValue = JSON.stringify(value);
                    } else {
                        stringValue = String(value);
                    }
                    await connection.query(
                        "INSERT INTO configs (plugin_name, config_key, config_value, context) VALUES (?, ?, ?, ?)",
                        [this.pluginName, key, stringValue, context]
                    );
                }
                await connection.commit();
                Logger.info(`Initiale Konfigurationseinträge für ${this.pluginName} (${context}) erstellt: ${Object.keys(flattened).length} Einträge`);
            } catch (txError) {
                await connection.rollback();
                throw txError;
            } finally {
                connection.release();
            }
        } catch (error) {
            Logger.error(`Fehler bei der Migration der lokalen Konfiguration für ${this.pluginName}:`, error);
            // Vollständigen Stack-Trace ausgeben
            console.error(error);
        }
    }

    /**
     * Lädt die Konfiguration aus der Datenbank
     * @param {string} [context=this.defaultContext] - Der Kontext der Konfiguration
     * @returns {Promise<Object>} Das Konfigurationsobjekt
     */
    async get(context = this.defaultContext) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');

        // Wenn kein DB-Service verfügbar ist, lokale Konfiguration verwenden
        if (!dbService) {
            return this.#loadLocalConfig();
        }

        // Cache-Schlüssel erstellen
        const cacheKey = `${this.pluginName}_${context}`;
        
        // Wenn im Cache vorhanden und nicht älter als 60 Sekunden, aus Cache zurückgeben
        if (this.cache[cacheKey] && (Date.now() - this.cache[cacheKey].timestamp < 60000)) {
            return this.cache[cacheKey].data;
        }

        try {
            const dbConfigs = await dbService.query(
                "SELECT * FROM configs WHERE plugin_name = ? AND context = ? ORDER BY id ASC",
                [this.pluginName, context]
            );

            if (!dbConfigs.length) {
                Logger.warn(`Keine Konfiguration für ${this.pluginName} (${context}) gefunden`);
                return this.#loadLocalConfig();
            }

            const result = this.#unflattenConfig(dbConfigs);
            
            // Im Cache speichern
            this.cache[cacheKey] = {
                data: result,
                timestamp: Date.now()
            };
            
            return result;
        } catch (error) {
            Logger.error(`Fehler beim Laden der Konfiguration aus der Datenbank:`, error);
            return this.#loadLocalConfig();
        }
    }

    /**
     * Speichert einen Konfigurationswert
     * @param {string} key - Konfigurationsschlüssel
     * @param {*} value - Konfigurationswert
     * @param {string} [context=this.defaultContext] - Der Kontext der Konfiguration
     * @returns {Promise<boolean>} Erfolg der Operation
     */
    async set(key, value, context = this.defaultContext) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');

        if (!dbService) {
            Logger.warn(`Konfiguration kann nicht gespeichert werden: Lokaler Modus aktiv`);
            return false;
        }

        try {
            await dbService.query(`
                INSERT INTO configs (plugin_name, config_key, config_value, context)
                VALUES (?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)
            `, [
                this.pluginName,
                key,
                typeof value === 'object' ? JSON.stringify(value) : String(value),
                context
            ]);
            
            // Cache invalidieren
            const cacheKey = `${this.pluginName}_${context}`;
            delete this.cache[cacheKey];
            
            Logger.debug(`Konfiguration ${key} für ${this.pluginName} (${context}) gespeichert`);
            return true;
        } catch (error) {
            Logger.error(`Fehler beim Speichern der Konfiguration ${key} für ${this.pluginName}:`, error);
            return false;
        }
    }

    /**
     * Speichert mehrere Konfigurationswerte auf einmal
     * @param {Object} configValues - Objekt mit Schlüssel-Wert-Paaren
     * @param {string} [context=this.defaultContext] - Der Kontext der Konfiguration
     * @returns {Promise<boolean>} Erfolg der Operation
     */
    async setMultiple(configValues, context = this.defaultContext) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');

        if (!dbService) {
            Logger.warn(`Konfiguration kann nicht gespeichert werden: Lokaler Modus aktiv`);
            return false;
        }

        const connection = await dbService.getConnection();
        try {
            await connection.beginTransaction();
            for (const [key, value] of Object.entries(configValues)) {
                await connection.query(`
                    INSERT INTO configs (plugin_name, config_key, config_value, context)
                    VALUES (?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)
                `, [
                    this.pluginName,
                    key,
                    typeof value === 'object' ? JSON.stringify(value) : String(value),
                    context
                ]);
            }
            await connection.commit();
            
            // Cache invalidieren
            const cacheKey = `${this.pluginName}_${context}`;
            delete this.cache[cacheKey];
            
            Logger.debug(`Mehrere Konfigurationswerte für ${this.pluginName} (${context}) gespeichert`);
            return true;
        } catch (error) {
            await connection.rollback();
            Logger.error(`Fehler beim Speichern mehrerer Konfigurationen für ${this.pluginName}:`, error);
            return false;
        } finally {
            connection.release();
        }
    }

    /**
     * Speichert eine komplette Konfiguration (überschreibt alle vorherigen Werte)
     * @param {Object} configToSave - Die zu speichernde Konfiguration
     * @param {string} [context=this.defaultContext] - Der Kontext der Konfiguration
     * @returns {Promise<boolean>} Erfolg der Operation
     */
    async save(configToSave, context = this.defaultContext) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');

        if (!dbService) {
            Logger.warn(`Konfiguration kann nicht gespeichert werden: Lokaler Modus aktiv`);
            return false;
        }

        const connection = await dbService.getConnection();
        try {
            await connection.beginTransaction();
            // Bestehende Einträge für dieses Plugin und diesen Kontext löschen
            await connection.query(
                "DELETE FROM configs WHERE plugin_name = ? AND context = ?",
                [this.pluginName, context]
            );

            // Neue Einträge erstellen
            const flattened = this.#flattenConfig(configToSave);
            for (const [key, value] of Object.entries(flattened)) {
                await connection.query(
                    "INSERT INTO configs (plugin_name, config_key, config_value, context) VALUES (?, ?, ?, ?)",
                    [
                        this.pluginName,
                        key,
                        typeof value === 'object' ? JSON.stringify(value) : String(value),
                        context
                    ]
                );
            }

            await connection.commit();
            
            // Cache invalidieren
            const cacheKey = `${this.pluginName}_${context}`;
            delete this.cache[cacheKey];
            
            Logger.info(`Konfiguration für ${this.pluginName} (${context}) gespeichert`);
            return true;
        } catch (error) {
            await connection.rollback();
            Logger.error(`Fehler beim Speichern der Konfiguration:`, error);
            return false;
        } finally {
            connection.release();
        }
    }

    /**
     * Löscht einen Konfigurationswert
     * @param {string} key - Konfigurationsschlüssel
     * @param {string} [context=this.defaultContext] - Der Kontext der Konfiguration
     * @returns {Promise<boolean>} Erfolg der Operation
     */
    async delete(key, context = this.defaultContext) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');

        if (!dbService) {
            Logger.warn(`Konfiguration kann nicht gelöscht werden: Lokaler Modus aktiv`);
            return false;
        }

        try {
            await dbService.query(
                "DELETE FROM configs WHERE plugin_name = ? AND config_key = ? AND context = ?",
                [this.pluginName, key, context]
            );
            
            // Cache invalidieren
            const cacheKey = `${this.pluginName}_${context}`;
            delete this.cache[cacheKey];
            
            Logger.debug(`Konfiguration ${key} für ${this.pluginName} (${context}) gelöscht`);
            return true;
        } catch (error) {
            Logger.error(`Fehler beim Löschen der Konfiguration ${key} für ${this.pluginName}:`, error);
            return false;
        }
    }

    /**
     * Helper-Methode zum Abflachen eines verschachtelten Konfigurationsobjekts
     * @param {Object} config - Das zu verarbeitende Konfigurationsobjekt
     * @param {string} [prefix=''] - Präfix für Schlüssel
     * @returns {Object} Das abgeflachte Objekt
     * @private
     */
    #flattenConfig(config, prefix = '') {
        return Object.entries(config).reduce((acc, [key, value]) => {
            const newKey = prefix ? `${prefix}.${key}` : key;
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                Object.assign(acc, this.#flattenConfig(value, newKey));
            } else {
                acc[newKey] = value;
            }
            return acc;
        }, {});
    }

    /**
     * Helper-Methode zum Entfalten von Konfigurationseinträgen zurück in ein Objekt
     * @param {Array<Object>} configEntries - Die zu verarbeitenden Konfigurationseinträge
     * @returns {Object} Das entfaltete Objekt
     * @private
     */
    #unflattenConfig(configEntries) {
        const result = {};
        configEntries.forEach(entry => {
            const keys = entry.config_key.split('.');
            let current = result;
            
            keys.forEach((key, index) => {
                if (index === keys.length - 1) {
                    let value = entry.config_value;
                    try {
                        value = JSON.parse(value);
                    } catch {
                        // Wenn kein JSON, unverändert verwenden
                    }
                    current[key] = value;
                } else {
                    current[key] = current[key] || {};
                    current = current[key];
                }
            });
        });
        return result;
    }

    /**
     * Lädt die lokale Konfiguration aus der config.json-Datei
     * @returns {Object} Die geladene Konfiguration
     * @private
     */
    #loadLocalConfig() {
        const Logger = ServiceManager.get('Logger');

        try {
            // Vollständigen Pfad zur Konfigurationsdatei ausgeben
            const configPath = this.configPath;
            Logger.debug(`Versuche lokale Konfiguration zu laden von: ${configPath}`);
            
            if (fs.existsSync(configPath)) {
                const configContent = fs.readFileSync(configPath, "utf8");
                Logger.debug(`Konfigurationsdatei gefunden mit Inhalt: ${configContent.substring(0, 100)}...`);
                
                const config = JSON.parse(configContent);
                Logger.debug(`Lokale Konfiguration für Plugin ${this.pluginName} erfolgreich geladen`);
                return config;
            }
            
            // Alternatives Verzeichnis prüfen
            const altConfigPath = path.join(this.baseDir, 'dashboard', 'config.json');
            if (fs.existsSync(altConfigPath)) {
                Logger.debug(`Alternative Konfigurationsdatei gefunden: ${altConfigPath}`);
                const config = JSON.parse(fs.readFileSync(altConfigPath, "utf8"));
                return config;
            }
            
            // Aus Model-Defaults laden
            const defaultsPath = path.join(this.baseDir, 'models', 'ConfigDefaults.js');
            if (fs.existsSync(defaultsPath)) {
                Logger.debug(`Model-Defaults gefunden: ${defaultsPath}`);
                return require(defaultsPath);
            }
            
            Logger.warn(`Keine Konfigurationsdatei für Plugin ${this.pluginName} gefunden`);
            return {};
        } catch (error) {
            Logger.error(`Fehler beim Laden der lokalen Konfiguration für ${this.pluginName}:`, error);
            return {};
        }
    }
}
module.exports = Config;