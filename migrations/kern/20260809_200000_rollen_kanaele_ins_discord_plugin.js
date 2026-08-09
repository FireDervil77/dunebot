'use strict';

/**
 * Rollen und Kanäle ziehen aus dem Kern in das neue Plugin `discord` um.
 *
 * Zwei Dinge müssen dafür in der Datenbank passieren, und beide sind
 * einmalig — der Code allein schafft sie nicht:
 *
 * **1. Das Plugin muss für die bestehenden Guilds eingeschaltet werden.**
 * Ein neues Plugin ist in `guild_plugins` für niemanden aktiv. Ohne diesen
 * Eintrag wären Rollen und Kanäle nach dem Umzug für alle Guilds schlicht
 * verschwunden — die Funktion war vorher immer da, weil sie im Kern hing.
 * Der Rest erledigt sich beim nächsten Start von selbst:
 * `enableGuildSpecificPlugins()` (apps/dashboard/app.js) geht über alle Guilds,
 * ruft `enableInGuild()` auf, und das registriert Rechte und Navigation.
 * Kern-Migrationen laufen vorher (app.js Zeile 207), der Start reicht also.
 *
 * **2. Die alten Menüpunkte müssen weg.**
 * `NavigationManager.registerNavigation()` ist nur beim Anlegen idempotent —
 * es überspringt vorhandene Einträge, **löscht aber nie**. Das neue Plugin
 * räumt in `onGuildEnable` seine eigene Navigation ab, kommt aber an die alten
 * Einträge nicht heran: die stehen unter dem Plugin-Namen `core`. Ohne diesen
 * Schritt stünden Rollen und Kanäle doppelt im Menü — einmal unter
 * Einstellungen (ins Leere zeigend, die Route gibt es nicht mehr) und einmal
 * unter Discord.
 *
 * **3. Die alten Rechte stilllegen.**
 * `CORE.ROLES.VIEW`, `CORE.ROLES.EDIT` und `CORE.CHANNELS.VIEW` waren in
 * `packages/dunebot-core/config/permissions.json` deklariert und stehen damit
 * in `permission_definitions`. Aus der Datei sind sie raus; in der Datenbank
 * werden sie auf `is_active = 0` gesetzt statt gelöscht — an ihnen hängen
 * Gruppenzuweisungen, und eine stillgelegte Zeile lässt sich nachvollziehen,
 * eine gelöschte nicht.
 *
 * Nebenbei aufgefallen: `CORE.CHANNELS.VIEW` war ordentlich deklariert und
 * sogar der Gruppe „user" zugewiesen — **abgefragt hat es nie jemand**. Die
 * Kanalroute verlangte `CORE.SETTINGS.VIEW`. Ein Recht, das es gab, das aber
 * nichts bewirkte.
 */
module.exports = {
    description: 'Plugin discord für bestehende Guilds aktivieren, alte Menüpunkte Rollen/Kanäle entfernen',

    async up(db) {
        // 1. Plugin für alle bekannten Guilds eintragen.
        //    ON DUPLICATE KEY UPDATE macht den Lauf wiederholbar und
        //    überschreibt keine bewusste Abschaltung mit Absicht — beim
        //    ersten Lauf existiert noch keine Zeile.
        await db.query(`
            INSERT INTO guild_plugins
                (guild_id, plugin_name, is_enabled, plugin_version, enabled_at, enabled_by)
            SELECT g._id, 'discord', 1, '1.0.0', NOW(), NULL
            FROM guilds g
            ON DUPLICATE KEY UPDATE
                is_enabled = 1,
                enabled_at = NOW(),
                disabled_at = NULL,
                disabled_by = NULL,
                updated_at = NOW()
        `);

        // 2. Alte Kern-Menüpunkte entfernen — über die URL eindeutig bestimmt.
        await db.query(`
            DELETE FROM guild_nav_items
            WHERE plugin = 'core'
              AND url IN (
                  CONCAT('/guild/', guildId, '/settings/roles'),
                  CONCAT('/guild/', guildId, '/settings/channels')
              )
        `);

        // 3. Alte Rechte stilllegen, nicht löschen.
        await db.query(`
            UPDATE permission_definitions
            SET is_active = 0
            WHERE permission_key IN ('CORE.ROLES.VIEW', 'CORE.ROLES.EDIT', 'CORE.CHANNELS.VIEW')
        `);
    },

    /**
     * Zurück: Plugin abschalten und die beiden Kern-Menüpunkte wieder anlegen.
     *
     * Die Werte entsprechen exakt der früheren Definition aus
     * `apps/dashboard/helpers/KernNavigation.js` — einschließlich des
     * Missverhältnisses, dass der Menüpunkt `CORE.SETTINGS.VIEW` trug, während
     * die Route `CORE.ROLES.VIEW` verlangte. Eine Rücknahme soll den alten
     * Zustand herstellen, nicht einen besseren.
     */
    async down(db) {
        await db.query(`
            UPDATE guild_plugins
            SET is_enabled = 0, disabled_at = NOW(), updated_at = NOW()
            WHERE plugin_name = 'discord'
        `);

        await db.query(`
            UPDATE permission_definitions
            SET is_active = 1
            WHERE permission_key IN ('CORE.ROLES.VIEW', 'CORE.ROLES.EDIT', 'CORE.CHANNELS.VIEW')
        `);

        const guilds = await db.query(`
            SELECT DISTINCT guildId
            FROM guild_nav_items
            WHERE plugin = 'core'
              AND parent = CONCAT('/guild/', guildId, '/settings')
        `);

        for (const { guildId } of guilds || []) {
            await db.query(`
                INSERT INTO guild_nav_items
                    (plugin, guildId, title, url, icon, sort_order, parent, type,
                     capability, target, visible, classes, position, requiresOwner)
                VALUES
                    ('core', ?, 'NAV.ROLES', ?, 'fa-solid fa-shield-halved', 40, ?, 'main',
                     'CORE.SETTINGS.VIEW', '_self', 1, '', 'normal', 0),
                    ('core', ?, 'NAV.CHANNELS', ?, 'fa-solid fa-hashtag', 45, ?, 'main',
                     'CORE.SETTINGS.VIEW', '_self', 1, '', 'normal', 0)
            `, [
                guildId, `/guild/${guildId}/settings/roles`,    `/guild/${guildId}/settings`,
                guildId, `/guild/${guildId}/settings/channels`, `/guild/${guildId}/settings`
            ]);
        }
    }
};
