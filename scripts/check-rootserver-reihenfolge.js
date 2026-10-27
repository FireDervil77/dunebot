#!/usr/bin/env node
/**
 * Rootserver: ältester zuerst — und Tasks beim richtigen Daemon (2026-10-27).
 *
 * Betreiber: „Auf der Rootserver-Übersicht ist die Sortierung falsch herum,
 * der erste angelegte Server sollte vorn stehen." `getByGuild` sortierte
 * `created_at DESC`.
 *
 * Daran hing mehr als die Anzeige: Die Task-Routen fragten „den ersten"
 * Rootserver der Guild — den neuesten. Mit zwei Maschinen fehlten die Tasks
 * der anderen. Die Reihenfolge umzudrehen hätte den Fehler nur verschoben.
 * Jetzt: Tasks eines Servers beim Daemon SEINES Rootservers; ein einzelner
 * Task bei dem verbundenen Daemon, der ihn kennt.
 *
 *   node scripts/check-rootserver-reihenfolge.js
 */
'use strict';
const path = require('path');
const assert = require('assert');
const { ServiceManager } = require('dunebot-core');

const WURZEL = path.join(__dirname, '..');
const still = () => {};
ServiceManager.register('Logger', { debug: still, info: still, warn: still, error: still, success: still });

const spur = { sql: [], befehle: [] };
const ROOTSERVER = [{ id: 54, daemon_id: 'd54' }, { id: 55, daemon_id: 'd55' }];
ServiceManager.register('dbService', {
    tableExists: async () => true,
    query: async (sql, w) => {
        const t = sql.replace(/\s+/g, ' ').trim();
        spur.sql.push(t);
        if (/FROM rootserver r .*WHERE r\.guild_id = \?/.test(t)) return ROOTSERVER;
        if (/SELECT r\.daemon_id FROM gameservers gs JOIN rootserver r/.test(t)) return w[0] === '223' ? [{ daemon_id: 'd54' }] : [];
        throw new Error('Attrappe kennt die Abfrage nicht: ' + t.slice(0, 90));
    },
});
ServiceManager.register('ipmServer', {
    isDaemonOnline: () => true,
    async sendCommand(daemonId, befehl, nutzlast) {
        spur.befehle.push(`${daemonId} ${befehl}`);
        if (befehl === 'task:get') {
            if (daemonId === 'd55' && nutzlast.task_id === 't1') return { success: true, task: { id: 't1' } };
            throw new Error('Task nicht gefunden');
        }
        if (befehl === 'task:list') return { success: true, tasks: [{ von: daemonId }], count: 1 };
        if (befehl === 'task:cancel') return { success: true };
        throw new Error('unerwartet: ' + befehl);
    },
});

const router = require(path.join(WURZEL, 'plugins/masterserver/dashboard/routes/task.router.js'));
const RootServer = require(path.join(WURZEL, 'plugins/masterserver/dashboard/models/RootServer.js'));
const handle = (methode, pfad) => router.stack.find(l => l.route?.path === pfad && l.route.methods[methode]).route.stack.at(-1).handle;
async function rufe(methode, pfad, params) {
    let antwort = { status: 200 };
    const res = { locals: { guildId: 'g1' }, status(s) { antwort.status = s; return this; }, json(o) { Object.assign(antwort, o); return this; } };
    await handle(methode, pfad)({ params, query: {} }, res);
    return antwort;
}

let fehler = 0, bestanden = 0;
async function pruefe(was, tun) {
    spur.sql = []; spur.befehle = [];
    try { await tun(); bestanden++; console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').slice(0, 4).join('\n      ')}`); }
}

(async () => {
    await pruefe('getByGuild: ältester zuerst, bei Gleichstand nach Nummer', async () => {
        await RootServer.getByGuild('g1');
        assert.match(spur.sql[0], /ORDER BY r\.created_at ASC, r\.id ASC/);
    });

    await pruefe('ein Task wird bei dem Daemon gesucht, der ihn kennt — nicht beim ersten', async () => {
        const a = await rufe('get', '/:taskId', { taskId: 't1' });
        assert.strictEqual(a.status, 200);
        assert.deepStrictEqual(a.task, { id: 't1' });
        assert.deepStrictEqual(spur.befehle, ['d54 task:get', 'd55 task:get']);
    });

    await pruefe('abbrechen geht an genau diesen Daemon', async () => {
        const a = await rufe('post', '/:taskId/cancel', { taskId: 't1' });
        assert.strictEqual(a.success, true);
        assert.deepStrictEqual(spur.befehle.filter(b => b.endsWith('task:cancel')), ['d55 task:cancel']);
    });

    await pruefe('die Tasks eines Servers kommen vom Daemon seines Rootservers', async () => {
        const a = await rufe('get', '/server/:serverId', { serverId: '223' });
        assert.deepStrictEqual(a.tasks, [{ von: 'd54' }]);
        assert.strictEqual((await rufe('get', '/server/:serverId', { serverId: '999' })).status, 404, 'fremder Server');
    });

    await pruefe('ein Task, den keiner kennt, ist ein 404', async () => {
        assert.strictEqual((await rufe('get', '/:taskId', { taskId: 'nix' })).status, 404);
    });

    console.log(fehler ? `\n✗ ${fehler} gescheitert, ${bestanden} bestanden` : `\n✓ ${bestanden} bestanden`);
    process.exit(fehler ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
