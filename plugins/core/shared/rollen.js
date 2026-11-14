'use strict';

/**
 * Rollen, die der Kern vergibt (G-07, package.json `rollen`).
 *
 *   kern:unterstuetzer  kosmetische Unterstützerrollen (`apps/bot/ipc/SET_SUPPORTER_ROLE.js`).
 *                       Keine Einstellung: Der Bot legt sie selbst an und findet
 *                       sie am Namen. Als „eingestellt“ gilt, was er in dieser
 *                       Guild schon vergeben hat (das Buch).
 *
 * @module core/shared/rollen
 */
module.exports = {
    'kern:unterstuetzer': async ({ guildId, db }) => {
        const zeilen = await db.query(
            "SELECT DISTINCT rolle_id FROM rollen_vergaben WHERE guild_id = ? AND besitzer = 'kern:unterstuetzer'", [guildId]);
        return (zeilen || []).map((z) => String(z.rolle_id));
    },
};
