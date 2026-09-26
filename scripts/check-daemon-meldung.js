#!/usr/bin/env node
/**
 * Prüft die Meldung „Daemon-Update verfügbar" im Guild-Bereich (2026-09-26).
 *
 * Wunsch des Betreibers: wie die übrigen Meldungen, wegklickbar, und von selbst
 * weg, wenn das Update durch ist — sichtbar nur für den, der es auslösen darf,
 * und nur im Guild-Bereich.
 *
 * Geprüft wird am echten Code, mit Attrappen, die unbekannte Abfragen melden:
 *   1. die Meldung entsteht nur bei verbundenem Daemon mit Rückstand, trägt die
 *      Zielfassung in der Kennung und escapt den Namen;
 *   2. Textkennungen überleben das Wegklicken (vorher: Number() → NaN);
 *   3. der Kern mischt die Meldungen der Plugins ein, ohne weggeklickte, und
 *      nicht auf /admin;
 *   4. der Filter des Masterserver-Plugins prüft Plugin und Recht.
 *
 *   node scripts/check-daemon-meldung.js
 */

'use strict';

const assert = require('assert');
const path = require('path');
const { ServiceManager } = require('dunebot-core');
const PluginHooks = require('dunebot-core/lib/PluginHooks');

const W = path.join(__dirname, '..');
const still = () => {};
const logger = { debug: still, info: still, warn: still, error: still, success: still };
ServiceManager.register('Logger', logger);

let bestanden = 0;
async function check(name, fn) {
    try { await fn(); bestanden++; console.log(`  ✓ ${name}`); }
    catch (e) { process.exitCode = 1; console.log(`  ✗ ${name}\n      ${e.message}`); }
}

const { daemonUpdateMeldungen } = require(path.join(W, 'plugins/masterserver/dashboard/helpers/DaemonMeldung'));
const NotificationManager = require(path.join(W, 'packages/dunebot-sdk/lib/NotificationManager'));
const ThemeManager = require(path.join(W, 'packages/dunebot-sdk/lib/ThemeManager'));
const Masterserver = require(path.join(W, 'plugins/masterserver/dashboard/index'));

const RS = [
    { id: 54, name: 'DeinServerHost', daemon_id: 'd54' },
    { id: 55, name: '<img src=x onerror=alert(1)>', daemon_id: 'd55' },
    { id: 56, name: 'Aus', daemon_id: 'd56' },
    { id: 57, name: 'Aktuell', daemon_id: 'd57' },
];
const STAND = {
    d54: { online: true, version: '1.0.102', latestVersion: '1.0.103', updateAvailable: true },
    d55: { online: true, version: '1.0.101', latestVersion: '1.0.103', updateAvailable: true },
    d56: { online: false, version: null, latestVersion: '1.0.103', updateAvailable: false },
    d57: { online: true, version: '1.0.103', latestVersion: '1.0.103', updateAvailable: false },
};

