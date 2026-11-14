'use strict';

/**
 * Abgleich der Guilds mit Discord (K383, 2026-11-14).
 *
 * Wird der Bot hinausgeworfen, während er aus ist, kommt nie ein
 * `guildDelete`. Die Guild behielte `left_at = NULL` und mit ihr alle Daten,
 * für immer. Gemessen am 2026-11-14: eine solche Guild („Test“, zuletzt
 * gesehen 2025-10-06).
 *
 * Einmal am Tag (`core:guild-abgleich`, nachgeholt, wenn das Dashboard zum
 * Termin aus war, und unter /admin/zeitplan von Hand) fragt das Dashboard den
 * Bot (`dashboard:GUILDS_ABGLEICH`, `apps/bot/ipc/GUILDS_ABGLEICH.js`). Der
 * fragt Discord per REST, nicht seinen Cache: Unter dem `ShardingManager`
 * kennt jeder Shard nur seine eigenen Guilds. Fehlt eine Guild in der Liste
 * von Discord, fragt der Bot sie einzeln nach; nur eine ausdrückliche Absage
 * (10004, 50001) zählt als „weg“.
 *
 * Für jede Guild, die weg ist, setzt der Abgleich `left_at`, wie es der Bot
 * bei `guildDelete` tut, und weckt `VerlasseneGuilds`. Gelöscht wird dort,
 * über denselben Weg wie sonst (G-04d).
 *
 * # Schranken
 *
 * Ein Fehler hier löscht Guilds samt Gameservern. Deshalb wird nichts
 * markiert, wenn
 *
 * - der Bot nicht dieselbe Anwendung ist wie `CLIENT_ID` des Dashboards
 *   (falscher Token: lauter fremde Guilds),
 * - die Kontroll-Guild in der Liste von Discord fehlt,
 * - Discord gar keine Guild meldet.
 *
 * Und je Lauf werden höchstens `HOECHSTENS` Guilds markiert. Findet ein Lauf
 * mehr, markiert er die ältesten (nach `updated_at`, das `syncGuild` bei jedem
 * Bot-Start erneuert) und steht unter /admin/zeitplan rot. Die übrigen kommen
 * am nächsten Tag. So bleibt Zeit, einen Fehler zu bemerken, bevor er viele
 * Guilds trifft.
 *
 * # Was es nicht kann
 *
 * Betritt der Bot eine Guild genau zwischen der Antwort von Discord und dem
 * Markieren wieder, wird sie trotzdem markiert und gelöscht. Das Fenster ist
 * eine IPC-Antwort lang. Der nächste Start des Bots legt sie über `syncGuild`
 * wieder an, leer.
 *
 * @module apps/dashboard/helpers/GuildAbgleich
 */

const { ServiceManager } = require('dunebot-core');
const Zeitplan = require('./Zeitplan');
const VerlasseneGuilds = require('./VerlasseneGuilds');

/** Täglich 04:40 (nicht zwischen 2 und 3 Uhr, Zeitumstellung). */
const TAKT = '40 4 * * *';
/** Höchstens so viele Guilds je Lauf markieren. */
const HOECHSTENS = 3;
/** Frist für die Antwort des Bots: Listenseiten und Einzelabfragen über REST. */
const FRIST_MS = 60 * 1000;

const db = () => ServiceManager.get('dbService');
const log = () => ServiceManager.get('Logger');

/**
 * Ein Abgleich.
 *
 * @param {{trocken?: boolean}} [optionen] trocken: nichts markieren, nur sagen, was markiert würde
 * @returns {Promise<{geprueft: number, discord: number, weg: {_id: string, guild_name: string|null}[],
 *          markiert: {_id: string, guild_name: string|null}[], wartet: number, drin: string[],
 *          unklar: {id: string, fehler: string}[]}>}
 *          Wirft, wenn eine Schranke greift oder der Bot nicht antwortet.
 */
