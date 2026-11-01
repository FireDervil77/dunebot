'use strict';

/**
 * FireBus: der Fahrplan (docs/nachrichtendienst/konzept.md, Etappe 0, 2026-11-01).
 *
 * Eine Tabelle sagt je Nachrichtenname, wie sie fährt. Der Daemon bettet eine
 * Kopie derselben Datei ein (`pkg/firebus/fahrplan.json`); `scripts/check-fahrplan.js`
 * vergleicht beide und den Code beider Seiten mit der Tabelle.
 *
 * Bisher zählt nur die Zählung mit. Linie und Verlust wirken erst ab Etappe 3.
 */
const fahrplan = require('./fahrplan.json');

const NACH_NAME = new Map(fahrplan.zeilen.map(z => [z.name, z]));

module.exports = {
    fassung: fahrplan.fassung,
    linien: fahrplan.linien,
    zeilen: fahrplan.zeilen,
    zeile: (name) => NACH_NAME.get(name) || null,
    kennt: (name) => NACH_NAME.has(name),
};
