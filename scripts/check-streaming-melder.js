#!/usr/bin/env node
/**
 * Prueft die **Melder** (Stufe 12c).
 *
 * Vier stille Fallen sind hier festgenagelt:
 *
 *   1. **Ein Scope, den keine Zusage anbietet, kann niemand erteilen.** Genau
 *      das ist am 2026-08-26 passiert: 35 Pruefungen gruen, und der Betreiber
 *      fand keinen Knopf. Jede Melderart, die einen Scope braucht, muss ueber
 *      eine angemeldete Zusage erreichbar sein.
 *   2. **Der Kern und der Adapter muessen dieselben Namen kennen.** `ARTEN`
 *      hier, `melder:` dort. Weicht eines ab, faellt die Art wortlos weg —
 *      das Haekchen bleibt, die Meldung kommt nie.
 *   3. **Zusammenlegen darf nicht rechnen, wo sich nichts addiert.** Aus drei
 *      Verlaengerungen "42 Monate" zu machen, ist schlicht falsch. Bits und
 *      geschenkte Abos summieren sich, Monate nicht.
 *   4. **Eine Meldung darf nie erwaehnen.** Eine Rolle bei jedem Follow
 *      anzupingen ist der schnellste Weg, dass jeder die Benachrichtigungen
 *      abschaltet — und dann auch die Ankuendigung nicht mehr sieht.
 *
 * Nebenwirkungsfrei: reine Rechnungen und Attrappen, keine Datenbank, kein
 * Twitch, kein Discord.
 *
 *   node scripts/check-streaming-melder.js
 *
 * Exitcode 1 bei jeder Abweichung.
 */
'use strict';

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../apps/dashboard/.env'), quiet: true });

const { ServiceManager } = require('dunebot-core');

let faelle = 0;
let abweichungen = 0;

/**
 * @param {boolean} gut Bedingung
 * @param {string} text Beschreibung
 * @param {string} [zusatz] Ergaenzung
 * @returns {void}
 */
function pruefe(gut, text, zusatz = '') {
    faelle++;
    if (!gut) abweichungen++;
    console.log(`  ${gut ? '✓' : '✗'} ${text}${zusatz ? '  — ' + zusatz : ''}`);
}

// --- Attrappen -----------------------------------------------------------
const daten = { ziele: [], auftraege: [] };
let naechsteId = 1;

ServiceManager.register('Logger', { info: () => {}, debug: () => {}, warn: () => {}, error: () => {}, success: () => {} });
ServiceManager.register('dbService', {
    async query(sql, w = []) {
        const s = String(sql).replace(/\s+/g, ' ').trim();

        if (s.startsWith('SELECT melder_arten FROM streaming_targets')) {
            return daten.ziele.filter(z => z.streamer_id === w[0] && z.aktiv);
        }
        if (s.startsWith('SELECT id, guild_id, channel_id, melder_channel_id, melder_arten')) {
            return daten.ziele.filter(z => z.streamer_id === w[0] && z.aktiv);
        }
        if (s.startsWith('SELECT id, nutzlast FROM streaming_outbox')) {
            // **Die Attrappe bildet die Bedingung nicht nach, sie prueft sie.**
            // Stuende hier schlicht `&& a.wartet`, bliebe der Fall "ein
            // faelliger Auftrag wird nicht mehr ergaenzt" auch dann gruen,
            // wenn der Code `faellig_ab > NOW(3)` verliert — die Attrappe
            // haette den Fehler zugedeckt. Deshalb haengt der Filter daran,
            // ob die Abfrage die Bedingung wirklich stellt.
            const fragtNachFrist = s.includes('faellig_ab > NOW(3)');
            return daten.auftraege
                .filter(a => a.target_id === w[0] && a.aktion === 'melden' && a.zustand === 'offen'
                          && (!fragtNachFrist || a.wartet))
                .sort((x, y) => y.id - x.id)
                .slice(0, 5)
                .map(a => ({ id: a.id, nutzlast: JSON.stringify(a.nutzlast) }));
        }
        if (s.startsWith('UPDATE streaming_outbox SET nutzlast')) {
            const a = daten.auftraege.find(x => x.id === w[1]);
            if (a) a.nutzlast = JSON.parse(w[0]);
            return [];
        }
        if (s.startsWith('INSERT INTO streaming_outbox')) {
            daten.auftraege.push({
                id: naechsteId++, target_id: w[0], guild_id: w[1], aktion: 'melden',
                nutzlast: JSON.parse(w[2]), zustand: 'offen', wartet: Number(w[3]) > 0
            });
            return [];
        }
        return [];
    }
});

