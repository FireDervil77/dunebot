/**
 * IPC Handler: DELETE_GUILD_ROLE
 * 
 * Löscht eine Rolle aus einer Guild.
 * 
 * @param {object} payload - { guildId, roleId }
 * @param {import('discord.js').Client} client
 * @returns {object} { success }
 */
const { PermissionsBitField } = require('discord.js');
const { ServiceManager } = require('dunebot-core');

module.exports = async (payload, client) => {
    const Logger = ServiceManager.get('Logger');
    const { guildId, roleId } = payload;

    if (!guildId || !roleId) {
        return { success: false, error: 'Guild-ID und Role-ID sind erforderlich' };
    }

    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
        return { success: false, error: 'Guild nicht gefunden' };
    }

    const botMember = guild.members.me;
    if (!botMember || !botMember.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
        return { success: false, error: 'Bot hat keine ManageRoles-Berechtigung' };
    }

    const role = guild.roles.cache.get(roleId);
    if (!role) {
        return { success: false, error: 'Rolle nicht gefunden' };
    }

    if (role.managed) {
        return { success: false, error: 'Managed Rollen (Bot/Boost) können nicht gelöscht werden' };
    }

    if (role.position >= botMember.roles.highest.position) {
        return { success: false, error: 'Diese Rolle ist höher oder gleich der Bot-Rolle und kann nicht gelöscht werden' };
    }

    try {
        const roleName = role.name;
        await role.delete('Gelöscht via DuneBot Dashboard');

        Logger.info(`[IPC] DELETE_GUILD_ROLE: Rolle "${roleName}" (${roleId}) gelöscht in Guild ${guildId}`);

        return { success: true, deletedRoleName: roleName };
    } catch (error) {
        Logger.error(`[IPC] DELETE_GUILD_ROLE Fehler:`, error);
        return { success: false, error: error.message };
    }
};
