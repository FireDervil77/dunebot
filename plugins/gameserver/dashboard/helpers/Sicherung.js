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

module.exports = { FRIST_MS };
