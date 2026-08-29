#!/usr/bin/env node
/**
 * Prueft den Profil-Abschnitt **"Mein Kanal"** (Stufe 13a).
 *
 * Der Abschnitt beantwortet dem Streamer eine einzige Frage - "ist der Bot in
 * meinem Chat?" - und genau daran haengen vier stille Fallen:
 *
 *   1. **`'nein'` statt `'unbekannt'`.** Jeder Abbruchgrund (kein Bot-Konto,
 *      fehlender Scope, 401, Twitch schweigt) darf nur `'unbekannt'` liefern.
 *      Ein Streamer, dem die Seite faelschlich "der Bot ist nicht in deinem
 *      Chat" sagt, sucht den Fehler bei sich und tippt `/mod` ein zweites Mal.
 *      Das ist die halbe Auskunft, die schlimmer ist als keine.
 *   2. **Ein Guild-Recht vor dem Abschnitt.** Die Chat-Einstellungen gehoeren
 *      dem Kanalinhaber (F-18). Laege der Abschnitt hinter `STREAMING.*`,
 *      entschiede die Serverleitung, ob jemand den Bot in SEINEM Chat regeln
 *      darf - und bei einem Streamer in zwei Guilds waere nicht bestimmbar,
 *      wessen Recht zaehlt.
 *   3. **Der fehlende vierte Scope.** Ohne `user:read:moderated_channels` ist
 *      der Abruf ein 401. Wird er nachgereicht, muss der Betreiber das
 *      Bot-Konto ein weiteres Mal zulassen - Twitch gibt einen Schluessel
 *      genau ueber das, wonach der Dialog gefragt hat (siehe ce64ed0).
 *   4. **Eine Ueberschrift ohne Inhalt.** Ist die Liste leer, darf die Seite
 *      gar nichts zeigen - kein "noch keine Daten". Genau diese leeren
 *      Versprechen haben Baustelle 73 ausgeloest.
 *
 * Nebenwirkungsfrei: Attrappen und Quelltext, kein Twitch, keine Datenbank.
 *
 *   node scripts/check-meinkanal.js
 *
 * Exitcode 1 bei jeder Abweichung.
 */
'use strict';

const fs = require('fs');
const path = require('path');

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

