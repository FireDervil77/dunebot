#!/usr/bin/env node
'use strict';

/**
 * Wächter: die weiche Platzgrenze (Baustelle 101, Weg C — 2026-09-21).
 *
 * ── Warum es diesen Wächter braucht ─────────────────────────────────────────
 *
 * Die Kette geht über zwei Programme und fünf Stellen: Der Daemon misst, setzt
 * die Grenze aus dem Auftrag, verweigert Start und Schreiben, meldet den Stand
 * im Herzschlag; das Dashboard schreibt ihn weg und zeigt ihn an. Reißt EIN
 * Glied, meldet nichts einen Fehler — die Seite zeigt weiter eine Zahl, und die
 * Grenze tut nichts. Genau so war es von 2026-08-10 bis 2026-09-19: gebaut,
 * ausgerollt, wirkungslos, und niemand merkte es.
 *
 * Deshalb prüft dieser Wächter **Verhalten an der Naht**, nicht Anwesenheit von
 * Dateien:
 *
 *   1. Der Wächter im Daemon hält an, aber erst nach ZWEI Messungen über der
 *      Grenze — sonst schlägt er mitten in einem Steam-Update zu, das GiB im
 *      Volume zwischenlagert.
 *   2. Er hält nicht selbst an, sondern reiht denselben Auftrag ein wie der
 *      Knopf im Panel (ein Stopp-Weg, nicht zwei).
 *   3. Der Start fragt ihn (`DarfStarten`), und zwar NACH `NutzlastAnwenden` —
 *      davor kennt er die Grenze nach einem Daemon-Neustart nicht.
 *   4. Der Schreibweg fragt ihn (`DarfSchreiben`) mit dem **Zuwachs**, nicht
 *      mit der Dateigröße.
 *   5. Die Grenze wird schon bei der Registrierung gesetzt, nicht erst beim
 *      Start — sonst kennt der Dateimanager bei einem nie gestarteten Server
 *      keine Grenze, und genau dort lädt jemand hoch.
 *   6. Der Herzschlag trägt den Stand, das Dashboard schreibt ihn weg — und
 *      löscht ihn NICHT, wenn eine Messung fehlt.
 *   7. Der Text auf der Bearbeitungsseite sagt nicht mehr „hindert den Server
 *      nicht", wo die weiche Grenze greift.
 *   8. Mit Datenbank: die Spalten sind da (rot bis zum Rollout).
 *
 * Aufruf:  node scripts/check-platzgrenze.js
 * Rückgabe: 0 = die Kette ist geschlossen, 1 = mindestens ein Glied fehlt.
 */

const fs = require('fs');
const path = require('path');
// Die gemeinsame Fassung, nicht eine eigene: Es gab einmal vier Kopien in sieben
// Skripten, und sie verhielten sich verschieden (Baustelle 89).
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

/**
 * Roher Dateiinhalt, oder null.
 *
 * Absichtlich OHNE Kommentarfilter: Den setzt jeder Aufrufer selbst davor
 * (`ohneKommentare(roh(...))`). So steht an jeder Bindung, ob nach Code oder
 * nach Text gesucht wird — und `check-waechter-prosa` kann es lesen.
 */
function roh(datei) {
    if (!fs.existsSync(datei)) return null;
    return fs.readFileSync(datei, 'utf8');
}

/**
 * Wie `roh`, aber ohne Kommentare — für alles, wo nach CODE gesucht wird.
 *
 * Der Aufruf steht bewusst als `ohneKommentare(roh(...))` an jeder Bindung und
 * nicht versteckt in einem Helfer: `check-waechter-prosa` liest die
 * **Bindungsanweisung** und kann eine Indirektion nicht sehen. Ein Helfer, der
 * schützt, ohne es zu zeigen, sieht für den nächsten Durchgang aus wie eine
 * ungeschützte Suche — und die eine, die es wirklich ist, geht in der Liste
 * unter.
 */

