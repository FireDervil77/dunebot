const fs = require('fs');
const path = require('path');
const { ServiceManager } = require('dunebot-core');

const VORLAGEN_VERZEICHNIS = path.join(__dirname, '..', '..', 'bot', 'data', 'keyword_lists');

/**
 * Model für die Stichwortlisten einer Guild.
 *
 * Seit dem 2026-08-09 gibt es **einen** Bestand je Guild. Er wird beim ersten
 * Einschalten des Plugins aus den mitgelieferten Vorlagen befüllt und gehört ab
 * dann der Guild: Wörter löschen, ergänzen, Trefferart ändern, ganze Liste
 * abschalten. Kann, muss nicht.
 *
 * Die Dateien unter `bot/data/keyword_lists/` sind ab dann nur noch **Vorlage**
 * — sie laufen nicht mehr als zweite Ebene mit. Wenn wir später Wörter
 * nachliefern, erreicht das eine Guild nicht von selbst; dafür gibt es den
 * ausdrücklichen Abgleich (`vergleicheMitVorlage`, `uebernehmeAusVorlage`).
 * Nichts wird automatisch zurückgeschrieben, nichts überschrieben.
 *
 * @author FireBot Team
 */
class AutoModKeywordLists {
    // ─────────────────────────────────────────────────────────────────────
    // Listen
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Alle Listen einer Guild, mit der Anzahl ihrer Einträge.
     *
     * @param {string} guildId
     * @returns {Promise<Array>}
     */
    static async getLists(guildId) {
        const dbService = ServiceManager.get('dbService');

        return await dbService.query(`
            SELECT l.*, COUNT(k.id) AS keyword_count
            FROM automod_keyword_lists l
            LEFT JOIN automod_keywords k ON k.list_id = l.id
            WHERE l.guild_id = ?
            GROUP BY l.id
            ORDER BY l.name
        `, [guildId]);
    }

    /**
     * Eine Liste samt Einträgen.
     *
     * Die Guild wird mitgeprüft — ohne das genügte eine fremde Listen-ID, um
     * die Wörter einer anderen Guild zu sehen.
     *
     * @param {string} guildId
     * @param {number} listId
     * @returns {Promise<Object|null>}
     */
    static async getList(guildId, listId) {
        const dbService = ServiceManager.get('dbService');

        const [liste] = await dbService.query(
            'SELECT * FROM automod_keyword_lists WHERE id = ? AND guild_id = ?',
            [listId, guildId]
        ) || [];

        if (!liste) return null;

        liste.keywords = await dbService.query(
            'SELECT id, keyword, match_type FROM automod_keywords WHERE list_id = ? ORDER BY keyword',
            [listId]
        );

        return liste;
    }

    /**
     * Alle eingeschalteten Listen samt Einträgen — was der Bot beim Prüfen
     * einer Nachricht braucht.
     *
     * Eine Abfrage statt einer je Liste: bei jeder Nachricht zählt das.
     *
     * @param {string} guildId
     * @returns {Promise<Array<{id, name, keywords: Array}>>}
     */
    static async getEnabledWithKeywords(guildId) {
        const dbService = ServiceManager.get('dbService');

        const zeilen = await dbService.query(`
            SELECT l.id, l.name, k.keyword, k.match_type
            FROM automod_keyword_lists l
            LEFT JOIN automod_keywords k ON k.list_id = l.id
            WHERE l.guild_id = ? AND l.enabled = 1
            ORDER BY l.name
        `, [guildId]);

        const listen = new Map();
        for (const zeile of zeilen || []) {
            if (!listen.has(zeile.id)) {
                listen.set(zeile.id, { id: zeile.id, name: zeile.name, keywords: [] });
            }
            // LEFT JOIN: eine leere Liste liefert eine Zeile ohne Stichwort.
            if (zeile.keyword) {
                listen.get(zeile.id).keywords.push({
                    keyword: zeile.keyword,
                    match_type: zeile.match_type
                });
            }
        }

        return Array.from(listen.values());
    }

    /**
     * @param {string} guildId
     * @param {string} name
     * @param {string|null} description
     * @returns {Promise<number>} ID der neuen Liste
     */
    static async createList(guildId, name, description = null) {
        const dbService = ServiceManager.get('dbService');

        const ergebnis = await dbService.query(
            'INSERT INTO automod_keyword_lists (guild_id, name, description) VALUES (?, ?, ?)',
            [guildId, name, description]
        );

        return ergebnis.insertId;
    }

