#!/usr/bin/env node
/**
 * Prueft die Freigabe eigener Tondateien fuer den Stream.
 *
 * # Worum es geht
 *
 * Der Musikwunsch aus dem Twitch-Chat spielt **ausschliesslich** aus der
 * eigenen hochgeladenen Ablage (`docs/musikwunsch/README.md`). Das ist keine
 * Bequemlichkeit, sondern die ganze Absicherung: Der Betreiber laedt hoch, was
 * er spielen darf, und nichts anderes ist erreichbar. Damit verschwindet die
 * Lizenzfrage aus der Software.
 *
 * Diese Absicherung haengt an zwei Aussagen, und beide werden hier geprueft:
 *
 *   1. **Freigeben ist eine Handlung.** Eine Datei kommt nie freigegeben in
 *      die Welt - auch nicht, wenn das Formular den Schalter vergisst oder
 *      jemand die Anfrage selbst zusammensetzt.
 *   2. **Es gibt genau einen Weg zu den freigegebenen Dateien.** Ein zweiter,
 *      der `fuer_stream` nicht liest, waere das Loch, gegen das die ganze
 *      Ablage gebaut ist.
 *
 * Geprueft wird am **echten** Modell; die Datenbank ist eine Attrappe, die die
 * Abfrage liest statt ihre Wirkung nachzubilden.
 *
 *   node scripts/check-musik-stream-freigabe.js
 *
 * Exitcode 1 bei jeder Abweichung.
 */
'use strict';

const path = require('path');
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

const unbekannteAbfragen = [];
const mitschrift = { schreibzugriffe: [], abfragen: [] };

/** Die abgelegten Dateien, im Speicher. */
const dateien = [];
let naechsteId = 1;

ServiceManager.register('Logger', {
    info: () => {}, debug: () => {}, success: () => {}, warn: () => {}, error: () => {}
});

ServiceManager.register('dbService', {
    async query(sql, w = []) {
        const s = String(sql).replace(/\s+/g, ' ').trim();
        mitschrift.abfragen.push(s);

        if (s.startsWith('INSERT INTO music_files')) {
            mitschrift.schreibzugriffe.push({ sql: s, werte: w });

            // **Die Attrappe liest die Spaltenliste**, statt sie zu kennen.
            // Waechst der INSERT um eine Spalte, ohne dass hier etwas
            // angepasst wird, ordnet sie trotzdem richtig zu - und wenn nicht,
            // faellt es hier auf und nicht erst im Betrieb.
            const spalten = s.slice(s.indexOf('(') + 1, s.indexOf(')'))
                .split(',').map(x => x.trim());
            const zeile = { id: naechsteId++ };
            spalten.forEach((spalte, i) => { zeile[spalte] = w[i]; });
            dateien.push(zeile);
            return { insertId: zeile.id };
        }

        if (s.startsWith('UPDATE music_files SET herkunft')) {
            mitschrift.schreibzugriffe.push({ sql: s, werte: w });
            const [herkunft, fuerStream, id, guildId] = w;

            // Die Bedingung wird GELESEN, nicht angenommen: Faellt `guild_id`
            // aus der Abfrage, trifft die Attrappe ab dann auch fremde Zeilen.
            const nachGuild = s.includes('guild_id = ?');
            const treffer = dateien.filter(d => d.id === id
                && (!nachGuild || String(d.guild_id) === String(guildId)));

            treffer.forEach(d => { d.herkunft = herkunft; d.fuer_stream = fuerStream; });
            return { affectedRows: treffer.length };
        }

        if (/^SELECT \* FROM music_files WHERE guild_id = \? AND fuer_stream = 1/.test(s)) {
            const [guildId, muster] = w;
            return dateien.filter(d => String(d.guild_id) === String(guildId)
                && Number(d.fuer_stream) === 1
                && (!muster || String(d.originalname).toLowerCase()
                        .includes(String(muster).replace(/%/g, '').toLowerCase())));
        }

        if (/^(SELECT|INSERT|UPDATE|DELETE)/i.test(s)) unbekannteAbfragen.push(s.slice(0, 90));
        return [];
    }
});

const { MusicFiles } = require('../plugins/music/shared/models');

