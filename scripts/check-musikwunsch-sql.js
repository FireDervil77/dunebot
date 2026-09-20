#!/usr/bin/env node
'use strict';

/**
 * Die SQL von `plugins/streaming/shared/musikwunsch.js` gegen das ECHTE Schema.
 *
 * ## Warum es diesen Waechter gibt
 *
 * `check-streaming-befehle.js` prueft seit dem 2026-09-19 die zehn Musikbefehle
 * (179/179 gruen). Er tut das ueber eine **Attrappe** fuer `shared/musikwunsch`:
 * Sie belegt, dass jede gerufene Funktion im echten Modul existiert, dieselbe
 * Asynchronitaet hat und die Heim-Guild als erstes Argument bekommt.
 *
 * **Was sie nicht kann, und das stand am selben Tag als offener Rest da:** Ob
 * die Abfragen INNERHALB von `musikwunsch.js` zum Schema passen. Die Attrappe
 * ersetzt das Modul ja gerade — ihre SQL ist die Attrappe, nicht die echte.
 *
 * Das ist genau die Luecke, an der `!uptime` am 2026-09-05 in Produktion
 * zerbrach, waehrend 44 Pruefungen gruen meldeten: eine fehlende Spalte.
 * Geratene Spaltennamen stuerzen nicht ab, sie zeigen still nichts.
 *
 * ## Wie gemessen wird — ausfuehren, nicht nachbilden
 *
 * Nicht per Regex ueber den Quelltext: Die Abfragen entstehen teils erst zur
 * Laufzeit (`WHERE ${wo}`, `position ${vor ? '>' : '<'} ?`). Ein Nachbau waere
 * geraten und wuerde genau die Faelle verfehlen, die zusammengesetzt werden.
 *
 * Stattdessen laeuft das echte Modul, und `dbService` ist eine Attrappe, die
 * jede Abfrage an MySQL weiterreicht — aber als `PREPARE`. MySQL prueft dabei
 * Syntax, Tabellen UND Spalten und fuehrt **nichts** aus: kein Schreiben, kein
 * Loeschen, kein Rueckstand.
 *
 * ## Zwei Laeufe, weil eine Antwort nicht beide Zweige oeffnet
 *
 * Im ersten Entwurf gab die Attrappe immer `[]` zurueck. Ergebnis: acht
 * Stellen nie erreicht, darunter **alle drei `INSERT`** — jeder haengt hinter
 * einem „nichts gefunden"-Ausstieg. Eine Attrappe, die immer eine Zeile
 * liefert, kehrt das nur um: Dann wird das `INSERT IGNORE` in `zustand()` nie
 * erreicht, weil die Zeile ja schon da ist.
 *
 * Deshalb laeuft alles **zweimal** — einmal mit leeren Tabellen, einmal mit
 * gefuellten. Geprueft wird die Vereinigung.
 *
 * Die gefuellte Antwort baut die Attrappe aus `INFORMATION_SCHEMA`: Sie liest,
 * welche Spalten die gefragte Tabelle wirklich hat, und fuellt sie typgerecht.
 * Bei `SELECT spalte` oder `SELECT … AS pos` nimmt sie, was die Abfrage
 * erfragt hat. **Sie raet nichts** — das war die Bedingung, unter der eine
 * antwortende Attrappe besser ist als eine schweigende.
 *
 * ## Und was dieser Waechter NICHT kann
 *
 * Er prueft Form, nicht Inhalt: dass jede Abfrage zum Schema passt, nicht dass
 * sie das Richtige tut. Und er kann eine Abfrage nur pruefen, wenn der Code sie
 * absetzt — deshalb zaehlt er am Ende die `db().query(`-Stellen im Quelltext
 * gegen die gesehenen und **nennt jede nicht erreichte Zeile beim Namen**.
 * Ein Waechter, der Unerreichtes stillschweigend uebergeht, meldet gruen.
 *
 * Aufruf: node scripts/check-musikwunsch-sql.js
 * Beendet mit 0 (in Ordnung), 1 (Abweichung) oder 2 (nicht messbar).
 */

const path = require('path');
const fs = require('fs');

