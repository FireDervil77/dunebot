#!/usr/bin/env node
'use strict';

/**
 * Die Statistik-Seite (P7) — holt sie, ohne zu behalten?
 *
 * ## Die Pruefung, auf die es ankommt
 *
 * Nicht ob Zahlen erscheinen, sondern **dass von Twitchs Listen nichts bei uns
 * liegen bleibt**. Die Seite zeigt Namen fremder Menschen — Follower,
 * Abonnenten, Bits-Rangliste. Der Betreiber hat am 2026-09-03 entschieden:
 * „die Frage nach den Daten wuerde ich per Request machen, also dann wenn man
 * sie braucht." Ein spaeterer Umbau, der „nur zum schnelleren Laden" einen
 * Zwischenspeicher anlegt, faellt hier auf.
 *
 * ## Und die zweite: jede Quelle antwortet fuer sich
 *
 * Drei Abfragen, drei Zusagen. Ein gemeinsames „hat nicht geklappt" waere die
 * halbe Auskunft — der Streamer saehe nicht, dass nur `bits:read` fehlt.
 * Besonders wichtig: **401 darf nicht als „0 Follower" durchgehen.** Dieselbe
 * Klemme, die `abonnentenLesen` schon einmal teuer gelernt hat.
 *
 *     node scripts/check-streaming-statistik.js
 */

const path = require('path');
const WURZEL = path.resolve(__dirname, '..');
const { ServiceManager } = require(path.join(WURZEL, 'node_modules/dunebot-core'));

let faelle = 0, abweichungen = 0;
function pruefe(gut, text, zusatz = '') {
    faelle++;
    if (!gut) abweichungen++;
    console.log(`  ${gut ? '✓' : '✗'} ${text}${zusatz ? '  — ' + zusatz : ''}`);
}

// --- Die Welt ------------------------------------------------------------
const welt = {
    kanaele: [{ id: 1, plattform: 'twitch', kanal_id: '37883778',
                login: 'firedervil', anzeigename: 'FireDervil' }],
    inhaber: 'nutzer-1',
    zustand: { ist_live: 0, begonnen_am: new Date(), beendet_am: null,
               titel: 'Astro Colony', kategorie: 'Astro Colony', zuschauer: 12 },
    folger: { ok: true, abgelehnt: false, gesamt: 42, folger: [{ kontoId: '9', login: 'anna', name: 'Anna', seit: new Date() }] },
    bits:   { ok: true, abgelehnt: false, plaetze: [{ kontoId: '9', name: 'Anna', platz: 1, punkte: 500 }] },
    abos:   { ok: true, abgelehnt: false, abonnenten: [{ kontoId: '9', kontoName: 'Anna', stufe: '1000', geschenkt: false }] }
};
const mitschrift = { abfragen: [], schreibzugriffe: [], unbekannt: [] };

ServiceManager.register('Logger', {
    info: () => {}, debug: () => {}, warn: () => {}, error: () => {}, success: () => {}
});

