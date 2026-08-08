'use strict';

/**
 * Musik - abgelaufene Tondateien wegraeumen
 *
 * Der dritte Riegel gegen ein volllaufendes Dateisystem. Die beiden anderen
 * (eigenes Recht, Obergrenze je Guild) verhindern, dass es schnell voll wird -
 * dieser hier verhindert, dass es **langsam** voll wird. Das ist der Fall, den
 * man sonst erst bemerkt, wenn die Platte meldet.
 *
 * Gezaehlt wird ab dem letzten Abspielen, nicht ab dem Hochladen. Sonst
 * verschwaende genau die Datei, die jede Woche laeuft.
 *
 * @module music/bot/aufraeumer
 */

const fs = require('fs/promises');
const { ServiceManager } = require('dunebot-core');
const { MusicFiles } = require('../shared/models');
const { pfadFuer } = require('../shared/dateien');

/** Wie oft nachgesehen wird. Einmal am Tag reicht voellig. */
const TAKT_MS = 24 * 60 * 60 * 1000;

/** Wie lange nach dem Start das erste Mal gewartet wird. */
const ERSTER_LAUF_MS = 5 * 60 * 1000;

let uhr = null;

/**
 * Einmal aufraeumen.
 *
 * @returns {Promise<number>} Wie viele Dateien entfernt wurden
 */
async function einmalAufraeumen() {
    const Logger = ServiceManager.get('Logger');

    let entfernt = 0;

    try {
        const abgelaufen = await MusicFiles.abgelaufene();

        for (const datei of abgelaufen) {
            const pfad = pfadFuer(datei.guild_id, datei.dateiname);

            // Erst der Eintrag, dann die Datei - dieselbe Reihenfolge wie beim
            // Loeschen von Hand: Eine Datei ohne Eintrag kostet nur Platz, ein
            // Eintrag ohne Datei sieht abspielbar aus und scheitert im Kanal.
            await MusicFiles.entfernen(datei.id, datei.guild_id);

            if (pfad) {
                try {
                    await fs.unlink(pfad);
                } catch (fehler) {
                    // Schon weg ist auch in Ordnung
                    if (fehler.code !== 'ENOENT') {
                        Logger.warn(`[Musik] Datei nicht loeschbar (${pfad}): ${fehler.message}`);
                    }
                }
            }

            entfernt++;
        }

        if (entfernt > 0) {
            Logger.info(`[Musik] Aufbewahrung abgelaufen: ${entfernt} Datei(en) entfernt`);
        }
    } catch (fehler) {
        // Ein Fehlschlag darf den naechsten Lauf nicht verhindern
        Logger.warn(`[Musik] Aufraeumen fehlgeschlagen: ${fehler.message}`);
    }

    return entfernt;
}

/**
 * Den Aufraeumer starten.
 *
 * Gegen Doppelstart geschuetzt und `unref`t - er soll den Vorgang nicht am
 * Beenden hindern. Der erste Lauf kommt bewusst nicht sofort: Beim Hochfahren
 * gibt es Wichtigeres zu tun, und ein Tag mehr schadet keiner Datei.
 *
 * @returns {void}
 */
function starten() {
    if (uhr) return;

    setTimeout(() => { einmalAufraeumen(); }, ERSTER_LAUF_MS).unref?.();

    uhr = setInterval(() => { einmalAufraeumen(); }, TAKT_MS);
    uhr.unref?.();
}

/**
 * Den Aufraeumer stoppen.
 *
 * @returns {void}
 */
function stoppen() {
    if (!uhr) return;
    clearInterval(uhr);
    uhr = null;
}

module.exports = { starten, stoppen, einmalAufraeumen };
