const { MiscUtils } = require("dunebot-sdk/utils");

/**
 * @type {import('dunebot-sdk').CommandType}
 */
module.exports = {
    name: "uptime",
    description: "information:BOT.SUB_UPTIME_DESC",
    botPermissions: ["EmbedLinks"],
    command: {
        enabled: true,
    },
    slashCommand: {
        enabled: false
    },

    async messageRun({ message }) {
        await message.replyT("information:BOT.UPTIME", {
            time: MiscUtils.timeformat(process.uptime()),
        });
    },
};
