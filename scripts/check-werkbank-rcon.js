#!/usr/bin/env node
/**
 * RCON im Probestart der Werkbank (Baustelle 175, 2026-10-29).
 *
 * Betreiber: „RCON in der Werkbank — ich dachte, das wäre erledigt? Wenn nicht,
 * bitte erledigen." Fertig war die RCON-Karte; im laufenden Probestart ging
 * eine Eingabe nur über die Konsole, ohne Antwort.
 *
 *   Helfer    Sitzungen.rcon schickt `werkbank.rcon` mit dem Befehl, wartet
 *             20 s und gibt die Antwort des Spiels zurück; leer, ohne Lauf oder
 *             bei Ablehnung des Daemons gibt es einen Grund statt Schweigen
 *   Route     POST /:kennung/rcon mit WERKBANK.BAUEN
 *   Seite     die Wahl „Konsole | RCON" nur mit Fernsteuerung im Entwurf; das
 *             Skript schickt an /rcon und schreibt Befehl und Antwort als
 *             Hinweiszeilen (data-hinweis, also kein Klick-Übernehmen)
 *
 * Die Gegenseite im Daemon prüfen Go-Tests (werkbank_rcon_test.go, und im
 * Agenten gegen ein echtes fb-init: rcon ohne Abschnitt im Auftrag → Grund).
 *
 *   node scripts/check-werkbank-rcon.js
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const WURZEL = path.join(__dirname, '..');
const { ServiceManager } = require('dunebot-core');
const { ohneKommentare } = require('./lib/quelltext');

let fehler = 0;
async function pruefe(was, tun) {
    try { await tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').slice(0, 3).join('\n      ')}`); }
}
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), 'utf8');

(async () => {
    const still = () => {};
    ServiceManager.register('Logger', { debug: still, info: still, warn: still, error: still, success: still });

    let laeuft = true;
    const unbekannt = [];
    ServiceManager.register('dbService', { query: async (sql) => {
        if (/FROM werkbank_laeufe l JOIN werkbank_sitzungen s/.test(sql)) return laeuft ? [{ laufId: 7, guildId: '1', status: 'laeuft' }] : [];
        if (/SELECT daemon_id FROM rootserver WHERE id = \?/.test(sql)) return [{ daemon_id: 'd1' }];
        unbekannt.push(sql.trim().slice(0, 60));
        return [];
    } });
    const gesendet = [];
    let antwortDesDaemons = async () => ({ success: true, data: { antwort: 'There are 0 of a max of 20 players online' } });
    ServiceManager.register('ipmServer', {
        isDaemonOnline: () => true,
        sendCommand: async (daemonId, befehl, nutzlast, frist) => { gesendet.push({ daemonId, befehl, nutzlast, frist }); return antwortDesDaemons(); },
    });

    const Sitzungen = require('../plugins/werkbank/dashboard/helpers/Sitzungen');
    const sitzung = { kennung: 'wbtest', rootserver_id: 54 };

    console.log('\nRCON im Probestart (Baustelle 175)');

    await pruefe('schickt werkbank.rcon und gibt die Antwort des Spiels zurück', async () => {
        const antwort = await Sitzungen.rcon(sitzung, '  list\r\n');
        assert.strictEqual(antwort, 'There are 0 of a max of 20 players online');
        assert.deepStrictEqual(gesendet[0], { daemonId: 'd1', befehl: 'werkbank.rcon', nutzlast: { sitzung_id: 'wbtest', befehl: 'list' }, frist: 20000 });
    });

    await pruefe('leer, ohne Lauf und bei Ablehnung: ein Grund, kein Schweigen', async () => {
        await assert.rejects(Sitzungen.rcon(sitzung, '   '), /Leerer Befehl/);
        laeuft = false;
        await assert.rejects(Sitzungen.rcon(sitzung, 'list'), /Es läuft kein Probestart/);
        laeuft = true;
        // sendCommand WIRFT bei Ablehnung (Gedächtnis „sendCommand wirft").
        antwortDesDaemons = async () => { throw new Error('run_command: der Auftrag nennt keinen rcon-Abschnitt'); };
        await assert.rejects(Sitzungen.rcon(sitzung, 'list'), /keinen rcon-Abschnitt/);
        antwortDesDaemons = async () => ({ success: true, data: { antwort: '' } });
        assert.strictEqual(await Sitzungen.rcon(sitzung, 'save'), '', 'eine leere Antwort ist eine Antwort');
        assert.deepStrictEqual(unbekannt, [], `unbekannte Abfragen: ${unbekannt.join(' | ')}`);
    });

    await pruefe('Route POST /:kennung/rcon mit WERKBANK.BAUEN', async () => {
        const r = ohneKommentare(lies('plugins/werkbank/dashboard/routes/guild.router.js'));
        assert.match(r, /router\.post\('\/:kennung\/rcon', requirePermission\('WERKBANK\.BAUEN'\)/);
        assert.match(r, /Sitzungen\.rcon\(await offeneSitzung\(req, res\), req\.body\?\.befehl\)/);
    });

    await pruefe('Seite: Wahl nur mit Fernsteuerung, Skript schreibt Befehl und Antwort als Hinweis', async () => {
        const datei = path.join(WURZEL, 'plugins/werkbank/dashboard/views/guild/werkbank-sitzung.ejs');
        const quelle = fs.readFileSync(datei, 'utf8');
        ejs.compile(quelle, { filename: datei });
        const form = quelle.slice(quelle.indexOf('<form id="formEingabe"'), quelle.indexOf('</form>', quelle.indexOf('<form id="formEingabe"')));
        assert.match(form, /<% if \(_fern\.rcon\) \{ %>[\s\S]*name="weg"[\s\S]*value="rcon"[\s\S]*<% \} %>/, 'die Wahl hängt nicht an der Fernsteuerung');
        const skript = quelle.slice(quelle.indexOf("formEingabe.addEventListener('submit'"));
        const handler = skript.slice(0, skript.indexOf('\n  });') + 6);
        assert.match(handler, /schicke\(hier \+ '\/rcon', \{ befehl: befehl \}\)/);
        assert.match(handler, /setAttribute\('data-hinweis', 'rcon'\)/, 'RCON-Zeilen ließen sich sonst als Bereitschaftszeile übernehmen');
        assert.match(handler, /schicke\(hier \+ '\/eingabe', \{ zeile: feld\.value \}\)/, 'die Konsoleneingabe ist weg');
    });

    console.log(fehler ? `\n✗ ${fehler} Prüfung(en) rot` : '\n✅ RCON im Probestart: Befehl hin, Antwort zurück, Gründe statt Schweigen');
    process.exit(fehler ? 1 : 0);
})();
