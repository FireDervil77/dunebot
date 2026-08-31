#!/usr/bin/env node
'use strict';
/**
 * Waechter, die ihre eigene Prosa mitmessen.
 *
 * ── Der Befund dahinter (Baustelle 89) ──────────────────────────────────────
 *
 * Ein Waechter prueft mit einem regulaeren Ausdruck ueber den DATEIINHALT. Der
 * enthaelt die Kommentare, und dieses Haus schreibt lange. Also trifft der
 * Ausdruck auch die Beschreibung der Sache statt der Sache — dreimal an einem
 * Vormittag falscher Alarm, und einmal die andere Richtung: eine Zaehlung, der
 * ein Ternaer entging.
 *
 * Am 2026-08-30 wurden zwei Skripte repariert. Offen blieb die Zahl: wie viele
 * der uebrigen messen genauso? Nicht geschaetzt — nachgesehen. Dieses Skript
 * ist das Nachsehen.
 *
 * Aufruf:
 *   node scripts/check-waechter-prosa.js
 *   node scripts/check-waechter-prosa.js --alle    auch die sauberen zeigen
 *
 * ── Was es NICHT kann ───────────────────────────────────────────────────────
 *
 * Es liest Text, nicht Bedeutung — wie check-leerlauf.js. Jeder Befund ist ein
 * begruendeter Verdacht, kein Urteil: Es gibt Waechter, die absichtlich im
 * ROHEN Inhalt suchen (etwa "steht die Begruendung ueber der Zeile?"). Genau
 * dafuer steht die Fundstelle mit im Bericht, statt nur einer Zahl.
 *
 * Es verfolgt ausserdem nur, was einen NAMEN traegt oder unmittelbar durchsucht
 * wird. Wandert Dateiinhalt durch eine eigene Funktion, verliert es die Spur.
 */

const fs = require('fs');
const path = require('path');
const { ohneKommentare } = require('./lib/quelltext');

const WURZEL = path.join(__dirname, '..');
const SELBST = path.basename(__filename);
const ALLE = process.argv.includes('--alle');

/**
 * Referenzstand: so viele Waechter suchen im rohen Inhalt.
 *
 * Gemessen, nicht gesetzt — die Zahl kommt aus dem ersten vollstaendigen Lauf
 * dieses Skripts. Rot wird es, wenn sie STEIGT: dann ist ein neuer dazu-
 * gekommen. Sie zu senken ist Arbeit, kein Alarm; wer senkt, traegt hier nach.
 *
 * Erster Lauf 2026-08-31: 21 von 62 Waechtern, 144 Stellen. Darunter beide, die
 * am 2026-08-30 als repariert galten — dort waren nur die zwei Stellen
 * nachgezogen worden, die falschen Alarm geschlagen hatten. Die uebrigen 15 in
 * derselben Datei blieben, wie sie waren. Ein Erfolg laedt zum Aufhoeren ein.
 */
const REFERENZ = Number(process.env.FB_PROSA_REFERENZ || 21);

// Nur Quelltext hat Kommentare in dieser Form. Ein Lesevorgang auf eine .json
// oder .md wird gar nicht erst gewertet: Dort gibt es kein `//`.
const KEIN_JS = /\.(json|md|sql|ya?ml|css|txt|conf|env)$/i;

/** Formen, die Dateiinhalt an einen Namen binden. */
const BINDUNG = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;]*?(?:readFileSync|\blies)\s*\([^;]*)/g;

/** Formen, die in einer Zeichenkette suchen. */
const SUCHE = (name) => new RegExp(
    // /re/.test(X) und /re/.exec(X)
    `\\.(?:test|exec)\\s*\\(\\s*${name}\\b`
    // X.match(...), X.includes(...), X.replace(...) …
    + `|\\b${name}\\s*\\.\\s*(?:match|matchAll|search|includes|indexOf|replace|split)\\s*\\(`,
    'g');

