const { ServiceManager } = require('dunebot-core');
const { sendVerificationPanel } = require('../../events/interactionCreate');

/**
 * IPC Handler: greeting:SEND_VERIFICATION_PANEL
 * Sends the verification button panel to the configured channel
 */
module.exports = async (data, discordClient) => {
    const Logger = ServiceManager.get('Logger');
    const { guildId } = data;

    try {
        const dbService = ServiceManager.get('dbService');
        const rows = await dbService.query(
            'SELECT * FROM greeting_settings WHERE guild_id = ?',
            [guildId]
        );
        const settings = rows?.[0];
        if (!settings || !settings.verification_enabled) {
            return { success: false, error: 'Verification not enabled' };
        }

        // Get guild from bot client
        const guild = discordClient.guilds.cache.get(guildId);
        if (!guild) {
            return { success: false, error: 'Guild not found in cache' };
        }

        await sendVerificationPanel(guild, settings);
        return { success: true };
    } catch (error) {
        Logger.error('[Greeting] IPC sendVerificationPanel error:', error);
        return { success: false, error: error.message };
    }
};
