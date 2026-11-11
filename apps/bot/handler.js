/**
 * Verteiler für Befehle im Bot: Präfix-Befehle, Slash-Befehle, Kontextmenüs,
 * dazu die Hilfetexte (`getCommandUsage`, `getSlashUsage`).
 *
 * **Eine Datei, im Kern (K334, 2026-11-09).** Bis dahin gab es zwei: die
 * lebende in `plugins/core/bot/handler.js` (Ereignisse des core-Plugins) und
 * eine ältere Kopie hier, aus der nur `help.js` zwei Funktionen holte — ohne
 * den Haken `preInteraction`, mit eigenem Zähler der Abklingzeiten. Die
 * Verteilung der Befehle aller Plugins ist eine Aufgabe des Kerns; das
 * core-Plugin lädt sie von hier, wie Plugins im Dashboard Kern-Helfer laden.
 */
const { ApplicationCommandOptionType, MessageFlags } = require("discord.js");
const { MiscUtils, EmbedUtils } = require("dunebot-sdk/utils");

const cooldownCache = new Map();
const OWNER_IDS = process.env.OWNER_IDS?.split(",").map((id) => id.trim());

/**
 * Eine Präfix-Nachricht in Befehlsname und Argumente zerlegen — die eine
 * Stelle dafür.
 *
 * Bis 2026-11-11 zerlegten messageCreate und handlePrefixCommand je für
 * sich, mit verschiedenen Regeln: messageCreate entfernte den Leerraum nach
 * dem Präfix, der Handler nicht. Bei `!fb help` fand messageCreate „help“,
 * der Handler bekam einen leeren Befehlsnamen und „help“ als erstes Argument.
 * Beim Präfix `!` fiel das nicht auf, weil dort niemand ein Leerzeichen
 * dahinter setzt; mit längeren Präfixen (K372, bis 5 Zeichen) liegt es nahe.
 *
 * @param {string} inhalt Nachrichtentext
 * @param {string} prefix
 * @returns {{invoke: string, args: string[]}|null} null, wenn die Nachricht nicht mit dem Präfix beginnt oder kein Befehlsname folgt
 */
function zerlegePraefixBefehl(inhalt, prefix) {
    if (typeof inhalt !== "string" || !prefix || !inhalt.startsWith(prefix)) return null;
    const teile = inhalt.slice(prefix.length).trim().split(/\s+/);
    const invoke = (teile.shift() || "").toLowerCase();
    if (!invoke) return null;
    return { invoke, args: teile };
}

/**
 * @param {import('discord.js').Message} message
 * @param {import('dunebot-sdk').CommandType} cmd
 * @param {string} prefix
 * @param {{invoke: string, args: string[]}} zerlegt aus zerlegePraefixBefehl
 */
async function handlePrefixCommand(message, cmd, prefix, zerlegt) {

    const { invoke, args } = zerlegt;

    const data = {};
    data.prefix = prefix;
    data.invoke = invoke;

    if (!message.channel.permissionsFor(message.guild.members.me).has("SendMessages")) return;

    // callback validations
    if (cmd.validations) {
        for (const validation of cmd.validations) {
            if (!validation.callback(message)) {
                return message.reply(validation.message);
            }
        }
    }

    // Owner commands
    if (cmd.category === "OWNER" && !OWNER_IDS.includes(message.author.id)) {
        return message.replyT("core:HANDLER.OWNER_ONLY");
    }

    // check user permissions
    if (cmd.userPermissions && cmd.userPermissions?.length > 0) {
        if (!message.channel.permissionsFor(message.member).has(cmd.userPermissions)) {
            return message.replyT("core:HANDLER.USER_PERMISSIONS", {
                permissions: MiscUtils.parsePermissions(cmd.userPermissions),
            });
        }
    }

    // check bot permissions
    if (cmd.botPermissions && cmd.botPermissions.length > 0) {
        if (!message.channel.permissionsFor(message.guild.members.me).has(cmd.botPermissions)) {
            return message.replyT("core:HANDLER.BOT_PERMISSIONS", {
                permissions: MiscUtils.parsePermissions(cmd.botPermissions),
            });
        }
    }

    // minArgs count
    if (cmd.command.minArgsCount > args.length) {
        const usageEmbed = getCommandUsage(message.guild, cmd, prefix, invoke);
        return message.reply({ embeds: [usageEmbed] });
    }

    // cooldown check
    if (cmd.cooldown > 0) {
        const remaining = getRemainingCooldown("cmd", message.author.id, cmd);
        if (remaining > 0) {
            return message.replyT("core:HANDLER.COOLDOWN", {
                time: MiscUtils.timeformat(remaining),
            });
        }
    }

   try {
        const context = {};
        context.message = message;
        context.prefix = prefix;
        context.invoke = invoke;
        context.args = args;
        await cmd.messageRun(context);
    } catch (ex) {
        message.client.logger.error("messageRun", ex);
        message.replyT("core:HANDLER.ERROR");
    } finally {
        if (cmd.cooldown > 0) applyCooldown("cmd", message.author.id, cmd);
    }
}

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {import('dunebot-sdk').CommandType} cmd
 */
