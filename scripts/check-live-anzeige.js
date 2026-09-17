#!/usr/bin/env node
/**
 * Haengt die Live-Anzeige ueberhaupt an der Seite?
 *
 * ── Der Befund, der dazu fuehrte (2026-09-08) ───────────────────────────────
 *
 * Der Betreiber: "die ansichtseite wenn man den server startet aktualisiert
 * ihren status so wie die bereitschaft nicht in echtzeit. das bemerke ich wie
 * die live stats schon seit beginn des projektes."
 *
 * `gameserver-live.js` war vollstaendig gebaut, wurde von zwei Seiten geladen -
 * und startete nie. Es sucht beim Aufbau `[data-fb-live-guild]`, und dieses
 * Attribut stand in KEINER Vorlage des Projekts. Ein `return` ohne Meldung.
 *
 * Geprueft wird deshalb dreierlei:
 *
 *   1. Es gibt mindestens eine Vorlage mit `data-fb-live-guild`.
 *   2. Jede Feldart, die eine Vorlage benutzt, kennt das Modul auch.
 *   3. Jede Feldart, die das Modul kennt, wird irgendwo benutzt - sonst ist es
 *      vorbereiteter toter Platz, und der faellt beim ersten Einsatz um.
 *
 * ── Was am 2026-09-17 dazukam (Baustelle 134) ───────────────────────────────
 *
 * Dieser Waechter stand GRUEN, waehrend die halbe Uebersichtsseite still
 * stand. Er prueft Modul gegen Vorlage - aber niemand prueft, ob die ROUTE und
 * ihre Vorlage zusammenpassen. `servers-overview.ejs` hatte weder Haken noch
 * Felder, obwohl ihre Route `gameserver-live` einreiht: Das Modul wurde
 * geladen und stieg beim ersten `if` wieder aus.
 *
 * Und die Knoepfe: `data-fb-live="aktionen"` bedient KINDER mit
 * `data-fb-aktion`. Stimmen deren Namen nicht mit denen im Modul ueberein,
 * passiert wieder nichts - lautlos.
 *
 *   4. Jede Route, die `gameserver-live` einreiht, rendert eine Vorlage mit
 *      Haken (direkt oder ueber ein eingebundenes Teil).
 *   5. Die Aktionsnamen in Vorlage und Modul sind dieselben.
 *
 *   node scripts/check-live-anzeige.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
// ── Warum nicht roh gegrept wird (2026-09-17) ───────────────────────────────
//
// Die Gegenprobe zu dieser Pruefung fiel durch: Ich nahm den Haken aus
// `servers-overview.ejs` heraus, und der Waechter blieb GRUEN - weil direkt
// darueber ein Kommentar steht, der `data-fb-live-guild` erklaert. Er fand die
// Prosa und hielt sie fuer Code. Genau die Richtung, die stillschweigend
// durchgeht.
const { ohneKommentare, ohneKommentareEjs } = require('./lib/quelltext');

const WURZEL = path.join(__dirname, '..');
const MODUL = path.join(WURZEL, 'plugins/gameserver/dashboard/assets/js/gameserver-live.js');
const ANSICHTEN = path.join(WURZEL, 'plugins/gameserver/dashboard/views');

let fehler = 0;
const pruefe = (ok, was, zusatz = '') => {
    console.log(`  ${ok ? '✅' : '❌'} ${was}${zusatz ? '\n       ' + zusatz : ''}`);
    if (!ok) fehler++;
};

/** Alle .ejs unterhalb eines Verzeichnisses. */
function vorlagen(verzeichnis, treffer = []) {
    for (const e of fs.readdirSync(verzeichnis, { withFileTypes: true })) {
        const voll = path.join(verzeichnis, e.name);
        if (e.isDirectory()) vorlagen(voll, treffer);
        else if (e.name.endsWith('.ejs')) treffer.push(voll);
    }
    return treffer;
}

const dateien = vorlagen(ANSICHTEN);
const quelle = fs.readFileSync(MODUL, 'utf8');

/** Eine Vorlage ohne ihre Kommentare - das, was der Browser wirklich sieht. */
const vorlageCode = (datei) => ohneKommentareEjs(fs.readFileSync(datei, 'utf8'));

// Was das Modul zeichnen kann: die Faelle im switch.
// Kommentare vorher weg - im Kopf dieser Datei stehen die Namen als Prosa.
const modulOhneKommentare = ohneKommentare(quelle);
const kann = new Set([...modulOhneKommentare.matchAll(/case\s+'([a-z-]+)':/g)].map(t => t[1]));

