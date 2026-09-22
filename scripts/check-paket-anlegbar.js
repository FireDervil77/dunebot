#!/usr/bin/env node
'use strict';

/**
 * Wächter: jedes Paket lässt sich auch anlegen (Befund vom 2026-09-22).
 *
 * ── Woher er kommt ───────────────────────────────────────────────────────────
 *
 * Der Betreiber wollte einen Minecraft-Server anlegen und kam nicht durch
 * Schritt 2. Die Kette:
 *
 *   `minecraft` in `packages` (Kennung 1473)        ✅ am 2026-09-20 eingeliefert
 *   Schritt 1 zeigt PAKETE                          ✅ Minecraft stand da
 *   Schritt 2 sucht `addon_marketplace WHERE slug`  ❌ keine Zeile
 *   `gameservers.addon_marketplace_id` → FK         ❌ kein Server anlegbar
 *
 * **Die Zeile in `addon_marketplace` ist nur noch ein Anker** — gelesen wird aus
 * dem Paket (so steht es in der POST-Route seit dem 2026-09-10). Aber der Anker
 * ist Pflicht, denn `gameservers_ibfk_2` zeigt darauf. Ein Paket ohne Anker ist
 * ein Spiel, das man auswählen, aber nicht anlegen kann.
 *
 * Der Einlieferer kannte den Fall sogar („ein Paket, das die Werkbank erzeugt
 * hat") und liess die Datenbank eine eigene Nummer vergeben. Gemessen wurde
 * nie, was danach passiert — das war der Fehler, nicht die Zeile.
 *
 * ── Was dieser Wächter prüft ─────────────────────────────────────────────────
 *
 *  1. Jedes Paket hat einen Ankersatz, und zwar mit DERSELBEN Kennung
 *     (`packages.id = addon_marketplace.id`) — sonst findet `ladePaketFuerAddon`
 *     das Paket nicht, obwohl beide Zeilen da sind.
 *  2. `game_data` des Ankers ist lesbar (die Spalte ist NOT NULL, aber ein
 *     kaputter Text darin bricht Schritt 3).
 *  3. Der Einlieferer legt den Anker an, wenn er fehlt — und zwar VOR der
 *     Fassungsprüfung, sonst erreicht er ein bereits gelegtes Paket nie.
 *
 * Aufruf:  node scripts/check-paket-anlegbar.js
 * Rückgabe: 0 = jedes Paket ist auswählbar UND anlegbar.
 */

const fs = require('fs');
const path = require('path');
const { ohneKommentare } = require('./lib/quelltext');

const WURZEL = path.join(__dirname, '..');

let geprueft = 0, fehler = 0, uebersprungen = 0;
const pruefe = (ok, was, zusatz = '') => {
    geprueft++;
    if (!ok) fehler++;
    console.log(`  ${ok ? '✅' : '❌'} ${was}${!ok && zusatz ? '\n       ' + zusatz : ''}`);
};
const skip = (was, warum) => { uebersprungen++; console.log(`  ⏭  ${was} — ${warum}`); };

