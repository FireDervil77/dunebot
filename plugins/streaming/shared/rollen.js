'use strict';

/**
 * Rollen, die streaming vergibt (G-07, package.json `rollen`): je Besitzer
 * die Rollen, die diese Guild eingestellt hat. Der Kern zeigt damit auf der
 * Seite „Rollenvergabe“ und am Rollenfeld, wer welche Rolle verwaltet.
 *
 * @module streaming/shared/rollen
 */

async function konfig(db, schluessel, guildId) {
    const wert = await db.getConfig('streaming', schluessel, 'shared', guildId);
    return typeof wert === 'string' && wert.trim() ? [wert.trim()] : [];
}

module.exports = {
    /** Live-Rolle der Guild (`LIVE_ROLLE_ID`). */
    'streaming:live': ({ guildId, db }) => konfig(db, 'LIVE_ROLLE_ID', guildId),

    /** Abo-Rolle: Vorgabe der Guild (`ABO_ROLLE_ID`) und eigene Rollen der Ziele. */
    'streaming:abo': async ({ guildId, db }) => {
        const ziele = await db.query(
            "SELECT DISTINCT abo_rolle_id FROM streaming_targets WHERE guild_id = ? AND abo_rolle_id IS NOT NULL AND abo_rolle_id <> ''",
            [guildId]);
        return [...await konfig(db, 'ABO_ROLLE_ID', guildId), ...(ziele || []).map((z) => String(z.abo_rolle_id).trim())];
    },
};
