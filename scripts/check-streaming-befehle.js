#!/usr/bin/env node
'use strict';

/**
 * Der Befehlsbaukasten (Stufe 15) — antwortet er richtig, und schweigt er ueber
 * den Rest?
 *
 * ## Die Pruefung, auf die es ankommt
 *
 * Nicht ob `!uptime` eine Zeit nennt, sondern **dass von der Chatnachricht
 * nichts in die Datenbank geht**. Der Auswerter sieht Text und Absender; die
 * Zusage an den Betreiber ist, dass beides den Aufruf nicht verlaesst. Ein
 * spaeterer Umbau, der „nur zum Debuggen" den Text mitschreibt, faellt hier auf.
 *
 *     node scripts/check-streaming-befehle.js
 */

const path = require('path');
const WURZEL = path.resolve(__dirname, '..');
const { ServiceManager } = require(path.join(WURZEL, 'node_modules/dunebot-core'));

let faelle = 0, abweichungen = 0;
function pruefe(gut, text, zusatz = '') {
    faelle++;
    if (!gut) abweichungen++;
    console.log(`  ${gut ? '✓' : '✗'} ${text}${zusatz ? '  — ' + zusatz : ''}`);
}

// --- Attrappen -----------------------------------------------------------
const daten = { streamer: [], befehle: [] };
const mitschrift = { schreibzugriffe: [], gesendet: [], unbekannt: [] };

ServiceManager.register('Logger', {
    info: () => {}, debug: () => {}, warn: () => {}, error: () => {}, success: () => {}
});
ServiceManager.register('dbService', {
    async query(sql, w = []) {
        const s = String(sql).replace(/\s+/g, ' ').trim();

        if (s.startsWith('SELECT s.id, s.login, s.anzeigename, s.kanal_id, s.heim_guild_id')) {
            return daten.streamer.filter(x => String(x.kanal_id) === String(w[0]));
        }
        if (s.startsWith('SELECT id, wort, art, antwort, wer, abkuehlung_s')) {
            return daten.befehle.filter(x =>
                String(x.guild_id) === String(w[0]) &&
                x.aktiv !== 0 &&
                (x.streamer_id === w[1] || x.streamer_id === null || x.streamer_id === undefined));
        }
        if (s.startsWith('UPDATE streaming_commands')) {
            // **Jeder Schreibzugriff wird mitgeschrieben, samt Werten.** Genau
            // hier wuerde ein spaeter eingebauter Text landen.
            mitschrift.schreibzugriffe.push({ sql: s, werte: w });
            return [];
        }
        mitschrift.unbekannt.push(s.slice(0, 70));
        return [];
    }
});

// Plattform und Verbindungsspeicher vorbelegen, bevor `befehle` sie holt.
const twitchPfad = require.resolve(path.join(WURZEL, 'plugins/streaming/dashboard/plattformen/twitch.js'));
const echterTwitch = require(twitchPfad);
require.cache[twitchPfad].exports = Object.assign({}, echterTwitch, {
    async chatSenden(kanalId, text) {
        mitschrift.gesendet.push({ kanalId: String(kanalId), text: String(text) });
        return { ok: true, grund: null };
    }
});

const vsPfad = require.resolve(path.join(WURZEL, 'apps/dashboard/helpers/Verbindungsspeicher.js'));
require.cache[vsPfad] = { id: vsPfad, filename: vsPfad, loaded: true, exports: {
    async mitZugang(_wer, tun) { return await tun('zugang-attrappe'); }
} };

const abPfad = require.resolve(path.join(WURZEL, 'plugins/streaming/dashboard/kern/abonnenten.js'));
const echteAb = require(abPfad);
require.cache[abPfad].exports = Object.assign({}, echteAb, {
    async kanalInhaber() { return 'nutzer-1'; }
});

const befehle = require(path.join(WURZEL, 'plugins/streaming/dashboard/kern/befehle.js'));

/**
 * Fortlaufende Kennungen ueber ALLE Faelle hinweg.
 *
 * Beim ersten Anlauf fing jeder Fall wieder bei `id: 1` an — und die Abkuehlung
 * merkt sich die Kennung der Zeile im Arbeitsspeicher, ueber Faelle hinweg. Der
 * Abkuehlungstest schlug deshalb fehl, obwohl der Code stimmte: Zeile 1 war
 * Millisekunden vorher schon benutzt worden.
 */
let idBasis = 0;

