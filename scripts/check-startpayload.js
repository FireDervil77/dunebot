#!/usr/bin/env node
/**
 * Prüft den Aufbau des Start-Payloads – ohne Datenbank, ohne Daemon.
 *
 * Hier gehen Fehler still aus: Ein nicht ersetzter Platzhalter landet wörtlich
 * auf der Kommandozeile des Spielservers, und der Prozess startet trotzdem –
 * nur eben mit `-port={{SERVER_PORT}}`. Genau das ist über /server start
 * passiert, weil der IPC-Pfad eine eigene Kopie der Ersetzung hatte, die nach
 * `{{game}}` statt nach `{{SERVER_PORT}}` suchte.
 *
 *   node scripts/check-startpayload.js
 */

'use strict';

const assert = require('assert');
const path   = require('path');

const { ServiceManager } = require('dunebot-core');
if (!ServiceManager.has('Logger')) {
    const still = () => {};
    ServiceManager.register('Logger', { debug: still, info: still, warn: still, error: still });
}

const HELPERS = path.join(__dirname, '../plugins/gameserver/dashboard/helpers');
const { buildStartPayload, waehleDockerImage } = require(path.join(HELPERS, 'StartPayload'));

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

/** Ein Server, wie loadServerForStart ihn liefert. */
function server(overrides = {}) {
    return {
        id: 1,
        name: 'Testserver',
        launch_params: './server -port={{SERVER_PORT}} -queryport={{QUERY_PORT}} -players={{MAX_PLAYERS}}',
        ports: { game: { internal: 25001, external: 25001, protocol: 'udp' },
                 query: { internal: 25007, external: 25007, protocol: 'udp' } },
        env_variables: { MAX_PLAYERS: '10' },
        frozen_game_data: {
            docker_images: { 'ghcr.io/test/image:tag': 'ghcr.io/test/image:tag' },
            startup: { stop: '^C' },
            variables: [{ env_variable: 'MAX_PLAYERS', default_value: '32' }],
        },
        install_path: '1-test',
        system_user: 'gameserver',
        daemon_id: 'd1',
        rootserver_id: 1,
        addon_slug: 'test',
        ...overrides,
    };
}

console.log('\nPlatzhalter im Startbefehl');

check('{{SERVER_PORT}} kommt aus dem game-Port', () => {
    const { payload } = buildStartPayload(server(), 'g1');
    assert.ok(payload.startup_command.includes('-port=25001'), payload.startup_command);
});

check('{{QUERY_PORT}} kommt aus dem query-Port', () => {
    const { payload } = buildStartPayload(server(), 'g1');
    assert.ok(payload.startup_command.includes('-queryport=25007'), payload.startup_command);
});

check('{{MAX_PLAYERS}} kommt aus den env_variables, nicht aus der Vorgabe', () => {
    const { payload } = buildStartPayload(server(), 'g1');
    assert.ok(payload.startup_command.includes('-players=10'), payload.startup_command);
});

check('Nach dem Bauen steht kein Platzhalter mehr im Befehl', () => {
    // Der eigentliche Wächter: Was hier durchrutscht, landet woertlich auf der
    // Kommandozeile des Spielservers - und der startet trotzdem.
    const { payload } = buildStartPayload(server(), 'g1');
    assert.strictEqual(payload.startup_command.match(/\{\{[^}]+\}\}/g), null, payload.startup_command);
});

check('Ein Porteintrag darf nie als [object Object] landen', () => {
    const { payload } = buildStartPayload(server(), 'g1');
    assert.ok(!payload.startup_command.includes('[object Object]'), payload.startup_command);
});

check('Fehlt die Variable ganz, greift die Vorgabe des Addons', () => {
    const { payload } = buildStartPayload(server({ env_variables: {} }), 'g1');
    assert.ok(payload.startup_command.includes('-players=32'), payload.startup_command);
});

console.log('\nDocker-Image aus docker_images');

check('Schlüssel und Wert identisch – der Normalfall', () => {
    assert.strictEqual(
        waehleDockerImage({ 'ghcr.io/parkervcp/games:valheim': 'ghcr.io/parkervcp/games:valheim' }),
        'ghcr.io/parkervcp/games:valheim'
    );
});

check('Etikett → Image (factorio-arm64): der Wert gewinnt', () => {
    assert.strictEqual(
        waehleDockerImage({ 'Box64': 'ghcr.io/parkervcp/yolks:box64' }),
        'ghcr.io/parkervcp/yolks:box64'
    );
});

check('Image → Etikett (windrose): der Schlüssel gewinnt', () => {
    assert.strictEqual(
        waehleDockerImage({ 'ghcr.io/parkervcp/steamcmd:proton': 'Proton' }),
        'ghcr.io/parkervcp/steamcmd:proton'
    );
});

check('Leere oder fehlende Angabe ergibt null', () => {
    assert.strictEqual(waehleDockerImage({}), null);
    assert.strictEqual(waehleDockerImage(undefined), null);
});

check('Ohne Image meldet buildStartPayload einen Fehler statt still zu starten', () => {
    const { payload, error } = buildStartPayload(
        server({ frozen_game_data: { docker_images: {}, startup: { stop: '^C' } } }), 'g1');
    assert.strictEqual(payload, null);
    assert.ok(error && /Docker-Image/.test(error), error);
});

console.log(`\n${passed} Prüfung(en) bestanden.\n`);

// dunebot-core hält beim Laden Handles offen.
process.exit(process.exitCode || 0);
