const { ApplicationCommandOptionType } = require("discord.js");
const { ServiceManager } = require("dunebot-core");

/**
 * @type {import('dunebot-sdk').CommandType}
 */
module.exports = {
    name: "setprefix",
    description: "core:PREFIX.DESCRIPTION",
    userPermissions: ["ManageGuild"],
    command: {
        enabled: true,
        usage: "<new-prefix>",
        minArgsCount: 1,
    },
    slashCommand: {
        enabled: true,
        ephemeral: true,
        options: [
            {
                name: "newprefix",
                description: "core:PREFIX.NEW_PREFIX",
                type: ApplicationCommandOptionType.String,
                required: true,
            },
        ],
    },

    async messageRun({ message, args }) {
        const response = await setNewPrefix(message.guild, message.author, args[0]);
        await message.reply(response);
    },

    async interactionRun({ interaction }) {
        const response = await setNewPrefix(
            interaction.guild,
            interaction.user,
            interaction.options.getString("newprefix"),
        );
        await interaction.followUp(response);
    },
};

/** Das Dashboard schreibt eine Zeile; länger als ein paar Sekunden heisst „nicht erreichbar“. */
const DASHBOARD_FRIST_MS = 10000;

/**
 * Den Präfix über das Dashboard setzen (K372, Betreiber 2026-11-11: „es
 * bleibt erhalten, speichert aber über den Dashboard-Weg“).
 *
 * Der Bot schreibt nichts selbst. Regel (höchstens 5 Zeichen, nicht leer,
 * keine Leerzeichen) und Recht (CORE.SETTINGS.EDIT) gelten dort, wo auch die
 * Seite Einstellungen → Allgemein speichert. Bis 2026-11-11 schrieb dieser
 * Befehl per setConfig mit eigener Grenze von 2 Zeichen.
 *
 * Den neuen Präfix muss der Bot sich nicht merken: messageCreate liest ihn bei
 * jeder Nachricht aus `configs`.
 *
 * @param {import('discord.js').Guild} guild
 * @param {import('discord.js').User} user Auslöser, für die Rechteprüfung
 * @param {string} newPrefix
 * @returns {Promise<string>} Antworttext
 */
async function setNewPrefix(guild, user, newPrefix) {
    const ipcClient = ServiceManager.get("ipcClient");
    const antwort = ipcClient
        ? await ipcClient.sendToDashboard("core:PRAEFIX_SETZEN",
            { guild_id: guild.id, actor_user_id: user.id, praefix: newPrefix }, DASHBOARD_FRIST_MS)
        : { success: false, error: "keine Verbindung zum Dashboard" };

    if (antwort?.success) {
        return guild.getT("core:PREFIX.SUCCESS", { prefix: antwort.data?.praefix ?? newPrefix });
    }
    switch (antwort?.code) {
        case "ZU_LANG":     return guild.getT("core:PREFIX.TOO_LONG", { max: antwort.max });
        case "LEER":        return guild.getT("core:PREFIX.EMPTY");
        case "LEERZEICHEN": return guild.getT("core:PREFIX.WHITESPACE");
        default:            return guild.getT("core:PREFIX.FAILED", { grund: antwort?.error || "keine Antwort" });
    }
}