/** Dieselben Suchen, aber direkt auf einem Lesevorgang ohne Namen. */
const SUCHE_DIREKT = new RegExp(
    `\\.(?:test|exec)\\s*\\(\\s*(?:fs\\.)?(?:readFileSync|lies)\\s*\\(`
    + `|(?:fs\\.)?(?:readFileSync|lies)\\s*\\([^)]*\\)\\s*\\.\\s*(?:match|matchAll|search|includes|indexOf|replace|split)\\s*\\(`,
    'g');

/**
 * Schneidet die Anweisung um eine Fundstelle heraus.
 *
 * ── Warum nicht zeilenweise ─────────────────────────────────────────────────
 *
 * Genau die Schreibweise dieses Hauses laeuft ueber mehrere Zeilen:
 *
 *     pruefe(!/.../.test(ohneKommentare(migration)),
 *            'Die Migration destrukturiert nicht');
 *
 * Zeilenweise gelesen waere der Schutz bei einem Umbruch unsichtbar und der
 * Waechter faelschlich gemeldet.
 *
 * ── Warum nicht ueber die Klammertiefe (Fehlschlag vom 2026-08-31) ──────────
 *
 * Die erste Fassung sammelte Zeilen, bis die Klammern aufgingen. Das schien zu
 * stimmen, bis es an den Waechtern lief, die in `(async () => { ... })()`
 * liegen: Deren oeffnende Klammer schliesst erst in der LETZTEN Zeile — die
 * ganze Datei wurde eine einzige Anweisung. Damit meldete es die falsche Zeile,
 * und schlimmer: ein `ohneKommentare` irgendwo in der Datei erklaerte JEDE
 * Suche darin fuer sauber. Ein Messfehler, der zu wenig meldet, ist der teure.
 *
 * Deshalb der Schnitt an `;` `{` `}` — das ist die Anweisungsgrenze, egal wie
 * tief sie liegt.
 */
const GRENZE = /[;{}]/;

function anweisungUm(code, pos) {
    let a = pos;
    while (a > 0 && !GRENZE.test(code[a - 1])) a--;
    let e = pos;
    while (e < code.length && !GRENZE.test(code[e])) e++;
    return code.slice(a, e);
}

const zeileVon = (code, pos) => code.slice(0, pos).split('\n').length;

/**
 * Sauber ist eine Stelle, wenn der Text vor der Suche von Kommentaren befreit
 * wird — ueber den gemeinsamen Helfer ODER mit der Ersetzung an Ort und Stelle.
 * Das zweite kommt vor (check-streaming-probe) und ist nicht falsch, nur nicht
 * geteilt.
 */
function geschuetzt(text) {
    if (/ohneKommentare/i.test(text)) return true;
    return text.includes('/*[\\s\\S]*?\\*/') || text.includes('\\/\\/.*$');
}

/**
 * Der Pfad, der gelesen wird — 'utf8' ist keiner, und ein Ausschnitt aus einem
 * regulaeren Ausdruck (`\\/verbindungen`) auch nicht. Verlangt wird eine
 * Dateiendung; das ist die Form, die ein gelesener Pfad hier immer hat.
 */