async function handleSlashCommand(interaction, cmd) {
    const guild = interaction.guild;

    // callback validations
    if (cmd.validations) {
        for (const validation of cmd.validations) {
            if (!validation.callback(interaction)) {
                return interaction.reply({
                    content: validation.message,
                    flags: MessageFlags.Ephemeral,
                });
            }
        }
    }

    // Owner commands
    if (cmd.category === "OWNER" && !OWNER_IDS.includes(interaction.user.id)) {
        return interaction.reply({
            content: guild.getT("core:HANDLER.OWNER_ONLY"),
            flags: MessageFlags.Ephemeral,
        });
    }

    // user permissions
    if (interaction.member && cmd.userPermissions?.length > 0) {
        if (!interaction.member.permissions.has(cmd.userPermissions)) {
            return interaction.reply({
                content: guild.getT("core:HANDLER.USER_PERMISSIONS", {
                    permissions: MiscUtils.parsePermissions(cmd.userPermissions),
                }),
                flags: MessageFlags.Ephemeral,
            });
        }
    }

    // bot permissions
    if (cmd.botPermissions && cmd.botPermissions.length > 0) {
        if (!interaction.guild.members.me.permissions.has(cmd.botPermissions)) {
            return interaction.reply({
                content: guild.getT("core:HANDLER.BOT_PERMISSIONS", {
                    permissions: MiscUtils.parsePermissions(cmd.botPermissions),
                }),
                flags: MessageFlags.Ephemeral,
            });
        }
    }

    // cooldown check
    if (cmd.cooldown > 0) {
        const remaining = getRemainingCooldown("cmd", interaction.user.id, cmd);
        if (remaining > 0) {
            return interaction.reply({
                content: guild.getT("core:HANDLER.COOLDOWN", {
                    time: MiscUtils.timeformat(remaining),
                }),
                flags: MessageFlags.Ephemeral,
            });
        }
    }

    // Wenn der Command einen preInteraction-Hook hat, diesen VOR dem Defer aufrufen.
    // Gibt er ein { modal } zurück, wird das Modal gezeigt (kein Defer nötig).
    if (typeof cmd.preInteraction === 'function') {
        try {
            const preResult = await cmd.preInteraction({ interaction });
            if (preResult?.modal) {
                await interaction.showModal(preResult.modal);
                if (cmd.cooldown > 0) applyCooldown("cmd", interaction.user.id, cmd);
                return;
            }
        } catch (preErr) {
            interaction.client.logger.error("preInteraction", preErr);
            // Fehler im Hook → normal weiter mit deferReply
        }
    }

    try {
        await interaction.deferReply({
            flags: cmd.slashCommand.ephemeral ? MessageFlags.Ephemeral : 0,
        });
        const context = {};
        context.interaction = interaction;
        await cmd.interactionRun(context);
    } catch (ex) {
        interaction.client.logger.error("interactionRun", ex);
        await interaction.followUpT("core:HANDLER.ERROR");
    } finally {
        if (cmd.cooldown > 0) applyCooldown("cmd", interaction.user.id, cmd);
    }
}

/**
 * Build a usage embed for this command
 * @param {import('discord.js').Guild} guild - guild object
 * @param {import('dunebot-sdk').CommandType} cmd - command object
 * @param {string} prefix - guild bot prefix
 * @param {string} invoke - alias that was used to trigger this command
 * @param {string} [title] - the embed title
 */
