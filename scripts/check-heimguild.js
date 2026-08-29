#!/usr/bin/env node
/**
 * Prueft die **Heim-Guild** (Stufe 14) - den Schnitt, der das Rechteloch vom
 * 2026-08-28 schliesst.
 *
 * Der Befund damals: Der Betreiber gab einem zweiten Streamer Zugriff auf sein
 * Streaming-Plugin und stellte fest, dass damit alles offensteht. Die Antwort
 * ist kein zweites Rechtesystem, sondern eine Spalte:
 *
 *     VERFOLGUNG   beliebig viele Guilds je Kanal   bleibt wie es war
 *     CHATBOT      GENAU EINE Guild je Kanal        heim_guild_id
 *
 * **Die eine Zusage, die dieses Skript bewacht:** Eine Guild darf sich nicht
 * selbst zum Heim erklaeren. Setzen darf nur der Kanalinhaber, nachgewiesen
 * ueber `user_connections`. Alles andere hier stuetzt nur diese eine Sache.
 *
 * Nebenwirkungsfrei: stellt Datenbank und Protokoll durch Attrappen, ruehrt
 * weder die echte Datenbank noch das Netz.
 *
 *   node scripts/check-heimguild.js
 *
 * Exitcode 1 bei jeder Abweichung.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const { ServiceManager } = require('dunebot-core');

const WURZEL = path.join(__dirname, '..');
const KERN = path.join(WURZEL, 'apps/dashboard/themes/default/views');
const PV = path.join(WURZEL, 'plugins/streaming/dashboard/views');

let faelle = 0;
let abweichungen = 0;

/**
 * @param {boolean} gut Bedingung
 * @param {string} text Beschreibung
 * @param {string} [zusatz] Warum es zaehlt
 * @returns {void}
 */
function pruefe(gut, text, zusatz = '') {
    faelle++;
    if (gut) { console.log(`  ✓ ${text}`); return; }
    abweichungen++;
    console.log(`  ✗ ${text}`);
    if (zusatz) console.log(`      → ${zusatz}`);
}

/** @param {string} p Pfad ab Projektwurzel @returns {string} Inhalt */
const lies = (p) => fs.readFileSync(path.join(WURZEL, p), 'utf8');

/**
 * Eine Datenbank-Attrappe, die auf bekannte Fragen antwortet.
 *
 * **Unbekannte Abfragen melden statt zu schweigen.** Eine Attrappe, die auf
 * alles `[]` antwortet, wird bei geaenderter Abfrage lautlos blind - und der
 * Test bleibt gruen, waehrend die Sache kaputt ist.
 *
 * @param {Object} antworten Muster -> Zeilen
 * @returns {Object} Attrappe mit `query` und `gesehen`
 */
function dbAttrappe(antworten) {
    const gesehen = [];
    return {
        gesehen,
        async query(sql, werte) {
            const flach = String(sql).replace(/\s+/g, ' ').trim();
            gesehen.push({ sql: flach, werte });
            for (const [muster, zeilen] of Object.entries(antworten)) {
                if (flach.includes(muster)) {
                    return typeof zeilen === 'function' ? zeilen(werte) : zeilen;
                }
            }
            throw new Error(`Attrappe kennt diese Abfrage nicht: ${flach.slice(0, 90)}`);
        }
    };
}

const stillerLogger = { info() {}, warn() {}, error() {}, debug() {}, success() {} };