    /**
     * @param {string} guildId
     * @param {number} listId
     * @param {{name?: string, description?: string, enabled?: boolean}} felder
     * @returns {Promise<boolean>}
     */
    static async updateList(guildId, listId, felder) {
        const dbService = ServiceManager.get('dbService');

        const teile = [];
        const werte = [];

        if (felder.name !== undefined) { teile.push('name = ?'); werte.push(felder.name); }
        if (felder.description !== undefined) { teile.push('description = ?'); werte.push(felder.description); }
        if (felder.enabled !== undefined) { teile.push('enabled = ?'); werte.push(felder.enabled ? 1 : 0); }

        if (teile.length === 0) return false;

        werte.push(listId, guildId);

        const ergebnis = await dbService.query(
            `UPDATE automod_keyword_lists SET ${teile.join(', ')} WHERE id = ? AND guild_id = ?`,
            werte
        );

        return (ergebnis.affectedRows || 0) > 0;
    }

    /**
     * Liste löschen. Die Einträge gehen über den Fremdschlüssel mit.
     *
     * @param {string} guildId
     * @param {number} listId
     * @returns {Promise<boolean>}
     */
    static async deleteList(guildId, listId) {
        const dbService = ServiceManager.get('dbService');

        const ergebnis = await dbService.query(
            'DELETE FROM automod_keyword_lists WHERE id = ? AND guild_id = ?',
            [listId, guildId]
        );

        return (ergebnis.affectedRows || 0) > 0;
    }

    // ─────────────────────────────────────────────────────────────────────
    // Einträge
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Stichwort hinzufügen.
     *
     * Die Liste wird zuvor gegen die Guild geprüft — ohne das genügte eine
     * fremde Listen-ID, um in die Liste einer anderen Guild zu schreiben.
     *
     * @param {string} guildId
     * @param {number} listId
     * @param {string} keyword
     * @param {string} [matchType]
     * @returns {Promise<boolean>} false, wenn die Liste nicht zur Guild gehört
     */
    static async addKeyword(guildId, listId, keyword, matchType = 'word') {
        const dbService = ServiceManager.get('dbService');

        if (!await this._gehoertZurGuild(guildId, listId)) return false;

        await dbService.query(
            `INSERT INTO automod_keywords (list_id, keyword, match_type)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE match_type = VALUES(match_type)`,
            [listId, String(keyword).trim(), matchType]
        );

        return true;
    }

    /**
     * @param {string} guildId
     * @param {number} keywordId
     * @param {string} matchType
     * @returns {Promise<boolean>}
     */
    static async setMatchType(guildId, keywordId, matchType) {
        const dbService = ServiceManager.get('dbService');

        const ergebnis = await dbService.query(`
            UPDATE automod_keywords k
            JOIN automod_keyword_lists l ON l.id = k.list_id
            SET k.match_type = ?
            WHERE k.id = ? AND l.guild_id = ?
        `, [matchType, keywordId, guildId]);

        return (ergebnis.affectedRows || 0) > 0;
    }

    /**
     * @param {string} guildId
     * @param {number} keywordId
     * @returns {Promise<boolean>}
     */
    static async removeKeyword(guildId, keywordId) {
        const dbService = ServiceManager.get('dbService');

        // Über den Verbund gegen die Guild absichern.
        const ergebnis = await dbService.query(`
            DELETE k FROM automod_keywords k
            JOIN automod_keyword_lists l ON l.id = k.list_id
            WHERE k.id = ? AND l.guild_id = ?
        `, [keywordId, guildId]);

        return (ergebnis.affectedRows || 0) > 0;
    }

    // ─────────────────────────────────────────────────────────────────────
    // Vorlagen
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Vorlagen aus dem Dateiverzeichnis lesen.
     *
     * @returns {Array<{id, name, description, language, keywords: string[]}>}
     */
    static leseVorlagen() {
        if (!fs.existsSync(VORLAGEN_VERZEICHNIS)) return [];

        const vorlagen = [];

        for (const datei of fs.readdirSync(VORLAGEN_VERZEICHNIS).filter(f => f.endsWith('.json'))) {
            try {
                const inhalt = JSON.parse(fs.readFileSync(path.join(VORLAGEN_VERZEICHNIS, datei), 'utf-8'));
                if (inhalt.id && Array.isArray(inhalt.keywords)) vorlagen.push(inhalt);
            } catch {
                // Eine unlesbare Vorlage darf den Rest nicht aufhalten.
            }
        }

        return vorlagen;
    }

