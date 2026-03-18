/**
 * IPC Handler: GET_GUILD_ROLES_DETAILED
 * 
 * Liefert ALLE Rollen einer Guild mit vollen Permission-Details.
 * Für die Dashboard Rollen-Verwaltung (Spiegel der Discord-Rollen).
 * 
 * @param {object} payload - { guildId }
 * @param {import('discord.js').Client} client
 * @returns {object} { success, roles, botHighestPosition }
 */
const { PermissionsBitField } = require('discord.js');
const { ServiceManager } = require('dunebot-core');

module.exports = async (payload, client) => {
    const Logger = ServiceManager.get('Logger');
    const { guildId } = payload;

    if (!guildId) {
        return { success: false, error: 'Guild-ID ist erforderlich' };
    }

    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
        return { success: false, error: 'Guild nicht gefunden' };
    }

    const botMember = guild.members.me;
    const botHighestPosition = botMember ? botMember.roles.highest.position : 0;
    const botHasManageRoles = botMember ? botMember.permissions.has(PermissionsBitField.Flags.ManageRoles) : false;

    // Alle Permissions-Flags als lesbares Array
    const permissionFlags = Object.keys(PermissionsBitField.Flags);

    const roles = guild.roles.cache
        .filter(role => role.id !== guild.id) // @everyone ausschließen
        .map(role => {
            // Permission-Bits in lesbare Namen auflösen
            const permissions = {};
            for (const flag of permissionFlags) {
                permissions[flag] = role.permissions.has(PermissionsBitField.Flags[flag]);
            }

            return {
                id: role.id,
                name: role.name,
                color: role.color,
                hexColor: role.hexColor,
                position: role.position,
                hoist: role.hoist,
                mentionable: role.mentionable,
                managed: role.managed,
                memberCount: role.members.size,
                permissions,
                // Kann der Bot diese Rolle bearbeiten?
                editable: !role.managed && botMember && role.position < botHighestPosition,
                createdAt: role.createdTimestamp
            };
        })
        .sort((a, b) => b.position - a.position);

    Logger.debug(`[IPC] GET_GUILD_ROLES_DETAILED: ${roles.length} Rollen für Guild ${guildId}`);

    return {
        success: true,
        roles,
        botHighestPosition,
        botHasManageRoles,
        permissionFlags
    };
};
