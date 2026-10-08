#!/usr/bin/env node
/**
 * Werkbank: die Karte „Fernsteuerung" (Baustelle 175, 2026-10-08).
 *
 * ── Was hier geprüft wird ───────────────────────────────────────────────────
 *
 * Die Karte bearbeitet zwei Stücke, die bei geöffneten Paketen bisher nur
 * mitreisten: die RCON-Verbindung (`management.rcon`) und die Befehlsgruppen
 * (`commands`). Die Probe ist dieselbe wie bei jeder Karte:
 *
 *   Jede Fernsteuerung und jeder Befehl der eingelieferten Pakete, UNVERÄNDERT
 *   durch das Formular gespeichert, ergibt dasselbe Paket.
 *
 * Dazu die Regeln:
 *
 *   - Wählbar ist nur, was der Daemon spricht und was der Entwurf hergibt
 *     (tcp-Port, eine Einstellung, die das Kennwort in die Umgebung schreibt).
 *     Was ein geöffnetes Paket schon trägt, bleibt unverändert speicherbar.
 *   - Der Prüfdurchlauf belegt die Fernsteuerung (Betreiber, 2026-10-08: „Mit
 *     Daemon-Bau"): anmelden, Prüfbefehl senden, Antwort lesen. Der Befehl gehört
 *     der Sitzung und kommt nicht ins Paket.
 *   - Entfernen geht nicht, solange Stoppfolge, Einstellungen oder Befehle
 *     daran hängen.
 *
 * Und der Vertrag mit dem Daemon — die Namen stehen in zwei Repositories, und
 * ein geratener Name zeigt still nichts: Feld der Nutzlast, Felder des
 * Ergebnisses, die gebauten Protokolle werden im Daemon-Quelltext nachgelesen.
 *
 * Gelesen wird aus der Datenbank, geschrieben nichts.
 *
 *   node scripts/check-werkbank-fernsteuerung.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const WURZEL = path.join(__dirname, '..');
const DAEMON = '/home/firedervil/firebot_daemon';
require('dotenv').config({ path: path.join(WURZEL, 'apps/dashboard/.env'), quiet: true });
const mysql = require('mysql2/promise');
const { ServiceManager } = require('dunebot-core');
const { ohneKommentare } = require('./lib/quelltext');

// Die Attrappe kennt genau: das Schreiben des Entwurfs (geht ins Leere), die
// drei Fragen „läuft gerade etwas?" und was ein Test ausdrücklich erlaubt.
let erlaubt = () => null;
let beschaeftigt = false;
ServiceManager.register('dbService', {
    query: async (sql, params) => {
        const t = sql.trim();
        if (/^UPDATE werkbank_sitzungen SET entwurf = \? WHERE id = \?$/.test(t)) return {};
        if (/FROM werkbank_pruefungen p JOIN werkbank_sitzungen s[\s\S]*p\.status = 'laeuft'/.test(t)) return beschaeftigt ? [{ pruefId: 1, guildId: 'g' }] : [];
        if (/^SELECT id FROM werkbank_schritte WHERE sitzung_id = \? AND status = 'laeuft' LIMIT 1$/.test(t)) return [];
        if (/FROM werkbank_laeufe l JOIN werkbank_sitzungen s[\s\S]*l\.status <> 'beendet'/.test(t)) return [];
        const r = erlaubt(sql, params);
        if (r !== null) return r;
        throw new Error(`Attrappe kennt die Abfrage nicht: ${t.slice(0, 90)}`);
    },
});
const still = () => {};
ServiceManager.register('Logger', { debug: still, info: still, warn: still, error: still, success: still });
const S = require('../plugins/werkbank/dashboard/helpers/Sitzungen');

let fehler = 0;
async function pruefe(was, tun) {
    try { await tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').slice(0, 4).join('\n      ')}`); }
}
const j = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
const kopie = (v) => JSON.parse(JSON.stringify(v));
const sortiert = (v) => Array.isArray(v) ? v.map(sortiert)
    : (v && typeof v === 'object') ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sortiert(v[k])])) : v;
const gleich = (a, b, was) => assert.deepStrictEqual(sortiert(a), sortiert(b), was);

/** Die Fernsteuerung so im Formular, wie die Karte sie vorbelegt. */
const rconFormular = (r, pruefbefehl = '') => ({ protocol: r.protocol, port: r.port, password_variable: r.password_variable, pruefbefehl });

