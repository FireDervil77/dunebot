#!/usr/bin/env node
/**
 * Prueft die **Live-Ansage im Twitch-Chat** (Stufe 13c) - vom Text bis zu den
 * drei Zusagen, die wir dafuer schulden.
 *
 * ## Warum dieses Skript existiert
 *
 * Der Bot schreibt unter dem **Namen des Streamers** (entschieden 2026-08-29,
 * 14-Rechte-neu-denken.md, 17.4). Daraus folgen drei Dinge, die 17.5
 * "nicht verhandelbar" nennt - und genau die pruefen die Abschnitte 4 bis 6:
 *
 *     1. Es muss dastehen         der Satz steht in der Zusage, im Profil
 *                                 und auf der Chatbot-Seite
 *     2. Aus-Schalter wirkt sofort ein wartender Auftrag, dessen Schalter
 *                                 umgelegt wurde, sendet NICHT mehr
 *     3. Widerruf greift          ohne Zusage schweigt der Bot, und der
 *                                 Grund liest sich als Entscheidung, nicht
 *                                 als Stoerung
 *
 * Dazu die Falle, an der es sonst still scheitert: **HTTP 200 heisst bei
 * Twitch nicht, dass die Nachricht im Chat steht.** `is_sent: false` mit
 * `drop_reason` ist ein Erfolg auf der Leitung und ein Ausfall in der Sache.
 *
 * Nebenwirkungsfrei: Datenbank, Twitch und Protokoll sind Attrappen. Es geht
 * nichts ins Netz und nichts in die echte Datenbank.
 *
 *   node scripts/check-chatansage.js
 *
 * Exitcode 1 bei jeder Abweichung.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');
const { ServiceManager } = require('dunebot-core');

const WURZEL = path.join(__dirname, '..');

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
 * Denselben Text ohne Kommentare.
 *
 * **Aus Erfahrung, und zwar aus der von heute:** Die Pruefung "die Migration
 * destrukturiert nicht" schlug fehl - an dem Kommentar, der genau davor warnt.
 * Ein Greifer ueber Quelltext greift auch die Prosa darueber, und dann misst er
 * die Warnung statt der Sache.
 *
 * Reicht fuer diesen Zweck: `//` bis Zeilenende und Bloecke. Es ist kein
 * Parser und soll keiner sein - Zeichenketten mit `//` darin (etwa `https://`)
 * ueberlebt es nicht. Deshalb nur dort einsetzen, wo nach **Code** gesucht
 * wird, nicht nach Text.
 *
 * @param {string} text Quelltext
 * @returns {string} Quelltext ohne Kommentare
 */
const ohneKommentare = (text) => String(text)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');

/**
 * Ein Modul durch eine Attrappe ersetzen, bevor es jemand einbindet.
 *
 * @param {string} p Pfad ab Projektwurzel
 * @param {Object} attrappe Was stattdessen herauskommt
 * @returns {void}
 */
function stattdessen(p, attrappe) {
    const voll = require.resolve(path.join(WURZEL, p));
    const m = new Module(voll, null);
    m.filename = voll;
    m.loaded = true;
    m.exports = attrappe;
    require.cache[voll] = m;
}

const stillerLogger = { info() {}, warn() {}, error() {}, debug() {}, success() {} };

// =====================================================================
// Die Welt, in der der Ausgang laeuft - je Fall neu gestellt
// =====================================================================

/** @type {Object} */
let welt;

/** @returns {void} Setzt die Welt auf den Normalfall zurueck */
function weltZuruecksetzen() {
    welt = {
        // Die Zeile in `streaming_streamers` samt Zustand
        streamer: {
            id: 7, plattform: 'twitch', kanal_id: '77', login: 'firedervil',
            anzeigename: 'FireDervil', heim_guild_id: '42',
            chat_ansage_an: 1, chat_ansage_text: null,
            titel: 'Rust mit Freunden', kategorie: 'Rust'
        },
        // Wem gehoert der Kanal
        inhaber: '544578232704565262',
        // Hat er die Zusage erteilt? null = widerrufen oder nie erteilt
        zusage: { scopes: 'channel:read:subscriptions user:write:chat' },
        // Was Twitch auf das Senden antwortet
        sendeAntwort: () => ({ ok: true, abgelehnt: false, gesendet: true, nachrichtId: 'm-1', grund: null }),
        // Laesst sich der Auftrag beanspruchen?
        beanspruchbar: true,

        // Mitschrift
        gesendet: [],
        vorgemerkt: [],
        beansprucht: 0,
        abfragen: []
    };
}

