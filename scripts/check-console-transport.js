#!/usr/bin/env node
/**
 * Prüft, wo ein Befehlseingang steht und wer ihn bewacht (Konzept 23.3).
 *
 * Zwei Wege führten zum selben Gameserver – die Konsolen-Route mit Blacklist und
 * Rate-Limit, die RCON-Route ohne beides. Seit dem 2026-08-01 gilt der Filter für
 * beide, und die Befehlseingabe verschwindet aus dem Konsolen-Tab, wo stdin nur
 * eine Brücke zu RCON ist.
 *
 * Zwei Fehler wären hier teuer und beide sind still:
 *   - Die Ableitung stuft ein Spiel falsch ein → entweder ein Eingabefeld, das
 *     nichts bewirkt, oder ein verschwundenes, das gebraucht wurde.
 *   - Die Blacklist sperrt den regulären Stoppbefehl des Spiels aus. Palworld
 *     stoppt per `shutdown 15`, und `shutdown` steht auf der Blacklist.
 *
 *   node scripts/check-console-transport.js
 */

'use strict';

const assert = require('assert');
const path   = require('path');

// CommandFilter zieht sich beim Laden einen Logger aus dem ServiceManager. Ohne
// Registrierung wirft `get()` – deshalb vor dem require ein Platzhalter.
const { ServiceManager } = require('dunebot-core');
if (!ServiceManager.has('Logger')) {
    const still = () => {};
    ServiceManager.register('Logger', { debug: still, info: still, warn: still, error: still });
}

const HELPERS = path.join(__dirname, '../plugins/gameserver/dashboard/helpers');
const { resolveConsoleTransport, konsoleNimmtBefehle, NATIVE, BRIDGE_TO_RCON, NONE } =
    require(path.join(HELPERS, 'ConsoleTransport'));
const { validateCommand } = require(path.join(HELPERS, 'CommandFilter'));

let passed = 0;
function check(name, fn) {
    try {
        fn();
        console.log(`  ✓ ${name}`);
        passed++;
    } catch (err) {
        console.error(`  ✗ ${name}\n    ${err.message}`);
        process.exitCode = 1;
    }
}

console.log('\nstdin-Transport ableiten');

check('Brücke zu RCON: /dev/stdin und rcon im Startbefehl', () => {
    const palworld = {
        startup: {
            stop: 'shutdown 15',
            command: './PalServer.sh & (while read cmd; do rcon -a 127.0.0.1 "$cmd"; done) < /dev/stdin',
        },
    };
    assert.strictEqual(resolveConsoleTransport(palworld).stdin, BRIDGE_TO_RCON);
});

check('Die Brücke schlägt den Stoppbefehl – sonst käme bei Palworld "native" heraus', () => {
    // `stop` ist "shutdown 15", also ein Wort. Nur die Reihenfolge der Prüfungen
    // verhindert, dass daraus ein Eingabefeld im Konsolen-Tab wird.
    const palworld = {
        startup: {
            stop: 'shutdown 15',
            command: './PalServer.sh & (while read cmd; do rcon "$cmd"; done) < /dev/stdin',
        },
    };
    assert.notStrictEqual(resolveConsoleTransport(palworld).stdin, NATIVE);
});

check('rcon allein ist keine Brücke – -rconport steht in vielen Startbefehlen', () => {
    const server = { startup: { stop: '^C', command: './server -rconport 27020 -port 27015' } };
    assert.strictEqual(resolveConsoleTransport(server).stdin, NONE);
});

check('/dev/stdin allein ist ein echter Eingang, keine Brücke', () => {
    const server = { startup: { stop: 'quit', command: './server < /dev/stdin' } };
    assert.strictEqual(resolveConsoleTransport(server).stdin, NATIVE);
});

