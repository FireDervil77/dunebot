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

    // **Die Ruhezeit zuerst.** Sie hat mit dem Inhalt nichts zu tun, und wer
    // nachts keinen Ping will, will ihn auch dann nicht, wenn das Spiel passt.
    // `minutenJetzt` kommt von aussen: Die Umrechnung in die Zeitzone der Guild
    // ist unrein, die Entscheidung darueber soll es nicht sein.
    if (typeof angaben.minutenJetzt === 'number' && inRuhezeit(ziel.ruhe_von, ziel.ruhe_bis, angaben.minutenJetzt)) {
        return { passt: false, grund: 'Ruhezeit', wartetAufAnreicherung: false };
    }

    const hatFilter = Boolean(ziel.filter_spiel || ziel.filter_titel
                           || ziel.filter_spiel_aus || ziel.filter_titel_aus);
    if (!hatFilter) return { passt: true, grund: 'kein Filter', wartetAufAnreicherung: false };

    // Kategorie und Titel kommen erst mit der Anreicherung. Ein Ziel mit
    // Filter kann im Augenblick des Ereignisses noch nicht entschieden werden
    // - es wartet, statt zu raten. Das gilt fuer Ausschluesse genauso: Wer
    // "alles ausser Just Chatting" eingestellt hat und die Kategorie noch nicht
    // kennt, wuerde sonst genau das melden, was er ausschliessen wollte.
    const fehlt = ((ziel.filter_spiel || ziel.filter_spiel_aus) && !angaben.kategorie)
               || ((ziel.filter_titel || ziel.filter_titel_aus) && !angaben.titel);
    if (fehlt) {
        return { passt: false, grund: 'Angaben fehlen noch', wartetAufAnreicherung: true };
    }

    // **Ausschluss zuerst - aber nicht, weil er sonst verloere.** Beide
    // Pruefungen muessen bestehen; ein doppelt eingetragenes Spiel faellt so
    // oder so durch. Die Reihenfolge entscheidet nur, welche BEGRUENDUNG im
    // Log und auf der Seite steht, und "ist ausgeschlossen" hilft dort mehr als
    // "steht nicht im Filter".
    //
    // (Das stand hier zuerst falsch herum begruendet. Aufgefallen ist es, weil
    // die Gegenprobe zum Vertauschen der Reihenfolge NICHT ansprang - ein
    // Pruefskript, das gruen bleibt, wenn man den Code umbaut, prueft an dieser
    // Stelle nichts.)
    if (ziel.filter_spiel_aus) {
        const verboten = String(ziel.filter_spiel_aus).split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
        if (verboten.includes(String(angaben.kategorie).toLowerCase())) {
            return { passt: false, grund: `Kategorie "${angaben.kategorie}" ist ausgeschlossen`, wartetAufAnreicherung: false };
        }
    }

    if (ziel.filter_titel_aus) {
        const wort = String(ziel.filter_titel_aus).trim().toLowerCase();
        if (wort && String(angaben.titel).toLowerCase().includes(wort)) {
            return { passt: false, grund: `Titel enthaelt das ausgeschlossene Wort "${ziel.filter_titel_aus}"`, wartetAufAnreicherung: false };
        }
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

/**
 * Ist eine Sendung so frisch, dass die Selbstheilung sie in Ruhe lassen muss?
 *
 * Twitch meldet `stream.online` frueher, als der Stream in der Streamliste
 * auftaucht. Fragt der Anreicherungslauf 30 Sekunden nach dem Start nach,
 * findet er nichts - und wuerde eine gerade begonnene Sendung fuer beendet
 * erklaeren. Genau die, die man ankuendigen wollte.
 *
 * Ohne Startzeitpunkt gibt es keine Schonfrist: Dann wissen wir nicht, wie alt
 * die Sendung ist, und die Selbstheilung ist das kleinere Uebel gegenueber
 * einem Zustand, der ewig auf "live" steht.
 *
 * @param {Date|string|null} begonnenAm Beginn der Sendung
 * @param {number} jetzt Zeitpunkt in Millisekunden
 * @param {number} schonfristMs Dauer der Schonfrist
 * @returns {boolean} true, wenn noch nicht angefasst werden darf
 */
/**
 * Liegt ein Zeitpunkt in der Ruhezeit?
 *
 * Alles in Minuten seit Mitternacht, damit hier weder Datum noch Zeitzone
 * vorkommen - die Umrechnung passiert draussen.
 *
 * **Der Fall, den man vergisst:** `von > bis` ist der Normalfall, nicht die
 * Ausnahme. 23:00 bis 08:00 laeuft ueber Mitternacht, und ein schlichtes
 * `jetzt >= von && jetzt < bis` waere dort immer falsch.
 *
 * Sind beide gleich, ist die Ruhezeit leer (nicht ganztaegig): Ein
 * Eingabefehler soll Ankuendigungen nicht fuer immer abschalten.
 *
 * @param {string|null} von Beginn als "HH:MM" oder "HH:MM:SS"
 * @param {string|null} bis Ende
 * @param {number} minutenJetzt Minuten seit Mitternacht
 * @returns {boolean} true, wenn geschwiegen wird
 */
function inRuhezeit(von, bis, minutenJetzt) {
    const alsMinuten = (wert) => {
        if (!wert) return null;
        const teile = String(wert).split(':');
        const h = Number(teile[0]), m = Number(teile[1] || 0);
        if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
        if (h < 0 || h > 23 || m < 0 || m > 59) return null;
        return h * 60 + m;
    };

    const a = alsMinuten(von);
    const b = alsMinuten(bis);
    if (a === null || b === null) return false;
    if (a === b) return false;

    return a < b
        ? (minutenJetzt >= a && minutenJetzt < b)      // 09:00 - 17:00
        : (minutenJetzt >= a || minutenJetzt < b);     // 23:00 - 08:00, ueber Mitternacht
}

/**
 * Minuten seit Mitternacht in einer Zeitzone.
 *
 * Der unreine Teil, bewusst klein und getrennt von der Entscheidung.
 *
 * @param {string} zone Zeitzone, z.B. 'Europe/Berlin'
 * @param {Date} [zeitpunkt] Zeitpunkt
 * @returns {number} Minuten seit Mitternacht
 */
function minutenIn(zone, zeitpunkt = new Date()) {
    try {
        const teile = new Intl.DateTimeFormat('de-DE', {
            timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: false
        }).formatToParts(zeitpunkt);
        const h = Number(teile.find(t => t.type === 'hour')?.value ?? 0);
        const m = Number(teile.find(t => t.type === 'minute')?.value ?? 0);
        return h * 60 + m;
    } catch {
        // Unbekannte Zeitzone: lieber die Serverzeit als gar keine Entscheidung.
        const d = zeitpunkt;
        return d.getHours() * 60 + d.getMinutes();
    }
}

/**
 * Fingerabdruck dessen, was eine Ankuendigung zeigt.
 *
 * Damit laesst sich beantworten: Hat sich seit der letzten Bearbeitung wirklich
 * etwas geaendert - oder wuerde man dieselbe Nachricht noch einmal schreiben?
 *
 * **Die Zuschauerzahl gehoert dazu**, und das ist eine Korrektur vom
 * 2026-08-25. Ich hatte sie zuerst herausgenommen, um eine Bearbeitungsschleife
 * zu schliessen. Der Einwand des Betreibers trifft aber:
 *
 * > „wenn der Streamer live ist, dann ist es auch mit den Zuschauerzahlen eine
 * > richtige Kennung. nur eben wenn er nicht mehr live ist, muss man sowas auch
 * > nicht abfragen."
 *
 * Genau so ist es. Eine laufende Ankuendigung mit aktueller Zuschauerzahl ist
 * der Sinn der Sache, keine Verschwendung. Verschwendung war der Fall, in dem
 * sich **gar nichts** unterscheidet - und den faengt dieser Vergleich weiter
 * ab, gerade weil er alle Felder umfasst.
 *
 * Wer nicht mehr sendet, wird ohnehin nicht abgefragt: Der Anreicherungslauf
 * filtert auf `ist_live = 1`.
 *
 * @param {Object} zustand Zustand mit titel, kategorie, vorschaubild, zuschauer
 * @returns {string} Vergleichswert
 */
function inhaltsStand(zustand = {}) {
    const teile = [zustand.titel, zustand.kategorie, zustand.vorschaubild, zustand.zuschauer]
        .map(w => (w === null || w === undefined) ? '' : String(w));
    return require('crypto').createHash('sha256').update(teile.join('\u0000')).digest('hex').slice(0, 32);
}

function inSchonfrist(begonnenAm, jetzt, schonfristMs) {
    if (!begonnenAm) return false;
    const start = new Date(begonnenAm).getTime();
    if (Number.isNaN(start)) return false;
    // Ein Beginn in der Zukunft ist eine kaputte Angabe, kein Schutzgrund.
    if (start > jetzt) return false;
    return (jetzt - start) < schonfristMs;
}

module.exports = {
    inSchonfrist,
    inhaltsStand,
    inRuhezeit,
    minutenIn, VORGABE, beiGingLive, beiBeendet, zielPasst };
