'use strict';

/**
 * Streaming - was gemeldet werden muss, und wann.
 *
 * **Reine Entscheidung, kein Versand.** Der Versand steht in
 * `ausgabe/meldung.js`; hier wird nur beurteilt.
 *
 * Zwei Lagen, und die zweite ist die wichtigere:
 *
 *   1. Ein Abo ist widerrufen oder fehlerhaft. Sichtbar, aber nur fuer den,
 *      der die Zustandsseite oeffnet.
 *   2. **Seit Stunden kam nichts an, obwohl Abos stehen.** Das ist der
 *      Zustand, in dem alles gruen aussieht und trotzdem nichts passiert -
 *      und er meldet sich von selbst nie.
 *
 * @module streaming/dashboard/kern/stoerung
 */

/** Ab wann Stille verdaechtig ist. */
const STILLE_STUNDEN = 24;

/**
 * Ist die Stille verdaechtig?
 *
 * Drei Faelle, die keine Meldung ausloesen duerfen:
 *
 *   - **Es gibt keine bestaetigten Abos.** Dann ist Stille richtig, nicht
 *     verdaechtig. Wer nichts abonniert hat, bekommt nichts.
 *   - **Noch nie etwas gehoert.** Das ist eine frische Einrichtung, kein
 *     Ausfall - und eine Meldung "seit 24 h nichts gehoert" waere hier
 *     schlicht falsch.
 *   - **Die Frist ist noch nicht um.** Selbstverstaendlich, steht hier aber
 *     ausdruecklich, weil der Vergleich sonst leicht andersherum gerät.
 *
 * @param {Object} lage Lage
 * @param {number} lage.bestaetigteAbos Anzahl bestaetigter Abos
 * @param {Date|string|null} lage.letzteMeldungAm wann zuletzt etwas ankam
 * @param {number} jetzt Zeitpunkt in Millisekunden
 * @param {number} [stunden=24] Frist
 * @returns {{melden: boolean, grund: string, stundenStill: number|null}} Urteil
 */
function stilleVerdaechtig(lage, jetzt, stunden = STILLE_STUNDEN) {
    const abos = Number(lage?.bestaetigteAbos || 0);
    if (abos === 0) {
        return { melden: false, grund: 'keine bestaetigten Abos - Stille ist richtig', stundenStill: null };
    }

    if (!lage.letzteMeldungAm) {
        return { melden: false, grund: 'noch nie etwas gehoert - frische Einrichtung, kein Ausfall', stundenStill: null };
    }

    const dann = new Date(lage.letzteMeldungAm).getTime();
    if (Number.isNaN(dann)) {
        return { melden: false, grund: 'unlesbarer Zeitpunkt', stundenStill: null };
    }

    const still = (jetzt - dann) / 3_600_000;
    if (still < stunden) {
        return { melden: false, grund: `erst ${still.toFixed(1)} h still`, stundenStill: still };
    }

    return { melden: true, grund: `seit ${Math.floor(still)} h keine Zustellung`, stundenStill: still };
}

/**
 * Welche Abo-Stoerungen sind noch nicht gemeldet?
 *
 * Reine Auswahl auf einer Liste, damit sich die Regel ohne Datenbank
 * durchspielen laesst.
 *
 * @param {Array} abos Abo-Zeilen mit zustand und gemeldet_am
 * @returns {Array} die zu meldenden
 */
function offeneStoerungen(abos) {
    return (abos || []).filter(a =>
        (a.zustand === 'widerrufen' || a.zustand === 'fehler') && !a.gemeldet_am);
}

module.exports = { STILLE_STUNDEN, stilleVerdaechtig, offeneStoerungen };
