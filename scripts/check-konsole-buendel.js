#!/usr/bin/env node
/**
 * Die Konsole kommt gebündelt an (FireBus Etappe 3).
 *
 * Der Daemon schickt alle 100 ms ein Paket mit `lines` und `ausgelassen`. Das Dashboard
 * gibt daraus Zeile für Zeile an die Browser weiter und sagt, was fehlt. Bündeln und
 * Auslassen selbst prüft `konsole_buendel_test.go`.
 *
 *   node scripts/check-konsole-buendel.js
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ohneKommentare } = require('./lib/quelltext');
const ConsoleManager = require('../plugins/gameserver/dashboard/helpers/ConsoleManager');
const Klasse = ConsoleManager.ConsoleManager || ConsoleManager;

let fehler = 0;
async function pruefe(was, tun) {
    try { await tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').slice(0, 3).join('\n      ')}`); }
}

function attrappe(mitWs) {
    const spur = { history: [], sse: [], ws: [] };
    const socket = { send: (m) => spur.ws.push(JSON.parse(m)) };
    const m = Object.create(Klasse.prototype);
    Object.assign(m, {
        Logger: { debug() {}, warn() {}, error(t, e) { throw e || new Error(t); } },
        wsClients: new Map(mitWs ? [['231', new Set([socket])]] : []),
        sseManager: { broadcast: (_g, _n, d) => spur.sse.push(d) },
        _addToHistory: (_s, zeile) => spur.history.push(zeile),
        _getGuildIdForServer: async () => 'g1',
    });
    return { m, spur };
}

(async () => {
    console.log('\nKonsole gebündelt');
    await pruefe('ein Paket wird zu einzelnen Zeilen, in der Reihenfolge', async () => {
        const { m, spur } = attrappe(true);
        await m._handleConsoleOutput({ server_id: '231', lines: ['eins', 'zwei', 'drei'], ausgelassen: 0 });
        assert.deepStrictEqual(spur.history, ['eins', 'zwei', 'drei']);
        assert.deepStrictEqual(spur.ws.map(z => z.line), ['eins', 'zwei', 'drei']);
    });
    await pruefe('Ausgelassenes steht in der Konsole, auch ohne eine einzige Zeile', async () => {
        const { m, spur } = attrappe(false);
        await m._handleConsoleOutput({ server_id: '231', lines: null, ausgelassen: 12 });
        assert.deepStrictEqual(spur.sse.map(z => z.line), ['[FireDaemon] 12 Zeilen ausgelassen']);
    });
    await pruefe('ein Daemon von vor dem Bündeln kommt noch an', async () => {
        const { m, spur } = attrappe(false);
        await m._handleConsoleOutput({ server_id: '231', line: 'alt' });
        assert.deepStrictEqual(spur.history, ['alt']);
    });
    await pruefe('die JSON-Hülle wird auch im Paket ausgepackt', async () => {
        const { m, spur } = attrappe(false);
        await m._handleConsoleOutput({ server_id: '231', lines: ['{"topic":"console output","data":"innen"}'] });
        assert.deepStrictEqual(spur.history, ['innen']);
    });
    console.log('\nMesswerte als Paket');
    await pruefe('ein Paket wird zu einer Meldung je Server, die Einzelmeldung geht noch', async () => {
        const quelle = ohneKommentare(fs.readFileSync(path.join(__dirname, '../plugins/gameserver/dashboard/index.js'), 'utf8'));
        const anfang = quelle.indexOf('async _handleResourceUsage(');
        const koerper = quelle.slice(anfang, quelle.indexOf('async _gibMesswertWeiter(', anfang));
        const gesehen = [];
        const handler = new Function('payload', 'context', 'return (async function () {'
            + koerper.slice(koerper.indexOf('{') + 1, koerper.lastIndexOf('}')) + '}).call(this);');
        const ziel = { _gibMesswertWeiter: async (m) => gesehen.push(m.server_id) };
        await handler.call(ziel, { server: [{ server_id: '1' }, { server_id: '2' }] }, {});
        await handler.call(ziel, { server_id: '3' }, {});
        assert.deepStrictEqual(gesehen, ['1', '2', '3']);
    });

    console.log(fehler ? `\n✗ ${fehler} Prüfung(en) rot` : '\n✅ Die Konsole kommt gebündelt an');
    process.exit(fehler ? 1 : 0);
})();
