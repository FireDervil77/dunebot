'use strict';

/**
 * Die Mitgliederliste einer Guild holen — **mit Frist und ehrlicher Antwort**.
 *
 * ## Warum es diesen Helfer gibt
 *
 * `guild.members.fetch()` holt die ganze Liste ueber das Gateway. Ohne `time`
 * gilt die Vorgabe von discord.js: **120 000 ms**. Bleibt die Antwort aus,
 * wartet der Aufrufer zwei Minuten und bekommt danach still den halben
 * Zwischenspeicher.
 *
 * Gemessen am 2026-08-27 im Bot-Protokoll:
 *
 *     [IPC] dashboard:GET_ALL_GUILD_MEMBERS brauchte 120003 ms
 *     [IPC] GET_ALL_GUILD_MEMBERS: 14 Members fuer Guild 565123525795643393
 *
 * **Vierzehn Mitglieder, zwei Minuten.** Ein anderer Aufruf derselben Guild
 * im selben Protokoll: 107 ms. Es ist also keine Frage der Menge, sondern eine
 * ausbleibende Gateway-Antwort, die in die Vorgabefrist laeuft. Dieselbe
 * Familie wie Baustelle 76.
 *
 * ## Die drei Regeln
 *
 * **1. Nicht holen, was schon da ist.** `_fetchMany` fragt **immer** ueber das
 * Gateway — es sieht sich den Zwischenspeicher gar nicht erst an. Jede
 * Seitenansicht loeste also einen vollen Rundlauf aus. Die Abkuerzung muss
 * deshalb hier stehen, sie kommt nicht von discord.js.
 *
 * Nebenbei nachgesehen und dabei eine eigene Annahme widerlegt: Das
 * `force: true`, das in `GET_ALL_GUILD_MEMBERS` stand, war **wirkungslos**.
 * `GuildMemberManager.fetch` reicht `force` nur an `_fetchSingle` weiter; beim
 * Vollabruf landet es in `_fetchMany`, und das liest es nicht aus. Es hat also
 * weder geschadet noch geholfen — die Frist fehlte, das war alles.
 *
 * **2. Eine Frist, die kuerzer ist als die Geduld des Aufrufers.** 15 s. Wer
 * auf eine Seite wartet, hat nach 15 Sekunden laengst neu geladen; nach 120
 * hat er den Dienst fuer kaputt erklaert.
 *
 * **3. Unvollstaendig wird gesagt, nicht verschwiegen.** Das ist die Lehre aus
 * `49dda5a`: Dort verschluckte ein `.catch(() => {})` den Fehlschlag, und der
 * Aufrufer bekam eine **halbe Liste, die aussieht wie eine ganze**. Hier
 * kommt `vollstaendig: false` mit — wer daraufhin nichts tun darf, kann es
 * unterscheiden.
 *
 * @module bot/helpers/Mitglieder
 */

/** Kuerzer als die Vorgabe von discord.js (120 s) und kuerzer als jede Geduld. */
const FRIST_MS = 15_000;

/**
 * Alle Mitglieder einer Guild.
 *
 * @param {Object} guild Discord-Guild
 * @param {Object} [logger] Protokoll
 * @param {Object} [opt] Optionen
 * @param {number} [opt.fristMs] Abweichende Frist
 * @param {boolean} [opt.erzwingen] die Abkuerzung ueber den Zwischenspeicher
 *   ueberspringen und in jedem Fall fragen (kostet einen vollen Rundlauf)
 * @returns {Promise<{mitglieder: Object, vollstaendig: boolean, grund: string|null}>}
 *   `mitglieder` ist die Collection aus dem Zwischenspeicher
 */
async function holen(guild, logger = null, { fristMs = FRIST_MS, erzwingen = false } = {}) {
    const melde = (art, text) => { if (logger && logger[art]) logger[art](text); };

    if (!guild) return { mitglieder: new Map(), vollstaendig: false, grund: 'keine Guild' };

    // `memberCount` kann fehlen (sehr grosse Guilds, fehlende Absicht). Dann
    // laesst sich Vollstaendigkeit nicht feststellen — also wird geholt.
    const soll = Number(guild.memberCount) || 0;
    const schonDa = guild.members.cache.size;

    if (!erzwingen && soll > 0 && schonDa >= soll) {
        return { mitglieder: guild.members.cache, vollstaendig: true, grund: null };
    }

    try {
        // Bewusst **ohne** `force`: Beim Vollabruf wird es von discord.js
        // ignoriert (siehe oben). Es mitzugeben taeuschte eine Wirkung vor,
        // die es nicht hat — und der naechste Leser suchte den Unterschied.
        await guild.members.fetch({ time: fristMs });
    } catch (err) {
        // **Nicht verschlucken.** Die bis zum Zeitablauf angekommenen Bloecke
        // stehen trotzdem im Zwischenspeicher; wer den Fehlschlag hier
        // wegwirft, liefert sie als ganze Liste aus.
        const jetzt = guild.members.cache.size;
        melde('warn', `[Mitglieder] ${guild.id}: Abruf fehlgeschlagen nach ${fristMs} ms `
                    + `(${jetzt} von ${soll || '?'} im Speicher) — ${err.message}`);
        return {
            mitglieder: guild.members.cache,
            vollstaendig: false,
            grund: err.message || 'Abruf fehlgeschlagen'
        };
    }

    const jetzt = guild.members.cache.size;
    const vollstaendig = soll === 0 || jetzt >= soll;
    if (!vollstaendig) {
        melde('warn', `[Mitglieder] ${guild.id}: Liste unvollstaendig — ${jetzt} von ${soll}`);
    }

    return {
        mitglieder: guild.members.cache,
        vollstaendig,
        grund: vollstaendig ? null : `nur ${jetzt} von ${soll}`
    };
}

module.exports = { FRIST_MS, holen };
