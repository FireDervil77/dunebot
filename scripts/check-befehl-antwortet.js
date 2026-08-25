#!/usr/bin/env node
/**
 * Prueft, dass jeder Befehl seine Antwort auch absendet.
 *
 * **Die Falle:** `apps/bot/handler.js` ruft `await cmd.messageRun(context)`
 * (Zeile 77) und `await cmd.interactionRun(context)` (Zeile 156) — und wirft
 * die Rueckgabe weg. Wer dort ein Antwortobjekt zurueckgibt statt zu senden,
 * bekommt genau nichts:
 *
 *   - Slash-Befehl: Der Handler hat vorher `deferReply()` gerufen, also bleibt
 *     "Bot denkt nach ..." stehen, bis Discord aufgibt.
 *   - Praefix-Befehl: gar keine Reaktion.
 *
 * In beiden Faellen steht **nichts im Log**, weil auch nichts schiefgeht. Das
 * macht es zu einem der unangenehmsten Fehler dieses Geruests: Er sieht aus wie
 * "der Bot ist kaputt" und ist eine vergessene Zeile.
 *
 * Gefunden am 2026-08-25 im Streaming-Plugin, nachdem der Betreiber meldete,
 * die Befehle funktionierten nicht.
 *
 *   node scripts/check-befehl-antwortet.js
 *
 * Exitcode 1 bei jedem Befund.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const WURZEL = path.join(__dirname, '..');
const ORTE = [path.join(WURZEL, 'apps/bot/commands'), path.join(WURZEL, 'plugins')];

/** Womit ein Befehl antworten darf. */
const SENDET = /\.(reply|followUp|editReply|send|replyT|followUpT|update|showModal|deferUpdate)\s*\(/;

let geprueft = 0;
let befunde = 0;

/**
 * Alle Befehlsdateien.
 *
 * @param {string} ordner Startordner
 * @returns {Array<string>} Pfade
 */
function befehlsDateien(ordner) {
    if (!fs.existsSync(ordner)) return [];
    return fs.readdirSync(ordner, { withFileTypes: true }).flatMap(e => {
        const voll = path.join(ordner, e.name);
        if (e.isDirectory()) return befehlsDateien(voll);
        if (!e.name.endsWith('.js') || e.name.startsWith('_')) return [];
        return voll.includes(`${path.sep}commands${path.sep}`) ? [voll] : [];
    });
}

/**
 * Den Rumpf einer Funktion ab ihrer Kopfzeile herausschneiden.
 *
 * Ueber die Klammerbilanz statt per Regex: Ein `messageRun` mit verschachtelten
 * Bloecken waere sonst nach der ersten schliessenden Klammer zu Ende.
 *
 * @param {string} inhalt Dateiinhalt
 * @param {number} ab Index des Funktionskopfs
 * @returns {string} Rumpf
 */
function rumpf(inhalt, ab) {
    const start = inhalt.indexOf('{', ab);
    if (start === -1) return '';
    let tiefe = 0;
    for (let i = start; i < inhalt.length; i++) {
        if (inhalt[i] === '{') tiefe++;
        else if (inhalt[i] === '}') {
            tiefe--;
            if (tiefe === 0) return inhalt.slice(start, i + 1);
        }
    }
    return inhalt.slice(start);
}

console.log('\nBefehle, die ihre Antwort auch absenden\n');

/**
 * Kommentare entfernen, bevor gesucht wird.
 *
 * Der erste Anlauf dieses Skripts meldete 93 von 96 Einstiegspunkten - weil
 * `messageRun(` auch im JSDoc darueber steht und die Klammersuche dann im
 * Kommentar begann. Ein Waechter, der fast alles meldet, wird nicht gelesen.
 *
 * @param {string} quelltext Datei
 * @returns {string} ohne Kommentare
 */
function ohneKommentare(quelltext) {
    return quelltext
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

for (const ort of ORTE) {
    for (const datei of befehlsDateien(ort)) {
        const inhalt = ohneKommentare(fs.readFileSync(datei, 'utf8'));
        const kurz = path.relative(WURZEL, datei);

        for (const name of ['messageRun', 'interactionRun']) {
            const treffer = inhalt.indexOf(`${name}(`);
            if (treffer === -1) continue;

            geprueft++;
            const koerper = rumpf(inhalt, treffer);

            if (SENDET.test(koerper)) continue;

            // Viele Befehle delegieren an eine Hilfsfunktion in derselben
            // Datei, die dann sendet. Das ist in Ordnung - gemeldet wird nur,
            // wo in der GANZEN Datei nichts gesendet wird.
            if (SENDET.test(inhalt)) continue;

            befunde++;
            console.log(`  ✗ ${kurz}`);
            console.log(`      ${name}() sendet nichts — die Rueckgabe wirft der Handler weg`);
        }
    }
}

console.log(befunde === 0
    ? `\n${geprueft} Einstiegspunkte geprueft, 0 Befunde.\n`
    : `\n${geprueft} Einstiegspunkte geprueft, ${befunde} Befund(e).\n`);
process.exit(befunde === 0 ? 0 : 1);
