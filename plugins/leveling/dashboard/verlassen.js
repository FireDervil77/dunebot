'use strict';

/**
 * Leveling: XP von Mitgliedern löschen, die vor der Frist gegangen sind
 * (LV-1i Teil 2, K382, 2026-11-15). Zeitplan `leveling:verlassen`, nachts.
 *
 * Den Vermerk schreibt der Bot (`bot/verlassen.js`) nur, solange die Guild
 * „löschen“ gewählt hat. Hier gilt die Einstellung von jetzt:
 *
 *   löschen, Frist um  → Fortschritt `leveling:community` des Mitglieds
 *                        (Buchungen, Stand, Saisonstand) und seine Zähler
 *                        gehen, dann der Vermerk
 *   behalten           → nur der Vermerk geht (die Guild hat es sich anders
 *                        überlegt)
 *
 * Nachgeholt oder von Hand gestartet tut ein zweiter Lauf nichts mehr.
 *
 * @module leveling/dashboard/verlassen
 */

const { ServiceManager } = require('dunebot-core');
const { Fortschritt } = require('dunebot-sdk');

const TAKT = '40 4 * * *';
/** Höchstens so viele Mitglieder je Nacht; der Rest folgt in der nächsten. */
const HOECHSTENS = 5000;

/**
 * @returns {Promise<{geloescht: number, vermerkeWeg: number, rest: boolean, fehler: number}>}
 */
async function raeumeAuf() {
    const db = ServiceManager.get('dbService');
    const vermerkeWeg = Number((await db.query(
        `DELETE v FROM level_verlassen v LEFT JOIN level_einstellungen e ON e.guild_id = v.guild_id
         WHERE e.guild_id IS NULL OR e.verlassen <> 'loeschen'`))?.affectedRows || 0);
    const faellig = await db.query(
        `SELECT v.guild_id, v.mitglied_id FROM level_verlassen v JOIN level_einstellungen e ON e.guild_id = v.guild_id
         WHERE e.verlassen = 'loeschen' AND v.am <= NOW(3) - INTERVAL e.verlassen_tage DAY
         ORDER BY v.am LIMIT ${HOECHSTENS + 1}`);
    let geloescht = 0;
    let fehler = 0;
    for (const z of faellig.slice(0, HOECHSTENS)) {
        const guildId = String(z.guild_id);
        const mitglied = String(z.mitglied_id);
        try {
            await Fortschritt.entferneMitglied({ guildId, kennung: 'leveling:community', mitglied });
            await db.query('DELETE FROM level_zaehler WHERE guild_id = ? AND mitglied_id = ?', [guildId, mitglied]);
            await db.query('DELETE FROM level_verlassen WHERE guild_id = ? AND mitglied_id = ?', [guildId, mitglied]);
            geloescht++;
        } catch (error) {
            fehler++;
            ServiceManager.get('Logger').error(`[Leveling] XP von ${mitglied} in ${guildId} nach dem Verlassen nicht gelöscht:`, error);
        }
    }
    return { geloescht, vermerkeWeg, rest: faellig.length > HOECHSTENS, fehler };
}

/** Handler im Zeitplan: Ergebnis als Text, Fehler als Wurf. */
async function nachts() {
    const r = await raeumeAuf();
    const text = `${r.geloescht} Mitglied(er) gelöscht, ${r.vermerkeWeg} Vermerk(e) ohne „löschen“ entfernt${r.rest ? ', Rest folgt' : ''}`;
    if (r.fehler) throw new Error(`${r.fehler} Mitglied(er) nicht gelöscht (${text})`);
    return text;
}

module.exports = { raeumeAuf, nachts, TAKT, HOECHSTENS };
