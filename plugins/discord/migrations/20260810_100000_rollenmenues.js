'use strict';

/**
 * Rollenmenüs: Reaktionen, Knöpfe und Auswahllisten.
 *
 * ## Warum hier und nicht in `greeting`
 *
 * Reaktionsrollen gab es bereits — in `greeting`, als
 * `greeting_reaction_panels` und `greeting_reaction_roles`. Die Analyse in
 * `docs/Plugin-Lueckenanalyse.md` hat sie als fehlend geführt; das war falsch,
 * gefunden am 2026-08-10.
 *
 * Sie stehen dort trotzdem am falschen Platz. `greeting` ist der Beitrittsweg:
 * Willkommensnachricht, Autorole, Einladungszähler, Verifizierung. Ein
 * Rollenmenü, aus dem sich Mitglieder Farben, Spiele oder Benachrichtigungen
 * aussuchen, hat mit dem Beitritt nichts zu tun — es wird Monate später
 * benutzt. Rollen gehören seit dem 2026-08-09 in `discord`.
 *
 * **Die Verifizierung per Reaktion bleibt in `greeting`.** Die gehört zum
 * Beitritt und benutzt eigene Spalten in `greeting_settings`, nicht diese
 * Tabellen.
 *
 * ## Was mit den alten Tabellen geschieht
 *
 * Sie werden übernommen und danach entfernt. Zum Zeitpunkt des Umbaus waren
 * **beide leer** (nachgesehen, nicht angenommen) — der Übernahmeteil läuft
 * also ins Leere und steht nur da, falls eine andere Installation sie doch
 * benutzt hat.
 *
 * ## Was neu ist
 *
 * Vorhanden war genau ein Verhalten: Reaktion setzen gibt die Rolle, Reaktion
 * wegnehmen nimmt sie. Das ist einer von vier Modi, die anderswo Standard sind:
 *
 * | Modus | Verhalten |
 * |---|---|
 * | `normal` | an/aus — das bisherige Verhalten |
 * | `einmalig` | gibt die Rolle, nimmt sie nie wieder |
 * | `eindeutig` | nur eine Rolle aus dem Menü; die vorige wird entzogen |
 * | `umgekehrt` | Reaktion **nimmt** die Rolle, Zurücknehmen gibt sie |
 *
 * Dazu die Darstellung: Reaktionen sind der alte Weg, Knöpfe und Auswahllisten
 * der heutige. Beide bleiben, weil viele Anleitungen noch auf Reaktionen zeigen.
 */
