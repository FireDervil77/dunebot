'use strict';

/**
 * Cron-Ausdruecke bauen und wieder auseinandernehmen — ohne dass jemand die
 * Syntax kennen muss.
 *
 * Wunsch des Users: "die cronjobs muessen fuer die user einfacher werden. so
 * das auch user ohne viel erfahrung mit sowas cron jobs anlegen koennen."
 *
 * Ein Auswahlfeld mit fertigen Vorlagen reicht dafuer nicht: sobald jemand
 * "taeglich um 3:30" will und die Vorlage nur 4:00 kennt, steht er wieder vor
 * dem nackten Ausdruck. Deshalb ein Baukasten — Takt waehlen, Uhrzeit
 * eintragen, fertig.
 *
 * Beide Richtungen werden gebraucht: `baue` fuer das Anlegen, `lies` fuer das
 * Bearbeiten. Ohne `lies` stuende ein bestehender Job beim Oeffnen wieder als
 * Zeichenkette da, und der Baukasten waere nur beim ersten Mal eine Hilfe.
 *
 * Reine Rechnung, keine Datenbank — `scripts/check-cronjob-lauf.js` prueft sie.
 *
 * Liegt bei den Assets und nicht bei den Helfern, weil beide Seiten dieselbe
 * Rechnung brauchen: der Browser baut den Ausdruck beim Klicken, der CronWorker
 * loest damit die Aufbewahrung auf. Zwei Fassungen davon waeren zwei Wahrheiten.
 */