const WURZEL = path.resolve(__dirname, '..');
require(path.join(WURZEL, 'node_modules/dotenv')).config({
    path: path.join(WURZEL, 'apps/dashboard/.env')
});
const mysql = require(path.join(WURZEL, 'node_modules/mysql2/promise'));
const { ServiceManager } = require(path.join(WURZEL, 'node_modules/dunebot-core'));
const { MusikablageRegistry } = require(path.join(WURZEL, 'node_modules/dunebot-sdk'));

const MODUL = 'plugins/streaming/shared/musikwunsch.js';
const TABELLEN = ['streaming_music_queue', 'streaming_music_state'];
const GUILD = '000000000000000001';   // existiert nicht; PREPARE fuehrt nichts aus

/** Bremse: eine antwortende Attrappe kann eine Schleife am Laufen halten. */
const OBERGRENZE = 500;

let geprueft = 0;
let gescheitert = 0;

/**
 * @param {string} text Was geprueft wurde
 * @param {boolean} gut Ergebnis
 * @param {string} [zusatz] Nur bei Abweichung
 * @returns {void}
 */
function pruefe(text, gut, zusatz) {
    geprueft++;
    if (gut) {
        console.log(`  ✓ ${text}`);
        return;
    }
    gescheitert++;
    console.log(`  ✗ ${text}${zusatz ? ` — ${zusatz}` : ''}`);
}

/**
 * Die `db().query(`-Stellen des Quelltexts, mit Zeilennummern.
 *
 * Kommentare werden abgezogen: Der Modulkopf spricht ueber Abfragen, und ein
 * `grep` ueber rohen Quelltext zaehlt Prosa mit.
 *
 * @returns {Array<{zeile: number, auszug: string}>} Fundstellen
 */
function stellenImQuelltext() {
    const { ohneKommentare } = require(path.join(WURZEL, 'scripts/lib/quelltext'));
    const sauber = ohneKommentare(fs.readFileSync(path.join(WURZEL, MODUL), 'utf8'));

    const zeilen = sauber.split('\n');
    const gefunden = [];
    zeilen.forEach((z, i) => {
        if (!z.includes('db().query(')) return;
        // Die Abfrage steht oft erst in einer der naechsten Zeilen.
        const auszug = [z, zeilen[i + 1], zeilen[i + 2]].join(' ').replace(/\s+/g, ' ').trim();
        gefunden.push({ zeile: i + 1, auszug: auszug.slice(0, 120) });
    });
    return gefunden;
}

/**
 * Eine Abfrage vorbereiten lassen, ohne sie auszufuehren.
 *
 * `SET @sql = ?` statt `PREPARE x FROM '...'`: Die Abfragen enthalten
 * Anfuehrungszeichen, und selbst zu maskieren hiesse, MySQLs Regeln
 * nachzubauen. Der Parameter geht durch die Maskierung des Treibers.
 *
 * @param {Object} verbindung mysql2-Verbindung
 * @param {string} sql Die Abfrage
 * @returns {Promise<string|null>} Fehlertext oder null
 */
async function vorbereiten(verbindung, sql) {
    try {
        await verbindung.query('SET @pruef_sql = ?', [sql]);
        await verbindung.query('PREPARE pruef_stmt FROM @pruef_sql');
        await verbindung.query('DEALLOCATE PREPARE pruef_stmt');
        return null;
    } catch (fehler) {
        try { await verbindung.query('DEALLOCATE PREPARE pruef_stmt'); } catch { /* war nie da */ }
        return fehler.message;
    }
}

/**
 * Ein Wert, der zum Spaltentyp passt.
 *
 * @param {string} typ DATA_TYPE aus INFORMATION_SCHEMA
 * @returns {number|string} Der Wert
 */
function wertFuer(typ) {
    if (/int|decimal|float|double/i.test(typ)) return 1;
    if (/date|time/i.test(typ)) return '2026-09-20 12:00:00';
    return 'x';
}

/**
 * Was eine Abfrage erfragt hat — die Antwortzeile der gefuellten Attrappe.
 *
 * @param {string} sql Die Abfrage
 * @param {Object} spalten Tabellenname → Spalten aus INFORMATION_SCHEMA
 * @returns {Array<Object>} Keine oder eine Zeile
 */
