#!/usr/bin/env node
'use strict';

/**
 * Mitmachen (P9) — loest es aus, ohne zu behalten?
 *
 * ## Die drei Pruefungen, auf die es ankommt
 *
 * **1. Von Twitchs Sachen bleibt nichts liegen.** Clips und Umfragen gehoeren
 * Twitch; wir schicken den Auftrag und lesen den Stand. Ein spaeterer Umbau,
 * der „nur zum schnelleren Laden" einen Zwischenspeicher anlegt, faellt hier
 * auf — dieselbe Zusage wie bei der Statistik (2026-09-03).
 *
 * **2. Ohne Zusage wird nicht gefragt.** Ein Aufruf, von dem wir wissen, dass
 * er mit 401 endet, kostet Kontingent und traegt zur Antwort nichts bei. Und
 * schlimmer: `mitZugang` vermerkt bei einer Abfuhr einen Widerruf, den es nie
 * gegeben hat.
 *
 * **3. Die zwei Namen stimmen ueberein.** `kern/mitmachen.ZUSAGEN` erwartet
 * eine Zusage, `dashboard/index.js` bietet sie an. Zwei Stellen, ein Name —
 * genau so haengt `meinkanal.SCHREIB_ZUSAGE` seit Stufe 13c, und genau so
 * faellt es lautlos aus, wenn jemand eine davon umbenennt.
 *
 *     node scripts/check-streaming-mitmachen.js
 */

const fs = require('fs');
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
const UMFRAGE_LAEUFT = {
    id: 'u1', frage: 'Welches Spiel?', zustand: 'ACTIVE', laeuft: true,
    dauer_s: 60, begonnen_am: new Date(), beendet_am: null,
    punkteAbstimmung: false, punkteProStimme: 0, gesamt: 7,
    antworten: [{ id: 'a', titel: 'Astro', stimmen: 5, punkteStimmen: 0 },
                { id: 'b', titel: 'Satisfactory', stimmen: 2, punkteStimmen: 0 }]
};
const UMFRAGE_ALT = {
    id: 'u0', frage: 'Alte Frage', zustand: 'COMPLETED', laeuft: false,
    dauer_s: 60, begonnen_am: new Date(), beendet_am: new Date(),
    punkteAbstimmung: false, punkteProStimme: 0, gesamt: 3,
    antworten: [{ id: 'c', titel: 'Ja', stimmen: 3, punkteStimmen: 0 }]
};

const welt = {};
const mitschrift = { abfragen: [], schreibzugriffe: [], unbekannt: [],
                     twitch: [] };

/** @returns {void} */
function neuAufsetzen(welche = {}) {
    welt.kanaele = welche.kanaele !== undefined ? welche.kanaele
        : [{ id: 1, plattform: 'twitch', kanal_id: '37883778',
             login: 'firedervil', anzeigename: 'FireDervil' }];
    welt.inhaber = welche.inhaber !== undefined ? welche.inhaber : 'nutzer-1';
    // Was am Schluessel steht. **Nicht** „was er gemeint hat" — das ist der
    // Unterschied, um den es in `kern/zusagen` geht.
    welt.scopes = welche.scopes !== undefined ? welche.scopes
        : 'clips:edit channel:manage:polls user:write:chat';
    welt.befehle = welche.befehle !== undefined ? welche.befehle
        : [{ wort: 'clip', aktiv: 1, wer: 'moderator', abkuehlung_s: 60 },
           { wort: 'umfrage', aktiv: 1, wer: 'alle', abkuehlung_s: 30 }];
    welt.umfragen = welche.umfragen !== undefined ? welche.umfragen
        : { ok: true, abgelehnt: false, grund: null, umfragen: [UMFRAGE_LAEUFT, UMFRAGE_ALT] };
    welt.start = welche.start !== undefined ? welche.start
        : { ok: true, abgelehnt: false, umfrage: UMFRAGE_LAEUFT, grund: null };

    mitschrift.abfragen = []; mitschrift.schreibzugriffe = [];
    mitschrift.unbekannt = []; mitschrift.twitch = [];
}

