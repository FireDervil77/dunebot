#!/usr/bin/env node
/**
 * Prueft die **Abonnenten-Rollen** (Stufe 12b).
 *
 * Der staerkste Einzelpunkt des Vorhabens — und der mit den meisten stillen
 * Fallen. Drei davon sind hier festgenagelt:
 *
 *   1. **Die Live-Pruefung darf eine Abo-Rolle nicht verschlucken.** Der
 *      Ausgang fragt bei `rolle_geben` nach, ob der Streamer live ist. Fuer
 *      die Live-Rolle richtig, fuer ein Abonnement falsch: Ein Abo gilt auch
 *      nachts um vier. Ohne Unterscheidung waere JEDE Abo-Rolle unterdrueckt
 *      worden — und als Erfolg gebucht.
 *   2. **Nur zurueck, was wir gaben.** Am 2026-08-25 nahm ein Abgleich vier
 *      Mitgliedern eine Rolle weg, die sie aus anderem Grund trugen.
 *   3. **Ein Geschenk-Abo gehoert dem Beschenkten.** Wer den Schenkenden
 *      nimmt, gibt die Rolle jemandem, der selbst nicht abonniert hat.
 *
 * Nebenwirkungsfrei: reine Rechnungen und Attrappen, keine Datenbank, kein
 * Twitch, kein Discord.
 *
 *   node scripts/check-streaming-abonnenten.js
 *
 * Exitcode 1 bei jeder Abweichung.
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../apps/dashboard/.env'), quiet: true });

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

// Attrappen: alles im Speicher, mit Mitschrift.
const daten = { auftraege: [], ziele: [], verknuepfungen: [], abonnenten: [], vergaben: [], zustand: [] };

ServiceManager.register('Logger', { info: () => {}, debug: () => {}, warn: () => {}, error: () => {}, success: () => {} });
ServiceManager.register('dbService', {
    async query(sql, w = []) {
        const s = String(sql).replace(/\s+/g, ' ').trim();
        if (s.startsWith('SELECT user_id FROM user_connections')) {
            const t = daten.verknuepfungen.find(v => v.plattform === w[0] && String(v.konto_id) === String(w[1]));
            return t ? [{ user_id: t.user_id }] : [];
        }
        if (s.startsWith('SELECT id, guild_id, abo_rolle_id FROM streaming_targets')) {
            return daten.ziele.filter(z => z.streamer_id === w[0] && z.aktiv && z.abo_rolle_id);
        }
        if (s.startsWith('SELECT konto_id FROM streaming_subscribers')) {
            return daten.abonnenten.filter(a => a.streamer_id === w[0]);
        }
        if (s.startsWith('SELECT mitglied_id FROM streaming_role_grants')) {
            return daten.vergaben.filter(v => v.guild_id === w[0] && v.rolle_id === w[1]);
        }
        if (s.startsWith('SELECT ist_live FROM streaming_state')) {
            return daten.zustand;
        }
        if (s.startsWith('INSERT INTO streaming_outbox')) {
            daten.auftraege.push({ ziel: w[0], guild: w[1], aktion: w[2], nutzlast: JSON.parse(w[3]) });
            return [];
        }
        if (s.startsWith('INSERT INTO streaming_subscribers')) {
            daten.abonnenten.push({ streamer_id: w[0], konto_id: String(w[1]) });
            return [];
        }
        if (s.startsWith('DELETE FROM streaming_subscribers')) {
            daten.abonnenten = daten.abonnenten.filter(a => !(a.streamer_id === w[0] && String(a.konto_id) === String(w[1])));
            return [];
        }
        return [];
    },
    // `abonnentenLesen` holt die Client-ID ueber `zugangsdaten`. Hier genuegt
    // ein erfundener Wert — geprueft wird der Filter, nicht die Anmeldung.
    async getConfig() { return null; }
});
process.env.TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID || 'pruef-id';
process.env.TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET || 'pruef-secret';

const abonnenten = require('../plugins/streaming/dashboard/kern/abonnenten');
const twitch     = require('../plugins/streaming/dashboard/plattformen/twitch');
const drossel    = require('../plugins/streaming/dashboard/ausgabe/drossel');

(async () => {
    // ---------------------------------------------------------------
    console.log('\nDie Rechnung: geben, nehmen, in Ruhe lassen');
    // ---------------------------------------------------------------

    const u = abonnenten.vergleichen(['a', 'b', 'c'], ['b', 'x']);
    pruefe(String(u.geben.sort()) === 'a,c', 'wer sie haben soll und nicht hat, bekommt sie', u.geben.join(','));
    pruefe(String(u.nehmen) === 'x', 'wer sie von UNS hat und nicht mehr soll, verliert sie', u.nehmen.join(','));

    // Der Fall vom 2026-08-25: "fremd" darf nicht in `nehmen` landen.
    const f = abonnenten.vergleichen([], []);
    pruefe(f.nehmen.length === 0, 'wer sie ohne unser Zutun traegt, wird nicht angefasst',
        'die leere Buchfuehrung kann NUR geben, nie nehmen');

    // ---------------------------------------------------------------
    console.log('\nDas Geschenk gehoert dem Beschenkten');
    // ---------------------------------------------------------------

    const geschenk = twitch.abonnentAus({
        event: { user_id: '111', user_name: 'Beschenkter', tier: '1000', is_gift: true }
    });
    pruefe(geschenk.kontoId === '111', 'user_id ist der Beschenkte, nicht der Schenkende', geschenk.kontoName);
    pruefe(geschenk.geschenkt === true, 'und das Geschenk wird vermerkt');

    const uebersetzt = twitch.uebersetzen(
        { 'twitch-eventsub-subscription-type': 'channel.subscribe' },
        { subscription: { type: 'channel.subscribe', condition: { broadcaster_user_id: '42' } },
          event: { broadcaster_user_id: '42', user_id: '111', user_name: 'Wer' } });
    pruefe(uebersetzt?.art === 'abonniert', 'channel.subscribe wird zu "abonniert"', uebersetzt?.art);

    const ende = twitch.uebersetzen(
        { 'twitch-eventsub-subscription-type': 'channel.subscription.end' },
        { subscription: { type: 'channel.subscription.end', condition: { broadcaster_user_id: '42' } },
          event: { broadcaster_user_id: '42', user_id: '111' } });
    pruefe(ende?.art === 'abo_beendet', 'channel.subscription.end wird zu "abo_beendet"', ende?.art);

    const verlaengert = twitch.uebersetzen(
        { 'twitch-eventsub-subscription-type': 'channel.subscription.message' },
        { subscription: { type: 'channel.subscription.message', condition: { broadcaster_user_id: '42' } },
          event: { broadcaster_user_id: '42', user_id: '111' } });
    pruefe(verlaengert?.art === 'abonniert', 'eine Verlaengerung zaehlt wie ein Abonnement',
        'sonst verlaere jemand die Rolle beim Verlaengern');

    // ---------------------------------------------------------------
    console.log('\nDer Kanalinhaber ist nicht sein eigener Abonnent');
    // ---------------------------------------------------------------

    // **Gemessen am 2026-08-26 an einem echten Kanal:** Twitch liefert den
    // Inhaber in `data` mit (tier 3000), zaehlt ihn in `total` aber NICHT.
    // Wer `data.length` nimmt, gibt dem Streamer seine eigene Abo-Rolle.
    // Hier mit einer Attrappe nachgestellt, damit der Fall ohne Netz und ohne
    // Zugangsdaten festgenagelt ist.
    const echtesFetch = global.fetch;
    global.fetch = async () => ({
        ok: true, status: 200,
        json: async () => ({
            total: 0,
            data: [
                { user_id: '42', user_name: 'DerInhaber', tier: '3000', is_gift: false },
                { user_id: '77', user_name: 'EchterAbonnent', tier: '1000', is_gift: false }
            ],
            pagination: {}
        })
    });

    const gelesen = await twitch.abonnentenLesen('42', 'egal');
    global.fetch = echtesFetch;

    pruefe(gelesen.ok === true, 'die Liste wird gelesen');
    pruefe(gelesen.abonnenten.length === 1,
        'der Kanalinhaber faellt heraus', `${gelesen.abonnenten.length} statt 2 Eintraegen in data`);
    pruefe(gelesen.abonnenten[0]?.kontoId === '77',
        'und der echte Abonnent bleibt', gelesen.abonnenten[0]?.kontoName);

    // Die Gegenprobe zur Vorsichtsmassnahme: 401 ist NICHT "keine Abonnenten".
    global.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
    const abgelehnt = await twitch.abonnentenLesen('42', 'abgelaufen');
    global.fetch = echtesFetch;

    pruefe(abgelehnt.abgelehnt === true && abgelehnt.ok === false,
        'ein 401 wird als Ablehnung gemeldet, nicht als leere Liste',
        'sonst naehme der Abgleich allen die Rolle weg');

    // ---------------------------------------------------------------
    console.log('\nVom Ereignis zum Auftrag');
    // ---------------------------------------------------------------

    const streamer = { id: 7, plattform: 'twitch', kanal_id: '42', login: 'testkanal' };
    daten.ziele = [
        { id: 1, streamer_id: 7, guild_id: 'G1', abo_rolle_id: 'R1', aktiv: 1 },
        { id: 2, streamer_id: 7, guild_id: 'G2', abo_rolle_id: 'R2', aktiv: 1 },
        { id: 3, streamer_id: 7, guild_id: 'G3', abo_rolle_id: null, aktiv: 1 }
    ];

    // Ohne Verknuepfung: vermerkt, aber keine Rolle.
    daten.auftraege = [];
    const ohne = await abonnenten.aufnehmen(streamer, { kontoId: '111', kontoName: 'Ohne' });
    pruefe(daten.auftraege.length === 0, 'ohne verknuepftes Discord-Konto kein Rollenauftrag');
    pruefe(ohne.includes('kein verknuepftes'), 'und es steht im Klartext im Protokoll', ohne);
    pruefe(daten.abonnenten.some(a => a.konto_id === '111'),
        'der Abonnent wird trotzdem vermerkt',
        'er bekommt die Rolle, sobald er sich verknuepft');

    // Mit Verknuepfung: je Ziel mit Rolle ein Auftrag.
    daten.verknuepfungen = [{ plattform: 'twitch', konto_id: '111', user_id: 'D111' }];
    daten.auftraege = [];
    await abonnenten.aufnehmen(streamer, { kontoId: '111', kontoName: 'Mit' });

    pruefe(daten.auftraege.length === 2, 'je Ziel MIT Abo-Rolle ein Auftrag', `${daten.auftraege.length} statt 3`);
    pruefe(daten.auftraege.every(a => a.aktion === 'rolle_geben'), 'und zwar zum Geben');
    pruefe(daten.auftraege.every(a => a.nutzlast.mitglied_id === 'D111'),
        'an das verknuepfte Discord-Mitglied');
    pruefe(String(daten.auftraege.map(a => a.nutzlast.rolle_id).sort()) === 'R1,R2',
        'jede Guild bekommt IHRE Rolle', 'derselbe Streamer heisst woanders anders');

    // Der entscheidende Punkt: der Grund muss mitreisen.
    pruefe(daten.auftraege.every(a => a.nutzlast.grund === 'abo'),
        'jeder Auftrag traegt grund="abo"',
        'ohne ihn wuerde der Ausgang die Rolle wegen "nicht live" verschlucken');

    // ---------------------------------------------------------------
    console.log('\nDer Ausgang unterscheidet die beiden Rollen');
    // ---------------------------------------------------------------

    // Der Streamer ist NICHT live. Eine Live-Rolle waere jetzt zu unterdruecken,
    // eine Abo-Rolle nicht.
    daten.zustand = [{ ist_live: 0 }];
    let anDenBotGegangen = false;
    ServiceManager.register('ipcServer', {
        async broadcastOne() { anDenBotGegangen = true; return { success: true, data: {} }; }
    });

    anDenBotGegangen = false;
    const live = await drossel.ausfuehren({
        id: 1, aktion: 'rolle_geben', guild_id: 'G1', target_id: 1, versuche: 0,
        nutzlast: JSON.stringify({ streamer_id: 7, mitglied_id: 'D111', rolle_id: 'R1' })
    });
    pruefe(!anDenBotGegangen && live.hinweis === 'nicht mehr live',
        'eine LIVE-Rolle wird unterdrueckt, wenn niemand sendet', live.hinweis);

    anDenBotGegangen = false;
    await drossel.ausfuehren({
        id: 2, aktion: 'rolle_geben', guild_id: 'G1', target_id: 1, versuche: 0,
        nutzlast: JSON.stringify({ grund: 'abo', streamer_id: 7, mitglied_id: 'D111', rolle_id: 'R1' })
    });
    pruefe(anDenBotGegangen, 'eine ABO-Rolle wird trotzdem vergeben',
        'ein Abonnement gilt auch nachts um vier');

    // ---------------------------------------------------------------
    console.log('\nEnde des Abonnements');
    // ---------------------------------------------------------------

    daten.auftraege = [];
    await abonnenten.entfernen(streamer, { kontoId: '111' });
    pruefe(daten.auftraege.length === 2 && daten.auftraege.every(a => a.aktion === 'rolle_nehmen'),
        'das Ende nimmt die Rolle in jeder Guild');
    pruefe(!daten.abonnenten.some(a => a.konto_id === '111'),
        'und streicht ihn aus der Abonnentenliste');

    // ---------------------------------------------------------------
    console.log('\nDer Abgleich');
    // ---------------------------------------------------------------

    daten.abonnenten = [{ streamer_id: 7, konto_id: '111' }, { streamer_id: 7, konto_id: '222' }];
    daten.verknuepfungen = [
        { plattform: 'twitch', konto_id: '111', user_id: 'D111' }
        // 222 ist NICHT verknuepft
    ];
    daten.vergaben = [
        { guild_id: 'G1', rolle_id: 'R1', mitglied_id: 'D999' }  // hat sie von uns, abonniert aber nicht mehr
    ];
    daten.auftraege = [];
    const bilanz = await abonnenten.abgleichen(streamer);

    const geben  = daten.auftraege.filter(a => a.aktion === 'rolle_geben');
    const nehmen = daten.auftraege.filter(a => a.aktion === 'rolle_nehmen');

    pruefe(geben.some(a => a.guild === 'G1' && a.nutzlast.mitglied_id === 'D111'),
        'ein verknuepfter Abonnent ohne Rolle bekommt sie');
    pruefe(nehmen.some(a => a.guild === 'G1' && a.nutzlast.mitglied_id === 'D999'),
        'wer sie von uns hat und nicht mehr abonniert, verliert sie');
    pruefe(!geben.some(a => a.nutzlast.mitglied_id === '222'),
        'ein unverknuepfter Abonnent taucht nirgends als Discord-Mitglied auf');
    pruefe(daten.auftraege.every(a => a.nutzlast.grund === 'abo'),
        'auch der Abgleich setzt grund="abo"');
    pruefe(bilanz.geben >= 1 && bilanz.nehmen >= 1, 'die Bilanz stimmt', JSON.stringify(bilanz));

    console.log(`\nErgebnis: ${faelle} Pruefungen, ${abweichungen} Abweichung(en).\n`);
    process.exit(abweichungen ? 1 : 0);
})().catch((err) => {
    console.error('\nFEHLER:', err);
    process.exit(1);
});