const twitchAttrappe = {
    async chatSenden(kanalId, text, zugang) {
        welt.gesendet.push({ kanalId, text, zugang });
        return welt.sendeAntwort();
    }
};

const abonnentenAttrappe = {
    async kanalInhaber() { return welt.inhaber; }
};

const speicherAttrappe = {
    async zusageLesen() { return welt.zusage; },
    async mitZugang(_wer, tun) {
        // **Genau die Bedeutung des echten Speichers:** ohne Zusage `null`,
        // sonst der entschluesselte Schluessel. Wer das anders nachbaut,
        // prueft den Widerruf nicht, sondern seine eigene Attrappe.
        if (!welt.zusage) return null;
        return await tun('zugang-xyz');
    }
};

stattdessen('plugins/streaming/dashboard/plattformen/twitch.js', twitchAttrappe);
stattdessen('plugins/streaming/dashboard/kern/abonnenten.js', abonnentenAttrappe);
stattdessen('apps/dashboard/helpers/Verbindungsspeicher.js', speicherAttrappe);

/**
 * Eine Datenbank-Attrappe, die auf bekannte Fragen antwortet.
 *
 * **Unbekannte Abfragen melden statt zu schweigen.** Eine Attrappe, die auf
 * alles `[]` antwortet, wird bei geaenderter Abfrage lautlos blind - und der
 * Test bleibt gruen, waehrend die Sache kaputt ist.
 */
const dbAttrappe = {
    async query(sql, werte) {
        const flach = String(sql).replace(/\s+/g, ' ').trim();
        welt.abfragen.push({ sql: flach, werte });

        if (flach.startsWith('UPDATE streaming_outbox SET zustand =')) {
            welt.beansprucht++;
            return { affectedRows: welt.beanspruchbar ? 1 : 0 };
        }
        if (flach.includes('FROM streaming_streamers s')) {
            return welt.streamer ? [{ ...welt.streamer }] : [];
        }

        // --- Was `takt.chatAnsageVormerken` fragt und schreibt -------------
        if (flach.startsWith('SELECT heim_guild_id, chat_ansage_an')) {
            return welt.streamer ? [{ ...welt.streamer }] : [];
        }
        if (flach.startsWith('SELECT titel, kategorie FROM streaming_state')) {
            return welt.streamer
                ? [{ titel: welt.streamer.titel, kategorie: welt.streamer.kategorie }] : [];
        }
        if (flach.startsWith('INSERT INTO streaming_outbox')) {
            welt.vorgemerkt.push({ sql: flach, werte });
            return { affectedRows: 1, insertId: 99 };
        }

        throw new Error(`Attrappe kennt diese Abfrage nicht: ${flach.slice(0, 90)}`);
    }
};

ServiceManager.register('Logger', stillerLogger);
ServiceManager.register('dbService', dbAttrappe);

const drossel = require(path.join(WURZEL, 'plugins/streaming/dashboard/ausgabe/drossel.js'));
const chatansage = require(path.join(WURZEL, 'plugins/streaming/dashboard/ausgabe/chatansage.js'));
const vorlagen = require(path.join(WURZEL, 'plugins/streaming/shared/vorlagen.js'));

/** Ein Auftrag, wie ihn `takt.chatAnsageVormerken` schreibt. */
const auftrag = (zusatz = {}) => ({
    id: 1, target_id: null, guild_id: '42', aktion: 'chat_ansage',
    nutzlast: JSON.stringify({ streamer_id: 7, ...zusatz }), versuche: 0
});

