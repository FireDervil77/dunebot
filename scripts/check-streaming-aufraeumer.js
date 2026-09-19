#!/usr/bin/env node
/**
 * Wird im Streaming-Plugin alles weggeraeumt, was eine Frist hat?
 *
 * ## Der Befund (Baustelle 142, 2026-09-19)
 *
 * `shared/lose.js` und `shared/musikwunsch.js` hatten von Anfang an eine Frist
 * und eine `aufraeumen()` - aber keinen Aufrufer. Die Frist, die gespeicherte
 * Twitch-Kennungen und -Namen wieder loescht, lief nie. Am 19. lagen in der
 * Musikwunsch-Schlange 141 von 426 Zeilen ueber ihr.
 *
 * `check-leerlauf.js` hat das nicht gefunden, vermutlich weil der Name
 * `aufraeumen` im Projekt auch anderswo vorkommt (Musik-Plugin, Drossel).
 * Dieser Waechter sucht deshalb nicht nach dem Namen, sondern nach dem Weg:
 * Jede exportierte `aufraeumen` im Plugin muss vom taeglichen Lauf
 * (`dashboard/kern/aufraeumen.js`) per `require` erreicht werden.
 *
 * Und er spielt den Lauf durch, gegen eine Attrappe, die unbekannte Abfragen
 * meldet statt sie still zu beantworten.
 *
 *   node scripts/check-streaming-aufraeumer.js
 *
 * Exitcode 1, wenn eine Pruefung scheitert.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { ServiceManager } = require('dunebot-core');
const { ohneKommentare } = require('./lib/quelltext');

const WURZEL = path.join(__dirname, '..');
const PLUGIN = path.join(WURZEL, 'plugins/streaming');
const LAUF = path.join(PLUGIN, 'dashboard/kern/aufraeumen.js');

let faelle = 0, abweichungen = 0;
function pruefe(gut, text, zusatz = '') {
    faelle++;
    if (!gut) abweichungen++;
    console.log(`  ${gut ? '✓' : '✗'} ${text}${zusatz ? '  — ' + zusatz : ''}`);
}

/**
 * Module, die eine `aufraeumen` exportieren, aber bewusst NICHT vom
 * taeglichen Lauf gerufen werden. Jeder Eintrag braucht einen Grund - ein
 * stilles Ueberspringen wuerde genau den Fall verdecken, fuer den es diesen
 * Waechter gibt. Heute leer.
 */
const AUSNAHMEN = {};

// ---------------------------------------------------------------------
console.log('\n1. Jede Frist hat einen Aufrufer');
// ---------------------------------------------------------------------

function dateien(ordner, treffer = []) {
    for (const e of fs.readdirSync(ordner, { withFileTypes: true })) {
        const voll = path.join(ordner, e.name);
        if (e.isDirectory()) { if (e.name !== 'node_modules') dateien(voll, treffer); }
        else if (e.name.endsWith('.js')) treffer.push(voll);
    }
    return treffer;
}

