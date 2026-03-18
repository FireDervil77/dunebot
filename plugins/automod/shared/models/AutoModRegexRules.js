const { ServiceManager } = require('dunebot-core');

/**
 * Model für AutoMod Regex Rules
 * Benutzerdefinierte Regex-Filter mit ReDoS-Schutz
 * 
 * @author FireBot Team
 */
class AutoModRegexRules {
    /**
     * Max erlaubte Regex-Länge (ReDoS-Schutz)
     */
    static MAX_PATTERN_LENGTH = 500;

    /**
     * Timeout für Regex-Ausführung in ms (ReDoS-Schutz)
     */
    static REGEX_TIMEOUT_MS = 50;

    /**
     * Lädt alle Regex-Regeln für eine Guild
     * 
     * @param {string} guildId - Discord Guild ID
     * @param {boolean} [enabledOnly=false] - Nur aktive Regeln laden
     * @returns {Promise<Array>} Array von Regel-Objekten
     */
    static async getRules(guildId, enabledOnly = false) {
        const dbService = ServiceManager.get('dbService');

        try {
            let query = 'SELECT * FROM automod_regex_rules WHERE guild_id = ?';
            const params = [guildId];

            if (enabledOnly) {
                query += ' AND enabled = 1';
            }

            query += ' ORDER BY created_at ASC';

            return await dbService.query(query, params);
        } catch (error) {
            const Logger = ServiceManager.get('Logger');
            Logger.error('[AutoMod] Fehler beim Laden der Regex-Regeln:', error);
            throw error;
        }
    }

    /**
     * Holt eine einzelne Regel
     * 
     * @param {number} id - Regel-ID
     * @param {string} guildId - Discord Guild ID (Sicherheitscheck)
     * @returns {Promise<Object|null>} Regel oder null
     */
    static async getRule(id, guildId) {
        const dbService = ServiceManager.get('dbService');

        try {
            const rows = await dbService.query(
                'SELECT * FROM automod_regex_rules WHERE id = ? AND guild_id = ?',
                [id, guildId]
            );
            return rows[0] || null;
        } catch (error) {
            const Logger = ServiceManager.get('Logger');
            Logger.error('[AutoMod] Fehler beim Laden der Regex-Regel:', error);
            throw error;
        }
    }

