#!/usr/bin/env node
'use strict';

/**
 * Timer-Ansagen (P6) — geht wirklich nur hinaus, was hinausgehen soll?
 *
 * ## Die Pruefung, auf die es ankommt
 *
 * Nicht ob eine Ansage im Chat landet, sondern **dass sie es in vier Faellen
 * NICHT tut**: wenn der Stream aus ist, wenn der Schalter aus ist, wenn die
 * Zeit noch nicht um ist, und wenn im Chat nichts los war. Jede dieser vier
 * Bedingungen einzeln zu verlieren waere ein Bot, der in einen leeren Chat
 * schreibt — und das ist der Ruf des Streamers, nicht unserer.
 *
 * ## Wie die Attrappe gebaut ist
 *
 * Sie **prueft die Abfrage, statt sie nachzubilden**. Ein Filter greift nur,
 * wenn die Abfrage die Bedingung wirklich stellt (`s.includes('z.ist_live')`).
 * Ohne diesen Griff bliebe „offline geht nichts hinaus" auch dann gruen, wenn
 * das `AND z.ist_live = 1` aus der Abfrage verschwaende — die Attrappe filterte
 * ja selbst weiter.
 *
 * Und sie gibt **nur die erfragten Spalten** zurueck. Am 2026-09-05 hat genau
 * das gefehlt: `befehle.js` waehlte `s.plattform` nicht mit, die Attrappe gab
 * die ganze Zeile, 44 Pruefungen blieben gruen und der erste echte Befehl starb
 * an mysql2.
 *
 *     node scripts/check-streaming-ansagen.js
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

/**
 * Welche Spalten erfragt ein SELECT?
 *
 * @param {string} sql Abfrage in einer Zeile
 * @returns {Array<string>} Feldnamen, ohne Tabellenkuerzel, mit AS-Namen
 */
function spaltenAus(sql) {
    const teil = /^SELECT\s+(.*?)\s+FROM\s/i.exec(sql);
    if (!teil) return [];
    return teil[1].split(',').map(roh => {
        const alias = /\s+AS\s+([A-Za-z0-9_]+)\s*$/i.exec(roh);
        if (alias) return alias[1];
        return roh.trim().replace(/^[A-Za-z0-9_]+\./, '');
    }).filter(Boolean);
}

// --- Die Welt ------------------------------------------------------------
const welt = {
    ansagen: [],
    streamer: { id: 1, kanal_id: 'k1', login: 'firedervil', anzeigename: 'FireDervil',
                heim_guild_id: 'g1' },
    live: true,
    guildLaeuft: true,
    zeilen: 0          // was der Conduit gezaehlt hat
};
const mitschrift = { auftraege: [], schreibzugriffe: [], unbekannt: [] };

ServiceManager.register('Logger', {
    info: () => {}, debug: () => {}, warn: () => {}, error: () => {}, success: () => {}
});

