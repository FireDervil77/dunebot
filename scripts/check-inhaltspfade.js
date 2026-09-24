#!/usr/bin/env node
/**
 * Landen Mods, Plugins und Modpacks dort, wo das Spiel sie liest?
 *
 * ── Warum es diesen Waechter gibt (2026-09-24) ──────────────────────────────
 *
 * Inhaltspfade im Paket gelten ab der WURZEL des Volumes, nicht ab dem Ordner,
 * in dem das Spiel laeuft. Valheim nennt deshalb `game/BepInEx/plugins`. Das
 * Minecraft-Paket nannte `mods` und `plugins` — und der Modpack-Weg im Daemon
 * schrieb die Pfade eines `.mrpack` ebenfalls an die Wurzel.
 *
 * Auf Server 202 lagen danach 146 Mods in `/home/container/mods`, `game/mods`
 * war leer, und Forge startete sauber bis „Done" — ohne eine einzige Mod und
 * ohne eine Fehlerzeile. **Nichts meldet diesen Fehler**; man sieht ihn nur im
 * Spiel. Genau deshalb steht er hier.
 *
 * Geprueft wird:
 *   1. jeder Inhaltspfad jedes Pakets liegt im Spielordner (`DirGame`)
 *   2. der Modpack-Weg im Daemon schreibt unter denselben Ordner
 *
 * Der Name des Spielordners wird aus dem Verzeichnisvertrag des Daemons
 * gelesen (`pkg/protocol/volume.go`), nicht hier wiederholt.
 *
 *   node scripts/check-inhaltspfade.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { ohneKommentare } = require('./lib/quelltext');

const WURZEL = path.join(__dirname, '..');
const DAEMON = '/home/firedervil/firebot_daemon';

let fehler = 0;
const pruefe = (ok, was, zusatz = '') => {
    console.log(`  ${ok ? '✅' : '❌'} ${was}${zusatz ? '\n       ' + zusatz : ''}`);
    if (!ok) fehler++;
};

// ── Der Vertrag ─────────────────────────────────────────────────────────────
const vertrag = ohneKommentare(fs.readFileSync(path.join(DAEMON, 'pkg/protocol/volume.go'), 'utf8'));
const dirGame = (vertrag.match(/\bDirGame\s*=\s*"([^"]+)"/) || [])[1];
console.log(`\n▸ Der Spielordner laut Vertrag: ${dirGame || '—'}`);
if (!dirGame) {
    pruefe(false, 'DirGame in pkg/protocol/volume.go gefunden');
    process.exit(1);
}

/** Alle `path`-Angaben im Inhaltsvertrag, mit Fundort. */
function pfadeIn(knoten, ort, raus = []) {
    if (!knoten || typeof knoten !== 'object') return raus;
    if (typeof knoten.path === 'string') raus.push({ ort: `${ort}.path`, pfad: knoten.path });
    for (const [k, v] of Object.entries(knoten)) {
        if (v && typeof v === 'object') pfadeIn(v, `${ort}.${k}`, raus);
    }
    return raus;
}

const imSpielordner = (p) => p === dirGame || p.startsWith(dirGame + '/');

// ── 1. Die Pakete ───────────────────────────────────────────────────────────
console.log('\n▸ Jeder Inhaltspfad liegt im Spielordner');
const ordner = path.join(WURZEL, 'packages/fbpkg/beispiele');
let gezaehlt = 0;
for (const datei of fs.readdirSync(ordner).filter(d => d.endsWith('.json')).sort()) {
    const paket = JSON.parse(fs.readFileSync(path.join(ordner, datei), 'utf8'));
    const pfade = pfadeIn(paket.content, 'content');
    if (pfade.length === 0) {
        console.log(`  ·  ${datei}: kein Inhaltspfad (das Paket nimmt keine Inhalte)`);
        continue;
    }
    for (const { ort, pfad } of pfade) {
        gezaehlt++;
        pruefe(imSpielordner(pfad), `${datei}  ${ort} = "${pfad}"`,
            imSpielordner(pfad) ? '' : `liegt neben dem Spiel — richtig waere "${dirGame}/${pfad}"`);
    }
}
pruefe(gezaehlt > 0, `mindestens ein Inhaltspfad wurde geprueft (${gezaehlt})`,
    'Sonst waere dieser Waechter gruen, weil er nichts findet');

// ── 2. Der Modpack-Weg im Daemon ────────────────────────────────────────────
console.log('\n▸ Der Modpack-Weg schreibt in den Spielordner (internal/gameserver/modpack.go)');
const modpack = ohneKommentare(fs.readFileSync(path.join(DAEMON, 'internal/gameserver/modpack.go'), 'utf8'));
pruefe(/\bmodpackWurzel\s*=\s*protocol\.DirGame\b/.test(modpack),
    'modpackWurzel ist an protocol.DirGame gebunden');
const schreibstellen = modpack.match(/rel\s*:=\s*path\.Join\([^)]*\)/g) || [];
pruefe(schreibstellen.length >= 2 && schreibstellen.every(z => /modpackWurzel/.test(z)),
    `jede Schreibstelle setzt modpackWurzel davor (${schreibstellen.length} gefunden)`,
    schreibstellen.filter(z => !/modpackWurzel/.test(z)).join('  ·  '));

console.log(fehler ? `\n${fehler} Befund(e).\n` : '\nAlles gruen.\n');
process.exit(fehler ? 1 : 0);
