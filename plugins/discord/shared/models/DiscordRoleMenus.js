'use strict';

const { ServiceManager } = require('dunebot-core');

/**
 * Rollenmenüs: Mitglieder vergeben sich Rollen selbst.
 *
 * Jede Abfrage nimmt die `guildId` mit, auch dort, wo die Menü-ID allein
 * eindeutig wäre. Ohne das genügt eine fremde ID aus der Adresszeile, um an den
 * Bestand einer anderen Guild zu kommen — dieselbe Vorsichtsmassnahme wie bei
 * den Stichwortlisten in `automod`.
 *
 * @author FireBot Team
 */
class DiscordRoleMenus {

    // ─────────────────────────────────────────────────────────────────────
    // Menüs
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Alle Menüs einer Guild, mit der Anzahl ihrer Einträge.
     *
     * @param {string} guildId
     * @returns {Promise<Array>}
     */
    static async getMenus(guildId) {
        const dbService = ServiceManager.get('dbService');

        return await dbService.query(`
            SELECT m.*, COUNT(o.id) AS option_count
            FROM discord_role_menus m
            LEFT JOIN discord_role_menu_options o ON o.menu_id = m.id
            WHERE m.guild_id = ?
            GROUP BY m.id
            ORDER BY m.created_at DESC
        `, [guildId]);
    }

    /**
     * Ein Menü samt Einträgen, in Anzeigereihenfolge.
     *
     * @param {string} guildId
     * @param {number} menuId
     * @returns {Promise<Object|null>}
     */
    static async getMenu(guildId, menuId) {
        const dbService = ServiceManager.get('dbService');

        const [menu] = await dbService.query(
            'SELECT * FROM discord_role_menus WHERE guild_id = ? AND id = ?',
            [guildId, menuId]
        ) || [];

        if (!menu) return null;

        menu.optionen = await dbService.query(
            'SELECT * FROM discord_role_menu_options WHERE menu_id = ? ORDER BY position, id',
            [menuId]
        ) || [];

        return menu;
    }

    /**
     * Das Menü zu einer Discord-Nachricht — der Weg, den der Bot geht.
     *
     * @param {string} guildId
     * @param {string} messageId
     * @returns {Promise<Object|null>}
     */
    static async getMenuByMessage(guildId, messageId) {
        const dbService = ServiceManager.get('dbService');

        const [menu] = await dbService.query(
            'SELECT * FROM discord_role_menus WHERE guild_id = ? AND message_id = ? AND enabled = 1',
            [guildId, messageId]
        ) || [];

        if (!menu) return null;

        menu.optionen = await dbService.query(
            'SELECT * FROM discord_role_menu_options WHERE menu_id = ? ORDER BY position, id',
            [menu.id]
        ) || [];

        return menu;
    }

