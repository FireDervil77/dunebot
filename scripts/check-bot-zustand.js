#!/usr/bin/env node
/**
 * Bot-Zustand aus der Verbindung (Baustelle 180, 2026-10-29).
 *
 * Vorher: erste Prüfung meist eine Sekunde vor dem Verbinden des Bots →
 * „offline" bis zur nächsten nach 60 s; ein getrennter Bot galt erst nach
 * drei verpassten Prüfungen als weg. Betreiber: „korrekt so machen wir es".
 *
 *   verbinden   `Bot #<n>` verbindet → sofort eine Prüfung → online
 *   trennen     letzter Bot getrennt → sofort offline (ohne Prüfung)
 *   fremd       andere Clients (Prüfskripte mit Zahlennamen) zählen nicht
 *   Anlauf      in den ersten 15 s wartet die Middleware auf den Bot
 *   verdrahtet  IPCServer meldet connect/disconnect, Middleware fragt onlineNachAnlauf
 *
 *   node scripts/check-bot-zustand.js
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const WURZEL = path.join(__dirname, '..');
const { ServiceManager } = require('dunebot-core');
const { ohneKommentare } = require('./lib/quelltext');

let fehler = 0;
async function pruefe(was, tun) {
    try { await tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').slice(0, 3).join('\n      ')}`); }
}
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), 'utf8');
const ruhe = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
    const still = () => {};
    ServiceManager.register('Logger', { debug: still, info: still, warn: still, error: still, success: still });
    let pruefungen = 0;
    let antwortet = true;
    ServiceManager.register('ipcServer', { broadcastOne: async () => {
        pruefungen++;
        if (!antwortet) throw new Error('keine Antwort');
        return { guilds: ['g1'], guildCount: 1, ping: 40 };
    } });
    const BotHealthMonitor = require('../packages/dunebot-sdk/lib/BotHealthMonitor');
    BotHealthMonitor.NACH_VERBINDUNG_MS = 5;

    console.log('\nBot-Zustand (B180)');

    await pruefe('Bot verbindet → sofort geprüft → online', async () => {
        const m = new BotHealthMonitor();
        pruefungen = 0;
        m.verbindungMelden('connect', 'Bot #0');
        await ruhe(30);
        assert.strictEqual(pruefungen, 1, 'keine Prüfung beim Verbinden');
        assert.strictEqual(m.isOnline(), true);
    });

    await pruefe('letzter Bot getrennt → sofort offline; noch einer da → bleibt online', async () => {
        const m = new BotHealthMonitor();
        m.verbindungMelden('connect', 'Bot #0'); await ruhe(30);
        m.verbindungMelden('disconnect', 'Bot #0', 1);
        assert.strictEqual(m.isOnline(), true, 'ein zweiter Shard ist noch da');
        m.verbindungMelden('disconnect', 'Bot #1', 0);
        assert.strictEqual(m.isOnline(), false, 'nach dem letzten Trennen nicht offline');
    });

    await pruefe('fremde Clients zählen nicht', async () => {
        const m = new BotHealthMonitor();
        pruefungen = 0;
        m.verbindungMelden('connect', '544578232704565262-1793270616727'); await ruhe(30);
        assert.strictEqual(pruefungen, 0);
        m.verbindungMelden('connect', 'Bot #0'); await ruhe(30);
        m.verbindungMelden('disconnect', 'ms-544578232704565262-1793270367798', 0);
        assert.strictEqual(m.isOnline(), true, 'ein Prüfskript hat den Bot offline gemeldet');
    });

    await pruefe('Anlauf: wer früh fragt, wartet auf den Bot statt „offline" zu hören', async () => {
        const m = new BotHealthMonitor();
        const beginn = Date.now();
        const antwort = m.onlineNachAnlauf(2000);
        setTimeout(() => m.verbindungMelden('connect', 'Bot #0'), 40);
        assert.strictEqual(await antwort, true);
        assert.ok(Date.now() - beginn < 1000, 'hat bis zum Ende der Frist gewartet statt beim Verbinden weiterzumachen');
    });

    await pruefe('nach dem Anlauf: sofort Nein, ohne zu warten', async () => {
        const m = new BotHealthMonitor();
        m.gestartetAm = Date.now() - 20000;
        const beginn = Date.now();
        assert.strictEqual(await m.onlineNachAnlauf(15000), false);
        assert.ok(Date.now() - beginn < 50);
    });

    await pruefe('Gegenprobe bleibt: steht die Verbindung, antwortet aber nicht → nach 3 Prüfungen offline', async () => {
        const m = new BotHealthMonitor();
        m.verbindungMelden('connect', 'Bot #0'); await ruhe(30);
        antwortet = false;
        for (let i = 0; i < 3; i++) await m.checkBotHealth();
        antwortet = true;
        assert.strictEqual(m.isOnline(), false);
    });

    await pruefe('verdrahtet: IPCServer meldet, Middleware fragt mit Anlauf', async () => {
        const ipc = ohneKommentare(lies('apps/dashboard/helpers/IPCServer.js'));
        assert.match(ipc, /on\("connect", \(client\) => \{[\s\S]*?verbindungMelden\('connect', client\.name\)/);
        assert.match(ipc, /on\("disconnect", \(client\) => \{[\s\S]*?verbindungMelden\('disconnect', client\.name, nochBots\)/);
        const mw = ohneKommentare(lies('apps/dashboard/middlewares/context/guild.middleware.js'));
        assert.match(mw, /if \(!\(await botHealthMonitor\.onlineNachAnlauf\(\)\)\) \{/);
    });

    console.log(fehler ? `\n✗ ${fehler} Prüfung(en) rot` : '\n✅ Bot-Zustand aus der Verbindung, mit Anlauf');
    process.exit(fehler ? 1 : 0);
})();
