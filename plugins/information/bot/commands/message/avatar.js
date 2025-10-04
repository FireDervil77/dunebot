const avatarInfo = require("../shared/avatar");

/**
 * @type {import('dunebot-sdk').CommandType}
 */
module.exports = {
    name: "avatar",
    description: "information:INFO.SUB_AVATAR_DESC",
    botPermissions: ["EmbedLinks"],
    command: {
        enabled: true,
        usage: "[@member|id]",
    },
    slashCommand: {
        enabled: false
    },

    async messageRun({ message, args }) {
        const target = (await message.guild.resolveMember(args[0])) || message.member;
        const response = avatarInfo(message.guild, target.user);
        await message.reply(response);
    },
};
