/**
 * Kern-Schema: Permissions-System Views
 * 
 * Convenience-Views für häufige Permission-Queries.
 * 
 * @param {import('../lib/DBService')} dbService
 */
module.exports = async (dbService) => {
    // View: User mit ihren Gruppen, aggregierten Permissions und max_priority für Hierarchie
    await dbService.rawQuery(`
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

    // View: Gruppen mit tatsächlicher Member-Anzahl (verifiziert cache)
    await dbService.rawQuery(`
        CREATE OR REPLACE VIEW v_guild_groups_summary AS
        SELECT
            gg.id,
            gg.guild_id,
            gg.name,
            gg.slug,
            gg.description,
            gg.color,
            gg.icon,
            gg.is_default,
            gg.is_protected,
            gg.priority,
            gg.permissions,
            gg.member_count,
            COUNT(gug.id) AS actual_member_count
        FROM guild_groups gg
        LEFT JOIN guild_user_groups gug ON gg.id = gug.group_id
        GROUP BY gg.id, gg.guild_id, gg.name, gg.slug, gg.description, gg.color,
                 gg.icon, gg.is_default, gg.is_protected, gg.priority, gg.permissions, gg.member_count
    `);
};
