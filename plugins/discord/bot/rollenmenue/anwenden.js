'use strict';

const { Rollen } = require('dunebot-sdk');

/**
 * Die berechnete Änderung tatsächlich auf ein Mitglied anwenden.
 *
 * Seit G-07 (2026-11-14) über den Kern (`Rollen`, Besitzer
 * `discord:rollenmenue`, `bezug` = Menü-ID):
 *
 * - Hinzufügen ist `Rollen.vergib`, Abwählen `Rollen.gibAb` (das Mitglied
 *   bedient es selbst, F-G12 Punkt 2): ohne Eintrag erlaubt, also auch für
 *   Rollen aus der Zeit vor G-07. Hält ein anderes System die Rolle (z. B.
 *   Leveling), bleibt sie, und das Mitglied erfährt warum (`gehalten`).
 * - Die vier Gründe, aus denen Discord stumm Nein sagt (Recht fehlt, Rolle
 *   über der Bot-Rolle, von einer Integration verwaltet, Rolle weg), prüft
 *   der Kern (`Rollen.pruefe`, vorher `pruefeRolle` hier). Die Aufrufer
 *   sagen sie dem Nutzer (`rueckmeldung.js`).
 *
 * Nebenbei behoben: Hinzufügen und Entfernen liefen hier als
 * `member.roles.add([…])` und gleich danach `remove([…])`. Beides schickt in
 * discord.js die ganze Rollenliste aus dem Zwischenspeicher, und den macht
 * erst das Gateway-Ereignis aktuell. Das zweite Senden konnte die eben
 * vergebene Rolle wieder wegnehmen (Modus `eindeutig`, Auswahl ändern). Der
 * Kern setzt jede Rolle einzeln (siehe dunebot-sdk/lib/Rollen.js).
 *
 * @module discord/bot/rollenmenue/anwenden
 */

/** Gründe, aus denen eine Rolle nicht gesetzt werden konnte (aus dem Kern). */
const GRUND = Rollen.GRUND;

/**
 * @typedef {Object} Ergebnis
 * @property {string[]} vergeben  Rollen-IDs, die vergeben wurden
 * @property {string[]} entzogen  Rollen-IDs, die entzogen wurden
 * @property {Array<{rolle: string, name: string|null, grund: string}>} blockiert
 * @property {Array<{rolle: string, name: string|null, von: string[]}>} gehalten
 *           abgewählt, bleibt aber, weil ein anderes System sie hält
 */

/**
 * Änderung anwenden.
 *
 * @param {import('discord.js').GuildMember} member
 * @param {{hinzufuegen: string[], entfernen: string[]}} aenderung
 * @param {string} [grundText] Erscheint im Discord-Audit-Log (nach dem Besitzer)
 * @param {string|number} [menuId] Bezug im Buch
 * @returns {Promise<Ergebnis>}
 */
async function wendeAn(member, aenderung, grundText = 'Rollenmenü', menuId = null) {
    const auftrag = { mitglied: member, besitzer: 'discord:rollenmenue', bezug: menuId == null ? null : `menue:${menuId}`, grund: grundText };
    const dazu = await Rollen.vergib({ ...auftrag, rollen: aenderung.hinzufuegen || [] });
    const weg = await Rollen.gibAb({ ...auftrag, rollen: aenderung.entfernen || [] });
    return {
        vergeben: dazu.vergeben,
        entzogen: weg.entzogen,
        blockiert: [...dazu.blockiert, ...weg.blockiert],
        gehalten: weg.gehalten
    };
}

module.exports = { GRUND, wendeAn };