/** Ein Befehl so im Formular, wie „Bearbeiten" ihn hineinlegt — nur die Felder seines Wegs gehen mit. */
function befehlFormular(key, c) {
    const f = { key, via: c.via };
    if (c.via === 'rcon' || c.via === 'console') f.command = c.command || '';
    if (c.via === 'file') { f.file = c.file || ''; f.mode = c.mode || ''; f.value = c.value || ''; }
    if (c.via === 'rcon' || c.via === 'console' || c.via === 'query') f.parse = c.parse || '';
    if (c.via === 'unsupported') { f.grund_de = c.reason?.de || ''; f.grund_en = c.reason?.en || ''; }
    return f;
}

/** Eine frische Sitzung mit RCON-fähigem Entwurf — ohne geöffnetes Paket. */
function frisch(mehr = {}) {
    return { id: 7, kennung: 'wbfern', guild_id: 'g1', rootserver_id: 1, image: { ref: 'fb/java', tag: 'x' }, entwurf: {
        identity: { slug: 'probe', name: 'Probe', version: '1.0.0' },
        ports: [{ purpose: 'game', protocol: 'udp', assign: 'pool' }, { purpose: 'rcon', protocol: 'tcp', assign: 'pool' }],
        start: { program: './spiel', ready_when: { port: 'game' }, stop: { sequence: [{ step: 'sigint', timeout_sec: 30, terminates: true }] } },
        settings: [{ key: 'rcon_password', type: 'password', default: null, apply: [{ target: 'env', variable: 'RCON_PASSWORD' }] },
                   { key: 'motd', type: 'text', default: 'hi', apply: [{ target: 'env', variable: 'MOTD' }] }],
        werkbank: { portnummern: { game: 7777, rcon: 7780 } },
        ...mehr,
    } };
}
const RC = { protocol: 'source', port: 'rcon', password_variable: 'RCON_PASSWORD' };

