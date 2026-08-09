/**
 * Discord — Einstieg in den Bereich
 *
 * Das Plugin hat bewusst keine eigene Übersichtsseite: es gäbe nichts darauf
 * zu zeigen, was die beiden Unterseiten nicht schon zeigen. Der Hauptpunkt
 * führt deshalb direkt auf die Rollen.
 *
 * @module discord/routes/guild
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const { requirePermission } = require('../../../../apps/dashboard/middlewares/permissions.middleware');

// GET / → weiter zu den Rollen
router.get('/', requirePermission('DISCORD.VIEW'), (req, res) => {
    return res.redirect(`/guild/${res.locals.guildId}/plugins/discord/roles`);
});

module.exports = router;
