/**
 * AnalyticsConsent – Einstellungen für Google Tag Manager und die Cookie-Abfrage.
 *
 * Der Betreiber verwaltet die Tags im GTM-Container bei Google; hier steht nur
 * die Container-ID. Das hat eine Folge, die man nicht wegprogrammieren kann und
 * die deshalb im Adminbereich als Warnung steht: **Was GTM lädt, ist von hier aus
 * nicht sichtbar.** Ergänzt jemand dort ein Marketing-Tag, ändern sich die
 * gesetzten Cookies, ohne dass irgendwo in diesem Dashboard etwas davon steht.
 * Die Kategorien der Abfrage und der Text der Datenschutzseite müssen dann von
 * Hand nachgezogen werden.
 *
 * **Die Einwilligung greift trotzdem hier**, über Google Consent Mode v2. Die
 * Reihenfolge im Seitenkopf ist das ganze Geheimnis:
 *
 *   1. `gtag('consent', 'default', …)` – alles außer `security_storage` auf
 *      `denied`
 *   2. der GTM-Schnipsel
 *   3. `gtag('consent', 'update', …)` mit der gespeicherten Auswahl
 *
 * Andersherum lädt GTM seine Tags, bevor irgendjemand gefragt wurde.
 *
 * @module helpers/AnalyticsConsent
 */

'use strict';

const { ServiceManager } = require('dunebot-core');

/** Schlüssel in `admin_settings`. */
const KEY_GTM_ID     = 'analytics_gtm_id';
const KEY_AKTIV      = 'analytics_enabled';
const KEY_VERSION    = 'consent_version';
const KEY_KATEGORIEN = 'consent_categories';

/** Name des Cookies beim Besucher. */
const COOKIE_NAME = 'firebot_consent';

/**
 * Wie lange die Einwilligung gilt.
 *
 * Sechs Monate sind die übliche Obergrenze in den Empfehlungen der
 * Aufsichtsbehörden – danach wird erneut gefragt. Ein Cookie mit zwei Jahren
 * Laufzeit wäre technisch bequemer und genau deshalb angreifbar.
 */
const COOKIE_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;

/**
 * Die Kategorien in der Auslieferung.
 *
 * „notwendig" ist Pflicht und lässt sich nicht abwählen – dort steckt die
 * Sitzung, ohne die eine Anmeldung nicht funktioniert, und das Consent-Cookie
 * selbst. Alles andere ist standardmäßig **aus**.
 */
const STANDARD_KATEGORIEN = [
    {
        key: 'notwendig',
        label: 'Notwendig',
        beschreibung: 'Sitzung und die Speicherung dieser Auswahl. Ohne sie funktioniert die Seite nicht.',
        pflicht: true,
    },
    {
        key: 'statistik',
        label: 'Statistik',
        beschreibung: 'Anonyme Auswertung, welche Seiten besucht werden.',
        pflicht: false,
    },
    {
        key: 'marketing',
        label: 'Marketing',
        beschreibung: 'Wiedererkennung für Werbung auf anderen Seiten.',
        pflicht: false,
    },
];

/**
 * Abbildung Kategorie → Signale des Google Consent Mode v2.
 *
 * `security_storage` fehlt hier bewusst: Es ist immer erlaubt und gehört zu
 * keiner wählbaren Kategorie – es deckt Missbrauchserkennung ab.
 */
const CONSENT_SIGNALE = {
    notwendig: ['functionality_storage'],
    statistik: ['analytics_storage'],
    marketing: ['ad_storage', 'ad_user_data', 'ad_personalization'],
};

/** Alle Signale, die auf `denied` starten müssen. */
const ALLE_SIGNALE = [
    'ad_storage', 'ad_user_data', 'ad_personalization',
    'analytics_storage', 'functionality_storage', 'personalization_storage',
];

/**
 * Ist das eine plausible GTM-Container-ID?
 *
 * Bewusst streng: Ein Tippfehler hier bleibt sonst unbemerkt, weil eine falsche
 * ID keinen Fehler erzeugt – es passiert einfach nichts.
 *
 * @param {string} wert
 * @returns {boolean}
 */
function istGtmId(wert) {
    return /^GTM-[A-Z0-9]{4,10}$/.test(String(wert || '').trim().toUpperCase());
}

/** @private */
function parseJson(wert, ersatz) {
    if (!wert) return ersatz;
    try {
        const v = typeof wert === 'string' ? JSON.parse(wert) : wert;
        return v ?? ersatz;
    } catch (_) {
        return ersatz;
    }
}

/**
 * Lädt die Einstellungen.
 *
 * Fällt immer auf einen sicheren Zustand zurück: keine ID, nichts aktiv. Eine
 * kaputte Zeile in der Datenbank darf nicht dazu führen, dass ungefragt getrackt
 * wird.
 *
 * @param {object} dbService
 * @returns {Promise<{gtmId: string, aktiv: boolean, version: number, kategorien: Array}>}
 */
