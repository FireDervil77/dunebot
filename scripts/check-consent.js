#!/usr/bin/env node
/**
 * Prüft die Cookie-Einwilligung – ohne Datenbank, ohne Browser.
 *
 * Zwei Fehlerarten wären hier teuer, und beide sind still:
 *
 *  - **Zu viel erlaubt.** Eine Kategorie, die versehentlich `granted` liefert,
 *    setzt Cookies bei Leuten, die nein gesagt haben. Das merkt niemand, bis es
 *    jemand von außen prüft.
 *  - **Die Reihenfolge.** Steht der Consent-Mode-Standard nicht vor dem
 *    GTM-Schnipsel, lädt GTM seine Tags, bevor überhaupt gefragt wurde. Das
 *    lässt sich nicht an der Ausgabe erkennen – die Seite sieht gleich aus.
 *
 *   node scripts/check-consent.js
 */

'use strict';

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

const HELPER = path.join(__dirname, '../apps/dashboard/helpers/AnalyticsConsent');
const {
    istGtmId, signaleFuer, bereinigeAuswahl, istAktiv,
    STANDARD_KATEGORIEN, ALLE_SIGNALE,
} = require(HELPER);

let passed = 0;
function check(name, fn) {
    try {
        fn();
        console.log(`  ✓ ${name}`);
        passed++;
    } catch (err) {
        console.error(`  ✗ ${name}\n    ${err.message}`);
        process.exitCode = 1;
    }
}

console.log('\nContainer-ID');

check('Gültige IDs werden erkannt', () => {
    assert.strictEqual(istGtmId('GTM-ABCD123'), true);
    assert.strictEqual(istGtmId('gtm-abcd123'), true);   // Kleinschreibung wird gehoben
});

check('Unfug wird abgewiesen – eine falsche ID erzeugt sonst nur Stille', () => {
    ['', 'ABCD123', 'GTM-', 'GA-12345', 'GTM ABC', 'UA-1234-5', null, undefined]
        .forEach(w => assert.strictEqual(istGtmId(w), false, String(w)));
});

check('Aktiv ist nur, wer Schalter UND gültige ID hat', () => {
    assert.strictEqual(istAktiv({ aktiv: true,  gtmId: 'GTM-ABCD123' }), true);
    assert.strictEqual(istAktiv({ aktiv: false, gtmId: 'GTM-ABCD123' }), false);
    assert.strictEqual(istAktiv({ aktiv: true,  gtmId: '' }), false);
    assert.strictEqual(istAktiv({ aktiv: true,  gtmId: 'quatsch' }), false);
    assert.strictEqual(istAktiv(null), false);
});

console.log('\nConsent-Mode-Signale');

check('Ohne Auswahl ist alles verweigert', () => {
    const s = signaleFuer([]);
    for (const name of ALLE_SIGNALE) {
        assert.strictEqual(s[name], 'denied', name);
    }
});

check('Statistik schaltet nur analytics_storage frei', () => {
    const s = signaleFuer(['notwendig', 'statistik']);
    assert.strictEqual(s.analytics_storage, 'granted');
    assert.strictEqual(s.ad_storage, 'denied');
    assert.strictEqual(s.ad_user_data, 'denied');
    assert.strictEqual(s.ad_personalization, 'denied');
});

check('Marketing schaltet die drei Werbe-Signale frei, nicht die Statistik', () => {
    const s = signaleFuer(['marketing']);
    assert.strictEqual(s.ad_storage, 'granted');
    assert.strictEqual(s.ad_user_data, 'granted');
    assert.strictEqual(s.ad_personalization, 'granted');
    assert.strictEqual(s.analytics_storage, 'denied');
});

check('Eine unbekannte Kategorie schaltet nichts frei', () => {
    const s = signaleFuer(['ausgedacht']);
    for (const name of ALLE_SIGNALE) {
        assert.strictEqual(s[name], 'denied', name);
    }
});

console.log('\nAuswahl bereinigen');

check('Pflichtkategorien sind immer dabei', () => {
    // Ein Formular, das "notwendig" ausliesse, wuerde sonst die Sitzung abschalten.
    assert.ok(bereinigeAuswahl([]).includes('notwendig'));
    assert.ok(bereinigeAuswahl(null).includes('notwendig'));
});

