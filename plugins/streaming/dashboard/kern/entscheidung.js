'use strict';

/**
 * Streaming - wird gemeldet oder nicht?
 *
 * **Reine Funktionen: keine Datenbank, kein Discord, kein Twitch.** Nur Werte
 * herein, Entscheidung heraus. Das ist Absicht - so laesst sich jeder Fall
 * durchspielen, ohne eine Anlage zu betreiben
 * (`scripts/check-streaming-entscheidung.js`). Das Vorbild ist
 * `cronEntscheidung.js` im Gameserver-Plugin: 40 Faelle, die niemand von Hand
 * durchprobiert.
 *
 * Vier Regeln, jede gegen einen realen Fehler:
 *
 *   1. **Bekannte Sendung** -> nie eine zweite Meldung. Twitch schickt nach
 *      einem kurzen Abriss erneut `stream.online`, mit derselben Kennung.
 *   2. **Abklingzeit** -> kommt eine NEUE Sendungskennung kurz nach der
 *      letzten Meldung, wird nicht noch einmal gemeldet. Faengt den Fall, dass
 *      die Plattform bei einem Abriss eine neue Kennung vergibt.
 *   3. **Karenz beim Ende** -> `beendet` setzt nicht sofort offline. Kommt
 *      innerhalb der Karenz wieder `ging_live`, gilt die Sendung als
 *      durchgehend. Ohne das erzeugt jeder Abriss eine Aufraeum- und danach
 *      eine neue Ankuendigung.
 *   4. **Filter** -> Spiel und Titelstichwort, je Ziel.
 *
 * @module streaming/dashboard/kern/entscheidung
 */

/** @type {Object} Vorgabewerte; die Guild kann sie ueberschreiben. */
const VORGABE = {
    abklingzeitMinuten: 15,
    karenzMinuten: 2
};

/**
 * Millisekunden zwischen zwei Zeitpunkten, robust gegen Unsinn.
 *
 * @param {Date|string|null} zeitpunkt Zeitpunkt
 * @param {number} jetzt Bezugszeit in ms
 * @returns {number|null} Abstand in ms oder null
 */
function abstand(zeitpunkt, jetzt) {
    if (!zeitpunkt) return null;
    const t = new Date(zeitpunkt).getTime();
    return Number.isNaN(t) ? null : jetzt - t;
}

/**
 * Was soll mit einem `ging_live` geschehen?
 *
 * @param {Object} ereignis Hausereignis
 * @param {Object|null} zustand Bisheriger Zustand des Streamers
 * @param {Object} [einstellungen] Abklingzeit, Karenz
 * @param {number} [jetzt] Bezugszeit in ms
 * @returns {{handlung: string, grund: string}} 'melden' | 'aktualisieren' | 'nichts'
 */
function beiGingLive(ereignis, zustand, einstellungen = {}, jetzt = Date.now()) {
    const abkling = (einstellungen.abklingzeitMinuten ?? VORGABE.abklingzeitMinuten) * 60_000;
    const karenz  = (einstellungen.karenzMinuten ?? VORGABE.karenzMinuten) * 60_000;

    // Regel 1: dieselbe Sendung, die schon laeuft
    if (zustand?.ist_live && zustand.sendung_id && ereignis.sendung_id
        && String(zustand.sendung_id) === String(ereignis.sendung_id)) {
        return { handlung: 'nichts', grund: 'dieselbe Sendung laeuft bereits' };
    }

    // Regel 3: Ende liegt innerhalb der Karenz -> es ist dieselbe Sendung
    const seitEnde = abstand(zustand?.beendet_am, jetzt);
    if (!zustand?.ist_live && seitEnde !== null && seitEnde < karenz) {
        return { handlung: 'aktualisieren', grund: 'Abriss innerhalb der Karenz - Sendung gilt als durchgehend' };
    }

    // Regel 2: neue Kennung, aber die letzte Meldung ist noch frisch
    const seitMeldung = abstand(zustand?.zuletzt_gemeldet_am, jetzt);
    if (seitMeldung !== null && seitMeldung < abkling) {
        return { handlung: 'aktualisieren', grund: 'innerhalb der Abklingzeit - keine zweite Ankuendigung' };
    }

    return { handlung: 'melden', grund: 'neue Sendung' };
}

/**
 * Was soll mit einem `beendet` geschehen?
 *
 * @param {Object} ereignis Hausereignis
 * @param {Object|null} zustand Bisheriger Zustand
 * @returns {{handlung: string, grund: string}} 'aufraeumen' | 'nichts'
 */
function beiBeendet(ereignis, zustand) {
    if (!zustand?.ist_live) {
        // Kommt vor: `stream.offline` ohne vorheriges `online`, etwa nach
        // einem Neustart mit verlorenem Zustand. Kein Fehler, nur nichts zu tun.
        return { handlung: 'nichts', grund: 'war nicht als live vermerkt' };
    }
    return { handlung: 'aufraeumen', grund: 'Sendung beendet' };
}

/**
 * Passt dieses Ziel zu dieser Sendung?
 *
 * @param {Object} ziel Zielzeile
 * @param {Object} angaben { titel, kategorie }
 * @returns {{passt: boolean, grund: string, wartetAufAnreicherung: boolean}} Ergebnis
 */
function zielPasst(ziel, angaben = {}) {
    if (!ziel.aktiv) return { passt: false, grund: 'Ziel ist abgeschaltet', wartetAufAnreicherung: false };

    const hatFilter = Boolean(ziel.filter_spiel || ziel.filter_titel);
    if (!hatFilter) return { passt: true, grund: 'kein Filter', wartetAufAnreicherung: false };

    // Kategorie und Titel kommen erst mit der Anreicherung. Ein Ziel mit
    // Filter kann im Augenblick des Ereignisses noch nicht entschieden werden
    // - es wartet, statt zu raten.
    const fehlt = (ziel.filter_spiel && !angaben.kategorie) || (ziel.filter_titel && !angaben.titel);
    if (fehlt) {
        return { passt: false, grund: 'Angaben fehlen noch', wartetAufAnreicherung: true };
    }

    if (ziel.filter_spiel) {
        const erlaubt = String(ziel.filter_spiel).split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
        if (erlaubt.length && !erlaubt.includes(String(angaben.kategorie).toLowerCase())) {
            return { passt: false, grund: `Kategorie "${angaben.kategorie}" steht nicht im Filter`, wartetAufAnreicherung: false };
        }
    }

    if (ziel.filter_titel) {
        const wort = String(ziel.filter_titel).trim().toLowerCase();
        if (wort && !String(angaben.titel).toLowerCase().includes(wort)) {
            return { passt: false, grund: `Titel enthaelt "${ziel.filter_titel}" nicht`, wartetAufAnreicherung: false };
        }
    }

    return { passt: true, grund: 'Filter trifft zu', wartetAufAnreicherung: false };
}

module.exports = { VORGABE, beiGingLive, beiBeendet, zielPasst };
