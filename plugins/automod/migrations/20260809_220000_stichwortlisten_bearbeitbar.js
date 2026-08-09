'use strict';

const fs = require('fs');
const path = require('path');

const VORLAGEN_VERZEICHNIS = path.join(__dirname, '..', 'bot', 'data', 'keyword_lists');

/**
 * Stichwortlisten bearbeitbar machen.
 *
 * Bis heute lagen die fünf Listen als Dateien in
 * `plugins/automod/bot/data/keyword_lists/`. Das Dashboard bekam davon nur die
 * Anzahl zu sehen — `getAvailableKeywordLists()` lieferte absichtlich kein
 * einziges Wort. Man konnte eine Liste an- oder abschalten, sonst nichts. In
 * den versionierten Plugin-Ordner zu schreiben ginge ohnehin nicht, jedes
 * Update überschriebe es.
 *
 * ## Die Entscheidung
 *
 * Zuerst war ein Modell mit zwei Ebenen geplant: Systemlisten bleiben Dateien,
 * daneben eigene Listen, dazu je Guild eine Ausnahmeliste für Falschtreffer.
 *
 * Der User hat das am 2026-08-09 verworfen, mit dem besseren Argument: Wenn es
 * einen vollständigen Satz in diesen Kategorien gibt und der ohnehin je Guild
 * verwaltet wird, dann ist genau das die Personalisierung — ein Bestand, der
 * **anfangs befüllt** ist und den jede Guild pflegen **kann, aber nicht muss**.
 *
 * Die Ausnahmeliste war ohnehin nur ein Notbehelf dafür, dass man nicht
 * bearbeiten darf. Wer bearbeiten kann, löscht das Wort einfach. Damit fallen
 * eine Tabelle, eine Bedienoberfläche und ein Sonderfall in der Trefferprüfung
 * weg.
 *
 * ## Was diese Migration tut
 *
 * 1. Legt die beiden Tabellen an.
 * 2. **Befüllt jede vorhandene Guild aus den Vorlagen** — mit genau dem
 *    Ein-/Aus-Zustand, den sie heute hat. Eine Liste, die in
 *    `active_keyword_lists` steht, kommt eingeschaltet an; alle anderen
 *    ausgeschaltet. Am Verhalten ändert sich dadurch nichts.
 * 3. Löst `automod_settings.active_keyword_lists` ab. Die Spalte sagte
 *    dasselbe wie das neue `enabled` je Liste — zwei Mechanismen für eine
 *    Sache, dasselbe Muster wie bei der doppelten Kanal-Whitelist.
 *
 * Neue Guilds werden nicht hier befüllt, sondern beim Einschalten des Plugins
 * (`onGuildEnable`). `keyword_lists_seeded_at` hält fest, dass es geschehen
 * ist — sonst bekäme eine Guild, die ihre Listen bewusst gelöscht hat, sie beim
 * nächsten Start wieder.
 *
 * ## Die Trefferart
 *
 * Der Vergleich war `lowerContent.includes(kw)` — eine reine
 * Teilzeichenkette. In `en_slurs` stehen sieben Einträge mit höchstens vier
 * Zeichen, der kürzeste hat drei; die schlagen mitten in harmlosen Wörtern an.
 * Jeder Eintrag bekommt deshalb eine Trefferart, Vorgabe `word`.
 */