(async () => {

// ---------------------------------------------------------------------
console.log('\n1. Die Spalte und ihre Migration');
// ---------------------------------------------------------------------

const mig = 'plugins/streaming/migrations/20260829_150000_heim_guild.js';
pruefe(fs.existsSync(path.join(WURZEL, mig)), 'die Migration liegt da');

const migText = lies(mig);

// **Nur der Code, nicht die Kommentare.** Die erste Fassung dieser Regel las
// die ganze Datei und schlug an der Erklaerung der Falle an, die genau darueber
// im Kommentar steht. Eine Regel, die ihre eigene Dokumentation als Verstoss
// meldet, wird nach dem zweiten Mal ignoriert.
const ohneKommentare = migText
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
pruefe(!/const\s*\[\s*\w+\s*\]\s*=\s*await db\.query/.test(ohneKommentare),
    'die Waechterabfrage zerlegt die Antwort nicht',
    '`const [x] = await db.query()` greift die erste ZEILE — die Pruefung liefe ins Leere');
pruefe(/heim_guild_id/.test(migText) && /streaming_streamers/.test(migText),
    'sie legt `heim_guild_id` an `streaming_streamers` an');
pruefe(!/DROP COLUMN|DROP TABLE/.test(migText),
    'das `down` loescht die Spalte NICHT',
    'ein Rueckbau des Codes ist kein Grund, die Wahl eines Nutzers zu vergessen');

// ---------------------------------------------------------------------
console.log('\n2. Das Recht');
// ---------------------------------------------------------------------

const rechte = JSON.parse(lies('plugins/streaming/dashboard/permissions.json'));
const chat = rechte.permissions.find(r => r.key === 'STREAMING.CHAT.MANAGE');
pruefe(!!chat, 'STREAMING.CHAT.MANAGE ist eingetragen');
pruefe(chat && chat.requires === 'STREAMING.VIEW', 'es setzt STREAMING.VIEW voraus');
pruefe(/Heim-Guild/i.test(chat?.description || ''),
    'die Beschreibung nennt die Heim-Guild',
    'sonst wirkt es wie ein Recht, das ueberall zieht — tut es aber nicht');

// ---------------------------------------------------------------------
console.log('\n3. Nachgesehene Spaltennamen (nicht geratene)');
// ---------------------------------------------------------------------

const hg = lies('plugins/streaming/dashboard/kern/heimguild.js');
pruefe(/g\._id\s+IN \(/.test(hg),
    'die Guilds werden ueber `_id` geholt, nicht ueber `guild_id`',
    'ein falscher Spaltenname stuerzt hier nicht ab — er zeigt still die nackte Kennung');

// **Der Befund vom 2026-08-29, gegen die echte Datenbank gemessen.** Der erste
// Entwurf verband `streaming_targets` direkt mit `guilds` — und warf:
//
//     Illegal mix of collations (utf8mb4_unicode_ci) and (utf8mb4_general_ci)
//
// Der Kern ist `unicode_ci`, die `streaming_*`-Tabellen sind `general_ci`.
// **Eine Attrappe kann das nicht finden** — sie hat keine Kollationen. Also
// wird hier die Bauform bewacht statt des Ergebnisses: keine Kennung aus einer
// Plugin-Tabelle direkt an einer Kern-Spalte. `scripts/check-kollationen.js`
// misst dasselbe an der echten Datenbank.
pruefe(!/g\._id\s*=\s*[a-z]+\.(guild_id|heim_guild_id)/.test(hg),
    'keine Plugin-Spalte wird direkt an `guilds._id` verglichen',
    'die Kollationen weichen ab — so ein Join wirft, statt still falsch zu antworten');
pruefe(/g\.guild_name/.test(hg) && !/COALESCE\(g\.name/.test(hg),
    'der Name kommt aus `guild_name`, nicht aus `name`');
pruefe(/left_at IS NULL/.test(hg),
    'Guilds, aus denen der Bot geflogen ist, stehen nicht zur Auswahl');
pruefe(/plugin_name\s*=\s*'streaming'/.test(hg) && /is_enabled\s*=\s*1/.test(hg),
    'nur Guilds, in denen das Plugin laeuft');

// ---------------------------------------------------------------------
console.log('\n4. DIE ZUSAGE: nur der Inhaber darf setzen');
// ---------------------------------------------------------------------

const heimguild = require(path.join(WURZEL, 'plugins/streaming/dashboard/kern/heimguild.js'));
const STREAMER = { id: 3, plattform: 'twitch', kanal_id: '77', login: 'firedervil', heim_guild_id: null };

/**
 * @param {string|null} inhaber Wer laut `user_connections` der Inhaber ist
 * @param {Array} guilds Waehlbare Guilds
 * @returns {Object} Attrappe
 */
const welt = (inhaber, guilds = [{ guild_id: '42', name: 'Heim', ziele: 1 }]) => dbAttrappe({
    'FROM user_connections': inhaber ? [{ user_id: inhaber }] : [],
    'FROM streaming_targets': guilds.map(g => ({ guild_id: g.guild_id, ziele: g.ziele })),
    'FROM guilds g': guilds.map(g => ({ guild_id: g.guild_id, guild_name: g.name })),
    'UPDATE streaming_streamers': { affectedRows: 1 },
    'FROM streaming_streamers': []
});

ServiceManager.register('Logger', stillerLogger);

// a) Der Inhaber darf
let db = welt('user-A');
ServiceManager.register('dbService', db);
let r = await heimguild.setzen('user-A', { ...STREAMER }, '42');
pruefe(r.ok === true, 'der Kanalinhaber darf seine Heim-Guild setzen', r.grund || '');
pruefe(db.gesehen.some(g => /UPDATE streaming_streamers SET heim_guild_id = \?/.test(g.sql)),
    'und es wird wirklich geschrieben');

// b) Ein Fremder darf NICHT — das ist der ganze Punkt
db = welt('user-A');
ServiceManager.register('dbService', db);
r = await heimguild.setzen('user-B', { ...STREAMER }, '42');
pruefe(r.ok === false, 'ein Fremder darf NICHT setzen',
    'sonst traegt jemand einen fremden Kanal ein, erklaert seine Guild zum Heim und redet in fremdem Chat');
pruefe(/Inhaber/i.test(r.grund || ''), 'und erfaehrt den Grund im Klartext');
pruefe(!db.gesehen.some(g => /UPDATE/.test(g.sql)),
    'bei einem Fremden wird NICHTS geschrieben',
    'ein abgelehnter Versuch, der trotzdem schreibt, ist schlimmer als gar keine Pruefung');

// c) Ohne Nachweis darf niemand
db = welt(null);
ServiceManager.register('dbService', db);
r = await heimguild.setzen('user-A', { ...STREAMER }, '42');
pruefe(r.ok === false && !db.gesehen.some(g => /UPDATE/.test(g.sql)),
    'ohne verknuepftes Konto darf niemand setzen',
    'der Mod-Status beweist, dass ein Bot reden darf — nicht, wer der Mensch ist');

// d) Eine Guild, die nicht zur Auswahl steht, wird abgelehnt
db = welt('user-A', [{ guild_id: '42', name: 'Heim', ziele: 1 }]);
ServiceManager.register('dbService', db);
r = await heimguild.setzen('user-A', { ...STREAMER }, '999');
pruefe(r.ok === false && !db.gesehen.some(g => /UPDATE/.test(g.sql)),
    'eine Guild ausserhalb der Auswahl wird abgelehnt',
    'eine Ziffernpruefung liesse jede beliebige Guild durch');

// e) Abschalten geht immer — es nimmt nur etwas weg
db = welt('user-A');
ServiceManager.register('dbService', db);
r = await heimguild.setzen('user-A', { ...STREAMER, heim_guild_id: '42' }, '');
pruefe(r.ok === true && db.gesehen.some(g => /heim_guild_id = NULL/.test(g.sql)),
    'der Inhaber kann sein Heim wieder abschalten');

// ---------------------------------------------------------------------
console.log('\n5. Der Vertrag der Registry laesst keine halbe Wahl zu');
// ---------------------------------------------------------------------

const R = require(path.join(WURZEL, 'packages/dunebot-sdk/lib/VerbindungsRegistry.js'));
const basis = {
    label: 'P', autorisierUrl: () => 'x', identitaet: async () => ({}),
    einstellungen: { titel: 'T', lesen: async () => [] }
};
let n = 0;
for (const [was, w] of [
    ['ohne setzen()',   { name: 'x', label: 'L', moeglich: async () => [] }],
    ['ohne moeglich()', { name: 'x', label: 'L', setzen: async () => ({ ok: true }) }],
    ['ohne name',       { label: 'L', moeglich: async () => [], setzen: async () => ({ ok: true }) }],
    ['ohne label',      { name: 'x', moeglich: async () => [], setzen: async () => ({ ok: true }) }]
]) {
    let brach = false;
    try {
        R.register(`probe${n++}`, { ...basis, einstellungen: { ...basis.einstellungen, wahl: w } });
    } catch { brach = true; }
    pruefe(brach, `eine Wahl ${was} wird abgelehnt`,
        'ein Auswahlfeld, das nicht speichert, ist eine Attrappe');
}

// Und ein Plugin, das auf `setzen` nicht antwortet, gilt NICHT als Erfolg.
R.register('stumm', {
    ...basis,
    einstellungen: {
        ...basis.einstellungen,
        wahl: { name: 'x', label: 'L', moeglich: async () => [], setzen: async () => undefined }
    }
});
const stumm = await R.einstellungenWahlSetzen('stumm', {}, 'irgendwas');
pruefe(stumm.ok === false, 'ein Plugin, das nicht antwortet, gilt nicht als Erfolg',
    'sonst liest der Nutzer "gespeichert", und nichts ist gespeichert');

// ---------------------------------------------------------------------
console.log('\n6. Der Chatbot-Bereich erscheint nur im Heim');
// ---------------------------------------------------------------------

const index = lies('plugins/streaming/dashboard/index.js');
pruefe(/istHeim\(guildId\)/.test(index),
    'der Menuepunkt haengt an `istHeim`',
    'ein Chatbot-Punkt in jeder verfolgenden Guild waere die Einladung, an fremden Einstellungen zu drehen');
pruefe(/NAV\.CHATBOT[\s\S]{0,200}STREAMING\.CHAT\.MANAGE/.test(index),
    'und traegt STREAMING.CHAT.MANAGE');

const router = lies('plugins/streaming/dashboard/routes/guild.router.js');
pruefe(/router\.get\('\/chatbot', requirePermission\('STREAMING\.CHAT\.MANAGE'\)/.test(router),
    'die Route selbst haengt am Recht',
    'ein Menuepunkt ist keine Sperre — die Adresse laesst sich tippen');
pruefe(/kanaeleDerGuild\(guildId\)/.test(router),
    'die Route zeigt nur Kanaele, die DIESE Guild als Heim haben',
    'sonst stuenden dahinter fremde Kanaele');

pruefe(/navigationAuffrischen/.test(hg) && /navigationAuffrischen/.test(index),
    'nach der Wahl wird die Navigation aufgefrischt',
    '`_registerNavigation` laeuft sonst nur beim Start — die Wahl saehe folgenlos aus');

// ---------------------------------------------------------------------
console.log('\n7. Die Seiten rendern');
// ---------------------------------------------------------------------

const tr = (k) => `«${k}»`;

/**
 * Was die Route der Ansicht mitgibt - **vollstaendig**, nicht nur das, was der
 * gerade gepruefte Zweig braucht.
 *
 * Eine Ansicht greift auf einen fehlenden Namen nicht still zu: EJS wirft eine
 * `ReferenceError`. Genau deshalb steht hier die ganze Liste - laesst die Route
 * kuenftig eine Angabe weg, faellt es hier auf und nicht erst im Betrieb.
 */
const grundgeruest = {
    tr, guildId: '42', meldung: null, fehler: null,
    bericht: null, leitung: { verbunden: false, conduitId: null, fehler: null, chat: [] },
    vorWieLange: () => 'vor 1 Minute',
    hasPermission: () => true,
    csrfToken: 'x'
};

const einKanal = {
    id: 3, login: 'firedervil', anzeigename: 'FireDervil', kanal_id: '77',
    anschluss: { label: 'Bot im Chat', zustand: 'unbekannt', text: 'Nicht abfragbar.' },
    abo: null, empfangen: null
};

for (const [was, daten] of [
    ['leer', { ...grundgeruest, kanaele: [] }],
    ['mit Kanal', { ...grundgeruest, kanaele: [einKanal] }],
    ['mit stehender Leitung', {
        ...grundgeruest,
        leitung: { verbunden: true, conduitId: 'c-1', fehler: null,
                   chat: [{ kanal_id: '77', name: 'FireDervil', anzahl: 12, letzte: new Date() }] },
        bericht: {
            gelaufen_am: new Date().toISOString(), abgebrochen: null,
            gewuenscht: 1, vorhanden: 1, kanaele: [], bestellt: ['FireDervil'],
            abbestellt: [], fehler: []
        },
        kanaele: [{
            ...einKanal,
            anschluss: { label: 'Bot im Chat', zustand: 'ja', text: 'firebot_mod ist Moderator.' },
            abo: { kanal_id: '77', kanal_name: 'FireDervil', zustand: 'bestaetigt', fehler: null },
            empfangen: { kanal_id: '77', name: 'FireDervil', anzahl: 12, letzte: new Date() }
        }]
    }],
    ['mit Abbruch und Ablehnung', {
        ...grundgeruest,
        bericht: {
            gelaufen_am: new Date().toISOString(),
            abgebrochen: 'Mod-Status nicht abfragbar',
            gewuenscht: 0, vorhanden: 0, kanaele: [], bestellt: [], abbestellt: [],
            fehler: ['FireDervil: subscription missing proof of authorization']
        },
        kanaele: [{
            ...einKanal,
            anschluss: { label: 'Bot im Chat', zustand: 'ja', text: 'firebot_mod ist Moderator.' },
            abo: { kanal_id: '77', kanal_name: 'FireDervil', zustand: null,
                   fehler: 'subscription missing proof of authorization' }
        }]
    }]
]) {
    let ok = true, meldung = '';
    try {
        await ejs.renderFile(path.join(PV, 'guild/streaming-chatbot.ejs'), daten,
            { views: [KERN, PV, path.join(PV, 'guild')] });
    } catch (err) { ok = false; meldung = err.message.split('\n')[0]; }
    pruefe(ok, `streaming-chatbot.ejs rendert (${was})`, meldung);
}

let profilOk = true, profilMeldung = '';
try {
    ejs.compile(lies('apps/dashboard/themes/default/views/guild/profile-verbindungen.ejs'),
        { filename: path.join(KERN, 'guild/profile-verbindungen.ejs') });
} catch (err) { profilOk = false; profilMeldung = err.message.split('\n')[0]; }
pruefe(profilOk, 'profile-verbindungen.ejs uebersetzt sich', profilMeldung);

const de = JSON.parse(lies('plugins/streaming/dashboard/locales/de-DE.json'));
const en = JSON.parse(lies('plugins/streaming/dashboard/locales/en-GB.json'));
pruefe(!!de.NAV?.CHATBOT && !!en.NAV?.CHATBOT, 'NAV.CHATBOT ist in beiden Sprachen uebersetzt');

console.log(abweichungen === 0
    ? `\nErgebnis: ${faelle} Pruefungen, 0 Abweichungen.\n`
    : `\nErgebnis: ${faelle} Pruefungen, ${abweichungen} Abweichung(en).\n`);
process.exit(abweichungen === 0 ? 0 : 1);

})().catch(err => { console.error('\nAbbruch:', err.message, '\n', err.stack); process.exit(1); });
