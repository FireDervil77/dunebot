'use strict';

/**
 * Musik am Streamende beenden - die Entscheidungen, ohne Datenbank (Baustelle 128).
 *
 * Betreiber am 2026-09-15: *„Gleiches Schema wie beim Gameserver. Ist der Stream
 * des betroffenen Betreibers zu Ende … dann kannst du auch hier die Musik
 * beenden."* Und: *„den Nachlauf wieder unter Einstellungen packen, damit wir
 * das festlegen koennen."*
 *
 * Also wie der Zusatz „Streamserver" (`serverstoppEntscheidung.js`): beim
 * Streamende vormerken, nach dem Nachlauf neu entscheiden, bei neuem Live
 * abbrechen. **Welcher Stream zaehlt, entscheidet die Heim-Guild** - dieselbe
 * Bindung wie bei `!music` im Chat (`befehle.js`): Die Musik gehoert der Guild,
 * und der Kanal, dessen Heim sie ist, steuert sie.
 *
 * **Abgeschaltet wird nur, was beim Streamende lief.** Laeuft da keine Musik,
 * wird nichts vorgemerkt - der Gedanke aus dem Nachtrag zum Streamserver.
 *
 * @module streaming/kern/musikendeEntscheidung
 */

/** Mehr als die Karenz (Vorgabe 2 Minuten): Ein kurzer Abriss soll die Musik nicht beenden. */
const NACHLAUF_MIN = 3;
const NACHLAUF_MAX = 240;
const NACHLAUF_VORGABE = 5;

/**
 * Die gespeicherte Einstellung lesbar machen.
 *
 * **Leer heisst an.** Der Betreiber hat das Verhalten entschieden; wer es nicht
 * will, schaltet es auf der Musikseite ab.
 *
 * @param {*} an Wert von `MUSIK_STREAMENDE`
 * @param {*} nachlauf Wert von `MUSIK_NACHLAUF_MIN`
 * @returns {{an: boolean, nachlaufMin: number}}
 */
function einstellungLesen(an, nachlauf) {
    const text = an === null || an === undefined ? '' : String(an).trim().toLowerCase();
    const zahl = Number(nachlauf);
    const gueltig = nachlauf !== null && nachlauf !== undefined && String(nachlauf).trim() !== ''
        && Number.isInteger(zahl) && zahl >= NACHLAUF_MIN && zahl <= NACHLAUF_MAX;
    return {
        an: !['0', 'false', 'aus', 'nein'].includes(text),
        nachlaufMin: gueltig ? zahl : NACHLAUF_VORGABE
    };
}

/**
 * Soll nach einem Streamende das Beenden vorgemerkt werden?
 *
 * @param {Object} lage
 * @param {string|null} lage.heimGuild Heim-Guild des Kanals, dessen Stream endete
 * @param {Object|null} lage.einstellung { an } der Heim-Guild
 * @param {number} lage.liveInHeim Kanaele mit dieser Heim-Guild, die noch live sind
 * @param {boolean} lage.musikAktiv Laeuft dort gerade Musik?
 * @returns {{vormerken: boolean, grund: string}}
 */
function beimStreamende({ heimGuild, einstellung, liveInHeim, musikAktiv } = {}) {
    if (!heimGuild) return { vormerken: false, grund: 'ohne_heim' };
    if (!einstellung || !einstellung.an) return { vormerken: false, grund: 'aus' };
    if (Number(liveInHeim) > 0) return { vormerken: false, grund: 'noch_live' };
    if (!musikAktiv) return { vormerken: false, grund: 'musik_aus' };
    return { vormerken: true, grund: 'letzter_offline' };
}

/**
 * Beim Faelligwerden: beenden oder abbrechen?
 *
 * @param {Object} lage
 * @param {Object|null} lage.einstellung { an }
 * @param {number} lage.liveInHeim Kanaele mit dieser Heim-Guild, die live sind
 * @param {boolean} lage.musikAktiv Laeuft noch Musik?
 * @returns {{handlung: 'beenden'|'abbrechen', grund: string}}
 */
function beimFaelligwerden({ einstellung, liveInHeim, musikAktiv } = {}) {
    if (!einstellung || !einstellung.an) return { handlung: 'abbrechen', grund: 'aus' };
    if (Number(liveInHeim) > 0) return { handlung: 'abbrechen', grund: 'wieder_live' };
    if (!musikAktiv) return { handlung: 'abbrechen', grund: 'musik_aus' };
    return { handlung: 'beenden', grund: 'niemand_live' };
}

/**
 * Formular pruefen. Ein ungueltiger Nachlauf wird abgelehnt, nicht still auf
 * die Vorgabe gesetzt - sonst gilt eine andere Zahl als die, die dasteht.
 *
 * @param {Object} roh req.body
 * @returns {{ok: boolean, fehler?: string, werte?: {an: boolean, nachlaufMin: number}}}
 */
function eingabePruefen(roh = {}) {
    const an = ['1', 'on', 'true', true, 1].includes(roh.an);
    const nachlaufMin = Number(roh.nachlauf_min);
    if (!Number.isInteger(nachlaufMin) || nachlaufMin < NACHLAUF_MIN || nachlaufMin > NACHLAUF_MAX) {
        return { ok: false, fehler: 'nachlauf' };
    }
    return { ok: true, werte: { an, nachlaufMin } };
}

/** Klartext je Grund - fuer Protokoll und Seite. */
const GRUENDE = {
    ohne_heim: 'der Kanal hat keine Heim-Guild',
    aus: 'Beenden nach dem Stream ist ausgeschaltet',
    noch_live: 'ein anderer Kanal dieser Guild ist noch live',
    musik_aus: 'es läuft keine Musik',
    wieder_live: 'es ist wieder jemand live',
    niemand_live: 'niemand ist mehr live'
};

/**
 * @param {string} grund Kennung
 * @returns {string} Klartext
 */
function grundKlartext(grund) {
    return GRUENDE[grund] || String(grund || 'unbekannter Grund');
}

module.exports = {
    NACHLAUF_MIN, NACHLAUF_MAX, NACHLAUF_VORGABE,
    einstellungLesen, beimStreamende, beimFaelligwerden, eingabePruefen, grundKlartext
};
