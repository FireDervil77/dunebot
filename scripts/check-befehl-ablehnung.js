#!/usr/bin/env node
/**
 * Lehnt der Daemon Start, Stopp oder Neustart ab, muss der Grund ankommen
 * (2026-10-28, gefunden bei Baustelle 119).
 *
 * `IPMServer.sendCommand` WIRFT bei einer Ablehnung (`_resolveCommand` →
 * `pending.reject`). Ein Ergebnis mit `success: false` kommt nie an. Fünf
 * Stellen prüften trotzdem `if (!antwort.success)` — der Zweig lief nie:
 * Web-Start und -Neustart (`routes/servers.js`), Discord-Start, -Stopp und
 * -Neustart (`apps/dashboard/helpers/IPCServer.js`). Der Server blieb bis zum
 * Ventil (5 Min.) auf „starting"/„stopping", der Grund des Daemons ging
 * verloren, `error_message` blieb leer.
 *
 * Seit dem Abend desselben Tages geht der Discord-Stopp über ServerStopp
 * (check-server-stopp.js prüft das) — hier bleiben vier Stellen.
 *
 *   Voraussetzung  _resolveCommand wirft wirklich bei success: false —
 *                  ändert sich das, ist dieser Wächter neu zu denken
 *   Stellen        wer das Ergebnis von gameserver.start/stop/restart in eine
 *                  Variable legt, hängt `.catch(` an; im Fehlerzweig der
 *                  IPC-Wege steht error_message
 *
 * Nicht gemeint: Aufrufe ohne Ergebnisvariable (Plugin-Abbau, CronWorker) —
 * die brauchen den Wurf, ihr `catch` ist die Fehlerbehandlung.
 *
 *   node scripts/check-befehl-ablehnung.js
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ohneKommentare } = require('./lib/quelltext');
const WURZEL = path.join(__dirname, '..');
const lies = (rel) => ohneKommentare(fs.readFileSync(path.join(WURZEL, rel), 'utf8'));

let fehler = 0;
async function pruefe(was, tun) {
    try { await tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').slice(0, 3).join('\n      ')}`); }
}

// ServerStopp.js fängt mit try/catch um `antwort = await …` — keine Zuweisung
// mit const/let, also nicht in dieser Liste; es war schon richtig.
const DATEIEN = ['plugins/gameserver/dashboard/routes/servers.js', 'apps/dashboard/helpers/IPCServer.js'];

/** Jede Anweisung `const|let x = await …sendCommand(…'gameserver.(start|stop|restart)'…` bis zum `;`. */
function zuweisungen(quelle) {
    const treffer = [];
    const muster = /(?:const|let)\s+(\w+)\s*=\s*await\s+[\w.?]*sendCommand\(/g;
    for (let m; (m = muster.exec(quelle));) {
        const ende = quelle.indexOf(';', m.index);
        const anweisung = quelle.slice(m.index, ende);
        const befehl = anweisung.match(/'gameserver\.(start|stop|restart)'/);
        if (befehl) treffer.push({ name: m[1], befehl: befehl[1], anweisung, zeile: quelle.slice(0, m.index).split('\n').length });
    }
    return treffer;
}

(async () => {
    console.log('\nAblehnung des Daemons bei Start, Stopp, Neustart');

    await pruefe('Voraussetzung: _resolveCommand wirft bei success: false, mit dem Grund', async () => {
        const still = () => {};
        const { ServiceManager } = require('dunebot-core');
        if (!ServiceManager.has('Logger')) ServiceManager.register('Logger', { debug: still, info: still, warn: still, error: still, success: still });
        const IPMServer = require('../apps/dashboard/helpers/IPMServer');
        const proto = (IPMServer.prototype && IPMServer.prototype._resolveCommand) ? IPMServer.prototype
            : Object.getPrototypeOf(IPMServer);
        const zusage = new Promise((resolve, reject) => {
            const selbst = { pendingCommands: new Map([['k', { resolve, reject }]]), Logger: { warn() {} } };
            proto._resolveCommand.call(selbst, 'k', { success: false, error: 'image fehlt' });
        });
        await assert.rejects(zusage, /image fehlt/);
    });

    const alle = DATEIEN.flatMap(d => zuweisungen(lies(d)).map(t => ({ ...t, datei: d })));

    await pruefe('gefunden: mindestens die vier Stellen', async () => {
        assert.ok(alle.length >= 4, `nur ${alle.length} Zuweisungen gefunden — Muster veraltet?`);
    });

    await pruefe('jede Zuweisung hängt .catch( an', async () => {
        const ohne = alle.filter(t => !t.anweisung.includes('.catch('));
        assert.deepStrictEqual(ohne.map(t => `${t.datei}:${t.zeile} (${t.befehl})`), []);
    });

    await pruefe('IPC-Wege: der Fehlerzweig schreibt error_message', async () => {
        const ipc = lies('apps/dashboard/helpers/IPCServer.js');
        const fehlend = [];
        for (const t of alle.filter(x => x.datei.endsWith('IPCServer.js'))) {
            const ab = ipc.indexOf(`if (!${t.name}?.success)`);
            const zweig = ab >= 0 ? ipc.slice(ab, ipc.indexOf('return message.reply', ab)) : '';
            if (!/error_message = \?/.test(zweig)) fehlend.push(`${t.befehl} (${t.name})`);
        }
        assert.deepStrictEqual(fehlend, []);
    });

    console.log(fehler ? `\n✗ ${fehler} Prüfung(en) rot` : '\n✓ alles grün');
    process.exit(fehler ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
