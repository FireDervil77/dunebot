'use strict';

/**
 * Wie lange eine Sicherung oder Wiederherstellung dauern darf.
 *
 * Bis zum 2026-11-02 standen hier 5 Minuten. Das reichte für 2 GB, aber nicht für
 * Server 231: Die Sicherung von 7 Days lief im Daemon weiter und schrieb über 12 GB,
 * das Panel gab nach 5 Minuten auf und meldete „fehlgeschlagen". Das Archiv lag
 * trotzdem auf der Platte, und niemand wusste davon.
 *
 * Eine Stunde trägt das Archiv eines großen Servers. Sie liegt über allem, was bisher
 * gemessen wurde, und bleibt eine Frist: Ein hängender Daemon soll die Zeile nicht
 * für immer auf „läuft" lassen.
 */
const FRIST_MS = 60 * 60 * 1000;

/**
 * Arbeitet gerade jemand an dieser Sicherung? Dann darf sie niemand löschen: Der
 * Daemon schreibt oder liest das Archiv noch, und das Panel kennt keinen Abbruch.
 *
 * Nach der Frist gilt `running` nicht mehr: Ein Neustart des Dashboards lässt die
 * Zeile stehen, und eine Leiche muss sich löschen lassen. `restoring` hat kein eigenes
 * Datum, `created_at` nennt dort nur den Tag der Sicherung.
 *
 * @param {{status: string, created_at?: Date|string}} zeile
 * @returns {boolean}
 */
function laeuft(zeile, jetzt = Date.now()) {
    if (zeile?.status === 'restoring') return true;
    if (zeile?.status !== 'running' && zeile?.status !== 'pending') return false;
    return jetzt - new Date(zeile.created_at).getTime() < FRIST_MS;
}

module.exports = { FRIST_MS, laeuft };
