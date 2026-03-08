const { ApplicationCommandOptionType } = require("discord.js");
const { Logger } = require("dunebot-sdk/utils");
const { ServiceManager } = require("dunebot-core");

let langChoices = [];
try {
    const { languagesMeta } = require("dunebot-core");
    langChoices = languagesMeta.map((lang) => ({ name: lang.name, value: lang.name }));
} catch (error) {
    Logger.debug("Missing languages-meta.json", error);
}

/**
 * @type {import('dunebot-sdk').CommandType}
 */
module.exports = {
    name: "setlang",
    description: "core:LANG.DESCRIPTION",
    userPermissions: ["ManageGuild"],
    command: {
        enabled: true,
        usage: "<new-lang>",
        minArgsCount: 1,
    },
    slashCommand: {
        enabled: true,
        ephemeral: true,
        options: [
            {
                name: "newlang",
                description: "core:LANG.NEW_LANG",
                type: ApplicationCommandOptionType.String,
                choices: langChoices,
                required: true,
            },
        ],
    },

    async messageRun({ message, args }) {
        const newLang = args[0];
        const response = await setNewLang(message.guild, newLang);
        await message.reply(response);
    },

    async interactionRun({ interaction }) {
        const response = await setNewLang(
            interaction.guild,
            interaction.options.getString("newlang"),
        );
        await interaction.followUp(response);
    },
};

/**
 * @param {import('discord.js').Guild} guild
 * @param {string} newLang
 * @returns {Promise<{success: boolean, content: string}>}
 */
async function setNewLang(guild, newLang) {
    const dbService = ServiceManager.get("dbService");
    
    // NEU: Config-System nutzen
    await dbService.setConfig(
        "core",
        "LOCALE",
        newLang,
        "shared",
        guild.id,
        false
    );

    const t = guild.getT?.bind(guild);
    return {
        success: true,
        content: t ? t("core:LANG.SUCCESS", { lang: newLang }) 
                  : `Erfolg! Die Sprache wurde auf ${newLang} gesetzt`
    };
}