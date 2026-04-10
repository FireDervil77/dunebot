'use strict';

/**
 * Migration: Permission-Key Naming-Cleanup
 * 
 * 1. Entfernt Duplikate des core-Plugins (Kern trägt diese Keys)
 * 2. Renamed Underscore-Keys → Punkt-Notation in permission_definitions
 * 3. Renamed Underscore-Keys → Punkt-Notation in guild_groups.permissions JSON
 * 4. Fügt fehlende Keys hinzu (CORE.ROLES.VIEW/EDIT)
 */
module.exports = {
    description: 'permission_key_naming_cleanup – Underscore→Punkt, Core-Duplikate entfernen',

    async up(db) {
        // ================================================================
        // 1. Core-Plugin Duplikate entfernen (ohne CORE. Prefix)
        //    Diese Keys existieren nur im core-Plugin, nicht im Kern
        // ================================================================
        const coreOnlyKeys = [
            'SETTINGS.VIEW', 'SETTINGS.EDIT',
            'PLUGINS.VIEW', 'PLUGINS.MANAGE',
            'NAVIGATION.VIEW', 'NAVIGATION.EDIT',
            'LOCALES.VIEW', 'LOCALES.EDIT',
            'DONATE.VIEW', 'DONATE.CREATE',
            'ROLES.VIEW', 'ROLES.EDIT'
        ];
        
        for (const key of coreOnlyKeys) {
            await db.query('DELETE FROM permission_definitions WHERE permission_key = ?', [key]);
        }

        // Core-Plugin Duplikate (gleiche Keys wie Kern)
        await db.query("DELETE FROM permission_definitions WHERE plugin_name = 'core' AND permission_key IN (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
            'DASHBOARD.ACCESS', 'DASHBOARD.SETTINGS.VIEW', 'DASHBOARD.SETTINGS.EDIT',
            'PERMISSIONS.USERS.VIEW', 'PERMISSIONS.USERS.INVITE', 'PERMISSIONS.USERS.EDIT',
            'PERMISSIONS.USERS.REMOVE', 'PERMISSIONS.GROUPS.VIEW', 'PERMISSIONS.GROUPS.CREATE',
            'PERMISSIONS.GROUPS.EDIT', 'PERMISSIONS.GROUPS.DELETE', 'PERMISSIONS.ASSIGN'
        ]);

        // Falls CORE.ROLES.* bereits unter plugin_name='core' existieren → auf 'kern' umtaggen
        await db.query("UPDATE permission_definitions SET plugin_name = 'kern' WHERE permission_key IN ('CORE.ROLES.VIEW', 'CORE.ROLES.EDIT') AND plugin_name = 'core'");

        // ================================================================
        // 2. Underscore-Keys → Punkt-Notation in permission_definitions
        // ================================================================
        const keyRenames = [
            // Moderation
            ['MODERATION.SETTINGS_EDIT', 'MODERATION.SETTINGS.EDIT'],
            ['MODERATION.BAN_EXECUTE', 'MODERATION.BAN.EXECUTE'],
            ['MODERATION.KICK_EXECUTE', 'MODERATION.KICK.EXECUTE'],
            ['MODERATION.MUTE_EXECUTE', 'MODERATION.MUTE.EXECUTE'],
            ['MODERATION.WARN_EXECUTE', 'MODERATION.WARN.EXECUTE'],
            ['MODERATION.LOGS_VIEW', 'MODERATION.LOGS.VIEW'],
            ['MODERATION.CASES_MANAGE', 'MODERATION.CASES.MANAGE'],
            ['MODERATION.NOTES_VIEW', 'MODERATION.NOTES.VIEW'],
            ['MODERATION.NOTES_MANAGE', 'MODERATION.NOTES.MANAGE'],
            ['MODERATION.PROTECTED_ROLES_MANAGE', 'MODERATION.PROTECTED.ROLES.MANAGE'],
            ['MODERATION.CHANNEL_RULES_MANAGE', 'MODERATION.CHANNEL.RULES.MANAGE'],
            // Greeting
            ['GREETING.SETTINGS_EDIT', 'GREETING.SETTINGS.EDIT'],
            ['GREETING.TEMPLATES_CREATE', 'GREETING.TEMPLATES.CREATE'],
            ['GREETING.TEMPLATES_EDIT', 'GREETING.TEMPLATES.EDIT'],
            ['GREETING.TEMPLATES_DELETE', 'GREETING.TEMPLATES.DELETE'],
            ['GREETING.TEST_EXECUTE', 'GREETING.TEST.EXECUTE'],
            // AutoMod
            ['AUTOMOD.SETTINGS_EDIT', 'AUTOMOD.SETTINGS.EDIT'],
            ['AUTOMOD.RULES_CREATE', 'AUTOMOD.RULES.CREATE'],
            ['AUTOMOD.RULES_EDIT', 'AUTOMOD.RULES.EDIT'],
            ['AUTOMOD.RULES_DELETE', 'AUTOMOD.RULES.DELETE'],
            ['AUTOMOD.WHITELIST_MANAGE', 'AUTOMOD.WHITELIST.MANAGE'],
            ['AUTOMOD.LOGS_VIEW', 'AUTOMOD.LOGS.VIEW'],
            // DuneMap
            ['DUNEMAP.SETTINGS_EDIT', 'DUNEMAP.SETTINGS.EDIT'],
            ['DUNEMAP.SECTORS_VIEW', 'DUNEMAP.SECTORS.VIEW'],
            ['DUNEMAP.SECTORS_CREATE', 'DUNEMAP.SECTORS.CREATE'],
            ['DUNEMAP.SECTORS_EDIT', 'DUNEMAP.SECTORS.EDIT'],
            ['DUNEMAP.SECTORS_DELETE', 'DUNEMAP.SECTORS.DELETE'],
            ['DUNEMAP.MARKERS_CREATE', 'DUNEMAP.MARKERS.CREATE'],
            ['DUNEMAP.MARKERS_EDIT', 'DUNEMAP.MARKERS.EDIT'],
            ['DUNEMAP.MARKERS_DELETE', 'DUNEMAP.MARKERS.DELETE'],
            ['DUNEMAP.ADMIN_MANAGE', 'DUNEMAP.ADMIN.MANAGE'],
            // Ticket
            ['TICKET.SETTINGS_EDIT', 'TICKET.SETTINGS.EDIT'],
            ['TICKET.CATEGORIES_MANAGE', 'TICKET.CATEGORIES.MANAGE'],
            ['TICKET.TICKETS_VIEW', 'TICKET.TICKETS.VIEW'],
        ];

        for (const [oldKey, newKey] of keyRenames) {
            await db.query(
                'UPDATE permission_definitions SET permission_key = ? WHERE permission_key = ?',
                [newKey, oldKey]
            );
        }

        // ================================================================
        // 3. Underscore-Keys in guild_groups.permissions JSON updaten
        //    Alle Gruppen aller Guilds durchgehen und Keys umbenennen
        // ================================================================
        const groups = await db.query('SELECT id, permissions FROM guild_groups WHERE permissions IS NOT NULL');
        for (const group of (groups || [])) {
            let perms;
            try {
                perms = typeof group.permissions === 'string' ? JSON.parse(group.permissions) : group.permissions;
            } catch (e) {
                continue;
            }
            if (!perms || typeof perms !== 'object') continue;

            let changed = false;
            for (const [oldKey, newKey] of keyRenames) {
                // Auch uppercase checken (PermissionManager normalisiert zu UPPERCASE)
                const variants = [oldKey, oldKey.toUpperCase()];
                for (const variant of variants) {
                    if (Object.prototype.hasOwnProperty.call(perms, variant)) {
                        perms[newKey] = perms[variant];
                        delete perms[variant];
                        changed = true;
                    }
                }
            }

            // Auch core-only Keys entfernen die in Gruppen-JSONs stecken könnten
            for (const key of coreOnlyKeys) {
                const variants = [key, key.toUpperCase()];
                for (const variant of variants) {
                    if (Object.prototype.hasOwnProperty.call(perms, variant)) {
                        delete perms[variant];
                        changed = true;
                    }
                }
            }

            if (changed) {
                await db.query(
                    'UPDATE guild_groups SET permissions = ?, updated_at = NOW() WHERE id = ?',
                    [JSON.stringify(perms), group.id]
                );
            }
        }

        // ================================================================
        // 4. Underscore-Keys in guild_users.direct_permissions JSON updaten
        // ================================================================
        const users = await db.query('SELECT id, direct_permissions FROM guild_users WHERE direct_permissions IS NOT NULL');
        for (const user of (users || [])) {
            let perms;
            try {
                perms = typeof user.direct_permissions === 'string' ? JSON.parse(user.direct_permissions) : user.direct_permissions;
            } catch (e) {
                continue;
            }
            if (!perms || typeof perms !== 'object') continue;

            let changed = false;
            for (const [oldKey, newKey] of keyRenames) {
                const variants = [oldKey, oldKey.toUpperCase()];
                for (const variant of variants) {
                    if (Object.prototype.hasOwnProperty.call(perms, variant)) {
                        perms[newKey] = perms[variant];
                        delete perms[variant];
                        changed = true;
                    }
                }
            }

            if (changed) {
                await db.query(
                    'UPDATE guild_users SET direct_permissions = ?, updated_at = NOW() WHERE id = ?',
                    [JSON.stringify(perms), user.id]
                );
            }
        }
    },

    async down(db) {
        // Rollback: Punkt-Notation → Underscore
        const keyRenames = [
            ['MODERATION.SETTINGS.EDIT', 'MODERATION.SETTINGS_EDIT'],
            ['MODERATION.BAN.EXECUTE', 'MODERATION.BAN_EXECUTE'],
            ['MODERATION.KICK.EXECUTE', 'MODERATION.KICK_EXECUTE'],
            ['MODERATION.MUTE.EXECUTE', 'MODERATION.MUTE_EXECUTE'],
            ['MODERATION.WARN.EXECUTE', 'MODERATION.WARN_EXECUTE'],
            ['MODERATION.LOGS.VIEW', 'MODERATION.LOGS_VIEW'],
            ['MODERATION.CASES.MANAGE', 'MODERATION.CASES_MANAGE'],
            ['MODERATION.NOTES.VIEW', 'MODERATION.NOTES_VIEW'],
            ['MODERATION.NOTES.MANAGE', 'MODERATION.NOTES_MANAGE'],
            ['MODERATION.PROTECTED.ROLES.MANAGE', 'MODERATION.PROTECTED_ROLES_MANAGE'],
            ['MODERATION.CHANNEL.RULES.MANAGE', 'MODERATION.CHANNEL_RULES_MANAGE'],
            ['GREETING.SETTINGS.EDIT', 'GREETING.SETTINGS_EDIT'],
            ['GREETING.TEMPLATES.CREATE', 'GREETING.TEMPLATES_CREATE'],
            ['GREETING.TEMPLATES.EDIT', 'GREETING.TEMPLATES_EDIT'],
            ['GREETING.TEMPLATES.DELETE', 'GREETING.TEMPLATES_DELETE'],
            ['GREETING.TEST.EXECUTE', 'GREETING.TEST_EXECUTE'],
            ['AUTOMOD.SETTINGS.EDIT', 'AUTOMOD.SETTINGS_EDIT'],
            ['AUTOMOD.RULES.CREATE', 'AUTOMOD.RULES_CREATE'],
            ['AUTOMOD.RULES.EDIT', 'AUTOMOD.RULES_EDIT'],
            ['AUTOMOD.RULES.DELETE', 'AUTOMOD.RULES_DELETE'],
            ['AUTOMOD.WHITELIST.MANAGE', 'AUTOMOD.WHITELIST_MANAGE'],
            ['AUTOMOD.LOGS.VIEW', 'AUTOMOD.LOGS_VIEW'],
            ['DUNEMAP.SETTINGS.EDIT', 'DUNEMAP.SETTINGS_EDIT'],
            ['DUNEMAP.SECTORS.VIEW', 'DUNEMAP.SECTORS_VIEW'],
            ['DUNEMAP.SECTORS.CREATE', 'DUNEMAP.SECTORS_CREATE'],
            ['DUNEMAP.SECTORS.EDIT', 'DUNEMAP.SECTORS_EDIT'],
            ['DUNEMAP.SECTORS.DELETE', 'DUNEMAP.SECTORS_DELETE'],
            ['DUNEMAP.MARKERS.CREATE', 'DUNEMAP.MARKERS_CREATE'],
            ['DUNEMAP.MARKERS.EDIT', 'DUNEMAP.MARKERS_EDIT'],
            ['DUNEMAP.MARKERS.DELETE', 'DUNEMAP.MARKERS_DELETE'],
            ['DUNEMAP.ADMIN.MANAGE', 'DUNEMAP.ADMIN_MANAGE'],
            ['TICKET.SETTINGS.EDIT', 'TICKET.SETTINGS_EDIT'],
            ['TICKET.CATEGORIES.MANAGE', 'TICKET.CATEGORIES_MANAGE'],
            ['TICKET.TICKETS.VIEW', 'TICKET.TICKETS_VIEW'],
        ];

        for (const [oldKey, newKey] of keyRenames) {
            await db.query(
                'UPDATE permission_definitions SET permission_key = ? WHERE permission_key = ?',
                [newKey, oldKey]
            );
        }
    }
};
