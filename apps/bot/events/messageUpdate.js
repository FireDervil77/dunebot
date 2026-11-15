const SpieleUpdates = require("../helpers/SpieleUpdates");
const Messprobe = require("../helpers/Messprobe");

/**
 * Kern-Event: messageUpdate
 * Ändert der Hersteller seine Ankündigung, zieht der Blogbeitrag nach.
 * Die Messprobe G-18 zählt echte Bearbeitungen.
 *
 * @param {import('discord.js').Message} alt
 * @param {import('discord.js').Message} neu
 */
module.exports = (alt, neu) => {
    Messprobe.bearbeitet(alt, neu);
    return SpieleUpdates.beiNachricht(neu);
};
