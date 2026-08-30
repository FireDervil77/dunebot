#!/usr/bin/env node
'use strict';

/**
 * Die Brückenzeile im Marktplatz — damit ein Paket überhaupt einen Server ergibt.
 *
 * ── Warum es dieses Werkzeug gibt ───────────────────────────────────────────
 *
 * Ein Spielpaket lebt in `packages`/`package_versions`. Ein Server lebt in
 * `gameservers`. Zwischen beiden steht ein Rest der alten Welt:
 *
 *     gameservers.addon_marketplace_id   INT UNSIGNED  NOT NULL
 *                                        FOREIGN KEY → addon_marketplace(id)
 *
 * Ein Paket ohne Zeile in `addon_marketplace` kann also **keinen Server
 * erzeugen** — die Datenbank lässt es nicht zu. Valheim funktioniert nur, weil
 * sein Paket bewusst die Kennung seines alten Addons geerbt hat (siehe
 * `liefere-pakete.js`, Abschnitt „Warum die Kennung übernommen wird").
 *
 * Für ein Spiel, das es bei uns noch nie gab, gibt es diese Zeile nicht. Sie
 * von Hand in die Datenbank zu tippen wäre einmal machbar und beim zweiten Mal
 * ein Fehler — deshalb dieses Werkzeug.
 *
 * ── Was in der Zeile steht, und warum nichts davon erfunden ist ─────────────
 *
 * Alles wird aus dem **Paket** abgeleitet, nichts danebengeschrieben. Der Grund
 * ist derselbe wie überall hier: Zwei Quellen für dieselbe Sache driften
 * auseinander, und dann glaubt man der falschen. Drei Felder verlangt der
 * Anlegeweg trotzdem, weil er noch aus der alten Welt stammt:
 *
 *   startup.command   Die Route bricht mit 400 ab, wenn es fehlt
 *                     ("Addon hat keinen Start-Command definiert"). Es wird
 *                     bei angehängtem Paket NICHT ausgeführt — der Daemon
 *                     nimmt Programm und Parameter aus dem Paket. Es steht
 *                     hier als Abschrift, nicht als zweite Wahrheit.
 *   docker_images     Dasselbe: `imageAusPaket()` gewinnt, sobald ein Paket
 *                     dranhängt. Ohne Eintrag stünde hier aber `''`.
 *   variables         Die Vorgaben, aus denen `envVariables` startet. Das
 *                     Formular überschreibt sie mit dem, was eingetippt wurde.
 *
 * ── Warum die Variablennamen aus der Übergangsdatei kommen ─────────────────
 *
 * Das Paket nennt seine Einstellungen bei den eigenen Schlüsseln (`password`),
 * die Umgebung braucht den ENV-Namen (`SERVER_PASSWORD`). Die Zuordnung steht
 * in `packages/fbpkg/uebergang/<slug>.json` und **nur dort** — sie hier ein
 * zweites Mal zu pflegen wäre genau die Doppelung, gegen die das Werkzeug
 * geschrieben ist.
 *
 * ── Diese Brücke ist auf Abriss gebaut ─────────────────────────────────────
 *
 * Stufe 6 (Umstellung) löst die Kopplung `gameservers → addon_marketplace`.
 * Danach ist dieses Werkzeug überflüssig, und die Zeilen, die es angelegt hat,
 * sind es auch. Bis dahin ist es der ehrlichere Weg als ein INSERT von Hand.
 *
 * Aufruf:
 *   node scripts/marktplatz-bruecke.js packages/fbpkg/beispiele/astro-colony.json
 *   node scripts/marktplatz-bruecke.js packages/fbpkg/beispiele/astro-colony.json --wirklich
 *
 * Ohne `--wirklich` wird nichts geschrieben. Eine vorhandene Zeile wird NIE
 * überschrieben — sie könnte einem laufenden Server gehören.
 */

const path = require('path');
const fs = require('fs');

const WURZEL = path.join(__dirname, '..');
require(path.join(WURZEL, 'node_modules/dotenv')).config({
    path: path.join(WURZEL, 'apps/dashboard/.env')
});
const mysql = require(path.join(WURZEL, 'node_modules/mysql2/promise'));

const WIRKLICH = process.argv.includes('--wirklich');
const DATEI = process.argv.slice(2).find(a => !a.startsWith('--'));

/** Wem die Zeile gehört. Der Betreiber, nicht ein erfundener Benutzer. */
const BETREIBER = process.env.OWNER_DISCORD_ID || '544578232704565262';

if (!DATEI) {
    console.error('\nEs fehlt der Pfad zum Paket.\n');
    console.error('  node scripts/marktplatz-bruecke.js packages/fbpkg/beispiele/<name>.json\n');
    process.exit(2);
}

/**
 * Die Startzeile aus dem Paket abschreiben.
 *
 * **Sie wird nicht ausgeführt** — der Daemon baut die Parameterliste selbst aus
 * `start.args` (als LISTE, nie als Zeichenkette; genau darum geht es bei dem
 * ganzen Umbau). Hier entsteht nur ein lesbarer Abdruck für ein Pflichtfeld der
 * alten Welt. Platzhalter bleiben deshalb stehen, statt aufgelöst zu werden:
 * Ein aufgelöster Wert sähe aus wie eine Zusage.
 *
 * @param {Object} paket FBPKG_v1
 * @returns {string} Startzeile
 */
