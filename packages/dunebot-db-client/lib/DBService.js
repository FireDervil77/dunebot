const DBClient = require("./DBClient");
const { ServiceManager } = require("dunebot-core");

/**
 * Service für Datenbankoperationen mit nativen MySQL-Queries
 * Implementiert alle wichtigen CRUD-Operationen für die DuneBot-Tabellen
 * 
 * @author firedervil
 */
class DBService extends DBClient {
    /**
     * @param {Object} options Verbindungsoptionen
     */
    constructor(options = {}) {
        super(options);
    }

    /**
     * Initialisiert die Datenbank und erstellt fehlende Tabellen
     * @returns {Promise<void>}
     */
    async initialize() {
        const Logger = ServiceManager.get('Logger');
        try {
            Logger.info("Initialisiere Datenbanktabellen...");
            await models.createTables(this);
            Logger.success("Datenbank erfolgreich initialisiert");
            return true;
        } catch (error) {
            Logger.error("Fehler bei der Datenbankinitialisierung:", error);
            throw error;
        }
    }
    
    /**
     * Singleton-Methode
     * @param {Object} options Verbindungsoptionen
     * @returns {DBService} DBService-Instanz
     */
    static getInstance(options = {}) {
        if (!this._instance) {
            this._instance = new DBService(options);
        }
        return this._instance;
    }

    /**
     * Initialisiert die Einstellungen für eine Guild
     * @param {string} guildId Guild-ID
     * @param {Object} defaultSettings Standard-Einstellungen (optional)
     * @returns {Promise<Object>} Guild-Einstellungen
     */
    async initGuildSettings(guildId, defaultSettings = {}) {
        const Logger = ServiceManager.get('Logger');
        try {
            // Prüfen, ob die Guild bereits Einstellungen hat
            const existingSettings = await this.getSettings(guildId, { source: 'initGuildSettings' });
            if (existingSettings && existingSettings._id) {
                return existingSettings;
            }

            // Standardwerte für Guild-Einstellungen
            const settings = {
                _id: guildId,
                prefix: '!',
                locale: 'de-DE',
                enabled_plugins: JSON.stringify(['core']),
                ...defaultSettings
            };

            // SQL-Query zum Einfügen der Einstellungen
            const sql = `
                INSERT INTO settings (_id, prefix, locale, enabled_plugins, created_at, updated_at) 
                VALUES (?, ?, ?, ?, NOW(), NOW())
                ON DUPLICATE KEY UPDATE
                    prefix = VALUES(prefix),
                    locale = VALUES(locale),
                    enabled_plugins = VALUES(enabled_plugins),
                    updated_at = NOW()
            `;

            await this.query(sql, [
                settings._id,
                settings.prefix,
                settings.locale,
                settings.enabled_plugins,
            ]);

            Logger.info(`Guild-Einstellungen für ${guildId} initialisiert`);
            return settings;
        } catch (error) {
            Logger.error(`Fehler beim Initialisieren der Guild-Einstellungen für ${guildId}:`, error);
            throw error;
        }
    }

