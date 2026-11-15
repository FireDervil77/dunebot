'use strict';

/**
 * Leveling: Sprach-XP im Bot (LV-1d, 2026-11-15).
 *
 * Einmal je Minute über die Sprachkanäle der Guilds dieses Bots, in denen
 * Leveling an ist (`guild_plugins`). Je Kanal:
 *
 *   - kein XP im AFK-Kanal der Guild
 *   - mindestens `sprache_min_menschen` (Vorgabe 2) **zuhörende** Menschen im
 *     Kanal: Bots zählen nicht, taub Geschaltete auch nicht. Wer allein mit
 *     einem tauben Zweitkonto sitzt, ist allein.
 *   - wer selbst taub ist (selbst oder vom Server), bekommt nichts
 *   - wer stumm ist (selbst, vom Server, oder auf einer Bühne ohne
 *     Rederecht), bekommt nur, wenn `sprache_stumm_zaehlt` an ist (Vorgabe an)
 *   - Kanal- und Rollenregeln wie bei Nachrichten, Quelle `sprache`
 *
 * Wer das erfüllt, bekommt eine Sprachminute im Zähler und, je Takt der
 * Quelle (`taktung_s`, Vorgabe 60 s, mindestens eine Minute), XP von…bis ×
 * Faktor. Buchung `voice:<mitglied>:<minute>`, Minute seit 1970 am Beginn
 * des Takts. Startet der Bot neu, ist der Schlüssel derselbe: Doppelt bucht
 * nichts, verloren geht höchstens die laufende Minute.
 *
 * @module leveling/bot/sprachxp
 */

const { ServiceManager } = require('dunebot-core');
const { Fortschritt } = require('dunebot-sdk');
const Regeln = require('../shared/regeln');
const zaehler = require('./zaehler');
const { nachBuchung } = require('./nachbuchung');

const MINUTE_MS = 60_000;
const log = () => ServiceManager.get('Logger');

/** `${guild}|${mitglied}` → zuletzt gebuchter Takt (Index). Nur gegen doppelte Abfragen. */
const letzterTakt = new Map();
/** `${guild}|${mitglied}` → zuletzt gezählte Minute: Zwei Takte in einer Minute zählen einmal. */
const gezaehlt = new Map();
let laeuft = false;
let fehlerGemeldetUm = 0;

/**
 * Wer in diesen Kanälen bekommt jetzt Sprach-XP? Reine Entscheidung.
 *
 * @param {Array<{id: string, parentId: string|null, mitglieder: Array<{id, bot, taub, stumm, rollen}>}>} kanaele
 * @param {{afkKanal: string|null, minMenschen: number, stummZaehlt: boolean}} e
 * @returns {Array<{mitglied: string, kanal: string, kette: string[], rollen: string[], grund: string|null}>}
 */
function kandidaten(kanaele, { afkKanal = null, minMenschen = 2, stummZaehlt = true } = {}) {
    const aus = [];
    for (const k of kanaele || []) {
        const menschen = (k.mitglieder || []).filter((m) => !m.bot);
        const zuhoerend = menschen.filter((m) => !m.taub).length;
        const kette = [String(k.id), ...(k.parentId ? [String(k.parentId)] : [])];
        for (const m of menschen) {
            let grund = null;
            if (afkKanal && String(k.id) === String(afkKanal)) grund = 'afk';
            else if (m.taub) grund = 'taub';
            else if (zuhoerend < Math.max(1, Number(minMenschen) || 0)) grund = 'zu_wenige';
            else if (m.stumm && !stummZaehlt) grund = 'stumm';
            aus.push({ mitglied: String(m.id), kanal: String(k.id), kette, rollen: (m.rollen || []).map(String), grund });
        }
    }
    return aus;
}

/**
 * Sprachkanäle einer Guild aus dem Zwischenspeicher des Bots
 * (`GuildVoiceStates`), in der Form für `kandidaten`.
 *
 * @param {import('discord.js').Guild} guild
 */
function kanaeleAus(guild) {
    const je = new Map();
    for (const vs of guild.voiceStates?.cache?.values?.() || []) {
        if (!vs.channelId) continue;
        if (!je.has(vs.channelId)) je.set(vs.channelId, { id: vs.channelId, parentId: vs.channel?.parentId || null, mitglieder: [] });
        const member = vs.member;
        je.get(vs.channelId).mitglieder.push({
            id: vs.id,
            bot: Boolean(member?.user?.bot),
            taub: Boolean(vs.selfDeaf || vs.serverDeaf),
            stumm: Boolean(vs.selfMute || vs.serverMute || vs.suppress),
            rollen: member?.roles?.cache ? [...member.roles.cache.keys()] : [],
        });
    }
    return [...je.values()];
}