function startzeile(paket) {
    const teile = [paket.start?.program || ''];

    for (const a of paket.start?.args || []) {
        if (Array.isArray(a.parts)) {
            teile.push(a.parts.map(t => t.text).join(''));
            continue;
        }
        const form = Array.isArray(a.form) ? a.form : [a.form];
        teile.push(form.filter(Boolean).join(' '));
    }

    return teile.filter(Boolean).join(' ').trim();
}

(async () => {
    const paket = JSON.parse(fs.readFileSync(path.resolve(WURZEL, DATEI), 'utf8'));
    const id = paket.identity || {};
    const slug = id.slug;

    if (!slug) {
        console.error('\nDas Paket hat keinen `identity.slug` — ohne ihn gibt es nichts zuzuordnen.\n');
        process.exit(2);
    }

    // Die ENV-Namen kommen aus der Übergangsdatei, nicht von hier.
    const uebPfad = path.join(WURZEL, 'packages/fbpkg/uebergang', `${slug}.json`);
    let zuordnung = {};
    if (fs.existsSync(uebPfad)) {
        zuordnung = JSON.parse(fs.readFileSync(uebPfad, 'utf8')).zuordnung || {};
    } else {
        console.log(`  Hinweis: keine Übergangsdatei für "${slug}". Die Werte-Karte beim Anlegen`);
        console.log('  hätte dann keine ENV-Namen, und nichts käme in der Umgebung an.');
    }

    // Die Vorgaben, mit denen `envVariables` startet.
    const variables = [];
    for (const s of paket.settings || []) {
        const env = zuordnung[s.key];
        if (!env) continue;
        variables.push({
            name: s.name?.de || s.name?.en || s.key,
            description: s.description?.de || s.description?.en || '',
            env_variable: env,
            default_value: s.default === undefined || s.default === null ? '' : String(s.default),
            user_viewable: true,
            user_editable: (s.role || 'expert') === 'player'
        });
    }

    const steamApp = (paket.install?.steps || []).find(s => s.type === 'steamcmd')?.app || null;

    const gameData = {
        meta: {
            version: 'FIREBOT_v2',
            name: id.name || slug,
            author: id.author || 'firenetworks',
            description: id.description?.de || id.description?.en || '',
            // Wer diese Zeile später liest, soll sofort sehen, was sie ist.
            herkunft: 'Brückenzeile aus dem Spielpaket — erzeugt von scripts/marktplatz-bruecke.js. '
                    + 'Massgeblich ist das Paket in package_versions, nicht dieser Abzug. '
                    + 'Faellt mit Stufe 6 (Umstellung) weg.'
        },
        docker_images: paket.image?.ref
            ? { [paket.image.ref + (paket.image.tag ? ':' + paket.image.tag : '')]:
                 paket.image.ref + (paket.image.tag ? ':' + paket.image.tag : '') }
            : {},
        startup: { command: startzeile(paket) },
        variables
    };

    console.log(`\nBrückenzeile für "${slug}" (${id.name || slug})\n`);
    console.log(`  Startzeile   ${gameData.startup.command}`);
    console.log(`  Image        ${Object.keys(gameData.docker_images)[0] || '(keins)'}`);
    console.log(`  Variablen    ${variables.length} (${variables.filter(v => v.user_editable).length} beim Anlegen abgefragt)`);
    console.log(`  Steam-App    ${steamApp || '(keine)'}`);

    if (!gameData.startup.command) {
        console.error('\n  ✘ Ohne Startzeile weist die Anlegeroute den Server mit 400 ab.\n');
        process.exit(1);
    }

    let db;
    try {
        db = await mysql.createConnection({
            host: process.env.MYSQL_HOST, user: process.env.MYSQL_USER,
            password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE,
            port: process.env.MYSQL_PORT || 3306
        });
    } catch (err) {
        console.error(`\nDie Datenbank ist nicht erreichbar: ${err.message}\n`);
        process.exit(2);
    }

    const [vorhanden] = await db.query(
        'SELECT id, name FROM addon_marketplace WHERE slug = ?', [slug]);

    if (vorhanden.length) {
        // **Nicht überschreiben.** Die Zeile könnte einem laufenden Server
        // gehören; sein `frozen_game_data` stammt zwar aus dem Anlegen, aber
        // die Kennung hängt hier. Wer etwas ändern will, tut es bewusst.
        console.log(`\n  ○ Es gibt sie schon: Kennung ${vorhanden[0].id} ("${vorhanden[0].name}").`);
        console.log('    Es wurde nichts geändert. Das Paket kann eingeliefert werden —');
        console.log('    `liefere-pakete.js` übernimmt diese Kennung von selbst.\n');
        await db.end();
        process.exit(0);
    }

    if (!WIRKLICH) {
        console.log('\n  Probelauf — es wurde nichts geschrieben.');
        console.log('  Mit `--wirklich` anlegen.\n');
        await db.end();
        process.exit(0);
    }

    const [erg] = await db.query(`
        INSERT INTO addon_marketplace
            (name, slug, author_user_id, game_data, category, version,
             steam_app_id, runtime_type, source_type, visibility, status,
             trust_level, published_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'docker_steam', 'native', 'public', 'approved', 'official', NOW())
    `, [id.name || slug, slug, BETREIBER, JSON.stringify(gameData),
        id.category || 'other', id.version || '1.0.0', steamApp]);

    console.log(`\n  ✓ Angelegt mit Kennung ${erg.insertId}.`);
    console.log('    Jetzt das Paket einliefern:');
    console.log(`      node scripts/liefere-pakete.js ${DATEI} --wirklich\n`);

    await db.end();
})().catch(err => {
    console.error('\nFehlgeschlagen:', err.message, '\n');
    process.exit(2);
});
