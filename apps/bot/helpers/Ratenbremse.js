'use strict';

/**
 * Discords Ratenbremse hoerbar machen.
 *
 * **Warum das ein eigenes Stueck ist.** Bis zum 2026-08-26 hoerte im ganzen
 * Bot niemand auf `rateLimited` — nachgesehen mit einem `grep` ueber
 * `apps/bot/` und `packages/dunebot-sdk/lib/`, kein Treffer. Das faellt
 * deshalb nicht auf, weil eine Bremse **kein Fehler** ist:
 * `@discordjs/rest` wartet die geforderte Zeit still ab, der Aufruf gelingt
 * danach, und niemand erfaehrt, dass 20 Minuten vergangen sind. Ein Auftrag,
 * der so lange braucht, sieht hinterher aus wie einer, der eben lange
 * dauerte — genau die Sackgasse, in der die Ursachensuche zu Baustelle 76
 * stecken blieb.
 *
 * Es liegt als eigene Datei und nicht als Rumpf in `bot.js`, damit ein
 * Pruefskript **dieselbe** Funktion benutzen kann, statt sie nachzubauen. Eine
 * Meldung, die nur im Quelltext geprueft wird, ist keine.
 *
 * @module bot/helpers/Ratenbremse
 */

/**
 * Eine Bremse in eine Protokollzeile uebersetzen.
 *
 * Getrennt vom Anmelden, weil sich nur so pruefen laesst, **was** gemeldet
 * wird — ohne ein Protokoll abzufangen.
 *
 * @param {Object} info Angaben aus `rateLimited` (`RateLimitData`)
 * @returns {{stufe: 'error'|'warn', text: string}} Stufe und Klartext
 */
function alsMeldung(info = {}) {
    const text = `[Discord/Ratenbremse] ${info.method} ${info.route} wartet `
        + `${Math.round(Number(info.retryAfter) || 0)} ms (${info.scope}, `
        + `Eimer ${info.limit}, Bereich ${info.majorParameter})`;

    // `global` heisst nicht "diese Route ist gebremst", sondern "jeder Aufruf
    // dieses Bots steht". Das ist eine andere Lage und gehoert eine Stufe
    // lauter - sonst geht sie zwischen einzelnen gebremsten Routen unter.
    return info.global
        ? { stufe: 'error', text: `${text} — GLOBAL, betrifft jeden Aufruf dieses Bots` }
        : { stufe: 'warn', text };
}

// ── Was `rateLimited` nicht sieht (Baustelle 82, 2026-10-29) ─────────────
//
// `rateLimited` kam in 250 Fällen hängender Bearbeitungen kein einziges Mal
// (Baustelle 102). Nachgelesen in `@discordjs/rest` 2.6.0: Läuft eine Anfrage
// in ihre Frist (15 s) oder kommt 5xx zurück, wird sie **still** wiederholt —
// `makeNetworkRequest` gibt `null` zurück, kein Ereignis, keine Zeile. Erst
// die Antwort, die schließlich kommt, trägt im Ereignis `response` den Zähler
// `retries`. Und hinter einer hängenden Bearbeitung warten alle weiteren
// desselben Kanals in seiner Schlange (Baustelle 121: „nach 28 Minuten
// antwortet Discord für einen Kanal nicht mehr").
//
// Darum drei Zuhörer mehr, alle so gefiltert, dass nur Auffälliges ins Log
// kommt: Antworten nach Wiederholungen oder mit Fehlerstatus (außer 404, das
// ist eine gelöschte Nachricht und Alltag), Warnungen über ungültige Anfragen
// (Discord sperrt ab 10 000 in 10 Minuten), und aus `restDebug` nur die Zeilen
// über 429 und Sublimits — der Rest ist je Anfrage eine Zeile Rauschen.
// Betreiber 2026-10-29: „(1) zuerst, anschließend prüfen und (2) nachziehen."

/**
 * Eine Antwort von Discord, wenn sie auffällt — sonst null.
 *
 * @param {Object} anfrage `{ method, path, route, retries }` aus `response`
 * @param {Object} antwort `{ status }`
 * @returns {{stufe: 'warn', text: string}|null}
 */
function alsAntwort(anfrage = {}, antwort = {}) {
    const status = Number(antwort.status) || 0;
    const wiederholt = Number(anfrage.retries) || 0;
    const fehlerhaft = status >= 400 && status !== 404;
    if (!wiederholt && !fehlerhaft) return null;
    const methode = String(anfrage.method || 'get').toUpperCase();
    const teile = [`[Discord/REST] ${methode} ${anfrage.path || anfrage.route || '?'} → ${status || 'ohne Status'}`];
    if (wiederholt) teile.push(`nach ${wiederholt} Wiederholung(en) — jede heißt: Frist von 15 s abgelaufen oder 5xx`);
    return { stufe: 'warn', text: teile.join(', ') };
}

/**
 * Aus `restDebug` nur, was über Grenzen spricht — sonst null.
 *
 * @param {string} zeile
 * @returns {{stufe: 'warn', text: string}|null}
 */
function alsDebug(zeile) {
    const text = String(zeile || '');
    if (!/429|sublimit|Global rate limit|Waiting \d+ms/i.test(text)) return null;
    return { stufe: 'warn', text: `[Discord/REST] ${text.replace(/\n\s*/g, ' · ')}` };
}

/**
 * Discords Warnung über ungültige Anfragen.
 *
 * @param {Object} daten `{ count, remainingTime }`
 * @returns {{stufe: 'warn', text: string}}
 */
function alsUngueltig(daten = {}) {
    return {
        stufe: 'warn',
        text: `[Discord/REST] ${Number(daten.count) || 0} ungültige Anfragen (401/403/429) im laufenden `
            + `10-Minuten-Fenster, noch ${Math.round((Number(daten.remainingTime) || 0) / 1000)} s — `
            + 'ab 10 000 sperrt Discord die Adresse',
    };
}

/**
 * Zuhoeren beginnen.
 *
 * @param {Object} rest `client.rest` (ein `REST` aus `@discordjs/rest`)
 * @param {Object} logger Logger mit `warn` und `error`
 * @returns {Function} der angemeldete Zuhoerer auf `rateLimited` - zum Abmelden in Tests
 */
function anmelden(rest, logger) {
    const zuhoerer = (info) => {
        const { stufe, text } = alsMeldung(info);
        logger[stufe](text);
    };
    const melde = (m) => { if (m) logger[m.stufe](m.text); };

    rest.on('rateLimited', zuhoerer);
    rest.on('response', (anfrage, antwort) => melde(alsAntwort(anfrage, antwort)));
    rest.on('restDebug', (zeile) => melde(alsDebug(zeile)));
    rest.on('invalidRequestWarning', (daten) => melde(alsUngueltig(daten)));
    return zuhoerer;
}

module.exports = { anmelden, alsMeldung, alsAntwort, alsDebug, alsUngueltig };