function antwortAuf(sql, spalten) {
    if (!/^SELECT/i.test(sql)) return [];

    const tabelle = (sql.match(/FROM (streaming_music_\w+)/i) || [])[1];
    const liste = (sql.match(/^SELECT (.+?) FROM /i) || [])[1] || '';

    // `SELECT *` — die ganze Zeile, wie sie in der Tabelle steht.
    if (liste.trim() === '*') {
        if (!spalten[tabelle]) return [];
        const zeile = {};
        for (const sp of spalten[tabelle]) zeile[sp.COLUMN_NAME] = wertFuer(sp.DATA_TYPE);
        return [zeile];
    }

    // Sonst: genau die Namen, die dastehen — inklusive `… AS pos`.
    const zeile = {};
    for (const teil of liste.split(',')) {
        const alias = (teil.match(/\bAS\s+(\w+)\s*$/i) || [])[1];
        const name = alias || teil.trim();
        if (!/^\w+$/.test(name)) continue;
        const sp = (spalten[tabelle] || []).find((x) => x.COLUMN_NAME === name);
        zeile[name] = wertFuer(sp ? sp.DATA_TYPE : 'int');
    }
    return Object.keys(zeile).length ? [zeile] : [];
}

/**
 * Das Modul einmal komplett durchlaufen lassen.
 *
 * @param {Object} musik Das geladene Modul
 * @param {Array} gesehen Sammelstelle, wird gefuellt
 * @returns {Promise<Array<{name: string, fehler: string|null}>>} Je Aufruf ein Ergebnis
 */
async function durchlauf(musik, gesehen) {
    // Die Argumente sind so gewaehlt, dass beide Zweige eines Ternaers
    // drankommen, wo es einen gibt: `springen` vor und zurueck, `abspielen`
    // an und aus, `warteschlange` mit und ohne Einschraenkung.
    const aufrufe = [
        ['zustand',           () => musik.zustand(GUILD)],
        ['schluesselNeu',     () => musik.schluesselNeu(GUILD)],
        ['guildZuSchluessel', () => musik.guildZuSchluessel('a'.repeat(64))],
        ['playerGesehen',     () => musik.playerGesehen(GUILD)],
        ['warteschlange',     () => musik.warteschlange(GUILD)],
        ['warteschlange (nur offene)', () => musik.warteschlange(GUILD, { nurOffene: true, grenze: 10 })],
        ['aktueller',         () => musik.aktueller(GUILD)],
        ['wuenschen',         () => musik.wuenschen(GUILD, 1, 'Probe', 'jemand')],
        ['springen (vor)',    () => musik.springen(GUILD, 'vor')],
        ['springen (zurueck)', () => musik.springen(GUILD, 'zurueck')],
        ['abspielen (an)',    () => musik.abspielen(GUILD, true)],
        ['abspielen (aus)',   () => musik.abspielen(GUILD, false)],
        ['nachlegen',         () => musik.nachlegen(GUILD, null)],
        ['naechster',         () => musik.naechster(GUILD)],
        ['ablageAufzaehlen',  () => musik.ablageAufzaehlen(GUILD)],
        ['ablageEinreihen',   () => musik.ablageEinreihen(GUILD)],
        ['endlosSchalten',    () => musik.endlosSchalten(GUILD, true)],
        ['beenden',           () => musik.beenden(GUILD)],
        ['leeren',            () => musik.leeren(GUILD)],
        ['aufraeumen',        () => musik.aufraeumen()]
    ];

    const ergebnisse = [];
    for (const [name, ruf] of aufrufe) {
        const vorher = gesehen.length;
        try {
            await ruf();
            ergebnisse.push({ name, fehler: null, abfragen: gesehen.length - vorher });
        } catch (fehler) {
            // Ein Absturz ist selbst ein Befund. Im leeren Lauf heisst er: Der
            // Code liest `[0].spalte`, ohne den Leerfall zu pruefen — im Betrieb
            // faellt er um, sobald die Tabelle leer ist.
            ergebnisse.push({ name, fehler: fehler.message, abfragen: gesehen.length - vorher });
        }
    }
    return ergebnisse;
}