module.exports = {
    description: 'Stichwortlisten je Guild bearbeitbar machen, aus den Vorlagen befüllen',

    async up(db) {
        // ── Tabellen ────────────────────────────────────────────────────
        await db.query(`
            CREATE TABLE IF NOT EXISTS automod_keyword_lists (
                id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                guild_id VARCHAR(20) NOT NULL,
                name VARCHAR(100) NOT NULL,
                description VARCHAR(255) DEFAULT NULL,
                language VARCHAR(10) DEFAULT NULL,
                template_id VARCHAR(64) DEFAULT NULL COMMENT 'Kennung der Vorlage, aus der die Liste stammt',
                enabled BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uk_guild_name (guild_id, name),
                INDEX idx_guild (guild_id),
                INDEX idx_guild_template (guild_id, template_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS automod_keywords (
                id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                list_id INT UNSIGNED NOT NULL,
                keyword VARCHAR(190) NOT NULL,
                match_type ENUM('word', 'contains', 'prefix') NOT NULL DEFAULT 'word',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uk_list_keyword (list_id, keyword),
                INDEX idx_list (list_id),
                CONSTRAINT fk_automod_keywords_list
                    FOREIGN KEY (list_id) REFERENCES automod_keyword_lists (id)
                    ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        await db.query(`
            ALTER TABLE automod_settings
            ADD COLUMN IF NOT EXISTS keyword_lists_seeded_at TIMESTAMP NULL DEFAULT NULL
        `);

        // ── Vorlagen einlesen ───────────────────────────────────────────
        const vorlagen = leseVorlagen();
        if (vorlagen.length === 0) {
            // Ohne Vorlagen gibt es nichts zu befüllen. Die Tabellen stehen,
            // eigene Listen lassen sich von Hand anlegen.
            return;
        }

        // ── Bestehende Guilds befüllen ──────────────────────────────────
        const guilds = await db.query(
            'SELECT guild_id, active_keyword_lists FROM automod_settings WHERE keyword_lists_seeded_at IS NULL'
        );

        for (const { guild_id, active_keyword_lists } of guilds || []) {
            const aktive = new Set(leseAktive(active_keyword_lists));

            for (const vorlage of vorlagen) {
                // Eine gleichnamige Liste kann es nur geben, wenn die Migration
                // schon einmal lief - dann nichts anfassen.
                const ergebnis = await db.query(`
                    INSERT IGNORE INTO automod_keyword_lists
                        (guild_id, name, description, language, template_id, enabled)
                    VALUES (?, ?, ?, ?, ?, ?)
                `, [
                    guild_id,
                    vorlage.name,
                    vorlage.description || null,
                    vorlage.language || null,
                    vorlage.id,
                    aktive.has(vorlage.id) ? 1 : 0
                ]);

                const listId = ergebnis?.insertId;
                if (!listId) continue;

                for (const wort of vorlage.keywords) {
                    await db.query(
                        'INSERT IGNORE INTO automod_keywords (list_id, keyword, match_type) VALUES (?, ?, ?)',
                        [listId, String(wort).trim(), 'word']
                    );
                }
            }

            await db.query(
                'UPDATE automod_settings SET keyword_lists_seeded_at = NOW() WHERE guild_id = ?',
                [guild_id]
            );
        }

        // ── Alte Spalte ablösen ─────────────────────────────────────────
        // Sie sagte dasselbe wie `enabled` je Liste. Der Inhalt ist oben
        // übernommen worden.
        await db.query('ALTER TABLE automod_settings DROP COLUMN IF EXISTS active_keyword_lists');
    },

    /**
     * Zurück: die alte Spalte wiederherstellen und aus den eingeschalteten
     * Listen füllen, danach die neuen Tabellen entfernen.
     */
    async down(db) {
        await db.query(`
            ALTER TABLE automod_settings
            ADD COLUMN IF NOT EXISTS active_keyword_lists JSON DEFAULT NULL
        `);

        const zeilen = await db.query(`
            SELECT guild_id, template_id
            FROM automod_keyword_lists
            WHERE enabled = 1 AND template_id IS NOT NULL
        `);

        const jeGuild = new Map();
        for (const { guild_id, template_id } of zeilen || []) {
            if (!jeGuild.has(guild_id)) jeGuild.set(guild_id, []);
            jeGuild.get(guild_id).push(template_id);
        }

        for (const [guildId, ids] of jeGuild) {
            await db.query(
                'UPDATE automod_settings SET active_keyword_lists = ? WHERE guild_id = ?',
                [JSON.stringify(ids), guildId]
            );
        }

        await db.query('ALTER TABLE automod_settings DROP COLUMN IF EXISTS keyword_lists_seeded_at');
        await db.query('DROP TABLE IF EXISTS automod_keywords');
        await db.query('DROP TABLE IF EXISTS automod_keyword_lists');
    }
};

/**
 * Vorlagen aus dem Dateiverzeichnis lesen.
 *
 * @returns {Array<{id, name, description, language, keywords: string[]}>}
 */
function leseVorlagen() {
    if (!fs.existsSync(VORLAGEN_VERZEICHNIS)) return [];

    const vorlagen = [];

    for (const datei of fs.readdirSync(VORLAGEN_VERZEICHNIS).filter(f => f.endsWith('.json'))) {
        try {
            const inhalt = JSON.parse(fs.readFileSync(path.join(VORLAGEN_VERZEICHNIS, datei), 'utf-8'));
            if (inhalt.id && Array.isArray(inhalt.keywords)) vorlagen.push(inhalt);
        } catch {
            // Eine unlesbare Vorlage darf die Migration nicht aufhalten.
        }
    }

    return vorlagen;
}

/**
 * `active_keyword_lists` liegt je nach Herkunft als JSON-Text oder als Array vor.
 *
 * @param {string|Array|null} wert
 * @returns {string[]}
 */
function leseAktive(wert) {
    if (!wert) return [];
    if (Array.isArray(wert)) return wert;
    try {
        const gelesen = JSON.parse(wert);
        return Array.isArray(gelesen) ? gelesen : [];
    } catch {
        return [];
    }
}
