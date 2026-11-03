'use strict';

/**
 * Die Adresse des Busbahnhofs, an dem sich die Daemons melden (FireBus Etappe 4).
 *
 * Eine Stelle für alle, die sie brauchen: die Anmeldeantwort (`absicht.bus_adresse`,
 * der Daemon zieht dann selbst um, ab Fassung 1.1.12) und die daemon.yaml-Vorlage für
 * neue Maschinen. Bis 2026-11-03 stand sie nur in jeder daemon.yaml und musste beim
 * Wechsel von 9340 auf 9341 auf jeder Maschine von Hand geändert werden.
 *
 * `FIREBUS_ADRESSE` setzt sie ausdrücklich, etwa für einen zweiten Bahnhof. Fehlt die
 * Einstellung, gilt der Rechner aus `DASHBOARD_BASE_URL` mit dem Port des Bahnhofs.
 * Das ist die Adresse, die 54 und 55 schon benutzen: Ohne Einstellung zieht niemand um.
 */

/** Der Port, auf dem der Bahnhof lauscht (cmd/bahnhof, `-adresse :9341`). */
const BAHNHOF_PORT = 9341;

/** @returns {string|null} wss://… oder null, wenn sich nichts ableiten lässt */
function busAdresse(env = process.env) {
    const fest = String(env.FIREBUS_ADRESSE || '').trim();
    if (fest) return fest;
    try {
        return `wss://${new URL(env.DASHBOARD_BASE_URL).hostname}:${BAHNHOF_PORT}`;
    } catch {
        return null;
    }
}

module.exports = { busAdresse, BAHNHOF_PORT };
