'use strict';

/**
 * Wer eine Bildkarte sehen und einstellen darf (Weg A, Betreiber 2026-11-15).
 *
 * Eine Karte gehört zu einer Nachricht ihres Plugins (Level-up, Willkommen).
 * Wer die Nachricht bearbeiten darf, darf auch die Karte darin sehen und
 * einstellen: „der Bereich Bildkarten muss mindestens den gleichen Satz an
 * Rechten haben wie der andere Bereich“. Das Recht einer Nutzung steht in
 * `Bildkarte.nutzungen()` (`recht`, Vorgabe `vorlagen.recht` des Plugins).
 *
 *   - `CORE.BILDKARTEN.VIEW` / `.EDIT`: alle Karten der Guild (Gestalter-Rolle)
 *   - das Recht der Nutzung: nur diese Karte, sehen und einstellen
 *
 * Eine Regel für den Bereich (bildkarten.router), die Nachrichten-Vorschau
 * (vorlagen.router) und den Menüpunkt (KernNavigation). Der Schutz der
 * Kontroll-Guild (`requireBesitzerInKontrollGuild`) bleibt davon unberührt.
 *
 * Wächter: scripts/check-bildkarten.js (13l)
 *
 * @module helpers/BildkartenRecht
 */

const { ServiceManager } = require('dunebot-core');
const { Bildkarte } = require('dunebot-sdk');

const BEREICH = Object.freeze({ sehen: 'CORE.BILDKARTEN.VIEW', aendern: 'CORE.BILDKARTEN.EDIT' });

async function hat(userId, guildId, recht) {
    if (!userId || !recht) return false;
    return Boolean(await ServiceManager.get('permissionManager').hasPermission(String(userId), String(guildId), recht));
}

/**
 * Darf der Nutzer diese Nutzung sehen oder einstellen?
 * @param {string} userId
 * @param {string} guildId
 * @param {{recht: string|null}} nutzung aus `Bildkarte.nutzungen()`
 * @param {'sehen'|'aendern'} [art]
 * @returns {Promise<boolean>}
 */
async function darf(userId, guildId, nutzung, art = 'sehen') {
    if (!BEREICH[art]) throw new Error(`BildkartenRecht.darf: unbekannte Art ${art}`);
    if (await hat(userId, guildId, BEREICH[art])) return true;
    return Boolean(nutzung?.recht) && hat(userId, guildId, nutzung.recht);
}

/** Darf der Nutzer alle Karten sehen (auch Schablonen, die niemand nutzt)? */
function siehtAlle(userId, guildId) {
    return hat(userId, guildId, BEREICH.sehen);
}

/** Jedes Recht, das irgendeine Karte öffnet: das des Bereichs zuerst. */
function alleRechte() {
    const r = new Set([BEREICH.sehen]);
    for (const liste of Bildkarte.nutzungen().karten.values()) {
        for (const n of liste) if (n.recht) r.add(n.recht);
    }
    return [...r];
}

/** Hat der Nutzer irgendein Recht, das eine Karte öffnet? */
async function bereichOffen(userId, guildId) {
    if (!userId) return false;
    return Boolean(await ServiceManager.get('permissionManager').hasAnyPermission(String(userId), String(guildId), alleRechte()));
}

/**
 * Menüpunkt „Bildkarten“: sichtbar mit einem der Rechte, durch `|` getrennt
 * (NavigationManager liest das als „eines davon“).
 */
function menuRecht() {
    return alleRechte().join('|');
}

module.exports = { BEREICH, darf, siehtAlle, alleRechte, bereichOffen, menuRecht };
