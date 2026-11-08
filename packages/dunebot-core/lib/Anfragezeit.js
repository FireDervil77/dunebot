'use strict';
/**
 * Wo bleibt die Zeit einer Anfrage? (2026-11-08)
 *
 * Anlass: „die Webseite reagiert schon wieder voll langsam" — und es gab nichts,
 * womit sich sagen ließ, ob Chrome, das Dashboard, die Datenbank, der Daemon
 * oder der Bot die Sekunden kostet. Gemessen wurde nur „jetzt ist es schnell".
 *
 * Je HTTP-Anfrage legt die Middleware des Dashboards einen Zähler an
 * (`lauf`). Datenbank (`DBClient`), Daemon (`IPMServer.sendCommand`) und Bot
 * (`IPCServer.broadcast*`) buchen ihre Zeit darauf (`messe`/`buche`), ohne von
 * der Anfrage zu wissen: AsyncLocalStorage trägt den Zähler durch die
 * asynchronen Aufrufe. Außerhalb einer Anfrage (Takt, Bot-Prozess) gibt es
 * keinen Zähler, dann wird nichts gebucht.
 *
 * Heraus kommt der Kopf `Server-Timing`, den Chrome im Netzwerk-Reiter unter
 * „Timing" zeigt. Zeiten je Art sind SUMMEN: Laufen drei Abfragen gleichzeitig,
 * kann die Summe größer sein als die Gesamtzeit.
 */
const { AsyncLocalStorage } = require('async_hooks');
const { performance } = require('perf_hooks');

const speicher = new AsyncLocalStorage();

/** Reihenfolge und Beschriftung im Kopf. Nur ASCII: Node lehnt anderes im Kopf ab. */
const ARTEN = [
    { art: 'db',     einheit: 'Abfragen' },
    { art: 'daemon', einheit: 'Befehle' },
    { art: 'bot',    einheit: 'IPC' },
];

/** Führt `fn` mit einem frischen Zähler aus. */
function lauf(fn) {
    return speicher.run({ beginn: performance.now(), arten: new Map() }, fn);
}

/** Der Zähler der laufenden Anfrage, oder null. */
function aktuell() {
    return speicher.getStore() || null;
}

/** Bucht `ms` auf eine Art, mit optionalem Namen (Befehl, Ereignis). */
function buche(art, ms, name) {
    const z = speicher.getStore();
    if (!z) return;
    let e = z.arten.get(art);
    if (!e) {
        e = { ms: 0, anzahl: 0, namen: new Map() };
        z.arten.set(art, e);
    }
    e.ms += ms;
    e.anzahl += 1;
    if (name) e.namen.set(name, (e.namen.get(name) || 0) + 1);
}

/** Misst eine asynchrone Arbeit und bucht sie — auch wenn sie wirft. */
async function messe(art, name, fn) {
    if (!speicher.getStore()) return fn();
    const beginn = performance.now();
    try {
        return await fn();
    } finally {
        buche(art, performance.now() - beginn, name);
    }
}

/** Ein Text für `desc="…"`: druckbares ASCII ohne Anführungszeichen und Backslash. */
function sauber(text) {
    return String(text).replace(/[^\x20-\x7e]/g, '?').replace(/["\\]/g, '').slice(0, 200);
}

function namenText(namen) {
    return [...namen].map(([n, k]) => (k > 1 ? `${n} x${k}` : n)).join(', ');
}

/**
 * Der Wert für `Server-Timing`.
 * @param {object} z Zähler aus `aktuell()`
 * @param {object} [opt]
 * @param {boolean} [opt.mitNamen=false] Befehls- und Ereignisnamen nennen —
 *        nur für Angemeldete: Wer nicht angemeldet ist, erfährt die Dauer, nicht
 *        welche Daemon-Befehle es gibt.
 */
function kopf(z, { mitNamen = false } = {}) {
    const teile = [`gesamt;dur=${(performance.now() - z.beginn).toFixed(1)};desc="bis zur Antwort"`];
    for (const { art, einheit } of ARTEN) {
        const e = z.arten.get(art);
        if (!e) continue;
        const was = mitNamen && e.namen.size ? `: ${namenText(e.namen)}` : '';
        teile.push(`${art};dur=${e.ms.toFixed(1)};desc="${sauber(`${e.anzahl} ${einheit}, Summe${was}`)}"`);
    }
    return teile.join(', ');
}

/** Eine Zeile fürs Protokoll, mit Namen. */
function zusammenfassung(z) {
    const teile = [];
    for (const { art, einheit } of ARTEN) {
        const e = z.arten.get(art);
        if (!e) continue;
        teile.push(`${art} ${Math.round(e.ms)} ms (${e.anzahl} ${einheit}${e.namen.size ? ': ' + namenText(e.namen) : ''})`);
    }
    return teile.length ? teile.join(', ') : 'weder Datenbank noch Daemon noch Bot';
}

module.exports = { lauf, aktuell, buche, messe, kopf, zusammenfassung };
