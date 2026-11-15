const SpieleUpdates = require("../helpers/SpieleUpdates");
const Messprobe = require("../helpers/Messprobe");

/**
 * Kern-Event: messageCreate
 * Eine Ankündigung im Kanal mit den Spiele-Updates wird ein Blogbeitrag.
 * Alles andere prüft `SpieleUpdates` selbst und lässt es liegen.
 * Die Messprobe G-18 zählt die Nachricht (nur Anzahlen).
 *
 * @param {import('discord.js').Message} message
 */
module.exports = (message) => {
    Messprobe.nachricht(message);
    return SpieleUpdates.beiNachricht(message);
};