ServiceManager.register('Logger', {
    info: () => {}, debug: () => {}, warn: () => {}, error: () => {}, success: () => {}
});

ServiceManager.register('dbService', {
    async query(sql, w = []) {
        const s = String(sql).replace(/\s+/g, ' ').trim();
        // Ungekuerzt mitschreiben — am 2026-09-05 hat eine 80-Zeichen-Grenze
        // im Statistik-Waechter eine richtige Pruefung fallen lassen.
        mitschrift.abfragen.push(s);

        if (/^(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(s)) {
            mitschrift.schreibzugriffe.push({ sql: s, werte: w });
            return { affectedRows: 1 };
        }

        if (/^SELECT .* FROM streaming_streamers WHERE heim_guild_id/.test(s)) {
            return welt.kanaele;
        }
        // **Die Bedingung wird geprueft, nicht nachgebildet.** Ohne
        // `art = 'fertig'` staenden hier auch eigene Befehle, und der Stand von
        // `!clip` waere der einer fremden Zeile.
        if (/^SELECT wort, aktiv, wer, abkuehlung_s FROM streaming_commands/.test(s)) {
            if (!s.includes("art = 'fertig'")) {
                throw new Error('befehlsstand fragt nicht nach `art` — dann traefe es auch eigene Befehle');
            }
            if (!s.includes('guild_id = ?')) {
                throw new Error('befehlsstand fragt nicht nach der Guild');
            }
            return welt.befehle;
        }

        mitschrift.unbekannt.push(s);
        return [];
    }
});

/** @returns {void} */
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

// **`kern/zusagen` wird NICHT ersetzt.** Es ist der Teil, um den es hier geht;
// stattdessen antwortet der Speicher darunter. So laeuft die echte
// Scope-Pruefung mit.
ersetzen('apps/dashboard/helpers/Verbindungsspeicher.js', {
    async zusageLesen(userId) {
        if (!userId) throw new Error('zusageLesen ohne Benutzer gerufen');
        return welt.scopes === null ? null : { scopes: welt.scopes };
    },
    async mitZugang(_wer, tun) {
        if (welt.inhaber === null) return null;
        return await tun('zugang-attrappe');
    }
});

ersetzen('plugins/streaming/dashboard/plattformen/twitch.js', {
    async umfragenLesen(kanalId, zugang, anzahl) {
        if (!kanalId) throw new Error('umfragenLesen ohne `kanalId` gerufen');
        if (!zugang)  throw new Error('umfragenLesen ohne Schluessel gerufen');
        mitschrift.twitch.push({ was: 'umfragenLesen', kanalId: String(kanalId), anzahl });
        return welt.umfragen;
    },
    async umfrageStarten(kanalId, zugang, f) {
        if (!kanalId) throw new Error('umfrageStarten ohne `kanalId` gerufen');
        if (!zugang)  throw new Error('umfrageStarten ohne Schluessel gerufen');
        mitschrift.twitch.push({ was: 'umfrageStarten', felder: f });
        return welt.start;
    },
    async umfrageBeenden(kanalId, zugang, id, verbergen) {
        if (!kanalId) throw new Error('umfrageBeenden ohne `kanalId` gerufen');
        if (!id)      throw new Error('umfrageBeenden ohne Umfrage gerufen');
        mitschrift.twitch.push({ was: 'umfrageBeenden', id: String(id), verbergen });
        return { ok: true, abgelehnt: false, umfrage: null, grund: null };
    },
    async clipErstellen(kanalId, zugang) {
        if (!kanalId) throw new Error('clipErstellen ohne `kanalId` gerufen');
        if (!zugang)  throw new Error('clipErstellen ohne Schluessel gerufen');
        mitschrift.twitch.push({ was: 'clipErstellen', kanalId: String(kanalId) });
        return { ok: true, abgelehnt: false, id: 'ClipX',
                 url: 'https://clips.twitch.tv/ClipX', grund: null };
    }
});

const mitmachen = require(path.join(WURZEL, 'plugins/streaming/dashboard/kern/mitmachen.js'));
const befehle = require(path.join(WURZEL, 'plugins/streaming/dashboard/kern/befehle.js'));
const ZUSAGEN_STAND = require(path.join(WURZEL, 'plugins/streaming/dashboard/kern/zusagen.js')).STAND;

/** @returns {string} Quelltext ohne Kommentare */
const ohneKommentare = (text) => String(text)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), 'utf8');