(async () => {
    const c = await mysql.createConnection({
        host: process.env.MYSQL_HOST, port: process.env.MYSQL_PORT,
        user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE, dateStrings: true,
    });
    const [zeilen] = await c.query('SELECT v.fbpkg FROM package_versions v ORDER BY v.published_at, v.id');
    await c.end();
    const neueste = new Map();
    for (const z of zeilen) { const p = j(z.fbpkg); neueste.set(p.identity.slug, p); }
    assert.ok(neueste.size > 0, 'kein einziges Paket in der Datenbank — der Wächter mässe nichts');

    // ── 1) Unverändert speichern ändert nichts ───────────────────────────────
    console.log('\nBestandspakete: unverändert durch die Karte');
    const gesehen = { fernsteuerungen: 0, befehle: 0, rcon: 0, file: 0, query: 0, unsupported: 0 };
    for (const [slug, paket] of neueste) {
        if (!paket.management?.rcon && !paket.commands) continue;
        const vorher = kopie(paket);
        const { entwurf, image, schritte } = S.entwurfAusPaket(paket);
        entwurf.werkbank = { portnummern: S.vorlaeufigePortnummern(entwurf.ports), geoeffnet: { slug, version: paket.identity.version, ziele: S.zieleAusPaket(paket) } };
        const sitzung = { id: 1, kennung: 'wbprobe', entwurf, image };
        const liste = schritte.map(schritt => ({ status: 'uebernommen', schritt }));

        await pruefe(`${slug}: Fernsteuerung und Befehle liegen im Entwurf, nicht mehr im Durchgereichten`, async () => {
            gleich(paket, vorher, 'das Zerlegen hat das Paket verändert');
            assert.strictEqual(entwurf.durchgereicht?.commands, undefined, 'die Befehle stehen noch im Durchgereichten');
            assert.strictEqual(entwurf.durchgereicht?.management?.rcon, undefined, 'die Fernsteuerung steht noch im Durchgereichten');
            gleich(entwurf.commands, paket.commands);
            gleich(entwurf.management?.rcon, paket.management?.rcon);
            assert.ok(!S.durchgereichteTeile(paket).some(t => /^commands\b/.test(t) || /\brcon\b/.test(t)), 'die Karte „Unverändert übernommen" nennt sie noch');
            // Eine Sitzung aus der Zeit VOR der Karte: `ordne` zieht beides um, einmal.
            const alt = { durchgereicht: { ...(paket.management ? { management: kopie(paket.management) } : {}), ...(paket.commands ? { commands: kopie(paket.commands) } : {}) } };
            const einmal = S.ordne(kopie(alt));
            gleich(einmal, S.ordne(kopie(einmal)), 'ordne ist nicht wiederholbar');
            gleich(einmal.commands, paket.commands);
            gleich(einmal.management?.rcon, paket.management?.rcon);
            assert.strictEqual(einmal.durchgereicht?.commands, undefined);
        });

        await pruefe(`${slug}: jedes Stück unverändert gespeichert — dasselbe Paket`, async () => {
            const davor = kopie(S.entwurfAlsPaket(sitzung, liste));
            gleich(davor.management, paket.management); gleich(davor.commands, paket.commands);
            if (paket.management?.rcon) {
                gesehen.fernsteuerungen++;
                await S.rconSpeichern(sitzung, rconFormular(paket.management.rcon));
                assert.strictEqual(sitzung.entwurf.werkbank.rcon_pruefbefehl, undefined, 'ein leerer Prüfbefehl wurde gespeichert');
            }
            for (const [key, cmd] of Object.entries(paket.commands || {})) {
                gesehen.befehle++; if (gesehen[cmd.via] !== undefined) gesehen[cmd.via]++;
                await S.befehlSpeichern(sitzung, befehlFormular(key, cmd));
            }
            gleich(S.entwurfAlsPaket(sitzung, liste), davor, 'unverändert speichern hat das Paket verändert');
            assert.strictEqual(S.fingerabdruck(S.entwurfAlsPaket(sitzung, liste)), S.fingerabdruck(davor), 'der Fingerabdruck ist ein anderer — ein grüner Durchlauf gälte nicht mehr');
        });

        if (paket.management?.rcon) {
            await pruefe(`${slug}: ohne einen Handgriff belegbar — der Prüfbefehl ist die Spielerliste des Pakets`, async () => {
                const liste2 = paket.commands?.['players.list'];
                assert.ok(liste2 && liste2.via === 'rcon', 'dieses Paket hat keine Spielerliste über rcon — dann bräuchte es einen eigenen Prüfbefehl');
                assert.strictEqual(S.rconPruefbefehl(sitzung), liste2.command);
                const stand = S.rconStand(sitzung);
                assert.strictEqual(stand.eigener, '');
                assert.ok(stand.quelle, 'die Karte findet die Einstellung nicht, die das Kennwort schreibt');
                // Vorgabe des Kennworts ist leer — die Karte sagt, dass der Durchlauf so scheitert.
                assert.ok(stand.warnungen.some(w => /keinen Probewert/.test(w)), 'die Warnung zum leeren Kennwort fehlt');
                sitzung.entwurf.werkbank.werte = { [stand.quelle]: 'geheim' };
                assert.deepStrictEqual(S.rconStand(sitzung).warnungen, []);
            });
        }
    }
    await pruefe('die Probe hat alles gesehen, was die Karte kann', async () => {
        for (const [k, n] of Object.entries(gesehen)) assert.ok(n > 0, `kein Bestandspaket mit „${k}" — dieser Weg wäre ungeprüft`);
    });

    // ── 2) Die Verbindung ─────────────────────────────────────────────────────
    console.log('\nFernsteuerung: was sich speichern lässt');
    await pruefe('anlegen: Protokoll, tcp-Port, Kennwort aus einer Einstellung — und der Prüfbefehl bleibt in der Sitzung', async () => {
        const s = frisch();
        await S.rconSpeichern(s, rconFormular(RC, 'list'));
        gleich(s.entwurf.management.rcon, RC);
        assert.strictEqual(s.entwurf.werkbank.rcon_pruefbefehl, 'list');
        const paket = S.entwurfAlsPaket(s, []);
        gleich(paket.management, { rcon: RC });
        assert.ok(!JSON.stringify(paket).includes('pruefbefehl'), 'der Prüfbefehl steht im Paket');
        await S.rconSpeichern(s, rconFormular(RC, ''));
        assert.strictEqual(s.entwurf.werkbank.rcon_pruefbefehl, undefined, 'leeren entfernt den Prüfbefehl nicht');
    });
    await pruefe('abgelehnt: unbekanntes oder nicht gebautes Protokoll, udp-Port, fehlender Port, Variable ohne Einstellung', async () => {
        const s = frisch();
        await assert.rejects(S.rconSpeichern(s, { ...rconFormular(RC), protocol: 'ssh' }), /Protokoll/);
        await assert.rejects(S.rconSpeichern(s, { ...rconFormular(RC), protocol: 'webrcon' }), /spricht der Daemon nicht/);
        await assert.rejects(S.rconSpeichern(s, { ...rconFormular(RC), port: 'game' }), /udp/);
        await assert.rejects(S.rconSpeichern(s, { ...rconFormular(RC), port: 'nirgends' }), /gibt es im Entwurf nicht/);
        await assert.rejects(S.rconSpeichern(s, { ...rconFormular(RC), password_variable: 'ADMIN_PW' }), /Keine Einstellung schreibt/);
        await assert.rejects(S.rconSpeichern(s, { ...rconFormular(RC), password_variable: '9x' }), /kein gültiger Name/);
        assert.strictEqual(s.entwurf.management, undefined, 'ein abgelehnter Versuch hat etwas geschrieben');
    });
    await pruefe('was ein geöffnetes Paket schon trägt, bleibt unverändert speicherbar — auch wenn es neu nicht wählbar wäre', async () => {
        const s = frisch({ management: { rcon: { protocol: 'webrcon', port: 'rcon', password_variable: 'ADMIN_PW' } } });
        await S.rconSpeichern(s, rconFormular(s.entwurf.management.rcon));
        gleich(s.entwurf.management.rcon, { protocol: 'webrcon', port: 'rcon', password_variable: 'ADMIN_PW' });
        const w = S.rconStand(s).warnungen;
        assert.ok(w.some(x => /spricht der Daemon nicht/.test(x)) && w.some(x => /Keine Einstellung schreibt/.test(x)), `die Karte warnt nicht: ${w.join(' | ')}`);
    });
    await pruefe('Prüfbefehl: eine Zeile, ohne Platzhalter; ohne eigenen gilt die Spielerliste, sonst keiner', async () => {
        const s = frisch();
        await assert.rejects(S.rconSpeichern(s, rconFormular(RC, 'a\nb')), /eine Zeile/);
        await assert.rejects(S.rconSpeichern(s, rconFormular(RC, 'x'.repeat(S.RCON.befehl + 1))), /eine Zeile/);
        await assert.rejects(S.rconSpeichern(s, rconFormular(RC, 'kick {{player_id}}')), /ohne Platzhalter/);
        await S.rconSpeichern(s, rconFormular(RC));
        assert.strictEqual(S.rconPruefbefehl(s), '', 'ein Prüfbefehl aus dem Nichts');
        await S.befehlSpeichern(s, { key: 'players.list', via: 'rcon', command: '/players', parse: '' });
        assert.strictEqual(S.rconPruefbefehl(s), '/players');
        await S.befehlSpeichern(s, { key: 'players.list', via: 'rcon', command: 'list {{x}}', parse: '' });
        assert.strictEqual(S.rconPruefbefehl(s), '', 'ein Befehl mit Platzhalter wurde als Prüfbefehl genommen');
        await S.rconSpeichern(s, rconFormular(RC, 'version'));
        assert.strictEqual(S.rconPruefbefehl(s), 'version', 'der eigene Prüfbefehl hat keinen Vorrang');
    });
    await pruefe('entfernen: nicht, solange Stoppschritt, Einstellung oder Befehl daran hängen — und der Port bleibt ebenfalls', async () => {
        const s = frisch();
        await S.rconSpeichern(s, rconFormular(RC, 'list'));
        s.entwurf.start.stop.sequence.unshift({ step: 'rcon:stop', timeout_sec: 30, terminates: true });
        s.entwurf.settings.push({ key: 'pvp', type: 'boolean', default: true, apply: [{ target: 'rcon', command: 'pvp {{value}}' }] });
        await S.befehlSpeichern(s, { key: 'world.save', via: 'rcon', command: 'save-all', parse: '' });
        await assert.rejects(S.rconEntfernen(s), (e) => /rcon:stop/.test(e.message) && /„pvp"/.test(e.message) && /„world\.save"/.test(e.message));
        await assert.rejects(S.portEntfernen(s, 'rcon'), /Fernsteuerung/);
        s.entwurf.start.stop.sequence.shift();
        s.entwurf.settings.pop();
        await S.befehlEntfernen(s, 'world.save');
        await S.rconEntfernen(s);
        assert.strictEqual(s.entwurf.management, undefined);
        assert.strictEqual(s.entwurf.commands, undefined, 'ein leerer Befehlsteil blieb stehen');
        assert.strictEqual(s.entwurf.werkbank.rcon_pruefbefehl, undefined, 'der Prüfbefehl blieb ohne Fernsteuerung stehen');
        await S.portEntfernen(s, 'rcon');
    });

    // ── 3) Die Befehle ───────────────────────────────────────────────────────
    console.log('\nBefehle: was sich speichern lässt');
    await pruefe('je Weg seine Felder — und nur die', async () => {
        const s = frisch();
        await S.rconSpeichern(s, rconFormular(RC));
        await S.befehlSpeichern(s, { key: 'players.kick', via: 'rcon', command: 'kick {{player_id}} {{reason}}', parse: '' });
        await S.befehlSpeichern(s, { key: 'broadcast', via: 'console', command: 'say {{message}}', parse: '' });
        await S.befehlSpeichern(s, { key: 'players.ban', via: 'file', file: 'bans.txt', mode: 'append_line', value: '{{player_id}}' });
        await S.befehlSpeichern(s, { key: 'players.list', via: 'query', parse: 'table:name,ping' });
        await S.befehlSpeichern(s, { key: 'world.save', via: 'unsupported', grund_de: 'Speichert von selbst.', grund_en: '' });
        gleich(s.entwurf.commands, {
            'players.kick': { via: 'rcon', command: 'kick {{player_id}} {{reason}}' },
            'broadcast': { via: 'console', command: 'say {{message}}' },
            'players.ban': { via: 'file', file: 'bans.txt', mode: 'append_line', value: '{{player_id}}' },
            'players.list': { via: 'query', parse: 'table:name,ping' },
            'world.save': { via: 'unsupported', reason: { de: 'Speichert von selbst.' } },
        });
        // Den Weg wechseln: Die Felder des alten Wegs gehen nicht mit.
        await S.befehlSpeichern(s, { key: 'players.ban', via: 'rcon', command: 'ban {{player_id}}', parse: '' });
        gleich(s.entwurf.commands['players.ban'], { via: 'rcon', command: 'ban {{player_id}}' });
    });
    await pruefe('abgelehnt: Gruppe ausserhalb des Musters, rcon ohne Fernsteuerung, leerer Befehl, „nicht möglich" ohne Grund, Pfad nach draussen', async () => {
        const s = frisch();
        await assert.rejects(S.befehlSpeichern(s, { key: 'Players.List', via: 'query' }), /Befehlsgruppe/);
        await assert.rejects(S.befehlSpeichern(s, { key: 'a.b.c', via: 'query' }), /Befehlsgruppe/);
        await assert.rejects(S.befehlSpeichern(s, { key: 'world.save', via: 'rcon', command: 'save' }), /hat aber keine/);
        await assert.rejects(S.befehlSpeichern(s, { key: 'world.save', via: 'console', command: '  ' }), /braucht es den Befehl/);
        await assert.rejects(S.befehlSpeichern(s, { key: 'world.save', via: 'unsupported', grund_de: '', grund_en: '' }), /Begründung/);
        await assert.rejects(S.befehlSpeichern(s, { key: 'players.ban', via: 'file', file: '../etc/passwd', mode: 'append_line' }), /Pfad im Spielordner/);
        await assert.rejects(S.befehlSpeichern(s, { key: 'players.ban', via: 'file', file: 'bans.txt', mode: 'ueberschreiben' }), /Art:/);
        await assert.rejects(S.befehlSpeichern(s, { key: 'players.ban', via: 'api', command: 'x' }), /Weg:/);
        await assert.rejects(S.befehlEntfernen(s, 'players.ban'), /gibt es im Entwurf nicht/);
        assert.strictEqual(s.entwurf.commands, undefined, 'ein abgelehnter Versuch hat etwas geschrieben');
    });
    await pruefe('ein Weg, den das Formular nicht anbietet (api), bleibt, wenn das Paket ihn trägt', async () => {
        const s = frisch({ commands: { 'world.save': { via: 'api', command: '/v1/save' } } });
        await S.befehlSpeichern(s, { key: 'world.save', via: 'api' });
        assert.strictEqual(s.entwurf.commands['world.save'].via, 'api');
    });
    await pruefe('während ein Prüfdurchlauf läuft, ändert sich nichts', async () => {
        const s = frisch({ management: { rcon: kopie(RC) }, commands: { 'world.save': { via: 'console', command: 'save' } } });
        beschaeftigt = true;
        try {
            await assert.rejects(S.rconSpeichern(s, rconFormular(RC)), /Prüfdurchlauf läuft/);
            await assert.rejects(S.rconEntfernen(s), /Prüfdurchlauf läuft/);
            await assert.rejects(S.befehlSpeichern(s, { key: 'broadcast', via: 'console', command: 'say hi' }), /Prüfdurchlauf läuft/);
            await assert.rejects(S.befehlEntfernen(s, 'world.save'), /Prüfdurchlauf läuft/);
        } finally { beschaeftigt = false; }
    });

    // ── 4) Der Nachweis ──────────────────────────────────────────────────────
    console.log('\nNachweis im Prüfdurchlauf');
    const gesendet = [];
    ServiceManager.register('ipmServer', {
        isDaemonOnline: () => true,
        sendCommand: async (d, befehl, nutzlast) => { gesendet.push({ befehl, nutzlast }); return { success: true }; },
    });
    const durchlauf = async (s) => {
        erlaubt = (sql) => {
            const t = sql.trim();
            if (/^INSERT INTO werkbank_pruefungen /.test(t)) return { insertId: 5 };
            if (/^SELECT daemon_id FROM rootserver WHERE id = \?$/.test(t)) return [{ daemon_id: 'd1' }];
            return null;
        };
        try {
            gesendet.length = 0;
            await S.pruefen(s, [{ status: 'ok', schritt: { type: 'mkdir', path: 'mods' } }]);
            return gesendet.find(g => g.befehl === 'werkbank.pruefen').nutzlast;
        } finally { erlaubt = () => null; require('../plugins/werkbank/dashboard/helpers/Ereignisse').vergissPruefung(s.kennung); }
    };
    await pruefe('mit Fernsteuerung und Prüfbefehl geht er an den Daemon; ohne das eine oder das andere nicht', async () => {
        // Ein Entwurf, den der Durchlauf annimmt: zwei Stoppschritte, und jede
        // Portnummer erreicht das Spiel über die Startzeile.
        const s = frisch();
        s.entwurf.start.stop.sequence.push({ step: 'sigkill', timeout_sec: 10, terminates: true });
        s.entwurf.start.args = [{ key: 'port', parts: [{ text: '--port={{port:game}}' }] }, { key: 'rcon', parts: [{ text: '--rcon-port={{port:rcon}}' }] }];
        gleich(S.durchlaufMaengel(S.entwurfAlsPaket(s, [{ status: 'ok', schritt: { type: 'mkdir', path: 'mods' } }])), [], 'der Probe-Entwurf ist selbst nicht durchlauffähig');
        assert.strictEqual((await durchlauf(s)).rcon_pruefbefehl, undefined, 'ein Prüfbefehl ohne Fernsteuerung — der Daemon wiese den Durchlauf ab');
        await S.rconSpeichern(s, rconFormular(RC));
        const ohne = await durchlauf(s);
        assert.strictEqual(ohne.rcon_pruefbefehl, undefined);
        gleich(ohne.management, { rcon: RC });
        await S.rconSpeichern(s, rconFormular(RC, 'list'));
        assert.strictEqual((await durchlauf(s)).rcon_pruefbefehl, 'list');
    });
    await pruefe('der Vermerk im Paket: belegt, nicht belegt, oder keiner', async () => {
        const mit = { id: 9, entwurf: { management: { rcon: RC } } };
        assert.match(S.rconVermerk({ ...mit, ergebnis: { rcon: { befehl: 'list', angemeldet: true } } })[0], /Durchlauf #9 belegt — angemeldet, „list" beantwortet/);
        assert.match(S.rconVermerk({ ...mit, ergebnis: {} })[0], /NICHT belegt/);
        assert.deepStrictEqual(S.rconVermerk({ id: 9, entwurf: {}, ergebnis: {} }), []);
    });

    // ── 5) Der Vertrag mit dem Daemon ────────────────────────────────────────
    console.log('\nVertrag mit dem Daemon (im Quelltext nachgelesen)');
    // Ohne Kommentare: Ein Feldname, der nur noch in einer Erklärung steht, ist kein Vertrag.
    const go = (datei) => ohneKommentare(fs.readFileSync(path.join(DAEMON, datei), 'utf8'));
    await pruefe('der Daemon liest genau das Feld, das das Dashboard sendet', async () => {
        assert.ok(go('internal/websocket/werkbank.go').includes('payload["rcon_pruefbefehl"]'), 'werkbank.pruefen liest „rcon_pruefbefehl" nicht');
        const helfer = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'plugins/werkbank/dashboard/helpers/Sitzungen.js'), 'utf8'));
        assert.ok(/rcon_pruefbefehl: rconPruefbefehl\(sitzung\)/.test(helfer), 'pruefen() sendet das Feld nicht unter diesem Namen');
    });
    await pruefe('die Felder des Ergebnisses heissen im Daemon so, wie die Ansicht sie liest', async () => {
        const q = go('internal/gameserver/werkbank_pruefung.go');
        assert.ok(/Rcon \*RconNachweis `json:"rcon,omitempty"`/.test(q), 'PruefErgebnis trägt kein Feld „rcon"');
        const block = q.slice(q.indexOf('type RconNachweis struct'), q.indexOf('}', q.indexOf('type RconNachweis struct')));
        const ansicht = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'plugins/werkbank/dashboard/views/guild/werkbank-sitzung.ejs'), 'utf8'));
        const gelesen = new Set([...ansicht.matchAll(/(?:rconBeleg|e\.rcon)\.([a-z_]+)/g)].map(m => m[1]));
        assert.ok(gelesen.size >= 5, `die Ansicht liest nur ${[...gelesen].join(', ')}`);
        for (const feld of gelesen) assert.ok(block.includes(`json:"${feld}`), `die Ansicht liest „${feld}", der Daemon meldet es nicht`);
    });
    await pruefe('„gebaut" ist, wofür der Daemon einen Treiber hat', async () => {
        const baue = go('internal/gameserver/auftrag/baue.go');
        const fn = baue.slice(baue.indexOf('func treiberName('), baue.indexOf('\n}\n', baue.indexOf('func treiberName(')));
        const uebersetzt = Object.fromEntries([...fn.matchAll(/case "([a-z_]+)":\s*return "([a-z_]+)"/g)].map(m => [m[1], m[2]]));
        const ordner = path.join(DAEMON, 'internal/gameserver/rcon');
        const quellen = fs.readdirSync(ordner).filter(d => d.endsWith('.go') && !d.endsWith('_test.go')).map(d => go(path.join('internal/gameserver/rcon', d))).join('\n');
        const namen = Object.fromEntries([...quellen.matchAll(/(Protocol[A-Za-z]+)\s*=\s*"([a-z_]+)"/g)].map(m => [m[1], m[2]]));
        const treiber = new Set([...quellen.matchAll(/Register\((Protocol[A-Za-z]+),/g)].map(m => namen[m[1]]));
        assert.ok(treiber.size > 0, 'im Daemon keinen einzigen Treiber gefunden — die Suche trifft nichts mehr');
        const gebaut = S.RCON.protokolle.filter(p => treiber.has(uebersetzt[p] || p));
        gleich(gebaut, S.RCON.gebaut, `Daemon: ${[...treiber].join(', ')} — Karte: ${S.RCON.gebaut.join(', ')}`);
        const schema = JSON.parse(fs.readFileSync(path.join(WURZEL, 'packages/fbpkg/schema/fbpkg-v1.schema.json'), 'utf8'));
        gleich(schema.properties.management.properties.rcon.properties.protocol.enum, S.RCON.protokolle, 'die Protokolle der Karte sind nicht die des Schemas');
        gleich(schema.definitions.command.properties.mode.enum, S.BEFEHL.arten);
        gleich(schema.definitions.command.properties.via.enum.filter(v => v !== 'api'), S.BEFEHL.wege);
    });

    // ── 6) Karte und Routen ──────────────────────────────────────────────────
    console.log('\nKarte und Routen');
    await pruefe('die Karte steht in der Sitzung, ihre Wege verlangen das Baurecht', async () => {
        const ansicht = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'plugins/werkbank/dashboard/views/guild/werkbank-sitzung.ejs'), 'utf8'));
        for (const id of ['karteFernsteuerung', 'formFern', 'formBefehl', 'fernBeleg']) assert.ok(ansicht.includes(`id="${id}"`), `„${id}" fehlt in der Ansicht`);
        for (const weg of ["hier + '/fernsteuerung'", "hier + '/fernsteuerung/entfernen'", "hier + '/befehle'", "hier + '/befehle/entfernen'"]) {
            assert.ok(ansicht.includes(weg), `die Ansicht ruft ${weg} nicht auf`);
        }
        const router = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'plugins/werkbank/dashboard/routes/guild.router.js'), 'utf8'));
        for (const weg of ['/:kennung/fernsteuerung', '/:kennung/fernsteuerung/entfernen', '/:kennung/befehle', '/:kennung/befehle/entfernen']) {
            assert.ok(router.includes(`router.post('${weg}', requirePermission('WERKBANK.BAUEN')`), `der Weg ${weg} fehlt oder verlangt das Baurecht nicht`);
        }
        for (const k of ['fernsteuerung: Sitzungen.rconStand(sitzung)', 'RCON: Sitzungen.RCON', 'BEFEHL: Sitzungen.BEFEHL']) {
            assert.ok(router.includes(k), `die Ansicht bekommt „${k.split(':')[0]}" nicht`);
        }
        // Die fünf Gruppen der Karte sind die, die die Serverseite beim Namen kennt.
        gleich(S.BEFEHL.gruppen, Object.keys(require('../plugins/gameserver/dashboard/helpers/Serverseite').BEFEHL_NAME));
    });

    console.log(`\n  · gesehen: ${Object.entries(gesehen).map(([k, n]) => `${n} ${k}`).join(', ')}`);
    console.log(fehler === 0 ? '\n✅ Fernsteuerung: bearbeitbar, belegbar, und unverändert bleibt unverändert\n' : `\n❌ ${fehler} Abweichung(en)\n`);
    process.exit(fehler === 0 ? 0 : 1);
})().catch((e) => { console.error('FEHLER:', e.message); process.exit(1); });