module.exports = {
    description: 'Rollenmenüs für das discord-Plugin, samt Übernahme aus greeting',

    async up(db) {
        await db.query(`
            CREATE TABLE IF NOT EXISTS discord_role_menus (
                id INT AUTO_INCREMENT PRIMARY KEY,
                guild_id VARCHAR(255) NOT NULL,
                channel_id VARCHAR(255) DEFAULT NULL,
                message_id VARCHAR(255) DEFAULT NULL
                    COMMENT 'Discord-Nachricht, sobald das Menü versendet wurde',
                title VARCHAR(255) NOT NULL DEFAULT 'Rollen',
                description TEXT DEFAULT NULL,
                color VARCHAR(7) DEFAULT '#5865F2',
                darstellung ENUM('reaktion','knopf','auswahl') NOT NULL DEFAULT 'knopf',
                modus ENUM('normal','einmalig','eindeutig','umgekehrt') NOT NULL DEFAULT 'normal',
                min_auswahl TINYINT UNSIGNED NOT NULL DEFAULT 0
                    COMMENT 'nur bei darstellung=auswahl',
                max_auswahl TINYINT UNSIGNED NOT NULL DEFAULT 25
                    COMMENT 'nur bei darstellung=auswahl',
                enabled TINYINT(1) NOT NULL DEFAULT 1,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_guild (guild_id),
                INDEX idx_message (message_id),
                FOREIGN KEY (guild_id) REFERENCES guilds(_id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // `position` bestimmt die Reihenfolge in der Nachricht. Ohne sie richtet
        // sich die Anzeige nach der Einfügereihenfolge, und ein nachträglich
        // ergänzter Eintrag landet immer unten — auch wenn er oben hingehört.
        await db.query(`
            CREATE TABLE IF NOT EXISTS discord_role_menu_options (
                id INT AUTO_INCREMENT PRIMARY KEY,
                menu_id INT NOT NULL,
                role_id VARCHAR(255) NOT NULL,
                emoji VARCHAR(100) DEFAULT NULL,
                label VARCHAR(80) DEFAULT NULL
                    COMMENT 'Beschriftung für Knopf und Auswahlliste; Discord erlaubt 80 Zeichen',
                description VARCHAR(100) DEFAULT NULL
                    COMMENT 'Zweite Zeile in der Auswahlliste; Discord erlaubt 100 Zeichen',
                stil ENUM('grau','blau','gruen','rot') NOT NULL DEFAULT 'grau'
                    COMMENT 'nur bei darstellung=knopf',
                position SMALLINT UNSIGNED NOT NULL DEFAULT 0,
                UNIQUE KEY uk_menu_role (menu_id, role_id),
                INDEX idx_menu_position (menu_id, position),
                FOREIGN KEY (menu_id) REFERENCES discord_role_menus(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // ── Übernahme aus greeting ───────────────────────────────────────
        if (!await tabelleExistiert(db, 'greeting_reaction_panels')) return;

        const panels = await db.query(
            'SELECT id, guild_id, channel_id, message_id, title, description, color FROM greeting_reaction_panels'
        );

        for (const panel of panels || []) {
            // Das alte Verhalten war ausschliesslich „Reaktion, an/aus".
            const ergebnis = await db.query(`
                INSERT INTO discord_role_menus
                    (guild_id, channel_id, message_id, title, description, color, darstellung, modus)
                VALUES (?, ?, ?, ?, ?, ?, 'reaktion', 'normal')
            `, [
                panel.guild_id,
                panel.channel_id,
                panel.message_id,
                panel.title || 'Rollen',
                panel.description,
                panel.color || '#5865F2'
            ]);

            const menuId = ergebnis.insertId;
            const eintraege = await db.query(
                'SELECT emoji, role_id, description FROM greeting_reaction_roles WHERE panel_id = ?',
                [panel.id]
            );

            let position = 0;
            for (const e of eintraege || []) {
                await db.query(`
                    INSERT IGNORE INTO discord_role_menu_options
                        (menu_id, role_id, emoji, description, position)
                    VALUES (?, ?, ?, ?, ?)
                `, [menuId, e.role_id, e.emoji, e.description, position++]);
            }
        }

        // Erst die Kinder, dann die Eltern — der Fremdschlüssel zeigt von
        // greeting_reaction_roles auf greeting_reaction_panels.
        await db.query('DROP TABLE IF EXISTS greeting_reaction_roles');
        await db.query('DROP TABLE IF EXISTS greeting_reaction_panels');
    },

    /**
     * Zurück: die alten Tabellen wieder anlegen und füllen.
     *
     * Verlustbehaftet, und das ist unvermeidbar — die alte Form kennt weder
     * Modi noch Knöpfe. Übernommen werden deshalb nur Menüs mit
     * `darstellung = 'reaktion'`; alles andere hat drüben keine Entsprechung
     * und würde als etwas ankommen, das es nicht ist.
     */
    async down(db) {
        await db.query(`
            CREATE TABLE IF NOT EXISTS greeting_reaction_panels (
                id INT AUTO_INCREMENT PRIMARY KEY,
                guild_id VARCHAR(255) NOT NULL,
                channel_id VARCHAR(255) DEFAULT NULL,
                message_id VARCHAR(255) DEFAULT NULL,
                title VARCHAR(255) DEFAULT 'Reaction Roles',
                description TEXT DEFAULT NULL,
                color VARCHAR(10) DEFAULT '#5865f2',
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_guild (guild_id),
                INDEX idx_message (message_id),
                FOREIGN KEY (guild_id) REFERENCES guilds(_id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS greeting_reaction_roles (
                id INT AUTO_INCREMENT PRIMARY KEY,
                panel_id INT NOT NULL,
                emoji VARCHAR(100) NOT NULL,
                role_id VARCHAR(255) NOT NULL,
                description VARCHAR(255) DEFAULT NULL,
                UNIQUE KEY uk_panel_emoji (panel_id, emoji),
                FOREIGN KEY (panel_id) REFERENCES greeting_reaction_panels(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        const menus = await db.query(
            "SELECT id, guild_id, channel_id, message_id, title, description, color FROM discord_role_menus WHERE darstellung = 'reaktion'"
        );

        for (const menu of menus || []) {
            const ergebnis = await db.query(`
                INSERT INTO greeting_reaction_panels
                    (guild_id, channel_id, message_id, title, description, color)
                VALUES (?, ?, ?, ?, ?, ?)
            `, [menu.guild_id, menu.channel_id, menu.message_id, menu.title, menu.description, menu.color]);

            const optionen = await db.query(
                'SELECT emoji, role_id, description FROM discord_role_menu_options WHERE menu_id = ?',
                [menu.id]
            );

            for (const o of optionen || []) {
                // Drüben ist `emoji` Pflicht und Teil des eindeutigen
                // Schlüssels — Einträge ohne Emoji lassen sich nicht abbilden.
                if (!o.emoji) continue;
                await db.query(`
                    INSERT IGNORE INTO greeting_reaction_roles (panel_id, emoji, role_id, description)
                    VALUES (?, ?, ?, ?)
                `, [ergebnis.insertId, o.emoji, o.role_id, o.description]);
            }
        }

        await db.query('DROP TABLE IF EXISTS discord_role_menu_options');
        await db.query('DROP TABLE IF EXISTS discord_role_menus');
    }
};

/**
 * @param {Object} db
 * @param {string} tabelle
 * @returns {Promise<boolean>}
 */
async function tabelleExistiert(db, tabelle) {
    const [treffer] = await db.query(`
        SELECT 1 AS da FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
    `, [tabelle]) || [];
    return Boolean(treffer);
}
