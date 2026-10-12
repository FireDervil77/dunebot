const SpieleUpdates = require("../helpers/SpieleUpdates");

/**
 * Kern-Event: messageUpdate
 * Ändert der Hersteller seine Ankündigung, zieht der Blogbeitrag nach.
 *
 * @param {import('discord.js').Message} alt
 * @param {import('discord.js').Message} neu
 */
module.exports = (alt, neu) => SpieleUpdates.beiNachricht(neu);
