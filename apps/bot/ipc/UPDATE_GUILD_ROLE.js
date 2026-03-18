/**
 * IPC Handler: UPDATE_GUILD_ROLE
 * 
 * Aktualisiert eine bestehende Rolle (Name, Farbe, Permissions, Hoist, Mentionable).
 * 
 * @param {object} payload - { guildId, roleId, name, color, hoist, mentionable, permissions }
 * @param {import('discord.js').Client} client
 * @returns {object} { success, role }
 */
const { PermissionsBitField } = require('discord.js');
const { ServiceManager } = require('dunebot-core');

module.exports = async (payload, client) => {
    const Logger = ServiceManager.get('Logger');
    const { guildId, roleId, name, color, hoist, mentionable, permissions } = payload;

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
        return { success: false, error: 'Managed Rollen (Bot/Boost) können nicht bearbeitet werden' };
    }

    if (role.position >= botMember.roles.highest.position) {
        return { success: false, error: 'Diese Rolle ist höher oder gleich der Bot-Rolle und kann nicht bearbeitet werden' };
    }

    try {
        const updateData = { reason: 'Bearbeitet via DuneBot Dashboard' };

        if (name !== undefined) {
            const trimmed = String(name).trim();
            if (trimmed.length === 0 || trimmed.length > 100) {
                return { success: false, error: 'Rollenname muss zwischen 1 und 100 Zeichen sein' };
            }
            updateData.name = trimmed;
        }
        if (color !== undefined) {
            updateData.color = color;
        }
        if (hoist !== undefined) {
            updateData.hoist = !!hoist;
        }
        if (mentionable !== undefined) {
            updateData.mentionable = !!mentionable;
        }
        if (permissions && typeof permissions === 'object') {
            let permissionBits = 0n;
            for (const [flag, enabled] of Object.entries(permissions)) {
                if (enabled && PermissionsBitField.Flags[flag] !== undefined) {
                    permissionBits |= PermissionsBitField.Flags[flag];
                }
            }
            updateData.permissions = permissionBits;
        }

        const updatedRole = await role.edit(updateData);

        Logger.info(`[IPC] UPDATE_GUILD_ROLE: Rolle "${updatedRole.name}" (${roleId}) aktualisiert in Guild ${guildId}`);

        return {
            success: true,
            role: {
                id: updatedRole.id,
                name: updatedRole.name,
                color: updatedRole.color,
                hexColor: updatedRole.hexColor,
                position: updatedRole.position,
                hoist: updatedRole.hoist,
                mentionable: updatedRole.mentionable
            }
        };
    } catch (error) {
        Logger.error(`[IPC] UPDATE_GUILD_ROLE Fehler:`, error);
        return { success: false, error: error.message };
    }
};