(async () => {

console.log('\nVon Twitchs Sachen bleibt nichts liegen');
{
    neuAufsetzen();
    await mitmachen.zustand('g1');
    await mitmachen.umfrageStarten('g1', { frage: 'F', antworten: ['a', 'b'], dauer_s: 60 });
    await mitmachen.umfrageBeenden('g1', 'u1', false);
    await mitmachen.clipSchneiden({ id: 1, plattform: 'twitch', kanal_id: '37883778' });

    pruefe(mitschrift.schreibzugriffe.length === 0,
        'ein vollstaendiger Lauf schreibt NICHTS in die Datenbank',
        mitschrift.schreibzugriffe.map(z => z.sql.slice(0, 60)).join(' | '));

    // Die zweite Sperre: im Quelltext steht gar kein Schreibbefehl.
    pruefe(!/\b(INSERT|UPDATE|DELETE|REPLACE)\s+(INTO|FROM|\w)/i.test(
        ohneKommentare(lies('plugins/streaming/dashboard/kern/mitmachen.js'))),
        'und der Quelltext enthaelt keinen Schreibbefehl',
        'Kommentare herausgerechnet — grep trifft sonst die Prosa');
}

console.log('\nOhne Zusage wird Twitch gar nicht erst gefragt');
{
    // **Der teure Fehler waere nicht die verlorene Zeit.** `mitZugang` vermerkt
    // bei einer Abfuhr einen Widerruf — wir wuerden uns also selbst eine Zusage
    // aberkennen, die nie erteilt war.
    neuAufsetzen({ scopes: 'user:write:chat' });   // Chat ja, Umfragen nein
    const b = await mitmachen.zustand('g1');

    pruefe(b.zusagen.umfragen.zustand === ZUSAGEN_STAND.NEIN,
        'die fehlende Zusage steht als solche da');
    pruefe(b.umfragen.zustand === mitmachen.ZUSTAND.ABGELEHNT,
        'die Umfragen-Karte meldet „abgelehnt"', b.umfragen.zustand);
    pruefe(mitschrift.twitch.length === 0,
        'und Twitch wurde ueberhaupt nicht gefragt',
        mitschrift.twitch.map(t => t.was).join(', '));
}

console.log('\nJede Zusage steht fuer sich');
{
    neuAufsetzen({ scopes: 'clips:edit' });
    const b = await mitmachen.zustand('g1');
    pruefe(b.zusagen.clip.zustand === ZUSAGEN_STAND.JA, 'der Clip darf');
    pruefe(b.zusagen.umfragen.zustand === ZUSAGEN_STAND.NEIN,
        'die Umfrage nicht — und beide sagen es getrennt');
}

console.log('\n401 ist keine leere Liste');
{
    neuAufsetzen({ umfragen: { ok: false, abgelehnt: true, grund: null, umfragen: [] } });
    const b = await mitmachen.zustand('g1');
    pruefe(b.umfragen.zustand === mitmachen.ZUSTAND.ABGELEHNT,
        'eine abgewiesene Abfrage heisst „abgelehnt", nicht „ok mit nichts"');

    neuAufsetzen({ umfragen: { ok: false, abgelehnt: false, grund: 'kaputt', umfragen: [] } });
    const c = await mitmachen.zustand('g1');
    pruefe(c.umfragen.zustand === mitmachen.ZUSTAND.FEHLER,
        'ein technischer Fehler wird als solcher gemeldet, nicht als Widerruf');

    neuAufsetzen({ inhaber: null });
    const d = await mitmachen.zustand('g1');
    pruefe(d.umfragen.zustand === mitmachen.ZUSTAND.ABGELEHNT
        && d.zusagen.clip.zustand === ZUSAGEN_STAND.NEIN,
        'ohne verknuepftes Konto melden beide „abgelehnt" — kein Fehler');

    neuAufsetzen({ kanaele: [] });
    const e = await mitmachen.zustand('g1');
    pruefe(e.kanal === null && e.umfragen.zustand === mitmachen.ZUSTAND.KEIN_KANAL,
        'ohne Heim-Kanal sagt die Seite genau das');
}

console.log('\nDie laufende Umfrage wird nicht mit den beendeten verwechselt');
{
    neuAufsetzen();
    const b = await mitmachen.zustand('g1');
    pruefe(b.umfragen.laufend?.id === 'u1', 'die laufende steht fuer sich',
        String(b.umfragen.laufend?.id));
    pruefe(b.umfragen.frueher.length === 1 && b.umfragen.frueher[0].id === 'u0',
        'und die beendete steht im Rueckblick, nicht daneben');

    // **Die Reihenfolge ist kein Kriterium.** Twitch gibt die neuesten zuerst;
    // ist die neueste beendet, laeuft keine — auch wenn sie ganz oben steht.
    neuAufsetzen({ umfragen: { ok: true, abgelehnt: false, grund: null,
                               umfragen: [UMFRAGE_ALT] } });
    const c = await mitmachen.zustand('g1');
    pruefe(c.umfragen.laufend === null,
        'eine beendete Umfrage an erster Stelle gilt NICHT als laufend');
}

console.log('\nEine Umfrage ohne zwei Antworten geht gar nicht erst hinaus');
{
    neuAufsetzen();
    const a = await mitmachen.umfrageStarten('g1', { frage: '', antworten: ['x', 'y'] });
    pruefe(a.ok === false && a.grund === 'frage', 'ohne Frage: abgelehnt', a.grund);

    neuAufsetzen();
    const b = await mitmachen.umfrageStarten('g1', { frage: 'F', antworten: ['x', '', '  '] });
    pruefe(b.ok === false && b.grund === 'antworten',
        'mit einer Antwort: abgelehnt — leere Felder zaehlen nicht mit', b.grund);
    pruefe(mitschrift.twitch.length === 0,
        'und Twitch wurde damit nicht behelligt', String(mitschrift.twitch.length));

    neuAufsetzen();
    await mitmachen.umfrageStarten('g1', { frage: 'F', antworten: ['x', '', 'y'], dauer_s: 120 });
    const gesendet = mitschrift.twitch.find(t => t.was === 'umfrageStarten');
    pruefe(String(gesendet?.felder?.antworten) === 'x,y',
        'die Luecke in der Mitte faellt heraus, statt eine leere Antwort zu werden',
        String(gesendet?.felder?.antworten));
}

console.log('\nTwitchs Grund wird durchgereicht, nicht gedeutet');
{
    // **Die Absage, die diese Seite haben wird.** Umfragen gibt es nur fuer
    // Affiliates und Partner. Ein „technisch nicht geklappt" schickte den
    // Streamer auf die Suche nach einem Fehler bei uns.
    neuAufsetzen({ start: { ok: false, abgelehnt: false, umfrage: null,
        grund: 'The broadcaster must be a partner or affiliate' } });
    const a = await mitmachen.umfrageStarten('g1', { frage: 'F', antworten: ['x', 'y'] });
    pruefe(a.ok === false && /affiliate/i.test(a.grund || ''),
        'der Satz von Twitch kommt beim Streamer an', a.grund);

    neuAufsetzen({ inhaber: null });
    const b = await mitmachen.umfrageStarten('g1', { frage: 'F', antworten: ['x', 'y'] });
    pruefe(b.ok === false && /Zusage/i.test(b.grund || ''),
        'und ein Widerruf liest sich als Entscheidung, nicht als Stoerung', b.grund);
}

console.log('\nBeenden und Abbrechen sind zwei Dinge');
{
    neuAufsetzen();
    await mitmachen.umfrageBeenden('g1', 'u1', true);
    pruefe(mitschrift.twitch.at(-1)?.verbergen === true,
        'Abbrechen reicht „verbergen" durch', String(mitschrift.twitch.at(-1)?.verbergen));

    neuAufsetzen();
    const ohne = await mitmachen.umfrageBeenden('g1', '', false);
    pruefe(ohne.ok === false && mitschrift.twitch.length === 0,
        'ohne Umfrage wird nichts beendet', ohne.grund);
}

console.log('\nDie zwei Namen der Zusagen stimmen ueberein');
{
    // **Zwei Stellen, ein Name.** `kern/mitmachen` erwartet, `dashboard/index`
    // bietet an. Wer eine davon umbenennt, bekommt keinen Fehler — die Seite
    // zeigte fuer immer „nicht erteilt", auch nach dem Klick.
    const index = lies('plugins/streaming/dashboard/index.js');
    for (const [name, z] of Object.entries(mitmachen.ZUSAGEN)) {
        pruefe(new RegExp(`\\n\\s*${z.zusage}:\\s*\\{`).test(index),
            `\`${z.zusage}\` wird in dashboard/index.js auch angeboten`);
        pruefe(index.includes(`'${z.scope}'`),
            `und mit dem Scope \`${z.scope}\``, name);
    }
}

console.log('\nDie zwei Befehle haengen an denselben Zusagen');
{
    // Ein `zusage: 'clipp'` am Befehl waere ein Tippfehler ohne Fehlermeldung:
    // Die Befehlsseite zeigte den Schluessel-Hinweis, die Mitmachen-Seite
    // wuesste nichts davon.
    for (const wort of ['clip', 'umfrage']) {
        const eintrag = befehle.FERTIG[wort];
        pruefe(typeof eintrag?.tun === 'function',
            `\`!${wort}\` bewirkt etwas (\`tun\`), statt nur zu antworten`);
        pruefe(Object.values(mitmachen.ZUSAGEN).some(z => z.zusage === eintrag?.zusage),
            `und die Zusage \`${eintrag?.zusage}\` kennt die Mitmachen-Seite`);
    }
}

console.log('\nDer Befehlsstand kommt aus der Tabelle, nicht aus dem Code');
{
    neuAufsetzen({ befehle: [{ wort: 'clip', aktiv: 0, wer: 'alle', abkuehlung_s: 5 }] });
    const b = await mitmachen.zustand('g1');
    pruefe(b.befehle.clip?.aktiv === false && b.befehle.clip?.wer === 'alle',
        'ein abgeschalteter, aufgemachter Befehl wird auch so gezeigt',
        JSON.stringify(b.befehle.clip));
    pruefe(b.befehle.umfrage === null,
        'und ein Befehl ohne Zeile heisst „noch nicht eingerichtet", nicht „an"');
}

console.log('\nDie Attrappe hat alles verstanden');
pruefe(mitschrift.unbekannt.length === 0,
    'keine unbekannte Abfrage still mit `[]` beantwortet',
    [...new Set(mitschrift.unbekannt)].map(a => a.slice(0, 70)).join(' | '));

console.log(abweichungen === 0
    ? `\nErgebnis: ${faelle} Pruefungen, 0 Abweichungen.\n`
    : `\nErgebnis: ${faelle} Pruefungen, ${abweichungen} Abweichung(en).\n`);
process.exit(abweichungen === 0 ? 0 : 1);

})().catch(err => { console.error('\nAbbruch:', err.message, '\n', err.stack); process.exit(1); });
