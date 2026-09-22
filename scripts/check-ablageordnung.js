#!/usr/bin/env node
'use strict';

/**
 * Wächter: jedes Paket legt ab, wo es hingehört (Betreiberfrage 2026-09-22).
 *
 * ── Woher er kommt ───────────────────────────────────────────────────────────
 *
 * Der Betreiber sah im Dateimanager, dass zwischen den Spieldateien vier
 * Merkzettel liegen — `.fb-minecraft-version`, `-lader`, `-build`, `-modpack` —
 * und fragte:
 *
 *   „warum haben wir ein .fb verzeichnis, wenn die .fb dateien alle in dem game
 *    ordner landen? wenn du schon ordnung einplanst sollten wir diese auch
 *    durchsetzen."
 *
 * Er hatte recht, und der Daemon sagt es selbst (`pkg/protocol/volume.go`):
 *
 *   DirGame  = "game"    Spieldateien. **Ersetzbar** — jederzeit neu ladbar.
 *   DirData  = "data"    HOME des Spielprozesses. Das Erhaltenswerte.
 *   DirCache = "cache"   wird nie gesichert, darf jederzeit verschwinden.
 *   DirFB    = ".fb"     unsere Ablage: Rezeptstand, Prüfsummen, **Marker**.
 *                        Vom Spiel nie berührt, übersteht ein Zurücksetzen.
 *
 * Der Pfad steht als `FB_STATE_DIR` im Vertrag (`protocol.ContractEnv`) und geht
 * an JEDEN Installationsschritt (`rezept.vertragsEnv`). **Bis zum 2026-09-22
 * hatte ihn kein einziges Paket benutzt** — eine zugesicherte Variable ohne
 * Leser, und daneben vier Dateien am falschen Ort.
 *
 * Das ist nicht nur Kosmetik: Was in `game/` liegt, ist laut Vertrag ersetzbar.
 * Ein Merkzettel dort überlebt die nächste Neuinstallation nicht — und genau
 * dafür gibt es ihn.
 *
 * ── Was dieser Wächter prüft ─────────────────────────────────────────────────
 *
 *  1. Kein Installationsskript legt eine Punktdatei oder einen Punktordner im
 *     ARBEITSORDNER an. Das ist die Stelle, an der es auffällt.
 *  2. Wer Zustand schreibt, nimmt `$FB_STATE_DIR`; wer etwas wegwirft, nimmt
 *     `$XDG_CACHE_HOME`.
 *  3. Und die Zusage steht wirklich: Der Daemon liefert beide Variablen.
 *     Ohne das wäre die Regel eine Bitte an niemanden.
 *
 * Aufruf:  node scripts/check-ablageordnung.js
 * Rückgabe: 0 = jedes Paket schreibt dorthin, wo es hingehört.
 */

const fs = require('fs');
const path = require('path');
const { ohneKommentare } = require('./lib/quelltext');

const WURZEL = path.join(__dirname, '..');
const DAEMON = '/home/firedervil/firebot_daemon';

let geprueft = 0, fehler = 0;
const pruefe = (ok, was, zusatz = '') => {
    geprueft++;
    if (!ok) fehler++;
    console.log(`  ${ok ? '✅' : '❌'} ${was}${!ok && zusatz ? '\n       ' + zusatz : ''}`);
};
const roh = (datei) => fs.existsSync(datei) ? fs.readFileSync(datei, 'utf8') : null;

console.log('\n▸ Jedes Paket legt ab, wo es hingehört\n');

// ════════════════════════════════════════════════════════════════════════════
console.log('Der Vertrag hält, worauf die Regel ruht');
// ════════════════════════════════════════════════════════════════════════════
const volume = ohneKommentare(roh(path.join(DAEMON, 'pkg/protocol/volume.go')) || '');
pruefe(/"FB_STATE_DIR":\s+Dir\(DirFB\)/.test(volume),
    '`FB_STATE_DIR` steht im Vertrag und zeigt auf `.fb`',
    'Ohne die Zusage wäre die Regel unten eine Bitte an niemanden.');
pruefe(/"XDG_CACHE_HOME":\s+Dir\(DirCache\)/.test(volume),
    'und `XDG_CACHE_HOME` auf `cache`');