ServiceManager.register('dbService', {
    async query(sql, w = []) {
        const s = String(sql).replace(/\s+/g, ' ').trim();
        // **Ungekuerzt mitschreiben.** Der erste Anlauf schnitt auf 80 Zeichen
        // ab — und `FROM streaming_state` steht in dieser Abfrage an Stelle 82.
        // Die Pruefung „liest sie unsere Zeile?" fiel damit durch, obwohl der
        // Code stimmte. Gekuerzt wird erst bei der Ausgabe.
        mitschrift.abfragen.push(s);

        // **Jeder Schreibzugriff wird mitgeschrieben, egal welcher.** Genau
        // hier landete ein spaeter eingebauter Zwischenspeicher.
        if (/^(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(s)) {
            mitschrift.schreibzugriffe.push({ sql: s, werte: w });
            return { affectedRows: 1 };
        }

        if (/^SELECT .* FROM streaming_streamers WHERE heim_guild_id/.test(s)) {
            return welt.kanaele;
        }
        if (/^SELECT .* FROM streaming_state WHERE streamer_id/.test(s)) {
            return welt.zustand ? [welt.zustand] : [];
        }
        mitschrift.unbekannt.push(s.slice(0, 80));
        return [];
    }
});

/**
 * Ein Modul im Ladespeicher ersetzen.
 *
 * @param {string} rel Pfad ab der Wurzel
 * @param {Object} ersatz Was stattdessen gilt
 * @returns {void}
 */
function ersetzen(rel, ersatz) {
    const p = require.resolve(path.join(WURZEL, rel));
    const echt = require.cache[p] ? require(p) : {};
    require.cache[p] = { id: p, filename: p, loaded: true,
        exports: Object.assign({}, echt, ersatz) };
}

ersetzen('plugins/streaming/dashboard/kern/abonnenten.js', {
    /**
     * **Sie prueft ihr Argument.** Der echte `kanalInhaber` sucht mit
     * `plattform` UND `kanal_id`; fehlt eines, wirft mysql2. Genau so ist am
     * 2026-09-05 der erste echte Befehl gestorben, waehrend 44 Pruefungen
     * gruen meldeten.
     */
    async kanalInhaber(kanal) {
        for (const feld of ['plattform', 'kanal_id']) {
            if (kanal?.[feld] === undefined || kanal?.[feld] === null) {
                throw new Error(`kanalInhaber ohne \`${feld}\` gerufen`);
            }
        }
        return welt.inhaber;
    }
});

ersetzen('apps/dashboard/helpers/Verbindungsspeicher.js', {
    async mitZugang(_wer, tun) {
        if (welt.inhaber === null) return null;
        return await tun('zugang-attrappe');
    }
});

ersetzen('plugins/streaming/dashboard/plattformen/twitch.js', {
    async folgerLesen() { return welt.folger; },
    async bitsRanglisteLesen() { return welt.bits; },
    async abonnentenLesen() { return welt.abos; }
});

const statistik = require(path.join(WURZEL, 'plugins/streaming/dashboard/kern/statistik.js'));

/**
 * @param {Object} [welche] Abweichungen von der Standardwelt
 * @returns {void}
 */
function neuAufsetzen(welche = {}) {
    welt.inhaber = welche.inhaber !== undefined ? welche.inhaber : 'nutzer-1';
    welt.kanaele = welche.kanaele !== undefined ? welche.kanaele
        : [{ id: 1, plattform: 'twitch', kanal_id: '37883778',
             login: 'firedervil', anzeigename: 'FireDervil' }];
    welt.folger = welche.folger || { ok: true, abgelehnt: false, gesamt: 42,
        folger: [{ kontoId: '9', login: 'anna', name: 'Anna', seit: new Date() }] };
    welt.bits = welche.bits || { ok: true, abgelehnt: false,
        plaetze: [{ kontoId: '9', name: 'Anna', platz: 1, punkte: 500 }] };
    welt.abos = welche.abos || { ok: true, abgelehnt: false,
        abonnenten: [{ kontoId: '9', kontoName: 'Anna', stufe: '1000', geschenkt: false }] };
    mitschrift.abfragen = []; mitschrift.schreibzugriffe = []; mitschrift.unbekannt = [];
}

(async () => {

console.log('\nVon Twitchs Listen bleibt nichts liegen');
{
    neuAufsetzen();
    await statistik.holen('g1');

    pruefe(mitschrift.schreibzugriffe.length === 0,
        'ein vollstaendiger Lauf schreibt NICHTS in die Datenbank',
        mitschrift.schreibzugriffe.map(z => z.sql.slice(0, 60)).join(' | '));

    // Die zweite Sperre: im Quelltext steht gar kein Schreibbefehl.
    const fs = require('fs');
    const quelle = fs.readFileSync(path.join(WURZEL,
        'plugins/streaming/dashboard/kern/statistik.js'), 'utf8');
    const ohneKommentare = quelle
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
    pruefe(!/\b(INSERT|UPDATE|DELETE|REPLACE)\s+(INTO|FROM|\w)/i.test(ohneKommentare),
        'und der Quelltext enthaelt keinen Schreibbefehl',
        'Kommentare herausgerechnet — grep trifft sonst die Prosa');

    pruefe(mitschrift.abfragen.some(a => /streaming_state/.test(a)),
        'gelesen wird dagegen sehr wohl — der letzte Stream kommt aus unserer Zeile');
}

console.log('\nJede Quelle antwortet fuer sich');
{
    // Nur die Bits fehlen: Follower und Abos muessen trotzdem dastehen.
    neuAufsetzen({ bits: { ok: false, abgelehnt: true, plaetze: [] } });
    const b = await statistik.holen('g1');

    pruefe(b.bits.zustand === statistik.ZUSTAND.ABGELEHNT, 'die Bits melden „abgelehnt"');
    pruefe(b.folger.zustand === statistik.ZUSTAND.OK, 'die Follower stehen trotzdem da');
    pruefe(b.abos.zustand === statistik.ZUSTAND.OK, 'die Abos ebenso');
    pruefe(b.folger.gesamt === 42, 'und ihre Zahl stimmt', String(b.folger.gesamt));
}

console.log('\n401 ist keine Null');
{
    // **Der Fall, um den es geht.** Ein abgelaufener Schluessel darf nicht wie
    // ein Kanal aussehen, dem niemand folgt.
    neuAufsetzen({ folger: { ok: false, abgelehnt: true, gesamt: 0, folger: [] } });
    const b = await statistik.holen('g1');

    pruefe(b.folger.zustand === statistik.ZUSTAND.ABGELEHNT,
        'eine abgewiesene Abfrage heisst „abgelehnt", nicht „ok mit 0"');
    pruefe(b.folger.zustand !== statistik.ZUSTAND.OK,
        'sie kommt also nie als Erfolg mit leerer Liste durch');

    // Und ein technischer Fehler ist etwas anderes als ein Widerruf.
    neuAufsetzen({ folger: { ok: false, abgelehnt: false, gesamt: 0, folger: [] } });
    const c = await statistik.holen('g1');
    pruefe(c.folger.zustand === statistik.ZUSTAND.FEHLER,
        'ein technischer Fehler wird als solcher gemeldet, nicht als Widerruf');
}

console.log('\nWenn es gar keinen Zugang gibt');
{
    neuAufsetzen({ inhaber: null });
    const b = await statistik.holen('g1');
    pruefe(b.folger.zustand === statistik.ZUSTAND.ABGELEHNT
        && b.bits.zustand === statistik.ZUSTAND.ABGELEHNT
        && b.abos.zustand === statistik.ZUSTAND.ABGELEHNT,
        'ohne verknuepftes Konto melden alle drei „abgelehnt" — kein Fehler');
    pruefe(mitschrift.schreibzugriffe.length === 0, 'und es wird immer noch nichts geschrieben');

    neuAufsetzen({ kanaele: [] });
    const c = await statistik.holen('g1');
    pruefe(c.kanal === null && c.folger.zustand === statistik.ZUSTAND.KEIN_KANAL,
        'ohne Heim-Kanal sagt die Seite genau das');
}

console.log('\nDie Attrappe hat alles verstanden');
pruefe(mitschrift.unbekannt.length === 0, 'keine unbekannte Abfrage still mit `[]` beantwortet',
    [...new Set(mitschrift.unbekannt)].join(' | '));

console.log(abweichungen === 0
    ? `\nErgebnis: ${faelle} Pruefungen, 0 Abweichungen.\n`
    : `\nErgebnis: ${faelle} Pruefungen, ${abweichungen} Abweichung(en).\n`);
process.exit(abweichungen === 0 ? 0 : 1);

})().catch(err => { console.error('\nAbbruch:', err.message, '\n', err.stack); process.exit(1); });
