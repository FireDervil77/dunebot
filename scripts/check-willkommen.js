#!/usr/bin/env node
/**
 * Prueft die Willkommensseite und die Begruessung in Discord (Baustelle 129).
 *
 * Vier Teile:
 *   1. Die Sprachwahl (`packages/dunebot-core/lib/Sprachwahl.js`)
 *   2. Die Entscheidungen der Begruessung (`apps/bot/helpers/willkommenEntscheidung.js`)
 *   3. Der Ruecksprung aus der Einladung (`apps/dashboard/helpers/Einladung.js`)
 *   4. Die Verdrahtung — steht der Einladungslink nur noch an einer Stelle,
 *      liest `ready.js` den richtigen Schluessel, gibt es die Texte in beiden
 *      Sprachen?
 *
 * Keine Datenbank, kein Discord, kein Netz.
 *
 *   node scripts/check-willkommen.js
 *
 * Exitcode 1, wenn ein Fall scheitert.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const { ohneKommentare, ohneKommentareEjs } = require('./lib/quelltext');

const WURZEL = path.join(__dirname, '..');

let geprueft = 0, gescheitert = 0;

function pruefe(was, ist, soll) {
    geprueft++;
    const gut = JSON.stringify(ist) === JSON.stringify(soll);
    if (!gut) gescheitert++;
    console.log(`  ${gut ? '✓' : '✗'} ${was}: ${JSON.stringify(ist)}${gut ? '' : ` (soll: ${JSON.stringify(soll)})`}`);
}

function pruefeWahr(was, gut, hinweis = '') {
    geprueft++;
    if (!gut) gescheitert++;
    console.log(`  ${gut ? '✓' : '✗'} ${was}${gut || !hinweis ? '' : ` — ${hinweis}`}`);
}

function lies(relativ) {
    return fs.readFileSync(path.join(WURZEL, relativ), 'utf8');
}


// ---------------------------------------------------------------------------
// 1. Sprachwahl
// ---------------------------------------------------------------------------
const { spracheAusDiscord, OHNE_ANGABE, FREMDE_SPRACHE } = require('../packages/dunebot-core/lib/Sprachwahl');

console.log('\n1. Welche Sprache bekommt eine neue Guild?');
pruefe('Discord meldet "de"', spracheAusDiscord('de'), 'de-DE');
pruefe('Discord meldet "de-DE"', spracheAusDiscord('de-DE'), 'de-DE');
pruefe('Discord meldet "en-GB"', spracheAusDiscord('en-GB'), 'en-GB');
pruefe('Discord meldet "en-US" — wir haben nur en-GB', spracheAusDiscord('en-US'), 'en-GB');
pruefe('Discord meldet "de-AT"', spracheAusDiscord('de-AT'), 'de-DE');
pruefe('Unterstrich statt Strich', spracheAusDiscord('de_DE'), 'de-DE');
pruefe('Grossschreibung egal', spracheAusDiscord('EN-gb'), 'en-GB');
// Gegen den Klartext, nicht gegen die Konstante: sonst prueft sich der Fall
// selbst und bleibt auch dann gruen, wenn jemand die Konstante verstellt.
pruefe('Kennen wir nicht — dann Englisch, nicht Deutsch', spracheAusDiscord('fr'), 'en-GB');
pruefe('Discord sagt nichts', spracheAusDiscord(null), 'de-DE');
pruefe('leere Zeichenkette', spracheAusDiscord('   '), 'de-DE');
pruefe('die Konstanten stehen auf dem, was hier geprueft wird',
    { OHNE_ANGABE, FREMDE_SPRACHE }, { OHNE_ANGABE: 'de-DE', FREMDE_SPRACHE: 'en-GB' });

console.log('\n   Gegenproben');
pruefeWahr('"fr" wird NICHT zu Deutsch', spracheAusDiscord('fr') !== 'de-DE');
pruefeWahr('"en-US" wird NICHT zu Deutsch', spracheAusDiscord('en-US') !== 'de-DE');
pruefeWahr('gibt immer eine Sprache aus der Liste zurueck',
    ['de-DE', 'en-GB'].includes(spracheAusDiscord('zz-ZZ')));

// ---------------------------------------------------------------------------
// 2. Entscheidungen der Begruessung
// ---------------------------------------------------------------------------
const e = require('../apps/bot/helpers/willkommenEntscheidung');

console.log('\n2. Wer hat eingeladen?');
const JETZT = 1_700_000_000_000;
const eintrag = (ueber = {}) => ({ zielId: 'BOT', ausfuehrenderId: 'U1', erstelltMs: JETZT - 1000, ...ueber });

pruefe('frischer Eintrag fuer unseren Bot', e.einladerAusProtokoll([eintrag()], 'BOT', JETZT), 'U1');
pruefe('ein anderer Bot wurde hinzugefuegt', e.einladerAusProtokoll([eintrag({ zielId: 'ANDERER' })], 'BOT', JETZT), null);
pruefe('zu alt — Re-Join-Falle', e.einladerAusProtokoll([eintrag({ erstelltMs: JETZT - e.PROTOKOLL_FRIST_MS - 1 })], 'BOT', JETZT), null);
pruefe('ohne Ausfuehrenden', e.einladerAusProtokoll([eintrag({ ausfuehrenderId: null })], 'BOT', JETZT), null);
pruefe('der neueste gewinnt', e.einladerAusProtokoll([
    eintrag({ ausfuehrenderId: 'ALT', erstelltMs: JETZT - 9000 }),
    eintrag({ ausfuehrenderId: 'NEU', erstelltMs: JETZT - 10 }),
], 'BOT', JETZT), 'NEU');
pruefe('leeres Protokoll', e.einladerAusProtokoll([], 'BOT', JETZT), null);
pruefe('gar kein Protokoll', e.einladerAusProtokoll(null, 'BOT', JETZT), null);
pruefe('Eintrag aus der Zukunft zaehlt nicht', e.einladerAusProtokoll([eintrag({ erstelltMs: JETZT + 5000 })], 'BOT', JETZT), null);

console.log('\n3. Wohin schreibt der Bot?');
const kanal = (id, position, darfSchreiben) => ({ id, position, darfSchreiben });

pruefe('Systemkanal, wenn er beschreibbar ist', e.kanalWaehlen({
    systemKanalId: 'SYS',
    kanaele: [kanal('SYS', 5, true), kanal('A', 0, true)],
}), 'SYS');
pruefe('Systemkanal gesperrt — dann der oberste beschreibbare', e.kanalWaehlen({
    systemKanalId: 'SYS',
    kanaele: [kanal('SYS', 5, false), kanal('B', 3, true), kanal('A', 1, true)],
}), 'A');
pruefe('kein Systemkanal gesetzt', e.kanalWaehlen({
    systemKanalId: null,
    kanaele: [kanal('B', 3, true), kanal('A', 1, true)],
}), 'A');
pruefe('nirgends Schreibrecht — dann bleibt nur die DM', e.kanalWaehlen({
    systemKanalId: 'SYS',
    kanaele: [kanal('SYS', 0, false), kanal('A', 1, false)],
}), null);
pruefe('gar keine Kanaele', e.kanalWaehlen({ systemKanalId: null, kanaele: [] }), null);
pruefe('ohne Angaben stuerzt nichts', e.kanalWaehlen(), null);
pruefe('gleiche Position — die aeltere Kennung gewinnt', e.kanalWaehlen({
    systemKanalId: null,
    kanaele: [kanal('222', 0, true), kanal('111', 0, true)],
}), '111');

console.log('\n4. Die Links der Begruessung');
const links = e.linksBauen('https://beispiel.de/', '42');
pruefe('Schraegstrich am Ende faellt weg', links.willkommen, 'https://beispiel.de/guild/42/willkommen');
pruefe('Sprache zeigt auf die Einstellungen', links.sprache, 'https://beispiel.de/guild/42/settings/general');
pruefe('Plugins', links.plugins, 'https://beispiel.de/guild/42/plugins');
pruefe('Rechte', links.rechte, 'https://beispiel.de/guild/42/permissions');
pruefe('Hilfe zeigt auf die Doku', links.hilfe, 'https://beispiel.de/docs');
pruefe('ohne Basisadresse gibt es keine Links', e.linksBauen('', '42'), null);
pruefe('ohne Guild gibt es keine Links', e.linksBauen('https://beispiel.de', ''), null);

// ---------------------------------------------------------------------------
// 3. Der Ruecksprung
// ---------------------------------------------------------------------------
const einladung = require('../apps/dashboard/helpers/Einladung');

console.log('\n5. Der Ruecksprung aus der Einladung');

/** Eine Anfrage-Attrappe: Sitzung plus Abfrageparameter. */
function anfrage({ sitzung = {}, abfrage = {} } = {}) {
    return { session: sitzung, query: abfrage };
}

