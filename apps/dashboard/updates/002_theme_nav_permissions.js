/**
 * Kern-Update 002: Theme-Permissions + Navigation für alle bestehenden Guilds
 *
 * Registriert die neuen CORE.THEMES.VIEW/EDIT Permissions global
 * und führt registerKernNavigation() für alle vorhandenen Guilds aus,
 * damit Theme-Nav-Items und Permissions überall erscheinen.
 */
module.exports = {
    version: "7.0.0",
    description: "Theme-Permissions + Kern-Navigation für alle Guilds aktualisieren",

    async run(dbService, { ServiceManager, Logger }) {
        // 1. Neue Permission-Definitionen global registrieren (ON DUPLICATE KEY = safe)
        const newPermissions = [
            {
                key: "CORE.THEMES.VIEW",
                name: "CORE.PERM_THEMES_VIEW",
                description: "CORE.PERM_THEMES_VIEW_DESC",
                category: "core",
                is_dangerous: 0,
                sort_order: 54,
                requires: null,
                plugin_name: "kern",
            },
            {
                key: "CORE.THEMES.EDIT",
                name: "CORE.PERM_THEMES_EDIT",
                description: "CORE.PERM_THEMES_EDIT_DESC",
                category: "core",
                is_dangerous: 0,
                sort_order: 55,
                requires: JSON.stringify(["CORE.THEMES.VIEW"]),
                plugin_name: "kern",
            },
        ];

        for (const perm of newPermissions) {
            await dbService.pool.execute(
                `INSERT INTO permission_definitions
                    (permission_key, name_translation_key, description_translation_key,
                     category, is_dangerous, sort_order, requires_permissions, plugin_name)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                    name_translation_key = VALUES(name_translation_key),
                    description_translation_key = VALUES(description_translation_key),
                    category = VALUES(category),
                    sort_order = VALUES(sort_order),
                    requires_permissions = VALUES(requires_permissions)`,
                [
                    perm.key,
                    perm.name,
                    perm.description,
                    perm.category,
                    perm.is_dangerous,
                    perm.sort_order,
                    perm.requires,
                    perm.plugin_name,
                ]
            );
        }
        Logger.info("[Update 002] Theme-Permissions global registriert.");

        // 2. Neue Permissions in Administrator-Gruppen aller Guilds einfügen
        const [adminGroups] = await dbService.pool.execute(
            "SELECT id, guild_id, permissions FROM guild_groups WHERE slug = 'administrator'"
        );

        const newPermKeys = newPermissions.map((p) => p.key);

        for (const group of adminGroups) {
            let perms = {};
            try {
                perms = JSON.parse(group.permissions || "{}");
            } catch {
                perms = {};
            }

            let changed = false;
            for (const key of newPermKeys) {
                if (!perms[key]) {
                    perms[key] = true;
                    changed = true;
                }
            }

            if (changed) {
                await dbService.pool.execute(
                    "UPDATE guild_groups SET permissions = ? WHERE id = ?",
                    [JSON.stringify(perms), group.id]
                );
            }
        }
        Logger.info(
            `[Update 002] Theme-Permissions in ${adminGroups.length} Administrator-Gruppen gemergt.`
        );

        // 3. KernNavigation für alle Guilds aktualisieren (löscht + erstellt neu)
        const { registerKernNavigation } = require("../helpers/KernNavigation");

        const [guilds] = await dbService.pool.execute(
            "SELECT _id FROM guilds WHERE left_at IS NULL"
        );

        let updated = 0;
        for (const guild of guilds) {
            try {
                await registerKernNavigation(guild._id);
                updated++;
            } catch (err) {
                Logger.warn(
                    `[Update 002] KernNavigation für Guild ${guild._id} fehlgeschlagen:`,
                    err.message
                );
            }
        }

        Logger.info(
            `[Update 002] KernNavigation für ${updated}/${guilds.length} Guilds aktualisiert.`
        );
    },
};