(async () => {

// ---------------------------------------------------------------------
console.log('\n1. DER TEXT: Platzhalter fuellen, Luecken aufraeumen');
// ---------------------------------------------------------------------

const s = { plattform: 'twitch', login: 'firedervil', anzeigename: 'FireDervil' };

pruefe(chatansage.ansage({ streamer: s, zustand: { titel: 'Rust' } }) === 'Wir sind live! Rust',
    'die Vorgabe fuellt den Titel');

pruefe(chatansage.ansage({ streamer: s, zustand: {} }) === 'Wir sind live!',
    'ohne Titel bleibt ein ganzer Satz stehen',
    'ein "Wir sind live! " mit Leerzeichen am Ende waere schlampig, aber harmlos - ' +
    'gefaehrlich sind die Faelle darunter');

pruefe(chatansage.ansage({ streamer: s, zustand: {}, vorlage: 'Live — {titel} ({kategorie})' }) === 'Live',
    'leere Klammern und der haengende Gedankenstrich verschwinden',
    `bekommen: "${chatansage.ansage({ streamer: s, zustand: {}, vorlage: 'Live — {titel} ({kategorie})' })}" — ` +
    'ein "Live —  ()" stuende unter dem NAMEN des Streamers und saehe nach kaputtem Bot aus');

pruefe(chatansage.ansage({ streamer: s, zustand: { titel: 'X' }, vorlage: '{url}' })
        === 'https://twitch.tv/firedervil',
    'die Adresse kommt aus Plattform und Login');

pruefe(chatansage.ansage({ streamer: s, zustand: { titel: 'A'.repeat(900) } }).length === vorlagen.CHAT_MAX,
    `ein zu langer Titel wird auf ${vorlagen.CHAT_MAX} Zeichen gekuerzt`,
    'Twitch wiese die ganze Nachricht ab - eine gekuerzte Ansage ist besser als keine');

pruefe(chatansage.brauchtAnreicherung(null) === true,
    'die Vorgabe wartet auf die Anreicherung (sie nennt {titel})');
pruefe(chatansage.brauchtAnreicherung('Wir sind live!') === false,
    'ein Text ohne {titel} wartet auf nichts',
    'sonst kaeme jede Ansage 45 s zu spaet, ohne dass es einen Grund gaebe');

// ---------------------------------------------------------------------
console.log('\n2. DIE VORLAGE: was gespeichert werden darf');
// ---------------------------------------------------------------------

pruefe(vorlagen.pruefeChatVorlage('') === null, 'leer ist erlaubt (heisst: nimm die Vorgabe)');
pruefe(vorlagen.pruefeChatVorlage('Live {titel} {kategorie} {url} {streamer} {plattform}') === null,
    'alle fuenf Chat-Platzhalter sind erlaubt');
pruefe(vorlagen.pruefeChatVorlage('x'.repeat(501)) === 'zu_lang',
    '501 Zeichen werden abgelehnt');
pruefe(vorlagen.pruefeChatVorlage('{erfunden}') === 'platzhalter',
    'ein erfundener Platzhalter wird abgelehnt');
pruefe(vorlagen.pruefeChatVorlage('{rolle} ist live') === 'nur_discord',
    '{rolle} bekommt eine EIGENE Meldung, nicht "unbekannt"',
    'der Streamer hat ihn auf der Ankuendigungsseite gesehen - "gibt es nicht" haelt er fuer einen Fehler');
pruefe(vorlagen.pruefeChatVorlage('{dauer}') === 'nur_discord',
    '{dauer} ebenso - beim Streamstart gibt es keine Dauer');

// ---------------------------------------------------------------------
console.log('\n3. DER NORMALFALL: die Ansage geht hinaus');
// ---------------------------------------------------------------------

weltZuruecksetzen();
let e = await drossel.chatAnsageSenden(auftrag());

pruefe(e.ok === true, 'ein vollstaendiger Fall wird gesendet', JSON.stringify(e));
pruefe(welt.gesendet.length === 1, 'genau einmal');
pruefe(welt.gesendet[0]?.kanalId === '77', 'in den Kanal des Streamers');
pruefe(welt.gesendet[0]?.text === 'Wir sind live! Rust mit Freunden',
    'mit dem gefuellten Text', `bekommen: "${welt.gesendet[0]?.text}"`);
pruefe(welt.beansprucht === 1, 'und der Auftrag wurde vorher beansprucht',
    'ohne Beanspruchung koennte ein zweiter Lauf dieselbe Zeile ein zweites Mal senden');

// ---------------------------------------------------------------------
console.log('\n4. ZUSAGE 1 aus 17.5: es muss DASTEHEN');
// ---------------------------------------------------------------------

const registrierung = lies('plugins/streaming/dashboard/index.js');
const profilKern    = lies('plugins/streaming/dashboard/kern/meinkanal.js');
const seite         = lies('plugins/streaming/dashboard/views/guild/streaming-chatbot.ejs');

pruefe(/chatschreiben:\s*\{/.test(registrierung),
    'die Zusage `chatschreiben` ist angemeldet');
pruefe(/scopes:\s*\['user:write:chat'\]/.test(registrierung),
    'sie erbittet genau `user:write:chat`',
    'ein Scope mehr "zur Sicherheit" waere eine Berechtigung, die nichts freischaltet');
pruefe(/unter deinem Namen/.test(registrierung),
    'ihr Hinweis sagt "unter deinem Namen" - im Dialog, vor dem Klick');
pruefe(/unter meinem Namen/.test(profilKern),
    'das Profil traegt dieselbe Aussage als eigene Zeile');
pruefe(/unter dem Namen \$\{name\}/.test(seite),
    'die Chatbot-Seite nennt den Namen im Kasten ueber dem Schalter',
    'eine Fussnote genuegt nach 17.5 ausdruecklich nicht');

// ---------------------------------------------------------------------
console.log('\n5. ZUSAGE 2 aus 17.5: der Aus-Schalter wirkt SOFORT');
// ---------------------------------------------------------------------

weltZuruecksetzen();
welt.streamer.chat_ansage_an = 0;
e = await drossel.chatAnsageSenden(auftrag());

pruefe(welt.gesendet.length === 0,
    'ein wartender Auftrag sendet nicht mehr, wenn der Schalter inzwischen aus ist',
    'wuerde der Schalter nur beim Vormerken geprueft, wirkte er erst beim naechsten Stream');
pruefe(e.ok === true && e.endgueltig === true,
    'und das gilt als erledigt, nicht als Fehlschlag',
    'ein Fehlschlag stuende rot auf der Seite - abgeschaltet ist aber kein Fehler');

weltZuruecksetzen();
welt.streamer.heim_guild_id = null;
e = await drossel.chatAnsageSenden(auftrag());
pruefe(welt.gesendet.length === 0 && e.ok === true,
    'ohne Heim-Guild schweigt der Bot ebenfalls',
    'der Ort, an dem das bedient wird, ist dann weg - und mit ihm die Verantwortung');

// ---------------------------------------------------------------------
console.log('\n6. ZUSAGE 3 aus 17.5: der Widerruf greift');
// ---------------------------------------------------------------------

weltZuruecksetzen();
welt.zusage = null;
e = await drossel.chatAnsageSenden(auftrag());

pruefe(welt.gesendet.length === 0, 'ohne Zusage wird nichts gesendet');
pruefe(e.ok === false && e.endgueltig === true, 'und es wird nicht wiederholt');
pruefe(/nicht \(mehr\) erlaubt/.test(String(e.fehler)),
    'der Grund liest sich als Entscheidung des Streamers, nicht als Stoerung',
    `bekommen: "${e.fehler}"`);

// ---------------------------------------------------------------------
console.log('\n7. DIE FALLE: HTTP 200 heisst nicht "steht im Chat"');
// ---------------------------------------------------------------------

weltZuruecksetzen();
welt.sendeAntwort = () => ({
    ok: true, abgelehnt: false, gesendet: false, nachrichtId: null,
    grund: 'Your message was flagged by AutoMod'
});
e = await drossel.chatAnsageSenden(auftrag());

pruefe(e.ok === false,
    '`is_sent: false` gilt als Fehlschlag, nicht als Erfolg',
    'sonst stuende auf der Seite "gesendet" und im Chat nichts - die halbe Auskunft');
pruefe(/AutoMod/.test(String(e.fehler)),
    'und Twitchs Grund wird durchgereicht, nicht gedeutet');

const twitchQuelle = lies('plugins/streaming/dashboard/plattformen/twitch.js');
pruefe(/is_sent/.test(twitchQuelle),
    '`chatSenden` liest `is_sent` ueberhaupt aus');
pruefe(/drop_reason/.test(twitchQuelle),
    'und den `drop_reason` dazu');
pruefe(/broadcaster_id: String\(kanalId\)[\s\S]{0,80}sender_id: String\(kanalId\)/.test(twitchQuelle),
    'Absender und Kanal sind dieselbe Kennung',
    'nur so erscheint die Zeile unter dem Namen des Streamers - das ist die ganze Entscheidung von 17.4');

// ---------------------------------------------------------------------
console.log('\n8. EIN VERSUCH, KEIN ZWEITER');
// ---------------------------------------------------------------------

weltZuruecksetzen();
welt.sendeAntwort = () => ({ ok: false, abgelehnt: false, gesendet: false, nachrichtId: null, grund: 'HTTP 500' });
e = await drossel.chatAnsageSenden(auftrag());
pruefe(e.endgueltig === true,
    'auch ein technischer Fehlschlag wird NICHT wiederholt',
    'eine verlorene Antwort koennte bedeuten, dass die Zeile sehr wohl steht - ' +
    'fuenf Versuche waeren fuenf "Wir sind live!" unter seinem Namen');

weltZuruecksetzen();
welt.beanspruchbar = false;
e = await drossel.chatAnsageSenden(auftrag());
pruefe(welt.gesendet.length === 0,
    'ein Auftrag, den ein anderer Lauf schon hat, wird nicht doppelt gesendet');

weltZuruecksetzen();
welt.streamer = null;
e = await drossel.chatAnsageSenden(auftrag());
pruefe(e.ok === false && e.endgueltig === true && welt.gesendet.length === 0,
    'ein geloeschter Kanal endet endgueltig, ohne zu senden');

// ---------------------------------------------------------------------
console.log('\n9. DAS VORMERKEN laeuft wirklich');
// ---------------------------------------------------------------------
//
// **Nicht nur die Verdrahtung lesen, sondern die Funktion rufen.** Ein
// falscher Spaltenname im INSERT faellt beim Lesen des Quelltextes nicht auf -
// er faellt beim ersten echten Streamstart auf, und dann ist der Augenblick
// vorbei (echte-laeufe-finden-mehr).

const takt = require(path.join(WURZEL, 'plugins/streaming/dashboard/kern/takt.js'));

weltZuruecksetzen();
let vorgemerkt = await takt.chatAnsageVormerken({ id: 7, login: 'firedervil' });
pruefe(vorgemerkt === true && welt.vorgemerkt.length === 1,
    'ein eingeschalteter Kanal mit Heim bekommt genau einen Auftrag');
pruefe(String(welt.vorgemerkt[0]?.werte?.[0]) === '42',
    'der Auftrag traegt die Heim-Guild', `bekommen: ${welt.vorgemerkt[0]?.werte?.[0]}`);
pruefe(JSON.parse(welt.vorgemerkt[0]?.werte?.[1] || '{}').streamer_id === 7,
    'und den Kanal in der Nutzlast');
pruefe(Number(welt.vorgemerkt[0]?.werte?.[2]) === 0,
    'mit Titel wartet er nicht',
    'die Anreicherung ist schon durch - eine Frist waere nur Verzoegerung');

weltZuruecksetzen();
welt.streamer.titel = null;
welt.streamer.kategorie = null;
await takt.chatAnsageVormerken({ id: 7, login: 'firedervil' });
pruefe(Number(welt.vorgemerkt[0]?.werte?.[2]) === takt.ANSAGE_WARTEN_MS * 1000,
    'ohne Titel wartet er auf die Anreicherung',
    'eine Chatnachricht laesst sich nicht nachtraeglich bearbeiten - anders als die im Discord');

weltZuruecksetzen();
welt.streamer.titel = null;
welt.streamer.chat_ansage_text = 'Wir sind live!';
await takt.chatAnsageVormerken({ id: 7, login: 'firedervil' });
pruefe(Number(welt.vorgemerkt[0]?.werte?.[2]) === 0,
    'ein Text ohne {titel} wartet auch ohne Titel nicht');

weltZuruecksetzen();
welt.streamer.chat_ansage_an = 0;
vorgemerkt = await takt.chatAnsageVormerken({ id: 7, login: 'firedervil' });
pruefe(vorgemerkt === false && welt.vorgemerkt.length === 0,
    'ist die Ansage aus, entsteht gar kein Auftrag');

weltZuruecksetzen();
welt.streamer.heim_guild_id = null;
vorgemerkt = await takt.chatAnsageVormerken({ id: 7, login: 'firedervil' });
pruefe(vorgemerkt === false && welt.vorgemerkt.length === 0,
    'ohne Heim-Guild ebenso',
    'die Outbox braucht eine `guild_id` - und ohne Heim gibt es keinen Ort, der zustaendig waere');

// ---------------------------------------------------------------------
console.log('\n10. DIE VERDRAHTUNG: Recht und Reihenfolge');
// ---------------------------------------------------------------------

const taktQuelle    = lies('plugins/streaming/dashboard/kern/takt.js');
const drosselQuelle = lies('plugins/streaming/dashboard/ausgabe/drossel.js');
const routerQuelle  = lies('plugins/streaming/dashboard/routes/guild.router.js');

pruefe(/chatAnsageVormerken\(streamer\)/.test(taktQuelle),
    '`gingLive` merkt die Ansage vor',
    'ohne Aufrufer waere die ganze Kette ein Blindgaenger (vorhanden-heisst-nicht-funktioniert)');
pruefe(taktQuelle.indexOf('chatAnsageVormerken(streamer)') > taktQuelle.indexOf("auffaechern(streamer.id, 'posten')"),
    'und zwar NACH der Entscheidung "wird ueberhaupt gemeldet"',
    'sonst kaeme nach jedem Verbindungsabriss ein zweites "Wir sind live!" in den Chat');
pruefe(/aktion === 'chat_ansage'/.test(drosselQuelle),
    'der Ausgang kennt die Aktion');
pruefe(drosselQuelle.indexOf("aktion === 'chat_ansage'") < drosselQuelle.indexOf('await umfeldLaden(auftrag)'),
    'und behandelt sie VOR `umfeldLaden`',
    'sie hat kein Ziel - `umfeldLaden` wuerde sie mit "Ziel existiert nicht mehr" wegwerfen');
pruefe(!/BRAUCHT_KANAL = new Set\(\[[^\]]*chat_ansage/.test(drosselQuelle),
    'sie steht NICHT in `BRAUCHT_KANAL`',
    'das ist die Discord-Kanalgrenze; eine Twitch-Ansage faellt nicht darunter');

pruefe(/router\.post\('\/chatbot\/ansage', requirePermission\('STREAMING\.CHAT\.MANAGE'\)/.test(routerQuelle),
    'das Speichern haengt an STREAMING.CHAT.MANAGE');
pruefe(/router\.post\('\/chatbot\/probe', requirePermission\('STREAMING\.CHAT\.MANAGE'\)/.test(routerQuelle),
    'die Probe ebenso');
pruefe(/WHERE id = \? AND heim_guild_id = \?/.test(routerQuelle),
    'und beide schreiben nur, wenn der Kanal DIESER Guild sein Heim gab',
    'ohne diese Bedingung stellte eine fremde Guild den Chat eines fremden Kanals ein');

const zusageName = require(path.join(WURZEL, 'plugins/streaming/dashboard/kern/meinkanal.js')).SCHREIB_ZUSAGE;
pruefe(new RegExp(`${zusageName}:\\s*\\{`).test(registrierung),
    `der Name der Zusage ("${zusageName}") stimmt mit der Registrierung ueberein`,
    'er steht an zwei Stellen - wer eine umbenennt, bricht den Weg zum Erlauben');

// ---------------------------------------------------------------------
console.log('\n11. DIE MIGRATION');
// ---------------------------------------------------------------------

const migration = lies('plugins/streaming/migrations/20260830_090000_chat_ansage.js');
pruefe(!/const \[[a-z]+\] = await db\.query/.test(ohneKommentare(migration)),
    'die Waechterabfrage destrukturiert nicht',
    '`const [x] = await db.query()` griffe die erste ZEILE - die Pruefung liefe ins Leere');
pruefe(/chat_ansage_an TINYINT\(1\) NOT NULL DEFAULT 0/.test(migration),
    'der Schalter steht auf AUS',
    'ein Text, der ungefragt unter seinem Namen erscheint, waere eine Aussage, die er nie getroffen hat');
pruefe(/VARCHAR\(500\)/.test(migration),
    'das Textfeld ist so gross wie Twitchs Grenze, nicht groesser');

// =====================================================================
console.log('\n' + '─'.repeat(64));
if (abweichungen === 0) {
    console.log(`✓ ${faelle} Pruefungen, keine Abweichung.`);
    console.log('  Die Ansage traegt — und die drei Zusagen aus 17.5 stehen.\n');
    process.exit(0);
}
console.log(`✗ ${abweichungen} von ${faelle} Pruefungen schlagen fehl.\n`);
process.exit(1);

})().catch(err => {
    console.error('\nDer Lauf selbst ist gescheitert:', err);
    process.exit(2);
});
