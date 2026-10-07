'use strict';

/**
 * Die Tag-Bibliothek: `tags` und `tag_links` (Betreiber, 2026-10-07).
 *
 * Bis dahin trug das Spiel ein Textfeld „Tags (comma-separated)" in
 * `addon_marketplace.tags`. Jeder Eintrag erfand seine Tags neu, der
 * Adminbereich schrieb sie als JSON und die Spielseite zerlegte sie am Komma.
 * Jetzt gibt es jedes Tag einmal, und eine zweite Tabelle sagt, woran es hängt
 * (`apps/dashboard/helpers/Tags.js`).
 *
 * ── Warum im Kern ───────────────────────────────────────────────────────────
 *
 * Die Bibliothek gehört keinem Plugin: Heute hängen Spiele daran, später
 * sollen andere Bereiche andocken können (`entity_type`). Verknüpft wird nur
 * über Zahlen — kein Textvergleich über die Kollationsgrenze zu den Plugins.
 *
 * ── Der Umzug der vorhandenen Tags ─────────────────────────────────────────
 *
 * Er steht HIER und nicht in einer Migration des Gameserver-Plugins, obwohl
 * `addon_marketplace` dem Plugin gehört: Plugin-Migrationen laufen beim
 * Aktivieren, und eine, die an einer fehlenden Tabelle scheitert, nähme das
 * Plugin mit. So ist es ein Schritt — die Tabellen entstehen, und was es an
 * Tags gab, zieht im selben Zug um. Gibt es `addon_marketplace` nicht, gibt es
 * nichts umzuziehen.
 *
 * Gemessen am 2026-10-07: 8 Spiele, eines mit Tags (StarRupture: SCI-FI,
 * Fabrik-Aufbauspiel, CO-OP).
 *
 * `addon_marketplace.tags` BLEIBT stehen und wird nicht mehr gelesen. Eine
 * Migration, die die alte Quelle im selben Zug wegnimmt, macht jeden Fehler
 * unumkehrbar; die Spalte fällt mit dem Tabellenschnitt.
 */
module.exports = {
    description: 'Tag-Bibliothek: tags + tag_links, vorhandene Spiel-Tags ziehen um',

    async up(db) {
        await db.query(`
            CREATE TABLE IF NOT EXISTS tags (
                id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
                name        VARCHAR(40) NOT NULL COMMENT 'Schreibweise, wie sie gezeigt wird — die zuerst angelegte',
                slug        VARCHAR(40) NOT NULL COMMENT 'kleingeschrieben, vereinheitlicht — daran wird ein Tag wiedererkannt',
                created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                UNIQUE KEY uq_tags_slug (slug)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
              COMMENT='Tag-Bibliothek: jedes Tag einmal. Woran es hängt, steht in tag_links.'
        `);
        await db.query(`
            CREATE TABLE IF NOT EXISTS tag_links (
                tag_id       INT UNSIGNED NOT NULL,
                entity_type  VARCHAR(40) NOT NULL COMMENT 'Bereich: spiel (addon_marketplace.id); weitere docken an',
                entity_id    BIGINT UNSIGNED NOT NULL,
                created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (tag_id, entity_type, entity_id),
                KEY idx_tag_links_eintrag (entity_type, entity_id),
                CONSTRAINT fk_tag_links_tag FOREIGN KEY (tag_id) REFERENCES tags (id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
              COMMENT='Welches Tag an welchem Eintrag hängt.'
        `);

        // ── Vorhandene Spiel-Tags umziehen ──────────────────────────────────
        // **Nicht destrukturieren** — `db.query()` liefert die Zeilen direkt.
        const spalte = await db.query(`
            SELECT COLUMN_NAME FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'addon_marketplace' AND COLUMN_NAME = 'tags'`);
        if (!spalte.length) return;

        const spiele = await db.query(
            `SELECT id, tags FROM addon_marketplace WHERE tags IS NOT NULL AND tags <> '' AND tags <> '[]'`);
        for (const s of spiele) {
            // Beide Schreibweisen, die es gab: JSON-Liste (Adminbereich) und Kommatext.
            let namen;
            try {
                const j = JSON.parse(s.tags);
                namen = Array.isArray(j) ? j : String(s.tags).split(',');
            } catch { namen = String(s.tags).split(','); }

            const gesehen = new Set();
            for (const roh of namen) {
                const name = String(roh ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, 40);
                const slug = name.toLowerCase();
                if (!name || gesehen.has(slug)) continue;
                gesehen.add(slug);
                await db.query('INSERT INTO tags (name, slug) VALUES (?, ?) ON DUPLICATE KEY UPDATE id = id', [name, slug]);
                await db.query(
                    `INSERT IGNORE INTO tag_links (tag_id, entity_type, entity_id)
                     SELECT id, 'spiel', ? FROM tags WHERE slug = ?`, [s.id, slug]);
            }
        }
    },

    async down(db) {
        // Die alte Spalte wurde nie geleert — der Rückweg verliert nur, was
        // nach dem Umzug an Tags dazukam.
        await db.query('DROP TABLE IF EXISTS tag_links');
        await db.query('DROP TABLE IF EXISTS tags');
    }
};
