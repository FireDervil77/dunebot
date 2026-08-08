const { ServiceManager } = require('dunebot-core');

/**
 * Einen gespeicherten Listenwert zu einer Liste machen — was immer dort steht.
 *
 * Vorher stand an drei Stellen dasselbe Muster: JSON parsen, und wenn dabei
 * kein Array herauskommt, den Wert durch `[]` ersetzen. Das wirft stillschweigend
 * weg, was jemand eingestellt hat. Genau das ist in „Haus Ares" passiert: dort
 * steht in `whitelisted_channels` die nackte Kanal-ID `1492418026161705000`
 * statt einer Liste. `JSON.parse` macht daraus eine gültige *Zahl*, die
 * Array-Prüfung schlägt fehl, und der Kanal war nie ausgenommen — ohne dass
 * irgendwo etwas protokolliert wurde.
 *
 * Kein heutiger Schreibpfad erzeugt so etwas: die Dashboard-Route und die
 * Bot-Befehle legen immer Arrays ab. Es ist eine Altlast aus einer früheren
 * Fassung oder einem Import. Der Leser ist die richtige Stelle dafür — dann
 * repariert sich der Bestand von selbst, ohne in fremde Daten zu schreiben.
 *
 * Einzelwerte werden bewusst aus dem **Rohtext** übernommen und nicht aus dem
 * `JSON.parse`-Ergebnis: Discord-IDs liegen jenseits von
 * `Number.MAX_SAFE_INTEGER`, und der Umweg über eine Zahl kann Stellen kosten.
 *
 * @param {*} roh Gespeicherter Wert (JSON-Text, Array, Zahl oder null)
 * @returns {Array<string>} Liste, notfalls leer
 */
function zuListe(roh) {
    if (roh === null || roh === undefined) return [];
    if (Array.isArray(roh)) return roh.map(String);
    if (typeof roh === 'number' || typeof roh === 'bigint') return [String(roh)];
    if (typeof roh !== 'string') return [];

    const text = roh.trim();
    if (!text) return [];

    // Angefangenes JSON: das war als Struktur gemeint und ist kaputt. Daraus
    // einen Eintrag zu machen, würde nur Unsinn in die Liste tragen.
    if (text.startsWith('[') || text.startsWith('{')) {
        try {
            const gelesen = JSON.parse(text);
            return Array.isArray(gelesen) ? gelesen.map(String) : [];
        } catch {
            return [];
        }
    }

    // Einzelwert oder kommagetrennte Aufzählung aus alten Beständen.
    return text
        .split(',')
        .map(teil => teil.trim().replace(/^"|"$/g, ''))
        .filter(teil => teil.length > 0);
}

/**
 * Model für AutoMod Settings
 * Verwaltet Guild-spezifische AutoMod-Konfiguration
 *
 * @author FireBot Team
 */
class AutoModSettings {
    /**
     * Lädt Settings für eine Guild
     * Erstellt automatisch Default-Settings falls keine vorhanden
     * 
     * @param {string} guildId - Discord Guild ID
     * @returns {Promise<Object>} Settings-Objekt
     */
    static async getSettings(guildId) {
        const dbService = ServiceManager.get('dbService');
        
        try {
            const rows = await dbService.query(
                'SELECT * FROM automod_settings WHERE guild_id = ?',
                [guildId]
            );
            
            if (rows.length === 0) {
                // Keine Settings vorhanden -> Default erstellen
                return await this.createDefaultSettings(guildId);
            }
            
            const settings = rows[0];

            // Die drei Listenfelder - siehe `zuListe` oben, warum das nicht
            // mehr einfach `JSON.parse` mit `[]` als Auffanglösung ist.
            settings.whitelisted_channels = zuListe(settings.whitelisted_channels);
            settings.raid_trusted_invites = zuListe(settings.raid_trusted_invites);
            settings.active_keyword_lists = zuListe(settings.active_keyword_lists);

            return settings;
        } catch (error) {
            const Logger = ServiceManager.get('Logger');
            Logger.error('[AutoMod] Fehler beim Laden der Settings:', error);
            throw error;
        }
    }

    /**
     * Erstellt Default-Settings für eine Guild
     * 
     * @param {string} guildId - Discord Guild ID
     * @returns {Promise<Object>} Erstellte Settings
     */
    static async createDefaultSettings(guildId) {
        const dbService = ServiceManager.get('dbService');
        const Logger = ServiceManager.get('Logger');
        
        try {
            await dbService.query(
                `INSERT INTO automod_settings (guild_id) VALUES (?)`,
                [guildId]
            );
            
            Logger.debug(`[AutoMod] Default-Settings für Guild ${guildId} erstellt`);
            return await this.getSettings(guildId);
        } catch (error) {
            Logger.error('[AutoMod] Fehler beim Erstellen der Default-Settings:', error);
            throw error;
        }
    }

    /**
     * Aktualisiert Settings für eine Guild
     * Nutzt Object mit Key-Value-Pairs
     * 
     * @param {string} guildId - Discord Guild ID
     * @param {Object} updates - Object mit Settings-Updates (z.B. {max_strikes: 5, action: 'KICK'})
     * @returns {Promise<void>}
     */
    static async updateSettings(guildId, updates) {
        const dbService = ServiceManager.get('dbService');
        const Logger = ServiceManager.get('Logger');
        
        try {
            // JSON-Felder stringifizieren
            if (updates.whitelisted_channels !== undefined) {
                updates.whitelisted_channels = JSON.stringify(updates.whitelisted_channels);
            }
            if (updates.raid_trusted_invites !== undefined) {
                updates.raid_trusted_invites = JSON.stringify(updates.raid_trusted_invites);
            }
            if (updates.active_keyword_lists !== undefined && Array.isArray(updates.active_keyword_lists)) {
                updates.active_keyword_lists = JSON.stringify(updates.active_keyword_lists);
            }

            // Dynamisches UPDATE-Statement bauen
            const fields = Object.keys(updates).map(key => `${key} = ?`).join(', ');
            const values = [...Object.values(updates), guildId];

            await dbService.query(
                `UPDATE automod_settings SET ${fields} WHERE guild_id = ?`,
                values
            );
            
            Logger.debug(`[AutoMod] Settings für Guild ${guildId} aktualisiert:`, Object.keys(updates).join(', '));
        } catch (error) {
            Logger.error('[AutoMod] Fehler beim Aktualisieren der Settings:', error);
            throw error;
        }
    }

    /**
     * Löscht Settings für eine Guild (z.B. bei Plugin-Deaktivierung)
     * 
     * @param {string} guildId - Discord Guild ID
     * @returns {Promise<void>}
     */
    static async deleteSettings(guildId) {
        const dbService = ServiceManager.get('dbService');
        const Logger = ServiceManager.get('Logger');
        
        try {
            await dbService.query(
                'DELETE FROM automod_settings WHERE guild_id = ?',
                [guildId]
            );
            
            Logger.debug(`[AutoMod] Settings für Guild ${guildId} gelöscht`);
        } catch (error) {
            Logger.error('[AutoMod] Fehler beim Löschen der Settings:', error);
            throw error;
        }
    }
}

module.exports = AutoModSettings;
