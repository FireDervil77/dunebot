#!/usr/bin/env node
/**
 * Eine laufende Installation ist kein Fehler — und ihre Ausgabe geht nicht verloren.
 *
 * Hytale #206 (2026-10-01): Der Downloader wartete in der Installation auf den
 * Anmeldecode. Dessen Zeile ging nur LIVE an die Konsole; wer sie danach
 * öffnete, sah „History: 0 Zeilen". Beim Neuverbinden des Daemons stieß das
 * Dashboard die Installation erneut an, der Daemon sagte „angenommen", der Lauf
 * scheiterte an der Sperre und schickte install.failed — das Dashboard setzte
 * den Server auf „Fehler", der Start-Knopf wurde frei, der Start scheiterte
 * ohne Dateien (Code 126). „Neu installieren" prallte danach an der laufenden
 * Installation ab und ließ den Server auf „installing" (toter else-Zweig).
 *
 * Geprüft wird:
 *   1. der Daemon lehnt einen zweiten Auftrag SOFORT mit `code: install_laeuft`
 *      ab und schickt dann kein install.failed;
 *   2. IPMServer reicht die Kennung an den Aufrufer durch;
 *   3. Wiederanstoß und beide Routen behandeln sie als „läuft noch";
 *   4. die Ausgabe der Installation wird gemerkt — begrenzt, je Guild, erst bei
 *      ANNAHME eines neuen Auftrags geleert — und die Konsole bekommt sie.
 *
 *   node scripts/check-install-laeuft.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ServiceManager } = require('dunebot-core');
const { ohneKommentare } = require('./lib/quelltext');

const WURZEL = path.join(__dirname, '..');
const DAEMON = '/home/firedervil/firebot_daemon';
const still = () => {};
if (!ServiceManager.has('Logger')) {
    ServiceManager.register('Logger', { debug: still, info: still, warn: still, error: still, success: still });
}
const IPMServer = require(path.join(WURZEL, 'apps/dashboard/helpers/IPMServer'));

let bestanden = 0;
async function pruefe(name, fn) {
    try { await fn(); console.log(`  ✓ ${name}`); bestanden++; }
    catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

/** Ein IPMServer ohne Netz: Befehle landen in `gesendet`, Antworten per Hand. */
function ipm() {
    const o = Object.create(IPMServer.prototype);
    o.Logger = { debug: still, info: still, warn: still, error: still, success: still };
    o.pendingCommands = new Map();
    o.gesendet = [];
    o.connections = new Map([['d1', { ws: { send: (t) => o.gesendet.push(JSON.parse(t)) } }]]);
    return o;
}

