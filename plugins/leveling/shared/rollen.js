'use strict';

/**
 * Rollen, die Leveling vergibt (G-07, package.json `rollen`, LV-1e).
 *
 *   leveling:community  Belohnungsrollen je Stufe (`level_belohnungen`, Art
 *                       `rolle_geben`). `bezug` im Buch = `stufe:<n>`.
 *
 * @module leveling/shared/rollen
 */
module.exports = {
    'leveling:community': async ({ guildId, db }) => {
        const zeilen = await db.query(
            "SELECT DISTINCT wert FROM level_belohnungen WHERE guild_id = ? AND art = 'rolle_geben'", [guildId]);
        return (zeilen || []).map((z) => String(z.wert));
    },
};
