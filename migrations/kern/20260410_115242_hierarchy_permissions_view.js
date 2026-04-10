'use strict';

/**
 * Migration: Rollen-Hierarchie für Permission-System
 * 
 * Erweitert v_guild_user_permissions View um max_priority Spalte,
 * damit der PermissionManager hierarchisch erben kann:
 * Moderator (50) erbt automatisch Support (25) + User (1) Permissions.
 */
module.exports = {
    description: 'hierarchy_permissions_view – max_priority für Rollen-Hierarchie',

    async up(db) {
        // View erweitern: max_priority hinzufügen
        await db.query(`
            CREATE OR REPLACE VIEW v_guild_user_permissions AS
            SELECT 
                gu.id AS guild_user_id,
                gu.guild_id,
                gu.user_id,
                gu.is_owner,
                gu.status,
                gu.direct_permissions,
                gu.last_login_at,
                GROUP_CONCAT(DISTINCT gg.id ORDER BY gg.priority DESC) AS group_ids,
                GROUP_CONCAT(DISTINCT gg.name ORDER BY gg.priority DESC SEPARATOR ', ') AS group_names,
                GROUP_CONCAT(DISTINCT gg.slug ORDER BY gg.priority DESC SEPARATOR ', ') AS group_slugs,
                GROUP_CONCAT(DISTINCT gg.permissions ORDER BY gg.priority DESC SEPARATOR '|||') AS group_permissions,
                MAX(gg.priority) AS max_priority
            FROM guild_users gu
            LEFT JOIN guild_user_groups gug ON gu.id = gug.guild_user_id
            LEFT JOIN guild_groups gg ON gug.group_id = gg.id
            GROUP BY gu.id, gu.guild_id, gu.user_id, gu.is_owner, gu.status, gu.direct_permissions, gu.last_login_at
        `);
    },

    async down(db) {
        // Zurück zur alten View ohne max_priority
        await db.query(`
            CREATE OR REPLACE VIEW v_guild_user_permissions AS
            SELECT 
                gu.id AS guild_user_id,
                gu.guild_id,
                gu.user_id,
                gu.is_owner,
                gu.status,
                gu.direct_permissions,
                gu.last_login_at,
                GROUP_CONCAT(DISTINCT gg.id ORDER BY gg.priority DESC) AS group_ids,
                GROUP_CONCAT(DISTINCT gg.name ORDER BY gg.priority DESC SEPARATOR ', ') AS group_names,
                GROUP_CONCAT(DISTINCT gg.slug ORDER BY gg.priority DESC SEPARATOR ', ') AS group_slugs,
                GROUP_CONCAT(DISTINCT gg.permissions ORDER BY gg.priority DESC SEPARATOR '|||') AS group_permissions
            FROM guild_users gu
            LEFT JOIN guild_user_groups gug ON gu.id = gug.guild_user_id
            LEFT JOIN guild_groups gg ON gug.group_id = gg.id
            GROUP BY gu.id, gu.guild_id, gu.user_id, gu.is_owner, gu.status, gu.direct_permissions, gu.last_login_at
        `);
    }
};
