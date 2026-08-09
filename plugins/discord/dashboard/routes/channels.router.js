/**
 * Discord — Kanäle
 *
 * Umzug am 2026-08-09 aus `apps/dashboard/routes/guild/settings.router.js`.
 *
 * **Diese Seite kann nur lesen.** Sie hieß im Kern „Channel-Verwaltung", hatte
 * aber nie eine Schreibroute — der Titel versprach etwas, das nie gebaut wurde.
 * Sie heißt deshalb jetzt „Kanalübersicht". Das Anlegen und Bearbeiten von
 * Kanälen ist ein eigener Punkt (Paket 3 der Bauliste) und wird bewusst nicht
 * nebenbei im Umzug mitgebaut.
 *
 * @module discord/routes/channels
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const { requirePermission } = require('../../../../apps/dashboard/middlewares/permissions.middleware');
const { renderView, fragBot, renderFehler } = require('./_shared');

// GET / → Kanalübersicht
router.get('/', requirePermission('DISCORD.CHANNELS.VIEW'), async (req, res) => {
    const guildId = res.locals.guildId;

    try {
        const antwort = await fragBot('dashboard:GET_GUILD_CHANNELS_DETAILED', { guildId });

        await renderView(res, 'guild/discord-channels', {
            title: 'Kanalübersicht',
            activeMenu: `/guild/${guildId}/plugins/discord/channels`,
            guildId,
            channels: antwort?.channels || [],
            categories: antwort?.categories || [],
            botHasManageChannels: antwort?.botHasManageChannels || false,
            channelTypeIcons: antwort?.channelTypeIcons || {}
        });
    } catch (error) {
        return renderFehler(res, error, 'Kanäle konnten nicht geladen werden');
    }
});

module.exports = router;