async function ladeEinstellungen(dbService) {
    const standard = { gtmId: '', aktiv: false, version: 1, kategorien: STANDARD_KATEGORIEN };

    try {
        const zeilen = await dbService.query(
            'SELECT `key`, `value` FROM admin_settings WHERE `key` IN (?, ?, ?, ?)',
            [KEY_GTM_ID, KEY_AKTIV, KEY_VERSION, KEY_KATEGORIEN]
        );
        const map = new Map((zeilen || []).map(z => [z.key, z.value]));

        const kategorien = parseJson(map.get(KEY_KATEGORIEN), STANDARD_KATEGORIEN);

        return {
            gtmId:      String(map.get(KEY_GTM_ID) || '').trim(),
            aktiv:      String(map.get(KEY_AKTIV) || '0') === '1',
            version:    Number(map.get(KEY_VERSION)) || 1,
            kategorien: Array.isArray(kategorien) && kategorien.length ? kategorien : STANDARD_KATEGORIEN,
        };
    } catch (err) {
        ServiceManager.get('Logger')?.warn?.(`[AnalyticsConsent] Einstellungen nicht lesbar: ${err.message}`);
        return standard;
    }
}

/**
 * Speichert die Einstellungen.
 *
 * @param {object} dbService
 * @param {object} werte
 * @param {string} [werte.gtmId]
 * @param {boolean} [werte.aktiv]
 * @param {number} [werte.version]
 * @param {Array} [werte.kategorien]
 * @returns {Promise<void>}
 */
async function speichereEinstellungen(dbService, werte) {
    const paare = [
        [KEY_GTM_ID,     String(werte.gtmId || '').trim().toUpperCase()],
        [KEY_AKTIV,      werte.aktiv ? '1' : '0'],
        [KEY_VERSION,    String(Number(werte.version) || 1)],
        [KEY_KATEGORIEN, JSON.stringify(werte.kategorien || STANDARD_KATEGORIEN)],
    ];

    for (const [key, value] of paare) {
        await dbService.query(
            'INSERT INTO admin_settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = ?',
            [key, value, value]
        );
    }
}

/**
 * Wird GTM auf dieser Seite überhaupt eingebunden?
 *
 * Beides muss stimmen: Hauptschalter an **und** eine gültige ID. Der getrennte
 * Schalter existiert, damit sich alles abschalten lässt, ohne die ID zu verlieren.
 *
 * @param {object} einstellungen
 * @returns {boolean}
 */
function istAktiv(einstellungen) {
    return Boolean(einstellungen?.aktiv) && istGtmId(einstellungen?.gtmId);
}

/**
 * Übersetzt eine Auswahl in die Signale des Consent Mode.
 *
 * @param {string[]} gewaehlt - Schlüssel der zugestimmten Kategorien
 * @returns {object} z.B. { analytics_storage: 'granted', ad_storage: 'denied', … }
 */
function signaleFuer(gewaehlt) {
    const erlaubt = new Set(gewaehlt || []);
    const signale = {};

    for (const name of ALLE_SIGNALE) signale[name] = 'denied';

    for (const [kategorie, namen] of Object.entries(CONSENT_SIGNALE)) {
        if (!erlaubt.has(kategorie)) continue;
        for (const name of namen) signale[name] = 'granted';
    }

    // Ohne Statistik gibt es auch keine Personalisierung der Anzeige.
    if (erlaubt.has('marketing')) signale.personalization_storage = 'granted';

    return signale;
}

/**
 * Prüft eine eingehende Auswahl und wirft Unbekanntes weg.
 *
 * Pflichtkategorien werden immer aufgenommen, egal was ankommt – sie sind nicht
 * abwählbar, und ein Formular, das sie ausließe, würde sonst die Sitzung
 * abschalten.
 *
 * @param {any} roh
 * @param {Array} kategorien
 * @returns {string[]}
 */
function bereinigeAuswahl(roh, kategorien = STANDARD_KATEGORIEN) {
    const bekannt = new Map(kategorien.map(k => [k.key, k]));
    const gewaehlt = new Set();

    for (const k of kategorien) {
        if (k.pflicht) gewaehlt.add(k.key);
    }
    for (const wert of (Array.isArray(roh) ? roh : [])) {
        const key = String(wert);
        if (bekannt.has(key)) gewaehlt.add(key);
    }
    return [...gewaehlt];
}

module.exports = {
    ladeEinstellungen,
    speichereEinstellungen,
    istAktiv,
    istGtmId,
    signaleFuer,
    bereinigeAuswahl,
    STANDARD_KATEGORIEN,
    CONSENT_SIGNALE,
    ALLE_SIGNALE,
    COOKIE_NAME,
    COOKIE_MAX_AGE_MS,
};