(async () => {

// ---------------------------------------------------------------------
console.log('\n1. Der Vertrag in der Registry weist Halbes ab');
// ---------------------------------------------------------------------
const R = require(path.join(WURZEL, 'packages/dunebot-sdk/lib/VerbindungsRegistry'));
const noop = async () => ({});
const grund = { label: 'T', autorisierUrl: noop, identitaet: noop };

let abgewiesen = false;
try { R.register('pruef-a', { ...grund, einstellungen: { titel: 'X' } }); }
catch { abgewiesen = true; }
pruefe(abgewiesen, 'einstellungen ohne lesen() werden abgewiesen',
    'sonst waere es eine Ueberschrift, deren Inhalt nie kommt');

abgewiesen = false;
try { R.register('pruef-b', { ...grund, einstellungen: { lesen: noop } }); }
catch { abgewiesen = true; }
pruefe(abgewiesen, 'einstellungen ohne titel werden abgewiesen');

abgewiesen = false;
try { R.register('pruef-c', { ...grund, einstellungen: 'ja bitte' }); }
catch { abgewiesen = true; }
pruefe(abgewiesen, 'einstellungen, die kein Objekt sind, werden abgewiesen');

R.register('pruef-d', grund);
pruefe(R.get('pruef-d').einstellungen === null,
    'ein Anbieter ohne Abschnitt bleibt unveraendert zulaessig',
    'der Abschnitt ist freiwillig - Twitch war bis 13a ohne');

// ---------------------------------------------------------------------
console.log('\n2. Was klemmt, wird `unbekannt` - nie `nein`');
// ---------------------------------------------------------------------
R.register('pruef-e', { ...grund, einstellungen: {
    titel: 'Mein Kanal', lesen: async () => { throw new Error('503'); } } });
const geplatzt = await R.einstellungenLesen('pruef-e', {}, { warn: () => {} });
pruefe(geplatzt.length === 1 && geplatzt[0].zustand === 'unbekannt',
    'ein Anbieter, der wirft, ergibt eine Zeile `unbekannt`',
    'faellt er auf `nein` zurueck, behauptet die Seite etwas Falsches');
pruefe(geplatzt[0] && geplatzt[0].hinweis === '503',
    'und der Grund geht nicht verloren',
    'schweigen waere die halbe Auskunft aus Baustelle 79');

R.register('pruef-f', { ...grund, einstellungen: {
    titel: 'X', lesen: async () => [
        { label: 'ohne zustand' },
        { label: 'erfunden', zustand: 'vielleicht' },
        { zustand: 'ja' },
        { label: 'echt', zustand: 'ja' }] } });
const geputzt = await R.einstellungenLesen('pruef-f', {});
pruefe(geputzt.every(z => z.zustand !== 'nein'),
    'ein vergessener oder erfundener zustand wird nie zu `nein`');
pruefe(geputzt.filter(z => z.zustand === 'unbekannt').length === 2,
    'sondern zu `unbekannt` (beide Faelle)');
pruefe(geputzt.length === 3,
    'eine Zeile ohne Bezeichnung faellt raus',
    'sie waere ein Zustandsabzeichen, das zu nichts gehoert');

pruefe((await R.einstellungenLesen('gibt-es-nicht', {})).length === 0,
    'ein unbekannter Anbieter ergibt eine leere Liste, keinen Fehler');

// ---------------------------------------------------------------------
console.log('\n3. Der vierte Scope steht VOR der Zustimmung');
// ---------------------------------------------------------------------
const pluginQuelle = lies('plugins/streaming/dashboard/index.js');
const SCOPE = 'user:read:moderated_channels';
const chatbotBlock = pluginQuelle.slice(pluginQuelle.indexOf('chatbot: {'));

pruefe(chatbotBlock.includes(SCOPE),
    `die chatbot-Zusage nennt ${SCOPE}`,
    'ohne ihn endet der Abruf mit 401 - und der Betreiber muesste erneut zulassen');
for (const s of ['user:bot', 'user:read:chat', 'user:write:chat']) {
    pruefe(chatbotBlock.includes(s), `und weiterhin ${s}`,
        'der Dialog muss die VEREINIGUNG erbitten, sonst faellt der alte Scope weg');
}

const alleQuellen = ['plugins/streaming/dashboard/index.js',
                     'plugins/streaming/dashboard/plattformen/twitch.js',
                     'plugins/streaming/dashboard/kern/meinkanal.js'];
// Gesucht wird der Scope als **Wert**, in Anfuehrungszeichen - nicht im
// Fliesstext. Die erste Fassung dieser Regel schlug an meinem eigenen
// Kommentar an, der festhaelt, dass es ihn nicht gibt; sie haette damit
// verboten, den Irrtum zu dokumentieren.
pruefe(alleQuellen.every(f => !/['"`]moderator:read:channels['"`]\s*[,\]]/.test(lies(f))),
    'der erfundene Scope `moderator:read:channels` wird nirgends benutzt',
    'er existiert bei Twitch nicht - am 2026-08-28 in der Scope-Liste gegengeprueft');

// ---------------------------------------------------------------------
console.log('\n4. Gefragt wird mit dem Schluessel der Anlage');
// ---------------------------------------------------------------------
const twitchQuelle = lies('plugins/streaming/dashboard/plattformen/twitch.js');
const modFn = twitchQuelle.slice(twitchQuelle.indexOf('async function moderierteKanaele'),
                                 twitchQuelle.indexOf('* Aus einem Abo-Ereignis'));

pruefe(/moderation\/channels/.test(modFn),
    'moderierteKanaele fragt /moderation/channels ab',
    '/moderation/moderators waere die Gegenrichtung und braeuchte einen Scope JEDES Streamers');
pruefe(/antwort\.status === 401/.test(modFn) && /abgelehnt: true/.test(modFn),
    'ein 401 wird als `abgelehnt` gemeldet, nicht als leere Liste',
    'sonst saehe ein abgelaufener Schluessel aus wie ein ueberall entmoddeter Bot');
pruefe(/pagination/.test(modFn),
    'und die Liste wird durchgeblaettert',
    'ab 101 moderierten Kanaelen fehlten sonst welche - lautlos');

const meinkanalQuelle = lies('plugins/streaming/dashboard/kern/meinkanal.js');
pruefe(/mitBetreiberZugang/.test(meinkanalQuelle) && !/mitZugang\(/.test(meinkanalQuelle),
    'meinkanal nimmt den Anlagen-Schluessel, nie den des Streamers',
    'der Streamer erteilt fuer diese Anzeige nichts');

// **Die wichtigste Regel dieser Datei.** Jeder Abbruch endet bei `unbekannt`.
//
// Sie stand bis zum 2026-08-29 als "es gibt genau EINE Stelle mit `nein`". Das
// war richtig, solange die Datei eine Zeile hatte - aber eine Zahl sagt nicht,
// WARUM. Mit der Heim-Guild kam eine zweite Stelle dazu, und die Zahl von 1 auf
// 2 zu setzen waere die schwache Reparatur gewesen: Beim naechsten Mal steht
// dort 3, und niemand weiss mehr, welche der drei je geprueft wurde.
//
// Jetzt traegt jede erlaubte Stelle ihren Grund. `nein` ist zulaessig, wo die
// Antwort **gelesen** wurde und leer war - nie, wo eine Abfrage klemmte.
const ERLAUBTES_NEIN = [
    ['Bot in meinem Chat',
     'Die Liste der moderierten Kanaele kam an und der Kanal stand nicht darin.'],
    ['Chatbot verwaltet in',
     '`heim_guild_id` wurde gelesen und war NULL - noch niemand hat gewaehlt.']
];

const neinStellen = (meinkanalQuelle.match(/zustand: 'nein'/g) || []).length;
pruefe(neinStellen === ERLAUBTES_NEIN.length,
    `jede \`nein\`-Stelle steht mit Grund in der Liste (${neinStellen} im Code, ${ERLAUBTES_NEIN.length} eingetragen)`,
    'jede weitere waere ein Abbruchgrund, der sich als Tatsache ausgibt — eintragen oder auf `unbekannt` aendern');

for (const [label, grund] of ERLAUBTES_NEIN) {
    pruefe(meinkanalQuelle.includes(label), `„${label}" gibt es noch`, grund);
}

// **Und die Regel, die wirklich zaehlt:** In keinem `catch` steht `nein`. Wer
// nicht fragen konnte, weiss es nicht - ein Streamer, dem die Seite
// faelschlich "der Bot ist nicht in deinem Chat" sagt, tippt `/mod` ein
// zweites Mal und sucht den Fehler bei sich.
const catchBloecke = [];
let suche = 0;
for (;;) {
    const i = meinkanalQuelle.indexOf('catch', suche);
    if (i === -1) break;
    const auf = meinkanalQuelle.indexOf('{', i);
    if (auf === -1) break;
    let tiefe = 0, j = auf;
    for (; j < meinkanalQuelle.length; j++) {
        if (meinkanalQuelle[j] === '{') tiefe++;
        else if (meinkanalQuelle[j] === '}') { tiefe--; if (!tiefe) break; }
    }
    catchBloecke.push(meinkanalQuelle.slice(auf, j));
    suche = j;
}
pruefe(!catchBloecke.some(b => /zustand: 'nein'/.test(b)),
    `kein \`catch\` sagt \`nein\` (${catchBloecke.length} Bloecke geprueft)`,
    'ein Abbruch, der sich als Tatsache ausgibt, ist die halbe Auskunft, die schlimmer ist als keine');
pruefe(/function unbekannt/.test(meinkanalQuelle),
    'und alle Abbruchgruende laufen ueber eine gemeinsame `unbekannt`-Zeile');

// ---------------------------------------------------------------------
console.log('\n5. Kein Guild-Recht vor dem Abschnitt');
// ---------------------------------------------------------------------
const guildRouter = lies('apps/dashboard/routes/guild.router.js');
// `router.use` MUSS mit hinein: Die Zeile `require("./guild/profile.router")`
// enthaelt ebenfalls "/profile" und stand in der ersten Fassung dieser Regel
// faelschlich als Einhaengepunkt da - eine Zeile ohne jede Pruefung, die die
// Regel prompt rot meldete.
const profilZeile = guildRouter.split('\n')
    .find(z => z.includes('/profile') && z.includes('router.use'));
pruefe(Boolean(profilZeile) && !/requirePermission|checkPermission/.test(profilZeile),
    'der Profilbereich haengt an keiner Rechtepruefung',
    `sonst entschiede die Serverleitung ueber fremde Twitch-Chats — Zeile: ${(profilZeile||'').trim()}`);
pruefe(/CheckAuth/.test(profilZeile || ''),
    'aber sehr wohl an der Anmeldung');

const profilRouter = lies('apps/dashboard/routes/guild/profile.router.js');
pruefe(/einstellungenLesen/.test(profilRouter),
    'die Profilseite holt den Abschnitt beim Anbieter',
    'ohne diesen Aufruf waere der ganze Vertrag angemeldet und wirkungslos');
pruefe(/einstellungen: da\s*\n?\s*\?/.test(profilRouter) || /da\s*$/m.test(profilRouter),
    'und zwar nur fuer verknuepfte Konten',
    'sonst ein Netzaufruf bei jedem Seitenaufruf, fuer eine Zeile die leer bliebe');

// ---------------------------------------------------------------------
console.log('\n6. Leer heisst unsichtbar, nicht "noch keine Daten"');
// ---------------------------------------------------------------------
const ejs = require('ejs');
const vorlage = lies('apps/dashboard/themes/default/views/guild/profile-verbindungen.ejs');
const rendere = (einstellungen) => ejs.render(vorlage, {
    guildId: '1', locals: { csrfToken: 'x' }, csrfToken: 'x',
    meldung: null, fehler: null, rueckrufe: [],
    anbieter: [{ name: 'twitch', label: 'Twitch', symbol: 'i', farbe: null, hinweis: null,
        verbunden: true, kontoName: 'Wer', scopes: ['a'], zusageFehler: null, zusagen: [],
        einstellungen }]
});

const leer = rendere({ titel: 'Mein Kanal', hinweis: 'H', zeilen: [] });
pruefe(!leer.includes('Mein Kanal'),
    'bei leerer Liste erscheint der Titel gar nicht',
    'eine Ueberschrift ohne Inhalt ist das leere Versprechen aus Baustelle 73');

const voll = rendere({ titel: 'Mein Kanal', hinweis: 'H', zeilen: [
    { label: 'Bot in meinem Chat', zustand: 'nein', text: 'noch kein Moderator',
      hinweis: 'ohne Mod nichts', tat: '/mod firebot_mod' }] });
pruefe(voll.includes('Mein Kanal') && voll.includes('/mod firebot_mod'),
    'bei gefuellter Liste stehen Titel und die zu tuende Handlung da');
pruefe(voll.includes('bg-yellow-lt') && !voll.includes('bg-red'),
    '`nein` ist gelb, nicht rot',
    'es ist ein offener Schritt des Streamers, kein Fehler');

const unklar = rendere({ titel: 'Mein Kanal', hinweis: null, zeilen: [
    { label: 'Bot in meinem Chat', zustand: 'unbekannt', text: null, hinweis: null, tat: null }] });
pruefe(unklar.includes('unbekannt') && !unklar.includes('bg-yellow-lt'),
    '`unbekannt` ist grau, nicht gelb',
    'es ist keine schlechte Nachricht, sondern gar keine');

const auf = (voll.match(/<div/g) || []).length;
const zu  = (voll.match(/<\/div>/g) || []).length;
pruefe(auf === zu, `die Ansicht ist ausgeglichen (${auf} auf, ${zu} zu)`,
    'ein </div> zu viel verschluckt die Karten dahinter');

// ---------------------------------------------------------------------
console.log('\n7. Nichts wird versprochen, was es nicht gibt');
// ---------------------------------------------------------------------
//
// **Diese Regel hat sich am 2026-08-29 geaendert, und das gehoert dazugesagt.**
//
// Bis dahin hiess sie: "es gibt kein `schreiben()` - 13a hoert zu, der Bot
// sagt noch nichts." Sie war richtig zu ihrem Datum. Mit Stufe 14 kam ein
// Schreibweg dazu - aber ein enger: genau EINE benannte Auswahl (`wahl`), und
// sie kam mit ihrer Faehigkeit, nicht davor. Wer sie setzt, schaltet in der
// gewaehlten Guild sichtbar einen Menuepunkt frei.
//
// Die alte Regel unveraendert stehenzulassen waere schlimmer als sie zu
// aendern: Sie waere gruen geblieben (nach `schreiben` sucht sie, und das gibt
// es weiter nicht) und haette behauptet, es gaebe keinen Schreibweg.
const registryQuelle = lies('packages/dunebot-sdk/lib/VerbindungsRegistry.js');

pruefe(!/\bschreiben\b/.test(meinkanalQuelle) && !/schreiben:/.test(registryQuelle),
    'es gibt kein freies schreiben()',
    'ein Plugin duerfte dem Profil sonst beliebige Formulare unterschieben - der Kern kennt die Plattform nicht');

pruefe(/wahl:/.test(meinkanalQuelle.slice(meinkanalQuelle.indexOf('module.exports')) )
       || /^const wahl = \{/m.test(meinkanalQuelle),
    'die eine benannte Auswahl steht da',
    'sie ist der Schreibweg von Stufe 14');

// **Die Auswahl ist vollstaendig oder gar nicht.** Halb angeboten waere sie
// die Attrappe, gegen die dieser Vertrag geschrieben ist: ein Auswahlfeld,
// das nichts speichert, oder ein Speichern ohne Auswahl.
const mk = require(path.join(WURZEL, 'plugins/streaming/dashboard/kern/meinkanal.js'));
for (const feld of ['name', 'label', 'moeglich', 'setzen']) {
    pruefe(mk.wahl && mk.wahl[feld] !== undefined, `die Auswahl hat \`${feld}\``,
        'der Vertrag lehnt eine halbe Wahl ab - hier faellt es frueher auf');
}

// Und sie prueft selbst, statt sich auf den Kern zu verlassen.
const heimguildQuelle = lies('plugins/streaming/dashboard/kern/heimguild.js');
pruefe(/kanalInhaber/.test(heimguildQuelle),
    'das Setzen prueft den Inhaber ueber `user_connections`',
    'der Kern reicht nur durch, wer angemeldet ist - ob dieser Mensch DIESEN Kanal besitzt, weiss allein das Plugin');

console.log(abweichungen === 0
    ? `\nErgebnis: ${faelle} Pruefungen, 0 Abweichungen.\n`
    : `\nErgebnis: ${faelle} Pruefungen, ${abweichungen} Abweichung(en).\n`);
process.exit(abweichungen === 0 ? 0 : 1);

})().catch(err => { console.error('\nAbbruch:', err.message, '\n', err.stack); process.exit(1); });
