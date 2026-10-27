#!/usr/bin/env node
/**
 * Datenbanken für Gameserver, Stufe 11 S1 (2026-10-27).
 *
 * Betreiber: „nichts ehrlich schreiben, sondern ehrlich bauen." Beide
 * Rootserver zeigten „Datenbanken: möglich" — gemessen war die MySQL der
 * Maschine, die nur auf 127.0.0.1 lauscht und die kein Spiel erreicht.
 * Jetzt: ein Container fb-datenbank je Rootserver, vom Daemon nach dem
 * Häkchen am Rootserver geschaltet; „möglich" heißt, er läuft.
 *
 * ── Was hier geprüft wird ───────────────────────────────────────────────────
 *
 *   Regel      leiteDatenbankAb: Wunsch gegen den Zustand des Containers
 *   Befund     uebernimmDatenbank ist der EINE Schreiber von db_moeglich;
 *              der Maschinenbefund (Host-MySQL) schreibt es nicht mehr
 *   Anmeldung  Zustand aus der Anmeldung — VOR dem Maschinenbefund — und
 *              aus dem Ereignis datenbank.befund
 *   Formular   Bearbeiten nimmt Häkchen und Anzahl an, prüft die Grenze,
 *              schickt datenbank.anwenden nur bei geändertem Häkchen
 *
 *   node scripts/check-datenbank-container.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { ServiceManager } = require('dunebot-core');
const { ohneKommentare } = require('./lib/quelltext');

const WURZEL = path.join(__dirname, '..');
const still = () => {};
ServiceManager.register('Logger', { debug: still, info: still, warn: still, error: still, success: still });

const spur = { abfragen: [], zeile: { db_gewuenscht: 1 }, befehle: [], online: false, befehlFehler: null };
ServiceManager.register('dbService', {
    query: async (sql, w) => {
        const t = sql.trim();
        spur.abfragen.push([t, w]);
        if (/^SELECT db_gewuenscht FROM rootserver WHERE daemon_id = \?$/.test(t)) return spur.zeile ? [spur.zeile] : [];
        if (/^UPDATE rootserver SET db_moeglich = \?, db_grund = \? WHERE daemon_id = \?$/.test(t)) return {};
        if (/^UPDATE rootserver SET db_moeglich = 0, db_grund = \? WHERE id = \?$/.test(t)) return {};
        if (/^UPDATE rootserver SET sftp_port = \?, sftp_moeglich = \?, sftp_grund = \? WHERE daemon_id = \?$/.test(t)) return {};
        if (/^SELECT sftp_gewuenscht FROM rootserver WHERE daemon_id = \?$/.test(t)) return [{ sftp_gewuenscht: 0 }];
        throw new Error('Attrappe kennt die Abfrage nicht: ' + t.slice(0, 80));
    },
});
ServiceManager.register('ipmServer', {
    isDaemonOnline: () => spur.online,
    async sendCommand(daemonId, befehl, nutzlast) {
        spur.befehle.push([daemonId, befehl, nutzlast]);
        if (spur.befehlFehler) throw new Error(spur.befehlFehler);
        if (befehl === 'sftp.anwenden') return { success: true, data: { sftp_port: 0, sftp_grund: 'abgeschaltet (am Rootserver nicht gewünscht)' } };
        return { success: true, data: { angenommen: true } };
    },
});

const M = require(path.join(WURZEL, 'plugins/masterserver/dashboard/helpers/Maschinenbefund.js'));
const RootServer = require(path.join(WURZEL, 'plugins/masterserver/dashboard/models/RootServer.js'));

let fehler = 0, bestanden = 0;
async function pruefe(was, tun) {
    spur.abfragen = []; spur.befehle = []; spur.online = false; spur.befehlFehler = null;
    try { await tun(); bestanden++; console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').slice(0, 4).join('\n      ')}`); }
}

(async () => {
    console.log('\nRegel und Befund');

    await pruefe('leiteDatenbankAb: möglich nur mit Wunsch UND laufendem Container — sonst ein Satz, was fehlt', () => {
        const laeuft = { laeuft: true, fassung: '11.4.13-MariaDB-ubu2404', adresse: 'fb-datenbank:3306' };
        assert.deepStrictEqual(M.leiteDatenbankAb(true, laeuft),
            { moeglich: 1, grund: 'Container fb-datenbank läuft (MariaDB 11.4.13), Spiele erreichen ihn als fb-datenbank:3306.' });
        assert.deepStrictEqual(M.leiteDatenbankAb(false, laeuft), { moeglich: 0, grund: 'Nicht angefordert.' });
        assert.match(M.leiteDatenbankAb(true, null).grund, /kennt den Datenbank-Container aber noch nicht \(ab Daemon 1\.0\.140\)/);
        for (const g of ['nicht eingerichtet', 'gestoppt', 'abgeschaltet (am Rootserver nicht gewünscht)']) {
            assert.match(M.leiteDatenbankAb(true, { laeuft: false, grund: g }).grund, /richtet den Container fb-datenbank gerade ein/, g);
        }
        const kaputt = M.leiteDatenbankAb(true, { laeuft: false, grund: 'Image registry.firenetworks.de/fb/mariadb:latest: unauthorized' });
        assert.strictEqual(kaputt.moeglich, 0);
        assert.match(kaputt.grund, /läuft aber nicht: Image .*unauthorized/);
    });

    await pruefe('uebernimmDatenbank schreibt möglich und Grund — auch ohne Zustand (alter Daemon)', async () => {
        await RootServer.uebernimmDatenbank('d1', { laeuft: true, fassung: '11.4.13', adresse: 'fb-datenbank:3306' });
        assert.deepStrictEqual(spur.abfragen[1][1].slice(0, 1), [1]);
        assert.strictEqual(spur.abfragen[1][1][2], 'd1');
        spur.abfragen = [];
        await RootServer.uebernimmDatenbank('d1', null);
        assert.strictEqual(spur.abfragen[1][1][0], 0);
        spur.zeile = null; spur.abfragen = [];
        assert.strictEqual(await RootServer.uebernimmDatenbank('unbekannt', null), null);
        assert.strictEqual(spur.abfragen.length, 1, 'ohne Zeile wird nichts geschrieben');
        spur.zeile = { db_gewuenscht: 1 };
    });

    await pruefe('db_moeglich hat genau einen Schreiber je Weg — der Maschinenbefund ist keiner mehr', () => {
        const modell = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'plugins/masterserver/dashboard/models/RootServer.js'), 'utf8'));
        const mb = modell.slice(modell.indexOf('static async uebernimmMaschinenbefund'));
        const ende = mb.indexOf('\n    static async ', 10);
        assert.ok(!/db_moeglich|db_grund|leiteDatenbankAb/.test(mb.slice(0, ende)), 'uebernimmMaschinenbefund schreibt noch Datenbanken');
        const schreiber = (modell.match(/db_moeglich = \?/g) || []).length;
        assert.strictEqual(schreiber, 1, `${schreiber} Schreiber im Modell`);
    });

    console.log('\nAnmeldung');

    await pruefe('Zustand aus der Anmeldung VOR dem Maschinenbefund, dazu das Ereignis datenbank.befund', () => {
        const ipm = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'apps/dashboard/helpers/IPMServer.js'), 'utf8'));
        const a = ipm.indexOf('RootServer.uebernimmDatenbank(daemonId, message.payload.datenbank || null)');
        const b = ipm.indexOf('RootServer.uebernimmMaschinenbefund(');
        assert.ok(a > 0, 'die Anmeldung übernimmt den Zustand nicht');
        assert.ok(a < b, 'der ältere Stand aus der Anmeldung könnte das Ereignis überschreiben');
        assert.ok(/eventRouter\.register\('datenbank', 'befund'[\s\S]{0,200}uebernimmDatenbank\(context\.daemonId, payload\?\.datenbank \|\| null\)/.test(ipm),
            'das Ereignis wird nicht übernommen');
        assert.ok(/datenbanken:\s*!!zeile\.db_gewuenscht/.test(ipm), 'die Absicht nennt datenbanken nicht');
    });

    console.log('\nFormular');

    const router = require(path.join(WURZEL, 'plugins/masterserver/dashboard/routes/rootserver.router.js'));
    const handle = (methode, pfad) => router.stack.find(l => l.route?.path === pfad && l.route.methods[methode]).route.stack.at(-1).handle;
    async function bearbeite(vorher, body) {
        const echt = { getById: RootServer.getById, update: RootServer.update };
        const gesehen = [];
        RootServer.getById = async () => ({ id: 54, guild_id: 'g1', daemon_id: 'd54', ...vorher });
        RootServer.update = async (id, daten) => { gesehen.push(daten); Object.assign(vorher, daten); };
        let antwort = {};
        const res = { locals: { guildId: 'g1' }, status(c) { antwort.c = c; return this; }, json(o) { Object.assign(antwort, o); return this; } };
        try { await handle('put', '/:id')({ params: { id: '54' }, body: { name: 'x', ...body } }, res); }
        finally { Object.assign(RootServer, echt); }
        return { antwort, gesehen };
    }

    await pruefe('Häkchen an mit 0 je Server ist ein 400; mehr als 20 auch', async () => {
        let r = await bearbeite({ db_gewuenscht: 0, db_je_server: 0 }, { db_gewuenscht: 'true', db_je_server: '0' });
        assert.strictEqual(r.antwort.c, 400); assert.match(r.antwort.message, /mindestens eine/);
        r = await bearbeite({ db_gewuenscht: 0, db_je_server: 0 }, { db_gewuenscht: 'true', db_je_server: '25' });
        assert.strictEqual(r.antwort.c, 400); assert.match(r.antwort.message, /0 bis 20/);
        assert.strictEqual(r.gesehen.length, 0, 'trotz Fehler gespeichert');
    });

    await pruefe('Einschalten bei verbundenem Daemon: gespeichert, datenbank.anwenden {an:true}, Grund „wird eingerichtet"', async () => {
        spur.online = true;
        const r = await bearbeite({ db_gewuenscht: 0, db_je_server: 0 }, { db_gewuenscht: 'true', db_je_server: '2' });
        assert.strictEqual(r.gesehen[0].db_gewuenscht, 1);
        assert.strictEqual(r.gesehen[0].db_je_server, 2);
        assert.deepStrictEqual(spur.befehle.filter(b => b[1] === 'datenbank.anwenden'), [['d54', 'datenbank.anwenden', { an: true }]]);
        const grund = spur.abfragen.find(a => /db_moeglich = 0, db_grund/.test(a[0]));
        assert.match(grund[1][0], /richtet den Container fb-datenbank gerade ein/);
        assert.match(r.antwort.message, /Datenbanken: der Daemon richtet den Container ein/);
    });

    await pruefe('unverändertes Häkchen schickt nichts; Anzahl allein wird trotzdem gespeichert', async () => {
        spur.online = true;
        const r = await bearbeite({ db_gewuenscht: 1, db_je_server: 1 }, { db_gewuenscht: 'true', db_je_server: '3' });
        assert.strictEqual(r.gesehen[0].db_je_server, 3);
        assert.strictEqual(spur.befehle.filter(b => b[1] === 'datenbank.anwenden').length, 0);
    });

    await pruefe('Ausschalten ohne Verbindung: „Nicht angefordert", die Antwort sagt, wann es gilt', async () => {
        const r = await bearbeite({ db_gewuenscht: 1, db_je_server: 1 }, { db_gewuenscht: 'false', db_je_server: '1' });
        assert.strictEqual(r.gesehen[0].db_gewuenscht, 0);
        assert.strictEqual(spur.befehle.length, 0);
        assert.strictEqual(spur.abfragen.find(a => /db_moeglich = 0, db_grund/.test(a[0]))[1][0], 'Nicht angefordert.');
        assert.match(r.antwort.message, /Datenbanken: gilt, sobald der Daemon sich wieder anmeldet/);
    });

    await pruefe('alter Daemon kennt den Befehl nicht: steht so am Rootserver', async () => {
        spur.online = true; spur.befehlFehler = 'Unbekannte Aktion: datenbank.anwenden';
        const r = await bearbeite({ db_gewuenscht: 0, db_je_server: 0 }, { db_gewuenscht: 'true', db_je_server: '1' });
        assert.match(spur.abfragen.find(a => /db_moeglich = 0, db_grund/.test(a[0]))[1][0], /noch nicht angewendet: Unbekannte Aktion/);
        assert.match(r.antwort.message, /noch nicht angewendet/);
    });

    await pruefe('ein Formular ohne die Felder lässt alles, wie es ist', async () => {
        const r = await bearbeite({ db_gewuenscht: 1, db_je_server: 2 }, {});
        assert.strictEqual(r.gesehen[0].db_gewuenscht, undefined);
        assert.strictEqual(r.gesehen[0].db_je_server, undefined);
    });

    await pruefe('Bearbeiten-Formular: verstecktes „false" vor dem Kästchen, Anzahl daneben; Anlegen sagt Container', () => {
        const detail = fs.readFileSync(path.join(WURZEL, 'plugins/masterserver/dashboard/views/guild/masterserver-rootserver-detail.ejs'), 'utf8');
        const v = detail.indexOf('name="db_gewuenscht" value="false"'), k = detail.indexOf('id="editDb" name="db_gewuenscht" value="true"');
        assert.ok(v > 0 && k > v, 'das versteckte „false" muss VOR dem Kästchen stehen');
        assert.ok(detail.includes('name="db_je_server"'), 'die Anzahl fehlt');
        const anlegen = fs.readFileSync(path.join(WURZEL, 'plugins/masterserver/dashboard/views/guild/masterserver-rootserver-create.ejs'), 'utf8');
        assert.ok(/MariaDB-Container/.test(anlegen) && !/rührt der Daemon MySQL/.test(anlegen), 'der Hilfetext beim Anlegen spricht noch von der Host-MySQL');
    });

    console.log(fehler ? `\n✗ ${fehler} gescheitert, ${bestanden} bestanden` : `\n✓ ${bestanden} bestanden`);
    process.exit(fehler ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
