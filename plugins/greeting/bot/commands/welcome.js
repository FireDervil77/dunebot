const { ApplicationCommandOptionType, ChannelType } = require("discord.js");
const Befehl = require("../vorlageBefehl");

/** Die Vorlage dieses Befehls: `greeting:willkommen` (G-08, siehe ../vorlageBefehl.js). */
const ART = "welcome";

/**
 * @type {import('dunebot-sdk').CommandType}
 */
module.exports = {
    name: "welcome",
    description: "greeting:WELCOME.DESCRIPTION",
    userPermissions: ["ManageGuild"],
    command: {
        enabled: true,
        minArgsCount: 1,
        subcommands: [
            {
                trigger: "status <on|off>",
                description: "greeting:WELCOME.SUB_STATUS",
            },
            {
                trigger: "channel <#channel>",
                description: "greeting:WELCOME.SUB_CHANNEL",
            },
            {
                trigger: "preview",
                description: "greeting:WELCOME.SUB_PREVIEW",
            },
            {
                trigger: "desc <text>",
                description: "greeting:WELCOME.SUB_DESC",
            },
            {
                trigger: "thumbnail <ON|OFF>",
                description: "greeting:WELCOME.SUB_THUMBNAIL",
            },
            {
                trigger: "color <hexcolor>",
                description: "greeting:WELCOME.SUB_COLOR",
            },
            {
                trigger: "footer <text>",
                description: "greeting:WELCOME.SUB_FOOTER",
            },
            {
                trigger: "image <url>",
                description: "greeting:WELCOME.SUB_IMAGE",
            },
        ],
    },
    slashCommand: {
        enabled: true,
        ephemeral: true,
        options: [
            {
                name: "status",
                description: "greeting:WELCOME.SUB_STATUS",
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    {
                        name: "status",
                        description: "greeting:WELCOME.SUB_STATUS_STATUS",
                        required: true,
                        type: ApplicationCommandOptionType.String,
                        choices: [
                            {
                                name: "ON",
                                value: "ON",
                            },
                            {
                                name: "OFF",
                                value: "OFF",
                            },
                        ],
                    },
                ],
            },
            {
                name: "preview",
                description: "greeting:WELCOME.SUB_PREVIEW",
                type: ApplicationCommandOptionType.Subcommand,
            },
            {
                name: "message",
                description: "greeting:WELCOME.SUB_MSG",
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    {
                        name: "channel",
                        description: "greeting:WELCOME.SUB_MSG_CHANNEL",
                        type: ApplicationCommandOptionType.Channel,
                        channelTypes: [ChannelType.GuildText],
                        required: true,
                    },
                    {
                        name: "description",
                        description: "greeting:WELCOME.SUB_MSG_DESC",
                        type: ApplicationCommandOptionType.String,
                        required: true,
                    },
                    {
                        name: "status",
                        description: "greeting:WELCOME.SUB_MSG_THUMBNAIL",
                        type: ApplicationCommandOptionType.String,
                        required: true,
                        choices: [
                            {
                                name: "ON",
                                value: "ON",
                            },
                            {
                                name: "OFF",
                                value: "OFF",
                            },
                        ],
                    },
                    {
                        name: "hex-code",
                        description: "greeting:WELCOME.SUB_MSG_COLOR",
                        type: ApplicationCommandOptionType.String,
                        required: false,
                    },
                    {
                        name: "footer",
                        description: "greeting:WELCOME.SUB_MSG_FOOTER",
                        type: ApplicationCommandOptionType.String,
                        required: false,
                    },
                    {
                        name: "url",
                        description: "greeting:WELCOME.SUB_MSG_IMAGE",
                        type: ApplicationCommandOptionType.String,
                        required: false,
                    },
                ],
            },
        ],
    },

    async messageRun({ message, args }) {
        const type = args[0].toLowerCase();
        const { guild } = message;
        let response;

        if (type === "preview") {
            response = await Befehl.vorschau(ART, message.member, guild);
        } else if (type === "status") {
            const status = args[1]?.toUpperCase();
            if (!status || !["ON", "OFF"].includes(status)) return message.replyT("greeting:WELCOME.INVALID_THUMBNAIL");
            response = await Befehl.setzeStatus(ART, status, guild);
        } else if (type === "channel") {
            response = await Befehl.setzeKanal(ART, message.mentions.channels.first(), guild);
        } else if (type === "desc") {
            if (args.length < 2) return message.replyT("greeting:WELCOME.INVALID_CONTENT");
            response = await Befehl.setzeFelder(ART, { beschreibung: args.slice(1).join(" ") }, guild);
        } else if (type === "thumbnail") {
            const status = args[1]?.toUpperCase();
            if (!status || !["ON", "OFF"].includes(status)) return message.replyT("greeting:WELCOME.INVALID_THUMBNAIL");
            response = await Befehl.setzeFelder(ART, { vorschaubild: status === "ON" ? "{member:avatar}" : "" }, guild);
        } else if (type === "color") {
            response = await Befehl.setzeFelder(ART, { farbe: args[1] || "" }, guild);
        } else if (type === "footer") {
            if (args.length < 2) return message.replyT("greeting:WELCOME.INVALID_CONTENT");
            response = await Befehl.setzeFelder(ART, { fusszeile: args.slice(1).join(" ") }, guild);
        } else if (type === "image") {
            if (!args[1]) return message.replyT("greeting:WELCOME.INVALID_IMAGE");
            response = await Befehl.setzeFelder(ART, { bild: args[1] }, guild);
        } else {
            response = guild.getT("INVALID_SUBCOMMAND", { sub: type });
        }
        return message.reply(response);
    },

    async interactionRun({ interaction }) {
        const sub = interaction.options.getSubcommand();
        let response;
        switch (sub) {
            case "preview":
                response = await Befehl.vorschau(ART, interaction.member, interaction.guild);
                break;
            case "status":
                response = await Befehl.setzeStatus(ART, interaction.options.getString("status"), interaction.guild);
                break;
            case "message":
                response = await Befehl.setzeNachricht(ART, interaction);
                break;
            default:
                response = interaction.guild.getT("INVALID_SUBCOMMAND", { sub });
        }
        return interaction.followUp(response);
    },
};