ServiceManager.register('dbService', {
    async query(sql, w = []) {
        const s = String(sql).replace(/\s+/g, ' ').trim();

        // --- faellige() --------------------------------------------------
        if (/^SELECT .* FROM streaming_announcements a JOIN streaming_streamers s/.test(s)
            && /streaming_state/.test(s)) {

            // **Jede Bedingung greift nur, wenn sie in der Abfrage steht.**
            const fragtLive     = s.includes('z.ist_live = 1');
            const fragtAktiv    = s.includes('a.aktiv = 1');
            const fragtHeim     = s.includes('s.heim_guild_id = a.guild_id');
            const fragtIntervall = s.includes('DATE_SUB');

            const jetzt = Date.now();
            const spalten = spaltenAus(s);

            const treffer = welt.ansagen.filter(a => {
                if (fragtAktiv && !a.aktiv) return false;
                if (fragtLive && !welt.live) return false;
                if (fragtHeim && String(welt.streamer.heim_guild_id) !== String(a.guild_id)) return false;
                if (fragtIntervall && a.zuletzt_am) {
                    const alter = jetzt - new Date(a.zuletzt_am).getTime();
                    if (alter < Number(a.intervall_min) * 60000) return false;
                }
                return true;
            }).sort((x, y) => {
                if (!x.zuletzt_am && y.zuletzt_am) return -1;
                if (x.zuletzt_am && !y.zuletzt_am) return 1;
                if (x.zuletzt_am && y.zuletzt_am) {
                    const d = new Date(x.zuletzt_am) - new Date(y.zuletzt_am);
                    if (d) return d;
                }
                return x.id - y.id;
            });

            return treffer.map(a => {
                const voll = { ...a, ...welt.streamer, id: a.id, streamer_id: a.streamer_id };
                return Object.fromEntries(spalten.map(k => [k, voll[k]]));
            });
        }

        // --- laufendeGuilds() --------------------------------------------
        if (/^SELECT g\._id AS guild_id FROM guilds g/.test(s)) {
            pruefeGuildAbfrage(s);
            return welt.guildLaeuft ? w.map(k => ({ guild_id: k })) : [];
        }

        // --- alleFuerGuild() ---------------------------------------------
        if (/^SELECT .* FROM streaming_announcements a JOIN streaming_streamers s/.test(s)) {
            const spalten = spaltenAus(s);
            return welt.ansagen
                .filter(a => String(a.guild_id) === String(w[0]))
                .map(a => Object.fromEntries(
                    spalten.map(k => [k, { ...a, ...welt.streamer, id: a.id }[k]])));
        }

        // --- anlegen(): gehoert der Kanal dieser Guild? --------------------
        if (/^SELECT id FROM streaming_streamers WHERE id = \? AND heim_guild_id = \?/.test(s)) {
            return (String(welt.streamer.id) === String(w[0])
                 && String(welt.streamer.heim_guild_id) === String(w[1]))
                ? [{ id: welt.streamer.id }] : [];
        }

        if (s.startsWith('INSERT INTO streaming_announcements')) {
            mitschrift.schreibzugriffe.push({ sql: s, werte: w });
            welt.ansagen.push({
                id: ++idBasis, guild_id: w[0], streamer_id: w[1], text: w[2],
                intervall_min: w[3], mindest_zeilen: w[4], aktiv: 1,
                zuletzt_am: null, gesendet_anzahl: 0
            });
            return {};
        }

        if (s.startsWith('UPDATE streaming_announcements SET zuletzt_am')) {
            mitschrift.schreibzugriffe.push({ sql: s, werte: w });
            const a = welt.ansagen.find(x => x.id === Number(w[0]));
            if (a) a.zuletzt_am = new Date();
            return { affectedRows: a ? 1 : 0 };
        }

        if (s.startsWith('UPDATE streaming_announcements SET text')) {
            mitschrift.schreibzugriffe.push({ sql: s, werte: w });
            // Dieselbe Regel wie beim Befehlsbaukasten: Der Guild-Filter haengt
            // daran, ob die Abfrage ihn wirklich stellt. Ohne diesen Griff
            // bliebe „eine fremde Guild aendert nichts" auch dann gruen, wenn
            // das `AND guild_id = ?` verschwaende.
            const fragtNachGuild = s.includes('guild_id = ?');
            const a = welt.ansagen.find(x =>
                x.id === Number(w[4]) && (!fragtNachGuild || String(x.guild_id) === String(w[5])));
            if (!a) return { affectedRows: 0 };
            Object.assign(a, { text: w[0], intervall_min: w[1], mindest_zeilen: w[2], aktiv: w[3] });
            return { affectedRows: 1 };
        }

        if (s.startsWith('DELETE FROM streaming_announcements')) {
            mitschrift.schreibzugriffe.push({ sql: s, werte: w });
            const fragtNachGuild = s.includes('guild_id = ?');
            const vorher = welt.ansagen.length;
            welt.ansagen = welt.ansagen.filter(a =>
                !(a.id === Number(w[0]) && (!fragtNachGuild || String(a.guild_id) === String(w[1]))));
            return { affectedRows: vorher - welt.ansagen.length };
        }

        if (s.startsWith('INSERT INTO streaming_outbox')) {
            mitschrift.auftraege.push({ guild_id: w[0], nutzlast: JSON.parse(w[1]) });
            return {};
        }

        mitschrift.unbekannt.push(s.slice(0, 80));
        return [];
    }
});