function lesePfad(ausdruck) {
    const alle = [...ausdruck.matchAll(/['"`]([^'"`\n]+)['"`]/g)].map(m => m[1]);
    return alle.find(s => /\.\w{2,5}$/.test(s) && !s.startsWith('\\')) || '';
}

/**
 * Eine Bindung, deren rechte Seite eine FUNKTION ist, haelt keinen Inhalt —
 * sie ist der Leser selbst (`const lies = (p) => fs.readFileSync(...)`).
 *
 * Ohne diese Unterscheidung wurde `lies` als Inhaltsname gefuehrt und jeder
 * Aufruf doppelt gemeldet: einmal als Suche auf `lies`, einmal als Suche ohne
 * Namen. Beim ersten Lauf am 2026-08-31 aufgefallen.
 */
const istFunktion = (ausdruck) =>
    /=\s*(?:async\s+)?function\b/.test(ausdruck)
    || /=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.test(ausdruck);

function pruefeDatei(datei) {
    const code = ohneKommentare(fs.readFileSync(datei, 'utf8'));

    const eigeneKopie = /(?:function|const|let|var)\s+ohneKommentare\w*\s*[=(]/.test(code);
    const inhaltsNamen = new Map(); // Name → { sauber, pfad }
    const befunde = [];

    BINDUNG.lastIndex = 0;
    let m;
    while ((m = BINDUNG.exec(code)) !== null) {
        const anweisung = anweisungUm(code, m.index);
        if (istFunktion(m[0])) continue;
        const pfad = lesePfad(m[0]);
        if (pfad && KEIN_JS.test(pfad)) continue;
        inhaltsNamen.set(m[1], { sauber: geschuetzt(anweisung), pfad });
    }

    const gemeldet = new Set();
    for (const [name, wie] of inhaltsNamen) {
        if (wie.sauber) continue;
        const re = SUCHE(name);
        let t;
        while ((t = re.exec(code)) !== null) {
            const anweisung = anweisungUm(code, t.index);
            if (geschuetzt(anweisung)) continue;
            const zeile = zeileVon(code, t.index);
            const schluessel = `${name}@${zeile}`;
            if (gemeldet.has(schluessel)) continue;
            gemeldet.add(schluessel);
            befunde.push({ zeile, name, pfad: wie.pfad, stelle: kurz(anweisung) });
        }
    }

    SUCHE_DIREKT.lastIndex = 0;
    while ((m = SUCHE_DIREKT.exec(code)) !== null) {
        const anweisung = anweisungUm(code, m.index);
        if (geschuetzt(anweisung)) continue;
        const pfad = lesePfad(anweisung);
        if (pfad && KEIN_JS.test(pfad)) continue;
        befunde.push({ zeile: zeileVon(code, m.index), name: '(ohne Namen)', pfad, stelle: kurz(anweisung) });
    }

    befunde.sort((a, b) => a.zeile - b.zeile);
    return { eigeneKopie, befunde };
}

function kurz(text) {
    const eine = text.replace(/\s+/g, ' ').trim();
    return eine.length > 100 ? eine.slice(0, 97) + '…' : eine;
}

// ── Lauf ────────────────────────────────────────────────────────────────────

const dateien = fs.readdirSync(path.join(WURZEL, 'scripts'))
    .filter(n => n.startsWith('check-') && n.endsWith('.js') && n !== SELBST)
    .sort();

console.log(`\nWaechter durchgesehen: ${dateien.length}\n`);

let mitBefund = 0;
let stellen = 0;
const eigeneKopien = [];

for (const name of dateien) {
    const { eigeneKopie, befunde } = pruefeDatei(path.join(WURZEL, 'scripts', name));
    if (eigeneKopie) eigeneKopien.push(name);

    if (!befunde.length) {
        if (ALLE) console.log(`  ✓ ${name}`);
        continue;
    }
    mitBefund++;
    stellen += befunde.length;
    console.log(`  ✗ ${name} — ${befunde.length} Stelle(n) im rohen Inhalt`);
    for (const b of befunde) {
        console.log(`      Zeile ${b.zeile}: ${b.name}${b.pfad ? `  ← ${b.pfad}` : ''}`);
        console.log(`         ${b.stelle}`);
    }
}

console.log(`\nWaechter mit Suche im rohen Inhalt: ${mitBefund} (${stellen} Stellen) · Referenzstand ${REFERENZ}`);

if (eigeneKopien.length) {
    console.log(`\nEigene Kopie von ohneKommentare (gehoert nach scripts/lib/quelltext.js): ${eigeneKopien.length}`);
    for (const n of eigeneKopien) console.log(`  · ${n}`);
}

console.log(`
Ein Befund ist ein VERDACHT. Wer im rohen Inhalt sucht, WEIL er einen Kommentar
sucht, hat recht — dann gehoert der Grund an die Stelle, damit der naechste
Durchgang nicht dieselbe Frage neu stellt.
`);

if (mitBefund > REFERENZ) {
    console.error(`✘ Es sind MEHR geworden: ${mitBefund} statt ${REFERENZ}.`);
    process.exit(1);
}