    /**
     * Guild aus den Vorlagen befüllen — einmalig.
     *
     * `keyword_lists_seeded_at` verhindert, dass eine Guild, die ihre Listen
     * bewusst gelöscht hat, sie beim nächsten Start zurückbekommt. Ohne diese
     * Marke wäre „alles löschen" keine haltbare Entscheidung.
     *
     * @param {string} guildId
     * @returns {Promise<number>} Anzahl der angelegten Listen (0 = war schon befüllt)
     */
    static async befuelleAusVorlagen(guildId) {
        const dbService = ServiceManager.get('dbService');

        const [zeile] = await dbService.query(
            'SELECT keyword_lists_seeded_at FROM automod_settings WHERE guild_id = ?',
            [guildId]
        ) || [];

        // Keine Einstellungszeile: das Plugin ist für diese Guild noch nicht
        // eingerichtet. Dann gibt es auch nichts zu befüllen.
        if (!zeile) return 0;
        if (zeile.keyword_lists_seeded_at) return 0;

        let angelegt = 0;

        for (const vorlage of this.leseVorlagen()) {
            const ergebnis = await dbService.query(`
                INSERT IGNORE INTO automod_keyword_lists
                    (guild_id, name, description, language, template_id, enabled)
                VALUES (?, ?, ?, ?, ?, 0)
            `, [guildId, vorlage.name, vorlage.description || null, vorlage.language || null, vorlage.id]);

            const listId = ergebnis?.insertId;
            if (!listId) continue;

            for (const wort of vorlage.keywords) {
                await dbService.query(
                    'INSERT IGNORE INTO automod_keywords (list_id, keyword, match_type) VALUES (?, ?, ?)',
                    [listId, String(wort).trim(), 'word']
                );
            }
            angelegt++;
        }

        await dbService.query(
            'UPDATE automod_settings SET keyword_lists_seeded_at = NOW() WHERE guild_id = ?',
            [guildId]
        );

        return angelegt;
    }

    /**
     * Abgleich: Was steht in den Vorlagen, das im eigenen Bestand fehlt?
     *
     * Bewusst **nur in diese Richtung**. Wörter, die eine Guild gelöscht hat,
     * sind eine Entscheidung — sie tauchen hier wieder auf, aber niemand trägt
     * sie ohne Zutun ein. Und Wörter, die eine Guild ergänzt hat, gelten nicht
     * als „Abweichung von der Vorlage", die es zu beheben gäbe.
     *
     * @param {string} guildId
     * @returns {Promise<Array<{template_id, template_name, list_id, list_name, fehlend: string[]}>>}
     */
    static async vergleicheMitVorlage(guildId) {
        const dbService = ServiceManager.get('dbService');

        const eigene = await dbService.query(`
            SELECT l.id, l.name, l.template_id, k.keyword
            FROM automod_keyword_lists l
            LEFT JOIN automod_keywords k ON k.list_id = l.id
            WHERE l.guild_id = ? AND l.template_id IS NOT NULL
        `, [guildId]);

        // Je Vorlage: welche Liste, und welche Wörter stehen schon drin?
        const jeVorlage = new Map();
        for (const zeile of eigene || []) {
            if (!jeVorlage.has(zeile.template_id)) {
                jeVorlage.set(zeile.template_id, { id: zeile.id, name: zeile.name, woerter: new Set() });
            }
            if (zeile.keyword) jeVorlage.get(zeile.template_id).woerter.add(zeile.keyword.toLowerCase());
        }

        const ergebnis = [];

        for (const vorlage of this.leseVorlagen()) {
            const eintrag = jeVorlage.get(vorlage.id);

            // Vorlage, zu der es keine eigene Liste (mehr) gibt: die Guild hat
            // sie gelöscht. Das ist eine Entscheidung, kein Rückstand.
            if (!eintrag) continue;

            const fehlend = vorlage.keywords.filter(w => !eintrag.woerter.has(String(w).toLowerCase()));
            if (fehlend.length === 0) continue;

            ergebnis.push({
                template_id: vorlage.id,
                template_name: vorlage.name,
                list_id: eintrag.id,
                list_name: eintrag.name,
                fehlend
            });
        }

        return ergebnis;
    }

    /**
     * Fehlende Wörter einer Vorlage übernehmen.
     *
     * @param {string} guildId
     * @param {string} templateId
     * @returns {Promise<number>} Anzahl der übernommenen Wörter
     */
    static async uebernehmeAusVorlage(guildId, templateId) {
        const dbService = ServiceManager.get('dbService');

        const offene = await this.vergleicheMitVorlage(guildId);
        const treffer = offene.find(o => o.template_id === templateId);
        if (!treffer) return 0;

        for (const wort of treffer.fehlend) {
            await dbService.query(
                'INSERT IGNORE INTO automod_keywords (list_id, keyword, match_type) VALUES (?, ?, ?)',
                [treffer.list_id, String(wort).trim(), 'word']
            );
        }

        return treffer.fehlend.length;
    }

    /**
     * @param {string} guildId
     * @param {number} listId
     * @returns {Promise<boolean>}
     * @private
     */
    static async _gehoertZurGuild(guildId, listId) {
        const dbService = ServiceManager.get('dbService');

        const [treffer] = await dbService.query(
            'SELECT id FROM automod_keyword_lists WHERE id = ? AND guild_id = ?',
            [listId, guildId]
        ) || [];

        return Boolean(treffer);
    }
}

module.exports = AutoModKeywordLists;
