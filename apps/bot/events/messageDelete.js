const SpieleUpdates = require("../helpers/SpieleUpdates");
const Messprobe = require("../helpers/Messprobe");

/**
 * Kern-Event: messageDelete
 * Wird eine Ankündigung aus dem Kanal gelöscht, verschwindet ihr Blogbeitrag.
 * Die Messprobe G-18 zählt die Löschung.
 *
 * @param {import('discord.js').Message} message
 */
module.exports = (message) => {
    Messprobe.geloescht(message?.guildId);
    return SpieleUpdates.beiLoeschung(message);
};
