'use strict';

/**
 * Migration: Entfernt group_permissions aus v_guild_user_permissions View
 * 
 * Die group_permissions Spalte (GROUP_CONCAT mit ||| Separator) ist seit der
 * Hierarchie-Migration überflüssig. Der PermissionManager lädt Gruppen-Permissions
 * jetzt direkt aus guild_groups basierend auf max_priority.
 */
module.exports = {
    description: 'remove_group_permissions_from_view – nicht mehr benötigt seit Hierarchie',

    async up(db) {
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
                MAX(gg.priority) AS max_priority
            FROM guild_users gu
            LEFT JOIN guild_user_groups gug ON gu.id = gug.guild_user_id
            LEFT JOIN guild_groups gg ON gug.group_id = gg.id
            GROUP BY gu.id, gu.guild_id, gu.user_id, gu.is_owner, gu.status, gu.direct_permissions, gu.last_login_at
        `);
    },

    async down(db) {
        // Zurück zur alten View mit group_permissions
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
    }
};