const rezept = ohneKommentare(roh(path.join(DAEMON, 'internal/gameserver/rezept/rezept.go')) || '');
pruefe(/for k, v := range protocol\.ContractEnv\(\)/.test(rezept),
    'jeder Installationsschritt bekommt den Vertrag mit',
    'Sonst kennt das Skript die Variable nicht, und `${FB_STATE_DIR:-…}` fiele immer auf den Rückfall.');

const volumes = ohneKommentare(roh(path.join(DAEMON, 'internal/gameserver/docker/volumes.go')) || '');
pruefe(/protocol\.DirGame, protocol\.DirData, protocol\.DirCache, protocol\.DirFB/.test(volumes),
    'und `.fb` wird beim Anlegen des Volumes wirklich erzeugt');

// ════════════════════════════════════════════════════════════════════════════
console.log('\nDie Pakete halten sich daran');
// ════════════════════════════════════════════════════════════════════════════
const ordner = path.join(WURZEL, 'packages/fbpkg/beispiele');
const dateien = fs.existsSync(ordner)
    ? fs.readdirSync(ordner).filter(d => d.endsWith('.json')) : [];
pruefe(dateien.length > 0, `${dateien.length} Handpaket(e) gelesen`);

for (const datei of dateien) {
    const paket = JSON.parse(fs.readFileSync(path.join(ordner, datei), 'utf8'));
    const skript = (paket.install?.steps || []).map(s => s.script || '').join('\n');
    if (!skript.trim()) continue;

    // ── Punktdateien im Arbeitsordner ───────────────────────────────────────
    //
    // Gesucht wird an den Stellen, an denen etwas ENTSTEHT: eine Umlenkung
    // (`> .x`), ein angelegter Ordner (`mkdir .x`) oder eine Kopie (`-o .x`).
    // Ein Pfad, der mit `$` beginnt, ist keiner im Arbeitsordner — genau das
    // ist die erlaubte Form.
    // ── Gezaehlt wird, was ENTSTEHT — und nur das ─────────────────────────
    //
    // Die erste Fassung zaehlte auch `rm -rf` mit und nahm deshalb Namen wieder
    // aus der Liste, die irgendwo in einem `rm -f` vorkamen. Das Skript raeumt
    // seine eigenen Altlasten weg (`rm -f .fb-minecraft-version …`) — und
    // machte die Pruefung damit blind: In der Gegenprobe schrieb ich denselben
    // Namen wieder mit `>` in den Arbeitsordner, und der Waechter blieb GRUEN.
    //
    // Loeschen ist das Gegenteil eines Befunds. Es gehoert nicht in die Liste,
    // und eine Ausnahme dafuer erst recht nicht.
    const angelegt = [
        ...skript.matchAll(/>\s*(\.[A-Za-z0-9_.-]+)/g),
        ...skript.matchAll(/mkdir\s+(?:-p\s+)?(\.[A-Za-z0-9_.-]+)/g),
        ...skript.matchAll(/-o\s+(\.[A-Za-z0-9_.-]+)/g),
    ].map(m => m[1]).filter(p2 => p2 !== '.' && p2 !== '..');

    pruefe(angelegt.length === 0,
        `${datei}: legt keine Punktdatei im Arbeitsordner an`,
        `Gefunden: ${[...new Set(angelegt)].join(', ')}\n       `
      + '`game/` ist laut Vertrag ERSETZBAR — ein Merkzettel dort überlebt die nächste '
      + 'Neuinstallation nicht. Zustand gehört nach `$FB_STATE_DIR`, Wegwerfbares nach '
      + '`$XDG_CACHE_HOME`.');

    // Wer Zustand schreibt, muss die Variable auch benutzen.
    const schreibtZustand = /\$\{?FB_STATE_DIR/.test(skript) || /ABLAGE=/.test(skript);
    if (schreibtZustand) {
        pruefe(/\$\{FB_STATE_DIR:-/.test(skript),
            `${datei}: nimmt $FB_STATE_DIR mit einem Rückfall`,
            'Ohne Rückfall bricht ein Lauf ausserhalb des Containers (Probelauf, Abnahme) ab.');
    }
}

console.log(`\n${fehler === 0 ? '✅' : '❌'} ${geprueft - fehler} von ${geprueft} Prüfungen bestanden`);
console.log(fehler === 0
    ? '   Spieldateien in game/, Merkzettel in .fb/, Wegwerfbares in cache/.\n' : '');
process.exit(fehler === 0 ? 0 : 1);
