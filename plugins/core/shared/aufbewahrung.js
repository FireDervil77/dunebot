'use strict';

/**
 * Verdichter des Kerns für die Aufbewahrung (G-05, G-20, K382).
 *
 * Eine Frist mit `"verdichten": true` in der package.json löscht nicht,
 * sondern ruft hier die Funktion gleichen Namens. Vertrag in
 * `apps/dashboard/helpers/Aufbewahrung.js` (`verdichten`).
 *
 *   fortschritt-buchungen  Buchungen älter als die Frist werden zu
 *                          Monatssummen je Mitglied und Kennung; der Stand
 *                          bleibt gleich (`Fortschritt.verdichte`).
 */

exports['fortschritt-buchungen'] = (a) => require('dunebot-sdk').Fortschritt.verdichte(a);
