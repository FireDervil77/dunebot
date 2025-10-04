const emojiInfo = require("../shared/emoji");

/**
 * @type {import('dunebot-sdk').CommandType}
 */
module.exports = {
    name: "emojiinfo",
    description: "information:INFO.SUB_EMOJI_DESC",
    botPermissions: ["EmbedLinks"],
    command: {
        enabled: true,
        usage: "<emoji>",
        minArgsCount: 1,
    },
    slashCommand: {
        enabled: false
    },

    async messageRun({ message, args }) {
        const emoji = args[0];
        const response = emojiInfo(message.guild, emoji);
        await message.reply(response);
    },
};
