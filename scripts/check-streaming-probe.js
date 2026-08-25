#!/usr/bin/env node
/**
 * Prueft die Probeankuendigung - und, allgemeiner, dass kein Recht ohne
 * Aufrufer herumliegt.
 *
 * **Der Anlass.** `STREAMING.TEST` stand seit Stufe 1 in `permissions.json`,
 * war im Rechtekatalog sichtbar, liess sich Gruppen zuteilen - und wurde an
 * **keiner einzigen Stelle** geprueft. Ein Recht ohne Aufrufer ist schlimmer
 * als ein fehlendes: Es sieht nach Absicherung aus. Wer es vergibt, glaubt
 * etwas erlaubt zu haben; wer es entzieht, glaubt etwas gesperrt zu haben.
 * Beide irren.
 *
 * Regel 1 ist deshalb bewusst **allgemein** und nicht auf `TEST` gemuenzt: Der
 * naechste Fall dieser Art soll auffallen, bevor jemand danach sucht.
 *
 * Vier Regeln:
 *
 *   1. Jedes Recht aus permissions.json wird irgendwo geprueft oder benutzt
 *   2. Die Probe schreibt NICHT in `streaming_messages`
 *   3. Die Probe veroeffentlicht NIE
 *   4. Die Proberoute prueft, dass das Ziel dieser Guild gehoert
 *
 *   node scripts/check-streaming-probe.js
 *
 * Exitcode 1 bei jeder Verletzung.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const WURZEL = path.join(__dirname, '../plugins/streaming');
let verstoesse = 0;

/**
 * Inhalt ohne Kommentare - ein Waechter muss lesen, was laeuft, nicht was
 * dasteht. (Die Lehre vom 2026-08-25, zweimal.)
 *
 * @param {string} rel Pfad unterhalb des Plugins
 * @returns {string} nur Code
 */