/** Merkt sich, ob die Guild-Abfrage die zwei Bedingungen wirklich stellt. */
const guildAbfrage = { pruefteVerlassen: false, pruefteAn: false };
function pruefeGuildAbfrage(s) {
    guildAbfrage.pruefteVerlassen = s.includes('left_at IS NULL');
    guildAbfrage.pruefteAn = s.includes('is_enabled = 1');
}

// Der Conduit — nur der Zaehler wird gebraucht.
const conduitPfad = require.resolve(path.join(WURZEL, 'plugins/streaming/dashboard/eingang/conduit.js'));
require.cache[conduitPfad] = { id: conduitPfad, filename: conduitPfad, loaded: true, exports: {
    zustand: () => ({ chat: [{ kanal_id: 'k1', name: 'FireDervil', anzahl: welt.zeilen }] })
} };

const ansagen = require(path.join(WURZEL, 'plugins/streaming/dashboard/kern/ansagen.js'));

/** Fortlaufend ueber alle Faelle — der Zeilenstand lebt modulweit. */
let idBasis = 0;

/**
 * @param {Array<Object>} liste Ansagen
 * @param {Object} [welche] Abweichungen von der Standardwelt
 * @returns {void}
 */
function neuAufsetzen(liste = [], welche = {}) {
    welt.ansagen = liste.map(a => ({
        id: ++idBasis, guild_id: 'g1', streamer_id: 1,
        text: 'Komm auf meinen Discord!', intervall_min: 25, mindest_zeilen: 0,
        aktiv: 1, zuletzt_am: null, gesendet_anzahl: 0, ...a
    }));
    welt.live = welche.live !== undefined ? welche.live : true;
    welt.guildLaeuft = welche.guildLaeuft !== undefined ? welche.guildLaeuft : true;
    welt.zeilen = welche.zeilen !== undefined ? welche.zeilen : 0;
    welt.streamer.heim_guild_id = welche.heim !== undefined ? welche.heim : 'g1';
    mitschrift.auftraege = []; mitschrift.schreibzugriffe = []; mitschrift.unbekannt = [];
    ansagen.vergessen();
}

