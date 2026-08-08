'use strict';

/**
 * Musik - Trefferliste waehrend des Tippens
 *
 * Discord schickt bei **jedem Tastendruck** eine eigene Anfrage und erwartet
 * die Antwort binnen drei Sekunden. Beides zusammen ist die ganze Schwierigkeit
 * hier: ungebremst wuerde jeder gesuchte Titel ein Dutzend Suchlaeufe bei
 * YouTube ausloesen, und eine zu langsame Antwort verwirft Discord wortlos.
 *
 * Drei Vorkehrungen:
 *
 *   1. Zwischenspeicher, auch ueber Wortanfaenge. Wer "linkin p" tippt, bekommt
 *      die Treffer von "linkin" sofort angezeigt, ohne dass gesucht wird.
 *   2. Mindestabstand je Nutzer. Zwischen zwei echten Suchlaeufen liegt immer
 *      etwas Zeit; dazwischen kommt die Anzeige aus dem Zwischenspeicher.
 *   3. Frist. Antwortet die Suche nicht rechtzeitig, geben wir zurueck, was wir
 *      haben. Der Suchlauf laeuft trotzdem zu Ende und fuellt den Speicher -
 *      der naechste Tastendruck hat die Treffer dann sofort.
 *
 * @module music/bot/quellen/vorschlaege
 */

const play = require('play-dl');
const { ServiceManager } = require('dunebot-core');

/** Wie lange ein Suchergebnis gilt. */
const HALTBAR_MS = 5 * 60 * 1000;

/** Wie viele Suchbegriffe wir hoechstens vorhalten. */
const MAX_BEGRIFFE = 300;

/**
 * Mindestabstand zwischen zwei echten Suchlaeufen desselben Nutzers.
 *
 * Der Wert ist auf Discord zugeschnitten: Dort kommt bei **jedem** Tastendruck
 * eine eigene Anfrage, ungebremst und ohne Wartezeit. Ohne diesen Abstand loeste
 * ein einziger gesuchter Titel ein Dutzend Suchlaeufe aus.
 */
const ABSTAND_MS = 800;

/**
 * Derselbe Abstand fuer das Dashboard - deutlich kleiner.
 *
 * Dort wartet das Feld schon selbst, bevor es losschickt, und verwirft
 * ueberholte Antworten. Der grosse Abstand bremste dort nur: Wer zuegig tippt,
 * bekam die Treffer des Wortanfangs zu sehen und musste warten, bis endlich
 * wirklich gesucht wurde. Das war ein guter Teil des "mega langsam".
 */
const ABSTAND_DASHBOARD_MS = 250;

/** Frist fuer die Antwort an Discord - deutlich unter den drei Sekunden. */
const FRIST_MS = 2200;

/** Ab wie vielen Zeichen ueberhaupt gesucht wird. */
const AB_ZEICHEN = 3;

/** Discord nimmt hoechstens 25 Eintraege. */
const MAX_TREFFER = 25;

/** begriff -> { treffer, zeit } */
const speicher = new Map();

/** nutzerId -> Zeitpunkt des letzten echten Suchlaufs */
const letzteSuche = new Map();

/**
 * Sekunden als "3:42" beziehungsweise "1:02:11".
 *
 * @param {number|null} sek Sekunden
 * @returns {string} Text
 */
