#!/usr/bin/env node
/**
 * Rootserver löschen und Zusatz-IP entfernen fragen rot nach (K348, 2026-11-12).
 *
 * Bis dahin fragten beide mit confirm() (Regel „Name eintippen statt
 * confirm()", Vorlage #paketEntfernenModal). Dazu stand in der IP-Route nur
 * der Kommentar „prüfen, ob ein Gameserver sie nutzt" — geprüft wurde nichts.
 *
 * Geprüft: Beide Routen verlangen den eingetippten Namen bzw. die Adresse
 * noch einmal (ohne ihn löschen sie nichts und fragen den Daemon nicht); die
 * IP-Route lehnt ab, solange ein Gameserver an der Adresse lauscht
 * (gameservers.bind_ip); die Ansicht öffnet die roten Fenster und schickt die
 * Bestätigung mit. Der dritte confirm() der Seite (Port-Allocation) bleibt
 * bewusst — nicht Teil von K348.
 *
 *   node scripts/check-rootserver-loeschen.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ServiceManager } = require('dunebot-core');
const { ohneKommentareEjs } = require('./lib/quelltext');

const still = () => {};
ServiceManager.register('Logger', { debug: still, info: still, warn: still, error: still, success: still });

const WURZEL = path.join(__dirname, '..');
const MASCHINE = { id: 54, guild_id: 'g1', name: 'DeinServerHost', daemon_id: 'd54' };
const IP = { id: 7, ip_address: '10.0.0.2' };

let gameserverZahl = 0;
let nutzer = 0;
const abfragen = [];
ServiceManager.register('dbService', {
    async query(sql) {
        const s = String(sql);
        abfragen.push(s);
        if (/COUNT\(\*\) as count FROM gameservers/.test(s)) return [{ count: gameserverZahl }];
        if (/FROM rootserver_ips WHERE id = \? AND rootserver_id = \?/.test(s)) return [IP];
        if (/COUNT\(\*\) AS n FROM gameservers WHERE rootserver_id = \? AND bind_ip = \?/.test(s)) return [{ n: nutzer }];
        return [];
    },
});
let daemonGefragt = 0;
ServiceManager.register('ipmServer', {
    isDaemonOnline: () => true,
    sendCommand: async () => { daemonGefragt++; return { success: true }; },
});

const RootServer = require(path.join(WURZEL, 'plugins/masterserver/dashboard/models/RootServer.js'));
RootServer.getById = async () => ({ ...MASCHINE });
const router = require(path.join(WURZEL, 'plugins/masterserver/dashboard/routes/rootserver.router.js'));
const handle = (methode, pfad) => router.stack
    .find(l => l.route && l.route.path === pfad && l.route.methods[methode]).route.stack.at(-1).handle;
const rufe = (h, params, body) => new Promise((fertig) => {
    const res = {
        locals: { guildId: 'g1' },
        status(c) { this.code = c; return this; },
        json(d) { fertig({ code: this.code || 200, d }); },
    };
    h({ params, body }, res);
});
const geloescht = () => abfragen.filter(s => /^DELETE FROM/.test(s.trim()));

let bestanden = 0;
async function pruefe(name, fn) {
    abfragen.length = 0; daemonGefragt = 0;
    try { await fn(); console.log(`  ✓ ${name}`); bestanden++; }
    catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

(async () => {
    console.log('\nRootserver löschen');
    const loeschen = handle('delete', '/:id');

    await pruefe('ohne oder mit falschem Namen: 400, nichts gelöscht, Daemon nicht gefragt', async () => {
        for (const body of [undefined, {}, { bestaetigung: 'deinserverhost' }, { bestaetigung: 'DeinServerHost ' + 'x' }]) {
            const a = await rufe(loeschen, { id: '54' }, body);
            assert.strictEqual(a.code, 400, JSON.stringify(body));
            assert.match(a.d.message, /Namen .*eintippen/);
        }
        assert.strictEqual(geloescht().length, 0);
        assert.strictEqual(daemonGefragt, 0);
    });

    await pruefe('mit richtigem Namen: Gameserver-Sperre greift weiter; ohne Gameserver wird gelöscht', async () => {
        gameserverZahl = 2;
        let a = await rufe(loeschen, { id: '54' }, { bestaetigung: 'DeinServerHost' });
        assert.strictEqual(a.code, 400);
        assert.match(a.d.message, /2 Gameserver/);
        assert.strictEqual(geloescht().length, 0);
        gameserverZahl = 0;
        a = await rufe(loeschen, { id: '54' }, { bestaetigung: ' DeinServerHost ' });
        assert.strictEqual(a.code, 200, JSON.stringify(a.d));
        assert.strictEqual(geloescht().length, 1);
        assert.match(geloescht()[0], /DELETE FROM rootserver WHERE id = \? AND guild_id = \?/);
        assert.strictEqual(daemonGefragt, 1, 'virtual.delete an den Daemon');
    });

    console.log('\nZusatz-IP entfernen');
    const entfernen = handle('delete', '/:id/ips/:ipId');

    await pruefe('ohne oder mit falscher Adresse: 400, nichts gelöscht, Nutzung nicht erst gezählt', async () => {
        for (const body of [undefined, {}, { bestaetigung: '10.0.0.3' }]) {
            const a = await rufe(entfernen, { id: '54', ipId: '7' }, body);
            assert.strictEqual(a.code, 400, JSON.stringify(body));
            assert.match(a.d.message, /Adresse eintippen/);
        }
        assert.strictEqual(geloescht().length, 0);
    });

    await pruefe('Adresse in Gebrauch (bind_ip): 409 mit Zahl, nichts gelöscht', async () => {
        nutzer = 2;
        const a = await rufe(entfernen, { id: '54', ipId: '7' }, { bestaetigung: '10.0.0.2' });
        assert.strictEqual(a.code, 409, JSON.stringify(a.d));
        assert.match(a.d.message, /2 Gameserver lauschen an 10\.0\.0\.2/);
        assert.strictEqual(geloescht().length, 0);
    });

    await pruefe('frei und richtig eingetippt: gelöscht, die Antwort nennt die Adresse', async () => {
        nutzer = 0;
        const a = await rufe(entfernen, { id: '54', ipId: '7' }, { bestaetigung: '10.0.0.2' });
        assert.strictEqual(a.code, 200, JSON.stringify(a.d));
        assert.strictEqual(geloescht().length, 1);
        assert.match(geloescht()[0], /DELETE FROM rootserver_ips WHERE id = \?/);
        assert.match(a.d.message, /10\.0\.0\.2 entfernt/);
    });

    console.log('\nAnsicht');
    await pruefe('rote Fenster mit Name/Adresse eintippen, Bestätigung fährt mit, kein confirm() mehr an beiden Stellen', async () => {
        const seite = ohneKommentareEjs(fs.readFileSync(
            path.join(WURZEL, 'plugins/masterserver/dashboard/views/guild/masterserver-rootserver-detail.ejs'), 'utf8'));
        for (const id of ['rootserverLoeschenModal', 'rootserverLoeschenSoll', 'rootserverLoeschenEingabe', 'rootserverLoeschenKnopf',
            'ipEntfernenModal', 'ipEntfernenSoll', 'ipEntfernenEingabe', 'ipEntfernenKnopf']) {
            assert.ok(seite.includes(`id="${id}"`), `${id} fehlt`);
        }
        assert.strictEqual((seite.match(/Das lässt sich nicht zurücknehmen\./g) || []).length, 2);
        assert.strictEqual((seite.match(/body: JSON\.stringify\(\{ bestaetigung: eingabe\.value\.trim\(\) \}\)/g) || []).length, 3, 'Token, Löschen, IP');
        assert.doesNotMatch(seite, /confirmDeleteRootserver|confirm\('IP-Adresse entfernen\?'\)|confirm\('RootServer wirklich/);
        assert.doesNotMatch(seite, /alert\('Fehler: ' \+ \(d\.message/);
        assert.match(seite, /onclick="removeIP\(\$\{ip\.id\}, this\)"/);
    });

    console.log(`\n${bestanden} Prüfung(en) bestanden.`);
    process.exit(process.exitCode || 0);
})();
