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
 * Die BEKANNTEN Waechter, die im rohen Inhalt suchen — namentlich.
 *
 * ── Warum eine Liste und nicht mehr eine Zahl (2026-09-22) ──────────────────
 *
 * Hier stand `const REFERENZ = 21`, gemessen am 2026-08-31 — damals bei **62**
 * Waechtern. Heute sind es 103, und damit war die Zahl kein Mass mehr, sondern
 * ein Datum: Jeder neue Waechter, der aus gutem Grund im Rohtext liest, machte
 * diesen hier rot. Er stand drei Tage rot, und der Betreiber hat es zu Recht
 * angesprochen: **Ein Waechter, der dauerhaft rot steht, erzieht dazu, Rot zu
 * uebersehen.**
 *
 * Eine Zahl ist hier auch die falsche Form. 34 von 103 ist ein besseres
 * Verhaeltnis als 21 von 62 — trotzdem war die Zahl gestiegen. Und umgekehrt:
 * Wer einen Waechter repariert und gleichzeitig einen neuen mit derselben
 * Schwaeche dazulegt, haelt die Zahl und hat nichts gewonnen.
 *
 * Also die Namen. Dann gilt:
 *
 *   * **Ein NEUER Name ist ein Fehler** — auch wenn gleichzeitig einer wegfiel.
 *   * **Ein Name, der nicht mehr zutrifft, ist auch ein Fehler**, aber einer mit
 *     Gluecksgefuehl: Die Zeile hier gehoert geloescht. Sonst verrottet die
 *     Liste zu einer Behauptung ueber einen Zustand von vorgestern.
 *
 * Stand aufgenommen am 2026-09-22 (36 von 103). Nicht als Freispruch: Jeder
 * dieser Namen bleibt eine offene Aufgabe (B89). Die Liste sagt nur, dass sie
 * BEKANNT ist — nicht, dass sie in Ordnung ist.
 */
const BEKANNT = new Set([
    'check-adminlte.js',
    'check-anlagenkonten.js',
    'check-chatabos.js',
    'check-chatansage.js',
    'check-conduit.js',
    'check-consent.js',
    'check-daemon-meldung.js',    // rendert die echte Layout-Vorlage; EJS-Kommentare fallen beim Rendern weg
    'check-entwurfszustaende.js',
    'check-funktionskarte.js',
    'check-heimguild.js',
    'check-herkunftsliste.js',
    'check-html-balance.js',
    'check-inhalte-holen.js',
    'check-inline-skripte.js',
    'check-ipc-frist.js',
    'check-lader-vertrag.js',
    'check-live-anzeige.js',
    'check-meinkanal.js',
    'check-mitglieder-frist.js',
    'check-navigation-abschnitt.js',
    'check-paket-anlegbar.js',
    'check-panel-bauteile.js',
    'check-profil.js',
    'check-render-settings.js',
    'check-render-user.js',       // Rohtext nur für die Zeilennummer; gesucht wird ohne Kommentare
    'check-schalter.js',
    'check-seitenkopf.js',
    'check-sicherungsabruf.js',
    'check-sperrkette.js',
    'check-streaming-ansagen.js',
    'check-streaming-befehle.js',
    'check-streaming-melder.js',
    'check-streaming-mitmachen.js',
    'check-streaming-probe.js',
    'check-streaming-rechte.js',
    'check-streaming-schichten.js',
    'check-theme-assets.js',
    'check-verbindungen.js',
]);

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
// Die Namen, nicht nur ihre Anzahl — der Vergleich unten laeuft ueber sie.
const mitNamen = [];
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
    mitNamen.push(name);
    console.log(`  ✗ ${name} — ${befunde.length} Stelle(n) im rohen Inhalt`);
    for (const b of befunde) {
        console.log(`      Zeile ${b.zeile}: ${b.name}${b.pfad ? `  ← ${b.pfad}` : ''}`);
        console.log(`         ${b.stelle}`);
    }
}

console.log(`\nWaechter mit Suche im rohen Inhalt: ${mitBefund} (${stellen} Stellen) · bekannt ${BEKANNT.size}`);

if (eigeneKopien.length) {
    console.log(`\nEigene Kopie von ohneKommentare (gehoert nach scripts/lib/quelltext.js): ${eigeneKopien.length}`);
    for (const n of eigeneKopien) console.log(`  · ${n}`);
}

console.log(`
Ein Befund ist ein VERDACHT. Wer im rohen Inhalt sucht, WEIL er einen Kommentar
sucht, hat recht — dann gehoert der Grund an die Stelle, damit der naechste
Durchgang nicht dieselbe Frage neu stellt.
`);

// ── Namen vergleichen, nicht zaehlen ────────────────────────────────────────
const gefundeneNamen = new Set(mitNamen);
const neueNamen  = [...gefundeneNamen].filter(n => !BEKANNT.has(n)).sort();
const alteNamen  = [...BEKANNT].filter(n => !gefundeneNamen.has(n)).sort();

let raus = 0;
if (neueNamen.length) {
    raus = 1;
    console.error(`✘ NEU dazugekommen (${neueNamen.length}) — sie lesen den rohen Inhalt:`);
    for (const n of neueNamen) console.error(`    ${n}`);
    console.error('  Entweder `ohneKommentare` benutzen, oder — wenn der Rohtext gewollt ist —');
    console.error('  den Grund an die Stelle schreiben und den Namen oben in BEKANNT aufnehmen.');
}
if (alteNamen.length) {
    raus = 1;
    console.error(`${neueNamen.length ? '\n' : ''}✘ Diese Namen treffen nicht mehr zu (${alteNamen.length}) — Zeile oben loeschen:`);
    for (const n of alteNamen) console.error(`    '${n}',`);
    console.error('  Das ist die angenehme Sorte Rot: Jemand hat einen Waechter repariert.');
    console.error('  Eine Liste, die das nicht mitschreibt, behauptet einen Zustand von vorgestern.');
}

if (!raus) {
    console.log(`✅ Keine neuen, keine veralteten — die ${mitBefund} bekannten stehen als offene Aufgabe (B89).`);
}
process.exit(raus);
