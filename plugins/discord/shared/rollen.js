'use strict';

/**
 * Rollen, die das discord-Plugin vergibt (G-07, package.json `rollen`): die
 * Rollen aller eingeschalteten Rollenmenüs dieser Guild (Besitzer
 * `discord:rollenmenue`, `bezug` = Menü-ID).
 *
 * @module discord/shared/rollen
 */
module.exports = {
    'discord:rollenmenue': async ({ guildId, db }) => {
        const menues = await db.query('SELECT id FROM discord_role_menus WHERE guild_id = ? AND enabled = 1', [guildId]);
        const ids = (menues || []).map((m) => m.id);
        if (!ids.length) return [];
        const optionen = await db.query(
            `SELECT DISTINCT role_id FROM discord_role_menu_options WHERE menu_id IN (${ids.map(() => '?').join(', ')})`, ids);
        return (optionen || []).map((o) => String(o.role_id));
    },
};
