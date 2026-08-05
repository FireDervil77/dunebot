'use strict';

/**
 * Menüpunkt „Channels" für Guilds nachtragen, die ihn nie bekommen haben.
 *
 * Die Core-Navigation wird von `registerKernNavigation()` erzeugt — aber nur
 * bei zwei Anlässen: wenn das Core-Plugin für eine Guild aktiviert wird, und
 * bei einem Core-Update. Der Eintrag NAV.CHANNELS kam später in die Definition
 * (apps/dashboard/helpers/KernNavigation.js, order 45). Guilds, die vorher
 * eingerichtet wurden, haben ihn deshalb nie erhalten und bekommen ihn auch
 * nicht von selbst.
 *
 * Zum Zeitpunkt dieser Migration hatten 2 von 11 Guilds den Eintrag — die
 * beiden, die nach der Änderung dazukamen. Alle anderen, darunter die
 * Kontroll-Guild, zeigten unter Einstellungen kein „Channels".
 *
 * Nachgetragen wird nur dort, wo die Core-Navigation schon existiert und der
 * Eintrag fehlt. Die Werte entsprechen genau der Definition.
 */
module.exports = {
    description: 'Menüpunkt Channels für bestehende Guilds nachtragen',

    async up(db) {
        // Guilds mit Core-Navigation, aber ohne Channels-Eintrag
        const guilds = await db.query(`
            SELECT DISTINCT n.guildId
            FROM guild_nav_items n
            WHERE n.plugin = 'core'
              AND n.parent = CONCAT('/guild/', n.guildId, '/settings')
              AND NOT EXISTS (
                  SELECT 1 FROM guild_nav_items c
                  WHERE c.plugin  = 'core'
                    AND c.guildId = n.guildId
                    AND c.url     = CONCAT('/guild/', n.guildId, '/settings/channels')
              )
        `);

        for (const { guildId } of guilds || []) {
            await db.query(`
                INSERT INTO guild_nav_items
                    (plugin, guildId, title, url, icon, sort_order, parent, type,
                     capability, target, visible, classes, position, requiresOwner)
                VALUES
                    ('core', ?, 'NAV.CHANNELS', ?, 'fa-solid fa-hashtag', 45, ?, 'main',
                     'CORE.SETTINGS.VIEW', '_self', 1, '', 'normal', 0)
            `, [
                guildId,
                `/guild/${guildId}/settings/channels`,
                `/guild/${guildId}/settings`
            ]);
        }
    },

    /**
     * Entfernt nur, was diese Migration angelegt haben kann — der Eintrag ist
     * über seine URL eindeutig.
     */
    async down(db) {
        await db.query(`
            DELETE FROM guild_nav_items
            WHERE plugin = 'core'
              AND title  = 'NAV.CHANNELS'
              AND url    = CONCAT('/guild/', guildId, '/settings/channels')
        `);
    }
};
