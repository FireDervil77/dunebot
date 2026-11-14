'use strict';

/**
 * Rollen, die greeting vergibt (G-07, package.json `rollen`): je Besitzer die
 * Rollen aus `greeting_settings` dieser Guild. Der Kern zeigt damit auf der
 * Seite „Rollenvergabe“ und am Rollenfeld, wer welche Rolle verwaltet.
 *
 * Besitzer:
 *   greeting:autorolle       Autorollen beim Beitritt (`autorole_ids`, früher `autorole_id`)
 *   greeting:verifiziert     Rolle nach der Verifizierung (`verification_role_id`)
 *   greeting:unverifiziert   Rolle bis zur Verifizierung (`verification_remove_role_id`)
 *
 * Die Verifizierung zählt nur, wenn sie eingeschaltet ist; so vergibt der Bot.
 *
 * @module greeting/shared/rollen
 */

async function einstellung(db, guildId) {
    const zeilen = await db.query(
        'SELECT autorole_id, autorole_ids, verification_enabled, verification_role_id, verification_remove_role_id FROM greeting_settings WHERE guild_id = ?',
        [guildId]);
    return zeilen?.[0] || null;
}

/** Autorollen wie `bot/events/guildMemberAdd.js` sie liest. */
function autorollen(s) {
    if (!s) return [];
    let liste = [];
    if (s.autorole_ids) {
        try { liste = typeof s.autorole_ids === 'string' ? JSON.parse(s.autorole_ids) : s.autorole_ids; } catch { liste = []; }
    }
    if (!Array.isArray(liste)) liste = [];
    if (!liste.length && s.autorole_id) liste = [s.autorole_id];
    return liste.map(String);
}

module.exports = {
    autorollen,
    'greeting:autorolle': async ({ guildId, db }) => autorollen(await einstellung(db, guildId)),
    'greeting:verifiziert': async ({ guildId, db }) => {
        const s = await einstellung(db, guildId);
        return s?.verification_enabled && s.verification_role_id ? [String(s.verification_role_id)] : [];
    },
    'greeting:unverifiziert': async ({ guildId, db }) => {
        const s = await einstellung(db, guildId);
        return s?.verification_enabled && s.verification_remove_role_id ? [String(s.verification_remove_role_id)] : [];
    },
};