    /**
     * Validiert ein Regex-Pattern (Syntax + ReDoS-Schutz)
     * 
     * @param {string} pattern - Regex-Pattern
     * @returns {{ valid: boolean, error?: string }} Validierungsergebnis
     */
    static validatePattern(pattern) {
        if (!pattern || typeof pattern !== 'string') {
            return { valid: false, error: 'Pattern darf nicht leer sein' };
        }

        if (pattern.length > this.MAX_PATTERN_LENGTH) {
            return { valid: false, error: `Pattern darf max. ${this.MAX_PATTERN_LENGTH} Zeichen lang sein` };
        }

        // ReDoS-Prüfung: Verschachtelte Quantifier erkennen
        const dangerousPatterns = [
            /\(.*\+\).*\+/,      // (a+)+
            /\(.*\*\).*\*/,      // (a*)*
            /\(.*\+\).*\*/,      // (a+)*
            /\(.*\*\).*\+/,      // (a*)+
            /\(\.\*.*\)\{/,      // (.*){n}
        ];

        for (const dangerous of dangerousPatterns) {
            if (dangerous.test(pattern)) {
                return { valid: false, error: 'Pattern enthält potentiell gefährliche verschachtelte Quantifier (ReDoS-Risiko)' };
            }
        }

        // Syntax-Prüfung
        try {
            new RegExp(pattern, 'i');
        } catch (e) {
            return { valid: false, error: `Ungültige Regex-Syntax: ${e.message}` };
        }

        // Test-Ausführung mit Timeout-Check
        try {
            const testString = 'a'.repeat(100);
            const start = Date.now();
            new RegExp(pattern, 'i').test(testString);
            const elapsed = Date.now() - start;

            if (elapsed > this.REGEX_TIMEOUT_MS) {
                return { valid: false, error: 'Pattern ist zu langsam (mögliches ReDoS-Risiko)' };
            }
        } catch {
            return { valid: false, error: 'Pattern konnte nicht getestet werden' };
        }

        return { valid: true };
    }

    /**
     * Erstellt eine neue Regex-Regel
     * 
     * @param {string} guildId - Discord Guild ID
     * @param {string} name - Regel-Name
     * @param {string} pattern - Regex-Pattern
     * @param {string} action - Aktion (DELETE, WARN, STRIKE)
     * @returns {Promise<{ id: number }|{ error: string }>} Insert-ID oder Fehler
     */
    static async addRule(guildId, name, pattern, action) {
        const validation = this.validatePattern(pattern);
        if (!validation.valid) {
            return { error: validation.error };
        }

        const dbService = ServiceManager.get('dbService');

        try {
            const result = await dbService.query(
                `INSERT INTO automod_regex_rules (guild_id, name, pattern, action) VALUES (?, ?, ?, ?)`,
                [guildId, name, pattern, action]
            );
            return { id: result.insertId };
        } catch (error) {
            const Logger = ServiceManager.get('Logger');
            Logger.error('[AutoMod] Fehler beim Erstellen der Regex-Regel:', error);
            throw error;
        }
    }

    /**
     * Aktualisiert eine Regex-Regel
     * 
     * @param {number} id - Regel-ID
     * @param {string} guildId - Discord Guild ID (Sicherheitscheck)
     * @param {Object} updates - {name, pattern, action, enabled}
     * @returns {Promise<{ success: boolean, error?: string }>}
     */
    static async updateRule(id, guildId, updates) {
        // Pattern validieren wenn vorhanden
        if (updates.pattern) {
            const validation = this.validatePattern(updates.pattern);
            if (!validation.valid) {
                return { success: false, error: validation.error };
            }
        }

        const dbService = ServiceManager.get('dbService');

        try {
            const fields = Object.keys(updates).map(key => `${key} = ?`).join(', ');
            const values = [...Object.values(updates), id, guildId];

            const result = await dbService.query(
                `UPDATE automod_regex_rules SET ${fields} WHERE id = ? AND guild_id = ?`,
                values
            );
            return { success: result.affectedRows > 0 };
        } catch (error) {
            const Logger = ServiceManager.get('Logger');
            Logger.error('[AutoMod] Fehler beim Aktualisieren der Regex-Regel:', error);
            throw error;
        }
    }

    /**
     * Löscht eine Regex-Regel
     * 
     * @param {number} id - Regel-ID
     * @param {string} guildId - Discord Guild ID (Sicherheitscheck)
     * @returns {Promise<boolean>} Ob Löschung erfolgreich war
     */
    static async deleteRule(id, guildId) {
        const dbService = ServiceManager.get('dbService');

        try {
            const result = await dbService.query(
                'DELETE FROM automod_regex_rules WHERE id = ? AND guild_id = ?',
                [id, guildId]
            );
            return result.affectedRows > 0;
        } catch (error) {
            const Logger = ServiceManager.get('Logger');
            Logger.error('[AutoMod] Fehler beim Löschen der Regex-Regel:', error);
            throw error;
        }
    }

    /**
     * Testet alle aktiven Regex-Regeln gegen einen Text
     * Stoppt beim ersten Match (Performance)
     * 
     * @param {string} guildId - Discord Guild ID
     * @param {string} text - Zu prüfender Text
     * @returns {Promise<Object|null>} Gematchte Regel oder null
     */
    static async testMessage(guildId, text) {
        const rules = await this.getRules(guildId, true);
        const Logger = ServiceManager.get('Logger');

        for (const rule of rules) {
            try {
                const regex = new RegExp(rule.pattern, 'i');
                const start = Date.now();
                const match = regex.test(text);
                const elapsed = Date.now() - start;

                // Timeout-Schutz bei Laufzeit
                if (elapsed > this.REGEX_TIMEOUT_MS) {
                    Logger.warn(`[AutoMod] Regex-Regel "${rule.name}" (ID: ${rule.id}) ist zu langsam (${elapsed}ms) - wird übersprungen`);
                    continue;
                }

                if (match) {
                    return rule;
                }
            } catch (error) {
                Logger.warn(`[AutoMod] Regex-Regel "${rule.name}" (ID: ${rule.id}) fehlerhaft:`, error.message);
            }
        }

        return null;
    }
}

module.exports = AutoModRegexRules;
