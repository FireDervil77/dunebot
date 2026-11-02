#!/usr/bin/env node
/**
 * Zwei Abfragen zugleich dürfen das Dashboard nicht beenden (2026-11-02).
 *
 * GameDig merkt sich seinen UDP-Socket erst nach dem `bind`. Zwei Abfragen zugleich
 * legen deshalb zwei an, und in einem Cluster-Arbeiter von pm2 beendet das den
 * Prozess. Das Dashboard stürzte am 2026-11-02 alle 12 Sekunden ab, sobald beim Start
 * zwei Server liefen, denn der StatusPoller fragt sie gleichzeitig ab.
 *
 * Gefahren wird das echte GameDig in einem echten Cluster-Arbeiter, einmal ohne
 * und einmal mit vorab angelegtem Socket. Die Gegenprobe zeigt, dass der Fehler
 * noch besteht: Beseitigt ihn ein GameDig-Update, wird dieser Wächter rot, und die
 * Umgehung in `QueryService.js` kann weg. Sie greift auf etwas Privates zu.
 *
 * Nichts wird geschrieben, abgefragt wird nur 127.0.0.1.
 *
 *   node scripts/check-gamedig-cluster.js
 */
'use strict';
const cluster = require('cluster');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ABSTURZ = 7;

if (!cluster.isPrimary) {
    process.on('uncaughtException', () => process.exit(ABSTURZ));
    const { GameDig } = require('gamedig');
    (async () => {
        if (process.env.VORAB === 'ja') await GameDig.getInstance().queryRunner.udpSocket._getSocket();
        const frage = () => GameDig.query({
            type: 'valheim', host: '127.0.0.1', port: 9, socketTimeout: 200, attemptTimeout: 300, maxAttempts: 1,
        }).catch(() => {});
        await Promise.all([frage(), frage(), frage()]);
        await new Promise(r => setTimeout(r, 300));
        process.exit(0);
    })();
} else {
    const lauf = (vorab) => new Promise((fertig) => {
        cluster.fork({ VORAB: vorab }).on('exit', fertig);
    });
    (async () => {
        let fehler = 0;
        const pruefe = async (was, tun) => {
            try { await tun(); console.log(`  ✓ ${was}`); }
            catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${e.message}`); }
        };
        await pruefe('Gegenprobe: ohne Vorab-Socket stirbt der Arbeiter', async () => {
            assert.strictEqual(await lauf('nein'), ABSTURZ, 'Der Fehler ist weg: Die Umgehung in QueryService.js kann raus');
        });
        await pruefe('mit Vorab-Socket laufen drei Abfragen zugleich durch', async () => {
            assert.strictEqual(await lauf('ja'), 0);
        });
        await pruefe('der QueryService legt ihn vor jeder Abfrage an', () => {
            const t = fs.readFileSync(path.join(__dirname, '../plugins/gameserver/dashboard/helpers/QueryService.js'), 'utf8');
            assert.match(t, /await udpSocketBereit\(\);\s*const state = await GameDig\.query\(/);
            assert.strictEqual((t.match(/GameDig\.query\(/g) || []).length, 1, 'jede Abfrage braucht den Vorab-Socket');
        });
        console.log(fehler ? `\n❌ ${fehler} Prüfung(en) rot` : '\n✅ Gleichzeitige Abfragen sind sicher');
        process.exit(fehler ? 1 : 0);
    })();
}
