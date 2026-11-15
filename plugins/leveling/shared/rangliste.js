'use strict';

/**
 * Leveling: Rangliste als Bild (LV-2c, K382, 2026-11-15).
 *
 * Bildkarte `leveling:rangliste` (`plugins/leveling/bildkarten/rangliste.json`):
 * Kopf mit Banner und Logo aus der Gestaltung der Guild (G-09), darunter
 * zehn Plätze mit Avatar, Name, Level und XP, unten „Dein Platz“. Das
 * Hintergrundbild der Liste stellt die Guild im Kern-Bereich „Bildkarten“
 * ein (G-22). Gezeichnet wird über `Bildkarte.zeichneNutzung` im Bot
 * (`/leaderboard`, wenn `level_einstellungen.rangliste_form = 'bild'`).
 *
 * Hier stehen nur die Laufzeitwerte; die Zeilen formatiert der Aufrufer
 * (Sprache, Zahlen). Eine Zeile ohne Eintrag bleibt leer.
 *
 * @module leveling/shared/rangliste
 */

const KARTE = 'leveling:rangliste';
const ZEILEN = 10;

/**
 * Laufzeitwerte der Karte.
 *
 * @param {{titel: string, untertitel: string, seite: string, unten: string,
 *          eintraege: Array<{platz: number|string, name: string, level: string, xp: string, avatar: string}>}} a
 * @returns {Object<string, string>}
 */
function werte({ titel, untertitel, seite, unten, eintraege = [] }) {
    const w = { titel: String(titel || ''), untertitel: String(untertitel || ''), seite: String(seite || ''), unten: String(unten || '') };
    for (let i = 0; i < ZEILEN; i++) {
        const e = eintraege[i];
        const n = i + 1;
        w[`z${n}_platz`] = e ? String(e.platz) : '';
        w[`z${n}_name`] = e ? String(e.name || '') : '';
        w[`z${n}_level`] = e ? String(e.level || '') : '';
        w[`z${n}_xp`] = e ? String(e.xp || '') : '';
        w[`z${n}_avatar`] = e ? String(e.avatar || '') : '';
    }
    return w;
}

/**
 * Für den Kern-Bereich „Bildkarten“ (G-21): an, wo Leveling an ist.
 * Keine Laufzeitwerte, die Seite zeigt die Beispielwerte der Vorlage.
 *
 * @param {string} guildId
 * @returns {Promise<{an: boolean, werte: null}>}
 */
async function stand(guildId) {
    return require('./rangkarte').stand(guildId);
}

module.exports = { KARTE, ZEILEN, werte, stand };
