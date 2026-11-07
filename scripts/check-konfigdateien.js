#!/usr/bin/env node
/**
 * Bereich „Konfiguration" (Baustelle 215, 2026-11-01): `files.config_files`.
 *
 * Geprüft wird die Kette vom Formular der Werkbank bis zur Liste im Panel:
 *
 *   - Die Werkbank nimmt nur Pfade unter game/ oder data/ an, nichts Gesperrtes.
 *   - Schema und Werkbank sind sich beim Pfad einig.
 *   - Die Liste aus der Karte steht im Paket, das eingeliefert wird. Sie stand
 *     dort nicht, und niemand sagte es: Die Karte las den Entwurf, das Paket
 *     nahm aus `files` nur, was `EIGENE` nennt. ET Legacy 1.1.8 ging so ohne
 *     seine Dateien hinaus (2026-11-01).
 *   - Sie gehört nicht zum Geprüften und ändert den Fingerabdruck nicht.
 *   - Der Stand trennt: vorhanden, fehlt, nicht lesbar, gesperrt. Ein Ordner, den
 *     der Daemon nicht lesen konnte, ist kein leerer.
 *   - Was das Panel beim Start setzt, steht an der Datei.
 *   - Der Bereich liest und schreibt nur über die Routen des Dateimanagers.
 *
 * Geschrieben wird nichts.
 *
 *   node scripts/check-konfigdateien.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const WURZEL = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(WURZEL, 'apps/dashboard/.env'), quiet: true });
const Ajv = require('ajv');
const { ServiceManager } = require('dunebot-core');
const { ohneKommentare, ohneKommentareEjs } = require('./lib/quelltext');

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
const S = require('../plugins/werkbank/dashboard/helpers/Sitzungen');
const K = require('../plugins/gameserver/dashboard/helpers/Konfigdateien');

let fehler = 0;
async function pruefe(was, tun) {
    try { await tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').join('\n      ')}`); }
}
const lies = (...t) => fs.readFileSync(path.join(WURZEL, ...t), 'utf8');
const frisch = (files) => ({ id: 1, kennung: 'wbtest', status: 'offen', entwurf: { files, werkbank: {} } });

/** Ein Daemon als Attrappe: je Ordner eine Antwort. */
function daemon(ordner, dateien = {}) {
    const fragen = [];
    require('../plugins/gameserver/dashboard/helpers/Abruf').lies = async (_rootserver, _server, pfad) => {
        if (dateien[pfad] === undefined) throw new Error('nicht lesbar');
        return Buffer.from(dateien[pfad]);
    };
    return {
        fragen,
        sendCommand: async (id, befehl, nutzlast) => {
            assert.strictEqual(befehl, 'gameserver.files.list');
            fragen.push(nutzlast.path);
            const a = ordner[nutzlast.path];
            if (a instanceof Error) throw a;
            return a ? { success: true, data: { files: a } } : { success: false, error: 'verzeichnis nicht gefunden: x' };
        },
    };
}
const SERVER = { id: 7, rootserver_id: 55, daemon_id: 'd', install_path: '/x' };