const GUILD = '123456789012345678';
const vorgang = (ueber = {}) => ({ kennzeichen: 'abc123', zeit: Date.now(), ...ueber });

pruefe('gewoehnlicher Anmelde-Callback geht uns nichts an',
    einladung.ruecksprungPruefen(anfrage({ abfrage: { code: 'x' } })), null);

const gut = einladung.ruecksprungPruefen(anfrage({
    sitzung: { einladung: vorgang() },
    abfrage: { state: 'einladung:abc123', guild_id: GUILD, code: 'x' },
}));
pruefe('gueltiger Ruecksprung', { gueltig: gut.gueltig, guildId: gut.guildId }, { gueltig: true, guildId: GUILD });

console.log('\n   Gegenproben — jede muss anschlagen');
const falsch = (name, req) => {
    const ergebnis = einladung.ruecksprungPruefen(req);
    pruefeWahr(name, ergebnis !== null && ergebnis.gueltig === false,
        `bekam ${JSON.stringify(ergebnis)}`);
};

falsch('untergeschobener Ruecksprung ohne Vorgang in der Sitzung', anfrage({
    abfrage: { state: 'einladung:abc123', guild_id: GUILD },
}));
falsch('falsches Kennzeichen', anfrage({
    sitzung: { einladung: vorgang() },
    abfrage: { state: 'einladung:FALSCH', guild_id: GUILD },
}));
falsch('abgelaufen', anfrage({
    sitzung: { einladung: vorgang({ zeit: Date.now() - einladung.FRIST_MS - 1 }) },
    abfrage: { state: 'einladung:abc123', guild_id: GUILD },
}));
falsch('keine brauchbare Guild-Kennung', anfrage({
    sitzung: { einladung: vorgang() },
    abfrage: { state: 'einladung:abc123', guild_id: 'keine-zahl' },
}));
falsch('Discord schickt gar keine Guild mit', anfrage({
    sitzung: { einladung: vorgang() },
    abfrage: { state: 'einladung:abc123' },
}));
falsch('Benutzer hat abgebrochen', anfrage({
    sitzung: { einladung: vorgang() },
    abfrage: { state: 'einladung:abc123', guild_id: GUILD, error: 'access_denied' },
}));

