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
 * Bestätigung mit.
 *
 * K375 (2026-11-12): Hängt ein Umzugsverlauf an der Maschine
 * (gameserver_migrations, FK RESTRICT), lehnt die Route mit 409 ab — VOR dem
 * Daemon, sonst wäre der Eintrag dort schon weg; das rote Fenster nennt die
 * Sperre und hält Eingabe und Knopf zu (gerendert, nicht am Quelltext gelesen).
 *
 * K374 (2026-11-12): Port-Allocation löschen verlangt die Portnummer, die
 * Sammelaktion die Zahl der Ports; beide löschen nur freie Zeilen dieser
 * Maschine. Auf der Seite steht kein confirm() mehr.
 *
 *   node scripts/check-rootserver-loeschen.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ServiceManager } = require('dunebot-core');
const ejs = require('ejs');
const { ohneKommentareEjs } = require('./lib/quelltext');

const still = () => {};
ServiceManager.register('Logger', { debug: still, info: still, warn: still, error: still, success: still });

const WURZEL = path.join(__dirname, '..');
const MASCHINE = { id: 54, guild_id: 'g1', name: 'DeinServerHost', daemon_id: 'd54' };
const IP = { id: 7, ip_address: '10.0.0.2' };

let gameserverZahl = 0;
let nutzer = 0;
let verlauf = [];
let port = { id: 9, rootserver_id: 54, port: 27015, server_id: null };
let betroffen = 1;
const abfragen = [];
const werte = [];
ServiceManager.register('dbService', {
    async query(sql, w) {
        const s = String(sql);
        abfragen.push(s);
        werte.push(w);
        if (/FROM gameserver_migrations m\s+JOIN gameservers gs ON gs\.id = m\.server_id\s+WHERE m\.source_rootserver_id = \? OR m\.target_rootserver_id = \?/.test(s)) return verlauf;
        if (/SELECT \* FROM port_allocations WHERE id = \? AND rootserver_id = \?/.test(s)) return port ? [port] : [];
        if (/^\s*DELETE FROM port_allocations/.test(s)) return { affectedRows: betroffen };
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
    abfragen.length = 0; werte.length = 0; daemonGefragt = 0;
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

    await pruefe('Umzugsverlauf an der Maschine (K375): 409 mit den Namen, nichts gelöscht, Daemon nicht gefragt', async () => {
        verlauf = [{ id: 217, name: 'Fires Core Keeper Bude', umzuege: 6 }, { id: 233, name: 'Fires Minecraft Bude', umzuege: 1 }];
        const a = await rufe(loeschen, { id: '54' }, { bestaetigung: 'DeinServerHost' });
        assert.strictEqual(a.code, 409, JSON.stringify(a.d));
        assert.match(a.d.message, /Umzugsverlauf von „Fires Core Keeper Bude“, „Fires Minecraft Bude“/);
        assert.match(a.d.message, /bleibt die Maschine gesperrt/);
        assert.strictEqual(geloescht().length, 0);
        assert.strictEqual(daemonGefragt, 0, 'der Daemon darf vor der Sperre nichts erfahren');
        verlauf = [];
        const b = await rufe(loeschen, { id: '54' }, { bestaetigung: 'DeinServerHost' });
        assert.strictEqual(b.code, 200, 'ohne Verlauf geht es weiter');
    });

    console.log('\nPort-Allocation löschen (K374)');
    const portWeg = handle('delete', '/:id/allocations/:allocId');
    const portsWeg = handle('delete', '/:id/allocations-bulk');

    await pruefe('einzeln ohne oder mit falscher Portnummer: 400, nichts gelöscht', async () => {
        for (const body of [undefined, {}, { bestaetigung: '27016' }, { bestaetigung: '2701' }]) {
            const a = await rufe(portWeg, { id: '54', allocId: '9' }, body);
            assert.strictEqual(a.code, 400, JSON.stringify(body));
            assert.match(a.d.message, /Portnummer eintippen/);
        }
        assert.strictEqual(geloescht().length, 0);
    });

    await pruefe('einzeln richtig: löscht nur die freie Zeile dieser Maschine; vergeben → 400, inzwischen vergeben → 409', async () => {
        let a = await rufe(portWeg, { id: '54', allocId: '9' }, { bestaetigung: ' 27015 ' });
        assert.strictEqual(a.code, 200, JSON.stringify(a.d));
        assert.strictEqual(geloescht().length, 1);
        assert.match(geloescht()[0], /DELETE FROM port_allocations WHERE id = \? AND rootserver_id = \? AND server_id IS NULL/);
        port = { ...port, server_id: 221 };
        a = await rufe(portWeg, { id: '54', allocId: '9' }, { bestaetigung: '27015' });
        assert.strictEqual(a.code, 400);
        assert.strictEqual(geloescht().length, 1, 'ein vergebener Port wird nicht angefasst');
        port = { ...port, server_id: null }; betroffen = 0;
        a = await rufe(portWeg, { id: '54', allocId: '9' }, { bestaetigung: '27015' });
        assert.strictEqual(a.code, 409, JSON.stringify(a.d));
        assert.match(a.d.message, /inzwischen vergeben/);
        betroffen = 1;
    });

    await pruefe('Sammelaktion: verlangt die Zahl, löscht genau die Auswahl und nur Freies, meldet Übersprungene', async () => {
        for (const body of [undefined, {}, { ids: [] }, { ids: [1, 2, 3] }, { ids: [1, 2, 3], bestaetigung: '2' },
            { ids: [1, 'x', 3], bestaetigung: '3' }, { ids: [1, 1], bestaetigung: '2' }, { ip: '10.0.0.2', bestaetigung: '1' }]) {
            const a = await rufe(portsWeg, { id: '54' }, body);
            assert.strictEqual(a.code, 400, JSON.stringify(body));
        }
        assert.strictEqual(geloescht().length, 0);
        betroffen = 2;
        const a = await rufe(portsWeg, { id: '54' }, { ids: [1, 2, 3], bestaetigung: '3' });
        assert.strictEqual(a.code, 200, JSON.stringify(a.d));
        assert.strictEqual(geloescht().length, 1);
        assert.match(geloescht()[0], /DELETE FROM port_allocations WHERE rootserver_id = \? AND server_id IS NULL AND id IN \(\?,\?,\?\)/);
        assert.deepStrictEqual(werte[abfragen.indexOf(geloescht()[0])], ['54', 1, 2, 3]);
        assert.match(a.d.message, /2 Allocations gelöscht, 1 übersprungen/);
        betroffen = 1;
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
        for (const id of ['portLoeschenModal', 'portLoeschenSoll', 'portLoeschenEingabe', 'portLoeschenKnopf']) {
            assert.ok(seite.includes(`id="${id}"`), `${id} fehlt`);
        }
        assert.match(seite, /Object\.assign\(\{\}, auftrag\.body, \{ bestaetigung: eingabe\.value\.trim\(\) \}\)/, 'Port: Bestätigung fährt mit');
        assert.doesNotMatch(seite, /\bconfirm\s*\(/, 'kein confirm() mehr auf der Seite');
        assert.doesNotMatch(seite, /confirm:\s*['"`]/, 'die Tabelle fragt nicht mehr über ihr confirm:-Feld');
        assert.doesNotMatch(seite, /confirmDeleteRootserver|confirm\('IP-Adresse entfernen\?'\)|confirm\('RootServer wirklich/);
        assert.doesNotMatch(seite, /alert\('Fehler: ' \+ \(d\.message/);
        assert.match(seite, /onclick="removeIP\(\$\{ip\.id\}, this\)"/);
    });

    await pruefe('gerendert: mit Umzugsverlauf steht die Sperre da, Eingabe und Knopf sind zu; ohne (auch ohne Variable) ist die Eingabe offen', async () => {
        const roh = fs.readFileSync(
            path.join(WURZEL, 'plugins/masterserver/dashboard/views/guild/masterserver-rootserver-detail.ejs'), 'utf8');
        // Vom Kommentar vor dem Fenster bis zum nächsten Fenster schneiden — ganze Klammern.
        const von = roh.indexOf('<%# Sperre (K375)');
        const bis = roh.indexOf('<div class="modal modal-blur fade" id="ipEntfernenModal"');
        assert.ok(von > 0 && bis > von, 'Ausschnitt des Löschfensters nicht gefunden');
        const stueck = roh.slice(von, bis);
        const mit = ejs.render(stueck, { rootserver: MASCHINE,
            umzugsverlauf: [{ id: 217, name: 'Fires <Core> Bude', umzuege: 6 }, { id: 233, name: 'Minecraft', umzuege: 1 }] });
        assert.match(mit, /id="rootserverLoeschenModal" data-gesperrt="1"/);
        assert.match(mit, /id="rootserverLoeschenSperre"/);
        assert.match(mit, /Fires &lt;Core&gt; Bude — 6 Umzüge/);
        assert.match(mit, /Minecraft — 1 Umzug /);
        assert.match(mit, /id="rootserverLoeschenEingabe"[^>]* disabled>/);
        assert.match(mit, /id="rootserverLoeschenKnopf" disabled>/);
        for (const daten of [{ rootserver: MASCHINE, umzugsverlauf: [] }, { rootserver: MASCHINE }]) {
            const ohne = ejs.render(stueck, daten);
            assert.match(ohne, /id="rootserverLoeschenModal" data-gesperrt="0"/);
            assert.doesNotMatch(ohne, /rootserverLoeschenSperre/);
            assert.doesNotMatch(ohne, /id="rootserverLoeschenEingabe"[^>]* disabled/);
            assert.match(ohne, /id="rootserverLoeschenEingabe"/);
        }
        assert.match(ohneKommentareEjs(roh), /knopf\.disabled = gesperrt \|\| eingabe\.value\.trim\(\) !== soll;/);
    });

    console.log(`\n${bestanden} Prüfung(en) bestanden.`);
    process.exit(process.exitCode || 0);
})();