(async () => {
    console.log('\n1. Die Meldung');
    const m = daemonUpdateMeldungen({ guildId: 'g1', rootserver: RS, stand: id => STAND[id] });
    await check('nur verbundene Daemons mit Rückstand', () => {
        assert.deepStrictEqual(m.map(x => x.id), ['daemon-update-54-1.0.103', 'daemon-update-55-1.0.103']);
    });
    await check('sagt von welcher auf welche Fassung, und führt zu den Rootservern', () => {
        assert.match(m[0].message, /DeinServerHost<\/strong> läuft mit 1\.0\.102, verfügbar ist 1\.0\.103/);
        assert.strictEqual(m[0].action_url, '/guild/g1/plugins/masterserver/rootservers');
    });
    await check('der Name ist escapt — die Vorlage gibt message ungeschützt aus', () => {
        assert.ok(!m[1].message.includes('<img'), m[1].message);
        assert.match(m[1].message, /&lt;img src=x onerror=alert\(1\)&gt;/);
    });

    await check('der Knopf öffnet die Rootserver-Seite im selben Fenster, fremde Adressen in einem neuen', () => {
        const ejs = require('ejs');
        const fs = require('fs');
        const datei = path.join(W, 'apps/dashboard/themes/default/views/layouts/guild.ejs');
        const quelle = fs.readFileSync(datei, 'utf8');
        const a = quelle.indexOf('<% if (notification.action_url');
        assert.ok(a >= 0, 'Knopf der Meldung im Layout nicht gefunden');
        const b = quelle.indexOf('<% } %>', quelle.indexOf('</a>', a)) + 7;
        const knopf = (url) => ejs.render(quelle.slice(a, b), { notification: { action_url: url, action_text: 'x' } });
        assert.ok(!/target=/.test(knopf(m[0].action_url)), knopf(m[0].action_url));
        assert.match(knopf('https://example.com'), /target="_blank"/);
        assert.match(knopf('//fremd.example'), /target="_blank"/);
    });

    console.log('\n2. Wegklicken mit Textkennung');
    const { normalisiereKennung } = NotificationManager;
    await check('Zahl bleibt Zahl, Textkennung bleibt Text, Unsinn wird abgewiesen', () => {
        assert.strictEqual(normalisiereKennung('12'), 12);
        assert.strictEqual(normalisiereKennung('daemon-update-54-1.0.103'), 'daemon-update-54-1.0.103');
        for (const x of ['', 'mit leer', '<b>', '../x', null]) assert.strictEqual(normalisiereKennung(x), null, String(x));
    });
    await check('dismissNotification speichert die Textkennung neben alten Zahlen', async () => {
        let gespeichert = null;
        ServiceManager.register('dbService', {
            async query(sql) {
                if (/FROM user_configs WHERE user_id = \? AND plugin_name = 'core' AND config_key = 'DISMISSED_NOTIFICATIONS'/.test(sql)) {
                    return [{ id: 1, config_value: JSON.stringify([3, '7']) }];
                }
                throw new Error('Attrappe kennt die Abfrage nicht: ' + sql.slice(0, 80));
            },
            async setUserConfig(u, p, k, v) { gespeichert = v; },
        });
        const nm = new NotificationManager();
        assert.strictEqual(await nm.dismissNotification('daemon-update-54-1.0.103', 'u1'), true);
        assert.deepStrictEqual(gespeichert, [3, 7, 'daemon-update-54-1.0.103']);
        assert.strictEqual(await nm.dismissNotification('<b>', 'u1'), false);
    });

    console.log('\n3. Der Kern mischt die Meldungen der Plugins ein');
    const hooks = new PluginHooks(logger);
    hooks.addFilter('guild_notices', async (n) => n);
    hooks.addFilter('guild_notices', async (n, o) => { n.push(...daemonUpdateMeldungen({ guildId: o.guildId, rootserver: RS, stand: id => STAND[id] })); return n; });
    ServiceManager.register('pluginManager', { hooks });
    ServiceManager.register('dbService', {
        async query(sql) {
            if (/FROM notifications/.test(sql)) return [];
            throw new Error('Attrappe kennt die Abfrage nicht: ' + sql.slice(0, 80));
        },
        async getUserConfig(u, p, k) { return k === 'DISMISSED_NOTIFICATIONS' ? ['daemon-update-55-1.0.103'] : null; },
    });
    ServiceManager.register('notificationManager', new NotificationManager());
    const laden = async (pfad) => {
        const req = { path: pfad, session: { user: { info: { id: 'u1' } } } };
        const res = { locals: { guildId: 'g1' } };
        await ThemeManager.prototype.loadGlobalNotifications.call({}, req, res);
        return res.locals.globalNotifications.map(x => x.id);
    };
    await check('im Guild-Bereich: da, ohne die weggeklickte', async () => {
        assert.deepStrictEqual(await laden('/guild/g1/plugins/gameserver/servers'), ['daemon-update-54-1.0.103']);
    });
    await check('auf /admin nicht, obwohl guildId für die Navigation gesetzt ist', async () => {
        assert.deepStrictEqual(await laden('/admin/addons'), []);
    });
    await check('nach dem Update (Daemon meldet die neue Fassung): weg, ohne dass jemand etwas löscht', async () => {
        const vorher = STAND.d54;
        STAND.d54 = { online: true, version: '1.0.103', latestVersion: '1.0.103', updateAvailable: false };
        try { assert.deepStrictEqual(await laden('/guild/g1'), []); }
        finally { STAND.d54 = vorher; }
    });

    console.log('\n4. Filter des Masterserver-Plugins: Plugin aktiv und Recht');
    const faelle = [
        { aktiv: true, recht: true, erwartet: 2 },
        { aktiv: false, recht: true, erwartet: 0 },
        { aktiv: true, recht: false, erwartet: 0 },
    ];
    for (const f of faelle) {
        await check(`Plugin ${f.aktiv ? 'aktiv' : 'aus'}, Recht ${f.recht ? 'da' : 'fehlt'} → ${f.erwartet} Meldung(en)`, async () => {
            let filter = null;
            const gefragt = [];
            ServiceManager.register('pluginManager', {
                hooks: { addFilter: (name, fn) => { if (name === 'guild_notices') filter = fn; } },
                isPluginEnabledForGuild: async (p, g) => { gefragt.push(p + '@' + g); return f.aktiv; },
            });
            ServiceManager.register('permissionManager', {
                hasPermission: async (u, g, key) => { gefragt.push(key); return f.recht; },
            });
            ServiceManager.register('ipmServer', { daemonUpdateStand: id => STAND[id] });
            ServiceManager.register('dbService', {
                tableExists: async () => false,
                async query(sql, p) {
                    if (/FROM rootserver r WHERE r\.guild_id = \?/.test(sql)) { assert.deepStrictEqual(p, ['g1']); return RS; }
                    throw new Error('Attrappe kennt die Abfrage nicht: ' + sql.slice(0, 80));
                },
            });
            Masterserver.prototype._registerMeldungen.call({});
            assert.ok(filter, 'kein Filter guild_notices registriert');
            const aus = await filter([], { guildId: 'g1', user: { id: 'u1' } });
            assert.strictEqual(aus.length, f.erwartet, JSON.stringify(aus.map(x => x.id)));
            assert.ok(gefragt.includes('masterserver@g1'), 'Aktivierung nicht geprüft');
            if (f.aktiv) assert.ok(gefragt.includes('MASTERSERVER.DAEMON.MANAGE'), 'falsches Recht: ' + gefragt);
        });
    }

    console.log(`\n${bestanden} Prüfungen bestanden${process.exitCode ? ' — ES GIBT FEHLER' : ''}`);
})().catch(e => { console.error(e); process.exit(1); });