async function abgleichen({ trocken = false } = {}) {
    const offen = await db().query(
        'SELECT _id, guild_name FROM guilds WHERE left_at IS NULL ORDER BY updated_at, _id');
    const nachId = new Map(offen.map(g => [String(g._id), g]));

    const huelle = await ServiceManager.get('ipcServer').broadcastOne(
        'dashboard:GUILDS_ABGLEICH', { guildIds: [...nachId.keys()] }, true, { timeout: FRIST_MS });
    if (!huelle?.success) throw new Error(`Bot hat nicht geantwortet: ${huelle?.error || 'keine Antwort'}`);
    const a = huelle.data;
    if (!a || !Array.isArray(a.weg) || !Array.isArray(a.unklar) || !Array.isArray(a.drin)) {
        throw new Error('Antwort des Bots unvollständig');
    }

    const clientId = String(process.env.CLIENT_ID || '');
    if (!clientId) throw new Error('CLIENT_ID fehlt in der Umgebung des Dashboards, ohne sie wird nichts markiert');
    if (String(a.botId) !== clientId) {
        throw new Error(`Der Bot ist eine andere Anwendung (${a.botId || '?'}) als CLIENT_ID (${clientId}). Nichts markiert`);
    }
    if (!(a.discord > 0)) throw new Error('Discord meldet keine einzige Guild. Nichts markiert');
    if (!a.kontrollGuild) throw new Error('Die Kontroll-Guild fehlt in der Liste von Discord. Nichts markiert');

    const kontroll = String(process.env.CONTROL_GUILD_ID || '');
    // Reihenfolge wie in `offen`: die am längsten nicht gesehenen zuerst.
    const wegIds = new Set(a.weg.map(String));
    const weg = offen.filter(g => wegIds.has(String(g._id)) && String(g._id) !== kontroll);
    const dran = weg.slice(0, HOECHSTENS);
    const markiert = [];
    if (!trocken) {
        for (const g of dran) {
            const erg = await db().query(
                'UPDATE guilds SET left_at = NOW(), updated_at = NOW() WHERE _id = ? AND left_at IS NULL', [g._id]);
            if (erg?.affectedRows) markiert.push(g);
        }
    }
    return {
        geprueft: offen.length,
        discord: a.discord,
        weg,
        markiert: trocken ? dran : markiert,
        wartet: weg.length - dran.length,
        drin: a.drin.map(String),
        unklar: a.unklar,
    };
}

const name = (g) => `„${g.guild_name || '?'}“ (${g._id})`;

/**
 * Der tägliche Lauf im Zeitplan. Markiert, weckt das Löschen und schreibt
 * je Guild eine Zeile ins Log (`[Abgleich]`).
 *
 * @returns {Promise<string>}
 */
async function taeglich() {
    const e = await abgleichen();
    for (const g of e.markiert) {
        log().warn(`[Abgleich] Guild ${name(g)}: Der Bot ist laut Discord nicht mehr dort (kein guildDelete gesehen). ` +
            'Als verlassen markiert, das Dashboard löscht jetzt ([Verlassen])');
    }
    for (const u of e.unklar) log().warn(`[Abgleich] Guild ${u.id}: Discord gab keine klare Antwort (${u.fehler}), bleibt`);
    if (e.markiert.length) VerlasseneGuilds.wecken();

    const text = `${e.geprueft} geprüft, Discord kennt ${e.discord}, verlassen ${e.weg.length}, markiert ${e.markiert.length}` +
        (e.unklar.length ? `, unklar ${e.unklar.length}` : '');
    if (e.wartet) {
        const rest = e.weg.slice(e.markiert.length).map(name).join(', ');
        log().error(`[Abgleich] ${e.wartet} weitere Guild(s) sind laut Discord verlassen und warten auf den nächsten Lauf: ${rest}`);
        throw new Error(`${text}; ${e.wartet} weitere warten (höchstens ${HOECHSTENS} je Lauf), Liste im Log unter [Abgleich]`);
    }
    return text;
}

/** Nach dem Zeitplan und `VerlasseneGuilds` eintragen. */
function starten() {
    Zeitplan.eintragen('core:guild-abgleich', TAKT, taeglich);
}

module.exports = { starten, abgleichen, taeglich, TAKT, HOECHSTENS };
