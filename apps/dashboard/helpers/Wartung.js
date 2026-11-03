'use strict';

const fs = require('fs');
const path = require('path');
const { ServiceManager } = require('dunebot-core');

/**
 * Die Wartungsseite (2026-11-03).
 *
 * Der Apache liefert sie selbst aus, damit sie auch steht, wenn das Dashboard für
 * längere Arbeiten aus ist. Das Dashboard schaltet sie nur: Es füllt die Vorlage und
 * legt `aktiv/wartung.html` ab. Liegt die Datei dort, antwortet der Apache allen außer
 * `/admin` mit 503 und dieser Seite (`wartung/apache.conf`). Ausschalten heißt, die
 * Datei zu löschen. Eine zweite Merkerstelle gibt es nicht, auch nicht in der Datenbank:
 * Der Apache kann nur die Datei sehen.
 *
 * `aktiv/stand.json` hält die Texte über das Ausschalten hinaus, damit sie beim
 * nächsten Mal wieder dastehen.
 */

const ORDNER = path.join(__dirname, '..', 'wartung');
const VORLAGE = path.join(ORDNER, 'wartung.vorlage.html');

const MAX_TEXT = 1000;

const VORGABE = {
    text_de: 'Wir arbeiten gerade an FireBot und sind bald wieder für dich da.',
    text_en: "We're working on FireBot right now and will be back for you soon.",
};

function escape(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * „Voraussichtlich bis" aus dem Feld `datetime-local` (`2026-11-03T14:00`). Die Zeit
 * steht so da, wie sie eingegeben wurde: Umrechnen hieße raten, in welcher Zone.
 * @returns {{de: string, en: string}|null}
 */
function bisText(bis) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(bis || ''));
    if (!m) return null;
    const [, j, mo, t, h, mi] = m;
    return { de: `Voraussichtlich bis ${t}.${mo}.${j}, ${h}:${mi} Uhr`, en: `Expected until ${t}.${mo}.${j}, ${h}:${mi}` };
}

/**
 * Prüft die Eingabe aus dem Formular.
 * @returns {{text_de: string, text_en: string, bis: string|null}}
 */
function pruefe(eingabe = {}) {
    const text = (wert) => String(wert || '').trim();
    const texte = { text_de: text(eingabe.text_de), text_en: text(eingabe.text_en) };
    for (const [feld, wert] of Object.entries(texte)) {
        if (wert.length > MAX_TEXT) {
            throw Object.assign(new Error(`Der Text ist zu lang (höchstens ${MAX_TEXT} Zeichen).`), { status: 400, feld });
        }
    }
    const bis = text(eingabe.bis) || null;
    if (bis && !bisText(bis)) throw Object.assign(new Error('„Voraussichtlich bis" ist kein gültiger Zeitpunkt.'), { status: 400 });
    return { ...texte, bis };
}

/** Füllt die Vorlage. Leere Texte nehmen die Vorgabe. */
function baue(eingabe = {}) {
    const t = pruefe(eingabe);
    const bis = bisText(t.bis);
    const zeile = bis ? `Maintenance · ${bis.de} · ${bis.en}` : 'Maintenance';
    // Ersetzt wird über eine Funktion: Als Text gegeben, deutete `replace` ein `$&`
    // in der Eingabe als Sonderzeichen.
    const werte = {
        ZEILE: escape(zeile),
        TEXT_DE: escape(t.text_de || VORGABE.text_de),
        TEXT_EN: escape(t.text_en || VORGABE.text_en),
    };
    return fs.readFileSync(VORLAGE, 'utf8').replace(/\{\{([A-Z_]+)\}\}/g, (alles, name) => werte[name] ?? alles);
}

/**
 * Stand und Schalter für einen Ablageordner. Der Betrieb nimmt `wartung/aktiv`, den
 * der Apache prüft. Der Wächter gibt einen eigenen: Schriebe er in den echten, wäre
 * die Website für die Dauer der Prüfung gesperrt.
 *
 * @param {string} [aktiv]
 */
function ablage(aktiv = path.join(ORDNER, 'aktiv')) {
    const SEITE = path.join(aktiv, 'wartung.html');
    const STAND = path.join(aktiv, 'stand.json');

    /** Was gerade gilt. `an` kommt allein aus der Datei, die der Apache sieht. */
    function stand() {
        let gespeichert = {};
        try {
            gespeichert = JSON.parse(fs.readFileSync(STAND, 'utf8'));
        } catch {
            // Noch nie gespeichert: Es gelten die Vorgaben.
        }
        return {
            an: fs.existsSync(SEITE),
            text_de: gespeichert.text_de || '',
            text_en: gespeichert.text_en || '',
            bis: gespeichert.bis || null,
            geaendert_am: gespeichert.geaendert_am || null,
            geaendert_von: gespeichert.geaendert_von || null,
            vorgabe: VORGABE,
        };
    }

    /**
     * Speichert die Texte und schaltet die Seite.
     * @param {object} eingabe `text_de`, `text_en`, `bis`
     * @param {boolean} an
     * @param {string} wer für das Log
     */
    function setze(eingabe, an, wer) {
        const t = pruefe(eingabe);
        const vorher = fs.existsSync(SEITE);
        fs.mkdirSync(aktiv, { recursive: true, mode: 0o755 });
        schreibe(STAND, JSON.stringify({ ...t, geaendert_am: new Date().toISOString(), geaendert_von: wer }, null, 2));
        if (an) schreibe(SEITE, baue(t));
        else fs.rmSync(SEITE, { force: true });

        if (vorher !== an) {
            ServiceManager.get('Logger').info(`[Wartung] ${an ? 'Eingeschaltet' : 'Ausgeschaltet'} von ${wer}`);
        } else if (an) {
            ServiceManager.get('Logger').info(`[Wartung] Text geändert von ${wer}`);
        }
        return stand();
    }

    return { stand, setze, SEITE };
}

/** Schreibt erst daneben und benennt dann um: Der Apache sieht nie eine halbe Seite. */
function schreibe(ziel, inhalt) {
    const zwischen = `${ziel}.${process.pid}.neu`;
    fs.writeFileSync(zwischen, inhalt, { mode: 0o644 });
    fs.renameSync(zwischen, ziel);
}

const betrieb = ablage();

module.exports = { stand: betrieb.stand, setze: betrieb.setze, SEITE: betrieb.SEITE, baue, pruefe, ablage, ORDNER, MAX_TEXT };
