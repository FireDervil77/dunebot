#!/usr/bin/env node
'use strict';

/**
 * Wächter: der Install-Fortschritt kommt an und wird gezeigt (Baustelle 44).
 *
 * ── Der Befund, aus dem er entstand ──────────────────────────────────────────
 *
 * Server 160 stand auf `starting`, während SteamCMD 21,4 GiB lud. Wer das Panel
 * ansah, dachte der Server startet — und wartete auf einen Beitritt, der nicht
 * kommen konnte.
 *
 * Die Zahl gab es die ganze Zeit. Sie fiel nur am Ziel auf den Boden:
 *
 *   Daemon rechnet `percent`        ✅ install_paket.go
 *   Ereignis kommt an              ✅ install/output
 *   Handler liest `percent`        ❌ zerlegte nur { server_id, line }
 *   Spalte `install_progress`      ❌ existiert seit der Baseline, nie geschrieben
 *   Anzeige                        ❌ nichts
 *
 * ── Zwei Fallen, die dieser Wächter deshalb mitprüft ────────────────────────
 *
 * 1. **Der Fortschritt darf nicht bei jeder Zeile zurückgesetzt werden.** Jede
 *    Protokollzeile kommt als `install/output`, die meisten OHNE `percent`. Wer
 *    `?? null` schreibt, lässt den Balken bei jeder Zeile auf 0 zucken.
 * 2. **Der SSE-Verteiler stellt `install_` voran.** Ein Handler auf `output`
 *    statt `install_output` feuert nie — und zwar lautlos, weil ein Handler ohne
 *    Ereignis genauso aussieht wie ein Ereignis ohne Handler.
 *
 * Aufruf:  node scripts/check-install-fortschritt.js
 * Rückgabe: 0 = die Kette ist geschlossen, 1 = mindestens ein Glied fehlt.
 */

const fs = require('fs');
const path = require('path');
const { ohneKommentare, ohneKommentareEjs } = require('./lib/quelltext');

const WURZEL = path.join(__dirname, '..');
const DAEMON = '/home/firedervil/firebot_daemon';

let geprueft = 0, fehler = 0, uebersprungen = 0;
const pruefe = (ok, was, zusatz = '') => {
    geprueft++;
    if (!ok) fehler++;
    console.log(`  ${ok ? '✅' : '❌'} ${was}${!ok && zusatz ? '\n       ' + zusatz : ''}`);
};
const skip = (was, warum) => { uebersprungen++; console.log(`  ⏭  ${was} — ${warum}`); };

const roh = (datei) => fs.existsSync(datei) ? fs.readFileSync(datei, 'utf8') : null;