function dauer(sek) {
    if (!sek || sek <= 0) return 'live';

    const s = Math.floor(sek % 60);
    const m = Math.floor((sek / 60) % 60);
    const h = Math.floor(sek / 3600);

    const zwei = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${zwei(m)}:${zwei(s)}` : `${m}:${zwei(s)}`;
}

/**
 * Text auf eine Hoechstlaenge kuerzen.
 *
 * Discord weist eine Auswahl mit mehr als 100 Zeichen im Namen komplett ab -
 * ein zu langer Titel wuerde also die ganze Liste kosten.
 *
 * @param {string} text Text
 * @param {number} max Hoechstlaenge
 * @returns {string} Gekuerzter Text
 */
function kuerzen(text, max) {
    const t = String(text || '').trim();
    if (t.length <= max) return t;

    let schnitt = t.slice(0, max - 1);

    // Titel enthalten oft Emoji. Die belegen zwei Einheiten; faellt der Schnitt
    // mitten hinein, bleibt eine halbe Ersatzstelle stehen und Discord zeigt
    // ein Fragezeichen im Kaestchen.
    const letzte = schnitt.charCodeAt(schnitt.length - 1);
    if (letzte >= 0xD800 && letzte <= 0xDBFF) schnitt = schnitt.slice(0, -1);

    return `${schnitt}…`;
}

/**
 * Einen Treffer als Auswahleintrag darstellen.
 *
 * Der Wert ist die Adresse, nicht der Titel: damit muss beim Abspielen nicht
 * noch einmal gesucht werden, und es kann kein anderer Titel herauskommen als
 * der angezeigte.
 *
 * @param {Object} video Ergebnis aus play-dl
 * @returns {{name: string, value: string}} Auswahleintrag
 */
function alsAuswahl(video) {
    const name = video.channel?.name || '';

    // Steht der Kanal schon im Titel - bei offiziellen Kanaelen die Regel -,
    // waere er ein zweites Mal nur verschenkter Platz.
    const doppelt = name && String(video.title || '').toLowerCase().includes(name.toLowerCase());
    const kanal = name && !doppelt ? ` · ${name}` : '';

    const zeit = ` [${dauer(video.durationInSec)}]`;

    // Der Titel muss weichen, nicht die Dauer - die Dauer ist die
    // Unterscheidungshilfe zwischen Original, Kurzfassung und Stundenschleife.
    const platz = 100 - zeit.length;
    const vorn = kuerzen(`${video.title}${kanal}`, platz);

    return { name: `${vorn}${zeit}`, value: kuerzen(video.url, 100) };
}

/** Alte Eintraege wegraeumen, damit der Speicher nicht unbegrenzt waechst. */
function aufraeumen() {
    const jetzt = Date.now();

    for (const [begriff, eintrag] of speicher) {
        if (jetzt - eintrag.zeit > HALTBAR_MS) speicher.delete(begriff);
    }

    // Reicht das nicht, fliegen die aeltesten heraus (Map haelt die Reihenfolge)
    while (speicher.size > MAX_BEGRIFFE) {
        const ersterSchluessel = speicher.keys().next().value;
        speicher.delete(ersterSchluessel);
    }

    // Wer laenger nicht getippt hat, braucht keinen Merkposten mehr
    for (const [nutzerId, zeit] of letzteSuche) {
        if (jetzt - zeit > HALTBAR_MS) letzteSuche.delete(nutzerId);
    }
}

/**
 * Genau dieser Begriff, noch frisch.
 *
 * @param {string} begriff Kleingeschriebener Suchbegriff
 * @returns {Array|null} Treffer oder null
 */
function genauAusSpeicher(begriff) {
    const eintrag = speicher.get(begriff);
    return eintrag && Date.now() - eintrag.zeit <= HALTBAR_MS ? eintrag.treffer : null;
}

/**
 * Der laengste gespeicherte Wortanfang zu einem Begriff.
 *
 * Beim Tippen ist das fast immer der Suchlauf von vor zwei Buchstaben - gut
 * genug, um die Liste stehen zu lassen, statt sie flackern zu lassen.
 *
 * @param {string} begriff Kleingeschriebener Suchbegriff
 * @returns {Array|null} Treffer oder null
 */
function ausSpeicher(begriff) {
    const jetzt = Date.now();

    let beste = null;
    let besteLaenge = 0;

    for (const [gespeichert, eintrag] of speicher) {
        if (gespeichert.length <= besteLaenge) continue;
        if (jetzt - eintrag.zeit > HALTBAR_MS) continue;
        if (!begriff.startsWith(gespeichert)) continue;

        beste = eintrag.treffer;
        besteLaenge = gespeichert.length;
    }

    return beste;
}

/**
 * Bei YouTube suchen und das Ergebnis ablegen.
 *
 * @param {string} begriff Kleingeschriebener Suchbegriff
 * @returns {Promise<Array>} Auswahleintraege
 */
async function suchen(begriff) {
    const roh = await play.search(begriff, { limit: MAX_TREFFER, source: { youtube: 'video' } });
    const treffer = (roh || []).filter(v => v?.url && v?.title).map(alsAuswahl);

    speicher.set(begriff, { treffer, zeit: Date.now() });
    aufraeumen();

    return treffer;
}

/**
 * Ein Versprechen mit Frist.
 *
 * Laeuft die Frist ab, geben wir auf - der Suchlauf selbst laeuft aber weiter
 * und legt sein Ergebnis ab. Genau das macht den naechsten Tastendruck schnell.
 *
 * @param {Promise} versprechen Das laufende Versprechen
 * @param {number} ms Frist
 * @returns {Promise} Ergebnis oder Ablehnung
 */
function mitFrist(versprechen, ms) {
    let wecker;

    const frist = new Promise((_, ablehnen) => {
        wecker = setTimeout(() => ablehnen(new Error('Frist abgelaufen')), ms);
    });

    return Promise.race([versprechen, frist]).finally(() => clearTimeout(wecker));
}

/** guildId -> { erlaubt, zeit } - damit nicht jeder Tastendruck die Datenbank fragt. */
const youtubeErlaubt = new Map();

/** Wie lange die Antwort auf "ist YouTube hier erlaubt?" gilt. */
const QUELLE_HALTBAR_MS = 60 * 1000;

/**
 * Ist YouTube in dieser Guild ueberhaupt freigegeben?
 *
 * Sonst wuerden wir Adressen vorschlagen, die das Abspielen danach mit
 * "Diese Quelle ist auf dem Server abgeschaltet" zurueckweist.
 *
 * Im Zweifel `true`: eine stumme leere Liste waere schlimmer als ein Vorschlag,
 * den der Abspielbefehl sauber begruendet ablehnt.
 *
 * @param {string} guildId Discord-Guild-ID
 * @returns {Promise<boolean>} Freigegeben
 */
async function youtubeFrei(guildId) {
    if (!guildId) return true;

    const bekannt = youtubeErlaubt.get(guildId);
    if (bekannt && Date.now() - bekannt.zeit <= QUELLE_HALTBAR_MS) return bekannt.erlaubt;

    try {
        const { MusicSettings } = require('../../shared/models');
        const einstellungen = await MusicSettings.getSettings(guildId);
        const erlaubt = einstellungen.allow_youtube !== false;

        youtubeErlaubt.set(guildId, { erlaubt, zeit: Date.now() });
        return erlaubt;
    } catch {
        return true;
    }
}

/**
 * Vorschlaege zu einer Eingabe.
 *
 * @param {string} eingabe Was der Nutzer bisher getippt hat
 * @param {string} nutzerId Discord-Nutzer-ID, fuer den Mindestabstand
 * @param {string} [guildId] Discord-Guild-ID, fuer die Quellenfreigabe
 * @param {Object} [optionen] Feinheiten
 * @param {number} [optionen.mindestabstandMs] Eigener Mindestabstand - das
 *   Dashboard bremst sich bereits selbst und braucht den grossen nicht.
 * @returns {Promise<Array<{name: string, value: string}>>} Hoechstens 25 Eintraege
 */
async function holen(eingabe, nutzerId, guildId, optionen = {}) {
    const text = String(eingabe || '').trim();

    // Eine Adresse braucht keine Suche - die geben wir unveraendert zurueck
    if (/^https?:\/\//i.test(text)) {
        return [{ name: kuerzen(`Adresse öffnen: ${text}`, 100), value: kuerzen(text, 100) }];
    }

    if (text.length < AB_ZEICHEN) return [];
    if (!(await youtubeFrei(guildId))) return [];

    const begriff = text.toLowerCase();

    // Genau diesen Begriff haben wir schon gesucht - nichts spricht dafuer,
    // dieselbe Frage noch einmal zu stellen
    const genau = genauAusSpeicher(begriff);
    if (genau) return genau;

    const bekannt = ausSpeicher(begriff);

    // Zu schnell hintereinander: zeigen, was da ist, statt erneut zu suchen
    const abstand = Number(optionen.mindestabstandMs) > 0
        ? Number(optionen.mindestabstandMs)
        : ABSTAND_MS;

    const zuletzt = letzteSuche.get(nutzerId) || 0;
    if (Date.now() - zuletzt < abstand) return bekannt || [];

    letzteSuche.set(nutzerId, Date.now());

    try {
        return await mitFrist(suchen(begriff), FRIST_MS);
    } catch (err) {
        ServiceManager.get('Logger').debug(`[Musik] Vorschlaege fuer "${begriff}": ${err.message}`);
        return bekannt || [];
    }
}

module.exports = { holen, ABSTAND_DASHBOARD_MS };
