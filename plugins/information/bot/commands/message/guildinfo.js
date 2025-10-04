const guildInfo = require("../shared/guild");

/**
 * @type {import('dunebot-sdk').CommandType}
 */
module.exports = {
    name: "guildinfo",
    description: "information:INFO.SUB_GUILD_DESC",
    botPermissions: ["EmbedLinks"],
    cooldown: 5,
    command: {
        enabled: true,
        aliases: ["serverinfo"],
    },
    slashCommand: {
        enabled: false
    },

    async messageRun({ message }) {
        const response = await guildInfo(message.guild);
        await message.reply(response);
    },
};
