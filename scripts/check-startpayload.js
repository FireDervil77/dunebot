#!/usr/bin/env node
/**
 * Prüft die Aufträge des Dashboards an den Daemon — ohne Datenbank, ohne Daemon.
 *
 * Seit dem 2026-09-10 gibt es nur den Paketweg (Vertrag V2): Paket, Werte,
 * Zuteilung. Geprüft wird vor allem, was NICHT mehr drinsteht — kein Egg-Feld,
 * kein fremdes Image — und dass ein fehlendes Paket oder ein fehlender
 * Weltwert einen Fehler ergibt statt eines halben Auftrags.
 *
 * Bis zu diesem Tag prüfte das Skript die Ersetzung von {{SERVER_PORT}} in der
 * Egg-Startzeile. Seit dem 2026-09-08 war es rot (6 ✗), weil `buildStartPayload`
 * async wurde und niemand es laufen liess.
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
const { buildStartPayload, baueInstallNutzlast, paketWerteAnlegen, autoUpdateAus, werteFuerDaemon } =
    require(path.join(HELPERS, 'StartPayload'));

let passed = 0;
async function check(name, fn) {
    try {
        await fn();
        console.log(`  ✓ ${name}`);
        passed++;
    } catch (err) {
        console.error(`  ✗ ${name}\n    ${err.message}`);
        process.exitCode = 1;
    }
}

function paket(anpassen) {
    const p = {
        format: 'FBPKG_v1',
        identity: { slug: 'valheim', name: 'Valheim', version: '1.0.10' },
        image: { ref: 'registry.firenetworks.de/fb/steamcmd', tag: '2026.09', digest: 'sha256:abc' },
        ports: [
            { purpose: 'game', assign: 'pool', protocol: 'udp', required: true },
            { purpose: 'query', assign: 'game+1', protocol: 'udp', required: true },
        ],
        settings: [
            { key: 'name', type: 'text', default: 'My Server', role: 'player' },
            { key: 'world_name', type: 'text', default: 'Dedicated', risk: 'progress', role: 'player' },
            { key: 'password', type: 'password', default: '' },
            { key: 'auto_update', type: 'boolean', default: true },
            { key: 'beta_branch', type: 'text', default: '' },
        ],
        install: { steps: [{ type: 'steamcmd', app: 896660, branch: '{{setting:beta_branch}}' }] },
    };
    if (anpassen) anpassen(p);
    return p;
}

/** Eine Zeile, wie loadServerForStart sie liefert — samt Egg-Resten der alten Zeit. */
function server(overrides = {}) {
    return {
        id: 186,
        name: 'Fires Valheim Bude',
        guild_id: 'g1',
        paket_json: JSON.stringify(paket()),
        paket_slug: 'valheim', paket_version: '1.0.10', paket_channel: 'test',
        paket_werte: JSON.stringify({
            name: 'Fires Valheim Bude', world_name: 'BoomTown', password: 'x', auto_update: '1', beta_branch: '',
        }),
        ports: JSON.stringify({
            game:  { internal: 25000, external: 25000, protocol: 'udp' },
            query: { internal: 25001, external: 25001, protocol: 'udp' },
        }),
        // Was ein Server aus der Egg-Zeit trägt — darf nirgends ankommen.
        env_variables: JSON.stringify({ SRCDS_APPID: '896660', SERVER_NAME: 'alt' }),
        frozen_game_data: JSON.stringify({
            docker_images: { 'ghcr.io/parkervcp/games:valheim': 'ghcr.io/parkervcp/games:valheim' },
            scripts: { installation: { container: 'ghcr.io/parkervcp/installers:debian' } },
        }),
        launch_params: './valheim_server.x86_64 -name "{{SERVER_NAME}}"',
        install_path: '186-valheim',
        system_user: 'gameserver',
        daemon_id: 'd1',
        rootserver_id: 55,
        addon_slug: 'valheim',
        allocated_ram_mb: 4096, allocated_cpu_percent: 200, allocated_disk_gb: 20,
        auto_update: 0,
        ...overrides,
    };
}

const EGG_FELDER = ['startup_command', 'env_variables', 'game_data', 'install_image',
                    'steam_app_id', 'platform', 'file_denylist'];

function ohneEgg(payload) {
    for (const f of EGG_FELDER) assert.ok(!(f in payload), `${f} steht im Auftrag`);
    const text = JSON.stringify(payload);
    for (const fremd of ['parkervcp', 'pterodactyl', 'SRCDS_', '{{SERVER_']) {
        assert.ok(!text.includes(fremd), `${fremd} steht im Auftrag`);
    }
}

