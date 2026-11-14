'use strict';

/**
 * Täglicher Abgleich des Rollenbuchs mit Discord (G-07, F-G12 Punkt 3, 2026-11-14).
 *
 * Das Buch `rollen_vergaben` folgt Discord: Nimmt jemand eine verwaltete Rolle
 * von Hand weg, geht der Eintrag (Kern-Ereignis `guildMemberUpdate` im Bot).
 * War der Bot dabei aus, kam kein Ereignis. Einmal am Tag
 * (`core:rollen-abgleich`, nachgeholt, wenn das Dashboard zum Termin aus war,
 * und unter /admin/zeitplan von Hand) fragt das Dashboard deshalb den Bot
 * (`dashboard:ROLLEN_ABGLEICH`, `apps/bot/ipc/ROLLEN_ABGLEICH.js`). Jeder Shard
 * gleicht seine Guilds ab und löscht dort selbst, nur mit vollständiger
 * Mitgliederliste.
 *
 * Rot unter /admin/zeitplan, wenn kein Bot antwortet oder eine Guild wegen
 * einer halben Mitgliederliste übersprungen wurde.
 *
 * @module apps/dashboard/helpers/RollenAbgleich
 */

const { ServiceManager } = require('dunebot-core');
const Zeitplan = require('./Zeitplan');

/** Täglich 05:20 (nach dem Guild-Abgleich 04:40, nicht zwischen 2 und 3 Uhr). */
const TAKT = '20 5 * * *';
/** Je Guild holt der Bot die Mitgliederliste (15 s Frist), bei vielen Guilds dauert es. */
const FRIST_MS = 10 * 60 * 1000;

const db = () => ServiceManager.get('dbService');

/**
 * @returns {Promise<string>} Bericht für den Zeitplan. Wirft bei halber Auskunft.
 */
async function abgleichen() {
    const guildIds = ((await db().query('SELECT DISTINCT guild_id FROM rollen_vergaben')) || []).map((z) => String(z.guild_id));
    if (!guildIds.length) return 'kein Eintrag im Buch';

    const antworten = await ServiceManager.get('ipcServer').broadcast(
        'dashboard:ROLLEN_ABGLEICH', { guildIds }, true, { timeout: FRIST_MS });
    const innen = (antworten || []).map((h) => h?.data ?? h).filter((a) => a?.success);
    if (!innen.length) throw new Error(`Kein Bot hat geantwortet (${guildIds.length} Guild(s) mit Einträgen, nichts abgeglichen)`);

    const summe = { guilds: 0, geloescht: 0, uebersprungen: [] };
    for (const a of innen) {
        summe.guilds += a.guilds || 0;
        summe.geloescht += a.geloescht || 0;
        summe.uebersprungen.push(...(a.uebersprungen || []));
    }
    const ohne = guildIds.length - summe.guilds;
    const text = `${summe.guilds} von ${guildIds.length} Guild(s) abgeglichen, ${summe.geloescht} Eintrag/Einträge gelöscht` +
        (ohne > 0 ? `, ${ohne} ohne Bot (bleiben bis die Guild gelöscht wird)` : '');
    if (summe.uebersprungen.length) {
        const liste = summe.uebersprungen.map((u) => `${u.guildId}: ${u.grund}`).join('; ');
        throw new Error(`${text}; übersprungen wegen halber Mitgliederliste: ${liste}`);
    }
    return text;
}

function starten() {
    Zeitplan.eintragen('core:rollen-abgleich', TAKT, abgleichen);
}

module.exports = { starten, abgleichen, TAKT };