// Was die Vorlagen verlangen.
const benutzt = new Map();
let mitHaken = [];
for (const datei of dateien) {
    const text = vorlageCode(datei);
    if (/data-fb-live-guild/.test(text)) mitHaken.push(path.relative(WURZEL, datei));
    for (const t of text.matchAll(/data-fb-live="([a-z-]+)"/g)) {
        if (!benutzt.has(t[1])) benutzt.set(t[1], []);
        benutzt.get(t[1]).push(path.relative(WURZEL, datei));
    }
}

// ── 0. Uebersetzen die Vorlagen ueberhaupt? ─────────────────────────────────
//
// Am 2026-09-17 stand dieser Waechter gruen, waehrend `server-detail.ejs` sich
// nicht mehr uebersetzen liess: In einem KOMMENTAR standen EJS-Zeichen, und
// der Kommentar endete damit fuer den Uebersetzer an der falschen Stelle. Die
// Seite haette beim ersten Aufruf einen Fehler geworfen — gefunden hat es nicht
// eine Pruefung, sondern der Versuch, sie zu uebersetzen.
//
// Eine Auszeichnungspruefung an einer Datei, die gar nicht laedt, misst nichts.
// Deshalb steht das hier vorn und nicht hinten.
console.log('\n▸ Die Vorlagen lassen sich uebersetzen');
let ejs = null;
try { ejs = require('ejs'); } catch { /* ohne ejs wird dieser Teil uebersprungen */ }
if (!ejs) {
    pruefe(false, 'ejs ist nicht ladbar',
        'ohne die Uebersetzungsprobe pruefen die naechsten Abschnitte Auszeichnung '
        + 'in Dateien, die vielleicht gar nicht laden');
} else {
    for (const datei of dateien) {
        const kurz = path.relative(WURZEL, datei);
        try {
            ejs.compile(fs.readFileSync(datei, 'utf8'), { filename: datei });
        } catch (e) {
            pruefe(false, kurz, String(e.message).split('\n')[0]);
        }
    }
    pruefe(true, `${dateien.length} Vorlagen uebersetzt`);
}

console.log('\n▸ Die Live-Anzeige haengt an einer Seite');
pruefe(mitHaken.length > 0,
    'Mindestens eine Vorlage traegt data-fb-live-guild',
    mitHaken.join(', ') || 'KEINE — das Modul startet nicht, ohne etwas zu melden');

console.log('\n▸ Vorlage und Modul kennen dieselben Felder');
for (const [art, wo] of benutzt) {
    pruefe(kann.has(art), `"${art}" wird gezeichnet`,
        kann.has(art) ? '' : `benutzt in ${wo.join(', ')}, aber kein Fall im Modul`);
}
for (const art of kann) {
    pruefe(benutzt.has(art), `"${art}" wird auch benutzt`,
        benutzt.has(art) ? '' : 'das Modul kann es, keine Vorlage verlangt es');
}

// ── 4. Route und Vorlage passen zusammen ────────────────────────────────────
//
// Eine Route, die das Modul einreiht, muss auch eine Seite rendern, an der es
// sich einhaengen kann. Sonst laedt der Browser Code, der sofort aussteigt.
console.log('\n▸ Jede Route, die das Modul einreiht, rendert eine Seite mit Haken');

