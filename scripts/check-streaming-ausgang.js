#!/usr/bin/env node
/**
 * Prueft, dass ein haengender Bot-Aufruf den Ausgang **nicht mehr anhaelt**.
 *
 * Der Anlass ist Baustelle 76. In der Nacht zum 2026-08-26 arbeitete der
 * Ausgang genau **einen** Auftrag alle 20 Minuten ab. Nicht weil er langsam
 * war, sondern weil drei richtige Einzelentscheidungen zusammen falsch
 * wurden:
 *
 *   - der IPC-Aufruf hatte keine Frist (veza: `timeout = -1`),
 *   - `laeuftGerade` reihte alle Auftraege hintereinander,
 *   - je Kanal einer je Lauf - richtig bei 500 ms Takt, toedlich hinter einem
 *     Stillstand.
 *
 * Ergebnis: `zustand = fertig`, `versuche = 0`, drei Stunden Verzug, keine
 * Spur. Das Skript stellt genau diese Lage nach.
 *
 * Es **liest nicht, es benutzt**: echtes veza ueber eine echte Verbindung auf
 * localhost, der echte `IPCServer`, die echten Funktionen des Ausgangs.
 * Datenbank und Bot sind Attrappen - sie sind nicht das, was geprueft wird.
 *
 *   node scripts/check-streaming-ausgang.js
 *
 * Exitcode 1 bei jeder Abweichung.
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../apps/dashboard/.env'), quiet: true });

const veza = require('veza');
const { ServiceManager } = require('dunebot-core');

let faelle = 0;
let abweichungen = 0;

/**
 * @param {boolean} gut Bedingung
 * @param {string} text Beschreibung
 * @param {string} [zusatz] Ergaenzung
 * @returns {void}
 */
function pruefe(gut, text, zusatz = '') {
    faelle++;
    if (!gut) abweichungen++;
    console.log(`  ${gut ? '✓' : '✗'} ${text}${zusatz ? '  — ' + zusatz : ''}`);
}

/** @returns {Promise<void>} */
const kurz = (ms) => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Attrappen: Datenbank und Protokoll. Beides ist Umgebung, nicht Pruefgegenstand.
// ---------------------------------------------------------------------------

const protokoll = [];
ServiceManager.register('Logger', {
    info: () => {}, debug: () => {}, success: () => {},
    warn: (...a) => protokoll.push(a.map(String).join(' ')),
    error: (...a) => protokoll.push(a.map(String).join(' '))
});

/** Auftraege und Ziele im Speicher, mit Mitschrift der Schreibzugriffe. */
const daten = { auftraege: [], kanaele: new Map(), melderKanaele: new Map(), geschrieben: [] };

ServiceManager.register('dbService', {
    async query(sql, werte = []) {
        const s = String(sql).replace(/\s+/g, ' ').trim();

        if (s.startsWith('SELECT * FROM streaming_outbox')) {
            return daten.auftraege.filter(a => a.zustand === 'offen');
        }
        // Seit 12c holt `auswaehlen` **zwei** Kanaele: den Ankuendigungs- und
        // den Meldekanal. Die Attrappe hing vorher am alten SELECT und lieferte
        // danach eine leere Liste — die Kanalgrenze schien dann zu greifen,
        // obwohl sie gar keinen Kanal mehr kannte. Ein Waechter, der beim
        // Aendern der Abfrage lautlos blind wird, ist keiner.
        if (s.startsWith('SELECT channel_id, melder_channel_id FROM streaming_targets')) {
            const kanal = daten.kanaele.get(werte[0]);
            return kanal ? [{ channel_id: kanal, melder_channel_id: daten.melderKanaele.get(werte[0]) || null }] : [];
        }
        if (s.startsWith('UPDATE streaming_outbox')) {
            daten.geschrieben.push({ sql: s, werte });
            const id = werte[werte.length - 1];
            const zeile = daten.auftraege.find(a => a.id === id);
            if (zeile) {
                if (s.includes("zustand = 'fertig'")) { zeile.zustand = 'fertig'; zeile.hinweis = werte[0]; }
                else if (s.includes('SET versuche = ?')) { zeile.versuche = werte[0]; zeile.fehlertext = werte[1]; zeile.zustand = werte[2]; }
                else if (s.includes('versuche = versuche + 1')) { zeile.versuche += 1; zeile.fehlertext = werte[0]; }
            }
            return [];
        }

        // **Die Buchfuehrung der Rollen.** Sie wird hier mitgeschrieben und
        // nicht geprueft — dafuer gibt es `check-streaming-liverolle.js` und
        // `check-streaming-abonnenten.js`. Sie muss trotzdem stehen, sonst
        // faellt sie unten als "unbekannte Abfrage" auf, und die Warnung
        // verloere ihren Wert: Ein Waechter, der immer etwas meldet, wird
        // weggeklickt.
        if (s.startsWith('INSERT INTO streaming_role_grants')
            || s.startsWith('DELETE FROM streaming_role_grants')) {
            daten.geschrieben.push({ sql: s, werte });
            return [];
        }

        // Eine Abfrage, die hier vorbeilaeuft, ist ein Befund. Genau so ist
        // dieser Waechter am 2026-08-27 blind geworden.
        if (/^(SELECT|INSERT|UPDATE|DELETE)/i.test(s)) unbekannteAbfragen.push(s.slice(0, 90));
        return [];
    }
});

