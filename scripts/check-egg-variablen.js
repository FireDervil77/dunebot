#!/usr/bin/env node
/**
 * Prüft die Erkennung ungenutzter Addon-Variablen (Konzept 23.2).
 *
 * Der teure Fehler ist hier einseitig: Ein falsches „wird nicht verwendet"
 * bringt jemanden dazu, eine wirksame Einstellung zu ignorieren. Ein
 * übersehenes totes Feld kostet dagegen nur einen Hinweis. Die Erkennung darf
 * also großzügig sein, aber nicht knapp.
 *
 * Der erste Entwurf suchte nur nach `{{NAME}}` und meldete daraufhin 8 von 8
 * Hytale-Variablen und 9 von 11 Palworld-Variablen als tot. Grund: Eggs mischen
 * drei Schreibweisen in derselben Zeile. Genau das prüfen die Fälle hier.
 *
 *   node scripts/check-egg-variablen.js
 */

'use strict';

const assert = require('assert');
const path   = require('path');

const HELPERS = path.join(__dirname, '../plugins/gameserver/dashboard/helpers');
const { beurteileVariablen, unbenutzteVariablen, wirdVerwendet } =
    require(path.join(HELPERS, 'EggVariables'));

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

console.log('\nDie drei Schreibweisen');

check('{{NAME}} im Startbefehl zählt', () => {
    const gd = { startup: { command: './server -port {{SERVER_PORT}}' } };
    assert.deepStrictEqual(unbenutzteVariablen(gd, { SERVER_PORT: '27015' }), []);
});

check('{{ NAME }} mit Leerraum zählt auch', () => {
    const gd = { startup: { command: './server -port {{ SERVER_PORT }}' } };
    assert.deepStrictEqual(unbenutzteVariablen(gd, { SERVER_PORT: '27015' }), []);
});

check('${NAME} im Installationsskript zählt', () => {
    const gd = { scripts: { installation: { script: 'steamcmd +app_update ${GAME_APPID}' } } };
    assert.deepStrictEqual(unbenutzteVariablen(gd, { GAME_APPID: '896660' }), []);
});

check('$NAME als nackte Shell-Variable zählt – Palworlds Muster', () => {
    const gd = { startup: { command: '$(if [ -n "$SERVER_PASSWORD" ]; then echo "-pw"; fi)' } };
    assert.deepStrictEqual(unbenutzteVariablen(gd, { SERVER_PASSWORD: 'geheim' }), []);
});

check('$SERVER trifft nicht auf $SERVER_PASSWORD', () => {
    // Ohne Wortgrenze hielte die Suche jede Variable für benutzt, deren Name
    // Präfix einer anderen ist - der häufigste Weg zu einem stillen Fehlalarm.
    const gd = { startup: { command: 'echo "$SERVER_PASSWORD"' } };
    assert.deepStrictEqual(unbenutzteVariablen(gd, { SERVER: 'x' }), ['SERVER']);
});

check('Konfigurationsvorlagen des Addons zählen', () => {
    const gd = { config: { files: { 'server.ini': { find: { 'Port': '{{SERVER_PORT}}' } } } } };
    assert.deepStrictEqual(unbenutzteVariablen(gd, { SERVER_PORT: '7777' }), []);
});

console.log('\nPlattform-Variablen');

check('AUTO_UPDATE und SRCDS_APPID gelten als benutzt, auch ohne Fundstelle', () => {
    // Der Daemon liest sie, nicht das Egg. Ein "tot" wäre hier schlicht falsch.
    assert.strictEqual(wirdVerwendet('', 'AUTO_UPDATE'), true);
    assert.strictEqual(wirdVerwendet('', 'SRCDS_APPID'), true);
});

console.log('\nBefund insgesamt');

check('Eine nirgends erwähnte Variable wird gemeldet', () => {
    const gd = { startup: { command: './server' } };
    assert.deepStrictEqual(unbenutzteVariablen(gd, { WORLD_MODE: 'true' }), ['WORLD_MODE']);
});

check('Palworlds MAX_PLAYERS ist wirklich tot – die Slots stehen fest im Befehl', () => {
    const gd = { startup: { command: './PalServer.sh -players=10 -port={{SERVER_PORT}}' } };
    assert.deepStrictEqual(
        unbenutzteVariablen(gd, { MAX_PLAYERS: '10', SERVER_PORT: '8211' }),
        ['MAX_PLAYERS']
    );
});

check('Am Server gesetzte Variablen fehlen nicht, nur weil das Addon sie nicht kennt', () => {
    const gd = { startup: { command: './server' }, variables: [] };
    const b = beurteileVariablen(gd, { EIGENBAU: '1' });
    assert.strictEqual(b.length, 1);
    assert.strictEqual(b[0].name, 'EIGENBAU');
    assert.strictEqual(b[0].imAddon, false);
});

check('Vom Addon deklarierte Variablen erscheinen auch ohne gesetzten Wert', () => {
    const gd = {
        startup: { command: './server' },
        variables: [{ env_variable: 'UNGESETZT', description: 'egal', default_value: '5' }],
    };
    const b = beurteileVariablen(gd, {});
    assert.strictEqual(b[0].name, 'UNGESETZT');
    assert.strictEqual(b[0].imAddon, true);
    assert.strictEqual(b[0].vorgabe, '5');
});

check('Leeres oder fehlendes game_data wirft nicht', () => {
    assert.deepStrictEqual(unbenutzteVariablen(undefined, {}), []);
    assert.deepStrictEqual(unbenutzteVariablen({}, {}), []);
});

check('Sonderzeichen im Namen sprengen die Suche nicht', () => {
    assert.doesNotThrow(() => unbenutzteVariablen({ startup: { command: 'x' } }, { 'A.B*C': '1' }));
});

console.log(`\n${passed} Prüfung(en) bestanden.\n`);
