#!/usr/bin/env node
/**
 * Prüfdurchlauf je Fall der Bereitschaft (Stufe 9 S7, 2026-10-26).
 *
 * ── Was hier geprüft wird ───────────────────────────────────────────────────
 *
 * Ein Paket mit `start.ready_when.cases` wird vom Daemon (ab S7) nach EINER
 * Installation je Fall einmal gestartet; das Ergebnis trägt `faelle`. Das
 * Dashboard muss dafür drei Dinge tun:
 *
 *   pruefen()          jeder Fall mit Port braucht dessen Nummer — bis S6 nur
 *                      der Grundfall, und ein Fall-Start scheiterte erst im
 *                      Daemon am Auftrag
 *   pruefungBeenden()  ein Grün OHNE `faelle` (Daemon vor S7) belegt bei einem
 *                      Paket mit Fällen nur einen davon — es wird rot
 *   beiPruefung        meldet das gespeicherte Urteil, nicht das gesendete
 *
 * Und die Karte zeigt je Fall Werte, Bereitschaft und Urteil.
 *
 *   node scripts/check-pruefung-faelle.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const ejs = require('ejs');
const { ServiceManager } = require('dunebot-core');
const { ohneKommentareEjs } = require('./lib/quelltext');

const WURZEL = path.join(__dirname, '..');
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), 'utf8');
const kopie = (v) => JSON.parse(JSON.stringify(v));

// Die Attrappe kennt genau die Abfragen dieser Wege. Alles andere ist ein Fehler.
let gespeichert = null;       // [status, ergebnis] des letzten UPDATE
let entwurfDerPruefung = null;
ServiceManager.register('dbService', {
    query: async (sql, werte) => {
        const t = sql.trim();
        if (/FROM werkbank_pruefungen p JOIN werkbank_sitzungen s[\s\S]*p\.status = 'laeuft'/.test(t)) return [];
        if (/^SELECT id FROM werkbank_schritte WHERE sitzung_id = \? AND status = 'laeuft' LIMIT 1$/.test(t)) return [];
        if (/FROM werkbank_laeufe l JOIN werkbank_sitzungen s[\s\S]*l\.status <> 'beendet'/.test(t)) return [];
        if (/^SELECT daemon_id FROM rootserver WHERE id = \?$/.test(t)) return [];
        if (/^SELECT entwurf FROM werkbank_pruefungen WHERE id = \?$/.test(t)) return entwurfDerPruefung ? [{ entwurf: JSON.stringify(entwurfDerPruefung) }] : [];
        if (/^UPDATE werkbank_pruefungen SET status = \?, ergebnis = \?, beendet_am = NOW\(\)/.test(t)) {
            gespeichert = [werte[0], JSON.parse(werte[1])];
            return {};
        }
        throw new Error(`Attrappe kennt die Abfrage nicht: ${t.slice(0, 90)}`);
    },
});
const gemeldet = [];
ServiceManager.register('sseManager', { broadcast: (guild, ns, daten) => gemeldet.push(daten) });
const still = () => {};
ServiceManager.register('Logger', { debug: still, info: still, warn: still, error: still, success: still });
const S = require('../plugins/werkbank/dashboard/helpers/Sitzungen');
const E = require('../plugins/werkbank/dashboard/helpers/Ereignisse');

let fehler = 0;
async function pruefe(was, tun) {
    try { await tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').slice(0, 4).join('\n      ')}`); }
}

// Windrose: P2P als Grundfall (ohne Port), Direktverbindung als Fall mit Port.
const ENTWURF = {
    identity: { slug: 'probe', name: 'Probe', version: '1.0.0' },
    ports: [{ purpose: 'game', protocol: 'udp', assign: 'pool' }],
    start: {
        program: 'R5/Binaries/Win64/WindroseServer-Win64-Shipping.exe',
        args: [{ value: '-port={{port:game}}' }],
        stop: { sequence: [{ step: 'sigterm', timeout_sec: 30 }, { step: 'sigkill', timeout_sec: 10 }] },
        ready_when: {
            without_port: 'P2P öffnet keinen Port', log_line: 'Host server is ready', log_file: 'R5/Saved/Logs/R5.log', timeout_sec: 900,
            cases: [{ from: 'setting:use_direct_connection', when: 'true', port: 'game' }],
        },
    },
    settings: [
        { key: 'use_direct_connection', type: 'boolean', role: 'owner', name: { de: 'Direktverbindung' }, default: false, takes_effect: 'restart',
          apply: [{ target: 'file', file: 'R5/ServerDescription.json', parser: 'json', path: 'UseDirectConnection' }] },
    ],
    werkbank: { portnummern: {} },
};
const sitzung = (entwurf = ENTWURF) => ({ id: 1, kennung: 'probe', guild_id: '1', rootserver_id: 54,
    image: { ref: 'fb/proton', tag: '2026.10-GE-Proton11-9' }, entwurf: kopie(entwurf) });
const SCHRITTE = [{ status: 'ok', schritt: { type: 'steamcmd', app_id: '4129620' } }];

(async () => {
    console.log('\nVor dem Durchlauf');

    await pruefe('ein Fall mit Port braucht dessen Nummer — sonst gleich hier, mit dem Fall im Satz', async () => {
        await assert.rejects(S.pruefen(sitzung(), SCHRITTE), (e) => {
            assert.match(e.message, /Port „game" \(Bereitschaft, Fall 1\) hat in dieser Sitzung keine Nummer/);
            return true;
        });
        // Mit Nummer kommt der Durchlauf bis zum Daemon (den es hier nicht gibt).
        const mit = sitzung(); mit.entwurf.werkbank.portnummern = { game: 7777 };
        await assert.rejects(S.pruefen(mit, SCHRITTE), /Daemon der Maschine ist nicht erreichbar/);
    });

    console.log('\nNach dem Durchlauf');

    const GRUEN_ALT = { gruen: true, gruende: [], installation: 'ok', bereitschaft: 'log_line', bereit_nach_sek: 40 };

    await pruefe('Grün ohne `faelle` bei einem Paket mit Fällen (Daemon vor S7) wird rot — mit Grund', async () => {
        entwurfDerPruefung = S.entwurfAlsPaket(sitzung(), SCHRITTE);
        const e = await S.pruefungBeenden(71, GRUEN_ALT);
        assert.strictEqual(gespeichert[0], 'rot');
        assert.strictEqual(e.gruen, false);
        assert.match(e.gruende.join(' '), /kennt keine Fälle der Bereitschaft[\s\S]*nicht die 2 des Pakets/);
        assert.deepStrictEqual(gespeichert[1], e, 'zurückgegeben wird, was gespeichert ist');
    });

    await pruefe('Grün MIT `faelle` bleibt grün; ein Paket ohne Fälle braucht keine', async () => {
        const mit = { ...GRUEN_ALT, faelle: [{ fall: -1, gruen: true }, { fall: 0, gruen: true }] };
        assert.strictEqual((await S.pruefungBeenden(72, mit)).gruen, true);
        assert.strictEqual(gespeichert[0], 'gruen');
        const ohneFaelle = kopie(ENTWURF); delete ohneFaelle.start.ready_when.cases;
        entwurfDerPruefung = S.entwurfAlsPaket(sitzung(ohneFaelle), SCHRITTE);
        assert.strictEqual((await S.pruefungBeenden(73, GRUEN_ALT)).gruen, true);
        assert.strictEqual(gespeichert[0], 'gruen');
    });

    await pruefe('beiPruefung meldet das gespeicherte Urteil, nicht das gesendete', async () => {
        entwurfDerPruefung = S.entwurfAlsPaket(sitzung(), SCHRITTE);
        E.merkePruefung('probe', { pruefId: 74, guildId: '1' });
        gemeldet.length = 0;
        await E.beiPruefung({ sitzung_id: 'probe', ergebnis: GRUEN_ALT });
        const urteil = gemeldet.find(d => d.action === 'pruefung');
        assert.ok(urteil, 'kein Urteil gemeldet');
        assert.strictEqual(urteil.gruen, false, 'gemeldet wurde grün, gespeichert rot');
    });

    console.log('\nKarte');

    await pruefe('die Karte zeigt je Fall Werte, Bereitschaft und Urteil; ohne `faelle` wie bisher', async () => {
        const quelle = ohneKommentareEjs(lies('plugins/werkbank/dashboard/views/guild/werkbank-sitzung.ejs'));
        const a = quelle.indexOf('<% if (pruefung && pruefung.ergebnis) { const e = pruefung.ergebnis; %>');
        const ende = quelle.indexOf('<details', a);
        assert.ok(a > 0 && ende > a, 'der Ergebnisteil der Prüfkarte ist nicht mehr zu finden');
        const teil = quelle.slice(a, ende);
        const zeichne = (ergebnis) => ejs.render(teil, { pruefung: { ergebnis } });

        const html = zeichne({
            gruen: false, installation: 'ok', install_sek: 300,
            gruende: ['Fall 1 (use_direct_connection=1): nach 15m0s nicht bereit'],
            faelle: [
                { fall: -1, werte: { use_direct_connection: '0' }, plan: { without_port: 'P2P', log_line: ['x'], log_file: 'R5/Saved/Logs/R5.log' },
                  gruen: true, gruende: [], bereitschaft: 'log_line', bereit_nach_sek: 41, stopp_sek: 6 },
                { fall: 0, werte: { use_direct_connection: '1' }, plan: { port: 'game' }, gruen: false, gruende: ['…'], bereitschaft: '',
                  hinweis: 'Die Installation liest {{setting:use_direct_connection}}' },
                { fall: 1, ungeprueft: 'when "!=x": dafür lässt sich kein Wert ableiten', gruende: [] },
            ],
        });
        assert.strictEqual((html.match(/<tr data-fall=/g) || []).length, 3);
        assert.match(html, /Grundfall<\/td>\s*<td class="font-monospace">use_direct_connection = 0[\s\S]*Zeile in R5\/Saved\/Logs\/R5\.log[\s\S]*grün[\s\S]*nach 41 s, Stopp 6 s/);
        assert.match(html, /Fall 1<\/td>[\s\S]*Port „game(&#34;|")[\s\S]*rot[\s\S]*nie bereit[\s\S]*Die Installation liest/);
        assert.match(html, /Fall 2<\/td>[\s\S]*ungeprüft[\s\S]*kein Wert ableiten/);
        assert.ok(!/· bereit nie/.test(html), 'mit Fällen steht die Sammelzeile des ersten Starts nicht da');

        const alt = zeichne({ gruen: true, gruende: [], installation: 'ok', bereitschaft: 'port', bereit_nach_sek: 12, exit_code: 0, stopp_sek: 3 });
        assert.ok(!alt.includes('pruefFaelle') && /bereit\s+über port nach 12 s/.test(alt), 'ohne Fälle wie bisher');
    });

    console.log(fehler ? `\n✗ ${fehler} Prüfung(en) gescheitert` : '\n✓ alles grün');
    process.exit(fehler ? 1 : 0);
})();
