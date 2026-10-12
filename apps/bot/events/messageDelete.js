const SpieleUpdates = require("../helpers/SpieleUpdates");

/**
 * Kern-Event: messageDelete
 * Wird eine Ankündigung aus dem Kanal gelöscht, verschwindet ihr Blogbeitrag.
 *
 * @param {import('discord.js').Message} message
 */
module.exports = (message) => SpieleUpdates.beiLoeschung(message);
