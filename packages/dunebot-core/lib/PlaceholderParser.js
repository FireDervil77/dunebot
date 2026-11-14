const { EmbedBuilder } = require("discord.js");

/**
 * Shared Placeholder-Parser für alle Plugins
 * Ersetzt Platzhalter wie {member:name}, {guild:name}, etc.
 *
 * # Register (G-08, 2026-11-14)
 *
 * `PLATZHALTER` nennt jeden Platzhalter, den `parsePlaceholders` selbst
 * ersetzt, mit Gruppe und Bedeutung (Schlüssel in den Kern-Texten). Das ist
 * ein **Vertrag** mit der Ersetzung darunter: Steht ein Name nur in der Liste,
 * erscheint er wörtlich in Discord; steht er nur in der Ersetzung, kennt ihn
 * kein Editor. `scripts/check-vorlagen.js` prüft beide Richtungen.
 *
 * Platzhalter eines Plugins (`{inviter:name}` bei greeting) erklärt das Plugin
 * in seiner package.json unter `vorlagen.platzhalter` und reicht die Werte als
 * `extra` herein. Bis 2026-11-14 hatte greeting dafür eine Kopie dieser Datei
 * in `bot/utils.js`.
 */

/**
 * Die Platzhalter des Kerns. `gruppe` ist `member` oder `guild`; `alias` nennt
 * den gleichwertigen Hauptnamen. Die Bedeutung steht unter
 * `core:VORLAGEN.PH.<schluessel>`.
 */
const PLATZHALTER = Object.freeze([
    { name: 'member:name',      gruppe: 'member', schluessel: 'MEMBER_NAME' },
    { name: 'member:nick',      gruppe: 'member', schluessel: 'MEMBER_NICK' },
    { name: 'member:mention',   gruppe: 'member', schluessel: 'MEMBER_MENTION' },
    { name: 'member:tag',       gruppe: 'member', schluessel: 'MEMBER_TAG' },
    { name: 'member:dis',       gruppe: 'member', schluessel: 'MEMBER_DIS' },
    { name: 'member:avatar',    gruppe: 'member', schluessel: 'MEMBER_AVATAR' },
    { name: 'member:id',        gruppe: 'member', schluessel: 'MEMBER_ID' },
    { name: 'member:joinedAt',  gruppe: 'member', schluessel: 'MEMBER_JOINED' },
    { name: 'member:createdAt', gruppe: 'member', schluessel: 'MEMBER_CREATED' },
    { name: 'guild:name',       gruppe: 'guild',  schluessel: 'GUILD_NAME' },
    { name: 'server',           gruppe: 'guild',  schluessel: 'GUILD_NAME', alias: 'guild:name' },
    { name: 'guild:memberCount', gruppe: 'guild', schluessel: 'GUILD_COUNT' },
    { name: 'count',            gruppe: 'guild',  schluessel: 'GUILD_COUNT', alias: 'guild:memberCount' },
    { name: 'guild:id',         gruppe: 'guild',  schluessel: 'GUILD_ID' },
    { name: 'guild:icon',       gruppe: 'guild',  schluessel: 'GUILD_ICON' },
    { name: 'guild:boostCount', gruppe: 'guild',  schluessel: 'GUILD_BOOSTS' },
    { name: 'guild:boostLevel', gruppe: 'guild',  schluessel: 'GUILD_BOOST_LEVEL' },
]);

/**
 * Alle Namen in geschweiften Klammern, die in einem Text stehen, ohne die
 * Klammern und ohne Doppelte. Der Editor zeigt damit unbekannte Platzhalter
 * an, bevor jemand speichert.
 * @param {string} text
 * @returns {string[]}
 */
function platzhalterIn(text) {
    if (!text || typeof text !== 'string') return [];
    const aus = new Set();
    for (const m of text.matchAll(/\{([A-Za-z][A-Za-z0-9_]*(?::[A-Za-z][A-Za-z0-9_]*)?)\}/g)) aus.add(m[1]);
    return [...aus];
}

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
            .replaceAll(/{count}/g, String(guildObj.memberCount))
            .replaceAll(/{guild:memberCount}/g, String(guildObj.memberCount))
            .replaceAll(/{guild:id}/g, guildObj.id)
            .replaceAll(/{guild:icon}/g, guildObj.iconURL?.() || '')
            .replaceAll(/{guild:boostCount}/g, String(guildObj.premiumSubscriptionCount || 0))
            .replaceAll(/{guild:boostLevel}/g, String(guildObj.premiumTier || 0));
    }

    // Member Platzhalter
    if (member) {
        const userObj = member.user || user;
        result = result
            .replaceAll(/{member:nick}/g, member.displayName)
            .replaceAll(/{member:name}/g, userObj.username)
            .replaceAll(/{member:dis}/g, userObj.discriminator || '0')
            .replaceAll(/{member:tag}/g, userObj.tag)
            .replaceAll(/{member:mention}/g, member.toString())
            .replaceAll(/{member:avatar}/g, member.displayAvatarURL())
            .replaceAll(/{member:id}/g, member.id)
            .replaceAll(/{member:joinedAt}/g, member.joinedAt ? member.joinedAt.toLocaleDateString('de-DE') : '')
            .replaceAll(/{member:createdAt}/g, userObj.createdAt ? userObj.createdAt.toLocaleDateString('de-DE') : '');
    } else if (user) {
        // Fallback: User ohne Member (z.B. gebannte User)
        result = result
            .replaceAll(/{member:nick}/g, user.username)
            .replaceAll(/{member:name}/g, user.username)
            .replaceAll(/{member:dis}/g, user.discriminator || '0')
            .replaceAll(/{member:tag}/g, user.tag)
            .replaceAll(/{member:mention}/g, `<@${user.id}>`)
            .replaceAll(/{member:avatar}/g, user.displayAvatarURL())
            .replaceAll(/{member:id}/g, user.id)
            .replaceAll(/{member:joinedAt}/g, '')
            .replaceAll(/{member:createdAt}/g, user.createdAt ? user.createdAt.toLocaleDateString('de-DE') : '');
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

module.exports = { parsePlaceholders, buildEmbed, PLATZHALTER, platzhalterIn };