function getCommandUsage(guild, cmd, prefix, invoke, title = "Usage") {
    let desc = "";
    if (cmd.command.subcommands && cmd.command.subcommands.length > 0) {
        cmd.command.subcommands.forEach((sub) => {
            desc += `\`${prefix}${invoke || cmd.name} ${sub.trigger}\`\n❯ ${guild.getT(sub.description)}\n\n`;
        });
        if (cmd.cooldown) {
            desc += `**Cooldown:** ${MiscUtils.timeformat(cmd.cooldown)}`;
        }
    } else {
        desc += `\`\`\`css\n${prefix}${invoke || cmd.name} ${cmd.command.usage || ""}\`\`\``;
        if (cmd.description !== "") desc += `\n**Help:** ${guild.getT(cmd.description)}`;
        if (cmd.cooldown) desc += `\n**Cooldown:** ${MiscUtils.timeformat(cmd.cooldown)}`;
    }

    const embed = EmbedUtils.embed({ description: desc });
    if (title) embed.setAuthor({ name: title });
    return embed;
}

/**
 * @param {import('discord.js').Guild} guild - guild object
 * @param {import('dunebot-sdk').CommandType} cmd - command object
 */
function getSlashUsage(guild, cmd) {
    let desc = "";
    if (cmd.slashCommand.options.find((o) => o.type === ApplicationCommandOptionType.Subcommand)) {
        const subCmds = cmd.slashCommand.options.filter(
            (opt) => opt.type === ApplicationCommandOptionType.Subcommand,
        );
        subCmds.forEach((sub) => {
            desc += `\`/${cmd.name} ${sub.name}\`\n❯ ${guild.getT(sub.description)}\n\n`;
        });
    } else {
        desc += `\`/${cmd.name}\`\n\n**Help:** ${guild.getT(cmd.description)}`;
    }

    if (cmd.cooldown) {
        desc += `\n**Cooldown:** ${MiscUtils.timeformat(cmd.cooldown)}`;
    }

    return EmbedUtils.embed({ description: desc });
}

/**
 * @param {import('discord.js').ContextMenuCommandInteraction} interaction
 * @param {import('dunebot-sdk').ContextType} context
 */
async function handleContext(interaction, context) {
    const guild = interaction.guild;

    // check cooldown
    if (context.cooldown) {
        const remaining = getRemainingCooldown("ctx", interaction.user.id, context);
        if (remaining > 0) {
            return interaction.reply({
                content: guild.getT("core:HANDLER.COOLDOWN", {
                    time: MiscUtils.timeformat(remaining),
                }),
                flags: MessageFlags.Ephemeral,
            });
        }
    }

    // check user permissions
    if (interaction.member && context.userPermissions && context.userPermissions?.length > 0) {
        if (!interaction.member.permissions.has(context.userPermissions)) {
            return interaction.reply({
                content: guild.getT("core:HANDLER.USER_PERMISSIONS", {
                    permissions: MiscUtils.parsePermissions(context.userPermissions),
                }),
                flags: MessageFlags.Ephemeral,
            });
        }
    }

    try {
        await interaction.deferReply({ flags: context.ephemeral ? MessageFlags.Ephemeral : 0 });
        await context.run({ interaction });
    } catch (ex) {
        interaction.followUpT("core:HANDLER.ERROR");
        interaction.client.logger.error("contextRun", ex);
    } finally {
        applyCooldown("ctx", interaction.user.id, context);
    }
}

/**
 * @param {string} type
 * @param {string} memberId
 * @param {object} cmd
 */
function applyCooldown(type, memberId, cmd) {
    const key = type + "|" + cmd.name + "|" + memberId;
    cooldownCache.set(key, Date.now());
}

/**
 * @param {string} type
 * @param {string} memberId
 * @param {object} cmd
 */
function getRemainingCooldown(type, memberId, cmd) {
    const key = type + "|" + cmd.name + "|" + memberId;
    if (cooldownCache.has(key)) {
        const remaining = (Date.now() - cooldownCache.get(key)) * 0.001;
        if (remaining > cmd.cooldown) {
            cooldownCache.delete(key);
            return 0;
        }
        return cmd.cooldown - remaining;
    }
    return 0;
}

module.exports = {
    handlePrefixCommand,
    zerlegePraefixBefehl,
    handleSlashCommand,
    getCommandUsage,
    getSlashUsage,
    handleContext,
};