(function (global) {

/** Die Takte, die der Baukasten anbietet. */
const TAKTE = ['minuten', 'stuendlich', 'taeglich', 'woechentlich', 'monatlich'];

const WOCHENTAGE = [
    'Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag',
];

const zahl = (wert, vorgabe = 0) => {
    const n = Number.parseInt(wert, 10);
    return Number.isFinite(n) ? n : vorgabe;
};

const klemme = (n, min, max) => Math.min(Math.max(n, min), max);

/**
 * Baut aus der Auswahl einen Cron-Ausdruck.
 *
 * @param {object} plan
 * @param {'minuten'|'stuendlich'|'taeglich'|'woechentlich'|'monatlich'} plan.takt
 * @param {number} [plan.intervall] Nur bei `minuten`: alle N Minuten
 * @param {number} [plan.minute]    Minute (0–59)
 * @param {number} [plan.stunde]    Stunde (0–23)
 * @param {number} [plan.wochentag] 0–6, Sonntag = 0
 * @param {number} [plan.tag]       Tag im Monat, 1–28
 * @returns {string}
 */
function baue(plan = {}) {
    const minute = klemme(zahl(plan.minute, 0), 0, 59);
    const stunde = klemme(zahl(plan.stunde, 4), 0, 23);

    switch (plan.takt) {
        case 'minuten': {
            // Unter 5 Minuten ist kein sinnvoller Takt fuer Serveraktionen —
            // ein Backup alle zwei Minuten laeuft in sich selbst hinein.
            const intervall = klemme(zahl(plan.intervall, 30), 5, 59);
            return `*/${intervall} * * * *`;
        }
        case 'stuendlich':
            return `${minute} * * * *`;
        case 'taeglich':
            return `${minute} ${stunde} * * *`;
        case 'woechentlich': {
            const wochentag = klemme(zahl(plan.wochentag, 1), 0, 6);
            return `${minute} ${stunde} * * ${wochentag}`;
        }
        case 'monatlich': {
            // Bewusst nur bis 28: der 29., 30. und 31. faellt in manchen
            // Monaten aus, und der Job liefe dann stillschweigend gar nicht.
            const tag = klemme(zahl(plan.tag, 1), 1, 28);
            return `${minute} ${stunde} ${tag} * *`;
        }
        default:
            return '';
    }
}

/**
 * Nimmt einen Ausdruck auseinander, damit der Baukasten ihn zeigen kann.
 *
 * @param {string} ausdruck
 * @returns {object|null} null, wenn die Form nicht in den Baukasten passt
 */
function lies(ausdruck) {
    const teile = String(ausdruck || '').trim().split(/\s+/);
    if (teile.length !== 5) return null;

    const [min, std, tag, monat, wtag] = teile;
    const istZahl = (s) => /^\d+$/.test(s);

    if (monat !== '*') return null;

    // alle N Minuten
    const alleMinuten = /^\*\/(\d+)$/.exec(min);
    if (alleMinuten && std === '*' && tag === '*' && wtag === '*') {
        return { takt: 'minuten', intervall: Number(alleMinuten[1]) };
    }
    if (!istZahl(min)) return null;

    if (std === '*' && tag === '*' && wtag === '*') {
        return { takt: 'stuendlich', minute: Number(min) };
    }
    if (!istZahl(std)) return null;

    if (tag === '*' && wtag === '*') {
        return { takt: 'taeglich', minute: Number(min), stunde: Number(std) };
    }
    if (tag === '*' && istZahl(wtag)) {
        return {
            takt: 'woechentlich',
            minute: Number(min), stunde: Number(std), wochentag: Number(wtag) % 7,
        };
    }
    if (istZahl(tag) && wtag === '*') {
        return {
            takt: 'monatlich',
            minute: Number(min), stunde: Number(std), tag: Number(tag),
        };
    }
    return null;
}

/**
 * Beschreibt einen Ausdruck in einem Satz.
 * Gibt null zurueck, wenn die Form nicht in den Baukasten passt — dann steht
 * in der Oberflaeche lieber nichts als etwas Falsches.
 */
function beschreibe(ausdruck) {
    const plan = lies(ausdruck);
    if (!plan) return null;

    const uhr = `${String(plan.stunde ?? 0).padStart(2, '0')}:${String(plan.minute ?? 0).padStart(2, '0')} Uhr`;

    switch (plan.takt) {
        case 'minuten':      return `alle ${plan.intervall} Minuten`;
        case 'stuendlich':   return `stündlich, jeweils zur Minute ${plan.minute}`;
        case 'taeglich':     return `täglich um ${uhr}`;
        case 'woechentlich': return `jeden ${WOCHENTAGE[plan.wochentag]} um ${uhr}`;
        case 'monatlich':    return `monatlich am ${plan.tag}. um ${uhr}`;
        default:             return null;
    }
}

/**
 * Loest auf, welche Aufbewahrung fuer einen Backup-Cronjob gilt.
 *
 * Die Einstellung liegt am Server; der Cronjob darf abweichen. `null` am Job
 * heisst erben — nicht "unbegrenzt". Diese Unterscheidung ist der Grund, warum
 * die Aufloesung eine eigene Funktion ist: ein `|| 0` an der falschen Stelle
 * macht aus "erbt 7" ein "unbegrenzt", und niemand raeumt mehr auf.
 *
 * @param {{backup_keep?: number, backup_keep_days?: number}} server
 * @param {{backup_keep?: number|null, backup_keep_days?: number|null}} [job]
 * @returns {{keep: number, keepDays: number, quelle: 'job'|'server'}}
 */
function loeseAufbewahrung(server = {}, job = null) {
    const jobKeep = job?.backup_keep;
    const jobDays = job?.backup_keep_days;
    const jobSetzt = (jobKeep !== null && jobKeep !== undefined)
        || (jobDays !== null && jobDays !== undefined);

    if (jobSetzt) {
        return {
            keep: zahl(jobKeep, 0),
            keepDays: zahl(jobDays, 0),
            quelle: 'job',
        };
    }
    return {
        keep: zahl(server.backup_keep, 0),
        keepDays: zahl(server.backup_keep_days, 0),
        quelle: 'server',
    };
}

const oeffentlich = { baue, lies, beschreibe, loeseAufbewahrung, TAKTE, WOCHENTAGE };

// Node laedt es per require, der Browser per <script src>. Kein Bauschritt,
// also traegt die Datei beide Ausgaenge selbst.
if (typeof module !== 'undefined' && module.exports) module.exports = oeffentlich;
if (global) global.CronPlan = oeffentlich;

})(typeof window !== 'undefined' ? window : null);
