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

/**
 * Welche Spalten erfragt ein SELECT?
 *
 * Tabellenkuerzel (`s.`, `z.`) und `AS`-Namen fallen weg — uebrig bleibt, wie
 * das Feld in der Zeile heisst, die mysql2 zurueckgibt.
 *
 * @param {string} sql Abfrage in einer Zeile
 * @returns {Array<string>} Feldnamen
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

// --- Attrappen -----------------------------------------------------------
const daten = { streamer: [], befehle: [], bausteine: [] };
const mitschrift = { schreibzugriffe: [], gesendet: [], unbekannt: [], bausteinAbfragen: 0 };

/**
 * Unbekannte Abfragen ueber den GANZEN Lauf.
 *
 * **`mitschrift.unbekannt` wird von `neuAufsetzen` geleert** - die
 * Schlusspruefung sah damit nur den letzten Fall. Am 2026-09-05 kam eine neue
 * Abfrage (`streaming_variables`) dazu, lief in jedem Fall ins Leere, und der
 * Waechter meldete 61 von 61. Diese Liste wird nie geleert.
 */
const nieGeleert = [];

ServiceManager.register('Logger', {
    info: () => {}, debug: () => {}, warn: () => {}, error: () => {}, success: () => {}
});
ServiceManager.register('dbService', {
    async query(sql, w = []) {
        const s = String(sql).replace(/\s+/g, ' ').trim();

        if (/^SELECT .* FROM streaming_streamers s\b/.test(s)) {
            // **Die Attrappe gibt zurueck, was die Abfrage erfragt — nicht,
            // was der Fall vorbereitet hat.** Vorher lieferte sie die ganze
            // Zeile, egal welche Spalten dastanden. Deshalb blieb am
            // 2026-09-05 gruen, dass `s.plattform` in der Abfrage fehlte:
            // `kanalInhaber` bekam `undefined`, und mysql2 hat den ersten
            // echten `!uptime` damit zerlegt. Eine Attrappe, die grosszuegiger
            // ist als die Datenbank, prueft nichts — sie beruhigt.
            const spalten = spaltenAus(s);
            return daten.streamer
                .filter(x => String(x.kanal_id) === String(w[0]))
                .map(x => Object.fromEntries(spalten.map(k => [k, x[k]])));
        }
        if (/^SELECT name, art, wert, zahl, streamer_id FROM streaming_variables/.test(s)) {
            mitschrift.bausteinAbfragen++;
            const spalten = spaltenAus(s);
            // Wie die echte Abfrage: Kanalzeile vor Guildzeile.
            return (daten.bausteine || [])
                .filter(b => String(b.guild_id) === String(w[0])
                          && (b.streamer_id === w[1] || b.streamer_id === null))
                .filter(b => w.length <= 2 || w.slice(2).includes(b.name))
                .sort((a, b) => (a.streamer_id === null ? 1 : 0) - (b.streamer_id === null ? 1 : 0))
                .map(b => Object.fromEntries(spalten.map(k => [k, b[k]])));
        }

        // --- hochzaehlen() -------------------------------------------------
        if (/^UPDATE streaming_variables SET zahl = zahl \+ 1/.test(s)) {
            mitschrift.schreibzugriffe.push({ sql: s, werte: w });
            // **Die Bedingungen greifen nur, wenn die Abfrage sie stellt.**
            const fragtArt   = s.includes("art = 'zaehler'");
            const fragtGuild = s.includes('guild_id = ?');
            const treffer = (daten.bausteine || [])
                .filter(b => (!fragtGuild || String(b.guild_id) === String(w[0]))
                          && b.name === w[1]
                          && (!fragtArt || b.art === 'zaehler')
                          && (b.streamer_id === w[2] || b.streamer_id === null))
                .sort((a, b) => (a.streamer_id === null ? 1 : 0) - (b.streamer_id === null ? 1 : 0))[0];
            if (!treffer) return { affectedRows: 0 };
            treffer.zahl = Number(treffer.zahl || 0) + 1;
            return { affectedRows: 1 };
        }
        // Nicht mehr an der vollen Spaltenliste festgemacht: Sie waechst mit
        // jeder Erweiterung, und die Attrappe wurde am 2026-09-05 zweimal
        // daran blind. Der Tabellenname traegt die Erkennung.
        if (/^SELECT .* FROM streaming_commands WHERE guild_id/.test(s)) {
            return daten.befehle.filter(x =>
                String(x.guild_id) === String(w[0]) &&
                x.aktiv !== 0 &&
                (x.streamer_id === w[1] || x.streamer_id === null || x.streamer_id === undefined));
        }
        if (s.startsWith('INSERT INTO streaming_commands (guild_id, streamer_id, wort, art, antwort')) {
            mitschrift.schreibzugriffe.push({ sql: s, werte: w });
            if (daten.befehle.some(z => z.guild_id === w[0] && z.wort === w[2])) {
                const e = new Error('Duplicate'); e.code = 'ER_DUP_ENTRY'; throw e;
            }
            // **Die Werte werden ueber die Spaltenliste zugeordnet, nicht ueber
            // ihre Position.** Vorher stand hier `wer: w[4]` — als das
            // Zaehlerfeld dazukam, landete der Zaehlername in `wer`, und kein
            // Test merkte es, weil keiner `wer` nach dem Anlegen ansieht.
            // Spalten UND Werte paaren: In `VALUES (?, ?, ?, 'eigen', ?, …)`
            // steht fuer `art` ein Literal, kein Platzhalter. Wer nur die
            // Spalten durchzaehlt, verschiebt ab dort alles um eins.
            const namen = (/\(([^)]*)\)\s*VALUES/i.exec(s)?.[1] || '')
                .split(',').map(x => x.trim());
            const stellen = (/VALUES\s*\(([^)]*)\)/i.exec(s)?.[1] || '')
                .split(',').map(x => x.trim());
            const zu = {};
            let n = 0;
            namen.forEach((spalte, i) => {
                zu[spalte] = stellen[i] === '?' ? w[n++] : stellen[i].replace(/^'|'$/g, '');
            });

            if (daten.befehle.some(z => z.guild_id === zu.guild_id && z.wort === zu.wort)) {
                const e = new Error('Duplicate'); e.code = 'ER_DUP_ENTRY'; throw e;
            }
            daten.befehle.push({
                id: ++idBasis, art: 'eigen', aktiv: 1, benutzt_anzahl: 0,
                guild_id: zu.guild_id, streamer_id: zu.streamer_id, wort: zu.wort,
                antwort: zu.antwort, zaehler_name: zu.zaehler_name ?? null,
                wer: zu.wer, abkuehlung_s: zu.abkuehlung_s
            });
            return [];
        }
        if (s.startsWith('INSERT INTO streaming_commands (guild_id, streamer_id, wort, art, aktiv)')) {
            mitschrift.schreibzugriffe.push({ sql: s, werte: w });
            const da = daten.befehle.find(z => z.guild_id === w[0] && z.wort === w[2]);
            if (da) { da.aktiv = w[3]; da.art = 'fertig'; }
            else daten.befehle.push({ id: ++idBasis, guild_id: w[0], streamer_id: w[1],
                wort: w[2], art: 'fertig', aktiv: w[3], wer: 'alle', abkuehlung_s: 0 });
            return [];
        }
        if (s.startsWith('DELETE FROM streaming_commands')) {
            mitschrift.schreibzugriffe.push({ sql: s, werte: w });
            // **Die Attrappe bildet die Abgrenzung nicht nach, sie prueft sie.**
            // Stuende hier schlicht der Vergleich, bliebe der Fall "eine fremde
            // Guild loescht nichts" auch dann gruen, wenn der Code das
            // `AND guild_id = ?` verliert — die Werte kaemen ja weiterhin mit.
            // Genau das ist beim ersten Anlauf passiert.
            const fragtNachGuild = s.includes('guild_id = ?');
            const vorher = daten.befehle.length;
            daten.befehle = daten.befehle.filter(z =>
                !(z.id === Number(w[0])
                  && (!fragtNachGuild || String(z.guild_id) === String(w[1]))));
            return { affectedRows: vorher - daten.befehle.length };
        }
        if (s.startsWith('SELECT id, streamer_id, wort, art, antwort, wer, abkuehlung_s, aktiv')) {
            return daten.befehle.filter(z => String(z.guild_id) === String(w[0]));
        }
        if (s.startsWith('UPDATE streaming_commands SET antwort')) {
            mitschrift.schreibzugriffe.push({ sql: s, werte: w });
            // Dieselbe Regel wie beim DELETE: Der Filter haengt daran, ob die
            // Abfrage die Bedingung wirklich stellt.
            const fragtNachGuild = s.includes('guild_id = ?');
            // **Die letzten beiden Werte sind `id` und `guild_id`** — so ist
            // das `WHERE` gebaut. Feste Positionen (w[4], w[5]) hingen an der
            // Zahl der gesetzten Spalten und brachen, sobald eine dazukam;
            // am 2026-09-05 beim Zaehlerfeld genau so passiert.
            const kennung = Number(w[w.length - 2]);
            const guild = String(w[w.length - 1]);
            const z = daten.befehle.find(x =>
                x.id === kennung
                && (!fragtNachGuild || String(x.guild_id) === guild));
            if (!z) return { affectedRows: 0 };
            Object.assign(z, { antwort: w[0], wer: w[1], abkuehlung_s: w[2], aktiv: w[3] });
            return { affectedRows: 1 };
        }
        if (s.startsWith('UPDATE streaming_commands')) {
            // **Jeder Schreibzugriff wird mitgeschrieben, samt Werten.** Genau
            // hier wuerde ein spaeter eingebauter Text landen.
            mitschrift.schreibzugriffe.push({ sql: s, werte: w });
            return [];
        }
        mitschrift.unbekannt.push(s.slice(0, 70));
        nieGeleert.push(s.slice(0, 70));
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
    /**
     * **Sie prueft, was ihr gegeben wird.** Der echte `kanalInhaber` sucht mit
     * `plattform` UND `kanal_id`; fehlt eine davon, ist der Bindewert
     * `undefined` und mysql2 wirft. Eine Attrappe, die das Argument gar nicht
     * ansieht, macht diesen Fehler unsichtbar — und genau so ist er in die
     * Anlage gekommen.
     */
    async kanalInhaber(streamer) {
        for (const feld of ['plattform', 'kanal_id']) {
            if (streamer?.[feld] === undefined || streamer?.[feld] === null) {
                throw new Error(
                    `kanalInhaber ohne \`${feld}\` gerufen — mysql2 wuerde hier werfen `
                    + '("Bind parameters must not contain undefined")');
            }
        }
        return 'nutzer-1';
    }
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

function neuAufsetzen(zeilen = [], live = true, begonnenVorMs = 8100000, bausteine = []) {
    daten.bausteine = bausteine.map(b => ({ guild_id: 'g1', streamer_id: 1, art: 'text', wert: '', zahl: 0, ...b }));
    daten.streamer = [{
        id: 1, plattform: 'twitch', login: 'firedervil', anzeigename: 'FireDervil', kanal_id: 'k1',
        heim_guild_id: 'g1', ist_live: live ? 1 : 0,
        titel: 'Erster Versuch', kategorie: 'Astro Colony',
        // **Auch offline steht hier ein Datum.** `streaming_state` behaelt den
        // letzten Stand, statt ihn zu leeren - am 2026-09-05 an der echten
        // Tabelle nachgesehen: `ist_live` 0, `begonnen_am` von gestern. Eine
        // Attrappe, die hier `null` setzte, waere nachsichtiger als die
        // Datenbank und liesse ein vergessenes `k.live` durchgehen.
        begonnen_am: new Date(Date.now() - begonnenVorMs)
    }];
    daten.befehle = zeilen.map((z, i) => ({
        id: ++idBasis, guild_id: 'g1', streamer_id: 1, aktiv: 1,
        art: 'eigen', wer: 'alle', abkuehlung_s: 0, antwort: null, ...z
    }));
    mitschrift.schreibzugriffe = []; mitschrift.gesendet = []; mitschrift.unbekannt = [];
    mitschrift.bausteinAbfragen = 0;
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

    // **Was nur im Stream gilt, verschwindet danach — auch in eigenen Texten.**
    // `streaming_state` behaelt Titel und Kategorie; wer sie offline einsetzt,
    // liest den letzten Stream als den laufenden. Die Attrappe traegt deshalb
    // beides weiterhin, damit hier wirklich `k.live` geprueft wird und nicht
    // eine leere Zeile.
    neuAufsetzen([{ wort: 'jetzt', antwort: '{streamer} spielt {spiel} ({titel}) seit {uptime}.' }], false);
    await befehle.auswerten(nachricht('!jetzt'));
    {
        const t = mitschrift.gesendet[0]?.text || '';
        pruefe(!/Astro Colony/.test(t), 'offline nennt {spiel} nicht die Kategorie von gestern', t);
        pruefe(!/Erster Versuch/.test(t), 'offline nennt {titel} nicht den Titel von gestern', t);
        pruefe(!/Stunde|Minute/.test(t), 'und {uptime} keine Dauer', t);
        pruefe(/FireDervil/.test(t), 'der Kanalname bleibt — er haengt nicht am Stream', t);
    }

    // Die Gegenprobe im selben Atemzug: live muessen sie dastehen. Sonst waere
    // "offline leer" auch dann erfuellt, wenn sie nie etwas lieferten.
    neuAufsetzen([{ wort: 'jetzt', antwort: '{spiel} ({titel}) seit {uptime}.' }], true);
    await befehle.auswerten(nachricht('!jetzt'));
    {
        const t = mitschrift.gesendet[0]?.text || '';
        pruefe(/Astro Colony/.test(t) && /Erster Versuch/.test(t) && /Stunde/.test(t),
            'live stehen alle drei da', t);
    }

    // --- Argumente: was der Zuschauer hinter den Befehl schreibt ---------
    neuAufsetzen([{ wort: 'shoutout', antwort: 'Schaut bei {rest} vorbei!' }]);
    await befehle.auswerten(nachricht('!shoutout Anna und Bert'));
    pruefe(mitschrift.gesendet[0]?.text === 'Schaut bei Anna und Bert vorbei!',
        '{rest} ist alles hinter dem Wort', mitschrift.gesendet[0]?.text);

    neuAufsetzen([{ wort: 'gegen', antwort: '{1} gegen {2}.' }]);
    await befehle.auswerten(nachricht('!gegen Anna Bert'));
    pruefe(mitschrift.gesendet[0]?.text === 'Anna gegen Bert.',
        '{1} und {2} sind die einzelnen Woerter', mitschrift.gesendet[0]?.text);

    neuAufsetzen([{ wort: 'gegen', antwort: 'A:{1} B:{2} Rest:{rest}.' }]);
    await befehle.auswerten(nachricht('!gegen Anna'));
    pruefe(mitschrift.gesendet[0]?.text === 'A:Anna B: Rest:Anna.',
        'ein fehlendes Argument wird leer, nicht stehengelassen', mitschrift.gesendet[0]?.text);

    // **Der Fall, um den es sicherheitshalber geht.** Die Argumente sind das
    // einzige an der Antwort, das ein beliebiger Zuschauer bestimmt. Wuerden
    // sie vor den Platzhaltern eingesetzt, koennte er sich seine eigenen
    // bauen und den Bot Dinge sagen lassen, die der Streamer nie einstellte.
    neuAufsetzen([{ wort: 'echo', antwort: 'Du sagst: {rest}' }]);
    await befehle.auswerten(nachricht('!echo {spiel} und {streamer}'));
    {
        const t = mitschrift.gesendet[0]?.text || '';
        pruefe(t === 'Du sagst: {spiel} und {streamer}',
            'ein Zuschauer kann sich keinen Platzhalter erschleichen', t);
        pruefe(!/Astro Colony/.test(t) && !/FireDervil/.test(t),
            'weder Kategorie noch Kanalname sickern durch fremde Eingabe durch', t);
    }

    neuAufsetzen([{ wort: 'shoutout', antwort: 'Schaut bei {rest} vorbei!' }]);
    await befehle.auswerten(nachricht('!shoutout'));
    pruefe(mitschrift.gesendet[0]?.text === 'Schaut bei vorbei!',
        'ohne Argument bleibt kein doppeltes Leerzeichen stehen', mitschrift.gesendet[0]?.text);

    // --- Der Chat ist einzeilig, das Eingabefeld nicht ---------------------
    // Ein `<textarea>` laedt zu Listen ein; Twitch kennt keine Zeilen. Was es
    // mit einem `\n` macht, ist nirgends zugesagt — also gehen keine hinaus.
    neuAufsetzen([{ wort: 'regeln', antwort: '- nett sein\r\n- zuhoeren\r\n- Spass haben' }]);
    await befehle.auswerten(nachricht('!regeln'));
    {
        const t = mitschrift.gesendet[0]?.text || '';
        pruefe(!/[\r\n]/.test(t), 'kein Zeilenumbruch geht in den Chat hinaus', JSON.stringify(t));
        pruefe(/zuhoeren/.test(t) && /Spass haben/.test(t),
            'und es geht dabei nichts vom Text verloren', t);
    }

    // Leerraum am Rand darf den Satz nicht laenger aussehen lassen als er ist.
    neuAufsetzen([{ wort: 'x', antwort: '   Hallo    Welt   ' }]);
    await befehle.auswerten(nachricht('!x'));
    pruefe(mitschrift.gesendet[0]?.text === 'Hallo Welt',
        'mehrfacher Leerraum wird zu einem', JSON.stringify(mitschrift.gesendet[0]?.text));

    neuAufsetzen([{ wort: 'lang', antwort: 'x'.repeat(900) }]);
    await befehle.auswerten(nachricht('!lang'));
    pruefe((mitschrift.gesendet[0]?.text || '').length === 500,
        'laenger als Twitch nimmt wird gekuerzt, nicht abgelehnt',
        String((mitschrift.gesendet[0]?.text || '').length));

    neuAufsetzen([{ wort: 'leer', antwort: '   ' }]);
    await befehle.auswerten(nachricht('!leer'));
    pruefe(mitschrift.gesendet.length === 0, 'ein leerer Satz wird gar nicht erst gesendet');
}

console.log('\nEigene Textbausteine');
{
    const bausteine = require(path.join(WURZEL, 'plugins/streaming/dashboard/kern/bausteine.js'));

    // --- Was gespeichert werden darf ---------------------------------------
    pruefe(bausteine.pruefe({ name: 'discord', wert: 'https://x' }) === null,
        'ein gewoehnlicher Name geht durch');
    pruefe(bausteine.pruefe({ name: '{discord}', wert: 'https://x' }) === null,
        'die Klammern darf man mittippen — sie gehoeren der Schreibweise');
    pruefe(bausteine.pruefe({ name: 'mein name', wert: 'x' }) === 'name',
        'ein Leerzeichen im Namen waere im Text nicht wiederzufinden');
    pruefe(bausteine.pruefe({ name: 'spiel', wert: 'x' }) === 'belegt',
        'ein eingebauter Name ist vergeben — sonst verdeckt der eigene ihn');
    pruefe(bausteine.pruefe({ name: 'rest', wert: 'x' }) === 'belegt',
        'auch {rest} — es ist eingebaut, steht aber nicht in der sichtbaren Liste');
    pruefe(bausteine.pruefe({ name: '3', wert: 'x' }) === 'belegt',
        'und {3}, obwohl nur {1} auf der Seite steht');
    pruefe(bausteine.pruefe({ name: 'discord', wert: '  ' }) === 'wert',
        'ohne Wert waere der Baustein leer');
    pruefe(bausteine.pruefe({ name: 'discord', wert: 'x'.repeat(501) }) === 'zu_lang',
        'laenger als eine Chatnachricht kann kein Baustein sein');

    // --- Was im Chat daraus wird -------------------------------------------
    neuAufsetzen([{ wort: 'discord', antwort: 'Komm rein: {discord}' }], true, 8100000,
        [{ id: 1, name: 'discord', wert: 'https://discord.gg/abc' }]);
    await befehle.auswerten(nachricht('!discord'));
    pruefe(mitschrift.gesendet[0]?.text === 'Komm rein: https://discord.gg/abc',
        'der eigene Baustein wird eingesetzt', mitschrift.gesendet[0]?.text);

    // Bausteine kommen VOR den eingebauten — also darf einer sie enthalten.
    neuAufsetzen([{ wort: 'gruss', antwort: '{gruss}' }], true, 8100000,
        [{ id: 1, name: 'gruss', wert: 'Hallo {absender}, hier ist {streamer}!' }]);
    await befehle.auswerten(nachricht('!gruss'));
    pruefe(mitschrift.gesendet[0]?.text === 'Hallo Anna, hier ist FireDervil!',
        'ein Baustein darf eingebaute Platzhalter enthalten', mitschrift.gesendet[0]?.text);

    // **Genau ein Durchgang.** `{a}` mit dem Wert `{a}` liefe sonst endlos.
    neuAufsetzen([{ wort: 'x', antwort: '{a}' }], true, 8100000,
        [{ id: 1, name: 'a', wert: 'siehe {a}' }]);
    await befehle.auswerten(nachricht('!x'));
    pruefe(mitschrift.gesendet[0]?.text === 'siehe {a}',
        'ein Baustein, der sich selbst nennt, laeuft nicht im Kreis',
        mitschrift.gesendet[0]?.text);

    // Die Kanalzeile gewinnt gegen die Zeile der ganzen Guild.
    neuAufsetzen([{ wort: 'x', antwort: '{ort}' }], true, 8100000, [
        { id: 1, name: 'ort', wert: 'fuer alle',  streamer_id: null },
        { id: 2, name: 'ort', wert: 'fuer diesen Kanal', streamer_id: 1 }
    ]);
    await befehle.auswerten(nachricht('!x'));
    pruefe(mitschrift.gesendet[0]?.text === 'fuer diesen Kanal',
        'die Zeile des Kanals gewinnt gegen die der Guild', mitschrift.gesendet[0]?.text);

    // **Kein Zuschauer erschleicht sich einen Baustein.** Argumente kommen
    // zuletzt — der eingesetzte Text wird nicht noch einmal angesehen.
    neuAufsetzen([{ wort: 'echo', antwort: 'Du sagst: {rest}' }], true, 8100000,
        [{ id: 1, name: 'geheim', wert: 'NICHTFUERALLE' }]);
    await befehle.auswerten(nachricht('!echo {geheim}'));
    pruefe(mitschrift.gesendet[0]?.text === 'Du sagst: {geheim}',
        'ein Zuschauer kann keinen fremden Baustein hervorlocken',
        mitschrift.gesendet[0]?.text);

    // Und die Abfrage laeuft nur, wenn der Text sie braucht.
    neuAufsetzen([{ wort: 'x', antwort: 'Hallo {absender}, {streamer} spielt {spiel}.' }]);
    await befehle.auswerten(nachricht('!x'));
    pruefe(mitschrift.bausteinAbfragen === 0,
        'ohne fremden Namen im Text wird die Tabelle gar nicht erst gefragt',
        String(mitschrift.bausteinAbfragen));

    neuAufsetzen([{ wort: 'x', antwort: 'Da: {irgendwas}' }]);
    await befehle.auswerten(nachricht('!x'));
    pruefe(mitschrift.bausteinAbfragen === 1,
        'mit einem fremden Namen genau einmal', String(mitschrift.bausteinAbfragen));
    pruefe(mitschrift.gesendet[0]?.text === 'Da: {irgendwas}',
        'und ein Name ohne Baustein bleibt stehen, statt leer zu verschwinden',
        mitschrift.gesendet[0]?.text);
}

console.log('\nZaehler');
{
    const bausteine = require(path.join(WURZEL, 'plugins/streaming/dashboard/kern/bausteine.js'));

    pruefe(bausteine.pruefe({ name: 'tode', art: 'zaehler', zahl: 0 }) === null,
        'ein Zaehler darf bei 0 anfangen — die uebliche Zahl');
    pruefe(bausteine.pruefe({ name: 'tode', art: 'zaehler', zahl: -1 }) === 'zahl',
        'unter null gibt es nicht');
    pruefe(bausteine.pruefe({ name: 'tode', art: 'zaehler', zahl: 1.5 }) === 'zahl',
        'und halbe Tode auch nicht');
    pruefe(bausteine.pruefe({ name: 'spiel', art: 'zaehler', zahl: 0 }) === 'belegt',
        'ein eingebauter Name bleibt auch fuer Zaehler vergeben');

    // --- Der Normalfall ---------------------------------------------------
    neuAufsetzen([{ wort: 'tode', antwort: 'Schon {tode} mal gestorben.', zaehler_name: 'tode' }],
        true, 8100000, [{ id: 1, name: 'tode', art: 'zaehler', zahl: 3 }]);
    await befehle.auswerten(nachricht('!tode'));
    pruefe(mitschrift.gesendet[0]?.text === 'Schon 4 mal gestorben.',
        'die Antwort nennt den NEUEN Stand, nicht den alten',
        mitschrift.gesendet[0]?.text);
    pruefe(daten.bausteine[0].zahl === 4, 'und in der Zeile steht er auch',
        String(daten.bausteine[0].zahl));

    // Hochzaehlen ohne ihn zu nennen — der Befehl darf schweigen und zaehlen.
    neuAufsetzen([{ wort: 'tot', antwort: 'Autsch.', zaehler_name: 'tode' }],
        true, 8100000, [{ id: 1, name: 'tode', art: 'zaehler', zahl: 10 }]);
    await befehle.auswerten(nachricht('!tot'));
    pruefe(mitschrift.gesendet[0]?.text === 'Autsch.', 'der Text bleibt, wie er ist');
    pruefe(daten.bausteine[0].zahl === 11,
        'und es wird trotzdem hochgezaehlt', String(daten.bausteine[0].zahl));

    // --- Wann NICHT hochgezaehlt wird -------------------------------------
    neuAufsetzen([{ wort: 'tode', antwort: '{tode}', wer: 'moderator', zaehler_name: 'tode' }],
        true, 8100000, [{ id: 1, name: 'tode', art: 'zaehler', zahl: 7 }]);
    await befehle.auswerten(nachricht('!tode'));
    pruefe(daten.bausteine[0].zahl === 7,
        'wer nicht darf, zaehlt auch nicht hoch', String(daten.bausteine[0].zahl));

    neuAufsetzen([{ wort: 'tode', antwort: '{tode}', abkuehlung_s: 30, zaehler_name: 'tode' }],
        true, 8100000, [{ id: 1, name: 'tode', art: 'zaehler', zahl: 0 }]);
    await befehle.auswerten(nachricht('!tode'));
    await befehle.auswerten(nachricht('!tode'));
    pruefe(daten.bausteine[0].zahl === 1,
        'und der zweite Aufruf in der Abkuehlung ebenso wenig',
        String(daten.bausteine[0].zahl));

    // --- Ein Textbaustein ist kein Zaehler --------------------------------
    // **Der Fall, den `art = 'zaehler'` in der Abfrage verhindert.** Ohne ihn
    // erhoehte `hochzaehlen` die `zahl` eines Textbausteins — unsichtbar, weil
    // sie dort niemand liest, aber die Bedingung waere weg.
    neuAufsetzen([{ wort: 'x', antwort: 'da', zaehler_name: 'discord' }],
        true, 8100000, [{ id: 1, name: 'discord', art: 'text', wert: 'https://x', zahl: 0 }]);
    await befehle.auswerten(nachricht('!x'));
    pruefe(daten.bausteine[0].zahl === 0,
        'ein Textbaustein wird nicht hochgezaehlt, auch wenn der Name stimmt',
        String(daten.bausteine[0].zahl));
    pruefe(mitschrift.gesendet.length === 1,
        'und der Befehl antwortet trotzdem — ein fehlender Zaehler ist kein Fehler');

    // --- Die Kanalzeile gewinnt auch beim Hochzaehlen ----------------------
    neuAufsetzen([{ wort: 'tode', antwort: '{tode}', zaehler_name: 'tode' }],
        true, 8100000, [
            { id: 1, name: 'tode', art: 'zaehler', zahl: 100, streamer_id: null },
            { id: 2, name: 'tode', art: 'zaehler', zahl: 5,   streamer_id: 1 }
        ]);
    await befehle.auswerten(nachricht('!tode'));
    pruefe(daten.bausteine[1].zahl === 6 && daten.bausteine[0].zahl === 100,
        'die Zeile des Kanals wird erhoeht, nicht die der Guild',
        `Guild ${daten.bausteine[0].zahl}, Kanal ${daten.bausteine[1].zahl}`);
}

console.log('\nDie Liste der Platzhalter ist ein Vertrag, keine Behauptung');
{
    // **Behauptet die Liste etwas, das `fuellen` nicht kann?** Die Seite
    // rendert ihre Bausteine aus `PLATZHALTER`. Ein Name, den nur die Liste
    // kennt, stuende woertlich im Chat — und der Streamer haette ihn brav von
    // der Seite abgeschrieben. Genau diese Naht hatte `shared/vorlagen.js`
    // schon benannt; hier wird sie gemessen.
    const namen = befehle.PLATZHALTER.map(p => p.name);
    neuAufsetzen([{ wort: 'alles', antwort: namen.join(' ') }], true);
    await befehle.auswerten(nachricht('!alles Anna Bert'));
    const t = mitschrift.gesendet[0]?.text || '';
    const uebrig = namen.filter(n => t.includes(n));
    pruefe(uebrig.length === 0,
        'jeder Baustein der Liste wird auch wirklich ersetzt',
        uebrig.length ? 'stehengeblieben: ' + uebrig.join(' ') : t);

    // Und die Gegenrichtung: Die Vorlage darf keine eigene Liste fuehren.
    const vorlage = require('fs').readFileSync(path.join(WURZEL,
        'plugins/streaming/dashboard/views/guild/streaming-befehle.ejs'), 'utf8');
    pruefe(/PLATZHALTER\.forEach/.test(vorlage),
        'die Seite rendert aus der Liste, statt sie danebenzuschreiben');

    const chips = vorlage.match(/<span class="chip mono"[^>]*>\{[a-z0-9]+\}<\/span>/gi) || [];
    pruefe(chips.length === 0,
        'und fuehrt keinen fest eingetippten Baustein mehr',
        chips.join(' '));
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

console.log('\nAnlegen prueft, bevor es schreibt');
{
    neuAufsetzen([]);
    pruefe((await befehle.anlegen('g1', 1, { wort: '!!', antwort: 'x' })).grund === 'wort',
        'ein Wort aus Sonderzeichen wird abgelehnt');
    pruefe((await befehle.anlegen('g1', 1, { wort: 'regeln', antwort: '  ' })).grund === 'antwort',
        'ohne Antwort haette der Befehl nichts zu sagen');
    pruefe((await befehle.anlegen('g1', 1, { wort: 'uptime', antwort: 'x' })).grund === 'belegt',
        'ein eigener Befehl darf nicht heissen wie ein fertiger');
    pruefe((await befehle.anlegen('g1', 1, { wort: '!Regeln', antwort: 'ok' })).ok === true,
        'das Praefix und Grossbuchstaben werden abgeraeumt statt abgelehnt');
    pruefe((await befehle.anlegen('g1', 1, { wort: 'regeln', antwort: 'nochmal' })).grund === 'doppelt',
        'dasselbe Wort ein zweites Mal faellt am Schluessel, nicht an einer Vorabfrage');
}

console.log('\nEine Guild fasst nur ihre eigenen Befehle an');
{
    // **Die Kennung aus der Adresse ist eine Behauptung.** Ohne `AND guild_id`
    // koennte eine Guild die Befehle einer anderen aendern, und die
    // Rechtepruefung am Router saehe trotzdem richtig aus.
    neuAufsetzen([]);
    await befehle.anlegen('g1', 1, { wort: 'meins', antwort: 'A' });
    const id = daten.befehle[0].id;

    pruefe(await befehle.aendern(id, 'g2', { antwort: 'gekapert' }) === false,
        'eine fremde Guild aendert nichts');
    pruefe(daten.befehle[0].antwort === 'A', 'und der Text steht unveraendert da',
        daten.befehle[0].antwort);
    pruefe(await befehle.entfernen(id, 'g2') === false, 'und loescht auch nichts');
    pruefe(daten.befehle.length === 1, 'die Zeile ist noch da');
    pruefe(await befehle.aendern(id, 'g1', { antwort: 'B', wer: 'alle' }) === true,
        'die eigene Guild darf');
}

console.log('\nAbwaehlen schaltet ab, es loescht nicht');
{
    neuAufsetzen([]);
    await befehle.fertigSetzen('g1', 1, ['uptime', 'spiel']);
    const vorher = daten.befehle.length;
    daten.befehle.find(z => z.wort === 'uptime').benutzt_anzahl = 42;

    await befehle.fertigSetzen('g1', 1, ['spiel']);
    const uptime = daten.befehle.find(z => z.wort === 'uptime');
    pruefe(daten.befehle.length === vorher, 'die Zeile bleibt stehen', String(daten.befehle.length));
    pruefe(Number(uptime.aktiv) === 0, 'sie ist nur abgeschaltet');
    pruefe(uptime.benutzt_anzahl === 42,
        'und die Benutzungszahl faengt beim Wiedereinschalten nicht bei null an');
}

console.log('\nDie Attrappe hat alles verstanden');
pruefe(nieGeleert.length === 0,
    'keine unbekannte Abfrage still mit `[]` beantwortet — ueber den ganzen Lauf',
    nieGeleert.length ? [...new Set(nieGeleert)].join(' | ') : '');

console.log(abweichungen === 0
    ? `\nErgebnis: ${faelle} Pruefungen, 0 Abweichungen.\n`
    : `\nErgebnis: ${faelle} Pruefungen, ${abweichungen} Abweichung(en).\n`);
process.exit(abweichungen === 0 ? 0 : 1);

})().catch(err => { console.error('\nAbbruch:', err.message, '\n', err.stack); process.exit(1); });
