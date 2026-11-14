'use strict';

/**
 * Greeting - das Willkommensbild über den Kern-Renderer (G-10, 2026-11-14).
 *
 * Seit G-22 (2026-11-14) stellt die Guild das Aussehen nur im Kern-Bereich
 * „Bildkarten“ ein (Verlauf, Hintergrundbild, Akzentfarbe, Text; Vorlage
 * `greeting:willkommen` in `../bildkarten/`, Einstellung in
 * `guild_bildkarten`). Hier bleibt nur, ob das Bild an der
 * Willkommensnachricht hängt (`welcome_image_enabled`). Bis 2026-11-14 standen
 * Hintergrund, Text und Farbe in `greeting_settings`, die Umrechnung hier in
 * `werte()`; die Migration `20261114_210000_willkommensbild_bildkarten` hat
 * sie umgezogen.
 *
 * Bot (Beitritt, `/welcome preview`) nutzt `anhang`, der Bereich „Bildkarten“
 * `stand` (erklärt in package.json unter `bildkarten`).
 *
 * @module greeting/shared/willkommensbild
 */

const { Bildkarte } = require('dunebot-sdk');

const ANLASS = 'greeting:willkommen';

/**
 * Das Bild für ein Mitglied als Anhang, oder null (Fehler steht im Log).
 * @param {import('discord.js').GuildMember} member
 * @param {Object} [logger]
 * @returns {Promise<{name: string, attachment: Buffer}|null>}
 */
async function anhang(member, logger) {
    try {
        const karte = await Bildkarte.zeichneNutzung('greeting', ANLASS, { member }, { guildId: member.guild.id });
        if (karte.hinweise.length) logger?.warn(`[Greeting] Willkommensbild für ${member.user?.tag}: ${karte.hinweise.join('; ')}`);
        return { name: karte.dateiname('welcome'), attachment: karte.puffer };
    } catch (err) {
        logger?.error(`[Greeting] Willkommensbild für ${member.user?.tag} gescheitert:`, err);
        return null;
    }
}

/**
 * Für den Kern-Bereich „Bildkarten“ (G-21): Ist das Bild in dieser Guild an?
 * An heißt: Willkommensnachricht und Bild eingeschaltet. Laufzeitwerte gibt
 * es keine, alles Einstellbare kommt aus der Einstellung der Guild (G-22).
 * @param {string} guildId
 * @returns {Promise<{an: boolean, werte: Object}>}
 */
async function stand(guildId) {
    const { ServiceManager } = require('dunebot-core');
    const zeilen = await ServiceManager.get('dbService').query(
        'SELECT welcome_enabled, welcome_image_enabled FROM greeting_settings WHERE guild_id = ?',
        [guildId]
    );
    const s = zeilen?.[0] || {};
    return { an: Boolean(Number(s.welcome_enabled)) && Boolean(Number(s.welcome_image_enabled)), werte: {} };
}

module.exports = { ANLASS, anhang, stand };
