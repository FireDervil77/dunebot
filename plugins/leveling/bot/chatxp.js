'use strict';

/**
 * Leveling: Chat-XP im Bot (LV-1b, LV-1c, 2026-11-15).
 *
 * Je Nachricht eines Menschen in einer Guild mit Leveling:
 *   1. Quelle `nachricht` an? Einstellungen der Guild da (sonst nichts)?
 *   2. Kanal- und Rollenregeln (`shared/regeln.pruefeRegeln`) → Faktor.
 *   3. Zähler „Nachrichten“ +1 (auch in der Taktung, ohne Inhalt).
 *   4. Mindestlänge, Taktung je Mitglied, gleicher Text im Fenster.
 *   5. Buchung über den Kern (G-20) mit Schlüssel `msg:<nachricht>`.
 *   6. Neue Stufe → `leveling.level.erreicht` (das meldet das Plugin selbst).
 *
 * Zurückgenommen wird eine Buchung, wenn die Nachricht binnen
 * `storno_loeschen_min` Minuten gelöscht wird (hier) oder automod sie
 * beanstandet (`automod.verstoss`, Hörer im Dashboard).
 *
 * @module leveling/bot/chatxp
 */

const { ServiceManager } = require('dunebot-core');
const { Fortschritt, Ereignisse } = require('dunebot-sdk');
const { SnowflakeUtil } = require('discord.js');
const Regeln = require('../shared/regeln');
const { KENNUNG } = require('../shared/vorgaben');
const zaehler = require('./zaehler');

const drossel = new Regeln.Drossel();
const MINUTE_MS = 60_000;
let fehlerGemeldetUm = 0;

const log = () => ServiceManager.get('Logger');

/** Fehler beim Buchen: einmal je Minute ins Log, nicht je Nachricht. */
function meldeFehler(was, error) {
    const jetzt = Date.now();
    if (jetzt - fehlerGemeldetUm < MINUTE_MS) return;
    fehlerGemeldetUm = jetzt;
    log().error(`[Leveling] ${was}:`, error);
}

/**
 * @param {import('discord.js').Message} message
 * @returns {Promise<{gebucht: boolean, grund?: string, ergebnis?: object}>}
 */
async function beiNachricht(message) {
    if (!message?.guildId || message.system || message.webhookId || message.author?.bot) return { gebucht: false, grund: 'kein_mensch' };
    const guildId = String(message.guildId);
    const mitglied = String(message.author.id);

    const r = await Regeln.lade(guildId);
    if (!r) return { gebucht: false, grund: 'nicht_eingerichtet' };
    const q = r.quellen.nachricht;
    if (!q || !q.aktiv) return { gebucht: false, grund: 'quelle_aus' };

    const rollen = message.member?.roles?.cache ? [...message.member.roles.cache.keys()] : [];
    const urteil = Regeln.pruefeRegeln(r.regeln, 'nachricht', Regeln.kanalKette(message), rollen);
    if (!urteil.erlaubt) return { gebucht: false, grund: urteil.grund };

    zaehler.nachricht(guildId, mitglied);

    const text = Regeln.normalisiere(message.content);
    const mindest = Number(r.einstellungen.mindestlaenge) || 0;
    if (mindest > 0 && Regeln.laenge(text) < mindest) return { gebucht: false, grund: 'zu_kurz' };

    const darf = drossel.pruefe({
        guildId, mitglied, quelle: 'nachricht', taktungS: q.taktung_s,
        text, fensterS: Number(r.einstellungen.gleiche_fenster_s) || 0,
    });
    if (!darf.ja) return { gebucht: false, grund: darf.grund };

    const xp = Regeln.menge(q.xp_von, q.xp_bis, urteil.faktor);
    if (xp <= 0) return { gebucht: false, grund: 'null_xp' };

    let ergebnis;
    try {
        ergebnis = await Fortschritt.buche({
            guildId, kennung: 'leveling:community', mitglied, menge: xp, quelle: 'nachricht', schluessel: `msg:${message.id}`,
        });
    } catch (error) {
        meldeFehler('Buchen der Chat-XP gescheitert', error);
        return { gebucht: false, grund: 'fehler' };
    }
    if (ergebnis.aufstieg) await meldeAufstieg(guildId, mitglied, ergebnis);
    return { gebucht: ergebnis.neu, ergebnis };
}

/** `leveling.level.erreicht`; der Schlüssel hängt an der Buchung, die den Aufstieg brachte. */
async function meldeAufstieg(guildId, mitglied, e) {
    try {
        await Ereignisse.melde('leveling.level.erreicht', {
            guild_id: guildId,
            schluessel: `leveling:aufstieg:${e.buchung_id}`,
            akteur: 'system',
            betroffen: mitglied,
            daten: { fortschritt: KENNUNG, stufe: e.level, vorher: e.vorher.level },
        });
    } catch (error) {
        log().error('[Leveling] leveling.level.erreicht nicht gemeldet:', error);
    }
}

/**
 * Gelöschte Nachricht: XP zurück, wenn sie jünger als die eingestellte Frist
 * war. Geht auch für Nachrichten, die der Bot nicht im Speicher hat: Die Zeit
 * steckt in der ID.
 *
 * @param {import('discord.js').Message|import('discord.js').PartialMessage} message
 */
async function beiLoeschung(message) {
    if (!message?.guildId || !message.id) return { storniert: false, grund: 'keine_guild' };
    const guildId = String(message.guildId);
    const r = await Regeln.lade(guildId);
    const minuten = Number(r?.einstellungen?.storno_loeschen_min) || 0;
    if (!r || minuten <= 0) return { storniert: false, grund: 'aus' };
    const alter = Date.now() - Number(SnowflakeUtil.timestampFrom(message.id));
    if (alter > minuten * MINUTE_MS) return { storniert: false, grund: 'zu_alt' };
    try {
        const s = await Fortschritt.storniere({ guildId, kennung: 'leveling:community', schluessel: `msg:${message.id}`, grund: 'Nachricht gelöscht' });
        return { storniert: Boolean(s.gefunden && !s.schon), grund: s.gefunden ? null : 'keine_buchung' };
    } catch (error) {
        meldeFehler('Storno nach Löschen gescheitert', error);
        return { storniert: false, grund: 'fehler' };
    }
}

/** Einmal je Minute: Zähler schreiben, Drossel aufräumen. */
async function takt() {
    drossel.aufraeumen(86_400);
    await zaehler.schreibe();
}

module.exports = { beiNachricht, beiLoeschung, takt, drossel };