    /**
     * @param {string} guildId
     * @param {Object} felder
     * @returns {Promise<number>} Die neue Menü-ID
     */
    static async createMenu(guildId, felder) {
        const dbService = ServiceManager.get('dbService');

        const ergebnis = await dbService.query(`
            INSERT INTO discord_role_menus
                (guild_id, channel_id, title, description, color, darstellung, modus, min_auswahl, max_auswahl)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            guildId,
            felder.channel_id || null,
            felder.title || 'Rollen',
            felder.description || null,
            felder.color || '#5865F2',
            felder.darstellung || 'knopf',
            felder.modus || 'normal',
            Number.isInteger(felder.min_auswahl) ? felder.min_auswahl : 0,
            Number.isInteger(felder.max_auswahl) ? felder.max_auswahl : 25
        ]);

        return ergebnis.insertId;
    }

    /**
     * Ein Menü ändern.
     *
     * Nur die übergebenen Felder werden angefasst — wer nur den Titel ändert,
     * soll nicht versehentlich die Darstellung zurücksetzen.
     *
     * @param {string} guildId
     * @param {number} menuId
     * @param {Object} felder
     * @returns {Promise<boolean>} ob eine Zeile getroffen wurde
     */
    static async updateMenu(guildId, menuId, felder) {
        const dbService = ServiceManager.get('dbService');

        const erlaubt = ['channel_id', 'message_id', 'title', 'description', 'color',
                         'darstellung', 'modus', 'min_auswahl', 'max_auswahl', 'enabled'];
        const teile = [];
        const werte = [];

        for (const feld of erlaubt) {
            if (felder[feld] === undefined) continue;
            teile.push(`${feld} = ?`);
            werte.push(typeof felder[feld] === 'boolean' ? (felder[feld] ? 1 : 0) : felder[feld]);
        }

        if (teile.length === 0) return false;

        werte.push(guildId, menuId);
        const ergebnis = await dbService.query(
            `UPDATE discord_role_menus SET ${teile.join(', ')} WHERE guild_id = ? AND id = ?`,
            werte
        );

        return (ergebnis?.affectedRows || 0) > 0;
    }

    /**
     * @param {string} guildId
     * @param {number} menuId
     * @returns {Promise<boolean>}
     */
    static async deleteMenu(guildId, menuId) {
        const dbService = ServiceManager.get('dbService');

        const ergebnis = await dbService.query(
            'DELETE FROM discord_role_menus WHERE guild_id = ? AND id = ?',
            [guildId, menuId]
        );

        return (ergebnis?.affectedRows || 0) > 0;
    }

    // ─────────────────────────────────────────────────────────────────────
    // Einträge
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Einen Eintrag anlegen.
     *
     * Die Guild wird über das Menü mitgeprüft, deshalb der Umweg über
     * `getMenu` statt eines direkten INSERT.
     *
     * @param {string} guildId
     * @param {number} menuId
     * @param {Object} felder
     * @returns {Promise<number|null>} Die neue Eintrags-ID, oder null wenn es das Menü nicht gibt
     */
    static async addOption(guildId, menuId, felder) {
        const dbService = ServiceManager.get('dbService');

        const [menu] = await dbService.query(
            'SELECT id FROM discord_role_menus WHERE guild_id = ? AND id = ?',
            [guildId, menuId]
        ) || [];
        if (!menu) return null;

        // Ans Ende einsortieren. `MAX(position) + 1` statt `COUNT(*)`, damit
        // Löcher nach dem Löschen keine doppelten Positionen erzeugen.
        const [letzte] = await dbService.query(
            'SELECT COALESCE(MAX(position), -1) AS p FROM discord_role_menu_options WHERE menu_id = ?',
            [menuId]
        ) || [];

        const ergebnis = await dbService.query(`
            INSERT INTO discord_role_menu_options
                (menu_id, role_id, emoji, label, description, stil, position)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
            menuId,
            String(felder.role_id),
            felder.emoji || null,
            felder.label || null,
            felder.description || null,
            felder.stil || 'grau',
            (letzte?.p ?? -1) + 1
        ]);

        return ergebnis.insertId;
    }

    /**
     * @param {string} guildId
     * @param {number} optionId
     * @returns {Promise<boolean>}
     */
    static async removeOption(guildId, optionId) {
        const dbService = ServiceManager.get('dbService');

        const ergebnis = await dbService.query(`
            DELETE o FROM discord_role_menu_options o
            INNER JOIN discord_role_menus m ON m.id = o.menu_id
            WHERE m.guild_id = ? AND o.id = ?
        `, [guildId, optionId]);

        return (ergebnis?.affectedRows || 0) > 0;
    }

    /**
     * Reihenfolge setzen.
     *
     * @param {string} guildId
     * @param {number} menuId
     * @param {number[]} reihenfolge Eintrags-IDs in gewünschter Folge
     * @returns {Promise<number>} Anzahl der geänderten Einträge
     */
    static async setOptionOrder(guildId, menuId, reihenfolge) {
        const dbService = ServiceManager.get('dbService');

        const [menu] = await dbService.query(
            'SELECT id FROM discord_role_menus WHERE guild_id = ? AND id = ?',
            [guildId, menuId]
        ) || [];
        if (!menu) return 0;

        let geaendert = 0;
        for (let i = 0; i < reihenfolge.length; i++) {
            const ergebnis = await dbService.query(
                'UPDATE discord_role_menu_options SET position = ? WHERE id = ? AND menu_id = ?',
                [i, Number(reihenfolge[i]), menuId]
            );
            geaendert += ergebnis?.affectedRows || 0;
        }

        return geaendert;
    }
}

module.exports = DiscordRoleMenus;