const unbekannteAbfragen = [];

const drossel = require('../plugins/streaming/dashboard/ausgabe/drossel');

(async () => {
    // -----------------------------------------------------------------------
    console.log('\nveza haelt die Frist — an einer echten Verbindung');
    // -----------------------------------------------------------------------

    const port = 41500 + (process.pid % 500);
    const server = new veza.Server('Pruefserver');

    // Der Handler antwortet absichtlich NIE. Genau das war die Lage.
    server.on('message', () => { /* Stille */ });
    await server.listen(port);

    const klient = new veza.Client('Pruefklient');
    const socket = await klient.connectTo(port);
    await kurz(50);
    const zumBot = [...server.sockets.values()][0];

    let abgelaufen = null;
    const t0 = Date.now();
    await zumBot.send({ event: 'nie:antwort' }, { receptive: true, timeout: 200 })
        .then(() => { abgelaufen = false; })
        .catch((e) => { abgelaufen = e.message; });
    const gedauert = Date.now() - t0;

    pruefe(abgelaufen === 'Timed out.', 'eine gesetzte Frist bricht das Warten ab', String(abgelaufen));
    pruefe(gedauert >= 200 && gedauert < 1500, 'und zwar genau dann', `${gedauert} ms`);

    // Die Gegenprobe ist der eigentliche Befund: OHNE Frist kommt nichts
    // zurueck. Das ist die Vorgabe, mit der wir drei Stunden verloren haben.
    let ohneFrist = 'wartet noch';
    zumBot.send({ event: 'nie:antwort' }, { receptive: true })
        .then(() => { ohneFrist = 'kam zurueck'; })
        .catch(() => { ohneFrist = 'brach ab'; });
    await kurz(600);
    pruefe(ohneFrist === 'wartet noch', 'ohne Frist wartet veza unbegrenzt',
        'die Vorgabe `timeout = -1` — der Kern von Baustelle 76');

    socket.disconnect();
    await server.close();

    // -----------------------------------------------------------------------
    console.log('\nDer Ausgang gibt seine Frist mit');
    // -----------------------------------------------------------------------

    const IPCServer = require('../apps/dashboard/helpers/IPCServer');
    const ipc = new IPCServer();
    let mitgegeben = null;
    ipc.getSockets = () => [['Bot #0', {
        send: async (_daten, optionen) => { mitgegeben = optionen; return { success: true, data: {} }; }
    }]];
    ServiceManager.register('ipcServer', ipc);

    await drossel.ausfuehren({
        id: 1, aktion: 'rolle_geben', guild_id: '1', target_id: 1, versuche: 0,
        nutzlast: JSON.stringify({ mitglied_id: '9', rolle_id: '8' })
    });

    pruefe(mitgegeben?.timeout === drossel.BOT_FRIST_MS,
        'der Aufruf traegt eine Frist', `${mitgegeben?.timeout} ms`);
    pruefe(drossel.BOT_FRIST_MS > 0 && drossel.BOT_FRIST_MS <= 120_000,
        'und sie ist eine Zahl, kein "unbegrenzt"', `${drossel.BOT_FRIST_MS} ms`);

    // -----------------------------------------------------------------------
    console.log('\nAuswahl je Lauf');
    // -----------------------------------------------------------------------

    daten.kanaele = new Map([[1, 'kanalA'], [2, 'kanalA'], [3, 'kanalB']]);
    const auswahl = await drossel.auswaehlen([
        { id: 1, aktion: 'bearbeiten',   target_id: 1, faellig_ab: new Date(), versuche: 0 },
        { id: 2, aktion: 'bearbeiten',   target_id: 2, faellig_ab: new Date(), versuche: 0 },
        { id: 3, aktion: 'bearbeiten',   target_id: 3, faellig_ab: new Date(), versuche: 0 },
        { id: 4, aktion: 'rolle_nehmen', target_id: 1, faellig_ab: new Date(), versuche: 0 }
    ]);
    const ids = auswahl.map(a => a.id);

    pruefe(ids.includes(1) && !ids.includes(2),
        'je Kanal kommt einer dran', 'haelt 5 Nachrichten je 5 s ohne Nachzaehlen');
    pruefe(ids.includes(3), 'ein anderer Kanal wird nicht mitgesperrt');
    pruefe(ids.includes(4), 'ein Rollenauftrag steht nicht hinter der Ankuendigung an',
        'er fasst keinen Kanal an — und beim Streamende ist er der eilige');

    // -----------------------------------------------------------------------
    console.log('\nDer Fall aus Baustelle 76: ein Kanal haengt');
    // -----------------------------------------------------------------------

    daten.auftraege = [
        { id: 10, aktion: 'rolle_geben', guild_id: '1', target_id: 1, versuche: 0, zustand: 'offen',
          faellig_ab: new Date(), nutzlast: JSON.stringify({ mitglied_id: '9', rolle_id: '8' }) },
        { id: 11, aktion: 'rolle_geben', guild_id: '1', target_id: 3, versuche: 0, zustand: 'offen',
          faellig_ab: new Date(), nutzlast: JSON.stringify({ mitglied_id: '7', rolle_id: '6' }) }
    ];

    // Auftrag 10 haengt, Auftrag 11 nicht. Vor dem Umbau haette 11 auf 10
    // gewartet — 20 Minuten lang.
    let elfFertigNach = null;
    const beginn = Date.now();
    ipc.getSockets = () => [['Bot #0', {
        send: async (nutzlast) => {
            if (nutzlast.payload?.userId === '9') { await kurz(3000); return { success: true, data: {} }; }
            return { success: true, data: {} };
        }
    }]];

    const laeuft = drossel.lauf();
    // Kurz warten und nachsehen, ob der schnelle schon durch ist, WAEHREND
    // der langsame noch haengt. Das ist der ganze Unterschied.
    await kurz(400);
    const elf = daten.auftraege.find(a => a.id === 11);
    const zehn = daten.auftraege.find(a => a.id === 10);
    elfFertigNach = Date.now() - beginn;

    pruefe(elf.zustand === 'fertig',
        'der freie Kanal ist durch, waehrend der andere noch haengt',
        `nach ${elfFertigNach} ms`);
    pruefe(zehn.zustand === 'offen', 'und der haengende haengt tatsaechlich noch',
        'sonst prueft der Fall oben nichts');

    await laeuft;
    pruefe(daten.auftraege.find(a => a.id === 10).zustand === 'fertig',
        'am Ende ist auch der langsame fertig');

    // -----------------------------------------------------------------------
    console.log('\nEine ueberschrittene Frist ist ein Fehlversuch, kein Stillstand');
    // -----------------------------------------------------------------------

    daten.auftraege = [
        { id: 20, aktion: 'rolle_geben', guild_id: '1', target_id: 1, versuche: 0, zustand: 'offen',
          faellig_ab: new Date(), nutzlast: JSON.stringify({ mitglied_id: '5', rolle_id: '4' }) }
    ];
    ipc.getSockets = () => [['Bot #0', {
        // Wie veza es tut: Frist ueberschritten -> Ablehnung.
        send: async (_d, optionen) => {
            await kurz(Math.min(optionen.timeout, 150));
            throw new Error('Timed out.');
        }
    }]];

    await drossel.lauf();
    const zwanzig = daten.auftraege.find(a => a.id === 20);

    pruefe(zwanzig.versuche === 1, 'der Versuch wird gezaehlt', `versuche = ${zwanzig.versuche}`);
    pruefe(zwanzig.zustand === 'offen', 'und der Auftrag bleibt offen fuer den naechsten Anlauf');
    pruefe(String(zwanzig.fehlertext).includes('Timed out'),
        'der Grund steht in der Zeile',
        'vorher stand dort nichts und der Auftrag galt als sauber erledigt');
    pruefe(protokoll.some(z => z.includes('#20') || z.includes('Auftrag 20')),
        'und im Protokoll steht es auch');

    console.log('\nHat die Attrappe alles verstanden?');
    pruefe(unbekannteAbfragen.length === 0,
        'keine Abfrage lief an der Attrappe vorbei',
        unbekannteAbfragen.length ? [...new Set(unbekannteAbfragen)].join(' | ') : 'alle erkannt');

    console.log(`\nErgebnis: ${faelle} Pruefungen, ${abweichungen} Abweichung(en).\n`);
    process.exit(abweichungen ? 1 : 0);
})().catch((err) => {
    console.error('\nFEHLER:', err);
    process.exit(1);
});