(async () => {

console.log('\nDie Eingabe wird geprueft, bevor etwas gespeichert wird');
{
    pruefe(ansagen.pruefe({ text: '  ', intervall_min: 25, mindest_zeilen: 0 }) === 'text',
        'ohne Text haette die Ansage nichts zu sagen');
    pruefe(ansagen.pruefe({ text: 'x'.repeat(501), intervall_min: 25, mindest_zeilen: 0 }) === 'zu_lang',
        'ueber 500 Zeichen weist Twitch ab — also gar nicht erst speichern');
    pruefe(ansagen.pruefe({ text: 'Hallo {erfunden}', intervall_min: 25, mindest_zeilen: 0 }) === 'platzhalter',
        'ein erfundener Platzhalter stuende woertlich im Chat');
    pruefe(ansagen.pruefe({ text: 'Hallo {rolle}', intervall_min: 25, mindest_zeilen: 0 }) === 'nur_discord',
        '{rolle} ist gueltig — aber nur in Discord, und das steht auch so da');
    pruefe(ansagen.pruefe({ text: 'ok', intervall_min: 1, mindest_zeilen: 0 }) === 'intervall',
        'unter der Untergrenze faellt es durch — die Ratengrenze gilt je Konto');
    pruefe(ansagen.pruefe({ text: 'ok', intervall_min: 99999, mindest_zeilen: 0 }) === 'intervall',
        'und ueber der Obergrenze auch');
    pruefe(ansagen.pruefe({ text: 'ok', intervall_min: 25, mindest_zeilen: -1 }) === 'zeilen',
        'weniger als null Zeilen gibt es nicht');
    pruefe(ansagen.pruefe({ text: 'ok', intervall_min: 25, mindest_zeilen: 0 }) === null,
        'null Zeilen ist dagegen gueltig — es heisst „immer"');
    pruefe(ansagen.pruefe({ text: 'Ich spiele {kategorie}', intervall_min: 5, mindest_zeilen: 3 }) === null,
        'ein erlaubter Platzhalter an der Untergrenze geht durch');
}

console.log('\nWas NICHT hinausgeht');
{
    neuAufsetzen([{}], { live: false });
    await ansagen.lauf();
    pruefe(mitschrift.auftraege.length === 0, 'offline geht nichts hinaus');

    neuAufsetzen([{ aktiv: 0 }]);
    await ansagen.lauf();
    pruefe(mitschrift.auftraege.length === 0, 'eine abgeschaltete Ansage auch nicht');

    neuAufsetzen([{ zuletzt_am: new Date(Date.now() - 60_000), intervall_min: 25 }]);
    await ansagen.lauf();
    pruefe(mitschrift.auftraege.length === 0,
        'und eine, deren Zeit noch nicht um ist, ebenso wenig');

    neuAufsetzen([{}], { guildLaeuft: false });
    await ansagen.lauf();
    pruefe(mitschrift.auftraege.length === 0,
        'eine Guild, die das Plugin abgeschaltet hat, laesst den Bot verstummen');
    pruefe(guildAbfrage.pruefteVerlassen && guildAbfrage.pruefteAn,
        'und dafuer werden beide Bedingungen wirklich gefragt (left_at, is_enabled)');

    // **Der Kanal hat die Heim-Guild gewechselt.** Die alten Ansagen bleiben
    // liegen, aber sie gehen nicht mit — sonst redete der Bot weiter, waehrend
    // die Stelle zum Abstellen in einer anderen Guild liegt.
    neuAufsetzen([{}], { heim: 'g2' });
    await ansagen.lauf();
    pruefe(mitschrift.auftraege.length === 0,
        'nach einem Wechsel der Heim-Guild schweigt die alte Ansage');
}

console.log('\nWas hinausgeht — und wie oft');
{
    neuAufsetzen([{}]);
    await ansagen.lauf();
    pruefe(mitschrift.auftraege.length === 1, 'live, aktiv und faellig: die Ansage wird vorgemerkt');
    pruefe(mitschrift.auftraege[0]?.nutzlast?.ansage_id === welt.ansagen[0].id,
        'der Auftrag traegt die Kennung der Ansage', JSON.stringify(mitschrift.auftraege[0]?.nutzlast));
    pruefe(mitschrift.auftraege[0]?.nutzlast?.streamer_id === 1,
        'und die des Kanals — beides braucht der Ausgang');

    // **`zuletzt_am` beim Vormerken, nicht beim Erfolg.** Sonst liefe eine
    // Ansage, die Twitch ablehnt, im Minutentakt wieder an.
    pruefe(/SET zuletzt_am/.test(mitschrift.schreibzugriffe.map(z => z.sql).join(' ')),
        'die Zeit wird beim Vormerken gesetzt, nicht erst beim Erfolg');

    neuAufsetzen([{}]);
    await ansagen.lauf();
    await ansagen.lauf();
    pruefe(mitschrift.auftraege.length === 1,
        'ein zweiter Lauf gleich danach merkt nichts noch einmal vor',
        String(mitschrift.auftraege.length));

    // Drei Ansagen, alle faellig: Es geht EINE hinaus, sonst kaeme ein Block.
    neuAufsetzen([{}, {}, {}]);
    await ansagen.lauf();
    pruefe(mitschrift.auftraege.length === 1,
        'drei faellige Ansagen im selben Kanal geben eine — nicht drei',
        String(mitschrift.auftraege.length));
}

console.log('\n„Nur wenn was los ist"');
{
    // Beim ersten Sehen weiss niemand, wie viele Zeilen vorher kamen. Also
    // wird gemerkt und gewartet — nicht geschaetzt.
    neuAufsetzen([{ mindest_zeilen: 5 }], { zeilen: 100 });
    await ansagen.lauf();
    pruefe(mitschrift.auftraege.length === 0,
        'beim ersten Sehen wird nur gemerkt, nicht gesendet');

    welt.zeilen = 103;
    await ansagen.lauf();
    pruefe(mitschrift.auftraege.length === 0,
        'drei Zeilen sind weniger als fuenf — es bleibt still');

    welt.zeilen = 106;
    await ansagen.lauf();
    pruefe(mitschrift.auftraege.length === 1,
        'ab der fuenften Zeile geht sie hinaus', String(mitschrift.auftraege.length));

    // Die Leitung reisst ab: Der Zaehler faengt bei null an. Die Differenz
    // waere negativ — „unendlich viele Zeilen fehlen". Richtig ist: von vorn.
    neuAufsetzen([{ mindest_zeilen: 3 }], { zeilen: 500 });
    await ansagen.lauf();                 // merkt 500
    welt.zeilen = 2;                      // Leitung neu, Zaehler zurueck
    await ansagen.lauf();
    pruefe(mitschrift.auftraege.length === 0,
        'nach einem Abriss der Leitung wird neu gezaehlt, statt sofort zu senden');
    welt.zeilen = 6;
    await ansagen.lauf();
    pruefe(mitschrift.auftraege.length === 1,
        'und danach greift die Bedingung wieder normal');

    // Mit 0 gibt es keine Wartezeit — der haeufigste Fall soll nicht stolpern.
    neuAufsetzen([{ mindest_zeilen: 0 }], { zeilen: 0 });
    await ansagen.lauf();
    pruefe(mitschrift.auftraege.length === 1, 'mit 0 Zeilen geht sie sofort hinaus');
}

console.log('\nEine Guild fasst nur ihre eigenen Ansagen an');
{
    neuAufsetzen([]);
    await ansagen.anlegen('g1', 1, { text: 'Meins', intervall_min: 25, mindest_zeilen: 0 });
    const id = welt.ansagen[0].id;

    const fremd = await ansagen.aendern(id, 'g2',
        { text: 'gekapert', intervall_min: 25, mindest_zeilen: 0 });
    pruefe(fremd.ok === false, 'eine fremde Guild aendert nichts');
    pruefe(welt.ansagen[0].text === 'Meins', 'und der Text steht unveraendert da',
        welt.ansagen[0].text);
    pruefe(await ansagen.entfernen(id, 'g2') === false, 'und loescht auch nichts');
    pruefe(welt.ansagen.length === 1, 'die Zeile ist noch da');

    const eigen = await ansagen.aendern(id, 'g1',
        { text: 'Neu', intervall_min: 30, mindest_zeilen: 2 });
    pruefe(eigen.ok === true, 'die eigene Guild darf');

    // Und ein fremder Kanal laesst sich nicht unterschieben.
    const fremderKanal = await ansagen.anlegen('g1', 99,
        { text: 'x', intervall_min: 25, mindest_zeilen: 0 });
    pruefe(fremderKanal.grund === 'kanal',
        'ein Kanal, der dieser Guild nicht gehoert, wird abgewiesen');
}

console.log('\nVon den Chatnachrichten bleibt nichts liegen');
{
    // Dieselbe Zusage wie beim Befehlsbaukasten, und dieselbe zweite Sperre:
    // Die Tabelle hat gar keine Spalte, in die so etwas passte.
    const fs = require('fs');
    const mig = fs.readFileSync(path.join(WURZEL,
        'plugins/streaming/migrations/20260905_170000_ansagen.js'), 'utf8');
    const tabelle = (mig.match(/CREATE TABLE streaming_announcements \(([\s\S]*?)\) ENGINE/) || [])[1] || '';
    const ohneKommentar = tabelle.replace(/--[^\n]*/g, '');
    pruefe(!/absender|chatter|nachricht|verlauf/i.test(ohneKommentar),
        'keine Spalte fuer Absender, Text oder Verlauf');

    // Die Kollation ist keine Formalie: Ohne sie wirft jeder Vergleich mit
    // dem Kern „Illegal mix of collations".
    pruefe(/utf8mb4_unicode_ci/.test(mig),
        'die Tabelle steht auf derselben Kollation wie `guilds._id`');
}

console.log('\nDie Attrappe hat alles verstanden');
pruefe(mitschrift.unbekannt.length === 0, 'keine unbekannte Abfrage still mit `[]` beantwortet',
    mitschrift.unbekannt.length ? [...new Set(mitschrift.unbekannt)].join(' | ') : '');

console.log(abweichungen === 0
    ? `\nErgebnis: ${faelle} Pruefungen, 0 Abweichungen.\n`
    : `\nErgebnis: ${faelle} Pruefungen, ${abweichungen} Abweichung(en).\n`);
process.exit(abweichungen === 0 ? 0 : 1);

})().catch(err => { console.error('\nAbbruch:', err.message, '\n', err.stack); process.exit(1); });
