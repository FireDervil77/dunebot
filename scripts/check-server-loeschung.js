#!/usr/bin/env node
/**
 * Löschen im Hintergrund, mit Sperre (2026-10-30).
 *
 * Betreiber: Modal mit „löschen", blauer Toast, Sprung in die Übersicht, Zeile
 * bis zum Ende gesperrt und rot. Geprüft wird die Rechnung, die Sperre an allen
 * drei Wegen zum Server und die Oberfläche aus den echten Quellen. Den Ablauf
 * selbst (stoppen → Datenbanken → Dateien → Zeile) prüft check-server-stopp.js
 * über die echte Route.
 *
 *   node scripts/check-server-loeschung.js
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const { ServiceManager } = require('dunebot-core');
const { ohneKommentare } = require('./lib/quelltext');

const WURZEL = path.join(__dirname, '..');
const P = 'plugins/gameserver/dashboard/';
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), 'utf8');

let fehler = 0;
async function pruefe(was, tun) {
    try { await tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').slice(0, 3).join('\n      ')}`); }
}

(async () => {
    const still = () => {};
    ServiceManager.register('Logger', { debug: still, info: still, warn: still, error: still, success: still });
    const gesendet = [];
    ServiceManager.register('sseManager', { broadcast: (g, ns, d) => gesendet.push(d) });
    let zeile = null;
    let geschrieben = [];
    ServiceManager.register('dbService', { query: async (sql, p) => {
        const t = String(sql).replace(/\s+/g, ' ').trim();
        if (/^SELECT loeschung_seit, loeschung_fehler FROM gameservers WHERE id = \?$/.test(t)) return zeile ? [zeile] : [];
        if (/^UPDATE gameservers SET loeschung_fehler = \? WHERE id = \?$/.test(t)) { geschrieben.push(p[0]); return { affectedRows: 1 }; }
        throw new Error('Unerwartete Abfrage: ' + t.slice(0, 80));
    } });

    const Loeschung = require('../' + P + 'helpers/Loeschung');
    const { baueZustand } = require('../' + P + 'helpers/Serverseite');
    const { entscheide } = require('../' + P + 'helpers/cronEntscheidung');
    const jetzt = Date.parse('2026-10-30T12:00:00Z');
    const vor = (min) => new Date(jetzt - min * 60000);

    console.log('\nStand');

    await pruefe('Nie versucht, frisch, gescheitert, abgebrochen, verjährt', () => {
        const s = (seit, f = null) => Loeschung.stand({ loeschung_seit: seit, loeschung_fehler: f }, jetzt);
        assert.deepStrictEqual(s(null), { laeuft: false, fehler: null });
        assert.deepStrictEqual(Loeschung.stand(undefined), { laeuft: false, fehler: null }, 'keine Zeile: nichts gesperrt');
        assert.deepStrictEqual(s(vor(3)), { laeuft: true, fehler: null });
        assert.deepStrictEqual(s(vor(3), 'Daemon weg'), { laeuft: false, fehler: 'Daemon weg' }, 'ein Fehler löst die Sperre sofort');
        const ab = s(vor(11));
        assert.strictEqual(ab.laeuft, false, 'ohne Frist sperrte ein Neustart den Server für immer');
        assert.match(ab.fehler, /nicht zu Ende geführt/);
        assert.deepStrictEqual(s(vor(8 * 24 * 60), 'alt'), { laeuft: false, fehler: null }, 'kein Dauerrot');
    });

    await pruefe('Das Wort: genau „löschen", Großschreibung egal, sonst nichts', () => {
        for (const ja of ['löschen', ' Löschen ']) assert.ok(Loeschung.bestaetigt(ja), ja);
        for (const nein of ['', undefined, null, 'loeschen', 'ja', 'lösch']) assert.ok(!Loeschung.bestaetigt(nein), String(nein));
    });

    await pruefe('Zustand: „Wird gelöscht" in Rot schlägt Status und Umzug', () => {
        const z = baueZustand({ status: 'offline', umzug_status: 'transferring', loeschung_seit: new Date() });
        assert.strictEqual(z.schluessel, 'loeschung');
        assert.strictEqual(z.text, 'Wird gelöscht');
        assert.strictEqual(z.abzeichen, 'danger');
        assert.strictEqual(baueZustand({ status: 'offline' }).schluessel, 'offline');
    });

    console.log('\nSperre');

    await pruefe('Routen: Ändern gibt 409, Ansehen bleibt, ohne Löschen läuft alles', async () => {
        const rufe = async (method) => {
            let code = null, weiter = false;
            const res = { status(c) { code = c; return this; }, json() { return this; } };
            await Loeschung.sperre({ method, params: { serverId: '7' } }, res, () => { weiter = true; });
            return { code, weiter };
        };
        zeile = { loeschung_seit: new Date(), loeschung_fehler: null };
        assert.deepStrictEqual(await rufe('POST'), { code: 409, weiter: false });
        assert.deepStrictEqual(await rufe('GET'), { code: null, weiter: true });
        zeile = { loeschung_seit: null, loeschung_fehler: null };
        assert.deepStrictEqual(await rufe('POST'), { code: null, weiter: true });
    });

    await pruefe('Jeder Router mit :serverId hängt die Sperre ein', () => {
        const dir = path.join(WURZEL, P, 'routes');
        for (const f of fs.readdirSync(dir)) {
            const q = ohneKommentare(fs.readFileSync(path.join(dir, f), 'utf8'));
            if (!/router\.(post|put|patch|delete)\([^)]*:serverId/.test(q)) continue;
            assert.match(q, /router\.param\('serverId', [^\n]*\.sperre\)/, `${f} sperrt nicht`);
        }
    });

    await pruefe('Discord: Start und Neustart prüfen vor dem Auftrag', () => {
        const q = ohneKommentare(lies('apps/dashboard/helpers/IPCServer.js'));
        for (const fall of ["case 'SERVER_START':", "case 'SERVER_RESTART':"]) {
            const ab = q.indexOf(fall);
            const block = q.slice(ab, q.indexOf('sendCommand', ab));
            assert.match(block, /Serverloeschung\.stand\(srv\)\.laeuft/, fall);
        }
    });

    await pruefe('Geplante Aufgaben: kein Lauf während des Löschens, auch kein Start', () => {
        const lage = { serverStatus: 'offline', daemonOnline: true, wirdGeloescht: true };
        for (const aktion of ['start', 'backup', 'command', 'restart', 'stop']) {
            assert.strictEqual(entscheide({ ...lage, aktion }).ausfuehren, false, aktion);
        }
        assert.strictEqual(entscheide({ ...lage, aktion: 'start', wirdGeloescht: false }).ausfuehren, true);
        assert.match(lies(P + 'helpers/CronWorker.js'), /wirdGeloescht: await this\._wirdGeloescht\(job\.server_id, dbService\)/);
    });

    console.log('\nAusgang');

    await pruefe('Wirft der Ablauf, steht der Grund am Server und die Seite erfährt es', async () => {
        ServiceManager.register('ipmServer', { isDaemonOnline: () => { throw new Error('kaputt'); } });
        geschrieben = []; gesendet.length = 0;
        const e = await Loeschung.fuehreAus({ server: { id: 7, name: 'Bude', status: 'offline' }, guildId: 'g' });
        assert.strictEqual(e.ok, false);
        assert.strictEqual(geschrieben.length, 1);
        assert.deepStrictEqual(gesendet.map(d => d.stand), ['laeuft', 'gescheitert']);
        assert.strictEqual(gesendet[1].grund, geschrieben[0]);
    });

    console.log('\nOberfläche');

    await pruefe('Kein prompt/confirm mehr, Dialog fragt das Wort, Toast überlebt den Sprung', () => {
        const q = ohneKommentare(lies(P + 'assets/js/server-actions.js'));
        const f = q.slice(q.indexOf('function deleteServer('), q.indexOf('async function reinstallServer('));
        assert.ok(!/confirm\(|prompt\(/.test(f));
        assert.match(f, /bootstrap\.Modal\.getOrCreateInstance/);
        assert.match(f, /bestaetigung: eingabe\.value/);
        assert.ok(f.indexOf('sessionStorage.setItem') < f.indexOf('await fetch('), 'die Live-Anzeige kann schneller springen als die Antwort');
        assert.match(q, /showToast\?\.\('info', nachSprung\)/);
        assert.match(q, /const LOESCH_WORT = 'löschen'/);
        assert.strictEqual(Loeschung.WORT, 'löschen');
    });

    await pruefe('Ein Name mit Apostroph zerlegt den Aufruf nicht', () => {
        const q = lies(P + 'views/guild/server-detail.ejs');
        assert.match(q, /data-server-name="<%= server\.name %>" onclick="deleteServer\('<%= server\.id %>', this\.dataset\.serverName\)/);
        assert.match(q, /include\('partials\/server-loeschen-dialog'\)/);
    });

    await pruefe('Zeilen tragen das Live-Merkmal, gesperrt schon beim Laden', () => {
        const zeichne = (rel, daten) => ejs.render(lies(rel), daten, { filename: path.join(WURZEL, rel) });
        const eintrag = (l) => ({ id: 7, name: 'Bude', spiel: 'X', zustand: { text: 'Wird gelöscht', abzeichen: 'danger' },
            spieler: { jetzt: null, max: null }, loeschung: l });
        const liste = (l) => ({ liste: [eintrag(l)], zahlen: { alle: 1, online: 0, spieler: 0 } });
        const widget = (l) => zeichne(P + 'views/widgets/gameserver-uebersicht.ejs', { guildId: 'g', liste: liste(l), icons: {} });
        const an = widget({ laeuft: true, fehler: null });
        assert.match(an, /data-fb-live="server-zeile" data-fb-server="7" class="bg-danger-lt list-group-item/);
        assert.match(an, /pointer-events:none/);
        assert.ok(!/pointer-events/.test(widget({ laeuft: false, fehler: null })));
        const o = lies(P + 'views/guild/servers-overview.ejs');
        assert.match(o, /data-fb-live="server-zeile" data-fb-server="<%= s\.id %>"/);
        assert.match(o, /data-fb-live="loeschung-fehler"/);
    });

    await pruefe('Live: rot, Sperre, Fehlergrund; verschwundene Server verlieren ihre Zeile', () => {
        const q = ohneKommentare(lies(P + 'assets/js/gameserver-live.js'));
        assert.match(q, /sse\.on\('loeschung'/);
        assert.match(q, /case 'server-zeile':[\s\S]*?bg-danger-lt[\s\S]*?pointerEvents/);
        assert.match(q, /case 'loeschung-fehler':/);
        assert.match(q, /if \(!genannt\.has\(id\)\) this\.entferne\(id\)/);
        assert.match(q, /loeschung: s\.loeschung \|\| undefined/);
        assert.match(lies(P + 'assets/css/serverseite.css'), /\.fb-pille-rot/);
    });

    console.log(fehler ? `\n✗ ${fehler} Prüfung(en) rot` : '\n✅ Löschen: Rückfrage, Hintergrund, Sperre auf allen Wegen, Ausgang sichtbar');
    process.exit(fehler ? 1 : 0);
})();