function neuAufsetzen(zeilen = [], live = true, begonnenVorMs = 8100000) {
    daten.streamer = [{
        id: 1, login: 'firedervil', anzeigename: 'FireDervil', kanal_id: 'k1',
        heim_guild_id: 'g1', ist_live: live ? 1 : 0,
        titel: 'Erster Versuch', kategorie: 'Astro Colony',
        begonnen_am: live ? new Date(Date.now() - begonnenVorMs) : null
    }];
    daten.befehle = zeilen.map((z, i) => ({
        id: ++idBasis, guild_id: 'g1', streamer_id: 1, aktiv: 1,
        art: 'eigen', wer: 'alle', abkuehlung_s: 0, antwort: null, ...z
    }));
    mitschrift.schreibzugriffe = []; mitschrift.gesendet = []; mitschrift.unbekannt = [];
}

const nachricht = (text, extra = {}) => ({
    kanalId: 'k1', kanalName: 'FireDervil', text,
    absender: 'Anna', absenderId: '9',
    istInhaber: false, istModerator: false, istAbonnent: false, ...extra
});

(async () => {

console.log('\nDas Wort wird sauber herausgeloest');
{
    pruefe(befehle.zerlegen('!uptime')?.wort === 'uptime', 'ein einfacher Befehl');
    pruefe(befehle.zerlegen('!regeln bitte')?.rest === 'bitte', 'der Rest bleibt erhalten');
    pruefe(befehle.zerlegen('  !UPTIME  ')?.wort === 'uptime', 'Gross- und Kleinschreibung ist egal');
    pruefe(befehle.zerlegen('hallo') === null, 'gewoehnlicher Text ist kein Befehl');
    pruefe(befehle.zerlegen('!!!') === null, 'ein Wort aus Sonderzeichen ist keines');
    pruefe(befehle.zerlegen('!') === null, 'das Praefix allein auch nicht');
}

console.log('\nWer darf, darf — und der Inhaber immer');
{
    pruefe(befehle.darf('alle', {}) === true, 'offene Befehle stehen jedem offen');
    pruefe(befehle.darf('moderator', { istAbonnent: true }) === false, 'ein Abonnent ist kein Moderator');
    pruefe(befehle.darf('moderator', { istModerator: true }) === true, 'ein Moderator schon');
    pruefe(befehle.darf('moderator', { istInhaber: true }) === true,
        'und der Inhaber ist der Rang darueber, kein Sonderfall daneben');
    pruefe(befehle.darf('abonnent', { istModerator: true }) === true,
        'wer mehr darf, darf auch weniger');
}

console.log('\nFertige Befehle antworten aus dem Zustand');
{
    neuAufsetzen([{ wort: 'uptime', art: 'fertig' }]);
    await befehle.auswerten(nachricht('!uptime'));
    pruefe(/2 Stunden 15 Minuten/.test(mitschrift.gesendet[0]?.text || ''),
        'die Laufzeit steht im Satz', mitschrift.gesendet[0]?.text);

    neuAufsetzen([{ wort: 'uptime', art: 'fertig' }], false);
    await befehle.auswerten(nachricht('!uptime'));
    pruefe(/nicht live/.test(mitschrift.gesendet[0]?.text || ''),
        'offline sagt der Befehl das, statt eine Null zu nennen', mitschrift.gesendet[0]?.text);

    neuAufsetzen([{ wort: 'spiel', art: 'fertig' }]);
    await befehle.auswerten(nachricht('!spiel'));
    pruefe(/Astro Colony/.test(mitschrift.gesendet[0]?.text || ''), 'die Kategorie kommt mit');

    neuAufsetzen([{ wort: 'befehle', art: 'fertig' }, { wort: 'regeln', antwort: 'sei nett' }]);
    await befehle.auswerten(nachricht('!befehle'));
    pruefe(/!befehle/.test(mitschrift.gesendet[0]?.text || '') && /!regeln/.test(mitschrift.gesendet[0]?.text || ''),
        'die Liste nennt alle', mitschrift.gesendet[0]?.text);
}

console.log('\nEigene Befehle fuellen ihre Platzhalter');
{
    neuAufsetzen([{ wort: 'gruss', antwort: 'Hallo {absender}, {streamer} spielt {spiel}.' }]);
    await befehle.auswerten(nachricht('!gruss'));
    pruefe(mitschrift.gesendet[0]?.text === 'Hallo Anna, FireDervil spielt Astro Colony.',
        'drei Platzhalter, drei Werte', mitschrift.gesendet[0]?.text);

    neuAufsetzen([{ wort: 'x', antwort: 'Sieh {erfunden} an.' }]);
    await befehle.auswerten(nachricht('!x'));
    pruefe(mitschrift.gesendet[0]?.text === 'Sieh {erfunden} an.',
        'ein erfundener Platzhalter bleibt stehen, statt leer zu verschwinden',
        mitschrift.gesendet[0]?.text);

    neuAufsetzen([{ wort: 'lang', antwort: 'x'.repeat(900) }]);
    await befehle.auswerten(nachricht('!lang'));
    pruefe((mitschrift.gesendet[0]?.text || '').length === 500,
        'laenger als Twitch nimmt wird gekuerzt, nicht abgelehnt',
        String((mitschrift.gesendet[0]?.text || '').length));

    neuAufsetzen([{ wort: 'leer', antwort: '   ' }]);
    await befehle.auswerten(nachricht('!leer'));
    pruefe(mitschrift.gesendet.length === 0, 'ein leerer Satz wird gar nicht erst gesendet');
}

console.log('\nDie Abkuehlung haelt');
{
    neuAufsetzen([{ wort: 'a', antwort: 'da', abkuehlung_s: 30 }]);
    await befehle.auswerten(nachricht('!a'));
    await befehle.auswerten(nachricht('!a'));
    pruefe(mitschrift.gesendet.length === 1, 'der zweite Aufruf laeuft in die Abkuehlung',
        String(mitschrift.gesendet.length));
}

console.log('\nWas nicht passieren darf');
{
    neuAufsetzen([{ wort: 'nurmods', antwort: 'geheim', wer: 'moderator' }]);
    await befehle.auswerten(nachricht('!nurmods'));
    pruefe(mitschrift.gesendet.length === 0,
        'wer nicht darf, bekommt keine Antwort — und auch keine Belehrung');

    neuAufsetzen([{ wort: 'a', antwort: 'da' }]);
    daten.streamer[0].heim_guild_id = null;
    pruefe(await befehle.auswerten(nachricht('!a')) === null,
        'ein Kanal ohne Heim-Guild hat keine Befehle');

    neuAufsetzen([{ wort: 'a', antwort: 'da' }]);
    pruefe(await befehle.auswerten(nachricht('!gibtsnicht')) === null,
        'ein unbekanntes Wort loest gar nichts aus');

    neuAufsetzen([{ wort: 'a', antwort: 'da' }]);
    pruefe(await befehle.auswerten(nachricht('einfach nur text')) === null,
        'und gewoehnlicher Text erst recht nicht — er fragt nicht einmal die Datenbank',
        `Abfragen: ${mitschrift.unbekannt.length}`);
}

console.log('\nVon der Nachricht geht nichts in die Datenbank');
{
    // **Die Pruefung, um die es geht.** Der Auswerter SIEHT Text und Absender.
    // Beides darf den Aufruf nicht verlassen. Geprueft wird an Werten, die
    // nirgendwo sonst vorkommen — ein spaeterer Umbau, der sie „nur zum
    // Debuggen" mitschreibt, faellt hier auf.
    neuAufsetzen([{ wort: 'gruss', antwort: 'Hallo {absender}' }]);
    await befehle.auswerten(nachricht('!gruss GEHEIMERTEXT', {
        absender: 'GEHEIMERABSENDER', absenderId: 'GEHEIMEID'
    }));

    const alleWerte = JSON.stringify(mitschrift.schreibzugriffe);
    pruefe(mitschrift.schreibzugriffe.length === 1,
        'genau ein Schreibzugriff — der Zaehler', String(mitschrift.schreibzugriffe.length));
    pruefe(!alleWerte.includes('GEHEIMERTEXT'), 'der Nachrichtentext steht in keinem davon');
    pruefe(!alleWerte.includes('GEHEIMERABSENDER'), 'der Absender auch nicht');
    pruefe(!alleWerte.includes('GEHEIMEID'), 'und seine Kennung auch nicht');
    pruefe(/benutzt_anzahl = benutzt_anzahl \+ 1/.test(mitschrift.schreibzugriffe[0]?.sql || ''),
        'gezaehlt wird eine Summe ohne Person');

    // Und die Tabelle hat fuer beides gar keine Spalte — die zweite Sperre.
    const fs = require('fs');
    const mig = fs.readFileSync(path.join(WURZEL,
        'plugins/streaming/migrations/20260905_100000_befehle.js'), 'utf8');
    const tabelle = (mig.match(/CREATE TABLE streaming_commands \(([\s\S]*?)\) ENGINE/) || [])[1] || '';
    pruefe(!/absender|chatter|nachricht_text|verlauf/i.test(tabelle.replace(/--[^\n]*/g, '')),
        'die Tabelle hat keine Spalte, in die so etwas passte');
}

console.log('\nDie Attrappe hat alles verstanden');
pruefe(mitschrift.unbekannt.length === 0, 'keine unbekannte Abfrage still mit `[]` beantwortet',
    mitschrift.unbekannt.length ? [...new Set(mitschrift.unbekannt)].join(' | ') : '');

console.log(abweichungen === 0
    ? `\nErgebnis: ${faelle} Pruefungen, 0 Abweichungen.\n`
    : `\nErgebnis: ${faelle} Pruefungen, ${abweichungen} Abweichung(en).\n`);
process.exit(abweichungen === 0 ? 0 : 1);

})().catch(err => { console.error('\nAbbruch:', err.message, '\n', err.stack); process.exit(1); });