(async () => {
    console.log('\n▸ Jedes Paket lässt sich auswählen UND anlegen\n');

    // ════════════════════════════════════════════════════════════════════════
    console.log('Der Einlieferer legt den Anker an');
    // ════════════════════════════════════════════════════════════════════════
    const lief = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'scripts/liefere-pakete.js'), 'utf8'));
    pruefe(/async function sichereAnker\(/.test(lief),
        'es gibt einen Schritt, der den Ankersatz sicherstellt');
    pruefe(/INSERT INTO addon_marketplace/.test(lief),
        'und er legt die Zeile wirklich an',
        'Ein Werkzeug, das den Mangel nur meldet, laesst den Betreiber mit SQL allein.');

    // Die Reihenfolge ist der Punkt: VOR der Fassungspruefung. Sonst springt ein
    // bereits gelegtes Paket per `continue` heraus, bevor der Anker geprueft wird
    // — genau der Zustand von Minecraft.
    const iAnker = lief.indexOf('sichereAnker(\n');
    const iAufruf = iAnker > -1 ? iAnker : lief.indexOf('await sichereAnker(');
    const iFassung = lief.indexOf('SELECT pv.id, pv.checksum');
    pruefe(iAufruf > -1 && iFassung > -1 && iAufruf < iFassung,
        'und zwar VOR der Fassungsprüfung',
        'Ein Paket, das unveraendert vorliegt, verlaesst die Schleife vorher. Der Anker'
      + ' waere dann nur mit einer neuen Versionsnummer nachzutragen.');

    // Die Kennung des Pakets übernehmen, nicht eine neue vergeben.
    pruefe(/SELECT id FROM packages WHERE slug = \?/.test(lief),
        'er übernimmt die Kennung des vorhandenen Pakets',
        '`ladePaketFuerAddon` sucht ueber `packages.id = addon_marketplace.id`. Eine neue'
      + ' Nummer waere ein zweiter Anker daneben.');
    pruefe(/author_user_id/.test(lief) && /ORDER BY COUNT\(\*\) DESC LIMIT 1/.test(lief),
        'und rät den Autor nicht, sondern nimmt den des Hauses');

    // ════════════════════════════════════════════════════════════════════════
    console.log('\nDie Route sagt, was fehlt');
    // ════════════════════════════════════════════════════════════════════════
    const routen = ohneKommentare(fs.readFileSync(
        path.join(WURZEL, 'plugins/gameserver/dashboard/routes/servers.js'), 'utf8'));
    pruefe(/Ankersatz in der Spieleliste/.test(routen),
        'die Abweisung nennt die Ursache, nicht nur „nicht gefunden"');
    // ── Die Statuszahl der Fehlerseite ──────────────────────────────────────
    //
    // Erste Fassung: `status: 404` irgendwo in `servers.js`. Blieb in der
    // Gegenprobe gruen, weil ich nur EINE der beiden Stellen entfernt hatte.
    //
    // Zweite Fassung: je `render('error', …)`-Aufruf. Biss richtig — und zeigte
    // dabei, dass die Frage falsch war: **61 Stellen im Haus** rufen so auf. Sie
    // alle um ein `status:` zu ergaenzen waere ein Durchgang, der beim 62.
    // vergessen wird. Express KENNT den Status; die Vorlage muss ihn nur lesen.
    //
    // Also wird jetzt das Ergebnis geprueft, nicht die Schreibweise der Aufrufer:
    // Der Zugriffsgeber in `app.js` und dass die Seite nichts erfindet.
    const appjs = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'apps/dashboard/app.js'), 'utf8'));
    const ueberzug = appjs.match(/res\.render = function[\s\S]{0,420}?\n            \};/);
    pruefe(ueberzug !== null,
        'app.js legt jeder Vorlage den echten HTTP-Status bei',
        'Ohne ihn haengt die Zahl daran, dass jeder der 61 Aufrufer sie mitgibt.');
    pruefe(ueberzug !== null && /httpStatus: res\.statusCode/.test(ueberzug[0]),
        'und nimmt ihn aus `res.statusCode`');
    pruefe(ueberzug !== null && /\{ httpStatus: res\.statusCode, \.\.\.\(optionen \|\| \{\}\) \}/.test(ueberzug[0]),
        'eine ausdrückliche Angabe der Route gewinnt (sie steht hinten)');

    // ── Und was hier NICHT stehen darf ──────────────────────────────────────
    //
    // Der erste Versuch war `Object.defineProperty(res.locals, 'httpStatus',
    // { get })`. Er ging im Probelauf mit nacktem Express durch und riss die
    // Anlage auf der ersten echten Seite: `ThemeRenderer.renderView` baut
    // `{ ...res.locals }` und schreibt es per `Object.assign(res.locals, …)`
    // ZURUECK — eine Zuweisung auf eine Eigenschaft mit nur einem Geber wirft.
    // `res.locals` ist ein Datensack, den fremder Code kopiert und
    // zurueckschreibt; berechnete Werte gehoeren da nicht hinein.
    pruefe(!/defineProperty\(res\.locals/.test(appjs),
        'und `res.locals` bekommt keinen berechneten Wert',
        'ThemeRenderer schreibt res.locals per Object.assign zurueck — ein Geber ohne Setzer '
      + 'wirft dort, und zwar auf JEDER Seite, die ueber das Theme rendert.');

    const fehlerseite = fs.readFileSync(path.join(WURZEL,
        'apps/dashboard/themes/default/views/error.ejs'), 'utf8');
    pruefe(!/errObj\.statusCode \|\| 500/.test(fehlerseite),
        'die Fehlerseite erfindet keine Statuszahl',
        'Eine Statuszeile ist eine Messung. „500" ueber einer 404 schickt den naechsten'
      + ' Sucher auf die falsche Spur.');
    pruefe(/locals\.httpStatus/.test(fehlerseite),
        'und liest den echten Status',
        'Sonst haengt die Zahl daran, dass jeder der 61 Aufrufer sie mitgibt.');

    // Und dasselbe am Verhalten: dreimal rendern, dreimal die richtige Ueberschrift.
    let ejs = null;
    try { ejs = require(path.join(WURZEL, 'node_modules/ejs')); } catch { /* unten gemeldet */ }
    if (!ejs) {
        skip('die Überschrift der Fehlerseite', 'ejs nicht ladbar');
    } else {
        const datei = path.join(WURZEL, 'apps/dashboard/themes/default/views/error.ejs');
        const kopfVon = (locals) => {
            const html = ejs.render(fehlerseite, locals, { filename: datei });
            return ((html.match(/<h1[^>]*>([^<]*)</) || [])[1] || '').trim();
        };
        for (const [was, locals, erwartet] of [
            ['der echte Status steht da', { httpStatus: 404, message: 'x' }, '404 - Fehler'],
            ['eine ausdrückliche Angabe gewinnt', { httpStatus: 500, status: 418, message: 'x' }, '418 - Fehler'],
            ['ohne jede Angabe keine Zahl', { message: 'x' }, 'Fehler'],
        ]) {
            let kopf = null;
            try { kopf = kopfVon(locals); } catch (e) { kopf = 'WIRFT: ' + e.message.split('\n')[0]; }
            pruefe(kopf === erwartet, `${was} („${kopf}")`,
                `Erwartet war „${erwartet}".`);
        }
    }

    // ── `game_data` darf NULL sein, ohne die Seite zu reissen ───────────────
    // Der Anker traegt `{}`, aber Altzeilen koennen NULL sein — und
    // `null.variables` wirft. Zwei Stellen lesen die Spalte.
    const nullSicher = (routen.match(/JSON\.parse\(addonData\.game_data\)[\s\S]{0,80}?\?\? \{\}/g) || []).length;
    pruefe(nullSicher >= 2,
        `beide Leser von game_data überleben NULL (${nullSicher} von 2)`,
        'Ein `null.variables` weiter unten ist dann eine echte 500.');

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
        skip('die Pakete', `Datenbank nicht erreichbar (${e.message.split('\n')[0]})`);
    }

    if (db) {
        try {
            const [pakete] = await db.query(
                `SELECT pk.id, pk.slug, am.id AS anker_id, am.game_data
                   FROM packages pk
                   LEFT JOIN addon_marketplace am ON am.slug = pk.slug
                  ORDER BY pk.slug`);
            if (!pakete.length) skip('die Pakete', 'die Registry ist leer');
            for (const p of pakete) {
                pruefe(p.anker_id !== null, `${p.slug}: Ankersatz vorhanden`,
                    'Das Spiel steht in der Auswahl und laesst sich nicht anlegen — '
                  + `\`node scripts/liefere-pakete.js packages/fbpkg/beispiele/${p.slug}.json --wirklich\``);
                if (p.anker_id === null) continue;
                pruefe(Number(p.anker_id) === Number(p.id),
                    `${p.slug}: Anker und Paket tragen dieselbe Kennung`,
                    `Anker ${p.anker_id}, Paket ${p.id} — \`ladePaketFuerAddon\` sucht das Paket `
                  + 'ueber die Anker-Kennung und findet nichts.');
                let lesbar = true;
                try { if (typeof p.game_data === 'string') JSON.parse(p.game_data); }
                catch { lesbar = false; }
                pruefe(lesbar, `${p.slug}: game_data des Ankers ist lesbar`,
                    'Schritt 3 liest die Spalte; kaputter Text dort wirft.');
            }
        } catch (e) {
            pruefe(false, 'die Pakete sind lesbar', e.message);
        }
        await db.end();
    }

    console.log(`\n${fehler === 0 ? '✅' : '❌'} ${geprueft - fehler} von ${geprueft} Prüfungen bestanden`
              + `${uebersprungen ? `, ${uebersprungen} übersprungen` : ''}`);
    console.log(fehler === 0
        ? '   Was in der Auswahl steht, lässt sich auch anlegen.\n' : '');
    process.exit(fehler === 0 ? 0 : 1);
})();
