#!/usr/bin/env node
/**
 * Prüft, dass der Dateimanager die Sperrliste des PAKETS durchsetzt.
 *
 * Anlass (2026-09-26, Egg-Rückbau C3): `files.denylist` stand in jedem Paket
 * und wirkte bei keinem Server. Der Dateimanager las die Liste aus
 * `frozen_game_data` (dem Egg), prüfte nur vier von zwölf Routen, und er
 * verglich nur den letzten Pfadteil — `bin` verschwand aus der Liste,
 * `game/bin/x64/factorio` blieb über den direkten Pfad lesbar.
 *
 * Geprüft wird:
 *   1. die Auslegung der Einträge (gitignore-artig, Elternordner zählen);
 *   2. jedes Paket trägt eine gültige Liste (Zeichenketten, nicht leer);
 *   3. JEDE Route von routes/files.js, am echten Code mit Attrappen: ein
 *      gesperrter Pfad kommt nie beim Daemon an, ein freier schon. Eine Route,
 *      die hier nicht beschrieben ist, macht den Wächter rot — nie still
 *      übersprungen.
 *
 *   node scripts/check-sperrliste.js
 */

'use strict';

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');
const { ServiceManager } = require('dunebot-core');

const WURZEL = path.join(__dirname, '..');
const PAKETE = path.join(WURZEL, 'packages/fbpkg/beispiele');

let bestanden = 0;
async function check(name, fn) {
    try { await fn(); bestanden++; console.log(`  ✓ ${name}`); }
    catch (err) { process.exitCode = 1; console.log(`  ✗ ${name}\n      ${err.message}`); }
}

const still = () => {};
ServiceManager.register('Logger', { debug: still, info: still, warn: still, error: still, success: still });