function liesCode(rel) {
    return fs.readFileSync(path.join(WURZEL, rel), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n').map(z => z.replace(/\/\/.*$/, '')).join('\n');
}

/**
 * @param {string} ordner Startordner
 * @returns {Array<string>} relative Pfade von .js und .ejs
 */
function dateien(ordner = '') {
    const voll = path.join(WURZEL, ordner);
    if (!fs.existsSync(voll)) return [];
    return fs.readdirSync(voll, { withFileTypes: true }).flatMap(e => {
        const rel = path.join(ordner, e.name);
        if (e.isDirectory()) return dateien(rel);
        return /\.(js|ejs)$/.test(e.name) ? [rel] : [];
    });
}

/**
 * @param {string} regel Beschreibung
 * @param {Array<string>} fehler Fundstellen
 */
function melde(regel, fehler) {
    if (!fehler.length) { console.log(`  ✓ ${regel}`); return; }
    verstoesse += fehler.length;
    console.log(`  ✗ ${regel}`);
    fehler.forEach(f => console.log(`      ${f}`));
}

console.log('\nRechte ohne Aufrufer');

melde('Jedes Recht aus permissions.json wird auch durchgesetzt', (() => {
    const katalog = JSON.parse(fs.readFileSync(path.join(WURZEL, 'dashboard/permissions.json'), 'utf8'));

    // **Zwei Sorten Fundstelle, und der Unterschied ist der ganze Punkt.**
    //
    // Eine Ansicht, die `hasPermission('X')` fragt, blendet einen Knopf aus.
    // Das ist Hoeflichkeit, keine Sperre - im Kopf von guild.router.js steht
    // das ausdruecklich. Nur der Router (`requirePermission`) und die
    // Navigation (`capability`) setzen wirklich durch.
    //
    // Die erste Fassung dieser Regel zaehlte beides gleich. Bei der
    // Gegenprobe am 2026-08-25 nahm ich der Proberoute das Recht weg - und
    // die Regel blieb gruen, weil der Knopf in der Ansicht es noch nannte.
    // Genau der Zustand, den sie finden soll: sichtbar, aber ungesichert.
    const durchsetzend = dateien('dashboard/routes').concat(['dashboard/index.js'])
        .map(rel => liesCode(rel)).join('\n');

    const zeigend = dateien('dashboard/views')
        .map(rel => liesCode(rel)).join('\n');

    const nennt = (text, key) => text.includes(`'${key}'`) || text.includes(`"${key}"`);

    return katalog.permissions.flatMap(p => {
        if (nennt(durchsetzend, p.key)) return [];
        if (nennt(zeigend, p.key)) {
            return [`${p.key} ("${p.name}") wird NUR in einer Ansicht abgefragt — Knopf ausgeblendet, Route offen`];
        }
        return [`${p.key} ("${p.name}") wird nirgends geprueft — ein Recht, das nichts tut`];
    });
})());

console.log('\nDie Probe');

const drossel = liesCode('dashboard/ausgabe/drossel.js');

// Den Zweig herausschneiden, damit die Regeln nur ihn betreffen und nicht die
// echte Ankuendigung darueber.
const probeZweig = (() => {
    const start = drossel.indexOf("if (auftrag.aktion === 'probe')");
    if (start < 0) return null;

    // **Ueber Klammern schneiden, nicht ueber einen Kommentar.** Die erste
    // Fassung suchte das Ende an der Zeile "// Bearbeiten und Aufraeumen" -
    // in einem Text, aus dem `liesCode` die Kommentare gerade entfernt hatte.
    // Der Schnitt griff nie, der "Probezweig" reichte bis ans Dateiende, und
    // die Regel meldete brav den `streaming_messages`-Zugriff des Aufraeumens.
    // Ein Waechter, der zu viel liest, meldet Falsches - und Falsches wird
    // weggeklickt.
    const auf = drossel.indexOf('{', start);
    if (auf < 0) return null;

    let tiefe = 0;
    for (let i = auf; i < drossel.length; i++) {
        if (drossel[i] === '{') tiefe++;
        else if (drossel[i] === '}') {
            tiefe--;
            if (tiefe === 0) return drossel.slice(start, i + 1);
        }
    }
    return null;
})();

melde('Der Zweig fuer die Probe existiert',
    probeZweig ? [] : ["kein `if (auftrag.aktion === 'probe')` in drossel.js"]);

if (probeZweig) {
    // Regel 2: Ein Eintrag in streaming_messages waere der teuerste Fehler
    // hier - ein spaeterer echter Stream hielte die Probe fuer seine
    // Ankuendigung und wuerde sie bearbeiten oder aufraeumen.
    melde('Die Probe schreibt nicht in streaming_messages',
        /streaming_messages/.test(probeZweig)
            ? ['der Probezweig fasst streaming_messages an'] : []);

    // Regel 3: Ein Crosspost geht an alle folgenden Server und ist nicht
    // zurueckholbar.
    melde('Die Probe veroeffentlicht nie',
        /veroeffentlichen:\s*false/.test(probeZweig)
            ? [] : ['der Probezweig setzt `veroeffentlichen: false` nicht ausdruecklich']);

    // Regel 3b: **Beide Vorlagen muessen probierbar sein.** Die erste Fassung
    // kannte nur die Ankuendigung - also genau die Haelfte dessen, was das
    // Plugin schreibt. Wer den Text nach dem Stream aendert, konnte ihn bis
    // zum 2026-08-25 nur im Ernstfall sehen, also fruehestens beim naechsten
    // Streamende.
    melde('Die Probe kann Ankuendigung UND Rueckschau', (() => {
        const fehler = [];
        if (!/nachricht\.live\(/.test(probeZweig))       fehler.push('der Probezweig baut keine Ankuendigung');
        if (!/nachricht\.rueckschau\(/.test(probeZweig)) fehler.push('der Probezweig baut keine Rueckschau — die Haelfte der Vorlagen bliebe ungetestet');
        return fehler;
    })());
}

console.log('\nDie Route');

const router = liesCode('dashboard/routes/guild.router.js');
const routeZeile = router.split('\n').find(z => z.includes("'/ziele/:id/probe'"));

melde('Die Proberoute verlangt STREAMING.TEST',
    routeZeile && /requirePermission\('STREAMING\.TEST'\)/.test(routeZeile)
        ? [] : ['Route /ziele/:id/probe fehlt oder prueft das Recht nicht']);

// Regel 4: Das Recht sagt "darf proben", nicht "darf in JEDEN Kanal posten".
// Die Ziel-ID steht in der Adresszeile; ohne Zugehoerigkeitspruefung koennte
// jemand aus seiner Guild in den Kanal einer fremden senden.
melde('Die Proberoute prueft die Zugehoerigkeit zur Guild', (() => {
    const start = router.indexOf("'/ziele/:id/probe'");
    if (start < 0) return ['Route nicht gefunden'];
    const block = router.slice(start, start + 1800);
    return /zielLesen\(\s*guildId\s*,/.test(block)
        ? [] : ['kein `zielLesen(guildId, …)` — die Ziel-ID aus der Adresszeile wird nicht gegen die Guild geprueft'];
})());

console.log('\nDie Nachbarschaft');

// ---------------------------------------------------------------------------
// **Der teuerste Fehler dieses Tages, und er stand in keinem Pruefskript.**
//
// Am 2026-08-25 landete "Probe senden" in derselben Fusszeile wie "Dieses Ziel
// entfernen". Der Betreiber wollte proben und loeschte sein Ziel - mit ihm
// gingen die drei Twitch-Abos, weil es das letzte Ziel fuer diesen Kanal war.
// Danach rutschte der naechste Streamer auf denselben Platz, und der zweite
// Klick traf den Falschen.
//
// Ein Bestaetigungsdialog rettet das nicht: Wer den Knopf trifft, den er
// treffen wollte, klickt den Dialog weg. Die Trennung muss raeumlich sein.
// ---------------------------------------------------------------------------
melde('Das Loeschen steht allein in seiner Fusszeile', (() => {
    const ansicht = fs.readFileSync(
        path.join(WURZEL, 'dashboard/views/guild/streaming-ziele.ejs'), 'utf8');

    const stelle = ansicht.indexOf('/entfernen"');
    if (stelle < 0) return ['Formular zum Entfernen nicht gefunden'];

    // Rueckwaerts bis zur oeffnenden Fusszeile, vorwaerts bis zu ihrem Ende.
    const anfang = ansicht.lastIndexOf('card-footer', stelle);
    if (anfang < 0) return ['Formular zum Entfernen steht in keiner card-footer'];

    const naechsteFusszeile = ansicht.indexOf('card-footer', stelle);
    const block = ansicht.slice(anfang, naechsteFusszeile > 0 ? naechsteFusszeile : ansicht.length);

    const formulare = (block.match(/<form\b/g) || []).length;
    return formulare === 1
        ? []
        : [`in der Fusszeile des Loeschens stehen ${formulare} Formulare — eine zerstoerende Handlung darf nicht neben einer alltaeglichen sitzen`];
})());

console.log(verstoesse === 0
    ? '\nErgebnis: 0 Verstoesse.\n'
    : `\nErgebnis: ${verstoesse} Verstoss/Verstoesse.\n`);

process.exit(verstoesse === 0 ? 0 : 1);
