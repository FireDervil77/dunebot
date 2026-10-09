#!/usr/bin/env node
/**
 * Werkbank: die Karte „Ports und Abfrage" (Baustelle 175, 2026-10-07).
 *
 * ── Was hier geprüft wird ───────────────────────────────────────────────────
 *
 * Die Karte bearbeitet, was vorher bei geöffneten Paketen nur mitreiste: an
 * den Ports die Kopplung (`game+1`), Pflicht/optional, die Variable, „nur wenn
 * Datei", die Beschreibung — und die Abfrage samt „erst bereit, wenn sie
 * antwortet". Die Probe, an der alles hängt, ist dieselbe wie beim Öffnen:
 *
 *   Jeder Port und jede Abfrage der eingelieferten Pakete, UNVERÄNDERT durch
 *   das Formular gespeichert, ergibt dasselbe Paket.
 *
 * Dazu die Regeln der Absprache vom 2026-10-07:
 *
 *   - Ports kommen aus der Beobachtung; von Hand nur mit „nur wenn Datei".
 *   - Eine beobachtete Nummer, die der Kopplung widerspricht, wird abgelehnt;
 *     eine vorläufige rechnet nach.
 *   - Die Abfrage kommt auch unbelegt ins Paket — dann steht es dabei.
 *
 * Gelesen wird aus der Datenbank, geschrieben nichts.
 *
 *   node scripts/check-werkbank-ports.js
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

/** Ein Port so im Formular, wie der Knopf „Bearbeiten" ihn hineinlegt. */
function alsFormular(p) {
    const m = /^([a-z][a-z0-9_]*)\+([0-9]+)$/.exec(p.assign || '');
    const f = {
        alt: p.purpose, zweck: p.purpose, protocol: p.protocol,
        basis: m ? m[1] : '', variable: p.variable || '',
        beschreibung_de: (p.description && p.description.de) || '', beschreibung_en: (p.description && p.description.en) || '',
        needed_by: p.needed_by || '',
    };
    if (m) f.abstand = m[2];              // ohne Kopplung ist das Feld gesperrt und fehlt
    if (p.required === false) f.optional = 'on';
    return f;
}

