#!/usr/bin/env node
/**
 * Prüft den Zustandsautomaten der Gameserver-Aktionen (Konzept 23.8).
 *
 * Anlass: Wer im Discord-Panel auf „Stoppen" drückte, bekam sofort einen
 * einsatzbereiten „Starten"-Knopf – der Server stand aber noch auf `stopping`,
 * und der Klick lief in einen Fehler des Daemons.
 *
 * Zwei Dinge werden hier geprüft, und die Reihenfolge ist Absicht:
 *
 *   1. **Die Erlaubnis** – sie ist die Absicherung. Ein Discord-Knopf ist ein
 *      Abbild der Vergangenheit und lässt sich noch eine Stunde später klicken.
 *   2. **Die Anzeige** – sie ist Bequemlichkeit. Ein ausgegrauter Knopf erspart
 *      den Fehlversuch, ersetzt die Prüfung aber nicht.
 *
 *   node scripts/check-server-state.js
 */

'use strict';

const assert = require('assert');
const path   = require('path');

const HELPERS = path.join(__dirname, '../plugins/gameserver/dashboard/helpers');
const { pruefeAktion, uebergangVerfallen, istUebergang, uebergangsText, UEBERGANG_VERFAELLT_MS } =
    require(path.join(HELPERS, 'ServerState'));
const { buildPanelPayload } = require(path.join(HELPERS, 'PanelPresenter'));

/**
 * Ein frischer Zeitstempel. Muss bei jedem Uebergangszustand mitgegeben werden:
 * Ohne ihn gilt der Uebergang als haengengeblieben und die Aktion waere erlaubt -
 * genau das Ventil, das weiter unten geprueft wird.
 */
const JETZT = () => new Date();

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

console.log('\nErlaubnis: der eigentliche Wächter');

check('Der gemeldete Fall: Start aus "stopping" heraus wird abgewiesen', () => {
    const r = pruefeAktion('start', 'stopping', JETZT());
    assert.strictEqual(r.erlaubt, false);
    assert.ok(/warten/i.test(r.grund), r.grund);
});

check('Start aus "starting" heraus ebenfalls – kein doppelter Start', () => {
    assert.strictEqual(pruefeAktion('start', 'starting', JETZT()).erlaubt, false);
});

check('Start aus "offline" und "error" ist erlaubt', () => {
    // error muss erlaubt sein, sonst kommt man nach einem Fehlschlag nur noch
    // ueber die Datenbank wieder heraus.
    assert.strictEqual(pruefeAktion('start', 'offline').erlaubt, true);
    assert.strictEqual(pruefeAktion('start', 'error').erlaubt, true);
});

check('Start aus "online" bleibt abgewiesen', () => {
    assert.strictEqual(pruefeAktion('start', 'online').erlaubt, false);
});

check('Stopp aus "stopping" heraus wird abgewiesen', () => {
    assert.strictEqual(pruefeAktion('stop', 'stopping', JETZT()).erlaubt, false);
});

check('Stopp aus "starting" heraus ist erlaubt – ein haengender Start muss abbrechbar sein', () => {
    assert.strictEqual(pruefeAktion('stop', 'starting', JETZT()).erlaubt, true);
});

check('Neustart nur aus "online"', () => {
    assert.strictEqual(pruefeAktion('restart', 'online').erlaubt, true);
    assert.strictEqual(pruefeAktion('restart', 'offline').erlaubt, false);
    assert.strictEqual(pruefeAktion('restart', 'stopping', JETZT()).erlaubt, false);
});

check('Waehrend Installation und Aktualisierung geht nichts', () => {
    for (const zustand of ['installing', 'updating']) {
        for (const aktion of ['start', 'stop', 'restart']) {
            assert.strictEqual(pruefeAktion(aktion, zustand, JETZT()).erlaubt, false, `${aktion}/${zustand}`);
        }
    }
});

check('Unbekannter Zustand laesst nichts durch', () => {
    assert.strictEqual(pruefeAktion('start', 'quatsch').erlaubt, false);
    assert.strictEqual(pruefeAktion('start', null).erlaubt, false);
    assert.strictEqual(pruefeAktion('start', undefined).erlaubt, false);
});

check('Unbekannte Aktion laesst nichts durch', () => {
    assert.strictEqual(pruefeAktion('loeschen', 'offline').erlaubt, false);
});

