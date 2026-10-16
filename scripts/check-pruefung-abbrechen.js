#!/usr/bin/env node
'use strict';

/**
 * „Prüfdurchlauf abbrechen" hält den Durchlauf auf dem Daemon an — und setzt
 * die Zeile nur dann selbst rot, wenn der Daemon ihn nicht kennt.
 *
 * ## Warum es diesen Wächter gibt
 *
 * Bis 2026-10-16 setzte der Knopf nur die Datenbankzeile auf rot. Der Daemon
 * lief weiter: Icarus #94 installierte nach dem Klick zu Ende, startete das
 * Spiel und wartete seine fünf Minuten ab; #95 scheiterte sofort am belegten
 * Volume („das Spiel laeuft — erst stoppen, dann verwerfen").
 *
 * Geprüft wird an einer Attrappe (Datenbank, IPM), welcher Befehl hinausgeht
 * und wann die Zeile rot wird — und am Daemon-Quelltext, dass es den Befehl
 * dort gibt und er den Kontext des Durchlaufs beendet.
 *
 *   node scripts/check-pruefung-abbrechen.js
 */

const path = require('path');
const fs = require('fs');
const assert = require('assert');

const WURZEL = path.resolve(__dirname, '..');
const DAEMON = path.resolve(WURZEL, '../firebot_daemon');
const { ServiceManager } = require('dunebot-core');
const { ohneKommentare } = require('./lib/quelltext');

// ── Attrappe ──────────────────────────────────────────────────────────────────
let welt;
function neueWelt({ online = true, antwort = { success: true } } = {}) {
    welt = { online, antwort, gesendet: [], updates: [], pruefung: { id: 7, status: 'laeuft' } };
}
const db = {
    async query(sql, p) {
        const q = sql.replace(/\s+/g, ' ').trim();
        if (q.startsWith('SELECT p.id AS pruefId, s.guild_id AS guildId FROM werkbank_pruefungen p JOIN werkbank_sitzungen s')) {
            return welt.pruefung.status === 'laeuft' ? [{ pruefId: welt.pruefung.id, guildId: '1' }] : [];
        }
        if (q === 'SELECT daemon_id FROM rootserver WHERE id = ?') return [{ daemon_id: 'd54' }];
        if (q.startsWith('UPDATE werkbank_pruefungen SET status = ?, ergebnis = ?, beendet_am = NOW() WHERE id = ?')) {
            welt.updates.push({ status: p[0], ergebnis: JSON.parse(p[1]), id: p[2] });
            welt.pruefung.status = p[0];
            return {};
        }
        throw new Error(`Attrappe kennt die Abfrage nicht: ${q.slice(0, 90)}`);
    },
};
ServiceManager.register('dbService', db);
ServiceManager.register('Logger', { info() {}, warn() {}, error() {}, debug() {} });
ServiceManager.register('ipmServer', {
    isDaemonOnline: () => welt.online,
    async sendCommand(daemonId, befehl, nutzlast) {
        welt.gesendet.push({ daemonId, befehl, nutzlast });
        if (welt.antwort instanceof Error) throw welt.antwort;
        return welt.antwort;
    },
});

const S = require('../plugins/werkbank/dashboard/helpers/Sitzungen');
const SITZUNG = { id: 1, kennung: 'wbbc30f87b98', guild_id: '1', rootserver_id: 54 };