/** Eine frische Sitzung mit beobachteten Ports — ohne geöffnetes Paket. */
function frisch(ports, nummern) {
    return { id: 7, kennung: 'wbports', image: { ref: 'fb/steamcmd', tag: 'x' }, entwurf: {
        identity: { slug: 'probe', name: 'Probe', version: '1.0.0' },
        ports: kopie(ports),
        start: { program: './spiel', ready_when: { port: ports[0].purpose } },
        werkbank: { portnummern: { ...nummern }, beobachtet: Object.fromEntries(Object.keys(nummern).map(k => [k, true])) },
    } };
}
const UDP = (purpose, mehr = {}) => ({ purpose, protocol: 'udp', assign: 'pool', ...mehr });

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
    const gesehen = { ports: 0, gekoppelt: 0, variable: 0, nurWenn: 0, optional: 0, abfragen: 0, bereit: 0 };
    for (const [slug, paket] of neueste) {
        const vorher = kopie(paket);
        const { entwurf, image, schritte } = S.entwurfAusPaket(paket);
        entwurf.werkbank = { portnummern: S.vorlaeufigePortnummern(entwurf.ports), geoeffnet: { slug, version: paket.identity.version, ziele: S.zieleAusPaket(paket) } };
        const sitzung = { id: 1, kennung: 'wbprobe', entwurf, image };
        const liste = schritte.map(schritt => ({ status: 'uebernommen', schritt }));

        await pruefe(`${slug}: Ports (${(paket.ports || []).length}) und Abfrage unverändert speichern ändert nichts`, async () => {
            for (const p of paket.ports || []) {
                await S.portSpeichern(sitzung, alsFormular(p));
                gesehen.ports++;
                if (S.kopplungVon(p)) gesehen.gekoppelt++;
                if (p.variable) gesehen.variable++;
                if (p.needed_by) gesehen.nurWenn++;
                if (p.required === false) gesehen.optional++;
            }
            const q = paket.management?.query;
            if (q) {
                gesehen.abfragen++;
                const bereit = paket.start?.ready_when?.query === true;
                if (bereit) gesehen.bereit++;
                await S.abfrageSpeichern(sitzung, { protocol: q.protocol, port: q.port, ...(bereit ? { bereit: 'on' } : {}) });
            }
            const zurueck = S.entwurfAlsPaket(sitzung, liste);
            gleich(zurueck.ports, paket.ports, 'ports');
            gleich(zurueck.management, paket.management, 'management');
            gleich(zurueck.start, paket.start, 'start');
            // Jeder Zweck hat weiter eine Nummer, und die Kopplung stimmt.
            const nr = sitzung.entwurf.werkbank.portnummern;
            for (const p of paket.ports || []) {
                assert.ok(Number.isInteger(nr[p.purpose]), `„${p.purpose}" ohne Nummer`);
                const k = S.kopplungVon(p);
                if (k) assert.strictEqual(nr[p.purpose], nr[k.basis] + k.abstand);
            }
        });

        await pruefe(`${slug}: die Abfrage liegt im Entwurf, der Rest der Verwaltung reist weiter mit — das Paket selbst bleibt unberührt`, async () => {
            const frischZerlegt = S.entwurfAusPaket(paket).entwurf;
            gleich(paket, vorher, 'das Zerlegen hat das Paket verändert');
            assert.strictEqual(frischZerlegt.durchgereicht?.management?.query, undefined, 'die Abfrage steht noch im Durchgereichten');
            gleich(frischZerlegt.management?.query, paket.management?.query);
            // Was in `management` KEINE Karte hat — seit 2026-10-08 hat auch die
            // Fernsteuerung eine (check-werkbank-fernsteuerung.js).
            const rest = Object.keys(paket.management || {}).filter(k => !S.EIGENE.management.includes(k));
            gleich(Object.keys(frischZerlegt.durchgereicht?.management || {}).sort(), rest.sort());
            // Eine Sitzung aus der Zeit VOR der Karte trägt die Abfrage im Durchgereichten — `ordne` zieht sie um, einmal.
            if (paket.management) {
                const alt = { durchgereicht: { management: kopie(paket.management) } };
                const einmal = S.ordne(kopie(alt));
                gleich(einmal, S.ordne(kopie(einmal)), 'ordne ist nicht wiederholbar');
                gleich(einmal.management?.query, paket.management.query);
                assert.strictEqual(einmal.durchgereicht?.management?.query, undefined);
            }
        });
    }
    await pruefe('die Probe hat alles gesehen, was die Karte kann', async () => {
        for (const [k, n] of Object.entries(gesehen)) assert.ok(n > 0, `kein Bestandspaket mit „${k}" — dieser Weg wäre ungeprüft`);
    });

    // ── 2) Kopplung ──────────────────────────────────────────────────────────
    console.log('\nKopplung');
    await pruefe('beobachtet 7777 und 7778: query = game+1 wird angenommen', async () => {
        const s = frisch([UDP('game'), UDP('query')], { game: 7777, query: 7778 });
        await S.portSpeichern(s, { alt: 'query', zweck: 'query', protocol: 'udp', basis: 'game', abstand: '1' });
        assert.strictEqual(s.entwurf.ports[1].assign, 'game+1');
        assert.strictEqual(s.entwurf.werkbank.portnummern.query, 7778);
    });
    await pruefe('beobachtet 7777 und 27015: dieselbe Kopplung wird abgelehnt — die Beobachtung widerspricht', async () => {
        const s = frisch([UDP('game'), UDP('query')], { game: 7777, query: 27015 });
        await assert.rejects(S.portSpeichern(s, { alt: 'query', zweck: 'query', protocol: 'udp', basis: 'game', abstand: '1' }), /Die Kopplung stimmt so nicht/);
        assert.strictEqual(s.entwurf.ports[1].assign, 'pool', 'trotz Ablehnung gespeichert');
    });
    await pruefe('eine VORLÄUFIGE Nummer (geöffnetes Paket) rechnet nach statt abzulehnen', async () => {
        const s = frisch([UDP('game'), UDP('query', { assign: 'game+1' })], { game: 28000, query: 28001 });
        delete s.entwurf.werkbank.beobachtet;
        await S.portSpeichern(s, { alt: 'query', zweck: 'query', protocol: 'udp', basis: 'game', abstand: '2' });
        assert.strictEqual(s.entwurf.werkbank.portnummern.query, 28002);
    });
    await pruefe('die Basis neu beobachtet: der gekoppelte Port zieht nach und gilt nicht mehr als beobachtet', async () => {
        const s = frisch([UDP('game'), UDP('query', { assign: 'game+1' })], { game: 7777, query: 7778 });
        await S.portUebernehmen(s, { zweck: 'game', protocol: 'udp', port: 9000 });
        assert.deepStrictEqual(s.entwurf.werkbank.portnummern, { game: 9000, query: 9001 });
        assert.deepStrictEqual(s.entwurf.werkbank.beobachtet, { game: true });
        assert.strictEqual(s.entwurf.ports[1].assign, 'game+1', 'das Übernehmen hat die Kopplung gelöscht');
    });
    await pruefe('einen gekoppelten Port auf der falschen Nummer übernehmen wird abgelehnt, auf der richtigen angenommen', async () => {
        const s = frisch([UDP('game'), UDP('query', { assign: 'game+1' })], { game: 7777, query: 7778 });
        await assert.rejects(S.portUebernehmen(s, { zweck: 'query', protocol: 'udp', port: 27015 }), /müsste auf 7778 lauschen/);
        await S.portUebernehmen(s, { zweck: 'query', protocol: 'udp', port: 7778 });
        assert.strictEqual(s.entwurf.werkbank.beobachtet.query, true);
    });
    await pruefe('keine Kette, nicht an sich selbst, nicht an einen Port, den es nicht gibt, kein Abstand 0', async () => {
        const s = frisch([UDP('game'), UDP('query', { assign: 'game+1' }), UDP('rcon')], { game: 7777, query: 7778, rcon: 7780 });
        const f = (mehr) => ({ alt: 'rcon', zweck: 'rcon', protocol: 'udp', abstand: '1', ...mehr });
        await assert.rejects(S.portSpeichern(s, f({ basis: 'query' })), /selbst gekoppelt/);
        await assert.rejects(S.portSpeichern(s, f({ basis: 'rcon' })), /gibt es im Entwurf nicht/);
        await assert.rejects(S.portSpeichern(s, f({ basis: 'beacon' })), /gibt es im Entwurf nicht/);
        await assert.rejects(S.portSpeichern(s, f({ basis: 'game', abstand: '0' })), /Abstand/);
        await assert.rejects(S.portSpeichern(s, { alt: 'game', zweck: 'game', protocol: 'udp', basis: 'rcon', abstand: '1' }), /schon ein anderer Port gekoppelt/);
    });

    // ── 3) Bearbeiten und von Hand ───────────────────────────────────────────
    console.log('\nBearbeiten und von Hand anlegen');
    await pruefe('Protokoll, Variable, Beschreibung, optional: gespeichert — und was das Formular nicht kennt, bleibt', async () => {
        const s = frisch([{ purpose: 'game', protocol: 'both', assign: 'pool', required: true, fremd: { a: 1 } }], { game: 7777 });
        await S.portSpeichern(s, { alt: 'game', zweck: 'game', protocol: 'udp', basis: '', variable: 'SERVER_PORT', beschreibung_de: 'Spielport', beschreibung_en: '' });
        gleich(s.entwurf.ports[0], { purpose: 'game', protocol: 'udp', assign: 'pool', required: true, variable: 'SERVER_PORT', description: { de: 'Spielport' }, fremd: { a: 1 } });
        // Geleert heisst weg — und Pflicht wird ohne ausdrückliches `true` nicht hingeschrieben.
        const t = frisch([UDP('game', { variable: 'X', description: { de: 'a' } })], { game: 7777 });
        await S.portSpeichern(t, { alt: 'game', zweck: 'game', protocol: 'udp', basis: '', variable: '', beschreibung_de: '', beschreibung_en: '' });
        gleich(t.entwurf.ports[0], { purpose: 'game', protocol: 'udp', assign: 'pool' });
    });
    await pruefe('der Zweck lässt sich nicht umbenennen; Unsinn wird abgewiesen', async () => {
        const s = frisch([UDP('game')], { game: 7777 });
        const f = (mehr) => ({ alt: 'game', zweck: 'game', protocol: 'udp', basis: '', ...mehr });
        await assert.rejects(S.portSpeichern(s, f({ zweck: 'spiel' })), /nicht umbenennen/);
        await assert.rejects(S.portSpeichern(s, f({ protocol: 'sctp' })), /Protokoll/);
        await assert.rejects(S.portSpeichern(s, f({ variable: '9PORT' })), /Variable/);
        await assert.rejects(S.portSpeichern(s, f({ alt: 'gibtsnicht', zweck: 'gibtsnicht' })), /gibt es im Entwurf nicht/);
        await assert.rejects(S.portSpeichern(s, f({ needed_by: '/etc/passwd', optional: 'on' })), /Nur wenn Datei/);
        gleich(s.entwurf.ports, [UDP('game')], 'eine Ablehnung hat trotzdem geschrieben');
    });
    await pruefe('von Hand nur mit „nur wenn Datei" — und der geht nur optional mit eigener Nummer', async () => {
        const s = frisch([UDP('game')], { game: 7777 });
        const neu = (mehr) => ({ alt: '', zweck: 'voice', protocol: 'udp', basis: '', ...mehr });
        await assert.rejects(S.portSpeichern(s, neu({})), /kommt aus der Beobachtung/);
        await assert.rejects(S.portSpeichern(s, neu({ needed_by: 'game/mods/voicechat-*.jar' })), /nur mit eigener Nummer und als optionaler Port/);
        await assert.rejects(S.portSpeichern(s, neu({ needed_by: 'game/mods/voicechat-*.jar', optional: 'on', basis: 'game', abstand: '1' })), /nur mit eigener Nummer und als optionaler Port/);
        await assert.rejects(S.portSpeichern(s, neu({ zweck: 'game', needed_by: 'game/mods/x.jar', optional: 'on' })), /gibt es schon/);
        await S.portSpeichern(s, neu({ needed_by: 'game/mods/voicechat-*.jar', optional: 'on' }));
        gleich(s.entwurf.ports[1], { purpose: 'voice', protocol: 'udp', assign: 'pool', required: false, needed_by: 'game/mods/voicechat-*.jar' });
        const nr = s.entwurf.werkbank.portnummern;
        assert.ok(Number.isInteger(nr.voice) && nr.voice !== nr.game, 'der neue Port hat keine eigene Nummer');
        assert.strictEqual(s.entwurf.werkbank.beobachtet.voice, undefined, 'ein von Hand angelegter Port gilt als beobachtet');
    });
    await pruefe('entfernen: nicht, solange Abfrage, Kopplung oder Fernsteuerung daran hängen', async () => {
        const s = frisch([UDP('game'), UDP('query', { assign: 'game+1' }), { purpose: 'rcon', protocol: 'tcp', assign: 'pool' }], { game: 7777, query: 7778, rcon: 7780 });
        // Beides liegt im Entwurf — die Fernsteuerung seit ihrer Karte (2026-10-08);
        // eine ältere Sitzung zieht `ordne` beim Laden nach.
        s.entwurf.management = { query: { protocol: 'a2s', port: 'query' }, rcon: { protocol: 'source', port: 'rcon' } };
        await assert.rejects(S.portEntfernen(s, 'game'), /Kopplung/);
        await assert.rejects(S.portEntfernen(s, 'query'), /die Abfrage/);
        await assert.rejects(S.portEntfernen(s, 'rcon'), /Fernsteuerung/);
        await S.abfrageEntfernen(s);
        await S.portEntfernen(s, 'query');
        await S.portEntfernen(s, 'game');
        assert.deepStrictEqual(s.entwurf.ports.map(p => p.purpose), ['rcon']);
        assert.deepStrictEqual(Object.keys(s.entwurf.werkbank.portnummern), ['rcon']);
        assert.strictEqual(s.entwurf.start.ready_when.port, undefined, 'die Bereitschaft zeigt noch auf den entfernten Port');
    });
    await pruefe('während ein Prüfdurchlauf läuft, ändert sich nichts', async () => {
        const s = frisch([UDP('game')], { game: 7777 });
        beschaeftigt = true;
        try {
            await assert.rejects(S.portSpeichern(s, alsFormular(UDP('game'))), /Prüfdurchlauf läuft/);
            await assert.rejects(S.abfrageSpeichern(s, { protocol: 'a2s', port: 'game' }), /Prüfdurchlauf läuft/);
            await assert.rejects(S.abfrageEntfernen(s), /Prüfdurchlauf läuft/);
        } finally { beschaeftigt = false; }
    });

    // ── 4) Abfrage ───────────────────────────────────────────────────────────
    console.log('\nAbfrage');
    await pruefe('die Kennungen sind die der Paketprüfung; belegbar ist genau, was fb-init selbst spricht', async () => {
        const liste = S.abfrageKennungen();
        const katalog = Object.keys(require('gamedig').games);
        assert.deepStrictEqual(liste.map(k => k.kennung).sort(), [...katalog, 'a2s'].sort());
        const von = (k) => liste.find(x => x.kennung === k);
        assert.strictEqual(von('valheim').belegbar, true);
        assert.strictEqual(von('minecraft').belegbar, false);
        assert.strictEqual(von('a2s').belegbar, true);
        // Dieselbe Liste, die der Daemon eingebaut hat (erzeuge-a2s-kennungen.js).
        const go = ohneKommentare(fs.readFileSync(path.join(DAEMON, 'internal/probe/kennungen_gen.go'), 'utf8'));
        const imDaemon = [...go.matchAll(/^\t"([a-z0-9_-]+)":\s+true,$/gm)].map(m => m[1]).sort();
        assert.ok(imDaemon.length > 50, 'die Liste des Daemons ist nicht lesbar');
        assert.deepStrictEqual(liste.filter(k => k.belegbar && k.kennung !== 'a2s').map(k => k.kennung).sort(), imDaemon);
    });
    await pruefe('speichern, der Schalter „erst bereit" und entfernen', async () => {
        const s = frisch([UDP('game'), UDP('query', { assign: 'game+1' })], { game: 7777, query: 7778 });
        await S.abfrageSpeichern(s, { protocol: 'Valheim', port: 'query', bereit: 'on' });
        gleich(s.entwurf.management, { query: { protocol: 'valheim', port: 'query' } });
        assert.strictEqual(s.entwurf.start.ready_when.query, true);
        gleich(S.abfrageStand(s), { query: { protocol: 'valheim', port: 'query' }, bereit: true, belegbar: true, bekannt: true });
        // Der Startteil kennt den Schalter nicht und lässt ihn beim Speichern stehen.
        assert.strictEqual(S.mischeStart(s.entwurf.start, { program: './spiel', ready_when: { port: 'game' } }).ready_when.query, true);
        await S.abfrageSpeichern(s, { protocol: 'valheim', port: 'query' });
        assert.ok(!('query' in s.entwurf.start.ready_when), 'der Schalter ist aus, steht aber noch im Startteil');
        await S.abfrageSpeichern(s, { protocol: 'valheim', port: 'query', bereit: 'on' });
        await S.abfrageEntfernen(s);
        assert.strictEqual(s.entwurf.management, undefined);
        assert.ok(!('query' in s.entwurf.start.ready_when), 'ohne Abfrage wartet die Bereitschaft noch auf sie');
    });
    await pruefe('abgewiesen: fremde Kennung, fremder Port, „erst bereit" ohne Bereitschaftsport', async () => {
        const s = frisch([UDP('game')], { game: 7777 });
        await assert.rejects(S.abfrageSpeichern(s, { protocol: 'source', port: 'game' }), /keine Kennung aus GameDigs Katalog/);
        await assert.rejects(S.abfrageSpeichern(s, { protocol: '', port: 'game' }), /keine Kennung/);
        await assert.rejects(S.abfrageSpeichern(s, { protocol: 'a2s', port: 'query' }), /Diesen Port gibt es im Entwurf nicht/);
        delete s.entwurf.start.ready_when.port;
        await assert.rejects(S.abfrageSpeichern(s, { protocol: 'a2s', port: 'game', bereit: 'on' }), /braucht im Startteil/);
        assert.strictEqual(s.entwurf.management, undefined, 'eine Ablehnung hat trotzdem geschrieben');
    });

    // ── 5) Was im Paket steht ────────────────────────────────────────────────
    console.log('\nIm Paket');
    const valheim = [...neueste.values()].find(p => p.management?.query && p.start?.ready_when?.query === true && Object.keys(p.management).length > 1);
    await pruefe('der Vermerk sagt, ob der Durchlauf die Abfrage belegt hat — und warum nicht', async () => {
        assert.ok(valheim, 'kein Paket mit Abfrage, Schalter und weiterer Verwaltung — der Vermerk wäre ungeprüft');
        const { entwurf, image, schritte } = S.entwurfAusPaket(valheim);
        entwurf.werkbank = { geoeffnet: { slug: valheim.identity.slug, version: valheim.identity.version, ziele: S.zieleAusPaket(valheim) } };
        const sitzung = { id: 1, kennung: 'wbprobe', entwurf, image };
        const liste = schritte.map(schritt => ({ status: 'uebernommen', schritt }));
        const geprueft = S.entwurfAlsPaket(sitzung, liste);
        const mit = (stufe, e = geprueft) => S.veroeffentlichungsPaket(sitzung, liste,
            { id: 5, status: 'gruen', entwurf: e, beendet_am: new Date(), ergebnis: { gruen: true, bereitschaft: stufe, image_digest: valheim.image.digest, einstellungen: [] } },
            'waechter', valheim.image).status.open;
        const zeile = (offen) => offen.filter(z => /^Abfrage \(/.test(z));
        assert.strictEqual(zeile(mit('query')).length, 1);
        assert.match(zeile(mit('query'))[0], /im Durchlauf #5 belegt/);
        assert.match(zeile(mit('port'))[0], /NICHT belegt — fb-init spricht dieses Protokoll nicht selbst/);
        const ohneSchalter = kopie(geprueft); delete ohneSchalter.start.ready_when.query;
        assert.match(zeile(mit('port', ohneSchalter))[0], /NICHT belegt — die Bereitschaft wartet nicht auf sie/);
        const ohneAbfrage = kopie(ohneSchalter); delete ohneAbfrage.management.query;
        assert.deepStrictEqual(zeile(mit('port', ohneAbfrage)), []);
        // „Unverändert übernommen" nennt von der Verwaltung nur noch, was keine Karte hat.
        const uebernommen = mit('query').find(z => /^Unverändert übernommen/.test(z));
        // Seit der Karte „Dateien und Spielstand" (2026-10-09) sind das auch `saves` und `persist`.
        const rest = Object.keys(valheim.management).filter(k => !S.EIGENE.management.includes(k));
        assert.ok(rest.length > 0, 'Valheim trägt nichts mehr ohne Karte — die Probe mässe nichts');
        assert.ok(uebernommen.includes(`management (${rest.join(', ')})`), uebernommen);
        assert.ok(!/management \([^)]*query/.test(uebernommen), 'die Abfrage steht noch unter „unverändert übernommen"');
        // Trägt die Verwaltung NUR die Abfrage, ist von ihr nichts unverändert übernommen.
        assert.deepStrictEqual(S.durchgereichteTeile({ management: { query: {} }, content: {} }), ['content']);
    });

    await pruefe('Sperre beim Neubau: zählt stückweise — eine eigene Abfrage ersetzt die Fernsteuerung des Bestands nicht', async () => {
        const alt = [...neueste.values()].find(p => p.management?.query && p.management?.rcon);
        assert.ok(alt, 'kein Paket mit Abfrage UND Fernsteuerung — die stückweise Sperre wäre ungeprüft');
        const slug = alt.identity.slug;
        erlaubt = (sql) => {
            if (/^SELECT pv\.version FROM package_versions pv JOIN packages p ON p\.id = pv\.package_id WHERE p\.slug = \?$/.test(sql.trim())) return [{ version: alt.identity.version }];
            if (/FROM packages pk\s+JOIN package_versions v ON v\.package_id = pk\.id/.test(sql)) return [{ paket_id: 1, slug, version: alt.identity.version, channel: 'test', fbpkg: JSON.stringify(alt) }];
            return null;
        };
        try {
            const gruen = (paket) => [{ id: 2, status: 'gruen', entwurf: paket, ergebnis: { image_digest: 'sha256:' + 'a'.repeat(64), image_tag: '2026.10', einstellungen: [] } }];
            const liste = alt.install.steps.map(schritt => ({ status: 'ok', schritt }));
            // Neu gebaut, MIT eigener Abfrage: `management` ist da, die Fernsteuerung fehlt trotzdem.
            const neu = { id: 2, kennung: 'wbneu', image: { ref: alt.image.ref, tag: alt.image.tag }, entwurf: {
                identity: { slug, name: slug, version: S.naechsteFassung(alt.identity.version) }, ports: alt.ports, start: alt.start,
                management: { query: alt.management.query } } };
            const st = await S.veroeffentlichungsStand(neu, liste, gruen(S.entwurfAlsPaket(neu, liste)));
            assert.ok(st.gruende.some(g => /management\.rcon/.test(g)), `die Fernsteuerung ginge unbemerkt verloren: ${st.gruende.join(' | ')}`);
            // Neu gebaut, OHNE Abfrage: Auch ein Stück mit Karte zählt, wenn die Sitzung das Paket nie geöffnet hat.
            const ohne = kopie(neu); delete ohne.entwurf.management;
            const st2 = await S.veroeffentlichungsStand(ohne, liste, gruen(S.entwurfAlsPaket(ohne, liste)));
            assert.ok(st2.gruende.some(g => /management\.query/.test(g)), 'die Abfrage ginge beim Neubau unbemerkt verloren');
            // Geöffnet und die Abfrage bewusst entfernt: erlaubt.
            const offen = S.entwurfAusPaket(alt);
            offen.entwurf.werkbank = { geoeffnet: { slug, version: alt.identity.version, ziele: S.zieleAusPaket(alt) } };
            const geoeffnet = { id: 3, kennung: 'wboffen', image: offen.image, entwurf: offen.entwurf };
            await S.abfrageEntfernen(geoeffnet);
            const st3 = await S.veroeffentlichungsStand(geoeffnet, liste, gruen(S.entwurfAlsPaket(geoeffnet, liste)));
            assert.deepStrictEqual(st3.gruende, [], 'eine geöffnete Sitzung darf ihre Abfrage entfernen');
        } finally { erlaubt = () => null; }
    });

    // ── 6) Karte und Routen ──────────────────────────────────────────────────
    console.log('\nKarte und Routen');
    await pruefe('die Karte steht in der Sitzung, ihre Wege verlangen das Baurecht', async () => {
        const ansicht = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'plugins/werkbank/dashboard/views/guild/werkbank-sitzung.ejs'), 'utf8'));
        for (const id of ['kartePorts', 'formPort', 'formAbfrage', 'abfrageKennungen']) assert.ok(ansicht.includes(`id="${id}"`), `„${id}" fehlt in der Ansicht`);
        for (const weg of ["hier + '/ports/speichern'", "hier + '/abfrage'", "hier + '/abfrage/entfernen'"]) assert.ok(ansicht.includes(weg), `die Ansicht ruft ${weg} nicht auf`);
        const router = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'plugins/werkbank/dashboard/routes/guild.router.js'), 'utf8'));
        for (const weg of ['/:kennung/ports/speichern', '/:kennung/abfrage', '/:kennung/abfrage/entfernen']) {
            assert.ok(router.includes(`router.post('${weg}', requirePermission('WERKBANK.BAUEN')`), `der Weg ${weg} fehlt oder verlangt das Baurecht nicht`);
        }
        // Offene Sitzungen aus der Zeit vor der Karte ziehen beim Laden nach — an der einen Stelle, an der geladen wird.
        const helfer = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'plugins/werkbank/dashboard/helpers/Sitzungen.js'), 'utf8'));
        assert.ok(/s\.entwurf = ordne\(json\(s\.entwurf, \{\}\)\);/.test(helfer), 'laden() ordnet den Entwurf nicht');
        assert.strictEqual((helfer.match(/SELECT \* FROM werkbank_sitzungen/g) || []).length, 1, 'es gibt eine zweite Stelle, die Sitzungen lädt — ordnet sie auch?');
        for (const k of ['abfrage: Sitzungen.abfrageStand(sitzung)', 'abfrageKennungen: Sitzungen.abfrageKennungen()', 'PORT: Sitzungen.PORT']) {
            assert.ok(router.includes(k), `die Ansicht bekommt „${k.split(':')[0]}" nicht`);
        }
    });

    console.log(`\n  · gesehen: ${Object.entries(gesehen).map(([k, n]) => `${n} ${k}`).join(', ')}`);
    console.log(fehler === 0 ? '\n✅ Ports und Abfrage: bearbeitbar, und unverändert bleibt unverändert\n' : `\n❌ ${fehler} Abweichung(en)\n`);
    process.exit(fehler === 0 ? 0 : 1);
})().catch((e) => { console.error('FEHLER:', e.message); process.exit(1); });