check('Die Begruendung nennt den Zustand, statt nur "geht nicht" zu sagen', () => {
    assert.ok(/gestoppt/i.test(pruefeAktion('start', 'stopping', JETZT()).grund));
    assert.ok(/laeuft bereits|läuft bereits/i.test(pruefeAktion('start', 'online').grund));
});

console.log('\nDas Ventil: haengengebliebene Uebergaenge');

check('Ein frischer Uebergang sperrt', () => {
    const gerade = new Date();
    assert.strictEqual(pruefeAktion('start', 'stopping', gerade).erlaubt, false);
});

check('Ein Uebergang von vor einer Stunde sperrt nicht mehr', () => {
    // Sonst waere ein Server, dessen Daemon mitten im Stoppen abgestuerzt ist,
    // dauerhaft unbedienbar - einzufangen nur noch ueber die Datenbank.
    const vorEinerStunde = new Date(Date.now() - 60 * 60 * 1000);
    const r = pruefeAktion('start', 'stopping', vorEinerStunde);
    assert.strictEqual(r.erlaubt, true);
    assert.strictEqual(r.verfallen, true);
});

check('Ohne Zeitstempel wird nicht ausgesperrt', () => {
    // last_status_update ist im Bestand ueberall NULL. Ein Altserver, der in
    // einem Uebergang steckt, muss trotzdem bedienbar bleiben.
    assert.strictEqual(pruefeAktion('start', 'stopping', null).erlaubt, true);
    assert.strictEqual(pruefeAktion('start', 'stopping', 'kein datum').erlaubt, true);
});

check('Das Ventil oeffnet nur Uebergaenge, nicht jede Sperre', () => {
    // "online" ist kein Uebergang - da hilft auch Warten nicht.
    const laengstVorbei = new Date(Date.now() - 24 * 60 * 60 * 1000);
    assert.strictEqual(pruefeAktion('start', 'online', laengstVorbei).erlaubt, false);
    assert.strictEqual(pruefeAktion('restart', 'offline', laengstVorbei).erlaubt, false);
});

check('uebergangVerfallen entscheidet an der Grenze richtig', () => {
    assert.strictEqual(uebergangVerfallen(new Date(Date.now() - 1000)), false);
    assert.strictEqual(uebergangVerfallen(new Date(Date.now() - UEBERGANG_VERFAELLT_MS - 1000)), true);
});

console.log('\nAnzeige: das Panel waehrend eines Uebergangs');

/** Ein Panel mit beiden Schaltern. */
function panelFuer(status, online) {
    return buildPanelPayload({
        panel:  { id: 1, guild_id: 'g', channel_id: 'c', show_controls: 1, show_refresh: 1, show_players: 0 },
        server: { id: 1, name: 'Test', status },
        snapshot: { online: online ? 1 : 0, source: 'query' },
        display: { fields: [] },
        gameName: 'Testspiel',
    });
}

check('Beim Stoppen wird weder Start noch Stopp angeboten', () => {
    const p = panelFuer('stopping', false);
    assert.strictEqual(p.controls.can_start, false);
    assert.strictEqual(p.controls.can_stop, false);
});

check('"Neu laden" bleibt – daran sieht man, wann der Uebergang vorbei ist', () => {
    assert.strictEqual(panelFuer('stopping', false).controls.show_refresh, true);
});

check('Der Uebergang schlaegt den Schnappschuss', () => {
    // Der Schnappschuss sagt "online", der Zustand sagt "stopping".
    // Ohne Vorrang des Zustands stuende hier ein Stopp-Knopf.
    const p = panelFuer('stopping', true);
    assert.strictEqual(p.controls.can_stop, false);
    assert.ok(p.embed.title.includes('Wird gestoppt'), p.embed.title);
});

check('Nach dem Uebergang sind die Schalter wieder da', () => {
    assert.strictEqual(panelFuer('offline', false).controls.can_start, true);
    assert.strictEqual(panelFuer('online', true).controls.can_stop, true);
});

check('istUebergang und uebergangsText stimmen ueberein', () => {
    for (const z of ['starting', 'stopping', 'installing', 'updating']) {
        assert.strictEqual(istUebergang(z), true, z);
        assert.ok(uebergangsText(z), z);
    }
    for (const z of ['online', 'offline', 'error', 'installed']) {
        assert.strictEqual(istUebergang(z), false, z);
        assert.strictEqual(uebergangsText(z), null, z);
    }
});

console.log(`\n${passed} Prüfung(en) bestanden.\n`);
process.exit(process.exitCode || 0);
