/**
 * IPC Handler: CREATE_GUILD_ROLE
 * 
 * Erstellt eine neue Rolle in einer Guild.
 * 
 * @param {object} payload - { guildId, name, color, hoist, mentionable, permissions }
 * @param {import('discord.js').Client} client
 * @returns {object} { success, role }
 */
const { PermissionsBitField } = require('discord.js');
const { ServiceManager } = require('dunebot-core');

module.exports = async (payload, client) => {
    const Logger = ServiceManager.get('Logger');
    const { guildId, name, color, hoist, mentionable, permissions } = payload;

    if (!guildId) {
        return { success: false, error: 'Guild-ID ist erforderlich' };
    }
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return { success: false, error: 'Rollenname ist erforderlich' };
    }
    if (name.trim().length > 100) {
        return { success: false, error: 'Rollenname darf maximal 100 Zeichen lang sein' };
    }

    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
        return { success: false, error: 'Guild nicht gefunden' };
    }

    const botMember = guild.members.me;
    if (!botMember || !botMember.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
        return { success: false, error: 'Bot hat keine ManageRoles-Berechtigung' };
    }

    try {
        // Permissions-Object in Bitfield umrechnen
        let permissionBits = 0n;
        if (permissions && typeof permissions === 'object') {
            for (const [flag, enabled] of Object.entries(permissions)) {
                if (enabled && PermissionsBitField.Flags[flag] !== undefined) {
                    permissionBits |= PermissionsBitField.Flags[flag];
                }
            }
        }

        const roleData = {
            name: name.trim(),
            color: color || 0,
            hoist: !!hoist,
            mentionable: !!mentionable,
            permissions: permissionBits,
            reason: 'Erstellt via DuneBot Dashboard'
        };

        const newRole = await guild.roles.create(roleData);

        Logger.info(`[IPC] CREATE_GUILD_ROLE: Rolle "${newRole.name}" erstellt in Guild ${guildId}`);

        return {
            success: true,
            role: {
                id: newRole.id,
                name: newRole.name,
                color: newRole.color,
                hexColor: newRole.hexColor,
                position: newRole.position,
                hoist: newRole.hoist,
                mentionable: newRole.mentionable
            }
        };
    } catch (error) {
        Logger.error(`[IPC] CREATE_GUILD_ROLE Fehler:`, error);
        return { success: false, error: error.message };
    }
};
