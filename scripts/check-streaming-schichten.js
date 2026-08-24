#!/usr/bin/env node
/**
 * Prueft, dass die Schichten des Streaming-Plugins sauber getrennt bleiben.
 *
 * Der Fehler, den man hier einmal macht und nie wieder los wird: Twitch-
 * Vokabular durch das ganze Plugin ziehen. Dann passt YouTube nie hinein und
 * Kick schon gar nicht — und man merkt es erst, wenn die zweite Plattform
 * ansteht und der halbe Kern umgebaut werden muesste.
 *
 * Vier Regeln:
 *
 *   1. Twitch-Woerter nur in `plattformen/`
 *   2. IPC (`ipcServer`, `broadcast`) nur in `ausgabe/`
 *   3. Der Eingang ruft weder Discord noch IPC — er schreibt weg und antwortet
 *   4. `const [x] = await …query(…)` nirgends (Baustelle 63a)
 *
 *   node scripts/check-streaming-schichten.js
 *
 * Exitcode 1 bei jeder Verletzung.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const WURZEL = path.join(__dirname, '../plugins/streaming');
let verstoesse = 0;

/**
 * Alle .js-Dateien unterhalb eines Ordners.
 *
 * @param {string} ordner Startordner
 * @returns {Array<string>} Pfade
 */
function dateien(ordner) {
    if (!fs.existsSync(ordner)) return [];
    return fs.readdirSync(ordner, { withFileTypes: true }).flatMap(e => {
        const voll = path.join(ordner, e.name);
        if (e.isDirectory()) return dateien(voll);
        return e.name.endsWith('.js') ? [voll] : [];
    });
}

/**
 * Kommentare und Zeichenketten interessieren nicht — dort steht Begruendung,
 * kein Code. Sonst meldet jede Erklaerung einen Verstoss.
 *
 * @param {string} quelltext Inhalt
 * @returns {string} nur Code
 */
function ohneKommentare(quelltext) {
    return quelltext
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .map(z => z.replace(/\/\/.*$/, ''))
        .join('\n');
}

/**
 * @param {string} regel Beschreibung
 * @param {Array<{datei: string, zeile: number, text: string}>} treffer Fundstellen
 */
function melde(regel, treffer) {
    if (!treffer.length) {
        console.log(`  ✓ ${regel}`);
        return;
    }
    verstoesse += treffer.length;
    console.log(`  ✗ ${regel} — ${treffer.length} Fundstelle(n):`);
    treffer.forEach(t => console.log(`      ${t.datei}:${t.zeile}  ${t.text.trim().slice(0, 90)}`));
}

/**
 * Sucht ein Muster in Dateien, die einem Filter entsprechen.
 *
 * @param {RegExp} muster Suchmuster
 * @param {Function} gilt Filter auf den relativen Pfad
 * @returns {Array} Fundstellen
 */
function suche(muster, gilt) {
    const treffer = [];
    for (const datei of dateien(WURZEL)) {
        const rel = path.relative(WURZEL, datei);
        if (!gilt(rel)) continue;

        ohneKommentare(fs.readFileSync(datei, 'utf8')).split('\n').forEach((text, i) => {
            if (muster.test(text)) treffer.push({ datei: rel, zeile: i + 1, text });
        });
    }
    return treffer;
}

console.log('\nSchichten');

melde('Twitch-Vokabular nur in plattformen/',
    suche(/\btwitch[-.]?eventsub|broadcaster_user_id|helix|stream\.online|stream\.offline/i,
        rel => !rel.startsWith(path.join('dashboard', 'plattformen'))));

melde('IPC nur in ausgabe/',
    suche(/ipcServer|broadcastOne\(|\.broadcast\(/,
        rel => !rel.startsWith(path.join('dashboard', 'ausgabe'))
            && !rel.startsWith(path.join('dashboard', 'routes', '_shared'))));

// `res.send(...)` ist die Antwort an den Anbieter und voellig richtig — gesucht
// sind Discord-Aufrufe. Die erste Fassung dieser Regel meldete beides und
// haette dazu erzogen, Meldungen zu ignorieren.
melde('Der Eingang ruft weder Discord noch IPC',
    suche(/ipcServer|require\(['"]discord\.js|EmbedBuilder|channel\.send\(|\.messages\.fetch\(/,
        rel => rel === path.join('dashboard', 'routes', 'webhook.router.js')));

// Nur bei schreibenden Abfragen ein Fehler: Dort liefert `query` einen
// ResultSetHeader (ein Objekt), und Destrukturieren wirft. Bei einem SELECT ist
// `const [ersteZeile] = await query(...)` dagegen voellig richtig — die erste
// Fassung dieser Regel meldete auch das und war damit schlimmer als keine.
melde('Kein `const [x] = await …query(INSERT|UPDATE|DELETE)` (Baustelle 63a)',
    (() => {
        const treffer = [];
        for (const datei of dateien(WURZEL)) {
            const zeilen = ohneKommentare(fs.readFileSync(datei, 'utf8')).split('\n');
            zeilen.forEach((text, i) => {
                if (!/const\s*\[\s*\w+\s*\]\s*=\s*await\s+[\w.()]*query\(/.test(text)) return;
                // Das SQL steht oft in den naechsten Zeilen (Template-String).
                const umfeld = zeilen.slice(i, i + 4).join(' ');
                if (/\b(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(umfeld)) {
                    treffer.push({ datei: path.relative(WURZEL, datei), zeile: i + 1, text });
                }
            });
        }
        return treffer;
    })());

// Die Asymmetrie, die am 2026-08-24 eine Fehlersuche gekostet hat: Der Bot
// braucht eine INSTANZ, das Dashboard die KLASSE. Beides sieht im Quelltext
// fast gleich aus und faellt erst im Log des Bots auf.
console.log('\nExportform');
{
    const botIndex = fs.readFileSync(path.join(WURZEL, 'bot/index.js'), 'utf8');
    melde('bot/index.js exportiert eine Instanz (`new …()`)',
        /module\.exports\s*=\s*new\s+\w+\(\)/.test(botIndex) ? []
            : [{ datei: 'bot/index.js', zeile: 0, text: 'exportiert keine Instanz' }]);

    const dashIndex = fs.readFileSync(path.join(WURZEL, 'dashboard/index.js'), 'utf8');
    melde('dashboard/index.js exportiert die Klasse (kein `new`)',
        /module\.exports\s*=\s*new\s/.test(dashIndex)
            ? [{ datei: 'dashboard/index.js', zeile: 0, text: 'exportiert eine Instanz statt der Klasse' }] : []);
}

console.log(verstoesse === 0
    ? '\nErgebnis: 0 Verstoesse.\n'
    : `\nErgebnis: ${verstoesse} Verstoss/Verstoesse.\n`);

process.exit(verstoesse === 0 ? 0 : 1);