(async () => {
    const { gesperrt } = require(path.join(WURZEL, 'plugins/gameserver/dashboard/helpers/Sperrliste.js'));

    console.log('\n1. Auslegung der Einträge');
    const faelle = [
        // [pfad, liste, erwartet, warum]
        ['/game/bin', ['bin'], true, 'Name trifft in jeder Tiefe'],
        ['/game/bin/x64/factorio', ['bin'], true, 'Elternordner gesperrt → alles darunter'],
        ['game/bin/x64/factorio', ['bin'], true, 'ohne führenden Schrägstrich'],
        ['/game/binaries', ['bin'], false, 'nur ganze Pfadteile'],
        ['/game/saves/welt.zip', ['bin'], false, 'fremder Pfad'],
        ['/game/server.jar', ['server.jar'], true, 'Punkt ist kein Joker'],
        ['/game/serverXjar', ['server.jar'], false, 'Punkt ist kein Joker (Gegenprobe)'],
        ['/game/logs/a.log', ['*.log'], true, 'Stern im Namen'],
        ['/game/logs/a.log/x', ['*.log'], true, 'Stern trifft auch Elternordner'],
        ['/game/bin', ['bin/'], true, 'Schrägstrich am Ende ändert nichts'],
        ['/game/bin/x', ['game/bin'], true, 'verankert ab der Wurzel'],
        ['/data/game/bin', ['game/bin'], false, 'verankert heißt: nicht tiefer'],
        ['/game/../game/bin', ['bin'], true, 'normalisiert vor dem Vergleich'],
        // Wie der Daemon (validatePath: Clean, dann Join): ein führendes `/..`
        // bleibt an der Volume-Wurzel hängen, es führt nicht hinaus.
        ['/../etc/passwd', ['bin'], false, '`/..` bleibt in der Wurzel, wie im Daemon'],
        ['/../game/bin', ['bin'], true, '… und wird trotzdem geprüft'],
        ['/game/bin', [], false, 'leere Liste sperrt nichts'],
        ['/game/bin', undefined, false, 'keine Liste sperrt nichts'],
    ];
    for (const [pfad, liste, erwartet, warum] of faelle) {
        await check(`${pfad} gegen ${JSON.stringify(liste)} → ${erwartet ? 'gesperrt' : 'frei'} (${warum})`, () => {
            assert.strictEqual(gesperrt(pfad, liste), erwartet);
        });
    }

    console.log('\n2. Listen in den Paketen');
    for (const datei of fs.readdirSync(PAKETE).filter(f => f.endsWith('.json')).sort()) {
        const paket = JSON.parse(fs.readFileSync(path.join(PAKETE, datei), 'utf8'));
        await check(`${datei}: files.denylist gültig`, () => {
            const liste = paket.files?.denylist;
            if (liste === undefined) return;
            assert.ok(Array.isArray(liste), 'keine Liste');
            for (const e of liste) assert.ok(typeof e === 'string' && e.trim(), `Eintrag ${JSON.stringify(e)}`);
        });
    }

    console.log('\n3. Jede Route von routes/files.js');
    const LISTE = ['bin', 'server.jar'];
    let daemonAufrufe = [];
    ServiceManager.register('dbService', {
        query: async (sql, params) => {
            // Die Sperrliste kommt aus der Fassung, mit der DIESER Server läuft — also
            // nach Server und Kanal gefragt, nicht mehr nach dem Addon (Baustelle 172).
            // Zuerst geprüft: Auch diese Abfrage beginnt mit „FROM gameservers gs".
            if (/FROM gameservers gs\s+JOIN packages pk/.test(sql)) {
                assert.match(sql, /gs\.channel = 'test' OR v\.channel = 'stable'/, 'die Fassung hängt am Kanal des Servers');
                assert.deepStrictEqual(params, [7]);
                return [{ kanal: 'test', paket_json: JSON.stringify({ files: { denylist: LISTE } }) }];
            }
            if (/FROM gameservers gs/.test(sql)) {
                return [{ id: 7, guild_id: 'g1', rootserver_id: 3, daemon_id: 'd1', install_path: '', addon_marketplace_id: 1706 }];
            }
            throw new Error(`Attrappe kennt die Abfrage nicht: ${sql.trim().slice(0, 80)}`);
        },
    });
    ServiceManager.register('ipmServer', {
        isDaemonOnline: () => true,
        sendCommand: async (daemon, befehl, nutzlast) => {
            daemonAufrufe.push({ befehl, nutzlast });
            if (befehl === 'gameserver.files.list') {
                return { success: true, data: { files: [
                    { name: 'bin', is_dir: true, size: 0 }, { name: 'saves', is_dir: true, size: 0 },
                ] } };
            }
            if (befehl === 'gameserver.files.read') return { success: true, data: { content: Buffer.from('x').toString('base64') } };
            return { success: true, data: {} };
        },
    });

    const router = require(path.join(WURZEL, 'plugins/gameserver/dashboard/routes/files.js'));

    // Je Route: eine Anfrage mit gesperrtem Pfad, eine mit freiem.
    const datei = { originalname: 'neu.txt', buffer: Buffer.from('x') };
    const ROUTEN = {
        'get /servers/:serverId/files/read':        { gesperrt: { query: { path: '/game/bin/x64/factorio' } }, frei: { query: { path: '/game/a.txt' } } },
        'post /servers/:serverId/files/write':      { gesperrt: { body: { path: '/game/server.jar', content: 'x' } }, frei: { body: { path: '/game/a.txt', content: 'x' } } },
        'delete /servers/:serverId/files':          { gesperrt: { query: { path: '/game/bin' } }, frei: { query: { path: '/game/a.txt' } } },
        'post /servers/:serverId/files/bulk-delete': { gesperrt: { body: { paths: ['/game/a.txt', '/game/bin/x'] } }, frei: { body: { paths: ['/game/a.txt'] } } },
        'post /servers/:serverId/files/mkdir':      { gesperrt: { body: { path: '/game/bin/neu' } }, frei: { body: { path: '/game/neu' } } },
        'delete /servers/:serverId/files/rmdir':    { gesperrt: { query: { path: '/game/bin' } }, frei: { query: { path: '/game/alt' } } },
        'post /servers/:serverId/files/rename':     { gesperrt: { body: { path: '/game/a.jar', new_name: 'server.jar' } }, frei: { body: { path: '/game/a.txt', new_name: 'b.txt' } } },
        'post /servers/:serverId/files/move':       { gesperrt: { body: { source_path: '/game/a.txt', dest_path: '/game/bin/a.txt' } }, frei: { body: { source_path: '/game/a.txt', dest_path: '/game/x/a.txt' } } },
        'post /servers/:serverId/files/bulk-move':  { gesperrt: { body: { source_paths: ['/game/bin'], dest_folder: '/game/x' } }, frei: { body: { source_paths: ['/game/a.txt'], dest_folder: '/game/x' } } },
        'post /servers/:serverId/files/upload':     { gesperrt: { body: { path: '/game/bin' }, file: datei }, frei: { body: { path: '/game' }, file: datei } },
        'get /servers/:serverId/files/download':    { gesperrt: { query: { path: '/game/server.jar' } }, frei: { query: { path: '/game/a.txt' } } },
    };

    function antwort() {
        const r = { statusCode: 200, body: null, locals: { guildId: 'g1' }, headers: {} };
        r.status = c => { r.statusCode = c; return r; };
        r.json = b => { r.body = b; return r; };
        r.setHeader = (k, v) => { r.headers[k] = v; };
        r.send = b => { r.body = b; return r; };
        return r;
    }
    async function rufe(route, anfrage) {
        const handler = route.stack[route.stack.length - 1].handle;
        const req = { params: { serverId: '7' }, query: {}, body: {}, ...anfrage };
        const res = antwort();
        await handler(req, res, err => { throw err || new Error('next() gerufen'); });
        return res;
    }

    const gesehen = new Set();
    for (const schicht of router.stack.filter(s => s.route)) {
        for (const methode of Object.keys(schicht.route.methods)) {
            const name = `${methode} ${schicht.route.path}`;
            gesehen.add(name);
            if (name === 'get /servers/:serverId/files') {
                await check(`${name}: gesperrter Eintrag wird nicht angezeigt`, async () => {
                    daemonAufrufe = [];
                    const res = await rufe(schicht.route, { query: { path: '/game' } });
                    assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
                    assert.deepStrictEqual(res.body.files.map(f => f.name), ['saves']);
                });
                continue;
            }
            const fall = ROUTEN[name];
            await check(`${name}: im Wächter beschrieben`, () => assert.ok(fall, 'neue Route — Fall in ROUTEN ergänzen'));
            if (!fall) continue;
            await check(`${name}: gesperrter Pfad → 403, Daemon nicht gefragt`, async () => {
                daemonAufrufe = [];
                const res = await rufe(schicht.route, fall.gesperrt);
                assert.strictEqual(res.statusCode, 403, `Status ${res.statusCode}: ${JSON.stringify(res.body)}`);
                assert.deepStrictEqual(daemonAufrufe.map(a => a.befehl), []);
            });
            await check(`${name}: freier Pfad kommt beim Daemon an`, async () => {
                daemonAufrufe = [];
                const res = await rufe(schicht.route, fall.frei);
                assert.notStrictEqual(res.statusCode, 403, JSON.stringify(res.body));
                assert.ok(daemonAufrufe.length > 0, 'kein Daemon-Aufruf');
            });
        }
    }
    await check('keine beschriebene Route fehlt im Router', () => {
        const fehlt = Object.keys(ROUTEN).filter(n => !gesehen.has(n));
        assert.deepStrictEqual(fehlt, []);
    });

    console.log(`\n${bestanden} Prüfungen bestanden${process.exitCode ? ' — ES GIBT FEHLER' : ''}`);
})().catch(err => { console.error(err); process.exit(1); });
