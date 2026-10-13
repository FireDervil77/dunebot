'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Das Bild eines Plugins — eine Quelle für alle Stellen, die eines zeigen.
 *
 * Bis zum 2026-10-13 ordneten drei Stellen die Bilder unabhängig voneinander
 * von Hand zu: die Kachel „Aktive Plugins" (feste Liste auf vier runde
 * Motive), das Plugin-Karussell der Startseite (feste Liste von
 * Font-Awesome-Symbolen, sechs von vierzehn Plugins fehlten) und die
 * Plugin-Seite (suchte `dashboard/public/images/icon.png` — kein Plugin hatte
 * eine, und die Adresse dazu lieferte nie etwas aus).
 *
 * Jetzt bringt jedes Plugin sein Bild selbst mit:
 *
 *   plugins/<name>/dashboard/assets/images/icon.png       farbig, freigestellt
 *   plugins/<name>/dashboard/assets/images/icon-rund.png  runde Plakette
 *
 * Ausgeliefert wird der Ordner unter `/assets/plugins/<name>/…` (app.js) —
 * aber nur, wenn das Plugin `publicAssets: true` setzt. Fehlt die Datei, gibt
 * es das FireBot-Emblem bzw. den runden Avatar.
 */

const DATEI = {
    farbe: 'icon.png',
    rund: 'icon-rund.png'
};

const ERSATZ = {
    farbe: '/themes/default/assets/images/kit/logo/web/emblem-256.png',
    rund: '/themes/default/assets/images/kit/logo/web/avatar-256.png'
};

/** Ob es die Datei gibt, ändert sich im Betrieb nicht. */
const _gefunden = new Map();

/**
 * @param {string} pluginsDir - Ordner, in dem die Plugins liegen
 * @param {string} name - Ordnername des Plugins
 * @param {'farbe'|'rund'} [fassung='farbe']
 * @returns {string} Adresse des Bildes
 */
function pluginBild(pluginsDir, name, fassung = 'farbe') {
    const art = DATEI[fassung] ? fassung : 'farbe';
    if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/i.test(name)) {
        return ERSATZ[art];
    }

    const schluessel = `${name}/${art}`;
    if (!_gefunden.has(schluessel)) {
        const datei = path.join(pluginsDir, name, 'dashboard', 'assets', 'images', DATEI[art]);
        _gefunden.set(schluessel, fs.existsSync(datei));
    }

    return _gefunden.get(schluessel)
        ? `/assets/plugins/${name}/images/${DATEI[art]}`
        : ERSATZ[art];
}

module.exports = { pluginBild, DATEI, ERSATZ };
