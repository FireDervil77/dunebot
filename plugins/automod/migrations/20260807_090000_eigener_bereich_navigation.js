'use strict';

/**
 * AutoMod bekommt einen eigenen Bereich statt eines einzelnen Menuepunkts.
 *
 * Warum diese Migration ueberhaupt noetig ist: Navigation wird nur in
 * `onGuildEnable` geschrieben, und `onUpdate` ruft im ganzen Projekt niemand
 * auf - die Plugins definieren den Haken, aber es gibt keinen Aufrufer. Ein
 * geaendertes Menue erreicht bestehende Guilds also nur ueber die Datenbank.
 *
 * Vorher (je Guild eine Zeile):
 *   AutoMod -> /plugins/automod/settings, direkt unter der Guild
 *
 * Nachher:
 *   AutoMod (Hauptpunkt) mit sieben Unterpunkten,
 *   plus der Einstellungseintrag unter den Kern-Einstellungen.
 */

/** Die Unterpunkte in der Reihenfolge, in der sie im Menue stehen sollen. */
const UNTERPUNKTE = [
    ['automod:NAV.DASHBOARD',  '/dashboard',  'fa-solid fa-gauge-high',    10, 'AUTOMOD.VIEW'],
    ['automod:NAV.FILTER',     '/filter',     'fa-solid fa-filter',        20, 'AUTOMOD.VIEW'],
    ['automod:NAV.RULES',      '/regeln',     'fa-solid fa-code',          30, 'AUTOMOD.VIEW'],
    ['automod:NAV.ESCALATION', '/eskalation', 'fa-solid fa-stairs',        40, 'AUTOMOD.VIEW'],
    ['automod:NAV.EXEMPTIONS', '/ausnahmen',  'fa-solid fa-user-check',    50, 'AUTOMOD.VIEW'],
    ['automod:NAV.RAID',       '/raid',       'fa-solid fa-shield-virus',  60, 'AUTOMOD.VIEW'],
    ['automod:NAV.LOGS',       '/protokoll',  'fa-solid fa-file-lines',    70, 'AUTOMOD.LOGS.VIEW']
];

/**
 * Naechste freie Hauptmenue-Reihenfolge einer Guild.
 *
 * Der NavigationManager vergibt Hauptpunkten 1000er-Bereiche. Wir haengen uns
 * hinten an, damit AutoMod nicht zwischen bestehende Punkte rutscht. Der
 * Bereich ab 90000 ist fuer das System reserviert und bleibt frei.
 *
 * @param {Object} db Datenbankdienst
 * @param {string} guildId Discord-Guild-ID
 * @returns {Promise<number>} Reihenfolge fuer den Hauptpunkt
 */
async function naechsterHauptbereich(db, guildId) {
    const zeilen = await db.query(
        `SELECT MAX(sort_order) AS hoechste
           FROM guild_nav_items
          WHERE guildId = ? AND parent IS NULL AND type = 'main' AND sort_order < 90000`,
        [guildId]
    );

    const hoechste = zeilen?.[0]?.hoechste || 0;
    return (Math.floor(hoechste / 1000) + 1) * 1000;
}

module.exports = {
    description: 'AutoMod: eigener Navigationsbereich statt Einzeleintrag',

    async up(db) {
        // Grundlage ist, wo AutoMod eingeschaltet ist - nicht, wo zufaellig
        // noch eine Menuezeile steht. Eine Guild kann das Plugin aktiv haben,
        // ohne dass die Navigation je geschrieben wurde; und eine abgeschaltete
        // Guild soll auch kein neues Menue bekommen.
        const guilds = await db.query(
            `SELECT DISTINCT guild_id AS guildId
               FROM guild_plugins
              WHERE plugin_name = 'automod' AND is_enabled = 1`
        );

        for (const { guildId } of guilds) {
            const basis = `/guild/${guildId}/plugins/automod`;

            // Alte Eintraege weg. registerNavigation ueberspringt vorhandene
            // Zeilen, loescht aber nie - ohne das hier bliebe der alte
            // Einzeleintrag neben dem neuen Bereich stehen.
            await db.query(`DELETE FROM guild_nav_items WHERE plugin = 'automod' AND guildId = ?`, [guildId]);

            const bereich = await naechsterHauptbereich(db, guildId);

            // Hauptpunkt
            await db.query(
                `INSERT INTO guild_nav_items
                    (plugin, guildId, title, url, icon, sort_order, parent, type, capability, target, visible, classes, position, requiresOwner, createdAt, updatedAt)
                 VALUES ('automod', ?, 'automod:NAV.AUTOMOD', ?, 'fa-solid fa-shield-halved', ?, NULL, 'main', 'AUTOMOD.VIEW', '_self', 1, '', 'normal', 0, NOW(), NOW())`,
                [guildId, basis, bereich]
            );

            // Unterpunkte
            for (const [titel, pfad, icon, reihenfolge, recht] of UNTERPUNKTE) {
                await db.query(
                    `INSERT INTO guild_nav_items
                        (plugin, guildId, title, url, icon, sort_order, parent, type, capability, target, visible, classes, position, requiresOwner, createdAt, updatedAt)
                     VALUES ('automod', ?, ?, ?, ?, ?, ?, 'main', ?, '_self', 1, '', 'normal', 0, NOW(), NOW())`,
                    [guildId, titel, basis + pfad, icon, reihenfolge, basis, recht]
                );
            }

            // Einstellungsseite bleibt unter den Kern-Einstellungen haengen
            await db.query(
                `INSERT INTO guild_nav_items
                    (plugin, guildId, title, url, icon, sort_order, parent, type, capability, target, visible, classes, position, requiresOwner, createdAt, updatedAt)
                 VALUES ('automod', ?, 'automod:NAV.AUTOMOD', ?, 'fa-solid fa-shield-halved', 80, ?, 'main', 'AUTOMOD.VIEW', '_self', 1, '', 'normal', 0, NOW(), NOW())`,
                [guildId, `${basis}/settings`, `/guild/${guildId}/settings`]
            );
        }
    },

    async down(db) {
        // Zurueck auf den einzelnen Eintrag unter der Guild
        const guilds = await db.query(
            `SELECT DISTINCT guild_id AS guildId
               FROM guild_plugins
              WHERE plugin_name = 'automod' AND is_enabled = 1`
        );

        for (const { guildId } of guilds) {
            await db.query(`DELETE FROM guild_nav_items WHERE plugin = 'automod' AND guildId = ?`, [guildId]);

            await db.query(
                `INSERT INTO guild_nav_items
                    (plugin, guildId, title, url, icon, sort_order, parent, type, capability, target, visible, classes, position, requiresOwner, createdAt, updatedAt)
                 VALUES ('automod', ?, 'automod:NAV.AUTOMOD', ?, 'fa-solid fa-shield-halved', 70, ?, 'main', 'AUTOMOD.VIEW', '_self', 1, '', 'normal', 0, NOW(), NOW())`,
                [guildId, `/guild/${guildId}/plugins/automod/settings`, `/guild/${guildId}`]
            );
        }
    }
};