    /**
     * Liefert Guild-Einstellungen
     * @param {string} guildId Guild-ID
     * @param {Object} options Optionen
     * @returns {Promise<Object>} Guild-Einstellungen
     */
    async getSettings(guildId, options = {}) {
        const Logger = ServiceManager.get('Logger');
        try {
            const source = options.source || 'unknown';
            if (!guildId) throw new Error(`getSettings(${source}): guildId ist undefiniert/null`);
            if (typeof guildId === "object") guildId = guildId._id || guildId.id;
            if (!guildId) throw new Error(`getSettings(${source}): guildId ist nach Normalisierung immer noch undefiniert`);

            // Guild-Einstellungen abfragen
            const sql = "SELECT * FROM settings WHERE _id = ? LIMIT 1";
            const settings = await this.query(sql, [guildId]);

            // Wenn Einstellungen gefunden wurden
            if (settings && settings.length > 0) {
                const result = settings[0];
                
                // JSON-Felder parsen
                if (result.enabled_plugins && typeof result.enabled_plugins === 'string') {
                    try {
                        result.enabled_plugins = JSON.parse(result.enabled_plugins);
                    } catch (e) {
                        result.enabled_plugins = ['core']; // Fallback
                    }
                }
                
                return result;
            }

            // Prüfen, ob die Guild existiert, bevor wir Settings erstellen
            const guildSql = "SELECT * FROM guilds WHERE _id = ? LIMIT 1";
            const guilds = await this.query(guildSql, [guildId]);
            
            if (!guilds || guilds.length === 0) {
                Logger.warn(`getSettings(${source}): Guild ${guildId} nicht gefunden. Erstelle keine Settings.`);
                return this.getDefaultSettingsWithId(guildId);
            }

            // Settings erstellen und zurückgeben
            const defaultSettings = this.getDefaultSettings();
            const insertSql = `
                INSERT INTO settings (_id, prefix, locale, enabled_plugins, created_at, updated_at)
                VALUES (?, ?, ?, ?, NOW(), NOW())
            `;
            
            await this.query(insertSql, [
                guildId,
                defaultSettings.prefix,
                defaultSettings.locale,
                JSON.stringify(defaultSettings.enabled_plugins || ['core'])
            ]);
            
            // Neue Settings abrufen
            return { ...defaultSettings, _id: guildId };
        } catch (error) {
            Logger.error(`Fehler beim Abrufen der Einstellungen:`, error);
            return this.getDefaultSettingsWithId(guildId);
        }
    }

    /**
     * Standardeinstellungen mit Guild-ID
     * @param {string} guildId Guild-ID
     * @returns {Object} Standardeinstellungen
     */
    getDefaultSettingsWithId(guildId) {
        return {
            _id: guildId,
            ...this.getDefaultSettings()
        };
    }

    /**
     * Standardeinstellungen ohne Guild-ID
     * @returns {Object} Standardeinstellungen
     */
    getDefaultSettings() {
        return {
            prefix: '!',
            locale: 'de-DE',
            enabled_plugins: ['core']
        };
    }

    /**
     * Globale Plugin-Konfigurationen abrufen
     * @param {string} pluginName Plugin-Name
     * @param {string} context Kontext (shared, bot, dashboard)
     * @returns {Promise<Object>} Plugin-Konfiguration
     */
    async getPluginConfig(pluginName, context = 'shared') {
        const Logger = ServiceManager.get('Logger');
        try {
            const sql = "SELECT config_key, config_value FROM configs WHERE plugin_name = ? AND context = ?";
            const entries = await this.query(sql, [pluginName, context]);
            
            // Objekt aus Config-Einträgen erstellen
            const config = {};
            for (const entry of entries) {
                // Versuche JSON zu parsen, wenn es ein JSON-String ist
                try {
                    if (entry.config_value && 
                       (entry.config_value.startsWith('{') || entry.config_value.startsWith('['))) {
                        config[entry.config_key] = JSON.parse(entry.config_value);
                    } else {
                        config[entry.config_key] = entry.config_value;
                    }
                } catch (e) {
                    config[entry.config_key] = entry.config_value;
                }
            }
            
            return config;
        } catch (error) {
            Logger.error(`Fehler beim Abrufen der Konfiguration für Plugin ${pluginName}:`, error);
            return {};
        }
    }

