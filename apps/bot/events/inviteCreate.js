'use strict';

const Einladungen = require('dunebot-sdk/lib/Einladungen');

/**
 * Kern-Event: inviteCreate — neue Einladung in den Vergleichsstand (G-16).
 * Ohne das ginge eine Einladung mit Höchstzahl 1 verloren: Discord löscht sie
 * nach dem Beitritt, bevor der Bot ihren Zähler je gesehen hat.
 *
 * @param {import('discord.js').Invite} einladung
 */
module.exports = (einladung) => {
    Einladungen.angelegt(einladung);
};
