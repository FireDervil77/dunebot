#!/usr/bin/env node
/**
 * Zeigt die Einstellungskarte, was gespeichert ist?
 *
 * ── Warum das eine eigene Pruefung braucht (2026-09-12) ─────────────────────
 *
 * Die Werte eines Servers stehen seit dem 2026-08-23 in `gameservers.paket_werte`
 * und seit dem Egg-Schnitt (2026-09-10) NUR noch dort. Die Detailseite waehlte
 * ihre Spalten aber einzeln aus — und `paket_werte` war nicht dabei. Ergebnis:
 * Die Karte sagte bei JEDEM Feld „kein Wert hinterlegt", obwohl Name, Kennwort
 * und Weltname in der Datenbank standen. Am Server 188 aufgefallen, dem
 * Betreiber, nicht einem Test.
 *
 * **Der Helfer war die ganze Zeit in Ordnung.** Kaputt war die Abfrage davor —
 * deshalb prueft dieser Waechter beides: dass der Helfer aus `paket_werte`
 * liest UND dass die Route die Spalte ueberhaupt laedt.
 *
 *   node scripts/check-einstellungskarte.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ServiceManager } = require('dunebot-core');

const still = () => {};
if (!ServiceManager.has('Logger')) {
    ServiceManager.register('Logger', { debug: still, info: still, warn: still, error: still, success: still });
}

const WURZEL = path.join(__dirname, '..');
const { baueUebersicht } = require(path.join(WURZEL, 'plugins/gameserver/dashboard/helpers/Serverseite'));

let bestanden = 0;
const pruefe = (name, fn) => {
    try { fn(); console.log(`  ✓ ${name}`); bestanden++; }
    catch (fehler) { console.error(`  ✗ ${name}\n    ${fehler.message}`); process.exitCode = 1; }
};

/** Kommentare weg — sonst zaehlt eine Begruendung als Verdrahtung. */
function ohneKommentare(text) {
    return text
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .map(z => z.replace(/(^|[^:])\/\/.*$/, '$1').replace(/^\s*--.*$/, ''))
        .join('\n');
}

const PAKET = {
    identity: { slug: 'valheim', name: 'Valheim' },
    settings: [
        { key: 'name', type: 'text', role: 'player', default: 'My Server' },
        { key: 'world_name', type: 'text', role: 'player', default: 'Dedicated', risk: 'progress' },
        { key: 'password', type: 'password', role: 'player', default: '' },
        { key: 'max_players', type: 'number', role: 'expert', default: 10 },
    ],
};

console.log('\n▸ Die Werte auf der Serverseite');

pruefe('Ein gespeicherter Wert steht in der Karte', () => {
    const server = {
        id: 188, name: 'Bude', status: 'offline', ports: '{}',
        paket_werte: JSON.stringify({ name: 'Fires Bude', world_name: 'BoomTown', password: 'x' }),
    };
    const felder = baueUebersicht(server, PAKET, { sicherungen: [] }).einstellungen.sichtbar;
    const nachSchluessel = Object.fromEntries(felder.map(f => [f.schluessel, f]));

    assert.strictEqual(nachSchluessel.name.wert, 'Fires Bude');
    assert.strictEqual(nachSchluessel.world_name.wert, 'BoomTown');
    assert.strictEqual(nachSchluessel.password.wert, 'x');
});

pruefe('Gespeichert wird unter dem Schluessel des Pakets', () => {
    const server = { id: 188, ports: '{}', paket_werte: JSON.stringify({ name: 'x' }) };
    const felder = baueUebersicht(server, PAKET, { sicherungen: [] }).einstellungen.sichtbar;
    for (const f of felder) {
        assert.strictEqual(f.variable, f.schluessel,
            `${f.schluessel} wuerde unter "${f.variable}" gespeichert — das liest der Startweg nicht`);
        assert.strictEqual(f.aenderbar, true, `${f.schluessel} ist nicht aenderbar`);
    }
});

pruefe('Eine Einstellung OHNE gespeicherten Wert erfindet keinen', () => {
    // Die Vorgabe des Pakets einzusetzen waere die teure Luege: Bei `world_name`
    // heisst sie „Dedicated", und der laufende Server spielt „BoomTown".
    const server = { id: 188, ports: '{}', paket_werte: JSON.stringify({ name: 'x' }) };
    const felder = baueUebersicht(server, PAKET, { sicherungen: [] }).einstellungen.sichtbar;
    const welt = felder.find(f => f.schluessel === 'world_name');
    assert.strictEqual(welt.wert, undefined, 'die Paketvorgabe wurde eingesetzt');
});

console.log('\n▸ Und die Route laedt die Spalte auch');

pruefe('Die Detailseite waehlt gs.paket_werte aus', () => {
    const quelle = ohneKommentare(
        fs.readFileSync(path.join(WURZEL, 'plugins/gameserver/dashboard/routes/servers.js'), 'utf8'));

    const start = quelle.indexOf("router.get('/:serverId', requirePermission('GAMESERVER.VIEW')");
    assert.ok(start > 0, 'die Detailroute wurde nicht gefunden — heisst sie noch so?');
    const ende = quelle.indexOf('baueUebersicht(', start);
    assert.ok(ende > start, 'die Detailroute baut keine Uebersichtskarte mehr');

    const abschnitt = quelle.slice(start, ende);
    assert.ok(/gs\.paket_werte/.test(abschnitt),
        'die Abfrage der Detailseite laedt paket_werte nicht — die Karte zeigt dann '
        + '"kein Wert hinterlegt", obwohl alles gespeichert ist');
});

pruefe('Ein Paket OHNE Einstellungen reisst die Seite nicht (Hytale, Server 206)', () => {
    // Am 2026-10-01 kam das erste Paket ohne `settings` aus der Werkbank — die
    // Übersicht las `gruppen.forEach` und die Serverseite stand auf 500.
    const ohne = { identity: { slug: 'hytale', name: 'Hytale' } };
    for (const hoehe of ['einfach', 'fachlich']) {
        const e = baueUebersicht({ id: 1, ansicht: hoehe, paket_werte: '{}' }, ohne, { sicherungen: [] }).einstellungen;
        assert.ok(Array.isArray(e.gruppen), `gruppen fehlt (${hoehe})`);
        assert.ok(Array.isArray(e.sichtbar), `sichtbar fehlt (${hoehe})`);
        assert.strictEqual(e.ohnePaket, false);
    }
    const vorlage = ohneKommentare(fs.readFileSync(path.join(WURZEL,
        'plugins/gameserver/dashboard/views/guild/partials/server-detail-uebersicht.ejs'), 'utf8'));
    assert.match(vorlage, /keine Einstellungen an/, 'die Karte sagt nicht, dass es keine gibt');
});

console.log(bestanden === 5
    ? '\n✅ Die Karte zeigt, was wirklich gespeichert ist\n'
    : `\n(${bestanden} von 5 bestanden)\n`);