    /**
     * Guild-Einstellungen aktualisieren
     * @param {string} guildId Guild-ID
     * @param {Object} updates Aktualisierte Einstellungen
     * @returns {Promise<Object>} Aktualisierte Einstellungen
     */
    async updateSettings(guildId, updates) {
        const Logger = ServiceManager.get('Logger');
        try {
            // Stelle sicher, dass enabled_plugins als JSON gespeichert wird
            let enabledPlugins = updates.enabled_plugins;
            if (enabledPlugins) {
                if (Array.isArray(enabledPlugins)) {
                    enabledPlugins = JSON.stringify(enabledPlugins);
                } else if (typeof enabledPlugins === 'string' && !enabledPlugins.startsWith('[')) {
                    // Wenn es ein String, aber kein JSON ist
                    enabledPlugins = JSON.stringify(enabledPlugins.split(','));
                }
            }

            // Prüfen, ob Settings existieren
            const checkSql = "SELECT * FROM settings WHERE _id = ? LIMIT 1";
            const existing = await this.query(checkSql, [guildId]);
            
            if (!existing || existing.length === 0) {
                // Settings erstellen
                const defaultSettings = this.getDefaultSettings();
                const newSettings = { 
                    ...defaultSettings, 
                    ...updates,
                    enabled_plugins: enabledPlugins || JSON.stringify(defaultSettings.enabled_plugins)
                };
                
                const insertSql = `
                    INSERT INTO settings (_id, prefix, locale, enabled_plugins, created_at, updated_at)
                    VALUES (?, ?, ?, ?, NOW(), NOW())
                `;
                
                await this.query(insertSql, [
                    guildId,
                    newSettings.prefix,
                    newSettings.locale,
                    newSettings.enabled_plugins
                ]);
                
                const result = { ...newSettings, _id: guildId };
                if (typeof result.enabled_plugins === 'string') {
                    try {
                        result.enabled_plugins = JSON.parse(result.enabled_plugins);
                    } catch (e) {}
                }
                return result;
            } else {
                // Settings aktualisieren
                const updateFields = [];
                const updateValues = [];
                
                // Dynamische Felder für UPDATE
                if (updates.prefix !== undefined) {
                    updateFields.push("prefix = ?");
                    updateValues.push(updates.prefix);
                }
                
                if (updates.locale !== undefined) {
                    updateFields.push("locale = ?");
                    updateValues.push(updates.locale);
                }
                
                if (enabledPlugins !== undefined) {
                    updateFields.push("enabled_plugins = ?");
                    updateValues.push(enabledPlugins);
                }
                
                // Keine Änderungen? Aktuelle Settings zurückgeben
                if (updateFields.length === 0) {
                    return await this.getSettings(guildId);
                }
                
                // Timestamp und guildId hinzufügen
                updateFields.push("updated_at = NOW()");
                updateValues.push(guildId); // Für WHERE-Klausel
                
                const updateSql = `
                    UPDATE settings 
                    SET ${updateFields.join(", ")} 
                    WHERE _id = ?
                `;
                
                await this.query(updateSql, updateValues);
                
                // Aktualisierte Settings zurückgeben
                return await this.getSettings(guildId);
            }
        } catch (error) {
            Logger.error(`Fehler beim Aktualisieren der Guild-Einstellungen für ${guildId}:`, error);
            throw error;
        }
    }

    /**
     * Plugin-Konfiguration abrufen
     * @param {string} pluginName Plugin-Name
     * @returns {Promise<Object>} Plugin-Konfiguration
     */
    async getConfig(pluginName) {
        const sql = "SELECT * FROM configs WHERE plugin_name = ?";
        return await this.query(sql, [pluginName]);
    }

    /**
     * Plugin-Konfiguration aktualisieren
     * @param {string} pluginName Plugin-Name
     * @param {Object} data Konfigurationsdaten
     * @returns {Promise<Object>} Aktualisierte Konfiguration
     */
    async updateConfig(pluginName, data) {
        const Logger = ServiceManager.get('Logger');
        try {
            // Wir konvertieren das ganze Objekt in einzelne Config-Einträge
            const entries = Object.entries(data);
            
            // Transaktion für mehrere Updates
            return await this.transaction(async (connection) => {
                for (const [key, value] of entries) {
                    // Werte bei Bedarf in JSON konvertieren
                    let configValue = value;
                    if (typeof value === 'object') {
                        configValue = JSON.stringify(value);
                    }
                    
                    const upsertSql = `
                        INSERT INTO configs (plugin_name, config_key, config_value)
                        VALUES (?, ?, ?)
                        ON DUPLICATE KEY UPDATE
                            config_value = VALUES(config_value)
                    `;
                    
                    await connection.execute(upsertSql, [pluginName, key, configValue]);
                }
                
                return data;
            });
        } catch (error) {
            Logger.error(`Fehler beim Aktualisieren der Konfiguration für Plugin ${pluginName}:`, error);
            throw error;
        }
    }

    /**
     * Alle Konfigurationen abrufen
     * @returns {Promise<Array>} Alle Konfigurationseinträge
     */
    async getAllConfigs() {
        return await this.query("SELECT * FROM configs");
    }