let fehler = 0;
async function pruefe(was, tun) {
    try { await tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${e.message}`); }
}

(async () => {
    console.log('\nDashboard');

    await pruefe('Der Daemon führt den Durchlauf: Befehl geht hinaus, die Zeile bleibt auf „läuft" bis zu seinem Urteil', async () => {
        neueWelt();
        const r = await S.pruefungAbbrechen(SITZUNG);
        assert.deepStrictEqual(r, { daemon: true });
        assert.deepStrictEqual(welt.gesendet.map(g => [g.daemonId, g.befehl, g.nutzlast.sitzung_id]),
            [['d54', 'werkbank.pruefung_abbrechen', 'wbbc30f87b98']]);
        assert.strictEqual(welt.updates.length, 0, 'die Zeile wurde rot, bevor der Daemon abgeräumt hat — ein neuer Durchlauf startete ins Aufräumen');
    });

    await pruefe('Der Daemon kennt ihn nicht (Neustart): die Zeile wird hier rot, mit seinem Grund', async () => {
        neueWelt({ antwort: { success: false, error: 'sitzung wbbc30f87b98: dieser Daemon fuehrt keinen Pruefdurchlauf' } });
        const r = await S.pruefungAbbrechen(SITZUNG);
        assert.strictEqual(r.daemon, false);
        assert.strictEqual(welt.updates.length, 1);
        assert.strictEqual(welt.updates[0].status, 'rot');
        assert.match(welt.updates[0].ergebnis.gruende[0], /von Hand abgebrochen.*keinen Pruefdurchlauf/);
    });

    await pruefe('Daemon nicht erreichbar: ebenfalls rot — der Knopf darf nie ins Leere gehen', async () => {
        neueWelt({ online: false });
        const r = await S.pruefungAbbrechen(SITZUNG);
        assert.strictEqual(r.daemon, false);
        assert.match(r.grund, /nicht erreichbar/);
        assert.strictEqual(welt.gesendet.length, 0);
        assert.strictEqual(welt.updates[0].status, 'rot');
    });

    await pruefe('Ein älterer Daemon kennt den Befehl nicht (Fehler beim Senden): rot, kein Absturz', async () => {
        neueWelt({ antwort: new Error('Gameserver nicht gefunden') });
        const r = await S.pruefungAbbrechen(SITZUNG);
        assert.strictEqual(r.daemon, false);
        assert.strictEqual(welt.updates[0].status, 'rot');
    });

    await pruefe('Ohne laufenden Durchlauf: eine Meldung, nichts gesendet', async () => {
        neueWelt();
        welt.pruefung.status = 'rot';
        await assert.rejects(S.pruefungAbbrechen(SITZUNG), /Es läuft kein Prüfdurchlauf/);
        assert.strictEqual(welt.gesendet.length, 0);
    });

    await pruefe('Route und Seite: Umzug nur bei hier gesetztem Rot weiterreichen, kein confirm()', async () => {
        const router = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'plugins/werkbank/dashboard/routes/guild.router.js'), 'utf8'));
        const teil = router.slice(router.indexOf("'/:kennung/pruefung/abbrechen'"), router.indexOf("'/:kennung/einstellungen'"));
        assert.match(teil, /if \(!r\.daemon\) require\('\.\.\/helpers\/Ereignisse'\)\.umzugWeiter/);
        const seite = fs.readFileSync(path.join(WURZEL, 'plugins/werkbank/dashboard/views/guild/werkbank-sitzung.ejs'), 'utf8');
        const knopf = seite.slice(seite.indexOf("knopfPruefAbbrechen.addEventListener"), seite.indexOf('// ── Live-Ausgabe'));
        assert.ok(knopf.length > 50, 'der Knopf wurde nicht gefunden');
        assert.doesNotMatch(knopf, /\bconfirm\(/);
        assert.doesNotMatch(seite, /NICHT angehalten/, 'der alte Hinweis „der Daemon wird NICHT angehalten" steht noch auf der Seite');
    });

    console.log('\nDaemon');

    await pruefe('Den Befehl gibt es, er beendet den Kontext des Durchlaufs, und die Installation hört darauf', async () => {
        const lies = (p) => ohneKommentare(fs.readFileSync(path.join(DAEMON, p), 'utf8'));
        assert.match(lies('internal/websocket/client.go'), /case "werkbank\.pruefung_abbrechen":\s*c\.handleWerkbankPruefungAbbrechen/);
        const pr = lies('internal/gameserver/werkbank_pruefung.go');
        assert.match(pr, /ctx, abbrechen := context\.WithCancel/);
        assert.match(pr, /m\.pruefAktiv\.merkeAbbruch\(sitzung, abbrechen\)/);
        assert.match(pr, /m\.fuehreRezeptAus\(ctx, rezeptLauf\{/, 'die Installation läuft nicht mit dem Kontext des Durchlaufs');
        assert.match(pr, /case <-ctx\.Done\(\):\s*break warten/, 'das Warten auf die Bereitschaft hört nicht auf den Abbruch');
        assert.match(lies('internal/gameserver/docker/schritt.go'), /ctx\.Err\(\) != nil[\s\S]{0,300}ContainerRemove/,
            'ein laufender Schritt-Container würde beim Abbruch nicht entfernt');
    });

    console.log(fehler ? `\n❌ ${fehler} Prüfung(en) fehlgeschlagen` : '\n✅ Abbrechen hält den Durchlauf auf dem Daemon an; rot setzt das Dashboard nur, wenn der Daemon ihn nicht kennt');
    process.exit(fehler ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
