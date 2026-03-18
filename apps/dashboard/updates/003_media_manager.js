/**
 * Kern-Update 003: Medien-Manager — DB-Tabelle + Permissions
 *
 * 1. Erstellt guild_media Tabelle
 * 2. Registriert CORE.MEDIA.VIEW/UPLOAD/DELETE Permissions global
 * 3. Fügt Media-Permissions in alle Administrator-Gruppen ein
 * 4. Aktualisiert KernNavigation für alle Guilds (neuer Medien-Menüpunkt)
 */
module.exports = {
    version: "7.1.0",
    description: "Medien-Manager: DB-Tabelle + Permissions + Navigation",

    async run(dbService, { ServiceManager, Logger }) {
        // 1. guild_media Tabelle erstellen
        await dbService.pool.execute(`
            CREATE TABLE IF NOT EXISTS guild_media (
                id            INT           NOT NULL AUTO_INCREMENT,
                guild_id      VARCHAR(20)   NOT NULL,
                uploaded_by   VARCHAR(20)   NOT NULL COMMENT 'Discord User-ID des Uploaders',
                filename      VARCHAR(255)  NOT NULL COMMENT 'Original-Dateiname',
                stored_name   VARCHAR(255)  NOT NULL COMMENT 'Generierter Dateiname auf Disk',
                mime_type     VARCHAR(100)  NOT NULL,
                file_size     INT UNSIGNED  NOT NULL COMMENT 'Dateigröße in Bytes',
                width         INT UNSIGNED  NULL     COMMENT 'Bildbreite in px',
                height        INT UNSIGNED  NULL     COMMENT 'Bildhöhe in px',
                alt_text      VARCHAR(255)  NULL     COMMENT 'Alt-Text',
                title         VARCHAR(255)  NULL     COMMENT 'Optionaler Titel',
                folder        VARCHAR(100)  NOT NULL DEFAULT 'general' COMMENT 'Logischer Ordner',
                created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                KEY idx_guild_media_guild (guild_id),
                KEY idx_guild_media_folder (guild_id, folder),
                KEY idx_guild_media_mime (guild_id, mime_type),
                CONSTRAINT fk_guild_media_guild
                    FOREIGN KEY (guild_id) REFERENCES guilds(_id)
                    ON DELETE CASCADE ON UPDATE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        Logger.info("[Update 003] guild_media Tabelle erstellt.");

        // 2. Neue Permission-Definitionen registrieren
        const newPermissions = [
            {
                key: "CORE.MEDIA.VIEW",
                name: "CORE.PERM_MEDIA_VIEW",
                description: "CORE.PERM_MEDIA_VIEW_DESC",
                category: "core",
                is_dangerous: 0,
                sort_order: 56,
                requires: null,
                plugin_name: "kern",
            },
            {
                key: "CORE.MEDIA.UPLOAD",
                name: "CORE.PERM_MEDIA_UPLOAD",
                description: "CORE.PERM_MEDIA_UPLOAD_DESC",
                category: "core",
                is_dangerous: 0,
                sort_order: 57,
                requires: JSON.stringify(["CORE.MEDIA.VIEW"]),
                plugin_name: "kern",
            },
            {
                key: "CORE.MEDIA.DELETE",
                name: "CORE.PERM_MEDIA_DELETE",
                description: "CORE.PERM_MEDIA_DELETE_DESC",
                category: "core",
                is_dangerous: 1,
                sort_order: 58,
                requires: JSON.stringify(["CORE.MEDIA.VIEW"]),
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
        Logger.info("[Update 003] Media-Permissions global registriert.");

        // 3. Neue Permissions in Administrator-Gruppen aller Guilds einfügen
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
            `[Update 003] Media-Permissions in ${adminGroups.length} Administrator-Gruppen gemergt.`
        );

        // 4. KernNavigation für alle Guilds aktualisieren (neuer Medien-Menüpunkt)
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
                    `[Update 003] KernNavigation für Guild ${guild._id} fehlgeschlagen:`,
                    err.message
                );
            }
        }

        Logger.info(
            `[Update 003] KernNavigation für ${updated}/${guilds.length} Guilds aktualisiert.`
        );
    },
};