/** Guilds, in denen Leveling an ist. */
async function aktiveGuilds(db) {
    const zeilen = await db.query("SELECT guild_id FROM guild_plugins WHERE plugin_name = 'leveling' AND is_enabled = 1");
    return (zeilen || []).map((z) => String(z.guild_id));
}

/**
 * Eine Guild abarbeiten.
 *
 * @param {import('discord.js').Guild} guild
 * @param {number} jetzt ms
 * @returns {Promise<{gebucht: number, minuten: number}>}
 */
async function guildTakt(guild, jetzt) {
    const guildId = String(guild.id);
    const r = await Regeln.lade(guildId);
    const q = r?.quellen?.sprache;
    const aus = { gebucht: 0, minuten: 0 };
    if (!r || !q || !q.aktiv) return aus;
    const e = r.einstellungen;
    const liste = kandidaten(kanaeleAus(guild), {
        afkKanal: guild.afkChannelId || null,
        minMenschen: Number(e.sprache_min_menschen),
        stummZaehlt: Boolean(Number(e.sprache_stumm_zaehlt)),
    });
    const taktMs = Math.max(MINUTE_MS, (Number(q.taktung_s) || 60) * 1000);
    const takt = Math.floor(jetzt / taktMs);
    const minute = Math.floor((takt * taktMs) / MINUTE_MS);

    for (const k of liste) {
        if (k.grund) continue;
        const urteil = Regeln.pruefeRegeln(r.regeln, 'sprache', k.kette, k.rollen);
        if (!urteil.erlaubt) continue;
        const merk = `${guildId}|${k.mitglied}`;
        const jetztMinute = Math.floor(jetzt / MINUTE_MS);
        if (gezaehlt.get(merk) !== jetztMinute) {
            gezaehlt.set(merk, jetztMinute);
            zaehler.sprachminute(guildId, k.mitglied);
            aus.minuten++;
        }
        if (letzterTakt.get(merk) === takt) continue;
        const xp = Regeln.menge(q.xp_von, q.xp_bis, urteil.faktor);
        if (xp <= 0) continue;
        let ergebnis;
        try {
            ergebnis = await Fortschritt.buche({
                guildId, kennung: 'leveling:community', mitglied: k.mitglied, menge: xp, quelle: 'sprache', schluessel: `voice:${k.mitglied}:${minute}`,
            });
        } catch (error) {
            meldeFehler(error);
            continue;
        }
        letzterTakt.set(merk, takt);
        if (ergebnis.neu) aus.gebucht++;
        await nachBuchung({ guildId, mitglied: k.mitglied, ergebnis, guild });
    }
    return aus;
}

function meldeFehler(error) {
    const jetzt = Date.now();
    if (jetzt - fehlerGemeldetUm < MINUTE_MS) return;
    fehlerGemeldetUm = jetzt;
    log().error('[Leveling] Buchen der Sprach-XP gescheitert:', error);
}

/**
 * Einmal je Minute (bot/index.js). Läuft der vorige Takt noch, fällt dieser
 * aus; die nächste Minute holt nichts nach.
 *
 * @param {{client?: import('discord.js').Client, jetzt?: number, db?: object}} [o]
 */
async function takt({ client = null, jetzt = Date.now(), db = null } = {}) {
    if (laeuft) return { uebersprungen: true };
    laeuft = true;
    try {
        const sm = ServiceManager;
        const c = client || (sm.has('client') ? sm.get('client') : null);
        if (!c) return { gebucht: 0, minuten: 0 };
        const aus = { gebucht: 0, minuten: 0 };
        for (const guildId of await aktiveGuilds(db || sm.get('dbService'))) {
            const guild = c.guilds.cache.get(guildId);
            if (!guild) continue; // anderer Shard oder nicht mehr dort
            const g = await guildTakt(guild, jetzt);
            aus.gebucht += g.gebucht;
            aus.minuten += g.minuten;
        }
        // Das Gedächtnis spart nur Abfragen; vor Doppeltem schützt der
        // Schlüssel. Wird es groß, fängt es leer neu an.
        if (letzterTakt.size > 10_000) letzterTakt.clear();
        if (gezaehlt.size > 10_000) gezaehlt.clear();
        return aus;
    } finally {
        laeuft = false;
    }
}

module.exports = { kandidaten, kanaeleAus, guildTakt, takt, _letzterTakt: letzterTakt, _gezaehlt: gezaehlt };
