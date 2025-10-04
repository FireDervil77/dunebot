const botstats = require("../shared/botstats");

/**
 * @type {import('dunebot-sdk').CommandType}
 */
module.exports = {
    name: "botstats",
    description: "information:BOT.SUB_STATS_DESC",
    botPermissions: ["EmbedLinks"],
    cooldown: 5,
    command: {
        enabled: true,
        aliases: ["botstat", "botinfo"],
    },
    slashCommand: {
        enabled: false
    },

    async messageRun({ message }) {
        const response = await botstats(message);
        await message.reply(response);
    },
};