// Welche Vorlage traegt den Haken - direkt oder ueber ein eingebundenes Teil?
const hakenDirekt = new Set();
const eingebunden = new Map();   // Vorlage → [eingebundene Teile]
for (const datei of dateien) {
    const text = vorlageCode(datei);
    const name = path.relative(ANSICHTEN, datei).replace(/\.ejs$/, '');
    if (/data-fb-live-guild/.test(text)) hakenDirekt.add(name);
    const teile = [...text.matchAll(/include\(\s*['"]([^'"]+)['"]/g)]
        .map(m => m[1].replace(/^\.\//, '').replace(/\.ejs$/, ''));
    eingebunden.set(name, teile);
}

/** Traegt diese Vorlage den Haken, oder eine, die sie einbindet? */
function hatHaken(name, gesehen = new Set()) {
    if (hakenDirekt.has(name)) return true;
    if (gesehen.has(name)) return false;      // Kreise kosten keine Endlosschleife
    gesehen.add(name);
    // Ein Teil zaehlt als gedeckt, wenn eine Seite MIT Haken es einbindet.
    for (const [seite, teile] of eingebunden) {
        if (teile.some(x => x === name || x.endsWith('/' + name))) {
            if (hatHaken(seite, gesehen)) return true;
        }
    }
    return false;
}

const routenDateien = [];
(function sammle(v) {
    for (const e of fs.readdirSync(v, { withFileTypes: true })) {
        const voll = path.join(v, e.name);
        if (e.isDirectory()) sammle(voll);
        else if (e.name.endsWith('.js')) routenDateien.push(voll);
    }
})(path.join(WURZEL, 'plugins/gameserver/dashboard/routes'));

// ── Je ROUTE messen, nicht je Datei ─────────────────────────────────────────
//
// Beim ersten Bau dieser Pruefung (2026-09-17) stand hier ein Test ueber die
// ganze Datei: "kommt `gameserver-live` darin vor" und "welche Vorlagen rendert
// sie". In `servers.js` liegen aber ALLE Routen zusammen - also meldete der
// Waechter die drei Anlege-Schritte und die Bearbeiten-Seite als kaputt, die
// das Modul nie eingereiht haben. Vier Fehlalarme, und ein Waechter, dem man
// nach dem ersten Fehlalarm nicht mehr glaubt, ist schlimmer als keiner.
//
// Deshalb wird der Text an jedem `router.<methode>(` geschnitten und jeder
// Abschnitt fuer sich gemessen.
function routenBloecke(text) {
    const grenzen = [...text.matchAll(/router\.(get|post|put|patch|delete)\s*\(/g)]
        .map(m => m.index);
    if (!grenzen.length) return [text];
    const bloecke = [];
    for (let i = 0; i < grenzen.length; i++) {
        bloecke.push(text.slice(grenzen[i], grenzen[i + 1] ?? text.length));
    }
    return bloecke;
}

let gefunden = 0;
for (const datei of routenDateien) {
    const text = ohneKommentare(fs.readFileSync(datei, 'utf8'));
    if (!/enqueueScript\(\s*['"]gameserver-live['"]/.test(text)) continue;

    for (const block of routenBloecke(text)) {
        if (!/enqueueScript\(\s*['"]gameserver-live['"]/.test(block)) continue;
        const gerendert = [...block.matchAll(/renderView\(\s*res\s*,\s*['"]([^'"]+)['"]/g)]
            .map(m => m[1])
            .filter(x => x !== 'error');
        if (!gerendert.length) {
            gefunden++;
            pruefe(false, `${path.relative(WURZEL, datei)} → (keine Vorlage erkannt)`,
                'reiht gameserver-live ein, aber in diesem Abschnitt findet sich kein renderView - '
                + 'nicht stillschweigend uebergehen, sondern nachsehen');
            continue;
        }
        for (const v of new Set(gerendert)) {
            gefunden++;
            pruefe(hatHaken(v), `${path.relative(WURZEL, datei)} → ${v}`,
                hatHaken(v) ? '' : 'reiht gameserver-live ein, aber die Vorlage traegt keinen data-fb-live-guild');
        }
    }
}
pruefe(gefunden > 0, 'Mindestens eine Route reiht das Modul ein',
    gefunden > 0 ? '' : 'keine gefunden - dann laeuft die Live-Anzeige nirgends');

// ── 5. Die Aktionsnamen stimmen ueberein ────────────────────────────────────
console.log('\n▸ Knopfzeile: Vorlage und Modul meinen dieselben Aktionen');
const inVorlagen = new Set();
for (const datei of dateien) {
    for (const m of vorlageCode(datei).matchAll(/data-fb-aktion="([a-z-]+)"/g)) {
        inVorlagen.add(m[1]);
    }
}
// Im Modul: die Aufrufe von `setze('...')` im Fall `aktionen`.
const imModul = new Set([...modulOhneKommentare.matchAll(/setze\(\s*'([a-z-]+)'/g)].map(m => m[1]));

if (inVorlagen.size === 0 && imModul.size === 0) {
    pruefe(true, 'Keine Knopfzeile vorhanden - nichts zu pruefen');
} else {
    for (const a of inVorlagen) {
        pruefe(imModul.has(a), `"${a}" wird vom Modul geschaltet`,
            imModul.has(a) ? '' : 'steht in einer Vorlage, das Modul kennt ihn nicht');
    }
    for (const a of imModul) {
        pruefe(inVorlagen.has(a), `"${a}" steht in einer Vorlage`,
            inVorlagen.has(a) ? '' : 'das Modul schaltet ihn, keine Vorlage hat den Knopf');
    }
}

console.log(fehler === 0
    ? '\n✅ Die Live-Anzeige ist eingehaengt und vollstaendig\n'
    : `\n❌ ${fehler} Abweichung(en)\n`);
process.exit(fehler === 0 ? 0 : 1);
