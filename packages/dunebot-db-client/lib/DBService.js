const DBClient = require("./DBClient");
const { ServiceManager } = require("dunebot-core");

const path = require('path');
const fs = require('fs');
const configPath = path.join(__dirname, '../../../plugins/core/dashboard/config.json');
const defaultConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));

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
     * Gibt eine Verbindung aus dem Pool zurück
     * @returns {Promise<Connection>} MySQL Verbindung
     * @author firedervil
     */
    async getConnection() {
        return await this.pool.getConnection();
    }

    /**
     * Führt eine Transaktion aus
     * @param {Function} callback - Funktion, die die Transaktion ausführt
     * @returns {Promise<any>} Ergebnis der Transaktion
     */
    async transaction(callback) {
        const connection = await this.getConnection();
        try {
            await connection.beginTransaction();
            const result = await callback(connection);
            await connection.commit();
            return result;
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }
    
    /**
     * Holt alle Konfigurationen für eine Guild als Objekt
     * @param {string} guildId Guild-ID
     * @param {string} [pluginName='core'] Plugin-Name (optional, Standard: 'core')
     * @param {string} [context='shared'] Kontext (optional, Standard: 'shared')
     * @returns {Promise<Object>} Alle Configs als Key-Value-Objekt
     * @author firedervil
     */
    async getConfigs(guildId, pluginName = 'core', context = 'shared') {
        const Logger = ServiceManager.get('Logger');
        try {
            const sql = `
                SELECT config_key, config_value 
                FROM configs 
                WHERE guild_id = ? AND plugin_name = ? AND context = ?
            `;
            const entries = await this.query(sql, [guildId, pluginName, context]);
            const configs = {};
            for (const entry of entries) {
                try {
                    // Versuche JSON zu parsen, falls Wert ein JSON-String ist
                    if (typeof entry.config_value === 'string' && (entry.config_value.startsWith('{') || entry.config_value.startsWith('['))) {
                        configs[entry.config_key] = JSON.parse(entry.config_value);
                    } else {
                        configs[entry.config_key] = entry.config_value;
                    }
                } catch (e) {
                    configs[entry.config_key] = entry.config_value;
                }
            }
            return configs;
        } catch (error) {
            Logger.error(`Fehler beim Laden der Guild-Konfiguration für ${guildId}:`, error);
            throw error;
        }
    }


    /**
     * Holt eine Config für ein Plugin, optional für eine Guild.
     * @param {string} pluginName
     * @param {string} configKey
     * @param {string} [context='shared']
     * @param {string|null} [guildId=null]
     * @returns {Promise<string|object|null>}
     * @author firedervil
     */
    async getConfig(pluginName, configKey, context = 'shared', guildId = null) {
        const sql = `
            SELECT config_value FROM configs
            WHERE plugin_name = ? AND config_key = ? AND context = ? ${guildId ? 'AND guild_id = ?' : 'AND is_global = TRUE'}
            LIMIT 1
        `;
        const params = guildId ? [pluginName, configKey, context, guildId] : [pluginName, configKey, context];
        const [result] = await this.query(sql, params);
        if (!result) return null;
        try {
            if (result.config_value.startsWith('{') || result.config_value.startsWith('[')) {
                return JSON.parse(result.config_value);
            }
            return result.config_value;
        } catch (e) {
            return result.config_value;
        }
    }

    /**
     * Setzt oder aktualisiert eine Config für ein Plugin, optional für eine Guild.
     * @param {string} pluginName
     * @param {string} configKey
     * @param {string|object} value
     * @param {string} [context='shared']
     * @param {string|null} [guildId=null]
     * @param {boolean} [isGlobal=!guildId]
     * @returns {Promise<void>}
     * @author firedervil
     */
    async setConfig(pluginName, configKey, value, context = 'shared', guildId = null, isGlobal = null) {
        let configValue = value;
        if (typeof value === "object") configValue = JSON.stringify(value);
        if (isGlobal === null) isGlobal = !guildId;
        const sql = `
            INSERT INTO configs (plugin_name, config_key, config_value, context, guild_id, is_global)
            VALUES (?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE config_value = VALUES(config_value), updated_at = NOW()
        `;
        await this.query(sql, [pluginName, configKey, configValue, context, guildId, isGlobal]);
    }

    /**
     * Löscht eine oder alle Configs für ein Plugin, optional für eine Guild.
     * @param {string} pluginName
     * @param {string|null} configKey
     * @param {string} [context='shared']
     * @param {string|null} [guildId=null]
     * @returns {Promise<void>}
     */
    async deleteConfig(pluginName, configKey = null, context = 'shared', guildId = null) {
        let sql = `
            DELETE FROM configs
            WHERE plugin_name = ? AND context = ? ${guildId ? 'AND guild_id = ?' : 'AND is_global = TRUE'}
        `;
        const params = guildId ? [pluginName, context, guildId] : [pluginName, context];
        if (configKey) {
            sql = sql.replace('WHERE', `WHERE config_key = ? AND`);
            params.unshift(configKey);
        }
        await this.query(sql, params);
    }

    /**
     * Stellt sicher, dass eine Config existiert, überschreibt sie aber NICHT falls vorhanden
     * Perfekt für Default-Configs die nur beim ersten Mal gesetzt werden sollen
     * @param {string} pluginName Plugin-Name
     * @param {string} configKey Config-Schlüssel
     * @param {string|object} defaultValue Standard-Wert (wird nur verwendet wenn Config nicht existiert)
     * @param {string} [context='shared'] Kontext (shared, bot, dashboard)
     * @param {string|null} [guildId=null] Guild-ID (null = global)
     * @param {boolean} [isGlobal=!guildId] Ob es eine globale Config ist
     * @returns {Promise<boolean>} true wenn neu erstellt, false wenn bereits vorhanden
     * @author firedervil
     */
    async ensureConfig(pluginName, configKey, defaultValue, context = 'shared', guildId = null, isGlobal = null) {
        const Logger = ServiceManager.get('Logger');
        
        // Prüfe ob Config bereits existiert
        const existing = await this.getConfig(pluginName, configKey, context, guildId);
        
        if (existing !== null) {
            // Config existiert bereits, NICHT überschreiben
            Logger.debug(`[DBService] Config ${pluginName}.${configKey} existiert bereits, überspringe.`);
            return false;
        }
        
        // Config existiert nicht, erstelle sie mit Default-Wert
        let configValue = defaultValue;
        if (typeof defaultValue === "object") configValue = JSON.stringify(defaultValue);
        if (isGlobal === null) isGlobal = !guildId;
        
        const sql = `
            INSERT INTO configs (plugin_name, config_key, config_value, context, guild_id, is_global)
            VALUES (?, ?, ?, ?, ?, ?)
        `;
        await this.query(sql, [pluginName, configKey, configValue, context, guildId, isGlobal]);
        
        Logger.debug(`[DBService] Config ${pluginName}.${configKey} neu erstellt mit Default-Wert.`);
        return true;
    }

    /**
     * Initialisiert mehrere Configs auf einmal, überschreibt aber KEINE existierenden Werte
     * Nutzt ensureConfig() für jeden Eintrag
     * @param {string} pluginName Plugin-Name
     * @param {Object} defaultConfigs Key-Value-Objekt mit Default-Configs
     * @param {string} [context='shared'] Kontext
     * @param {string|null} [guildId=null] Guild-ID (null = global)
     * @returns {Promise<{created: number, existing: number}>} Statistik über erstellte/vorhandene Configs
     * @author firedervil
     */
    async ensureConfigs(pluginName, defaultConfigs, context = 'shared', guildId = null) {
        const Logger = ServiceManager.get('Logger');
        let created = 0;
        let existing = 0;
        
        try {
            for (const [key, value] of Object.entries(defaultConfigs)) {
                const isNew = await this.ensureConfig(pluginName, key, value, context, guildId);
                if (isNew) {
                    created++;
                } else {
                    existing++;
                }
            }
            
            Logger.info(`[DBService] Plugin ${pluginName}: ${created} Configs neu erstellt, ${existing} bereits vorhanden (nicht überschrieben)`);
            return { created, existing };
        } catch (error) {
            Logger.error(`[DBService] Fehler beim Initialisieren der Configs für ${pluginName}:`, error);
            throw error;
        }
    }

    /**
     * Initialisiert die Plugin-Konfiguration für eine Guild
     * @param {string} guildId Guild-ID
     * @param {object} configObj Standard-Konfiguration aus config.json
     * @returns {Promise<void>}
     */
    async initGuildConfigs(guildId, configObj) {
        const Logger = ServiceManager.get('Logger');
        try {
            // Für jede Einstellung einen Eintrag in configs anlegen
            for (const [key, value] of Object.entries(configObj)) {
                await this.setConfig(
                    "core",           // Plugin-Name
                    key,              // Config-Key
                    value,            // Config-Wert (wird in setConfig ggf. zu JSON)
                    "shared",         // Kontext
                    guildId,          // Guild-ID
                    false             // isGlobal
                );
            }
            Logger.info(`Guild-Konfiguration für ${guildId} initialisiert`);
        } catch (error) {
            Logger.error(`Fehler beim Initialisieren der Guild-Konfiguration für ${guildId}:`, error);
            throw error;
        }
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
     * Setzt eine Guild als aktiv für einen User
     * @param {string} guildId - Discord Guild ID
     * @param {string} userId - Discord User ID
     * @returns {Promise<void>}
     */
    async setActiveGuild(guildId, userId) {
        // Erst alle Guilds des Users deaktivieren
        await this.query(
            'UPDATE guilds SET is_active_guild = 0, active_user_id = NULL WHERE active_user_id = ?',
            [userId]
        );
        
        // Dann die gewählte Guild aktivieren
        await this.query(
            'UPDATE guilds SET is_active_guild = 1, active_user_id = ? WHERE _id = ?',
            [userId, guildId]
        );
    }

    /**
     * Holt die aktive Guild eines Users
     * @param {string} userId - Discord User ID
     * @returns {Promise<Object>} Guild-Daten
     */
    async getActiveGuild(userId) {
        const [guild] = await this.query(
            'SELECT * FROM guilds WHERE active_user_id = ? AND is_active_guild = 1 LIMIT 1',
            [userId]
        );
        return guild;
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
     * Prüft, ob ein Eintrag mit bestimmten Werten in einer Tabelle existiert
     * @param {string} table - Tabellenname
     * @param {Object} where - Key-Value-Paare für die WHERE-Bedingung
     * @returns {Promise<boolean>} true, wenn Eintrag existiert, sonst false
     * @author firedervil
     */
    async exists(table, where) {
        const dbService = this; // falls als Methode im dbService
        const keys = Object.keys(where);
        const values = Object.values(where);
        const whereClause = keys.map(key => `${key} = ?`).join(' AND ');
        const sql = `SELECT 1 FROM ${table} WHERE ${whereClause} LIMIT 1`;
        const [result] = await dbService.query(sql, values);
        return !!result;
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

/**
     * Fügt einen neuen Marker hinzu
     */
    async addMarker(guildId, sectorX, sectorY, markerType, placedBy) {
        return this.query(`
            INSERT INTO dunemap_markers 
            (guild_id, sector_x, sector_y, marker_type, placed_by)
            VALUES (?, UPPER(?), ?, ?, ?)
        `, [guildId, sectorX, sectorY, markerType, placedBy]);
    }

    /**
     * Entfernt einen Marker
     */
    async removeMarker(guildId, sectorX, sectorY, markerType, placedBy) {
        return this.query(`
            DELETE FROM dunemap_markers
            WHERE guild_id = ?
            AND sector_x = UPPER(?)
            AND sector_y = ?
            AND marker_type = ?
            AND placed_by = ?
        `, [guildId, sectorX, sectorY, markerType, placedBy]);
    }

    /**
     * Holt alle Marker einer Guild
     */
    async getGuildMarkers(guildId) {
        return this.query(`
            SELECT * FROM dunemap_markers
            WHERE guild_id = ?
            ORDER BY sector_x, sector_y
        `, [guildId]);
    }

    /**
     * Aktualisiert einen User in der Datenbank
     * @param {string} userId - Discord User ID
     * @param {object} updates - Objekt mit zu aktualisierenden Feldern (z.B. { locale: 'en-GB' })
     * @returns {Promise<object>} - Query-Resultat
     * @author firedervil
     */
    async updateUser(userId, updates) {
        // Erstelle SET-Clause aus dem updates-Objekt
        const setClause = Object.keys(updates)
            .map(key => `${key} = ?`)
            .join(', ');
        
        const values = [...Object.values(updates), userId];
        
        return await this.query(
            `UPDATE users SET ${setClause}, updated_at = NOW() WHERE _id = ?`,
            values
        );
    }
}

module.exports = DBService;