const { EmbedBuilder } = require("discord.js");

/**
 * Shared Placeholder-Parser für alle Plugins
 * Ersetzt Platzhalter wie {member:name}, {guild:name}, etc.
 */

/**
 * Ersetzt Platzhalter in einem String
 * @param {string} content - Text mit Platzhaltern
 * @param {Object} context - Kontext-Daten
 * @param {import('discord.js').GuildMember} [context.member] - Guild-Member
 * @param {import('discord.js').Guild} [context.guild] - Guild
 * @param {import('discord.js').User} [context.user] - User (falls kein Member)
 * @param {Object} [context.extra] - Zusätzliche key-value Platzhalter
 * @returns {string}
 */
function parsePlaceholders(content, context = {}) {
    if (!content || typeof content !== 'string') return content || "";

    const { member, guild, user, extra = {} } = context;

    let result = content.replaceAll(/\\n/g, "\n");

    // Guild/Server Platzhalter
    const guildObj = guild || member?.guild;
    if (guildObj) {
        result = result
            .replaceAll(/{server}/g, guildObj.name)
            .replaceAll(/{guild:name}/g, guildObj.name)
            .replaceAll(/{guild\.name}/g, guildObj.name)
            .replaceAll(/{count}/g, String(guildObj.memberCount))
            .replaceAll(/{guild:memberCount}/g, String(guildObj.memberCount))
            .replaceAll(/{guild\.memberCount}/g, String(guildObj.memberCount));
    }

    // Member Platzhalter
    if (member) {
        const userObj = member.user || user;
        result = result
            .replaceAll(/{member:nick}/g, member.displayName)
            .replaceAll(/{member\.nick}/g, member.displayName)
            .replaceAll(/{member:name}/g, userObj.username)
            .replaceAll(/{member\.name}/g, userObj.username)
            .replaceAll(/{member:dis}/g, userObj.discriminator || '0')
            .replaceAll(/{member\.dis}/g, userObj.discriminator || '0')
            .replaceAll(/{member:tag}/g, userObj.tag)
            .replaceAll(/{member\.tag}/g, userObj.tag)
            .replaceAll(/{member:mention}/g, member.toString())
            .replaceAll(/{member\.mention}/g, member.toString())
            .replaceAll(/{member:avatar}/g, member.displayAvatarURL())
            .replaceAll(/{member\.avatar}/g, member.displayAvatarURL())
            .replaceAll(/{member:id}/g, member.id)
            .replaceAll(/{member\.id}/g, member.id);
    } else if (user) {
        // Fallback: User ohne Member (z.B. gebannte User)
        result = result
            .replaceAll(/{member:nick}/g, user.username)
            .replaceAll(/{member\.nick}/g, user.username)
            .replaceAll(/{member:name}/g, user.username)
            .replaceAll(/{member\.name}/g, user.username)
            .replaceAll(/{member:dis}/g, user.discriminator || '0')
            .replaceAll(/{member\.dis}/g, user.discriminator || '0')
            .replaceAll(/{member:tag}/g, user.tag)
            .replaceAll(/{member\.tag}/g, user.tag)
            .replaceAll(/{member:mention}/g, `<@${user.id}>`)
            .replaceAll(/{member\.mention}/g, `<@${user.id}>`)
            .replaceAll(/{member:avatar}/g, user.displayAvatarURL())
            .replaceAll(/{member\.avatar}/g, user.displayAvatarURL())
            .replaceAll(/{member:id}/g, user.id)
            .replaceAll(/{member\.id}/g, user.id);
    }

    // Extra Platzhalter (plugin-spezifisch)
    for (const [key, value] of Object.entries(extra)) {
        const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        result = result.replaceAll(new RegExp(`\\{${escaped}\\}`, 'g'), String(value ?? ''));
    }

    return result;
}

/**
 * Baut einen EmbedBuilder mit Platzhalter-Ersetzung aus einem Embed-Config-Objekt
 * @param {Object} embedConfig - Embed-Konfiguration (title, description, color, etc.)
 * @param {Object} context - Kontext für parsePlaceholders()
 * @returns {{ embed: EmbedBuilder, hasEmbed: boolean }}
 */
function buildEmbed(embedConfig, context = {}) {
    const embed = new EmbedBuilder();
    let hasEmbed = false;
    const cfg = embedConfig || {};

    if (cfg.title) {
        embed.setTitle(parsePlaceholders(cfg.title, context));
        hasEmbed = true;
    }
    if (cfg.description) {
        embed.setDescription(parsePlaceholders(cfg.description, context));
        hasEmbed = true;
    }
    if (cfg.color) {
        embed.setColor(cfg.color);
    }
    if (cfg.thumbnail) {
        const member = context.member;
        const user = context.user;
        if (typeof cfg.thumbnail === 'string') {
            embed.setThumbnail(parsePlaceholders(cfg.thumbnail, context));
        } else if (member) {
            embed.setThumbnail(member.user.displayAvatarURL());
        } else if (user) {
            embed.setThumbnail(user.displayAvatarURL());
        }
        hasEmbed = true;
    }
    if (cfg.footer?.text) {
        const parsed = parsePlaceholders(cfg.footer.text, context);
        if (parsed) {
            embed.setFooter({ text: parsed, iconURL: cfg.footer.iconURL || null });
            hasEmbed = true;
        }
    }
    if (cfg.image) {
        embed.setImage(parsePlaceholders(cfg.image, context));
        hasEmbed = true;
    }
    if (cfg.author?.name) {
        embed.setAuthor({
            name: parsePlaceholders(cfg.author.name, context),
            iconURL: cfg.author.iconURL || null,
        });
        hasEmbed = true;
    }
    if (cfg.fields && Array.isArray(cfg.fields) && cfg.fields.length > 0) {
        for (const field of cfg.fields) {
            embed.addFields({
                name: parsePlaceholders(field.name, context),
                value: parsePlaceholders(field.value, context),
                inline: field.inline,
            });
        }
        hasEmbed = true;
    }
    if (cfg.timestamp) {
        embed.setTimestamp();
        hasEmbed = true;
    }

    return { embed, hasEmbed };
}

module.exports = { parsePlaceholders, buildEmbed };
