const { ServiceManager } = require("dunebot-core");
const { willkommenSenden } = require("../helpers/Willkommen");

/**
 * Kern-Event: guildCreate
 * Wird ausgeführt wenn der Bot zu einer neuen Guild hinzugefügt wird.
 *
 * Registrierung und Konfiguration macht der GuildManager — dort wird auch die
 * Sprache aus der Discord-Einstellung der Guild übernommen. Danach begrüßt der
 * Bot: per DM an den Einlader und in einem Kanal, in dem er schreiben darf.
 *
 * Die Begrüßung läuft **nach** `registerGuild()`, weil sie dessen Ergebnis
 * braucht: `guild.locale` steht erst dann fest.
 *
 * @param {import('discord.js').Guild} guild
 */
module.exports = async (guild) => {
    const Logger = ServiceManager.get("Logger");
    const guildManager = ServiceManager.get("guildManager");

    try {
        await guildManager.registerGuild(guild);

        // Slash-Commands für die neue Guild registrieren (verzögert)
        guild.client.wait(5000).then(async () => {
            await guild.client.commandManager.registerInteractions(guild.id);
            Logger.success(`Interactions in ${guild.name} registriert`);
        });
    } catch (error) {
        Logger.error(`Fehler im guildCreate-Event für Guild ${guild.id}:`, error);
    }

    // Begrüßung getrennt abgesichert: Scheitert sie, ist die Guild trotzdem
    // registriert — und umgekehrt soll ein Fehler oben die Begrüßung nicht
    // verschlucken.
    //
    // Die Wartezeit ist für das Audit-Log: Discord trägt den BotAdd-Eintrag
    // nicht immer in derselben Sekunde ein, in der das Event ankommt.
    try {
        await guild.client.wait(3000);
        const ergebnis = await willkommenSenden(guild);
        Logger.info(
            `Begrüßung für ${guild.name} (${guild.id}): ` +
            `DM ${ergebnis.dm}, Kanal ${ergebnis.kanal}`
        );
    } catch (error) {
        Logger.error(`Begrüßung für Guild ${guild.id} fehlgeschlagen:`, error);
    }
};