const laufCode = ohneKommentare(fs.readFileSync(LAUF, 'utf8'));
const mitFrist = dateien(PLUGIN)
    .filter(d => d !== LAUF && !d.includes(`${path.sep}migrations${path.sep}`))
    .filter(d => {
        const code = ohneKommentare(fs.readFileSync(d, 'utf8'));
        const definiert = /(^|\n)\s*(async\s+)?function\s+aufraeumen\s*\(/.test(code);
        const exportiert = /module\.exports\s*=\s*\{[\s\S]*?\baufraeumen\b[\s\S]*?\}/.test(code);
        return definiert && exportiert;
    });

pruefe(mitFrist.length >= 2, 'die Suche findet die Aufraeumer ueberhaupt',
    mitFrist.map(d => path.relative(PLUGIN, d)).join(', ') || 'keinen — dann prueft der Rest nichts');

for (const datei of mitFrist) {
    const kurz = path.relative(PLUGIN, datei);
    if (AUSNAHMEN[kurz]) { console.log(`  · ${kurz}: Ausnahme — ${AUSNAHMEN[kurz]}`); continue; }

    let rel = path.relative(path.dirname(LAUF), datei).replace(/\.js$/, '').split(path.sep).join('/');
    if (!rel.startsWith('.')) rel = './' + rel;
    const aufruf = new RegExp(`require\\(['"]${rel.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}['"]\\)\\.aufraeumen\\(\\)`);
    pruefe(aufruf.test(laufCode), `${kurz}: der taegliche Lauf ruft ihre aufraeumen()`,
        aufruf.test(laufCode) ? '' : `erwartet: require('${rel}').aufraeumen() in kern/aufraeumen.js`);
}

// ---------------------------------------------------------------------
console.log('\n2. Der Lauf, durchgespielt');
// ---------------------------------------------------------------------

const abfragen = [];
const unbekannt = [];
const fehlerProtokoll = [];
const stoerung = { tabelle: null };

/** Welche Tabelle eine DELETE-Abfrage trifft — und was sie "loescht". */
const BEKANNT = [
    [/^DELETE FROM streaming_events\b/,                              'streaming_events',      2],
    [/^DELETE FROM streaming_outbox\b/,                              'streaming_outbox',      3],
    [/^DELETE m FROM streaming_messages m LEFT JOIN streaming_targets/, 'streaming_messages', 0],
    [/^DELETE s FROM streaming_streamers s WHERE NOT EXISTS/,        'streaming_streamers',   0],
    [/^DELETE FROM streaming_lose WHERE angelegt_am < DATE_SUB\(NOW\(\), INTERVAL \? DAY\)$/, 'streaming_lose', 4],
    [/^DELETE q FROM streaming_music_queue q LEFT JOIN streaming_music_state s ON s\.guild_id = q\.guild_id AND s\.aktuelle_id = q\.id WHERE s\.guild_id IS NULL AND q\.angelegt_am < \(NOW\(\) - INTERVAL \? DAY\)$/,
        'streaming_music_queue', 5]
];

let gespeichert = null;
ServiceManager.register('Logger', {
    info() {}, debug() {}, warn() {}, success() {},
    error: (...a) => fehlerProtokoll.push(a.map(String).join(' '))
});
ServiceManager.register('dbService', {
    async query(sql, werte = []) {
        const s = String(sql).replace(/\s+/g, ' ').trim();
        const treffer = BEKANNT.find(([muster]) => muster.test(s));
        if (!treffer) {
            unbekannt.push(s.slice(0, 90));
            throw new Error('Attrappe kennt die Abfrage nicht: ' + s.slice(0, 90));
        }
        const [, tabelle, anzahl] = treffer;
        abfragen.push({ tabelle, werte });
        if (stoerung.tabelle === tabelle) throw new Error(`Tabelle ${tabelle} gesperrt (Probe)`);
        return { affectedRows: anzahl };
    },
    async setConfig(plugin, schluessel, wert) {
        if (plugin === 'streaming' && schluessel === 'AUFRAEUM_BERICHT') gespeichert = wert;
    },
    async getConfig() { return gespeichert; }
});

const aufraeumen = require(LAUF);

(async () => {
    const bericht = await aufraeumen.lauf();
    const tage = (tabelle) => abfragen.find(a => a.tabelle === tabelle)?.werte?.[0];

    pruefe(tage('streaming_lose') === 30, 'Lose: geloescht wird nach 30 Tagen', String(tage('streaming_lose')));
    pruefe(tage('streaming_music_queue') === 7, 'Musikwuensche: nach 7 Tagen, und nur, was nicht laeuft',
        String(tage('streaming_music_queue')));
    pruefe(bericht.lose?.geloescht === 4 && bericht.lose?.aelter_als_tage === 30,
        'der Bericht nennt Menge und Frist der Lose', JSON.stringify(bericht.lose));
    pruefe(bericht.musikwuensche?.geloescht === 5 && bericht.musikwuensche?.aelter_als_tage === 7,
        'und der Musikwuensche', JSON.stringify(bericht.musikwuensche));
    pruefe(['posteingang', 'ausgang', 'nachrichten', 'streamer'].every(k => typeof bericht[k]?.geloescht === 'number'),
        'die vier alten Schritte laufen weiter');
    pruefe(gespeichert === bericht, 'der Bericht wird fuer die Betriebsseite gespeichert');

    // --- Ein Schritt scheitert ------------------------------------------
    // **Ein Fehler ist kein "0 geloescht".** `musikwunsch.aufraeumen` fing
    // bis zum 2026-09-19 selbst ab und gab 0 zurueck; im Bericht haette dann
    // eine Null gestanden statt eines Fehlers.
    abfragen.length = 0;
    fehlerProtokoll.length = 0;
    stoerung.tabelle = 'streaming_music_queue';
    const mitFehler = await aufraeumen.lauf();
    stoerung.tabelle = null;

    pruefe(Boolean(mitFehler.musikwuensche?.fehler) && mitFehler.musikwuensche?.geloescht === undefined,
        'scheitert ein Schritt, steht ein Fehler im Bericht — keine Null', JSON.stringify(mitFehler.musikwuensche));
    pruefe(fehlerProtokoll.some(z => z.includes('musikwuensche')),
        'und im Protokoll, mit dem Namen des Schritts', fehlerProtokoll[0] || 'nichts protokolliert');
    pruefe(mitFehler.lose?.geloescht === 4 && mitFehler.streamer?.geloescht === 0,
        'die anderen Schritte laufen trotzdem');

    // --- Die Betriebsseite zeigt es -------------------------------------
    // Ohne Kommentare, auch die der Vorlage: Dort steht die Beschreibung der
    // Sache ("bis zum 2026-09-19 stand hier ..."), nicht die Sache.
    const ansicht = ohneKommentare(fs.readFileSync(path.join(PLUGIN, 'dashboard/views/guild/streaming-betrieb.ejs'), 'utf8'))
        .replace(/<%#[\s\S]*?%>/g, '')
        .replace(/<!--[\s\S]*?-->/g, '');
    pruefe(/\['lose',/.test(ansicht) && /\['musikwuensche',/.test(ansicht),
        'die Betriebsseite hat Zeilen fuer Lose und Musikwuensche');
    pruefe(/s\.fehler/.test(ansicht), 'und zeigt einen Fehler als Fehler, nicht als Strich');

    console.log('\n3. Die Attrappe hat alles verstanden');
    pruefe(unbekannt.length === 0, 'keine unbekannte Abfrage', [...new Set(unbekannt)].join(' | '));

    console.log(`\nErgebnis: ${faelle} Pruefungen, ${abweichungen} Abweichung(en).\n`);
    process.exit(abweichungen ? 1 : 0);
})().catch(err => {
    console.error('\nAbbruch:', err.message, '\n', err.stack);
    process.exit(1);
});
