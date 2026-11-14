'use strict';

/**
 * Greeting - das Willkommensbild über den Kern-Renderer (G-10, 2026-11-14).
 *
 * Bis 2026-11-14 zeichnete `bot/welcomeImage.js` mit eigenem Canvas-Code. Das
 * Bild sieht gleich aus (Vorlage `greeting:willkommen` in `../bildkarten/`),
 * bis auf die Schrift (Theme statt `sans-serif`). Neu: Der Text darf
 * Platzhalter enthalten. Vorher stand „{member:nick}“ wörtlich im Bild.
 *
 * Bot (Beitritt, `/welcome preview`) und Dashboard (Vorschau) nutzen diese Datei.
 *
 * @module greeting/shared/willkommensbild
 */

const { Bildkarte } = require('dunebot-sdk');

const ANLASS = 'greeting:willkommen';

/** Die sieben Hintergründe, wie bis 2026-11-14 in welcomeImage.js. */
const HINTERGRUENDE = Object.freeze({
    default: ['#1a1a2e', '#16213e', '#0f3460'],
    dark: ['#0d0d0d', '#1a1a1a', '#2d2d2d'],
    blue: ['#0f0c29', '#302b63', '#24243e'],
    purple: ['#12011e', '#3c1053', '#6a0572'],
    green: ['#0a1a0a', '#1b4332', '#2d6a4f'],
    sunset: ['#2d1b69', '#6b2fa0', '#e94560'],
    ocean: ['#0a192f', '#172a45', '#1c4a6e'],
});

const VORGABE_TEXT = 'Welcome to the server!';
const VORGABE_FARBE = '#5865f2';
const HEX = /^#[0-9a-f]{6}$/i;

/**
 * Werte der Vorlage aus den Spalten von `greeting_settings`.
 * @param {{welcome_image_bg?: string, welcome_image_text?: string, welcome_image_color?: string}} s
 */
function werte(s = {}) {
    const bg = HINTERGRUENDE[s.welcome_image_bg] || HINTERGRUENDE.default;
    return {
        hintergrund1: bg[0],
        hintergrund2: bg[1],
        hintergrund3: bg[2],
        akzent: HEX.test(String(s.welcome_image_color || '')) ? s.welcome_image_color : VORGABE_FARBE,
        text: String(s.welcome_image_text || '').trim() || VORGABE_TEXT,
    };
}

/**
 * Das Bild für ein Mitglied als Anhang, oder null (Fehler steht im Log).
 * @param {import('discord.js').GuildMember} member
 * @param {Object} settings Zeile aus `greeting_settings`
 * @param {Object} [logger]
 * @returns {Promise<{name: string, attachment: Buffer}|null>}
 */
async function anhang(member, settings, logger) {
    try {
        const karte = await Bildkarte.zeichne(ANLASS, { member, werte: werte(settings) }, { guildId: member.guild.id, plugin: 'greeting' });
        if (karte.hinweise.length) logger?.warn(`[Greeting] Willkommensbild für ${member.user?.tag}: ${karte.hinweise.join('; ')}`);
        return { name: karte.dateiname('welcome'), attachment: karte.puffer };
    } catch (err) {
        logger?.error(`[Greeting] Willkommensbild für ${member.user?.tag} gescheitert:`, err);
        return null;
    }
}

/**
 * Für den Kern-Bereich „Bildkarten“ (G-21, erklärt in package.json unter
 * `bildkarten`): Ist das Bild in dieser Guild an, und mit welchen Werten
 * zeichnet der Bot es? An heißt: Willkommensnachricht und Bild eingeschaltet.
 * Ohne Zeile in `greeting_settings` ist es aus, gezeichnet mit der Vorgabe.
 * @param {string} guildId
 * @returns {Promise<{an: boolean, werte: Object}>}
 */
async function stand(guildId) {
    const { ServiceManager } = require('dunebot-core');
    const zeilen = await ServiceManager.get('dbService').query(
        'SELECT welcome_enabled, welcome_image_enabled, welcome_image_bg, welcome_image_text, welcome_image_color FROM greeting_settings WHERE guild_id = ?',
        [guildId]
    );
    const s = zeilen?.[0] || {};
    return { an: Boolean(Number(s.welcome_enabled)) && Boolean(Number(s.welcome_image_enabled)), werte: werte(s) };
}

module.exports = { ANLASS, HINTERGRUENDE, VORGABE_TEXT, VORGABE_FARBE, werte, anhang, stand };