(async () => {
    console.log('Werkbank');
    await pruefe('speichern, bearbeiten, entfernen — und was das Formular nicht kennt, bleibt', async () => {
        const s = frisch({ denylist: ['bin'] });
        await S.konfigdateiSpeichern(s, { path: 'game/etmain/mapvotecycle.cfg', group: 'maps', name_de: 'Kartenwahl', name_en: 'Map vote', beschreibung_de: 'Karten', beschreibung_en: '' });
        assert.deepStrictEqual(s.entwurf.files.config_files, [
            { path: 'game/etmain/mapvotecycle.cfg', group: 'maps', name: { de: 'Kartenwahl', en: 'Map vote' }, description: { de: 'Karten' } }]);
        s.entwurf.files.config_files[0].fremd = 1;
        await S.konfigdateiSpeichern(s, { alt: 'game/etmain/mapvotecycle.cfg', path: 'game/etmain/maps.cfg', group: 'votes' });
        assert.deepStrictEqual(s.entwurf.files.config_files, [{ path: 'game/etmain/maps.cfg', group: 'votes', fremd: 1 }]);
        await S.konfigdateiEntfernen(s, { path: 'game/etmain/maps.cfg' });
        assert.deepStrictEqual(s.entwurf.files, { denylist: ['bin'] }, 'die übrigen Dateiangaben sind weg');
    });
    await pruefe('Unsinn wird abgewiesen, ohne zu schreiben', async () => {
        const s = frisch({ denylist: ['game/bin'] });
        const f = (mehr) => ({ path: 'game/a.cfg', group: 'server', ...mehr });
        await assert.rejects(S.konfigdateiSpeichern(s, f({ path: 'etc/passwd' })), /game\/… oder data/);
        await assert.rejects(S.konfigdateiSpeichern(s, f({ path: 'game/../x' })), /game\/… oder data/);
        await assert.rejects(S.konfigdateiSpeichern(s, f({ path: 'game/*/x.cfg' })), /game\/… oder data/);
        await assert.rejects(S.konfigdateiSpeichern(s, f({ group: 'gibtsnicht' })), /Gruppe/);
        await assert.rejects(S.konfigdateiSpeichern(s, f({ path: 'game/bin/x.cfg' })), /Sperrliste/);
        await S.konfigdateiSpeichern(s, f());
        await assert.rejects(S.konfigdateiSpeichern(s, f()), /schon in der Liste/);
        await assert.rejects(S.konfigdateiEntfernen(s, { path: 'gibtsnicht' }), /gibt es im Entwurf nicht/);
        assert.strictEqual(s.entwurf.files.config_files.length, 1);
    });
    await pruefe('Schema und Werkbank meinen denselben Pfad', async () => {
        const schema = JSON.parse(lies('packages/fbpkg/schema/fbpkg-v1.schema.json'));
        const re = new RegExp(schema.properties.files.properties.config_files.items.properties.path.pattern);
        for (const p of ['game/a.cfg', 'game/etmain/*.cfg', 'data/.etlegacy/legacy/etconfig_server.cfg']) {
            assert.ok(re.test(p) && K.RE_PFAD.test(p), `abgelehnt: ${p}`);
        }
        for (const p of ['a.cfg', '/game/a.cfg', 'game/../a', 'game/*/a.cfg', 'game/', 'game\\a']) {
            assert.ok(!re.test(p) && !K.RE_PFAD.test(p), `angenommen: ${p}`);
        }
        const ajv = new Ajv({ allErrors: true });
        ajv.addSchema(schema, 'fbpkg');
        const gruppen = schema.properties.files.properties.config_files.items.properties.group.enum;
        assert.deepStrictEqual(gruppen, Object.keys(K.GRUPPEN), 'die Gruppen im Schema und im Panel laufen auseinander');
    });

    console.log('\nVom Entwurf ins Paket');
    const LISTE = [{ path: 'game/etmain/mapvotecycle.cfg', group: 'votes', description: { de: 'Abstimmung' } }];
    const sitzungMit = (config_files) => ({
        id: 1, kennung: 'wbtest', status: 'offen', image: 'fb/quake:latest',
        entwurf: { identity: { slug: 'et', version: '1.1.9' }, files: { public: ['etmain/*.pk3'], ...(config_files ? { config_files } : {}) }, werkbank: {} },
    });
    const durchlauf = (sitzung) => ({
        id: 9, entwurf: S.entwurfAlsPaket(sitzung, []), beendet_am: '2026-11-01 12:14:39',
        ergebnis: { image_digest: `sha256:${'a'.repeat(64)}`, image_tag: '2026.11', bereitschaft: 'query' },
    });
    await pruefe('die Liste aus der Karte steht im Paket, neben den übrigen Dateiangaben', async () => {
        const paket = S.entwurfAlsPaket(sitzungMit(LISTE), []);
        assert.deepStrictEqual(paket.files, { public: ['etmain/*.pk3'], config_files: LISTE });
    });
    await pruefe('die Liste zählt nicht zum Geprüften: ein grüner Durchlauf bleibt gültig', async () => {
        assert.strictEqual(S.fingerabdruck(S.entwurfAlsPaket(sitzungMit(LISTE), [])), S.fingerabdruck(S.entwurfAlsPaket(sitzungMit(null), [])));
        const ohneSonstiges = { start: null, files: { config_files: LISTE } };
        assert.strictEqual(S.fingerabdruck(ohneSonstiges), S.fingerabdruck({ start: null }), 'ein leeres `files` änderte den Fingerabdruck');
        const andereFreigabe = sitzungMit(LISTE);
        andereFreigabe.entwurf.files.public = ['etmain/*.txt'];
        assert.notStrictEqual(S.fingerabdruck(S.entwurfAlsPaket(andereFreigabe, [])), S.fingerabdruck(S.entwurfAlsPaket(sitzungMit(LISTE), [])),
            '`files.public` muss weiter zählen');
    });
    await pruefe('eingeliefert wird die Liste von jetzt, nicht die des Durchlaufs', async () => {
        const nachher = S.veroeffentlichungsPaket(sitzungMit(LISTE), [], durchlauf(sitzungMit(null)), 'waechter');
        assert.deepStrictEqual(nachher.files, { public: ['etmain/*.pk3'], config_files: LISTE }, 'nach dem Durchlauf eingetragen');
        const weg = S.veroeffentlichungsPaket(sitzungMit(null), [], durchlauf(sitzungMit(LISTE)), 'waechter');
        assert.deepStrictEqual(weg.files, { public: ['etmain/*.pk3'] }, 'nach dem Durchlauf entfernt');
        const frischeSitzung = { ...sitzungMit(LISTE), entwurf: { identity: { slug: 'et', version: '1.1.9' }, files: { config_files: LISTE }, werkbank: {} } };
        const nurListe = S.veroeffentlichungsPaket(frischeSitzung, [], durchlauf(frischeSitzung), 'waechter');
        assert.deepStrictEqual(nurListe.files, { config_files: LISTE }, 'ein Paket ohne weitere Dateiangaben');
    });
    await pruefe('beim Öffnen kommt die Liste in der Karte an und bleibt beim Zusammensetzen dieselbe', async () => {
        const { entwurf } = S.entwurfAusPaket({ identity: { slug: 'et', version: '1.1.9' }, files: { public: ['etmain/*.pk3'], config_files: LISTE } });
        assert.deepStrictEqual(entwurf.files.config_files, LISTE, 'die Karte liest aus entwurf.files');
        assert.strictEqual(entwurf.durchgereicht?.files, undefined);
        assert.deepStrictEqual(S.entwurfAlsPaket({ image: 'fb/quake:latest', entwurf }, []).files.config_files, LISTE);
    });

    console.log('\nStand im Panel');
    const PAKET = {
        settings: [{ key: 'name', apply: [{ target: 'file', file: 'etmain/etl_server.cfg', path: 'sv_hostname' }] }],
        config: [{ file: 'etmain/etl_server.cfg', set: { net_port: '{{port:game}}' } }],
        files: { config_files: [
            { path: 'game/etmain/etl_server.cfg', group: 'server', name: { de: 'Serverdatei' } },
            { path: 'game/etmain/mapvotecycle.cfg', group: 'maps', description: { en: 'Maps' } },
            { path: 'game/etmain/vote_*.cfg', group: 'votes', name: { de: 'wird nicht genutzt' } },
            { path: 'data/.etlegacy/legacy/etconfig_server.cfg', group: 'server' },
        ] },
    };
    await pruefe('vorhanden, fehlt, Muster und die Schlüssel des Panels; je Ordner eine Frage', async () => {
        const d = daemon({
            '/game/etmain': [{ name: 'etl_server.cfg' }, { name: 'vote_a.cfg' }, { name: 'vote_b.cfg' }, { name: 'vote_x', is_dir: true }],
            '/data/.etlegacy/legacy': [{ name: 'etconfig_server.cfg' }],
        });
        const g = await K.stand({ server: SERVER, paket: PAKET, ipmServer: d });
        assert.deepStrictEqual(g.map(x => x.key), ['server', 'votes', 'maps'], 'Reihenfolge der Gruppen');
        assert.deepStrictEqual(d.fragen.sort(), ['/data/.etlegacy/legacy', '/game/etmain']);
        const [server, votes, maps] = g;
        assert.strictEqual(server.dateien[0].pfad, '/game/etmain/etl_server.cfg');
        assert.strictEqual(server.dateien[0].name, 'Serverdatei');
        assert.deepStrictEqual(server.dateien[0].panelSchluessel, ['net_port', 'sv_hostname']);
        assert.deepStrictEqual(server.dateien[1].panelSchluessel, [], 'unter data/ setzt das Panel nichts');
        assert.deepStrictEqual(votes.dateien.map(z => z.name), ['vote_a.cfg', 'vote_b.cfg'], 'ein Muster zeigt die Dateien, nicht den einen Namen');
        assert.strictEqual(maps.dateien[0].vorhanden, false);
        assert.strictEqual(maps.dateien[0].beschreibung, 'Maps');
    });
    await pruefe('ein Ordner, den der Daemon nicht liest, ist kein leerer — und ein fehlender schon', async () => {
        const nurEine = { files: { config_files: [{ path: 'game/a/b.cfg', group: 'server' }] } };
        const kaputt = await K.stand({ server: SERVER, paket: nurEine, ipmServer: daemon({ '/game/a': new Error('Zeitüberschreitung') }) });
        assert.match(kaputt[0].dateien[0].fehler, /Zeitüberschreitung/);
        const leer = await K.stand({ server: SERVER, paket: nurEine, ipmServer: daemon({}) });
        assert.strictEqual(leer[0].dateien[0].fehler, undefined);
        assert.strictEqual(leer[0].dateien[0].vorhanden, false);
    });
    await pruefe('Gesperrtes wird gesagt; ohne Paket keine Gruppe', async () => {
        const g = await K.stand({ server: SERVER, paket: { files: { config_files: [{ path: 'game/a.cfg', group: 'other' }] } },
            ipmServer: daemon({ '/game': [{ name: 'a.cfg' }] }), sperrliste: ['game/a.cfg'] });
        assert.strictEqual(g[0].dateien[0].gesperrt, true);
        assert.deepStrictEqual(await K.stand({ server: SERVER, paket: null, ipmServer: daemon({}) }), []);
    });

    console.log('\nexec');
    await pruefe('Verweise: Kommentare zählen nicht, ohne Endung ist .cfg gemeint', async () => {
        assert.deepStrictEqual(K.execVerweise('exec a.cfg\n  exec "b.cfg" // x\n//exec c.cfg\nexec d\nexec a.cfg\nvstr exec'), ['a.cfg', 'b.cfg', 'd.cfg']);
        const s = K.cfgSchluessel('set G_a "1"\nhostname "x"\n// sv_x 1\nseta b 2');
        assert.ok(s.has('g_a') && s.has('hostname') && s.has('b') && !s.has('sv_x'));
    });
    await pruefe('die geladene Datei steht unter der ladenden, mit Warnung — fehlende bleiben sichtbar, Kreise enden', async () => {
        const paket = {
            settings: [{ key: 'name', apply: [{ target: 'file', file: 'etmain/etl_server.cfg', path: 'sv_hostname' }] }],
            files: { config_files: [{ path: 'game/etmain/etl_server.cfg', group: 'server' }] },
        };
        const d = daemon({ '/game/etmain': [{ name: 'etl_server.cfg' }, { name: 'extra.cfg' }, { name: 'tief.cfg' }] }, {
            '/game/etmain/etl_server.cfg': 'set sv_hostname "a"\nexec extra.cfg\nexec fehlt.cfg',
            '/game/etmain/extra.cfg': 'set SV_HOSTNAME "b"\nexec tief.cfg\nexec etl_server.cfg',
            '/game/etmain/tief.cfg': 'set g_x 1\nexec extra.cfg',
        });
        const [g] = await K.stand({ server: SERVER, paket, ipmServer: d });
        assert.deepStrictEqual(g.dateien.map(z => z.datei).sort(), ['etl_server.cfg', 'extra.cfg', 'fehlt.cfg', 'tief.cfg']);
        const nach = Object.fromEntries(g.dateien.map(z => [z.datei, z]));
        assert.deepStrictEqual(nach['extra.cfg'].ueberschreibt, ['sv_hostname'], 'die Überschreibung bleibt ungesagt');
        assert.strictEqual(nach['extra.cfg'].geladenVon, 'etl_server.cfg');
        assert.strictEqual(nach['tief.cfg'].geladenVon, 'extra.cfg');
        assert.strictEqual(nach['fehlt.cfg'].vorhanden, false);
        assert.strictEqual(g.dateien[0].datei, 'etl_server.cfg');
    });
    await pruefe('nur .cfg wird gelesen; eine nicht lesbare Datei wird gesagt, kein Weg führt aus dem Spiel', async () => {
        const nurTxt = { files: { config_files: [{ path: 'game/a.txt', group: 'server' }] } };
        const lesen = daemon({ '/game': [{ name: 'a.txt' }] });
        await K.stand({ server: SERVER, paket: nurTxt, ipmServer: lesen });
        const cfg = { files: { config_files: [{ path: 'game/a.cfg', group: 'server' }] } };
        const [g] = await K.stand({ server: SERVER, paket: cfg, ipmServer: daemon({ '/game': [{ name: 'a.cfg' }] }) });
        assert.strictEqual(g.dateien[0].execOffen, true);
        const [h] = await K.stand({ server: SERVER, paket: cfg, ipmServer: daemon({ '/game': [{ name: 'a.cfg' }] }, { '/game/a.cfg': 'exec ../../etc/passwd' }) });
        assert.strictEqual(h.dateien.length, 1, 'exec führte aus dem Volume heraus');
    });

    console.log('\nVerdrahtung');
    await pruefe('der Bereich erscheint nur mit Dateien und läuft über die Rechte des Dateimanagers', async () => {
        const routen = ohneKommentare(lies('plugins/gameserver/dashboard/routes/servers.js'));
        assert.match(routen, /if \(hatKonfigdateien\) BEREICHE\.konfiguration = /);
        const files = ohneKommentare(lies('plugins/gameserver/dashboard/routes/files.js'));
        assert.match(files, /'\/servers\/:serverId\/konfiguration', requirePermission\('GAMESERVER\.FILES\.VIEW'\)/);
        const seite = ohneKommentareEjs(lies('plugins/gameserver/dashboard/views/guild/server-detail.ejs'));
        assert.match(seite, /locals\.hatKonfigdateien \? \[\['konfiguration', 'Konfiguration'\]\]/);
        assert.match(seite, /include\('partials\/server-detail-konfiguration'/);
    });
    await pruefe('Dateimanager und Bereich teilen ein Editor-Fenster, der Bereich setzt nichts als Text-HTML', async () => {
        for (const d of ['server-detail-files.ejs', 'server-detail-konfiguration.ejs']) {
            assert.match(ohneKommentareEjs(lies('plugins/gameserver/dashboard/views/guild/partials', d)), /include\('server-detail-editor', \{ canManage \}\)/, d);
            assert.ok(!ohneKommentareEjs(lies('plugins/gameserver/dashboard/views/guild/partials', d)).includes('id="monaco-editor"'), `${d} trägt ein eigenes Fenster`);
        }
        const bereich = ohneKommentareEjs(lies('plugins/gameserver/dashboard/views/guild/partials/server-detail-konfiguration.ejs'));
        assert.doesNotMatch(bereich, /innerHTML/, 'Namen kommen aus Paketen und vom Daemon');
        assert.match(bereich, /nurEditor: true/);
        const fm = ohneKommentare(lies('plugins/gameserver/dashboard/assets/js/file-manager.js'));
        assert.match(fm, /if \(!this\.config\.nurEditor\) await this\.navigateTo\('\/'\)/, 'ohne Dateiliste liefe navigateTo gegen fehlende Elemente');
        assert.match(fm, /fb:datei-gespeichert/);
    });

    console.log(fehler ? `\n❌ ${fehler} Prüfung(en) fehlgeschlagen` : '\n✅ Konfiguration: vom Formular bis zur Liste im Panel');
    process.exit(fehler ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