const melder = require('../plugins/streaming/dashboard/kern/melder');
const nachricht = require('../plugins/streaming/dashboard/ausgabe/nachricht');
const twitch = require('../plugins/streaming/dashboard/plattformen/twitch');

const ARTEN = Object.keys(melder.ARTEN);
const STREAMER = { id: 1, plattform: 'twitch', login: 'firedervil', anzeigename: 'FireDervil' };

/**
 * @param {Array} ziele Ziele
 * @returns {void}
 */
function neuAufsetzen(ziele = []) {
    daten.ziele = ziele.map((z, i) => ({ id: i + 1, streamer_id: 1, guild_id: 'g1', aktiv: 1, ...z }));
    daten.auftraege = [];
    naechsteId = 1;
}

(async () => {

console.log('\nDie Naht zwischen Kern und Adapter');
{
    const ohneEreignis = ARTEN.filter(a => !melder.beschreibungFuer(twitch, a));
    pruefe(ohneEreignis.length === 0,
        'jede Melderart hat ein Ereignis beim Adapter', ohneEreignis.join(' ') || 'alle');

    const alleBeschreibungen = [...twitch.EREIGNISSE_ABO, ...twitch.EREIGNISSE_MELDER];
    const ohneArt = alleBeschreibungen.filter(b => b.melder && !melder.ARTEN[b.melder]);
    pruefe(ohneArt.length === 0,
        'jeder Melder des Adapters ist im Kern bekannt', ohneArt.map(b => b.melder).join(' ') || 'alle');

    const raid = melder.beschreibungFuer(twitch, 'raid');
    pruefe(raid && raid.scope === null,
        'Raid braucht keine Zusage — deshalb geht er auch fuer fremde Kanaele');

    for (const art of ['bits', 'follow']) {
        const b = melder.beschreibungFuer(twitch, art);
        pruefe(Boolean(b && b.scope), `${art} verlangt eine Zusage`, b ? String(b.scope) : 'keine Beschreibung');
    }
}

console.log('\nJeder noetige Scope ist auch erteilbar');
{
    // **Der Fall vom 2026-08-26.** Ein Scope, den keine angemeldete Zusage
    // enthaelt, laesst sich ueber die Oberflaeche nie erteilen — und die Art
    // waere fuer immer ein Haekchen ohne Wirkung.
    const quelle = fs.readFileSync(
        path.join(__dirname, '../plugins/streaming/dashboard/index.js'), 'utf8');
    const angeboten = new Set();
    for (const treffer of quelle.matchAll(/scopes:\s*\[([^\]]*)\]/g)) {
        for (const s of treffer[1].matchAll(/'([^']+)'/g)) angeboten.add(s[1]);
    }

    pruefe(angeboten.size > 0, 'die Anmeldung bietet ueberhaupt Zusagen an', `${angeboten.size} Scope(s)`);

    for (const art of ARTEN) {
        const b = melder.beschreibungFuer(twitch, art);
        if (!b || !b.scope) continue;
        pruefe(angeboten.has(b.scope),
            `"${melder.ARTEN[art].label}" ist erteilbar`, b.scope);
    }
}

console.log('\nDie Spalte lesen und schreiben');
{
    pruefe(JSON.stringify(melder.artenLesen('raid,bits')) === JSON.stringify(['raid', 'bits']),
        'zwei Arten werden gelesen');
    pruefe(JSON.stringify(melder.artenLesen('raid, bits ')) === JSON.stringify(['raid', 'bits']),
        'Leerraum stoert nicht');
    pruefe(JSON.stringify(melder.artenLesen('raid,erfunden,bits')) === JSON.stringify(['raid', 'bits']),
        'ein unbekannter Name faellt weg statt durchzugehen');
    pruefe(JSON.stringify(melder.artenLesen('raid,raid')) === JSON.stringify(['raid']),
        'Doppelte fallen weg');
    pruefe(JSON.stringify(melder.artenLesen(null)) === '[]', 'leer ergibt eine leere Liste');
    pruefe(melder.artenSchreiben([]) === null, 'nichts gewaehlt wird zu NULL, nicht zu ""');
    pruefe(melder.artenSchreiben(['bits', 'erfunden']) === 'bits',
        'beim Schreiben faellt Erfundenes ebenfalls weg');
}

console.log('\nZusammenlegen');
{
    const a = { art: 'follow', anzahl: 1, summe: null, posten: [{ person: 'Anna' }] };
    const b = { art: 'follow', anzahl: 1, summe: null, posten: [{ person: 'Ben' }] };
    const z = melder.zusammenlegen(a, b);
    pruefe(z.anzahl === 2, 'die Anzahl addiert sich');
    pruefe(z.posten.length === 2, 'die Namen kommen zusammen');
    pruefe(z.gekuerzt === false, 'nichts gekuerzt, solange es passt');

    const bits1 = { art: 'bits', anzahl: 1, summe: 100, posten: [{ person: 'Anna' }] };
    const bits2 = { art: 'bits', anzahl: 1, summe: 400, posten: [{ person: 'Ben' }] };
    pruefe(melder.zusammenlegen(bits1, bits2).summe === 500, 'Bits summieren sich');

    const v1 = { art: 'verlaengert', anzahl: 1, summe: null, posten: [{ person: 'Anna', menge: 12 }] };
    const v2 = { art: 'verlaengert', anzahl: 1, summe: null, posten: [{ person: 'Ben', menge: 30 }] };
    pruefe(melder.zusammenlegen(v1, v2).summe === null,
        'Monate summieren sich NICHT — "42 Monate" waere erfunden');

    let viele = { art: 'follow', anzahl: 0, summe: null, posten: [] };
    for (let i = 0; i < 40; i++) {
        viele = melder.zusammenlegen(viele, { art: 'follow', anzahl: 1, summe: null, posten: [{ person: `P${i}` }] });
    }
    pruefe(viele.anzahl === 40, 'gezaehlt wird alles', String(viele.anzahl));
    pruefe(viele.posten.length === melder.HOECHSTENS_NAMEN,
        `die Namen hoeren bei ${melder.HOECHSTENS_NAMEN} auf`, String(viele.posten.length));
    pruefe(viele.gekuerzt === true, 'und die Kuerzung wird vermerkt');
}

console.log('\nDie Namensliste sagt die Wahrheit');
{
    pruefe(nachricht.namenListe([{ person: 'Anna' }, { person: 'Ben' }], 2) === 'Anna, Ben',
        'zwei Namen, zwei Ereignisse: keine Ergaenzung');
    pruefe(nachricht.namenListe([{ person: 'Anna' }], 5) === 'Anna und 4 weitere',
        'fehlende Namen werden benannt');
    pruefe(nachricht.namenListe([{ person: null }], 1) === '',
        'anonym heisst keine Namensliste, nicht "null"');
}

console.log('\nMelden schreibt Auftraege');
{
    neuAufsetzen([{ channel_id: 'k-ank', melder_channel_id: null, melder_arten: null }]);
    await melder.melden(STREAMER, { was: 'follow', person: 'Anna' });
    pruefe(daten.auftraege.length === 0, 'ein Ziel ohne angehakte Art bekommt nichts');

    neuAufsetzen([{ channel_id: 'k-ank', melder_channel_id: null, melder_arten: 'raid' }]);
    await melder.melden(STREAMER, { was: 'follow', person: 'Anna' });
    pruefe(daten.auftraege.length === 0, 'eine andere Art loest nichts aus');

    neuAufsetzen([{ channel_id: 'k-ank', melder_channel_id: null, melder_arten: 'follow' }]);
    await melder.melden(STREAMER, { was: 'follow', person: 'Anna' });
    pruefe(daten.auftraege.length === 1, 'die angehakte Art schreibt genau einen Auftrag');
    pruefe(daten.auftraege[0]?.aktion === 'melden', 'und zwar mit der Aktion "melden"');
    pruefe(daten.auftraege[0]?.nutzlast.kanal === 'k-ank',
        'ohne eigenen Kanal geht sie in den Ankuendigungskanal', String(daten.auftraege[0]?.nutzlast.kanal));

    neuAufsetzen([{ channel_id: 'k-ank', melder_channel_id: 'k-melder', melder_arten: 'follow' }]);
    await melder.melden(STREAMER, { was: 'follow', person: 'Anna' });
    pruefe(daten.auftraege[0]?.nutzlast.kanal === 'k-melder',
        'mit eigenem Kanal geht sie dorthin', String(daten.auftraege[0]?.nutzlast.kanal));

    pruefe((await melder.melden(STREAMER, { was: 'erfunden' })).includes('unbekannt'),
        'eine erfundene Art wird gemeldet, nicht stillschweigend verworfen');
}

console.log('\nDas Sammelfenster');
{
    neuAufsetzen([{ channel_id: 'k-ank', melder_channel_id: null, melder_arten: 'follow' }]);
    await melder.melden(STREAMER, { was: 'follow', person: 'Anna' });
    await melder.melden(STREAMER, { was: 'follow', person: 'Ben' });
    await melder.melden(STREAMER, { was: 'follow', person: 'Cem' });

    pruefe(daten.auftraege.length === 1, 'drei Follows im Fenster ergeben EINEN Auftrag',
        `${daten.auftraege.length} Auftrag/Auftraege`);
    pruefe(daten.auftraege[0]?.nutzlast.anzahl === 3, 'und der zaehlt alle drei',
        String(daten.auftraege[0]?.nutzlast.anzahl));

    // Ein Auftrag, dessen Zeit gekommen ist, darf nicht mehr ergaenzt werden —
    // der Ausgang koennte ihn im selben Augenblick greifen.
    daten.auftraege[0].wartet = false;
    await melder.melden(STREAMER, { was: 'follow', person: 'Dana' });
    pruefe(daten.auftraege.length === 2,
        'ein faelliger Auftrag wird nicht mehr ergaenzt, sondern es kommt ein neuer');

    neuAufsetzen([{ channel_id: 'k-ank', melder_channel_id: null, melder_arten: 'raid' }]);
    await melder.melden(STREAMER, { was: 'raid', person: 'A', menge: 10 });
    await melder.melden(STREAMER, { was: 'raid', person: 'B', menge: 20 });
    pruefe(daten.auftraege.length === 2, 'Raids werden NICHT gesammelt — jeder geht sofort raus',
        `${daten.auftraege.length}`);
    pruefe(melder.ARTEN.raid.fensterMs === 0, 'und das steht als Fenster 0 in den Arten');

    neuAufsetzen([
        { channel_id: 'k1', melder_channel_id: null, melder_arten: 'follow' },
        { channel_id: 'k2', melder_channel_id: null, melder_arten: 'follow' }
    ]);
    await melder.melden(STREAMER, { was: 'follow', person: 'Anna' });
    pruefe(daten.auftraege.length === 2, 'zwei Guilds bekommen je einen eigenen Auftrag');
}

console.log('\nWelche Ereignisse bestellt werden');
{
    neuAufsetzen([{ channel_id: 'k', melder_arten: 'raid,bits,follow' }]);

    const ohne = await melder.melderEreignisse(1, twitch, []);
    pruefe(ohne.bestellen.length === 1 && ohne.bestellen[0].typ === 'channel.raid',
        'ohne jede Zusage wird nur der Raid bestellt',
        ohne.bestellen.map(b => b.typ).join(' '));
    pruefe(ohne.fehltZusage.length === 2,
        'die anderen beiden werden als "Zusage fehlt" gemeldet, nicht verschwiegen',
        ohne.fehltZusage.map(f => f.art).join(' '));

    const mit = await melder.melderEreignisse(1, twitch, ['bits:read', 'moderator:read:followers']);
    pruefe(mit.bestellen.length === 3, 'mit beiden Zusagen werden alle drei bestellt',
        mit.bestellen.map(b => b.typ).join(' '));
    pruefe(mit.fehltZusage.length === 0, 'und nichts fehlt mehr');

    neuAufsetzen([{ channel_id: 'k', melder_arten: null }]);
    const nichts = await melder.melderEreignisse(1, twitch, ['bits:read']);
    pruefe(nichts.bestellen.length === 0,
        'wer nichts anhakt, bezahlt kein Kontingent — auch nicht mit Zusage');
}

console.log('\nWie eine Meldung aussieht');
{
    for (const art of ARTEN) {
        const inhalt = nachricht.melder({
            streamer: STREAMER,
            nutzlast: { art, anzahl: 1, summe: 100, posten: [{ person: 'Anna', menge: 5, stufe: '1000' }] }
        });
        pruefe(typeof inhalt.content === 'string' && inhalt.content.length > 10,
            `${melder.ARTEN[art].label}: es kommt ein Satz heraus`);
        pruefe(!inhalt.content.includes('undefined') && !inhalt.content.includes('null'),
            `${melder.ARTEN[art].label}: ohne "undefined" oder "null"`);
        pruefe(!/<@[&!]?\d/.test(inhalt.content),
            `${melder.ARTEN[art].label}: erwaehnt niemanden`);
        pruefe(Array.isArray(inhalt.embeds) && inhalt.embeds.length === 0,
            `${melder.ARTEN[art].label}: kein Embed — eine Zeile, keine Wand aus Kaesten`);
    }

    // Der anonyme Fall einzeln, weil er der ist, der im Betrieb auffaellt.
    const anonym = nachricht.melder({
        streamer: STREAMER,
        nutzlast: { art: 'bits', anzahl: 1, summe: 500, posten: [{ person: null }] }
    });
    pruefe(anonym.content.includes('500 Bits') && !anonym.content.includes('von '),
        'anonyme Bits nennen keinen Namen', anonym.content);
}

console.log(abweichungen === 0
    ? `\nErgebnis: ${faelle} Pruefungen, 0 Abweichungen.\n`
    : `\nErgebnis: ${faelle} Pruefungen, ${abweichungen} Abweichung(en).\n`);

process.exit(abweichungen === 0 ? 0 : 1);

})().catch(err => { console.error('\nAbbruch:', err.message, '\n', err.stack); process.exit(1); });