const sitzung = { einladung: vorgang() };
einladung.ruecksprungPruefen(anfrage({ sitzung, abfrage: { state: 'einladung:abc123', guild_id: GUILD } }));
pruefeWahr('der Vorgang gilt nur einmal — danach ist er aus der Sitzung raus', !sitzung.einladung);

pruefe('die Guild kommt von Discord, nicht aus der Sitzung', einladung.ruecksprungPruefen(anfrage({
    sitzung: { einladung: vorgang() },
    abfrage: { state: 'einladung:abc123', guild_id: GUILD },
})).guildId, GUILD);

console.log('\n   Ein Kennzeichen je Sitzung, nicht je Link');
{
    // Die Serverauswahl baut den Link in einer Schleife. Bekaeme jede Runde ein
    // eigenes Kennzeichen, waere nur der letzte Link der Seite gueltig.
    process.env.CLIENT_ID = 'PRUEF';
    process.env.DISCORD_REDIRECT_URI = 'https://beispiel.de/auth/callback';
    const sitzung = {};
    const zustand = (guildId) => {
        const url = new URL(einladung.baueEinladungsUrl({ session: sitzung }, guildId));
        return url.searchParams.get('state');
    };
    const ersterLink = zustand('111111111111111111');
    const zweiterLink = zustand('222222222222222222');
    const dritterLink = zustand('333333333333333333');
    pruefeWahr('alle Links einer Seite tragen dasselbe Kennzeichen',
        ersterLink === zweiterLink && zweiterLink === dritterLink,
        `${ersterLink} / ${zweiterLink} / ${dritterLink}`);
    pruefeWahr('und der erste Link wird danach noch angenommen',
        einladung.ruecksprungPruefen({
            session: { einladung: { ...sitzung.einladung } },
            query: { state: ersterLink, guild_id: GUILD },
        }).gueltig === true);

    const url = new URL(einladung.baueEinladungsUrl({ session: {} }, GUILD));
    pruefe('der Link bittet um einen Ruecksprung', url.searchParams.get('response_type'), 'code');
    pruefe('… an die eingetragene Adresse', url.searchParams.get('redirect_uri'), 'https://beispiel.de/auth/callback');
    pruefe('… mit den bisherigen Rechten', url.searchParams.get('permissions'), '1374891929078');
    pruefe('… und den Bot-Scopes', url.searchParams.get('scope'), 'bot applications.commands');

    // Ohne eingetragene Ruecksprungadresse bleibt es beim alten Link.
    delete process.env.DISCORD_REDIRECT_URI;
    const ohne = new URL(einladung.baueEinladungsUrl({ session: {} }, GUILD));
    pruefeWahr('ohne DISCORD_REDIRECT_URI kein state am Link', !ohne.searchParams.get('state'));
    pruefeWahr('… aber der Link funktioniert weiter', ohne.searchParams.get('guild_id') === GUILD);
}

