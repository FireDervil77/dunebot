#!/usr/bin/env node
/**
 * Werkbank: Fälle je nach Einstellung (Stufe 9 S6, 2026-10-25).
 *
 * ── Was hier geprüft wird ───────────────────────────────────────────────────
 *
 * Windrose hat zwei Verbindungsarten, die sich ausschließen — P2P (kein Port,
 * Einladungscode) und Direktverbindung (Port, Adresse). Seit Stufe 9 sagt das
 * Paket es mit Fällen, und die Werkbank muss sie schreiben können:
 *
 *   Karte „Bereitschaft je nach Einstellung"  start.ready_when.cases
 *   Karte „Verbindungsangabe"                 connect (+ cases)
 *   Einstellungsformular                      settings[].applies_when
 *
 * Die Regeln (dieselben wie pruefeFaelle im Daemon, gesagt, wo getippt wird):
 * jeder Fall hängt an einer Einstellung des Entwurfs, hat eine bekannte
 * Bedingung und — wie der Grundfall — einen Port oder die begründete Ausnahme
 * samt Zeile. Ein Passwort ist nie eine Verbindungsangabe. Eine Einstellung,
 * an der ein Fall hängt, lässt sich nicht entfernen.
 *
 * Und die Probe jeder Karte: Ein Paket mit Fällen und Verbindungsangabe öffnet
 * sich (vorher hielt `connect` das Öffnen an) und ergibt eingeliefert DASSELBE
 * Paket — das auch das Schema annimmt. `connect` ändert den Fingerabdruck
 * nicht (wie die Hinweise), die Fälle der Bereitschaft schon.
 *
 *   node scripts/check-werkbank-faelle.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const Ajv = require('ajv');
const ejs = require('ejs');
const { ServiceManager } = require('dunebot-core');
const { ohneKommentare, ohneKommentareEjs } = require('./lib/quelltext');

const WURZEL = path.join(__dirname, '..');

// Die Attrappe kennt genau: das Schreiben des Entwurfs und die Fragen „läuft
// gerade etwas?". Alles andere ist ein Fehler.
ServiceManager.register('dbService', {
    query: async (sql) => {
        const t = sql.trim();
        if (/^UPDATE werkbank_sitzungen SET entwurf = \? WHERE id = \?$/.test(t)) return {};
        if (/FROM werkbank_pruefungen p JOIN werkbank_sitzungen s[\s\S]*p\.status = 'laeuft'/.test(t)) return [];
        if (/^SELECT id FROM werkbank_schritte WHERE sitzung_id = \? AND status = 'laeuft' LIMIT 1$/.test(t)) return [];
        if (/FROM werkbank_laeufe l JOIN werkbank_sitzungen s[\s\S]*l\.status <> 'beendet'/.test(t)) return [];
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
const kopie = (v) => JSON.parse(JSON.stringify(v));
const wirft = (tun, muster) => assert.rejects(tun, (e) => { assert.match(e.message, muster); return true; });
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), 'utf8');

// Ein Windrose-artiger Entwurf: P2P als Grundfall (ohne Port), Direktverbindung als Fall.
const ENTWURF = {
    identity: { slug: 'probe', name: 'Probe', version: '1.0.0' },
    ports: [{ purpose: 'game', protocol: 'udp', assign: 'pool' }],
    start: {
        program: 'R5/Binaries/Win64/WindroseServer-Win64-Shipping.exe',
        stop: { sequence: [{ step: 'sigterm', timeout_sec: 30 }, { step: 'sigkill', timeout_sec: 10 }] },
        ready_when: { without_port: 'P2P öffnet keinen Port', log_line: 'Registered', timeout_sec: 900 },
    },
    settings: [
        { key: 'use_direct_connection', type: 'boolean', role: 'owner', name: { de: 'Direktverbindung' }, default: false, takes_effect: 'restart',
          apply: [{ target: 'file', file: 'R5/ServerDescription.json', parser: 'json', path: 'UseDirectConnection' }] },
        { key: 'invite_code', type: 'text', role: 'player', name: { de: 'Einladungscode' }, takes_effect: 'restart',
          apply: [{ target: 'file', file: 'R5/ServerDescription.json', parser: 'json', path: 'InviteCode' }] },
        { key: 'password', type: 'password', role: 'player', name: { de: 'Passwort' }, takes_effect: 'restart',
          apply: [{ target: 'file', file: 'R5/ServerDescription.json', parser: 'json', path: 'Password' }] },
    ],
};
const sitzung = (entwurf = ENTWURF) => ({ id: 1, kennung: 'probe', image: { ref: 'fb/proton', tag: '2026.10-GE-Proton11-9' }, entwurf: kopie(entwurf) });
const bed = (key, art, wert = '') => ({ bedingung_key: key, bedingung_art: art, bedingung_wert: wert });
const DIREKT = { ...bed('use_direct_connection', 'true'), port: 'game', log_line: '', timeout_sec: '', without_port: '', query: '' };


(async () => {
    console.log('\nBereitschaft je nach Einstellung');

    await pruefe('ein Fall mit Port wird gespeichert; Frist und Abfrage nur, wenn gesetzt', async () => {
        const s = sitzung();
        await S.bereitFallSpeichern(s, DIREKT);
        assert.deepStrictEqual(s.entwurf.start.ready_when.cases, [{ from: 'setting:use_direct_connection', when: 'true', port: 'game' }]);
        await S.bereitFallSpeichern(s, { ...DIREKT, nr: '0', timeout_sec: '600', query: 'aus' });
        assert.deepStrictEqual(s.entwurf.start.ready_when.cases[0], { from: 'setting:use_direct_connection', when: 'true', port: 'game', query: false, timeout_sec: 600 });
        // Der Grundfall bleibt, wie er war.
        assert.strictEqual(s.entwurf.start.ready_when.without_port, 'P2P öffnet keinen Port');
    });

    await pruefe('Portpflicht und Verweise — laut, wo getippt wird', async () => {
        const s = sitzung();
        await wirft(() => S.bereitFallSpeichern(s, { ...DIREKT, port: '' }), /Portpflicht/);
        await wirft(() => S.bereitFallSpeichern(s, { ...DIREKT, port: 'query' }), /Port „query" belegt der Entwurf nicht/);
        await wirft(() => S.bereitFallSpeichern(s, { ...DIREKT, without_port: 'weil' }), /gilt nur ohne Port/);
        await wirft(() => S.bereitFallSpeichern(s, { ...DIREKT, port: '', without_port: 'weil' }), /Zeile angeben/);
        await wirft(() => S.bereitFallSpeichern(s, { ...DIREKT, bedingung_key: '' }), /hängt an einer Einstellung/);
        await wirft(() => S.bereitFallSpeichern(s, { ...DIREKT, bedingung_key: 'gibtsnicht' }), /„gibtsnicht" gibt es im Entwurf nicht/);
        await wirft(() => S.bereitFallSpeichern(s, { ...DIREKT, bedingung_art: '=' }), /braucht einen Wert/);
        await wirft(() => S.bereitFallSpeichern(s, { ...DIREKT, bedingung_art: 'vielleicht' }), /wenn an/);
        const ohneGrund = sitzung({ ...ENTWURF, start: { ...ENTWURF.start, ready_when: undefined } });
        await wirft(() => S.bereitFallSpeichern(ohneGrund, DIREKT), /Erst den Grundfall/);
    });

    await pruefe('ohne Port mit mehreren Zeilen; gleich/ungleich mit Liste; ↑ stellt um; Entfernen räumt die Liste ab', async () => {
        const s = sitzung();
        await S.bereitFallSpeichern(s, { ...bed('invite_code', '!=', ' a , b '), port: '', log_line: 'eins\nzwei', without_port: 'kein Port' });
        await S.bereitFallSpeichern(s, DIREKT);
        assert.deepStrictEqual(s.entwurf.start.ready_when.cases[0], { from: 'setting:invite_code', when: '!=a,b', log_line: ['eins', 'zwei'], without_port: 'kein Port' });
        await S.bereitFallAendern(s, '1', 'hoch');
        assert.strictEqual(s.entwurf.start.ready_when.cases[0].port, 'game', 'der erste passende Fall gilt — die Reihenfolge muss sich stellen lassen');
        await S.bereitFallAendern(s, '0', 'entfernen');
        await S.bereitFallAendern(s, '0', 'entfernen');
        assert.ok(!('cases' in s.entwurf.start.ready_when), 'leere Liste bleibt stehen');
        await wirft(() => S.bereitFallAendern(s, '0', 'entfernen'), /gibt es nicht mehr/);
    });

    console.log('\nVerbindungsangabe');

    await pruefe('Grundfall, dann ein Fall; der Grundfall behält beim Speichern seine Fälle', async () => {
        const s = sitzung();
        await S.verbindungSpeichern(s, { show: 'setting:invite_code', label_de: 'Einladungscode', hint_de: 'Im Spiel unter „Beitreten".', hint_en: '' });
        await S.verbindungFallSpeichern(s, { ...bed('use_direct_connection', 'true'), show: 'address', label_de: 'Adresse' });
        await S.verbindungSpeichern(s, { show: 'setting:invite_code', label_de: 'Code' });
        assert.deepStrictEqual(s.entwurf.connect, {
            show: 'setting:invite_code', label: { de: 'Code' },
            cases: [{ from: 'setting:use_direct_connection', when: 'true', show: 'address', label: { de: 'Adresse' } }],
        });
        const stand = S.verbindungStand(s);
        assert.strictEqual(stand.faelle[0].wenn, '„Direktverbindung" an ist');
        assert.ok(!stand.zeigbar.some(z => z.wert === 'setting:password'), 'ein Passwort steht zur Wahl');
        await S.verbindungEntfernen(s);
        assert.ok(!('connect' in s.entwurf));
    });

    await pruefe('nie ein Passwort; Fälle erst mit Grundfall; Bedingung muss passen', async () => {
        const s = sitzung();
        await wirft(() => S.verbindungSpeichern(s, { show: 'setting:password' }), /Passwort ist keine Verbindungsangabe/);
        await wirft(() => S.verbindungSpeichern(s, { show: 'setting:gibtsnicht' }), /gibt es im Entwurf nicht/);
        await wirft(() => S.verbindungFallSpeichern(s, { ...bed('use_direct_connection', 'true'), show: 'address' }), /Erst den Grundfall/);
        await S.verbindungSpeichern(s, { show: 'address' });
        await wirft(() => S.verbindungFallSpeichern(s, { show: 'address' }), /hängt an einer Einstellung/);
        await wirft(() => S.verbindungSpeichern(s, { show: 'address', label_de: 'x'.repeat(61) }), /höchstens 60/);
    });

    console.log('\nWirkt nur, wenn …');

    const formular = (mehr) => ({ key: 'invite_code', name_de: 'Einladungscode', type: 'text', role: 'player', takes_effect: 'restart',
        apply: [{ target: 'file', file: 'R5/ServerDescription.json', parser: 'json', path: 'InviteCode' }], ...mehr });

    await pruefe('Formular schreibt applies_when; leer = immer; nie an sich selbst; Bezug muss es geben', async () => {
        const e = S.einstellungAusFormular(formular({ wirkt_key: 'use_direct_connection', wirkt_art: 'false' }));
        assert.deepStrictEqual(e.applies_when, { from: 'setting:use_direct_connection', when: 'false' });
        assert.ok(!('applies_when' in S.einstellungAusFormular(formular({ wirkt_key: '' }))));
        assert.throws(() => S.einstellungAusFormular(formular({ wirkt_key: 'invite_code', wirkt_art: 'true' })), /an sich selbst/);
        const s = sitzung();
        await S.einstellungSpeichern(s, { ...formular({ wirkt_key: 'use_direct_connection', wirkt_art: 'false' }), alt: 'invite_code' });
        assert.deepStrictEqual(s.entwurf.settings.find(x => x.key === 'invite_code').applies_when, { from: 'setting:use_direct_connection', when: 'false' });
        await wirft(() => S.einstellungSpeichern(s, { ...formular({ wirkt_key: 'gibtsnicht', wirkt_art: 'true' }), alt: 'invite_code' }), /gibt es im Entwurf nicht/);
        // Ohne die Felder im Formular wird eine vorhandene Bedingung geleert (EINSTELLUNG_FELDER), nicht still behalten.
        await S.einstellungSpeichern(s, { ...formular({}), alt: 'invite_code' });
        assert.ok(!('applies_when' in s.entwurf.settings.find(x => x.key === 'invite_code')));
    });

    await pruefe('eine Einstellung, an der ein Fall hängt, lässt sich nicht entfernen', async () => {
        const s = sitzung();
        await S.bereitFallSpeichern(s, DIREKT);
        await wirft(() => S.einstellungEntfernen(s, 'use_direct_connection'), /Bereitschaft je nach Einstellung/);
        const v = sitzung();
        await S.verbindungSpeichern(v, { show: 'setting:invite_code' });
        await wirft(() => S.einstellungEntfernen(v, 'invite_code'), /Verbindungsangabe \(zeigt sie\)/);
        await S.einstellungEntfernen(v, 'password');
    });

    console.log('\nÖffnen, Einliefern, Fingerabdruck, Schema');

    const PAKET = (() => {
        const s = sitzung();
        const p = S.entwurfAlsPaket(s, []);
        p.install = { steps: [{ type: 'steamcmd', app: 4129620 }] };
        p.start.ready_when.cases = [{ from: 'setting:use_direct_connection', when: 'true', port: 'game' }];
        p.connect = { show: 'setting:invite_code', cases: [{ from: 'setting:use_direct_connection', when: 'true', show: 'address' }] };
        p.settings.find(x => x.key === 'invite_code').applies_when = { from: 'setting:use_direct_connection', when: 'false' };
        return p;
    })();

    await pruefe('ein Paket mit connect öffnet sich (vorher: „Teile, die die Werkbank weder bearbeiten noch durchreichen kann")', async () => {
        const { rest, entwurf } = S.entwurfAusPaket(PAKET);
        assert.deepStrictEqual(rest, []);
        assert.deepStrictEqual(entwurf.connect, PAKET.connect);
    });

    await pruefe('geöffnet und wieder eingeliefert ergibt es dasselbe Paket — und das Schema nimmt es an', async () => {
        const { entwurf, schritte } = S.entwurfAusPaket(PAKET);
        const s = { ...sitzung(entwurf), entwurf: { ...entwurf, identity: PAKET.identity } };
        const zurueck = S.entwurfAlsPaket(s, schritte.map(x => ({ status: 'ok', schritt: x })));
        for (const teil of ['connect', 'start', 'settings', 'ports', 'install']) assert.deepStrictEqual(zurueck[teil], PAKET[teil], teil);
        const schema = JSON.parse(lies('packages/fbpkg/schema/fbpkg-v1.schema.json'));
        const gilt = new Ajv({ allErrors: true, jsonPointers: true }).compile(schema);
        // Digest und Status setzt erst das Veröffentlichen — hier nachgetragen,
        // damit das Schema den Rest prüft.
        const fertig = { ...zurueck, image: { ...zurueck.image, digest: 'sha256:' + '0'.repeat(64) }, status: { complete: true, open: [] } };
        assert.ok(gilt(fertig), JSON.stringify(gilt.errors && gilt.errors.slice(0, 3)));
    });

    await pruefe('connect ändert den Fingerabdruck nicht (wie Hinweise), ein Bereitschaftsfall schon', async () => {
        const ohne = kopie(PAKET); delete ohne.connect;
        assert.strictEqual(S.fingerabdruck(ohne), S.fingerabdruck(PAKET));
        const ohneFall = kopie(PAKET); delete ohneFall.start.ready_when.cases;
        assert.notStrictEqual(S.fingerabdruck(ohneFall), S.fingerabdruck(PAKET));
    });

    await pruefe('vor dem Durchlauf: Verweise ins Leere werden genannt', async () => {
        assert.deepStrictEqual(S.faelleMaengel(PAKET), []);
        const kaputt = kopie(PAKET);
        kaputt.settings = kaputt.settings.filter(x => x.key !== 'use_direct_connection');
        kaputt.start.ready_when.cases[0].port = 'query';
        const m = S.faelleMaengel(kaputt).join(' | ');
        assert.match(m, /Bereitschaft, Fall 1 hängt an „use_direct_connection"/);
        assert.match(m, /Port „query" belegt der Entwurf nicht/);
        assert.match(m, /Verbindungsangabe, Fall 1 hängt an/);
        assert.match(m, /„Wirkt nur, wenn" an „invite_code"/);
        assert.match(ohneKommentare(lies('plugins/werkbank/dashboard/helpers/Sitzungen.js')), /m\.push\(\.\.\.faelleMaengel\(paket\)\);/);
    });

    console.log('\nAnsicht und Wege');

    await pruefe('die Bedingungsfelder zeichnen sich mit den Namen, die der Server einsammelt', async () => {
        const html = await ejs.renderFile(path.join(WURZEL, 'plugins/werkbank/dashboard/views/guild/werkbank-bedingung.ejs'),
            { vorsilbe: 'wirkt', titel: 'Wirkt nur, wenn', einstellungen: ENTWURF.settings, leer: '— immer —' });
        for (const n of ['wirkt_key', 'wirkt_art', 'wirkt_wert']) assert.match(html, new RegExp(`name="${n}"`));
        assert.match(html, /<option value="use_direct_connection">Direktverbindung \(use_direct_connection\)<\/option>/);
        for (const a of S.FALL.arten) assert.match(html, new RegExp(`<option value="${a.replace('!', '\\!')}">`));
    });

    await pruefe('Karten tragen Formulare und Knöpfe, die das Skript anspricht; Routen gibt es', async () => {
        const v = ohneKommentareEjs(lies('plugins/werkbank/dashboard/views/guild/werkbank-sitzung.ejs'));
        assert.match(v, /id="karteBereitFaelle"[\s\S]*id="formBereitFall"[\s\S]*include\('werkbank-bedingung', \{ vorsilbe: 'bedingung'/);
        assert.match(v, /id="karteVerbindung"[\s\S]*id="formVerbindung"[\s\S]*id="formVerbindungsFall"/);
        assert.match(v, /include\('werkbank-bedingung', \{ vorsilbe: 'wirkt'/);
        assert.match(v, /bedingungFuellen\(formE, 'wirkt', e\.applies_when\);/);
        assert.match(v, /form: 'formBereitFall', marke: 'bereitfall', pfad: '\/bereit-faelle'/);
        assert.match(v, /form: 'formVerbindungsFall', marke: 'verbindungsfall', pfad: '\/verbindung\/faelle'/);
        assert.match(v, /data-bereitfall-bearbeiten=/);
        assert.match(v, /data-verbindungsfall-hoch=/);
        const r = ohneKommentare(lies('plugins/werkbank/dashboard/routes/guild.router.js'));
        for (const pfad of ['/:kennung/bereit-faelle', '/:kennung/bereit-faelle/:nr/:was', '/:kennung/verbindung', '/:kennung/verbindung/entfernen',
            '/:kennung/verbindung/faelle', '/:kennung/verbindung/faelle/:nr/:was']) {
            assert.ok(r.includes(`router.post('${pfad}', requirePermission('WERKBANK.BAUEN')`), pfad);
        }
        assert.ok(!/:was\(/.test(r), 'Muster im Pfad — Express 5 wirft beim Laden');
    });

    console.log(fehler ? `\n✗ ${fehler} Prüfung(en) rot` : '\n✅ Werkbank: Fälle, Verbindungsangabe und „wirkt nur, wenn" schreiben sich wie das Paket sie liest');
    process.exit(fehler ? 1 : 0);
})();
