const { ServiceManager } = require('dunebot-core');

/**
 * Model für AutoMod Compound Rules
 * Kombinationsregeln: Mehrere Bedingungen (AND/OR) verknüpft mit einer Aktion
 */
class AutoModCompoundRules {
    /**
     * Erlaubte Condition-Typen mit Validierung
     */
    static CONDITION_TYPES = {
        account_age_days: { label: 'Account-Alter (Tage)', operators: ['<', '>', '<=', '>='], valueType: 'number' },
        server_age_hours: { label: 'Server-Mitglied seit (Stunden)', operators: ['<', '>', '<=', '>='], valueType: 'number' },
        has_role: { label: 'Hat Rolle', operators: ['=='], valueType: 'role' },
        missing_role: { label: 'Hat Rolle NICHT', operators: ['=='], valueType: 'role' },
        message_contains_link: { label: 'Nachricht enthält Link', operators: ['=='], valueType: 'boolean' },
        message_contains_invite: { label: 'Nachricht enthält Einladung', operators: ['=='], valueType: 'boolean' },
        message_has_attachment: { label: 'Nachricht hat Anhang', operators: ['=='], valueType: 'boolean' },
        mention_count: { label: 'Anzahl Erwähnungen', operators: ['>', '>=', '<', '<=', '=='], valueType: 'number' },
        message_length: { label: 'Nachrichtenlänge', operators: ['>', '>=', '<', '<='], valueType: 'number' },
    };

    /**
     * Alle Regeln einer Guild laden
     */
    static async getRules(guildId, enabledOnly = false) {
        const dbService = ServiceManager.get('dbService');
        let query = 'SELECT * FROM automod_compound_rules WHERE guild_id = ?';
        const params = [guildId];
        if (enabledOnly) {
            query += ' AND enabled = 1';
        }
        query += ' ORDER BY created_at ASC';
        const rows = await dbService.query(query, params);
        return rows.map(r => ({
            ...r,
            conditions: typeof r.conditions === 'string' ? JSON.parse(r.conditions) : r.conditions
        }));
    }

    /**
     * Einzelne Regel laden
     */
    static async getRule(id, guildId) {
        const dbService = ServiceManager.get('dbService');
        const rows = await dbService.query(
            'SELECT * FROM automod_compound_rules WHERE id = ? AND guild_id = ?',
            [id, guildId]
        );
        if (!rows[0]) return null;
        const r = rows[0];
        r.conditions = typeof r.conditions === 'string' ? JSON.parse(r.conditions) : r.conditions;
        return r;
    }

    /**
     * Neue Regel erstellen
     */
    static async createRule(guildId, { name, description, conditions, logic, action, duration }) {
        const dbService = ServiceManager.get('dbService');
        AutoModCompoundRules.validateConditions(conditions);

        const result = await dbService.query(
            `INSERT INTO automod_compound_rules (guild_id, name, description, conditions, logic, action, duration)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [guildId, name.substring(0, 100), description?.substring(0, 500) || null,
             JSON.stringify(conditions), logic || 'AND', action || 'STRIKE', duration || null]
        );
        return result.insertId;
    }

    /**
     * Regel aktualisieren
     */
    static async updateRule(id, guildId, { name, description, conditions, logic, action, duration, enabled }) {
        const dbService = ServiceManager.get('dbService');
        if (conditions) AutoModCompoundRules.validateConditions(conditions);

        await dbService.query(
            `UPDATE automod_compound_rules 
             SET name = ?, description = ?, conditions = ?, logic = ?, action = ?, duration = ?, enabled = ?
             WHERE id = ? AND guild_id = ?`,
            [name?.substring(0, 100), description?.substring(0, 500) || null,
             conditions ? JSON.stringify(conditions) : '[]', logic || 'AND', action || 'STRIKE',
             duration || null, enabled !== undefined ? (enabled ? 1 : 0) : 1, id, guildId]
        );
    }

    /**
     * Regel löschen
     */
    static async deleteRule(id, guildId) {
        const dbService = ServiceManager.get('dbService');
        await dbService.query(
            'DELETE FROM automod_compound_rules WHERE id = ? AND guild_id = ?',
            [id, guildId]
        );
    }

    /**
     * Validiert Conditions-Array
     */
    static validateConditions(conditions) {
        if (!Array.isArray(conditions) || conditions.length === 0) {
            throw new Error('Mindestens eine Bedingung erforderlich');
        }
        if (conditions.length > 10) {
            throw new Error('Maximal 10 Bedingungen pro Regel');
        }
        for (const cond of conditions) {
            const typeDef = AutoModCompoundRules.CONDITION_TYPES[cond.type];
            if (!typeDef) throw new Error(`Unbekannter Condition-Typ: ${cond.type}`);
            if (!typeDef.operators.includes(cond.operator)) {
                throw new Error(`Ungültiger Operator ${cond.operator} für ${cond.type}`);
            }
        }
    }

    /**
     * Prüft eine Nachricht gegen alle aktiven Compound Rules einer Guild
     * @returns {Object|null} Erste matchende Regel oder null
     */
    static async checkMessage(message) {
        const { guild, member, author, content } = message;
        if (!guild || !member) return null;

        const rules = await AutoModCompoundRules.getRules(guild.id, true);
        if (rules.length === 0) return null;

        // Daten einmal vorbereiten
        const now = Date.now();
        const accountAgeDays = (now - author.createdTimestamp) / (1000 * 60 * 60 * 24);
        const serverAgeHours = member.joinedTimestamp ? (now - member.joinedTimestamp) / (1000 * 60 * 60) : Infinity;
        const memberRoleIds = member.roles?.cache?.map(r => r.id) || [];
        const containsLink = /https?:\/\/\S+/i.test(content);
        const containsInvite = /discord(?:\.gg|(?:app)?\.com\/invite)\/\S+/i.test(content);
        const hasAttachment = message.attachments?.size > 0;
        const mentionCount = (message.mentions?.members?.size || 0) + (message.mentions?.roles?.size || 0);
        const msgLength = content.length;

        const evaluators = {
            account_age_days: (op, val) => AutoModCompoundRules._compare(accountAgeDays, op, val),
            server_age_hours: (op, val) => AutoModCompoundRules._compare(serverAgeHours, op, val),
            has_role: (_op, val) => memberRoleIds.includes(String(val)),
            missing_role: (_op, val) => !memberRoleIds.includes(String(val)),
            message_contains_link: () => containsLink,
            message_contains_invite: () => containsInvite,
            message_has_attachment: () => hasAttachment,
            mention_count: (op, val) => AutoModCompoundRules._compare(mentionCount, op, val),
            message_length: (op, val) => AutoModCompoundRules._compare(msgLength, op, val),
        };

        for (const rule of rules) {
            const results = rule.conditions.map(cond => {
                const evaluator = evaluators[cond.type];
                if (!evaluator) return false;
                return evaluator(cond.operator, cond.value);
            });

            const matched = rule.logic === 'OR'
                ? results.some(r => r)
                : results.every(r => r);

            if (matched) return rule;
        }

        return null;
    }

    /**
     * Vergleichsoperator auswerten
     */
    static _compare(actual, operator, expected) {
        const exp = Number(expected);
        switch (operator) {
            case '<': return actual < exp;
            case '>': return actual > exp;
            case '<=': return actual <= exp;
            case '>=': return actual >= exp;
            case '==': return actual === exp;
            default: return false;
        }
    }
}

module.exports = AutoModCompoundRules;