// ---------------------------------------------------------------------------
// 4. Die Verdrahtung
// ---------------------------------------------------------------------------
console.log('\n6. Steht der Einladungslink nur noch an einer Stelle?');

const ORTE = [
    'apps/dashboard/controllers/auth.controller.js',
    'apps/dashboard/middlewares/auth.middleware.js',
];
for (const ort of ORTE) {
    const quelltext = ohneKommentare(lies(ort));
    pruefeWahr(`${ort} baut den Einladungslink nicht selbst`,
        !/oauth2\/authorize[^`'"]*scope=bot/.test(quelltext));
    pruefeWahr(`${ort} nutzt den Helfer`, /baueEinladungsUrl\s*\(/.test(quelltext));
}
pruefeWahr('die Rechte stehen genau einmal im Helfer',
    (ohneKommentare(lies('apps/dashboard/helpers/Einladung.js')).match(/1374891929078/g) || []).length === 1);

console.log('\n7. Die Sprache der Guild');
const ready = ohneKommentare(lies('apps/bot/events/ready.js'));
pruefeWahr('ready.js liest `settings?.LOCALE` (gross)', /settings\?\.LOCALE/.test(ready));
pruefeWahr('und nicht mehr `settings?.locale` (klein — gibt es nicht)', !/settings\?\.locale\b/.test(ready));

const guildManager = ohneKommentare(lies('packages/dunebot-core/lib/GuildManager.js'));
pruefeWahr('GuildManager uebernimmt die Sprache aus Discord',
    /spracheAusDiscordUebernehmen\s*\(guild\)/.test(guildManager));
pruefeWahr('… und zwar fuer beide Wege (Beitritt und Bot-Start)',
    (guildManager.match(/await this\.spracheAusDiscordUebernehmen\(guild\)/g) || []).length === 2);
pruefeWahr('beim Re-Join wird die bekannte Sprache ans Guild-Objekt gehaengt',
    /if \(!guild\.locale\)[\s\S]{0,220}konfiguration\?\.LOCALE/.test(guildManager));

const settings = ohneKommentare(lies('apps/dashboard/routes/guild/settings.router.js'));
pruefeWahr('das Dashboard sagt dem Bot Bescheid, wenn die Sprache wechselt',
    /SET_GUILD_LOCALE/.test(settings));
pruefeWahr('… mit Frist, damit das Speichern nicht am Bot haengt',
    /SET_GUILD_LOCALE[\s\S]{0,160}timeout:\s*\d+/.test(settings));

console.log('\n8. Die Texte — beide Sprachen, gleiche Schluessel');
function schluessel(objekt, praefix = '') {
    return Object.entries(objekt).flatMap(([k, v]) =>
        v && typeof v === 'object' ? schluessel(v, `${praefix}${k}.`) : [`${praefix}${k}`]);
}
const PAARE = [
    ['plugins/core/bot/locales', 'WILLKOMMEN'],
    ['apps/dashboard/locales', 'WILLKOMMEN'],
];
for (const [ordner, block] of PAARE) {
    const de = JSON.parse(lies(`${ordner}/de-DE.json`))[block];
    const en = JSON.parse(lies(`${ordner}/en-GB.json`))[block];
    pruefeWahr(`${ordner}: Block "${block}" auf Deutsch vorhanden`, Boolean(de));
    pruefeWahr(`${ordner}: Block "${block}" auf Englisch vorhanden`, Boolean(en));
    if (de && en) {
        pruefe(`${ordner}: gleiche Schluessel`, schluessel(en).sort(), schluessel(de).sort());
        pruefeWahr(`${ordner}: kein Text ist leer`,
            [...Object.values(de), ...Object.values(en)].every(t => String(t).trim().length > 0));
    }
}

console.log('\n9. Benutzt die Ansicht nur, was der Controller liefert?');
// Auch die Ansicht ohne Prosa messen: Ihr Kopf erklaert, was sie NICHT tut —
// eine Suche im rohen Inhalt traefe die Erklaerung statt des Codes.
const ansicht = ohneKommentareEjs(lies('apps/dashboard/themes/default/views/guild/willkommen.ejs'));
const controller = ohneKommentare(lies('apps/dashboard/controllers/guild.controller.js'));
for (const name of ['guildId', 'guildIcon', 'sprachen', 'aktuelleSprache', 'guildSprache', 'supportUrl']) {
    pruefeWahr(`\`${name}\` wird uebergeben`, new RegExp(`\\b${name}[,\\n]`).test(controller));
}
pruefeWahr('die Ansicht greift NICHT auf `guild.iconURL` zu (gibt es am Objekt nicht)',
    !/guild\.iconURL/.test(ansicht));
for (const schluesselName of (() => {
    const treffer = ansicht.match(/tr\('WILLKOMMEN\.([A-Z0-9_]+)'/g) || [];
    return [...new Set(treffer.map(t => t.replace(/tr\('WILLKOMMEN\./, '').replace(/'$/, '')))];
})()) {
    const de = JSON.parse(lies('apps/dashboard/locales/de-DE.json')).WILLKOMMEN || {};
    pruefeWahr(`Ansicht nutzt WILLKOMMEN.${schluesselName} — Text vorhanden`,
        Object.prototype.hasOwnProperty.call(de, schluesselName));
}

console.log('\n10. Liegt ein Text ungenutzt herum?');
{
    // Beide Richtungen pruefen. Bisher fiel nur auf, wenn die Ansicht einen
    // Text verlangt, den es nicht gibt — ein Text, den niemand anzeigt, blieb
    // unbemerkt liegen. Was absichtlich nicht in der Ansicht steht, gehoert in
    // die Ausnahmeliste, nicht in ein stilles `continue`.
    const AUSNAHMEN = {
        TITEL: 'steht in der Titelleiste, gesetzt im Controller über req.translate',
    };
    const verwendet = ansicht + controller;
    const de = JSON.parse(lies('apps/dashboard/locales/de-DE.json')).WILLKOMMEN || {};
    for (const name of Object.keys(de)) {
        if (AUSNAHMEN[name]) {
            console.log(`  – WILLKOMMEN.${name} — Ausnahme: ${AUSNAHMEN[name]}`);
            continue;
        }
        pruefeWahr(`WILLKOMMEN.${name} wird angezeigt`, verwendet.includes(`WILLKOMMEN.${name}`));
    }
    pruefeWahr('der Titel kommt übersetzt aus req.translate',
        /req\.translate\('WILLKOMMEN\.TITEL'\)/.test(controller));
}

console.log('\n11. Die zwei Fehler vom ersten echten Lauf (2026-09-16)');
{
    // (a) Der Name. `base.middleware` setzt vorher einen Platzhalter
    //     `{ name: '', id }`. Wer auf `!guild` prueft, trifft ihn nie — auf der
    //     Seite stand „ist eingerichtet" ohne Servernamen.
    pruefeWahr('der Rueckfall fragt nach dem NAMEN, nicht nach dem Objekt',
        /if \(!guild\?\.name\)/.test(controller));
    pruefeWahr('… und holt ihn aus `guilds.guild_name`',
        /SELECT guild_name FROM guilds/.test(controller));

    // (b) Das Ersatzbild. `/images/DuneBot.png` gibt es auf dem Server nicht —
    //     es stand als weisser Kasten auf der Seite. Hier wird nicht geprueft,
    //     WELCHER Pfad dasteht, sondern ob die Datei wirklich da ist.
    const BASIS = path.join(WURZEL, 'apps/dashboard');
    const bildpfade = [...ansicht.matchAll(/url\(\s*<%=[^%]*?'(\/[^']+\.(?:png|jpg|jpeg|svg|gif|webp))'/g)]
        .map(m => m[1]);
    pruefeWahr('die Ansicht nennt ueberhaupt ein Ersatzbild', bildpfade.length > 0);
    for (const bild of bildpfade) {
        // `/themes/...` und `/public/...` werden als statische Ordner unter
        // apps/dashboard ausgeliefert (app.js).
        const aufPlatte = path.join(BASIS, bild.replace(/^\/public\//, '/'));
        pruefeWahr(`Ersatzbild ${bild} liegt wirklich auf der Platte`, fs.existsSync(aufPlatte),
            `gesucht: ${aufPlatte}`);
    }
}

console.log(`\nErgebnis: ${geprueft} Pruefungen, ${gescheitert} Abweichungen.`);
process.exit(gescheitert > 0 ? 1 : 0);
