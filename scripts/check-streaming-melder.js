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
const daten = { ziele: [], auftraege: [], vorgaben: {} };
const unbekannteAbfragen = [];
let naechsteId = 1;

ServiceManager.register('Logger', { info: () => {}, debug: () => {}, warn: () => {}, error: () => {}, success: () => {} });
ServiceManager.register('dbService', {
    async query(sql, w = []) {
        const s = String(sql).replace(/\s+/g, ' ').trim();

        if (s.startsWith('SELECT guild_id, melder_arten FROM streaming_targets')) {
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

        // **Unbekannte Abfragen werden gemeldet, nicht mit `[]` beantwortet.**
        //
        // Am 2026-09-04 genau daran gescheitert: `gewuenschteArten` fragt seit
        // dem Rueckfall auf die Guild-Vorgabe `SELECT guild_id, melder_arten`
        // statt `SELECT melder_arten`. Die Attrappe kannte den neuen Anfang
        // nicht, lieferte `[]` — und drei Pruefungen fielen mit einer Meldung,
        // die auf den falschen Ort zeigte. Ein lautes `unbekannt` haette in
        // einer Zeile gesagt, was los ist.
        unbekannteAbfragen.push(s.slice(0, 70));
        return [];
    },

    // Guild-weite Einstellungen. `melderVorgabe` liest hierueber die
    // Ereignis-Vorgabe der Guild — der Rueckfall, wenn ein Ziel nichts Eigenes
    // gesetzt hat.
    async getConfig(plugin, schluessel, bereich, guildId) {
        return daten.vorgaben[`${guildId}|${schluessel}`] ?? null;
    },
    async setConfig(plugin, schluessel, wert, bereich, guildId) {
        daten.vorgaben[`${guildId}|${schluessel}`] = wert;
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
function neuAufsetzen(ziele = [], vorgaben = {}) {
    daten.ziele = ziele.map((z, i) => ({ id: i + 1, streamer_id: 1, guild_id: 'g1', aktiv: 1, ...z }));
    daten.auftraege = [];
    daten.vorgaben = vorgaben;
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

console.log('\nDie Guild-Vorgabe traegt, wo das Ziel nichts sagt');
{
    // **`melder_arten = NULL` heisst seit dem 2026-09-04 "was die Guild sagt".**
    // Vorher hiess es "nichts". Der Wechsel ist folgenlos, solange die Vorgabe
    // leer ist — und genau das wird hier zuerst geprueft, weil davon abhaengt,
    // ob der Rollout still bleibt.
    neuAufsetzen([{ channel_id: 'k', melder_arten: null }], {});
    pruefe((await melder.gewuenschteArten(1)).length === 0,
        'ohne Vorgabe bleibt NULL wirkungslos — kein Kanal faengt von selbst an zu melden');

    neuAufsetzen([{ channel_id: 'k', melder_arten: null }], { 'g1|MELDER_ARTEN': 'raid,follow' });
    const geerbt = await melder.gewuenschteArten(1);
    pruefe(geerbt.includes('raid') && geerbt.includes('follow'),
        'mit Vorgabe erbt ein Ziel ohne eigene Auswahl', geerbt.join(','));

    neuAufsetzen([{ channel_id: 'k', melder_arten: 'bits' }], { 'g1|MELDER_ARTEN': 'raid' });
    const eigen = await melder.gewuenschteArten(1);
    pruefe(eigen.join(',') === 'bits',
        'wer etwas Eigenes gesetzt hat, erbt NICHT dazu', eigen.join(','));

    // Derselbe Kanal, zwei Guilds, zwei Vorgaben — jede Zeile erbt ihre eigene.
    daten.ziele = [
        { id: 1, streamer_id: 1, guild_id: 'g1', aktiv: 1, melder_arten: null },
        { id: 2, streamer_id: 1, guild_id: 'g2', aktiv: 1, melder_arten: null }
    ];
    daten.vorgaben = { 'g1|MELDER_ARTEN': 'raid', 'g2|MELDER_ARTEN': 'bits' };
    const beide = (await melder.gewuenschteArten(1)).sort();
    pruefe(beide.join(',') === 'bits,raid',
        'zwei Guilds am selben Kanal erben getrennt', beide.join(','));
}

console.log('\nDer Rueckfall gilt auch beim Zustellen, nicht nur beim Bestellen');
{
    // **Die unangenehmste Sorte Fehler, knapp verfehlt.** Der Rueckfall stand
    // zuerst nur in `gewuenschteArten` — der Funktion, die entscheidet, was bei
    // Twitch BESTELLT wird. `zieleFuer`, die entscheidet, wer die Meldung
    // BEKOMMT, las weiter nur die Spalte. Das Abo haette gestanden, das
    // Ereignis waere angekommen, und niemand haette etwas bekommen: kein
    // Absturz, keine Protokollzeile.
    neuAufsetzen([{ channel_id: 'k', melder_arten: null }], { 'g1|MELDER_ARTEN': 'raid' });
    pruefe((await melder.zieleFuer(1, 'raid')).length === 1,
        'ein Ziel ohne eigene Auswahl bekommt die geerbte Art zugestellt');
    pruefe((await melder.zieleFuer(1, 'bits')).length === 0,
        'und nur die geerbte — nicht alles');
}

console.log('\nDie Bits-Schwelle haelt Kleinbetraege zurueck');
{
    neuAufsetzen([{ channel_id: 'k', melder_arten: 'bits' }], { 'g1|BITS_AB': '100' });
    await melder.melden({ id: 1 }, { was: 'bits', person: 'Anna', menge: 50 });
    pruefe(daten.auftraege.length === 0, '50 Bits bei Schwelle 100: kein Auftrag');

    await melder.melden({ id: 1 }, { was: 'bits', person: 'Ben', menge: 100 });
    pruefe(daten.auftraege.length === 1, 'genau 100 zaehlt noch dazu — "ab" heisst einschliesslich');

    // Ohne Schwelle bleibt alles wie vorher. Wer nichts einstellt, verliert
    // nichts — dieselbe Regel wie bei der Arten-Vorgabe.
    neuAufsetzen([{ channel_id: 'k', melder_arten: 'bits' }], {});
    await melder.melden({ id: 1 }, { was: 'bits', person: 'Anna', menge: 1 });
    pruefe(daten.auftraege.length === 1, 'ohne Schwelle wird jede Menge gemeldet');

    // Und die Schwelle gilt je Guild, nicht anlagenweit.
    daten.ziele = [
        { id: 1, streamer_id: 1, guild_id: 'g1', aktiv: 1, channel_id: 'k1', melder_arten: 'bits' },
        { id: 2, streamer_id: 1, guild_id: 'g2', aktiv: 1, channel_id: 'k2', melder_arten: 'bits' }
    ];
    daten.auftraege = [];
    daten.vorgaben = { 'g1|BITS_AB': '500' };
    await melder.melden({ id: 1 }, { was: 'bits', person: 'Anna', menge: 100 });
    pruefe(daten.auftraege.length === 1 && daten.auftraege[0].guild_id === 'g2',
        'zwei Guilds, eine Schwelle: nur die ohne bekommt die Meldung',
        daten.auftraege.map(a => a.guild_id).join(','));
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

console.log('\nDie Attrappe hat alles verstanden, was gefragt wurde');
pruefe(unbekannteAbfragen.length === 0,
    'keine unbekannte Abfrage still mit `[]` beantwortet',
    unbekannteAbfragen.length ? [...new Set(unbekannteAbfragen)].join(' | ') : '');

console.log(abweichungen === 0
    ? `\nErgebnis: ${faelle} Pruefungen, 0 Abweichungen.\n`
    : `\nErgebnis: ${faelle} Pruefungen, ${abweichungen} Abweichung(en).\n`);

process.exit(abweichungen === 0 ? 0 : 1);

})().catch(err => { console.error('\nAbbruch:', err.message, '\n', err.stack); process.exit(1); });