(async () => {
    // -----------------------------------------------------------------------
    console.log('\nFreigeben ist eine Handlung, kein Nebeneffekt');
    // -----------------------------------------------------------------------
    await MusicFiles.anlegen('g1', { dateiname: 'a.mp3', originalname: 'Ohne Angabe' });
    pruefe(Number(dateien.at(-1).fuer_stream) === 0,
        'ohne Angabe kommt eine Datei NICHT freigegeben in die Welt',
        `fuer_stream = ${dateien.at(-1).fuer_stream}`);

    await MusicFiles.anlegen('g1', { dateiname: 'b.mp3', originalname: 'Mit Freigabe', fuerStream: true });
    pruefe(Number(dateien.at(-1).fuer_stream) === 1, 'mit Angabe schon');

    // Auch ein wahrheitsaehnlicher Wert darf nicht freigeben, wenn er falsch ist.
    await MusicFiles.anlegen('g1', { dateiname: 'c.mp3', originalname: 'Leerer Text', fuerStream: '' });
    pruefe(Number(dateien.at(-1).fuer_stream) === 0,
        'ein leerer Wert gibt nicht frei', `fuer_stream = ${dateien.at(-1).fuer_stream}`);

    // -----------------------------------------------------------------------
    console.log('\nDie Herkunft ist ein Vermerk, keine Pflicht');
    // -----------------------------------------------------------------------
    await MusicFiles.anlegen('g1', { dateiname: 'd.mp3', originalname: 'Von NCS', herkunft: 'NCS' });
    pruefe(dateien.at(-1).herkunft === 'NCS', 'sie wird mitgeschrieben');

    pruefe(dateien.find(d => d.originalname === 'Ohne Angabe').herkunft === null,
        'ohne Angabe steht dort NULL, nicht ein leerer Text',
        'sonst liesse sich „nichts eingetragen" nicht von „bewusst leer" unterscheiden');

    // -----------------------------------------------------------------------
    console.log('\nNachtragen trifft nur die eigene Guild');
    // -----------------------------------------------------------------------
    await MusicFiles.anlegen('g2', { dateiname: 'fremd.mp3', originalname: 'Fremde Guild' });
    const fremd = dateien.at(-1);

    const getroffen = await MusicFiles.merkmaleSetzen(fremd.id, 'g1', { herkunft: 'x', fuerStream: true });
    pruefe(getroffen === false, 'eine Zeile einer anderen Guild wird nicht getroffen');
    pruefe(Number(fremd.fuer_stream) === 0,
        'und bleibt unveraendert — sie liesse sich sonst aus einer fremden Guild freigeben');

    const eigen = dateien.find(d => d.originalname === 'Ohne Angabe');
    pruefe(await MusicFiles.merkmaleSetzen(eigen.id, 'g1', { herkunft: 'StreamBeats', fuerStream: true }) === true,
        'die eigene schon');
    pruefe(eigen.herkunft === 'StreamBeats' && Number(eigen.fuer_stream) === 1,
        'mit beiden Werten', `${eigen.herkunft} / ${eigen.fuer_stream}`);

    // Und wieder zurueck - eine Freigabe muss sich zuruecknehmen lassen.
    await MusicFiles.merkmaleSetzen(eigen.id, 'g1', { herkunft: 'StreamBeats', fuerStream: false });
    pruefe(Number(eigen.fuer_stream) === 0, 'und eine Freigabe laesst sich zuruecknehmen');

    // -----------------------------------------------------------------------
    console.log('\nEs gibt genau einen Weg zu den freigegebenen Dateien');
    // -----------------------------------------------------------------------
    const frei = await MusicFiles.fuerStream('g1');
    pruefe(frei.length === 1 && frei[0].originalname === 'Mit Freigabe',
        'geliefert wird nur, was freigegeben ist',
        frei.map(f => f.originalname).join(', ') || 'nichts');

    pruefe(frei.every(f => String(f.guild_id) === 'g1'),
        'und nur aus der eigenen Guild');

    await MusicFiles.anlegen('g1', { dateiname: 'e.mp3', originalname: 'Sommerlied', fuerStream: true });
    const gesucht = await MusicFiles.fuerStream('g1', 'sommer');
    pruefe(gesucht.length === 1 && gesucht[0].originalname === 'Sommerlied',
        'die Suche findet gross/klein-unabhaengig', gesucht.map(f => f.originalname).join(', '));

    const nichts = await MusicFiles.fuerStream('g1', 'gibtesnicht');
    pruefe(nichts.length === 0, 'und meldet leer statt irgendetwas zurueckzugeben');

    // -----------------------------------------------------------------------
    console.log('\nHat die Attrappe alles gesehen?');
    // -----------------------------------------------------------------------
    pruefe(unbekannteAbfragen.length === 0, 'keine Abfrage lief an der Attrappe vorbei',
        unbekannteAbfragen.slice(0, 3).join(' | '));

    console.log(`\n${faelle} Faelle, ${abweichungen} Abweichung(en)\n`);
    process.exit(abweichungen ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