(async () => {
    console.log('\nDaemon');

    await pruefe('ein zweiter Auftrag wird sofort mit code install_laeuft abgelehnt, ohne install.failed', async () => {
        const go = ohneKommentare(fs.readFileSync(path.join(DAEMON, 'internal/websocket/client.go'), 'utf8'));
        const h = go.slice(go.indexOf('func (c *Client) handleGameserverInstall('));
        const pruef = h.indexOf('InstallLaeuft(req.ServerID)');
        const ports = h.indexOf('AllocatePorts(');
        assert.ok(pruef > 0 && pruef < ports, 'die Prüfung steht nicht VOR der Portvergabe');
        assert.match(h.slice(pruef, pruef + 400), /"code":\s*"install_laeuft"/);
        assert.match(h, /errors\.Is\(err, gameserver\.ErrInstallLaeuft\)[\s\S]{0,200}return/, 'das Rennen schickt doch install.failed');
    });

    console.log('\nIPMServer');

    await pruefe('eine Ablehnung trägt ihre Kennung zum Aufrufer', async () => {
        const o = ipm();
        const p = o.sendCommand('d1', 'gameserver.install', { server_id: '206' }, 2000);
        o._resolveCommand(o.gesendet[0].id, { success: false, error: 'für Server 206 läuft bereits …', code: 'install_laeuft' });
        await assert.rejects(p, (e) => e.code === 'install_laeuft' && /läuft bereits/.test(e.message));
        const q = o.sendCommand('d1', 'gameserver.start', {}, 2000);
        o._resolveCommand(o.gesendet[1].id, { success: false, error: 'kaputt' });
        await assert.rejects(q, (e) => e.code === undefined, 'ohne Kennung keine erfundene');
    });

    await pruefe('Installationszeilen: begrenzt, je Guild, gekürzt am Anfang', async () => {
        const o = ipm();
        for (let i = 0; i < IPMServer.INSTALL_ZEILEN + 5; i++) o.installZeileMerken(206, 'g1', 'Zeile ' + i);
        o.installZeileMerken(206, 'g1', 'x'.repeat(IPMServer.INSTALL_ZEILE_LAENGE * 2) + 'ENDE');
        const z = o.installZeilen(206, 'g1');
        assert.strictEqual(z.length, IPMServer.INSTALL_ZEILEN);
        assert.ok(z[z.length - 1].endsWith('ENDE'), 'das Ende eines Fortschrittsbalkens ist der Stand');
        assert.strictEqual(o.installZeilen(206, 'g2').length, 0, 'fremde Guild sieht nichts');
        assert.strictEqual(o.installZeilen('206', 'g1').length, z.length, 'Zahl und Text sind derselbe Server');
    });

    await pruefe('geleert wird erst, wenn ein neuer Auftrag ANGENOMMEN ist — nie bei Ablehnung', async () => {
        const o = ipm();
        o.installZeileMerken(206, 'g1', 'Enter code: ABCD-1234');
        const abgelehnt = o.sendCommand('d1', 'gameserver.install', { server_id: '206' }, 2000);
        o._resolveCommand(o.gesendet[0].id, { success: false, error: 'läuft', code: 'install_laeuft' });
        await abgelehnt.catch(() => {});
        assert.deepStrictEqual(o.installZeilen(206, 'g1'), ['Enter code: ABCD-1234'], 'Ablehnung löschte die laufende Ausgabe');
        const angenommen = o.sendCommand('d1', 'gameserver.install', { server_id: '206' }, 2000);
        o._resolveCommand(o.gesendet[1].id, { success: true });
        await angenommen;
        assert.strictEqual(o.installZeilen(206, 'g1').length, 0, 'neue Installation, alte Zeilen weg');
    });

    await pruefe('der install.output-Zuhörer merkt jede Zeile', async () => {
        const src = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'apps/dashboard/helpers/IPMServer.js'), 'utf8'));
        const h = src.slice(src.indexOf("eventRouter.register('install', 'output'"));
        assert.match(h.slice(0, 1500), /this\.installZeileMerken\(payload\.server_id, server\.guild_id, payload\.line\)/);
    });

    await pruefe('Wiederanstoß: install_laeuft setzt keinen Fehler', async () => {
        const src = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'apps/dashboard/helpers/IPMServer.js'), 'utf8'));
        const h = src.slice(src.indexOf('async _retriggerPendingInstallations('));
        const fang = h.indexOf('catch (serverError)');
        const kennung = h.indexOf("serverError?.code === 'install_laeuft'", fang);
        const fehler = h.indexOf("'error'", fang);
        assert.ok(kennung > fang && kennung < fehler, 'die Kennung wird nicht VOR dem Fehler-Status geprüft');
        assert.match(h.slice(kennung, kennung + 300), /continue;/);
    });

    console.log('\nRouten');

    await pruefe('Neu installieren / Erneut versuchen: läuft noch → 409, Status installing; sonst Fehler mit Grund', async () => {
        const src = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'plugins/gameserver/dashboard/routes/servers.js'), 'utf8'));
        for (const route of ["router.post('/:serverId/reinstall'", "router.post('/:serverId/retry-installation'"]) {
            const r = src.slice(src.indexOf(route));
            const ende = r.indexOf('\n});');
            const fang = r.slice(r.lastIndexOf('} catch (error) {', ende), ende);
            assert.match(fang, /error\?\.code === 'install_laeuft'[\s\S]*installLaeuftNoch[\s\S]*status\(409\)/, route + ': läuft-noch fehlt');
            assert.match(fang, /UPDATE gameservers SET status = \?, error_message = \?/, route + ': ein echter Fehler setzt keinen Status');
        }
    });

    await pruefe('Konsole: beim Öffnen kommt die Ausgabe der Installation mit (installing/error, eigene Guild)', async () => {
        const src = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'plugins/gameserver/dashboard/routes/console.js'), 'utf8'));
        assert.match(src, /SELECT status FROM gameservers WHERE id = \? AND guild_id = \?/);
        assert.match(src, /status === 'installing' \|\| zeile\.status === 'error'/);
        assert.match(src, /installZeilen\(serverId, guildId\)/);
        assert.match(src, /history = \[[^\]]*\.\.\.install, \.\.\.history\]/);
    });

    console.log(`\n${bestanden} Prüfung(en) bestanden${process.exitCode ? ' — ES GIBT FEHLER' : ''}\n`);
})().catch(e => { console.error(e); process.exit(1); });