(async () => {
    console.log('\n▸ Der Install-Fortschritt, vom Daemon bis auf die Seite\n');

    // ── Daemon ───────────────────────────────────────────────────────────────
    console.log('Daemon — er rechnet und schickt');
    const paket = ohneKommentare(roh(path.join(DAEMON, 'internal/gameserver/install_paket.go')) || '');
    pruefe(/nutz\["percent"\] = f\.Prozent/.test(paket),
        'der Daemon legt `percent` in das output-Ereignis');
    pruefe(/f\.Prozent != letzte/.test(paket),
        'und schickt es nur bei Änderung',
        'SteamCMD schreibt die Prozente mehrmals je Sekunde — jede einzelne wäre dieselbe '
      + 'Zahl in hundert Ereignissen.');
    pruefe(/"phase":\s*"installing_game"/.test(paket) && /"steps":/.test(paket),
        'Phasen und Schrittzahl gehen mit');

    // ── Dashboard: annehmen und wegschreiben ─────────────────────────────────
    console.log('\nDashboard — annehmen, wegschreiben, weitergeben');
    const ipm = ohneKommentare(roh(path.join(WURZEL, 'apps/dashboard/helpers/IPMServer.js')) || '');

    // Geschnitten auf den output-Handler: Die Datei enthält vier Install-Handler,
    // und eine dateiweite Suche wäre grün, sobald EINER etwas tut.
    const iOutput = ipm.indexOf("eventRouter.register('install', 'output'");
    const outputHandler = iOutput > -1 ? ipm.slice(iOutput, iOutput + 2200) : '';
    // Geprüft wird die BENUTZUNG, nicht das Vorkommen: Die erste Fassung suchte
    // `payload.percent` irgendwo im Handler und blieb in der Gegenprobe grün,
    // weil der Name dort noch in einer toten Zuweisung stand. Also: Der Wert muss
    // aus `payload.percent` kommen UND als Parameter in das UPDATE gehen.
    pruefe(outputHandler && /const prozent = [^;]*payload\.percent/.test(outputHandler),
        'der output-Handler leitet `prozent` aus `payload.percent` ab',
        outputHandler ? 'er zerlegt nur `line` — genau der Befund von B44'
                      : "der Handler `install`/`output` wurde nicht gefunden");
    pruefe(outputHandler && /UPDATE gameservers SET install_progress = \?[\s\S]{0,200}?\[prozent,/.test(outputHandler),
        'und schreibt ihn als Parameter in `install_progress`',
        'Ein UPDATE mit einer anderen Zahl wäre schlimmer als keines.');

    // Die Falle: kein Zurücksetzen bei Zeilen ohne Prozente.
    pruefe(outputHandler && /prozent !== null/.test(outputHandler),
        'eine Zeile ohne Prozente lässt den Stand stehen',
        'Mit `?? null` zuckt der Balken bei jeder Protokollzeile auf 0 — und Protokollzeilen '
      + 'kommen im Sekundentakt.');

    const iStatus = ipm.indexOf("eventRouter.register('install', 'status'");
    const statusHandler = iStatus > -1 ? ipm.slice(iStatus, iStatus + 2200) : '';
    pruefe(statusHandler && /install_phase = \?, install_progress = 0/.test(statusHandler),
        'ein Phasenwechsel setzt den Fortschritt auf 0 zurück',
        'Die Prozente gelten je Schritt. Ohne das Zurücksetzen steht der Balken beim nächsten '
      + 'Schritt auf 100, bis die erste neue Zahl kommt — und ein Balken, der von 100 auf 3 '
      + 'springt, sieht wie ein Fehler aus.');
    pruefe(statusHandler && /\{ step \}/.test(statusHandler) && /\{ steps \}/.test(statusHandler),
        'Schritt und Schrittzahl gehen an den Browser');

    // ── Dashboard: rechnen und zeichnen ──────────────────────────────────────
    console.log('\nDashboard — rechnen und zeichnen');
    const seite = ohneKommentare(roh(path.join(WURZEL, 'plugins/gameserver/dashboard/helpers/Serverseite.js')) || '');
    pruefe(/function baueInstallation\(/.test(seite) && /installation:\s*baueInstallation\(/.test(seite),
        'die Rechnung liegt im Server (baueInstallation)');
    pruefe(/const INSTALL_PHASE = \{/.test(seite),
        'die Phasentafel liegt dort ebenfalls',
        'Im Browser übersetzt stünde auf der Seite ein anderer Text als in der Live-Meldung.');
    pruefe(/INSTALL_PHASE\[phase\] \|\| \(phase \? phase : null\)/.test(seite),
        'eine unbekannte Phase wird durchgereicht, nicht verschwiegen',
        'Kommt im Daemon eine neue Phase dazu, soll ihre Kennung dastehen — hässlich, aber wahr.');

    const routen = ohneKommentare(roh(path.join(WURZEL, 'plugins/gameserver/dashboard/routes/servers.js')) || '');
    // Je Abfrage, nicht je Datei (dieselbe Lehre wie bei check-platzgrenze).
    const abfrage = (merkmal) => {
        const i = routen.indexOf(merkmal);
        if (i < 0) return '';
        const auf = routen.lastIndexOf('`', i);
        const zu = routen.indexOf('`', i);
        return (auf < 0 || zu < 0) ? '' : routen.slice(auf, zu);
    };
    for (const [name, merkmal] of [
        ['Serverseite', 'gs.sftp_password_seen_at'],
        ['/status', 'disk_quota_enforced, disk_quota_note,'],
    ]) {
        const sql = abfrage(merkmal);
        pruefe(sql && /install_progress/.test(sql) && /install_phase/.test(sql),
            `${name} holt install_progress und install_phase`,
            sql ? 'die Abfrage holt sie nicht' : 'die Abfrage wurde nicht gefunden');
    }

    const vorlage = ohneKommentareEjs(roh(path.join(WURZEL,
        'plugins/gameserver/dashboard/views/guild/server-detail.ejs')) || '');
    pruefe(/data-fb-live="installbahn"/.test(vorlage) && /data-fb-live="installbalken"/.test(vorlage),
        'die Vorlage zeichnet die Bahn');
    // ── Was diese Pruefung NICHT beweist (nachgetragen 2026-09-22) ──────────
    //
    // Sie sagt: die Bahn traegt `display:none`, ist also versteckt statt
    // abwesend. Sie sagt NICHT, ob sie ueberhaupt im HTML landet. Genau das war
    // der Fall: Der ganze Messstreifen hing an einem `<% if (mw) { %>` eine
    // Bildschirmseite darueber, und bei einem nie gemessenen Server stand die
    // Bahn nirgends — diese Pruefung blieb gruen, weil sie im QUELLTEXT sucht.
    //
    // Die Frage „landet sie im HTML" prueft `check-live-anzeige.js`, indem es
    // den Block mit `messwerte: null` wirklich rendert. Hier bleibt der Stil.
    pruefe(/data-fb-live="installbahn"[\s\S]{0,400}?display:none/.test(vorlage),
        'und traegt `display:none` statt zu fehlen (ob sie im HTML landet: check-live-anzeige)',
        'Ein Element, das es je nach Zustand gar nicht gibt, findet das Live-Modul später nicht — '
      + 'und genau während einer Installation will niemand neu laden.');

    const live = ohneKommentare(roh(path.join(WURZEL,
        'plugins/gameserver/dashboard/assets/js/gameserver-live.js')) || '');
    pruefe(/sse\.on\('install_output'/.test(live) && /sse\.on\('install_status'/.test(live),
        'das Live-Modul hört auf install_output und install_status');
    // Ohne die Klammer am Ende: Im Code steht `sse.on('output', (d) => {`, ein
    // Ausdruck mit `')'` trifft das nie — die Gegenprobe blieb deshalb grün.
    pruefe(!/sse\.on\('output'/.test(live) && !/sse\.on\('status'/.test(live),
        'und nicht auf `output`/`status` ohne Vorsilbe',
        'Der SSE-Verteiler stellt `install_` voran. Ohne Vorsilbe feuert nie etwas, und zwar '
      + 'lautlos.');
    pruefe(/case 'installbahn'/.test(live) && /case 'installbalken'/.test(live),
        'und zeichnet beide Felder');

    // ── Datenbank ────────────────────────────────────────────────────────────
    console.log('\nGegen die Datenbank');
    let db = null;
    try {
        require(path.join(WURZEL, 'node_modules/dotenv'))
            .config({ path: path.join(WURZEL, 'apps/dashboard/.env'), quiet: true });
        const mysql = require(path.join(WURZEL, 'node_modules/mysql2/promise'));
        db = await mysql.createConnection({
            host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT) || 3306,
            user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
            database: process.env.MYSQL_DATABASE, connectTimeout: 4000,
        });
    } catch (e) {
        skip('die Spalten', `Datenbank nicht erreichbar (${e.message.split('\n')[0]})`);
    }
    if (db) {
        try {
            const [spalten] = await db.query(
                `SELECT COLUMN_NAME FROM information_schema.COLUMNS
                  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gameservers'
                    AND COLUMN_NAME IN ('install_progress','install_phase')`);
            const da = spalten.map(s => s.COLUMN_NAME);
            for (const n of ['install_progress', 'install_phase']) {
                pruefe(da.includes(n), `gameservers.${n}`, 'die Spalte fehlt');
            }
        } catch (e) {
            pruefe(false, 'Spalten nicht lesbar', e.message);
        }
        await db.end();
    }

    console.log(`\n${fehler === 0 ? '✅' : '❌'} ${geprueft - fehler} von ${geprueft} Prüfungen bestanden`
              + `${uebersprungen ? `, ${uebersprungen} übersprungen` : ''}`);
    if (fehler === 0 && uebersprungen === 0) {
        console.log('   Wer zusieht, sieht wie weit — statt „starting" über 21 GiB.\n');
    } else {
        console.log('');
    }
    process.exit(fehler === 0 ? 0 : 1);
})();
