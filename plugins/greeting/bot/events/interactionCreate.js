const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { ServiceManager, parsePlaceholders } = require('dunebot-core');

// Simple math captcha cache: Map<`${guildId}-${userId}`, { answer: number, expires: number }>
const captchaCache = new Map();

/**
 * Handles greeting:VERIFY button interactions
 * @param {import('discord.js').ButtonInteraction} interaction
 */
module.exports = async (interaction) => {
    if (!interaction.isButton()) return;
    if (!interaction.customId.startsWith('greeting:VERIFY')) return;

    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const { guild, member } = interaction;

    try {
        const rows = await dbService.query(
            'SELECT * FROM greeting_settings WHERE guild_id = ? AND verification_enabled = 1',
            [guild.id]
        );
        const settings = rows?.[0];
        if (!settings) {
            return interaction.reply({ content: 'Verification is not enabled.', ephemeral: true });
        }

        const verifiedRoleId = settings.verification_role_id;
        const unverifiedRoleId = settings.verification_remove_role_id;

        // ===== STATUS CHECK BUTTON =====
        if (interaction.customId === 'greeting:VERIFY_STATUS') {
            const isVerified = verifiedRoleId && member.roles.cache.has(verifiedRoleId);
            const statusEmbed = new EmbedBuilder()
                .setColor(isVerified ? 0x57F287 : 0xED4245)
                .setTitle(isVerified ? '✅ Verifiziert' : '❌ Nicht verifiziert')
                .setDescription(isVerified
                    ? `Du bist auf **${guild.name}** verifiziert und hast vollen Zugang!`
                    : `Du bist noch **nicht verifiziert**. Klicke auf den **Verifizieren**-Button, um Zugang zu erhalten.`)
                .setThumbnail(member.user.displayAvatarURL({ size: 128 }))
                .addFields({ name: 'Mitglied seit', value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`, inline: true })
                .setFooter({ text: guild.name, iconURL: guild.iconURL({ size: 64 }) })
                .setTimestamp();
            return interaction.reply({ embeds: [statusEmbed], ephemeral: true });
        }

        // Already verified?
        if (verifiedRoleId && member.roles.cache.has(verifiedRoleId)) {
            const alreadyEmbed = new EmbedBuilder()
                .setColor(0x57F287)
                .setTitle('✅ Bereits verifiziert')
                .setDescription(`Du bist bereits auf **${guild.name}** verifiziert!`)
                .setThumbnail(member.user.displayAvatarURL({ size: 128 }))
                .setTimestamp();
            return interaction.reply({ embeds: [alreadyEmbed], ephemeral: true });
        }

        // ===== BUTTON Verification =====
        if (settings.verification_type === 'button') {
            await assignVerification(member, verifiedRoleId, unverifiedRoleId, Logger);
            const successEmbed = buildSuccessEmbed(guild, member, settings);
            return interaction.reply({ embeds: [successEmbed], ephemeral: true });
        }

        // ===== CAPTCHA Verification =====
        if (settings.verification_type === 'captcha') {
            if (interaction.customId === 'greeting:VERIFY') {
                // Generate captcha
                const a = Math.floor(Math.random() * 20) + 1;
                const b = Math.floor(Math.random() * 20) + 1;
                const answer = a + b;

                captchaCache.set(`${guild.id}-${member.id}`, {
                    answer,
                    expires: Date.now() + 120_000 // 2 min
                });

                const row = new ActionRowBuilder().addComponents(
                    ...generateCaptchaButtons(answer)
                );

                const captchaEmbed = new EmbedBuilder()
                    .setColor(0x5865F2)
                    .setTitle('🔢 Captcha-Verifizierung')
                    .setDescription(`Löse die folgende Aufgabe, um dich zu verifizieren:\n\n**Was ist ${a} + ${b}?**`)
                    .setFooter({ text: 'Du hast 2 Minuten Zeit' })
                    .setTimestamp();

                return interaction.reply({
                    embeds: [captchaEmbed],
                    components: [row],
                    ephemeral: true
                });
            }

            // Captcha answer button
            if (interaction.customId.startsWith('greeting:VERIFY_ANSWER_')) {
                const selectedAnswer = parseInt(interaction.customId.split('_').pop());
                const cacheKey = `${guild.id}-${member.id}`;
                const captcha = captchaCache.get(cacheKey);

                if (!captcha || Date.now() > captcha.expires) {
                    captchaCache.delete(cacheKey);
                    const expiredEmbed = new EmbedBuilder()
                        .setColor(0xFEE75C)
                        .setTitle('⏰ Captcha abgelaufen')
                        .setDescription('Bitte klicke erneut auf den **Verifizieren**-Button für ein neues Captcha.');
                    return interaction.update({ embeds: [expiredEmbed], components: [] });
                }

                if (selectedAnswer === captcha.answer) {
                    captchaCache.delete(cacheKey);
                    await assignVerification(member, verifiedRoleId, unverifiedRoleId, Logger);
                    const successEmbed = buildSuccessEmbed(guild, member, settings);
                    return interaction.update({ embeds: [successEmbed], components: [] });
                } else {
                    captchaCache.delete(cacheKey);
                    const wrongEmbed = new EmbedBuilder()
                        .setColor(0xED4245)
                        .setTitle('❌ Falsche Antwort')
                        .setDescription('Bitte klicke erneut auf den **Verifizieren**-Button für ein neues Captcha.');
                    return interaction.update({ embeds: [wrongEmbed], components: [] });
                }
            }
        }

        // ===== REACTION type: Button still works as fallback entry point =====
        if (settings.verification_type === 'reaction') {
            const infoEmbed = new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle('ℹ️ Reaction-Verifizierung')
                .setDescription(`Reagiere mit ${settings.verification_emoji || '✅'} auf die Verifizierungs-Nachricht, um dich zu verifizieren!`);
            return interaction.reply({ embeds: [infoEmbed], ephemeral: true });
        }

    } catch (error) {
        Logger.error(`[Greeting] Verification error for ${member?.user?.tag}:`, error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: 'Ein Fehler ist aufgetreten.', ephemeral: true }).catch(() => {});
        }
    }
};

/**
 * Builds a success embed after verification
 */
function buildSuccessEmbed(guild, member, settings) {
    const defaultTitle = '✅ Erfolgreich verifiziert!';
    const defaultDesc = `Willkommen auf **${guild.name}**!\nDu hast jetzt vollen Zugang zum Server.`;

    let title = defaultTitle;
    let description = defaultDesc;

    if (settings.verification_success_message) {
        const raw = settings.verification_success_message;
        const placeholders = {
            '{guild:name}': guild.name,
            '{server}': guild.name,
            '{user:name}': member.user.username,
            '{user:tag}': member.user.tag,
            '{user:mention}': `<@${member.user.id}>`,
            '{member:name}': member.user.username,
            '{member:mention}': `<@${member.user.id}>`,
            '{guild:memberCount}': String(guild.memberCount),
            '{count}': String(guild.memberCount)
        };
        description = raw;
        for (const [key, val] of Object.entries(placeholders)) {
            description = description.replaceAll(key, val);
        }
    }

    return new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle(title)
        .setDescription(description)
        .setThumbnail(member.user.displayAvatarURL({ size: 128 }))
        .setFooter({ text: guild.name, iconURL: guild.iconURL({ size: 64 }) })
        .setTimestamp();
}

/**
 * Assigns verified role and removes unverified role
 */
async function assignVerification(member, verifiedRoleId, unverifiedRoleId, Logger) {
    if (verifiedRoleId) {
        const role = member.guild.roles.cache.get(verifiedRoleId);
        if (role && member.guild.members.me.roles.highest.position > role.position) {
            await member.roles.add(role);
            Logger.info(`[Greeting] Verified ${member.user.tag} — added role ${role.name}`);
        }
    }
    if (unverifiedRoleId) {
        const removeRole = member.guild.roles.cache.get(unverifiedRoleId);
        if (removeRole && member.guild.members.me.roles.highest.position > removeRole.position) {
            await member.roles.remove(removeRole);
            Logger.info(`[Greeting] Verified ${member.user.tag} — removed unverified role ${removeRole.name}`);
        }
    }
}

/**
 * Generates 4 buttons: 1 correct + 3 wrong answers, shuffled
 */
function generateCaptchaButtons(correctAnswer) {
    const options = new Set([correctAnswer]);
    while (options.size < 4) {
        const wrong = correctAnswer + Math.floor(Math.random() * 10) - 5;
        if (wrong > 0 && wrong !== correctAnswer) options.add(wrong);
    }
    const shuffled = [...options].sort(() => Math.random() - 0.5);
    return shuffled.map(num =>
        new ButtonBuilder()
            .setCustomId(`greeting:VERIFY_ANSWER_${num}`)
            .setLabel(String(num))
            .setStyle(ButtonStyle.Secondary)
    );
}

/**
 * Sends or updates the verification panel in the configured channel
 * Called via IPC from dashboard
 */
module.exports.sendVerificationPanel = async (guild, settings) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const channelId = settings.verification_channel;
    if (!channelId) return;

    const channel = guild.channels.cache.get(channelId);
    if (!channel) return;

    const rawMessage = settings.verification_message || '✅ Klicke den Button um dich zu verifizieren!';
    const ctx = { guild, extra: {} };
    let messageText = parsePlaceholders(rawMessage, ctx);
    let embed = null;

    try {
        const parsed = JSON.parse(messageText);
        if (parsed && parsed.title) {
            embed = new EmbedBuilder()
                .setTitle(parsePlaceholders(parsed.title, ctx))
                .setDescription(parsed.description ? parsePlaceholders(parsed.description, ctx) : null)
                .setColor(parsed.color ? parseInt(parsed.color.replace('#', ''), 16) : 0x5865f2);
            messageText = null;
        }
    } catch { /* plain text */ }

    const payload = {};
    if (messageText) payload.content = messageText;
    if (embed) payload.embeds = [embed];

    // For reaction type: no buttons, add reaction emoji instead
    if (settings.verification_type === 'reaction') {
        const emoji = settings.verification_emoji || '✅';
        const reactionMsg = await channel.send(payload);
        await reactionMsg.react(emoji);

        // Store message ID for reaction tracking
        await dbService.query(
            'UPDATE greeting_settings SET verification_message_id = ? WHERE guild_id = ?',
            [reactionMsg.id, guild.id]
        );
        Logger.info(`[Greeting] Reaction verification panel sent to #${channel.name} in ${guild.name} (emoji: ${emoji})`);
    } else {
        // Button/Captcha: add verify button + status button
        const verifyLabel = settings.verification_type === 'captcha'
            ? '🔢 Verifizieren (Captcha)'
            : '✅ Verifizieren';

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('greeting:VERIFY')
                .setLabel(verifyLabel)
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('greeting:VERIFY_STATUS')
                .setLabel('📋 Status prüfen')
                .setStyle(ButtonStyle.Secondary)
        );

        payload.components = [row];
        await channel.send(payload);
        Logger.info(`[Greeting] Verification panel sent to #${channel.name} in ${guild.name}`);
    }
};