(async () => {
    console.log('\nStartauftrag');

    await check('Das Image kommt aus dem Paket, gepinnt', async () => {
        const { payload, error, dockerImage } = await buildStartPayload(server(), 'g1');
        assert.strictEqual(error, null);
        assert.strictEqual(dockerImage, 'registry.firenetworks.de/fb/steamcmd@sha256:abc');
        assert.strictEqual(payload.package.identity.slug, 'valheim');
    });

    await check('Kein Egg-Feld und kein fremdes Image im Auftrag', async () => {
        ohneEgg((await buildStartPayload(server(), 'g1')).payload);
    });

    await check('Werte gehen unter den Paketschlüsseln, als Text', async () => {
        const { payload } = await buildStartPayload(server(), 'g1');
        assert.deepStrictEqual(payload.settings, {
            name: 'Fires Valheim Bude', world_name: 'BoomTown', password: 'x', auto_update: '1', beta_branch: '',
        });
    });

    await check('Ohne Paket kein Auftrag — kein Rückfall', async () => {
        const { payload, error } = await buildStartPayload(server({ paket_json: null }), 'g1');
        assert.strictEqual(payload, null);
        assert.ok(/kein Spielpaket/.test(error), error);
    });

    await check('Fehlt ein Weltwert, gibt es keinen Auftrag', async () => {
        const { payload, error } = await buildStartPayload(
            server({ paket_werte: JSON.stringify({ name: 'x' }) }), 'g1');
        assert.strictEqual(payload, null);
        assert.ok(/world_name/.test(error), error);
    });

    await check('Fehlt ein Pflichtport, gibt es keinen Auftrag', async () => {
        const { payload, error } = await buildStartPayload(
            server({ ports: JSON.stringify({ game: { internal: 25000 } }) }), 'g1');
        assert.strictEqual(payload, null);
        assert.ok(/query/.test(error), error);
    });

    await check('Auto-Update folgt der Paketeinstellung, nicht der Spalte', async () => {
        assert.strictEqual((await buildStartPayload(server({ auto_update: 0 }), 'g1')).payload.auto_update, true);
        const aus = server({
            auto_update: 1,
            paket_werte: JSON.stringify({ name: 'x', world_name: 'w', auto_update: '0' }),
        });
        assert.strictEqual((await buildStartPayload(aus, 'g1')).payload.auto_update, false);
    });

    await check('Ohne auto_update im Paket gibt es kein Auto-Update', async () => {
        const p = paket(x => { x.settings = x.settings.filter(e => e.key !== 'auto_update'); });
        assert.strictEqual(autoUpdateAus(p, { auto_update: '1' }), false);
    });

    console.log('\nInstallationsauftrag');

    await check('Paket, Werte und Ports — und kein Egg-Feld', async () => {
        const { payload, error } = baueInstallNutzlast(server(), 'g1', { reinstall: true });
        assert.strictEqual(error, null);
        assert.strictEqual(payload.package.identity.slug, 'valheim');
        assert.strictEqual(payload.settings.beta_branch, '');
        assert.strictEqual(payload.ports.query.internal, 25001);
        assert.strictEqual(payload.reinstall, true);
        ohneEgg(payload);
    });

    await check('Ohne Paket keine Installation', async () => {
        const { payload, error } = baueInstallNutzlast(server({ paket_json: null }), 'g1');
        assert.strictEqual(payload, null);
        assert.ok(/kein Spielpaket/.test(error), error);
    });

    console.log('\nWerte beim Anlegen');

    await check('Jede Einstellung bekommt einen Wert — Eingabe, sonst Vorgabe', async () => {
        const werte = paketWerteAnlegen(paket(), { world_name: 'Neu' }, 'Mein Server');
        assert.deepStrictEqual(werte, {
            name: 'Mein Server', world_name: 'Neu', password: '', auto_update: '1', beta_branch: '',
        });
    });

    console.log('\nDas Kennwort der Fernsteuerung wird erzeugt, nicht gefragt');

    // ── Der Fall, der das gekostet hat (2026-09-22) ─────────────────────────
    //
    // Am ersten Minecraft-Server fehlte `rcon_password` in den Werten: Es hat
    // `default: null` und `role: owner`, wurde also weder gefragt noch
    // vorbelegt. Dann bleibt der Verweis stehen, und in `server.properties`
    // landet `rcon.password={{setting:rcon_password}}` — ein Platzhalter als
    // Geheimnis.
    //
    // Geprueft wird gegen JEDES Handpaket, das eine Fernsteuerung nennt, und am
    // ERGEBNIS von `paketWerteAnlegen`.
    {
        const fs2 = require('fs');
        const path2 = require('path');
        const ordner = path2.join(__dirname, '../packages/fbpkg/beispiele');
        const dateien = fs2.existsSync(ordner)
            ? fs2.readdirSync(ordner).filter(d => d.endsWith('.json')) : [];
        for (const datei of dateien) {
            const pk = JSON.parse(fs2.readFileSync(path2.join(ordner, datei), 'utf8'));
            const variable = pk?.management?.rcon?.password_variable;
            if (!variable) continue;
            const eintrag = (pk.settings || []).find(e =>
                Array.isArray(e.apply)
                && e.apply.some(a => a.target === 'env' && a.variable === variable));

            await check(`${datei}: die Einstellung zu ${variable} ist auffindbar`, async () => {
                assert.ok(eintrag, `Keine Einstellung schreibt ${variable} — dann kann sie auch `
                                 + 'niemand fuellen, und der Daemon meldet eine Luecke.');
            });
            if (!eintrag) continue;

            await check(`${datei}: sie bekommt beim Anlegen einen Wert`, async () => {
                const w = paketWerteAnlegen(pk, {}, 'Mein Server');
                const wert = w[eintrag.key];
                assert.ok(wert && String(wert).length >= 16,
                    `${eintrag.key} = ${JSON.stringify(wert)} — ohne Wert bleibt {{setting:`
                  + `${eintrag.key}}} als Text in der Konfiguration stehen.`);
                assert.ok(!/\{\{/.test(String(wert)), 'Der Wert ist ein Platzhalter, kein Kennwort.');
            });

            await check(`${datei}: es ist erzeugt, nicht fest`, async () => {
                const a = paketWerteAnlegen(pk, {}, 'x')[eintrag.key];
                const b = paketWerteAnlegen(pk, {}, 'x')[eintrag.key];
                assert.notStrictEqual(a, b,
                    'Zweimal dasselbe Kennwort heisst: Es steht im Code. Dann hat jeder Server '
                  + 'dieses Hauses dasselbe.');
            });

            await check(`${datei}: ein eingetippter Wert gewinnt`, async () => {
                const w = paketWerteAnlegen(pk, { [eintrag.key]: 'von-hand' }, 'x');
                assert.strictEqual(w[eintrag.key], 'von-hand');
            });
        }
    }

    console.log('\nEine Einstellung, die dem Server fehlt (Baustelle Weltmodifikatoren)');

    // ── Der Fall, der das gekostet hat ──────────────────────────────────────
    //
    // Server 186 wurde am 2026-08-18 mit Paketfassung 1.0.0 angelegt.
    // `mod_verwalten` kam erst spaeter ins Paket und stand deshalb NIE in
    // seinen Werten. Bis zum 2026-09-20 liess `werteFuerDaemon` solche
    // Einstellungen still weg — und der Daemon setzt keine Vorgabe ein.
    //
    // Folge am laufenden Server: `-modifier deathpenalty veryeasy` ging bei
    // jedem Start mit, `-resetmodifiers` nie. Valheim schreibt Modifikatoren
    // dauerhaft in die Welt; nur `-resetmodifiers` raeumt auf. Rein ja, raus
    // nie — und im Panel stand die ganze Zeit die Vorgabe, als gaelte sie.

    await check('Fehlt der Wert, gilt die Vorgabe des Pakets', async () => {
        const p = paket((x) => {
            x.settings.push({ key: 'mod_verwalten', type: 'boolean', default: false, role: 'owner' });
            x.settings.push({ key: 'autosave_seconds', type: 'number', default: 1800, role: 'owner' });
        });
        // Genau der Bestand von 186: der spaetere Schluessel fehlt.
        const { settings } = werteFuerDaemon(p, { name: 'Bude', world_name: 'BoomTown' });
        assert.strictEqual(settings.mod_verwalten, 'false',
            'die Vorgabe des Pakets kam nicht an');
        assert.strictEqual(settings.autosave_seconds, '1800',
            'eine Zahl-Vorgabe kam nicht an');
    });

    await check('Ein gespeicherter Wert sticht gegen die Vorgabe', async () => {
        const p = paket((x) => {
            x.settings.push({ key: 'mod_verwalten', type: 'boolean', default: false, role: 'owner' });
        });
        const { settings } = werteFuerDaemon(p, { mod_verwalten: '1' });
        assert.strictEqual(settings.mod_verwalten, '1');
    });

    await check('Ein leerer Text bleibt ein Wert und wird nicht ueberschrieben', async () => {
        // beta_branch "" heisst „kein Beta-Zweig" — die Vorgabe ist hier
        // ebenfalls "", aber der Unterschied muss bestehen bleiben: Ein
        // gespeichertes "" ist eine Aussage des Betreibers.
        const { settings } = werteFuerDaemon(paket(), { beta_branch: '' });
        assert.strictEqual(settings.beta_branch, '');
    });

    await check('Ohne Vorgabe bleibt die Einstellung weg, statt "undefined" zu senden', async () => {
        const p = paket((x) => {
            x.settings.push({ key: 'rcon_password', type: 'password', default: null, role: 'owner' });
        });
        const { settings } = werteFuerDaemon(p, {});
        assert.ok(!('rcon_password' in settings),
            `rcon_password kam als ${JSON.stringify(settings.rcon_password)} an`);
    });

    await check('Riskante Einstellungen nehmen KEINE Vorgabe — sie halten den Start an', async () => {
        // world_name traegt risk: progress. Eine Vorgabe kostet hier einen
        // Weltstand: Der Server erzeugte still eine neue Welt namens
        // „Dedicated" und liesse die bespielte liegen.
        const { settings, gefaehrlich } = werteFuerDaemon(paket(), {});
        assert.deepStrictEqual(gefaehrlich, ['world_name']);
        assert.ok(!('world_name' in settings),
            'die riskante Vorgabe wurde eingesetzt, statt den Start anzuhalten');
    });

    console.log(`\n${passed} Prüfung(en) bestanden.`);
})();