    /**
     * Guild abrufen
     * @param {string} guildId Guild-ID
     * @returns {Promise<Object>} Guild-Daten
     */
    async getGuild(guildId) {
        const guilds = await this.query("SELECT * FROM guilds WHERE _id = ? LIMIT 1", [guildId]);
        return guilds && guilds.length > 0 ? guilds[0] : null;
    }

    /**
     * Guild einfügen oder aktualisieren
     * @param {Object} data Guild-Daten
     * @returns {Promise<Object>} Aktualisierte Guild
     */
    async upsertGuild(data) {
        if (!data._id) throw new Error("Guild-ID (_id) ist erforderlich");
        
        // Anpassung der Feldnamen an die tatsächliche Datenbankstruktur
        const fields = ['guild_name', 'owner_id', 'owner_name', 'joined_at', 'left_at'];
        const insertValues = [data._id];
        const insertPlaceholders = ['?'];
        const updateSets = [];
        
        // Mapping der Feldnamen von der API zur Datenbank
        const dataMapping = {
            'guild_name': data.name || data.guild_name,
            'owner_id': data.owner_id,
            'owner_name': data.owner_name,
            'joined_at': data.joined_at,
            'left_at': data.left_at || null
        };
        
        fields.forEach(field => {
            if (dataMapping[field] !== undefined) {
                insertValues.push(dataMapping[field]);
                insertPlaceholders.push('?');
                updateSets.push(`${field} = VALUES(${field})`);
            } else {
                // Platzhalter für fehlende Werte
                insertValues.push(null);
                insertPlaceholders.push('?');
            }
        });
        
        // Timestamps hinzufügen
        insertValues.push(new Date()); // created_at
        insertValues.push(new Date()); // updated_at
        insertPlaceholders.push('?');
        insertPlaceholders.push('?');
        updateSets.push('updated_at = VALUES(updated_at)');
        
        const sql = `
            INSERT INTO guilds (_id, ${fields.join(', ')}, created_at, updated_at)
            VALUES (${insertPlaceholders.join(', ')})
            ON DUPLICATE KEY UPDATE
                ${updateSets.join(', ')}
        `;
        
        await this.query(sql, insertValues);
        return this.getGuild(data._id);
    }
    
    /**
     * Speichert einen OAuth-State-Parameter und die zugehörige Redirect-URL
     * @param {string} state - Zufälliger State-Parameter für OAuth
     * @param {string} redirectUrl - URL, zu der nach der Authentifizierung weitergeleitet werden soll
     * @returns {Promise<boolean>} - True, wenn erfolgreich gespeichert
     * @author firedervil
     */
    async saveState(state, redirectUrl) {
        const Logger = ServiceManager.get('Logger');
        
        try {
            await this.query(`
                INSERT INTO states (id, value) 
                VALUES (?, ?)
                ON DUPLICATE KEY UPDATE 
                    value = VALUES(value)
            `, [
                state,  // Der crypto-generierte State als Primary Key
                JSON.stringify({ redirect_url: redirectUrl })  // redirectUrl als JSON in value
            ]);
            
            return true;
        } catch (error) {
            Logger.error('Fehler beim Speichern des OAuth-State:', error);
            throw error;
        }
    }

    /**
     * Ruft einen gespeicherten OAuth-State und die zugehörige Redirect-URL ab
     * @param {string} state - Der abzurufende State-Parameter
     * @returns {Promise<Object|null>} - Das State-Objekt oder null, wenn nicht gefunden
     * @author firedervil
     */
    async getState(state) {
        const Logger = ServiceManager.get('Logger');
        
        try {
            // State abrufen
            const states = await this.query(`
                SELECT id, value, created_at
                FROM states
                WHERE id = ?
                LIMIT 1
            `, [state]);
            
            if (states && states.length > 0) {
                const stateObj = states[0];
                try {
                    const stateValue = JSON.parse(stateObj.value);
                    return {
                        state: stateObj.id,
                        redirect_url: stateValue.redirect_url,
                        created_at: stateObj.created_at
                    };
                } catch (parseError) {
                    Logger.error('Fehler beim Parsen des State-Wertes:', parseError);
                }
            }
            
            return null;
        } catch (error) {
            Logger.error('Fehler beim Abrufen des OAuth-State:', error);
            return null;
        }
    }

