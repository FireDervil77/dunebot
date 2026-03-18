const { MiscUtils, Logger, EmbedUtils } = require("dunebot-sdk/utils");
const { antispamCache, MESSAGE_SPAM_THRESHOLD, shouldModerate } = require("../utils");
const { AutoModSettings, AutoModStrikes, AutoModLogs, AutoModEscalation, AutoModExemptions, AutoModRegexRules, AutoModCompoundRules } = require("../../shared/models");
const { loadKeywordLists } = require("../keywordLoader");

// Moderation Integration - Optional dependency
let addModAction;
try {
    const ModUtils = require("../../../moderation/bot/utils");
    addModAction = ModUtils.addModAction;
} catch (ex) {
    Logger.warn("[AutoMod] Moderation plugin not found, using fallback actions");
    addModAction = async (issuer, target, reason, action) => {
        switch (action) {
            case "TIMEOUT":
                await target.timeout(24 * 60 * 60 * 1000, reason);
                break;
            case "KICK":
                await target.kick(reason);
                break;
            case "BAN":
                await target.ban({ reason });
                break;
        }
    };
}

/**
 * This function saves stats for a new message
 * @param {import("discord.js").Message} message
 */
module.exports = async (message) => {
    if (message.isCommand) return;
    if (message.system || message.webhookId) return;
    if (message.author.bot && message.author.id === message.guild.members.me.id) return;

    const settings = await AutoModSettings.getSettings(message.guild.id);

    if (settings.whitelisted_channels.includes(message.channelId)) return;

    // Exemption-Check: Channels und Rollen
    try {
        const [channelExempt, memberExempt] = await Promise.all([
            AutoModExemptions.isExempt(message.guild.id, 'channel', message.channelId),
            AutoModExemptions.isMemberExempt(message.guild.id, message.member.roles.cache.map(r => r.id))
        ]);
        if (channelExempt || memberExempt) return;
    } catch {
        // Bei DB-Fehler weitermachen mit normalen Checks
    }

    if (!settings.debug_mode && !shouldModerate(message)) return;

    const { channel, member, guild, content, author, mentions } = message;
    const logChannel = settings.log_channel
        ? channel.guild.channels.cache.get(settings.log_channel)
        : null;

    let shouldDelete = false;
    let strikesTotal = 0;

    const fields = [];

    // Max mentions
    if (mentions.members.size > settings.max_mentions) {
        fields.push({
            name: guild.getT("automod:HANDLER.FIELD_MENTIONS"),
            value: `${mentions.members.size}/${settings.max_mentions}`,
            inline: true,
        });
        // strikesTotal += mentions.members.size - settings.max_mentions;
        strikesTotal += 1;
    }

    // Maxrole mentions
    if (mentions.roles.size > settings.max_role_mentions) {
        fields.push({
            name: guild.getT("automod:HANDLER.FIELD_ROLE_MENTIONS"),
            value: `${mentions.roles.size}/${settings.max_role_mentions}`,
            inline: true,
        });
        // strikesTotal += mentions.roles.size - settings.max_role_mentions;
        strikesTotal += 1;
    }

    if (settings.anti_massmention) {
        // check everyone mention
        if (mentions.everyone) {
            fields.push({
                name: guild.getT("automod:HANDLER.FIELD_EVERYONE"),
                value: "✓",
                inline: true,
            });
            strikesTotal += 1;
        }

        // check user/role mentions
        if (mentions.users.size + mentions.roles.size > settings.anti_massmention_threshold) {
            fields.push({
                name: guild.getT("automod:HANDLER.FIELD_ROLE_USER_MENTIONS"),
                value: `${mentions.users.size + mentions.roles.size}/${settings.anti_massmention_threshold}`,
                inline: true,
            });
            // strikesTotal += mentions.users.size + mentions.roles.size - settings.anti_massmention_threshold;
            strikesTotal += 1;
        }
    }

    // Max Lines
    if (settings.max_lines > 0) {
        const count = content.split("\n").length;
        if (count > settings.max_lines) {
            fields.push({
                name: guild.getT("automod:HANDLER.FIELD_MAX_LINES"),
                value: `${count}/${settings.max_lines}`,
                inline: true,
            });
            shouldDelete = true;
            // strikesTotal += Math.ceil((count - settings.max_lines) / settings.max_lines);
            strikesTotal += 1;
        }
    }

    // Anti Attachments
    if (settings.anti_attachments) {
        if (message.attachments.size > 0) {
            fields.push({
                name: guild.getT("automod:HANDLER.FIELD_ATTACH"),
                value: "✓",
                inline: true,
            });
            shouldDelete = true;
            strikesTotal += 1;
        }
    }

    // Anti links
    if (settings.anti_links) {
        if (MiscUtils.containsLink(content)) {
            fields.push({
                name: guild.getT("automod:HANDLER.FIELD_LINKS"),
                value: "✓",
                inline: true,
            });
            shouldDelete = true;
            strikesTotal += 1;
        }
    }

    // Anti Spam
    if (!settings.anti_links && settings.anti_spam) {
        if (MiscUtils.containsLink(content)) {
            const key = author.id + "|" + message.guildId;
            if (antispamCache.has(key)) {
                let antispamInfo = antispamCache.get(key);
                if (
                    antispamInfo.channelId !== message.channelId &&
                    antispamInfo.content === content &&
                    Date.now() - antispamInfo.timestamp < MESSAGE_SPAM_THRESHOLD
                ) {
                    fields.push({
                        name: guild.getT("automod:HANDLER.FIELD_ANTISPAM"),
                        value: "✓",
                        inline: true,
                    });
                    shouldDelete = true;
                    strikesTotal += 1;
                }
            } else {
                let antispamInfo = {
                    channelId: message.channelId,
                    content,
                    timestamp: Date.now(),
                };
                antispamCache.set(key, antispamInfo);
            }
        }
    }

    // Anti Invites
    if (!settings.anti_links && settings.anti_invites) {
        if (MiscUtils.containsDiscordInvite(content)) {
            fields.push({
                name: guild.getT("automod:HANDLER.FIELD_INVITES"),
                value: "✓",
                inline: true,
            });
            shouldDelete = true;
            strikesTotal += 1;
        }
    }

    // Keyword-Listen Check
    if (settings.active_keyword_lists) {
        let activeListIds;
        try {
            activeListIds = typeof settings.active_keyword_lists === 'string'
                ? JSON.parse(settings.active_keyword_lists)
                : settings.active_keyword_lists;
        } catch {
            activeListIds = [];
        }

        if (Array.isArray(activeListIds) && activeListIds.length > 0) {
            const allLists = loadKeywordLists();
            const lowerContent = content.toLowerCase();

            for (const listId of activeListIds) {
                const list = allLists.get(listId);
                if (!list) continue;

                const matched = list.keywords.find(kw => lowerContent.includes(kw.toLowerCase()));
                if (matched) {
                    fields.push({
                        name: guild.getT("automod:HANDLER.FIELD_KEYWORD", { list: list.name }),
                        value: `||${matched}||`,
                        inline: true,
                    });
                    shouldDelete = true;
                    strikesTotal += 1;
                    break;
                }
            }
        }
    }

    // Regex-Regeln Check
    try {
        const matchedRule = await AutoModRegexRules.testMessage(guild.id, content);
        if (matchedRule) {
            fields.push({
                name: guild.getT("automod:HANDLER.FIELD_REGEX", { rule: matchedRule.name }),
                value: "✓",
                inline: true,
            });

            if (matchedRule.action === 'DELETE' || matchedRule.action === 'STRIKE') {
                shouldDelete = true;
            }
            if (matchedRule.action === 'STRIKE' || matchedRule.action === 'WARN') {
                strikesTotal += 1;
            }
        }
    } catch (err) {
        Logger.error('[AutoMod] Regex-Check Fehler:', err);
    }

    // Compound Rules Check
    try {
        const matchedCompound = await AutoModCompoundRules.checkMessage(message);
        if (matchedCompound) {
            fields.push({
                name: guild.getT("automod:HANDLER.FIELD_COMPOUND", { rule: matchedCompound.name }),
                value: "✓",
                inline: true,
            });

            if (['DELETE', 'STRIKE', 'TIMEOUT', 'KICK', 'BAN'].includes(matchedCompound.action)) {
                shouldDelete = true;
            }
            if (['STRIKE', 'WARN'].includes(matchedCompound.action)) {
                strikesTotal += 1;
            }
            // Direkte Aktionen (TIMEOUT/KICK/BAN) werden nach dem Strike-System ausgeführt
            if (['TIMEOUT', 'KICK', 'BAN'].includes(matchedCompound.action)) {
                const duration = matchedCompound.action === 'TIMEOUT' && matchedCompound.duration
                    ? matchedCompound.duration * 60 * 1000
                    : undefined;
                try {
                    await addModAction(
                        guild.members.me,
                        member,
                        guild.getT("automod:HANDLER.AUTO_ACTION_REASON") + ` [${matchedCompound.name}]`,
                        matchedCompound.action,
                        duration,
                    );
                } catch {}
            }
        }
    } catch (err) {
        Logger.error('[AutoMod] Compound-Rules-Check Fehler:', err);
    }

    // delete message if deletable
    if (shouldDelete && message.deletable) {
        message
            .delete()
            .then(() => channel.send(guild.getT("automod:HANDLER.AUTO_DELETED"), 5))
            .catch(() => {});
    }

    if (strikesTotal > 0) {
        // add strikes to member
        let dbStrikes = await AutoModStrikes.getStrikes(guild.id, author.id);
        dbStrikes += strikesTotal;

        // log to db
        const reason = fields.map((field) => field.name + ": " + field.value).join("\n");
        AutoModLogs.addLog(guild.id, author.id, content, reason, strikesTotal).catch(() => {});

        // send automod log
        if (logChannel) {
            const logEmbed = EmbedUtils.embed()
                .setAuthor({ name: guild.getT("automod:HANDLER.AUTO_LOG_TITLE") })
                .setThumbnail(author.displayAvatarURL())

                .addFields(fields)
                .setDescription(
                    `**${guild.getT("automod:HANDLER.AUTO_LOG_CHANNEL")}:** ${channel.toString()}\n**${guild.getT(
                        "automod:HANDLER.AUTO_LOG_CONTENT",
                    )}:**\n${content}`,
                )
                .setFooter({
                    text: `By ${author.username} | ${author.id}`,
                    iconURL: author.avatarURL(),
                });

            if (settings.embed_colors.log) {
                logEmbed.setColor(settings.embed_colors.log);
            }

            logChannel.send({ embeds: [logEmbed] });
        }

        // DM strike details
        const strikeEmbed = EmbedUtils.embed()
            .setThumbnail(guild.iconURL())
            .setAuthor({ name: guild.getT("automod:HANDLER.AUTO_DM_TITLE") })
            .addFields(fields)
            .setDescription(
                guild.getT("automod:HANDLER.AUTO_DM_DESC", {
                    guild: guild.name,
                    strikes: strikesTotal,
                    total: dbStrikes,
                    max: settings.max_strikes,
                }),
            );

        if (settings.embed_colors.dm) {
            strikeEmbed.setColor(settings.embed_colors.dm);
        }

        author.send({ embeds: [strikeEmbed] }).catch(() => {});

        // check if max strikes are received - Escalation System
        const escalationLevel = await AutoModEscalation.getActionForStrikes(guild.id, dbStrikes);

        if (escalationLevel) {
            // Eskalationsstufe gefunden -> Aktion ausführen
            dbStrikes = 0;

            const actionToExecute = escalationLevel.action;
            const duration = escalationLevel.duration;

            if (actionToExecute === 'TIMEOUT' && duration) {
                await addModAction(
                    guild.members.me,
                    member,
                    guild.getT("automod:HANDLER.AUTO_ACTION_REASON"),
                    actionToExecute,
                    duration * 60 * 1000,
                ).catch(() => {});
            } else {
                await addModAction(
                    guild.members.me,
                    member,
                    guild.getT("automod:HANDLER.AUTO_ACTION_REASON"),
                    actionToExecute,
                ).catch(() => {});
            }
        } else if (dbStrikes >= settings.max_strikes) {
            // Fallback: Kein Escalation Config -> altes System
            dbStrikes = 0;

            await addModAction(
                guild.members.me,
                member,
                guild.getT("automod:HANDLER.AUTO_ACTION_REASON"),
                settings.action,
            ).catch(() => {});
        }

        await AutoModStrikes.updateStrikes(guild.id, author.id, dbStrikes);
    }
};