check('Unbekannte Werte fliegen raus', () => {
    const a = bereinigeAuswahl(['statistik', 'ausgedacht', '<script>']);
    assert.deepStrictEqual(a.sort(), ['notwendig', 'statistik']);
});

check('Doppelte Angaben ergeben keine Dubletten', () => {
    const a = bereinigeAuswahl(['statistik', 'statistik', 'notwendig']);
    assert.strictEqual(a.length, 2);
});

console.log('\nReihenfolge im Seitenkopf');

const partial = fs.readFileSync(
    path.join(__dirname, '../apps/dashboard/themes/default/partials/frontend/consent.ejs'), 'utf8');

check('Der Consent-Standard steht VOR dem GTM-Schnipsel', () => {
    // Der eigentliche Waechter dieser Datei. Dreht jemand die Bloecke um, laedt
    // GTM seine Tags, bevor gefragt wurde - und die Seite sieht gleich aus.
    const standard = partial.indexOf("gtag('consent', 'default'");
    const gtm      = partial.indexOf('googletagmanager.com/gtm.js');
    assert.ok(standard > -1, 'kein consent default gefunden');
    assert.ok(gtm > -1, 'kein GTM-Schnipsel gefunden');
    assert.ok(standard < gtm, `Standard bei ${standard}, GTM bei ${gtm} – falsche Reihenfolge`);
});

check('Der Standard verweigert alles ausser security_storage', () => {
    // Ab dem gtag-Aufruf suchen, nicht ab Dateianfang: "wait_for_update" steht
    // auch im erklaerenden Kommentar darueber, und mit dessen Fundstelle waere
    // der Ausschnitt leer - die Pruefung ginge dann gruen durch, ohne zu pruefen.
    const start = partial.indexOf("gtag('consent', 'default'");
    const block = partial.slice(start, partial.indexOf('wait_for_update', start));
    assert.ok(block.length > 0, 'Ausschnitt ist leer – die Prüfung würde nichts prüfen');
    for (const name of ALLE_SIGNALE) {
        assert.ok(new RegExp(`${name}:\\s*'denied'`).test(block), `${name} startet nicht auf denied`);
    }
    assert.ok(/security_storage:\s*'granted'/.test(partial), 'security_storage sollte granted sein');
});

check('wait_for_update ist gesetzt – sonst gibt es einen Wettlauf', () => {
    assert.ok(/wait_for_update:\s*\d+/.test(partial));
});

check('Ohne aktive Einstellung wird gar nichts ausgegeben', () => {
    assert.ok(/_c\s*&&\s*_c\.aktiv/.test(partial), 'fehlender Aktiv-Vorbehalt');
});

check('Ablehnen steht gleichrangig neben Zustimmen', () => {
    // Beide Knoepfe tragen dieselbe Klasse. Ein Banner, bei dem "Alle ablehnen"
    // unauffaelliger ist, ist keine freiwillige Einwilligung.
    const alle  = /id="consent-alle" class="([^"]+)"/.exec(partial);
    const keine = /id="consent-keine" class="([^"]+)"/.exec(partial);
    assert.ok(alle && keine, 'Knöpfe nicht gefunden');
    assert.strictEqual(alle[1], keine[1], `"${alle[1]}" vs "${keine[1]}"`);
});

console.log('\nStandardkategorien');

check('Genau eine Pflichtkategorie, und die heisst notwendig', () => {
    const pflicht = STANDARD_KATEGORIEN.filter(k => k.pflicht);
    assert.strictEqual(pflicht.length, 1);
    assert.strictEqual(pflicht[0].key, 'notwendig');
});

check('Statistik und Marketing sind abwaehlbar', () => {
    for (const key of ['statistik', 'marketing']) {
        const k = STANDARD_KATEGORIEN.find(x => x.key === key);
        assert.ok(k, key);
        assert.strictEqual(k.pflicht, false, key);
    }
});

console.log(`\n${passed} Prüfung(en) bestanden.\n`);
process.exit(process.exitCode || 0);