    /**
     * Löscht einen verwendeten OAuth-State
     * @param {string} state - Der zu löschende State-Parameter
     * @returns {Promise<boolean>} - True, wenn erfolgreich gelöscht
     * @author firedervil
     */
    async deleteState(state) {
        try {
            await this.query(`DELETE FROM states WHERE id = ?`, [state]);
            return true;
        } catch (error) {
            const Logger = ServiceManager.get('Logger');
            Logger.error('Fehler beim Löschen des OAuth-State:', error);
            return false;
        }
    }

    /**
     * Benutzer abrufen
     * @param {string} userId Benutzer-ID
     * @returns {Promise<Object>} Benutzerdaten
     */
    async getUser(userId) {
        const users = await this.query("SELECT * FROM users WHERE _id = ? LIMIT 1", [userId]);
        return users && users.length > 0 ? users[0] : null;
    }
    
    /**
     * Benutzer einfügen oder aktualisieren
     * @param {Object} data Benutzerdaten
     * @returns {Promise<Object>} Aktualisierte Benutzerdaten
     */
    async upsertUser(data) {
        if (!data._id) throw new Error("Benutzer-ID (_id) ist erforderlich");
        
        // Prüfen, ob tokens als JSON gespeichert werden sollen
        let tokens = data.tokens || '{}';
        if (typeof tokens === 'object') {
            tokens = JSON.stringify(tokens);
        }
        
        const sql = `
            INSERT INTO users (_id, locale, logged_in, tokens, created_at, updated_at)
            VALUES (?, ?, ?, ?, NOW(), NOW())
            ON DUPLICATE KEY UPDATE
                locale = VALUES(locale),
                logged_in = VALUES(logged_in),
                tokens = VALUES(tokens),
                updated_at = NOW()
        `;
        
        await this.query(sql, [
            data._id,
            data.locale || 'de-DE',
            data.logged_in || 0,
            tokens
        ]);
        
        return this.getUser(data._id);
    }
    
    /**
     * News-Einträge abrufen
     * @param {number} limit Maximale Anzahl der Einträge
     * @returns {Promise<Array>} News-Einträge
     */
    async getNews(limit = 5) {
        return await this.query(
            "SELECT * FROM news ORDER BY created_at DESC LIMIT ?", 
            [limit]
        );
    }
    
    /**
     * News-Eintrag erstellen
     * @param {Object} data News-Daten
     * @returns {Promise<Object>} Erstellter News-Eintrag
     */
    async createNews(data) {
        const sql = `
            INSERT INTO news (title, content, author_id, type, created_at, updated_at)
            VALUES (?, ?, ?, ?, NOW(), NOW())
        `;
        
        const result = await this.query(sql, [
            data.title,
            data.content,
            data.author_id,
            data.type || 'info'
        ]);
        
        if (result && result.insertId) {
            const newsList = await this.query("SELECT * FROM news WHERE id = ? LIMIT 1", [result.insertId]);
            return newsList[0];
        }
        
        return null;
    }


/**
 *  NEUE METHODEN nach start der Umstellung auf
 * 
 *  MYSQL.
 * 
 * 
 * 
 * 
 */
/**
 * Ruft alle News ab
 * @returns {Promise<Array>}
 */
async getAllNews() {
    return await this.query("SELECT * FROM news ORDER BY created_at DESC");
}

/**
 * Ruft alle Navigation-Items ab
 * @returns {Promise<Array>}
 */
async getAllNavItems() {
    return await this.query("SELECT * FROM nav_items ORDER BY order_num ASC");
}

/**
 * Ruft alle Settings ab
 * @returns {Promise<Array>}
 */
async getAllSettings() {
    return await this.query("SELECT * FROM settings");
}

/**
 * Ruft alle Benachrichtigungen ab
 * @returns {Promise<Array>}
 */
async getAllNotifications() {
    return await this.query("SELECT * FROM notifications ORDER BY created_at DESC");
}

/**
 * Ruft alle Configs ab
 * @returns {Promise<Array>}
 */
async getAllConfigs() {
    return await this.query("SELECT * FROM configs");
}


}

module.exports = DBService;