(async () => {
    console.log('\n▸ Die weiche Platzgrenze, von der Messung bis zur Anzeige\n');

    // ════════════════════════════════════════════════════════════════════════
    console.log('Daemon — der Wächter selbst');
    // ════════════════════════════════════════════════════════════════════════
    const waechter = ohneKommentare(roh(path.join(DAEMON, 'internal/gameserver/platz/waechter.go')) || '');
    if (!waechter) {
        pruefe(false, 'internal/gameserver/platz/waechter.go liegt im Daemon',
            `nicht gefunden unter ${DAEMON}`);
    } else {
        const folgen = waechter.match(/FolgenBisAnhaltenVorgab\s*=\s*(\d+)/);
        pruefe(folgen !== null && Number(folgen[1]) >= 2,
            `hält erst nach ${folgen ? folgen[1] : '?'} Messungen über der Grenze an`,
            'Bei 1 schlägt die Grenze mitten in einem Steam-Update zu — das lagert '
          + 'GiB im Volume zwischen (game/steamapps/downloading), bevor es verschiebt.');

        pruefe(/func \(w \*Waechter\) DarfStarten\(/.test(waechter)
            && /func \(w \*Waechter\) DarfSchreiben\(/.test(waechter),
            'DarfStarten und DarfSchreiben gibt es');

        // Melden statt ausweichen: ein Messfehler darf nichts verhindern.
        const messfehlerFreundlich = (waechter.match(/nicht messbar/g) || []).length >= 2;
        pruefe(messfehlerFreundlich,
            'ein Messfehler verhindert weder Start noch Schreiben (und wird protokolliert)',
            'Sonst sperrt ein Verzeichnis, das gerade nicht lesbar ist, den Server aus.');

        pruefe(/GrenzeBytes > 0 && s\.BelegtBytes > s\.GrenzeBytes/.test(waechter),
            'ohne Grenze ist niemand über der Grenze (0 = unbegrenzt)');

        pruefe(/gib\*1024\*1024\*1024/.test(waechter.replace(/\s/g, '')),
            'die Grenze rechnet GiB, nicht GB',
            '21 GB als 21e9 gibt ARK 390 MB zu wenig — die Installation stirbt kurz vor Schluss.');
    }

    // ════════════════════════════════════════════════════════════════════════
    console.log('\nDaemon — wo die Grenze beißt');
    // ════════════════════════════════════════════════════════════════════════
    const main = ohneKommentare(roh(path.join(DAEMON, 'cmd/daemon/main.go')) || '');
    if (!main) {
        pruefe(false, 'cmd/daemon/main.go liegt im Daemon');
    } else {
        pruefe(/platz\.Neu\(/.test(main) && /SetzePlatzwaechter\(/.test(main),
            'der Wächter wird gebaut und eingehängt');
        pruefe(/go \w+\.Lauf\(/.test(main),
            'der Messtakt läuft (Lauf in einer eigenen Goroutine)',
            'Ohne den läuft nur, was von Hand gemessen wird — und niemand hält einen Server an.');
        pruefe(/TaskTypeServerStop/.test(main.slice(main.indexOf('MitAnhalten'), main.indexOf('MitAnhalten') + 900)),
            'angehalten wird über denselben Auftrag wie der Knopf im Panel',
            'Selbst zu stoppen wäre ein zweiter Stopp-Weg — und der eine pflegt Status und Ereignisse mit.');

        // Die Reihenfolge ist der Punkt: DarfStarten NACH NutzlastAnwenden.
        const iNutzlast = main.indexOf('NutzlastAnwenden(srv, payload)');
        const iDarfStarten = main.indexOf('DarfStarten(task.ServerID)');
        pruefe(iNutzlast > -1 && iDarfStarten > iNutzlast,
            'der Start fragt DarfStarten, und zwar nach NutzlastAnwenden',
            'Davor kennt der Wächter die Grenze aus dem Auftrag noch nicht — nach einem '
          + 'Daemon-Neustart würde er gegen 0 prüfen und alles durchlassen.');
    }

    const files = ohneKommentare(roh(path.join(DAEMON, 'internal/gameserver/files.go')) || '');
    if (!files) {
        pruefe(false, 'internal/gameserver/files.go liegt im Daemon');
    } else {
        pruefe(/platzwaechter\.DarfSchreiben\(/.test(files),
            'der Schreibweg fragt DarfSchreiben');
        pruefe(/schreibZuwachs\(/.test(files) && /DarfSchreiben\(serverID, zuwachs\)/.test(files),
            'geprüft wird der Zuwachs, nicht die Dateigröße',
            'Mit der Dateigröße liesse sich eine grosse Konfigurationsdatei nicht mehr '
          + 'bearbeiten, sobald der Server nahe an seiner Grenze liegt.');
        pruefe(/MerkeZuwachs\(/.test(files),
            'der Zuwachs wird gemerkt (sonst kommt ein Massen-Upload an jeder Datei vorbei)');
    }

    const nutzlast = ohneKommentare(roh(path.join(DAEMON, 'internal/gameserver/nutzlast.go')) || '');
    pruefe(nutzlast && /SetzeGrenzeGiB\(srv\.ID\(\), DiskGBAus\(grenzen\)\)/.test(nutzlast),
        'die Grenze kommt aus dem Auftrag — an der einen Stelle, die jeden Auftrag anwendet',
        'nutzlast.go');

    const client = ohneKommentare(roh(path.join(DAEMON, 'internal/websocket/client.go')) || '');
    if (!client) {
        pruefe(false, 'internal/websocket/client.go liegt im Daemon');
    } else {
        pruefe(/SetzeGrenzeGiB\(serverID, int64\(diskLimit\)\)/.test(client),
            'die Grenze steht schon nach der Registrierung, nicht erst nach dem ersten Start',
            'Sonst kennt der Dateimanager bei einem nie gestarteten Server keine Grenze.');
        pruefe(/platz_belegt_bytes/.test(client) && /platz_grenze_bytes/.test(client),
            'der Herzschlag trägt den Platzstand je Server');
        pruefe(/func \(c \*Client\) MeldePlatzstand\(/.test(client),
            'es gibt eine Meldung für den Augenblick, in dem ein Start verweigert wird');
        pruefe(/w\.Vergiss\(id\)/.test(client),
            'Server, die das Dashboard nicht mehr kennt, fallen aus der Beobachtung');
    }

    // ════════════════════════════════════════════════════════════════════════
    console.log('\nDashboard — wegschreiben und anzeigen');
    // ════════════════════════════════════════════════════════════════════════
    const ipm = ohneKommentare(roh(path.join(WURZEL, 'apps/dashboard/helpers/IPMServer.js')) || '');
    if (!ipm) {
        pruefe(false, 'apps/dashboard/helpers/IPMServer.js');
    } else {
        pruefe(/platz_belegt_bytes = IF\(\?, \?, platz_belegt_bytes\)/.test(ipm),
            'eine fehlende Messung löscht den gespeicherten Stand nicht',
            '`?? null` würde bei jedem Herzschlag ohne Messung den letzten Wert leeren — '
          + 'und das sieht aus wie „nie gemessen".');
        pruefe(/hatPlatz/.test(ipm),
            'der Herzschlag unterscheidet „nicht gemessen" von „0 Bytes"');
    }

    const msgTypes = ohneKommentare(roh(path.join(WURZEL, 'packages/dunebot-sdk/lib/ipm/MessageTypes.js')) || '');
    pruefe(msgTypes && /GAMESERVER_PLATZSTAND\s*=\s*'platzstand'/.test(msgTypes),
        'das Ereignis platzstand ist auf der Dashboard-Seite bekannt');

    const protokoll = ohneKommentare(roh(path.join(DAEMON, 'pkg/protocol/messages.go')) || '');
    pruefe(protokoll && /GameServerPlatzstand\s*=\s*"platzstand"/.test(protokoll),
        'und im Daemon heißt es genauso',
        'Zwei Schreibweisen für ein Ereignis heissen: der Empfänger hört nie.');

    const gsIndex = ohneKommentare(roh(path.join(WURZEL, 'plugins/gameserver/dashboard/index.js')) || '');
    if (!gsIndex) {
        pruefe(false, 'plugins/gameserver/dashboard/index.js');
    } else {
        pruefe(/GAMESERVER_PLATZSTAND/.test(gsIndex) && /_handlePlatzstand/.test(gsIndex),
            'es gibt einen Empfänger für platzstand');
        // Ein zweiter Schreiber auf dieselbe Wahrheit ist der Befund, nicht das Ziel.
        //
        // Der Ausschnitt endet am naechsten Handler, nicht nach n Zeichen: Der
        // erste Entwurf nahm 2000 Zeichen und las damit in `_handleReadiness`
        // hinein — der schreibt `UPDATE gameservers`, und der Waechter meldete
        // einen Fehler, den es nicht gab. Ein Wächter, der ueber die Grenze
        // seines Gegenstands hinausliest, misst den Nachbarn.
        const anfang = gsIndex.indexOf('_handlePlatzstand(payload');
        const naechster = gsIndex.indexOf('\n    async _handle', anfang + 1);
        const handler = gsIndex.slice(anfang, naechster > anfang ? naechster : gsIndex.length);
        pruefe(anfang > -1 && !/UPDATE server_registry|UPDATE gameservers/.test(handler),
            'der Empfänger schreibt nichts in die Datenbank (das tut der Herzschlag)',
            'Zwei Schreiber auf eine Wahrheit: der seltenere überschreibt den häufigeren.');
    }

    const seite = ohneKommentare(roh(path.join(WURZEL, 'plugins/gameserver/dashboard/helpers/Serverseite.js')) || '');
    pruefe(seite && /function bauePlatz\(/.test(seite) && /platz:\s*bauePlatz\(/.test(seite),
        'die Übersichtskarte rechnet den Platz im Server (bauePlatz)');

    // Die Schwellen (90 %, über der Grenze) und die Farbe dürfen nur EINMAL
    // stehen. Stünden sie auch im Browser, sähe derselbe Zustand nach dem ersten
    // Nachladen anders aus als beim Aufbau der Seite (Baustelle 134).
    const live = ohneKommentare(roh(path.join(WURZEL, 'plugins/gameserver/dashboard/assets/js/gameserver-live.js')) || '');
    pruefe(live && /case 'platz-text'/.test(live) && /case 'platz-balken'/.test(live),
        'das Live-Modul zeichnet platz-text und platz-balken',
        'Ein Marker `data-fb-live` ohne Fall im Modul ist ein Feld, das nie nachgeführt wird — '
      + 'genau das meldet scripts/check-live-anzeige.js.');
    pruefe(live && !/#d63939|#f76707|#2fb344/.test(live),
        'die Farbtafel steht nicht auch im Browser',
        'Der Server liefert `platz.farbe` mit — eine zweite Tafel driftet.');
    pruefe(live && !/>=\s*90/.test(live.slice(live.indexOf("case 'platz-balken'"), live.indexOf("case 'platz-balken'") + 600)),
        'die 90-%-Schwelle steht nicht im Browser');
    pruefe(seite && /farbe = PLATZ_FARBE\[ergebnis\.ton\]/.test(seite),
        'die Farbe kommt aus der einen Tafel im Server');
    pruefe(seite && /ueber:\s*stand\.ueber|ergebnis\.ueber = stand\.ueber/.test(seite),
        'das Urteil „über der Grenze" kommt vom Daemon, es wird nicht nachgerechnet',
        'Eine Anzeige, die anders rechnet als der Torwächter, widerspricht ihm irgendwann.');

    const routen = ohneKommentare(roh(path.join(WURZEL, 'plugins/gameserver/dashboard/routes/servers.js')) || '');
    pruefe(routen && /lesePlatzstand\(dbService, server\.id\)/.test(routen),
        'die Serverseite liest den gemessenen Stand');
    pruefe(routen && !/JOIN server_registry/.test(routen),
        'ohne JOIN auf server_registry (varchar gegen int, und die Kollationsgrenze)');

    const uebersichtVorlage = ohneKommentareEjs(roh(path.join(WURZEL,
        'plugins/gameserver/dashboard/views/guild/partials/server-detail-uebersicht.ejs')) || '');
    pruefe(/u\.platz/.test(uebersichtVorlage),
        'die Übersichtskarte zeichnet den Platz');

    // Hier wird nach TEXT gesucht, den ein Kunde liest — nicht nach Code. Der
    // EJS-Filter nimmt die Kommentare weg, damit die Begruendung IM Kopf der
    // Vorlage (die den alten Satz zitiert) den Waechter nicht gruen haelt.
    const editVorlage = ohneKommentareEjs(roh(path.join(WURZEL,
        'plugins/gameserver/dashboard/views/guild/gameserver-edit.ejs')) || '');
    pruefe(!/hindert den Server\s*\n?\s*aber nicht daran/.test(editVorlage),
        'die Bearbeitungsseite behauptet nicht mehr, die Grenze hindere den Server an nichts',
        'Seit Weg C ist das falsch: sie verweigert Start und Uploads.');
    pruefe(/es gilt die weiche/.test(editVorlage),
        'sie sagt stattdessen, dass die weiche Grenze gilt');

    // ════════════════════════════════════════════════════════════════════════
    console.log('\nGegen die Datenbank');
    // ════════════════════════════════════════════════════════════════════════
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
        skip('die Spalten in server_registry', `Datenbank nicht erreichbar (${e.message.split('\n')[0]})`);
    }

    if (db) {
        try {
            const [spalten] = await db.query(
                `SELECT COLUMN_NAME FROM information_schema.COLUMNS
                  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'server_registry'
                    AND COLUMN_NAME LIKE 'platz\\_%'`);
            const da = spalten.map(s => s.COLUMN_NAME);
            for (const n of ['platz_belegt_bytes', 'platz_grenze_bytes', 'platz_gemessen_am',
                             'platz_ueber', 'platz_geschaetzt']) {
                pruefe(da.includes(n), `server_registry.${n}`,
                    'Migration 20260921_120000 ist nicht gelaufen — sie kommt mit dem Dashboard-Neustart.');
            }
        } catch (e) {
            pruefe(false, 'Spalten nicht lesbar', e.message);
        }
        await db.end();
    }

    // ════════════════════════════════════════════════════════════════════════
    console.log(`\n${fehler === 0 ? '✅' : '❌'} ${geprueft - fehler} von ${geprueft} Prüfungen bestanden`
              + `${uebersprungen ? `, ${uebersprungen} übersprungen` : ''}`);
    if (fehler === 0 && uebersprungen === 0) {
        console.log('   Die Kette ist geschlossen: gemessen, verweigert, gemeldet, angezeigt.\n');
    } else if (fehler === 0) {
        console.log('   Was messbar war, stimmt. Die übersprungenen Punkte sind NICHT geprüft.\n');
    } else {
        console.log('');
    }
    process.exit(fehler === 0 ? 0 : 1);
})();