check('Stoppbefehl als Wort → stdin nimmt Befehle entgegen', () => {
    assert.strictEqual(resolveConsoleTransport({ startup: { stop: 'quit' } }).stdin, NATIVE);
    assert.strictEqual(resolveConsoleTransport({ startup: { stop: '/stop' } }).stdin, NATIVE);
    assert.strictEqual(resolveConsoleTransport({ startup: { stop: 'shutdown' } }).stdin, NATIVE);
});

check('^C ist ein Signal, kein Befehl → kein Eingabefeld', () => {
    assert.strictEqual(resolveConsoleTransport({ startup: { stop: '^C' } }).stdin, NONE);
    assert.strictEqual(resolveConsoleTransport({ startup: { stop: '^D' } }).stdin, NONE);
});

check('Fehlendes oder leeres startup → kein Eingabefeld', () => {
    assert.strictEqual(resolveConsoleTransport({}).stdin, NONE);
    assert.strictEqual(resolveConsoleTransport(undefined).stdin, NONE);
    assert.strictEqual(resolveConsoleTransport({ startup: { stop: '   ' } }).stdin, NONE);
});

check('Das Addon darf übersteuern', () => {
    const server = { console: { stdin: 'none' }, startup: { stop: 'quit' } };
    const t = resolveConsoleTransport(server);
    assert.strictEqual(t.stdin, NONE);
    assert.strictEqual(t.quelle, 'addon');
});

check('Unbekannter Wert in console.stdin wird ignoriert, nicht übernommen', () => {
    const server = { console: { stdin: 'vielleicht' }, startup: { stop: 'quit' } };
    const t = resolveConsoleTransport(server);
    assert.strictEqual(t.stdin, NATIVE);
    assert.strictEqual(t.quelle, 'abgeleitet');
});

check('konsoleNimmtBefehle ist nur bei native wahr', () => {
    assert.strictEqual(konsoleNimmtBefehle({ startup: { stop: 'quit' } }), true);
    assert.strictEqual(konsoleNimmtBefehle({ startup: { stop: '^C' } }), false);
});

console.log('\nBefehlsfilter auf der RCON-Route');

check('shutdown ist blockiert, solange das Addon es nicht deklariert', () => {
    const r = validateCommand('shutdown 15', {});
    assert.strictEqual(r.valid, false);
});

check('Der deklarierte Stoppbefehl darf trotz Blacklist durch', () => {
    const r = validateCommand('shutdown 15', { zusaetzlichErlaubt: ['shutdown'] });
    assert.strictEqual(r.valid, true, r.error);
    assert.strictEqual(r.sanitized, 'shutdown 15');
});

check('Die Ausnahme gilt nur für den einen Befehl, nicht für die halbe Blacklist', () => {
    const r = validateCommand('rm -rf /', { zusaetzlichErlaubt: ['shutdown'] });
    assert.strictEqual(r.valid, false);
});

check('Die Ausnahme hebelt die Mustererkennung nicht aus', () => {
    // Command-Chaining bleibt verboten, auch wenn der Befehlsname erlaubt ist.
    const r = validateCommand('shutdown 15 && rm -rf /', { zusaetzlichErlaubt: ['shutdown'] });
    assert.strictEqual(r.valid, false);
});

check('Groß/Klein und Leerraum in der Ausnahme stören nicht', () => {
    const r = validateCommand('SHUTDOWN 15', { zusaetzlichErlaubt: ['  Shutdown '] });
    assert.strictEqual(r.valid, true, r.error);
});

check('Normale Spielbefehle gehen unverändert durch', () => {
    const r = validateCommand('say Hallo Welt', {});
    assert.strictEqual(r.valid, true, r.error);
    assert.strictEqual(r.sanitized, 'say Hallo Welt');
});

console.log(`\n${passed} Prüfung(en) bestanden.\n`);

// dunebot-core hält beim Laden Handles offen. Ohne diese Zeile bleibt das Skript
// nach der letzten Prüfung stehen, statt sich zu beenden.
process.exit(process.exitCode || 0);
