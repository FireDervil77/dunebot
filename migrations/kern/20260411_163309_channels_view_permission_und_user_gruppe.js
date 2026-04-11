'use strict';

module.exports = {
    description: 'CORE.CHANNELS.VIEW Permission hinzufügen + User-Gruppe mit Default-Permissions befüllen',

    async up(db) {
        // 1. Neue Permission: CORE.CHANNELS.VIEW
        await db.query(`
            INSERT IGNORE INTO permission_definitions 
                (permission_key, category, name_translation_key, description_translation_key, is_dangerous, plugin_name, sort_order, is_active)
            VALUES 
                ('CORE.CHANNELS.VIEW', 'core', 'CORE.PERM_CHANNELS_VIEW', 'CORE.PERM_CHANNELS_VIEW_DESC', 0, 'kern', 61, 1)
        `);

        // 2. User-Gruppe mit Default-Permissions befüllen (für alle Guilds)
        const userDefaultPerms = [
            'DASHBOARD.ACCESS',
            'DASHBOARD.SETTINGS.VIEW',
            'CORE.SETTINGS.VIEW',
            'CORE.PLUGINS.VIEW',
            'CORE.THEMES.VIEW',
            'CORE.MEDIA.VIEW',
            'CORE.MEDIA.UPLOAD',
            'CORE.ROLES.VIEW',
            'CORE.CHANNELS.VIEW'
        ];

        const groups = await db.query(
            "SELECT id, guild_id, permissions FROM guild_groups WHERE slug = 'user'"
        );

        for (const group of (groups || [])) {
            let perms = group.permissions;
            if (typeof perms === 'string') {
                try { perms = JSON.parse(perms); } catch { perms = {}; }
            }
            if (!perms || typeof perms !== 'object') perms = {};

            let changed = false;
            for (const key of userDefaultPerms) {
                if (!perms[key]) {
                    perms[key] = true;
                    changed = true;
                }
            }

            if (changed) {
                await db.query(
                    'UPDATE guild_groups SET permissions = ?, updated_at = NOW() WHERE id = ?',
                    [JSON.stringify(perms), group.id]
                );
            }
        }

        // 3. CORE.CHANNELS.VIEW auch der Admin-Gruppe hinzufügen (für alle Guilds)
        const adminGroups = await db.query(
            "SELECT id, permissions FROM guild_groups WHERE slug = 'administrator'"
        );
        for (const group of (adminGroups || [])) {
            let perms = group.permissions;
            if (typeof perms === 'string') {
                try { perms = JSON.parse(perms); } catch { perms = {}; }
            }
            if (!perms || typeof perms !== 'object') perms = {};

            if (!perms['CORE.CHANNELS.VIEW']) {
                perms['CORE.CHANNELS.VIEW'] = true;
                await db.query(
                    'UPDATE guild_groups SET permissions = ?, updated_at = NOW() WHERE id = ?',
                    [JSON.stringify(perms), group.id]
                );
            }
        }
    },

    async down(db) {
        await db.query("DELETE FROM permission_definitions WHERE permission_key = 'CORE.CHANNELS.VIEW'");
    }
};