/** @returns {Promise<void>} */
async function lauf() {
    console.log('▸ Die SQL von shared/musikwunsch.js gegen das echte Schema\n');

    let verbindung;
    try {
        verbindung = await mysql.createConnection({
            host: process.env.MYSQL_HOST,
            user: process.env.MYSQL_USER,
            password: process.env.MYSQL_PASSWORD,
            database: process.env.MYSQL_DATABASE,
            port: process.env.MYSQL_PORT || 3306
        });
    } catch (fehler) {
        console.log(`⚠ AUSGEFALLEN — keine Datenbank: ${fehler.message}`);
        console.log('  Kein Rueckfall auf „in Ordnung": ohne Schema misst dieser Waechter nichts.');
        process.exit(2);
    }

    // Die Spalten aus der Datenbank gelesen statt notiert. Eine gepflegte Liste
    // hier waere eine zweite Wahrheit neben dem Schema und wuerde genau dann
    // falsch, wenn eine Migration etwas aendert.
    const spalten = {};
    for (const tabelle of TABELLEN) {
        const [zeilen] = await verbindung.query(
            `SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
              WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
            [process.env.MYSQL_DATABASE, tabelle]);
        spalten[tabelle] = zeilen;
    }

    const fehlend = TABELLEN.filter((t) => !spalten[t].length);
    if (fehlend.length) {
        console.log(`⚠ AUSGEFALLEN — es fehlt: ${fehlend.join(', ')}.`);
        console.log('  Die Migration ist nicht gelaufen — dann misst dieser Waechter nichts.');
        await verbindung.end();
        process.exit(2);
    }

    /** Jede Abfrage, die das Modul abgesetzt hat, ueber beide Laeufe. */
    const gesehen = [];
    /** Steht auf `true`, wenn die Attrappe leer antworten soll. */
    let leererLauf = true;

    ServiceManager.register('Logger', { info() {}, warn() {}, error() {}, debug() {} });
    ServiceManager.register('dbService', {
        /**
         * @param {string} sql Die Abfrage
         * @param {Array} [werte] Die Parameter
         * @returns {Promise<Array>} Leer oder das, was die Abfrage erfragt hat
         */
        async query(sql, werte) {
            const text = String(sql).replace(/\s+/g, ' ').trim();
            gesehen.push({ sql: text, werte });
            if (gesehen.length > OBERGRENZE) {
                throw new Error(`mehr als ${OBERGRENZE} Abfragen — sieht nach einer Schleife aus`);
            }
            return leererLauf ? [] : antwortAuf(text, spalten);
        }
    });

    // ── Die Ablage ───────────────────────────────────────────────────────
    //
    // **Der Name ist nicht frei waehlbar.** `ablage()` fragt
    // `MusikablageRegistry.fuerStream()`, und das sucht genau den Namen
    // `music`. Im ersten Entwurf hiess die Attrappe anders — Folge: `ablage()`
    // gab `null`, und `wuenschen`, `nachlegen` und `ablageEinreihen` stiegen
    // aus, bevor sie eine Abfrage absetzten. Alle drei `INSERT` blieben
    // ungeprueft, und nur die Abdeckungszaehlung unten hat es verraten.
    MusikablageRegistry.leeren();
    MusikablageRegistry.register('music', {
        async verfuegbar() { return true; },
        async suchen() { return [{ id: 7, titel: 'Probe', dauerSek: 123 }]; },
        async stueck() { return { id: 7, titel: 'Probe', dauerSek: 123 }; },
        async tonquelle() { return { art: 'datei', pfad: '/dev/null' }; }
    });

    const musik = require(path.join(WURZEL, MODUL));

    console.log('1. Findet das Modul seine Ablage?\n');
    // Ohne diese Pruefung waere der Rest lautlos halb so viel wert: Ist die
    // Ablage nicht da, misst der Waechter drei Funktionen weniger und sagt es
    // nur in der Abdeckungszaehlung ganz unten.
    pruefe('die Registry gibt die Attrappe unter dem Namen `music` heraus',
        MusikablageRegistry.fuerStream() !== null,
        'fuerStream() liefert null — dann bleiben alle drei INSERT ungeprueft');

    // ── Zwei Laeufe ──────────────────────────────────────────────────────
    console.log('\n2. Laeuft jede Funktion durch — bei leeren und bei gefuellten Tabellen?\n');

    for (const leer of [true, false]) {
        leererLauf = leer;
        const ergebnisse = await durchlauf(musik, gesehen);
        const kaputt = ergebnisse.filter((e) => e.fehler);
        pruefe(`Lauf „${leer ? 'leer' : 'gefuellt'}": alle ${ergebnisse.length} Funktionen ohne Absturz`,
            kaputt.length === 0,
            kaputt.map((e) => `${e.name}: ${e.fehler}`).join(' | '));
    }

    // ── Jede gesehene Abfrage gegen das Schema ───────────────────────────
    const einmalig = [];
    const schon = new Set();
    for (const eintrag of gesehen) {
        if (schon.has(eintrag.sql)) continue;
        schon.add(eintrag.sql);
        einmalig.push(eintrag);
    }

    console.log(`\n3. Jede abgesetzte Abfrage durch MySQLs PREPARE ` +
        `(${einmalig.length} verschiedene aus ${gesehen.length} Aufrufen)\n`);

    for (const { sql } of einmalig) {
        const kurz = sql.length > 78 ? `${sql.slice(0, 75)}…` : sql;
        const fehler = await vorbereiten(verbindung, sql);
        pruefe(kurz, fehler === null, fehler);
    }

    pruefe('ueberhaupt Abfragen gesehen', einmalig.length > 0,
        'das Modul hat keine einzige abgesetzt — dann misst dieser Waechter nichts');

    // ── Abdeckung: was nie erreicht wurde ────────────────────────────────
    console.log('\n4. Welche Stellen im Quelltext wurden nicht erreicht?\n');

    const stellen = stellenImQuelltext();
    const gesehenerText = einmalig.map((e) => e.sql).join('\n').toUpperCase();

    /**
     * Ein Stueck der Abfrage, das sich in den gesehenen wiederfinden laesst.
     *
     * @param {string} auszug Die Quelltextzeile und ihre zwei Nachfolger
     * @returns {string|null} Suchbegriff oder null
     */
    const fingerabdruck = (auszug) => {
        const treffer = auszug.match(
            /\b(SELECT [^`'"]{0,40}?FROM \w+|INSERT (?:IGNORE )?INTO \w+|UPDATE \w+|DELETE (?:\w+ )?FROM \w+)/i);
        return treffer ? treffer[1].replace(/\s+/g, ' ') : null;
    };

    const unerreicht = [];
    const unlesbar = [];
    for (const stelle of stellen) {
        const abdruck = fingerabdruck(stelle.auszug);
        if (!abdruck) {
            // Nicht stillschweigend ueberspringen: Eine Stelle, deren Abfrage
            // erst weiter unten beginnt, ist nicht „in Ordnung", sie ist
            // ungemessen. Sie kommt namentlich in den Bericht.
            unlesbar.push(stelle);
            continue;
        }
        if (!gesehenerText.includes(abdruck.toUpperCase())) {
            unerreicht.push({ ...stelle, abdruck });
        }
    }

    console.log(`  ${stellen.length} \`db().query(\`-Stellen im Quelltext, ` +
        `${einmalig.length} verschiedene Abfragen gesehen.`);
    for (const s of unlesbar) {
        console.log(`  – Zeile ${s.zeile}: Abfrage beginnt weiter unten, nicht zuzuordnen`);
    }

    pruefe('jede zuzuordnende Stelle wurde auch erreicht', unerreicht.length === 0,
        unerreicht.map((s) => `Zeile ${s.zeile} (${s.abdruck})`).join(', '));
    pruefe('keine Stelle blieb unlesbar', unlesbar.length === 0,
        unlesbar.map((s) => `Zeile ${s.zeile}`).join(', '));

    await verbindung.end();

    console.log(`\nErgebnis: ${geprueft} Pruefungen, ${gescheitert} Abweichungen.`);
    process.exit(gescheitert === 0 ? 0 : 1);
}

lauf().catch((fehler) => {
    console.error(`⚠ AUSGEFALLEN: ${fehler.stack}`);
    process.exit(2);
});
