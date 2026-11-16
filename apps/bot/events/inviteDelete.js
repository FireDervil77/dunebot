'use strict';

const Einladungen = require('dunebot-sdk/lib/Einladungen');

/**
 * Kern-Event: inviteDelete — Einladung aus dem Vergleichsstand (G-16).
 * Aufgebrauchte bleiben bis zum nächsten Vergleich (siehe `Einladungen.geloescht`).
 *
 * @param {import('discord.js').Invite} einladung
 */
module.exports = (einladung) => {
    Einladungen.geloescht(einladung);
};
