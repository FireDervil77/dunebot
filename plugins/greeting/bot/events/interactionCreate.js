const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { ServiceManager } = require('dunebot-core');

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

        // Already verified?
        if (verifiedRoleId && member.roles.cache.has(verifiedRoleId)) {
            return interaction.reply({ content: '✅ Du bist bereits verifiziert!', ephemeral: true });
        }

        // ===== BUTTON Verification =====
        if (settings.verification_type === 'button') {
            await assignVerification(member, verifiedRoleId, unverifiedRoleId, Logger);
            return interaction.reply({ content: '✅ Du wurdest erfolgreich verifiziert!', ephemeral: true });
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

                return interaction.reply({
                    content: `🔢 **Captcha:** Was ist **${a} + ${b}**?`,
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
                    return interaction.update({
                        content: '⏰ Captcha abgelaufen. Bitte klicke erneut auf den Verifizieren-Button.',
                        components: []
                    });
                }

                if (selectedAnswer === captcha.answer) {
                    captchaCache.delete(cacheKey);
                    await assignVerification(member, verifiedRoleId, unverifiedRoleId, Logger);
                    return interaction.update({
                        content: '✅ Captcha korrekt! Du wurdest erfolgreich verifiziert!',
                        components: []
                    });
                } else {
                    captchaCache.delete(cacheKey);
                    return interaction.update({
                        content: '❌ Falsche Antwort! Bitte klicke erneut auf den Verifizieren-Button.',
                        components: []
                    });
                }
            }
        }

    } catch (error) {
        Logger.error(`[Greeting] Verification error for ${member?.user?.tag}:`, error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: 'Ein Fehler ist aufgetreten.', ephemeral: true }).catch(() => {});
        }
    }
};

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
    const channelId = settings.verification_channel;
    if (!channelId) return;

    const channel = guild.channels.cache.get(channelId);
    if (!channel) return;

    let messageText = settings.verification_message || '✅ Klicke den Button um dich zu verifizieren!';
    let embed = null;

    try {
        const parsed = JSON.parse(messageText);
        if (parsed && parsed.title) {
            embed = new EmbedBuilder()
                .setTitle(parsed.title)
                .setDescription(parsed.description || null)
                .setColor(parsed.color ? parseInt(parsed.color.replace('#', ''), 16) : 0x5865f2);
            messageText = null;
        }
    } catch { /* plain text */ }

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('greeting:VERIFY')
            .setLabel(settings.verification_type === 'captcha' ? '🔢 Verifizieren (Captcha)' : '✅ Verifizieren')
            .setStyle(ButtonStyle.Success)
    );

    const payload = { components: [row] };
    if (messageText) payload.content = messageText;
    if (embed) payload.embeds = [embed];

    await channel.send(payload);
    Logger.info(`[Greeting] Verification panel sent to #${channel.name} in ${guild.name}`);
};
