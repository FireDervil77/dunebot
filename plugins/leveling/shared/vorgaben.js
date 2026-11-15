'use strict';

/**
 * Leveling: Kennung und Startwerte (LV-1a, 2026-11-15).
 *
 * Die Startwerte der Quellen spielt das Dashboard beim Einschalten je Guild
 * ein (`dashboard/index.js` → `onGuildEnable`). Danach gilt, was in
 * `level_quellen` steht; im Code ist nichts fest (F-CL8). Die übrigen
 * Startwerte stehen als Spaltenvorgaben in der Migration.
 *
 * @module leveling/shared/vorgaben
 */

/** Der eine Fortschritt des Plugins (G-20, F-G8). */
const KENNUNG = 'leveling:community';

/**
 * Startwerte je Quelle: XP von/bis je Vergabe, Taktung in Sekunden.
 * 15–25 XP je Minute ist der verbreitete Satz, passend zur Schablone
 * „ansteigend“ (Stufe 1 nach etwa fünf Minuten Schreiben).
 */
const QUELLEN = Object.freeze({
    nachricht: Object.freeze({ xp_von: 15, xp_bis: 25, taktung_s: 60, aktiv: 1 }),
    sprache: Object.freeze({ xp_von: 10, xp_bis: 10, taktung_s: 60, aktiv: 1 }),
});

/**
 * Startwerte einer Guild einspielen, nur was fehlt: Einstellungen mit den
 * Spaltenvorgaben der Migration, Quellen mit `QUELLEN`. Was die Guild
 * eingestellt hat, bleibt.
 *
 * @param {{query: Function}} db
 * @param {string} guildId
 */
async function spieleStartwerteEin(db, guildId) {
    await db.query('INSERT IGNORE INTO level_einstellungen (guild_id) VALUES (?)', [guildId]);
    for (const [quelle, v] of Object.entries(QUELLEN)) {
        await db.query(
            'INSERT IGNORE INTO level_quellen (guild_id, quelle, xp_von, xp_bis, taktung_s, aktiv) VALUES (?, ?, ?, ?, ?, ?)',
            [guildId, quelle, v.xp_von, v.xp_bis, v.taktung_s, v.aktiv]
        );
    }
}

module.exports = { KENNUNG, QUELLEN, spieleStartwerteEin };
