'use strict';

/**
 * `packages` verliert `visibility` und `guild_id` (E4, entschieden 2026-08-18).
 *
 * ── Warum ────────────────────────────────────────────────────────────────────
 *
 * Die Vorgängermigration (20260816_120000) hat die vier Sichtbarkeitsstufen aus
 * `addon_marketplace` übernommen — official/public/unlisted/private, dazu
 * `guild_id` für den privaten Fall. Das war eine Übernahme aus Gewohnheit, keine
 * Entscheidung.
 *
 * Der Betreiber hat sie am 2026-08-18 getroffen, und die Begründung ist die
 * bessere:
 *
 *   „Wenn ich die Pakete privat erstellen kann, dann gehen uns vielleicht
 *    wertvolle Informationen verloren. Die anderen machen bei ihren Spielen
 *    selber und bewusst besser als wir. Das sollte man anerkennen und nicht
 *    hinter einem privaten Schalter verstecken. Für solche, die sich das nicht
 *    zutrauen — die würden so ein Ding eh nie von Hand bauen."
 *
 * ── Warum das nichts kaputt macht ────────────────────────────────────────────
 *
 * Nachgemessen am 2026-08-18 in `addon_marketplace`, dem Vorbild dieser Spalten:
 *
 *     guild_id     NULL bei ALLEN 23 Paketen
 *     visibility   public 21 · official 2 — private und unlisted NIE benutzt
 *     status       approved 23 — der draft/review-Ablauf nie gelaufen
 *     trust_level  official 23
 *
 * Die private, guild-eigene Sichtbarkeit hat in der ganzen Laufzeit des Systems
 * kein einziges Mal stattgefunden. Hier wird also keine Möglichkeit gestrichen,
 * sondern eine, die nie eine war.
 *
 * `packages` und `package_versions` sind beide leer (geprüft vor dem Schreiben
 * dieser Migration) — es gibt keine Daten, die den Verlust spüren könnten.
 *
 * ── Was AUSDRÜCKLICH bleibt ──────────────────────────────────────────────────
 *
 * **`draft` ist nicht `private`.** Ein unfertiges Paket muss verborgen bleiben,
 * solange daran gearbeitet wird — die Werkbank (Stufe 7) erzeugt genau solche
 * Zwischenstände. Dafür ist `package_versions` zuständig, nicht `packages`:
 * `channel` (test/stable) plus `test_passed_at` und `released_at` tragen den
 * Veröffentlichungsweg aus E-17. Diese Migration fasst sie nicht an.
 *
 * `author_user_id` bleibt ebenfalls. Wer ein Paket gemacht hat, ist eine nützliche
 * Auskunft — im Gegensatz zu der Frage, wer es sehen darf. Ein Abzeichen
 * „offiziell" liesse sich daraus ableiten, wenn es je gebraucht wird; eine eigene
 * Spalte dafür anzulegen, bevor irgendetwas sie anzeigt, wäre genau das Theater,
 * das hier gerade abgeräumt wird.
 *
 * ── Reihenfolge der Schritte ────────────────────────────────────────────────
 *
 * Die CHECK-Bedingung zuerst: Sie liest beide Spalten, und MariaDB lässt eine
 * Spalte nicht fallen, auf die eine Bedingung noch zeigt. Die Indizes gehen mit
 * ihren Spalten von selbst, werden aber ausdrücklich genannt — eine Migration,
 * die sich auf Nebenwirkungen verlässt, ist beim nächsten Datenbankwechsel eine
 * Überraschung.
 */
module.exports = {
    description: 'packages: visibility und guild_id entfernen — ein Katalog für alle (E4)',

    async up(db) {
        const [spalten] = await db.query("SHOW COLUMNS FROM packages LIKE 'visibility'");
        if (spalten.length === 0) return; // schon geschehen

        // 1. Die Bedingung, die beide Spalten liest
        await db.query('ALTER TABLE packages DROP CONSTRAINT IF EXISTS chk_private_guild');

        // 2. Die Indizes, ausdrücklich statt als Nebenwirkung
        await db.query('ALTER TABLE packages DROP INDEX IF EXISTS idx_visibility');
        await db.query('ALTER TABLE packages DROP INDEX IF EXISTS idx_guild');

        // 3. Die Spalten
        await db.query('ALTER TABLE packages DROP COLUMN visibility');
        await db.query('ALTER TABLE packages DROP COLUMN guild_id');
    },

    async down(db) {
        const [spalten] = await db.query("SHOW COLUMNS FROM packages LIKE 'visibility'");
        if (spalten.length > 0) return; // schon geschehen

        await db.query(`
            ALTER TABLE packages
                ADD COLUMN visibility ENUM('official','public','unlisted','private')
                    NOT NULL DEFAULT 'public' AFTER category,
                ADD COLUMN guild_id VARCHAR(20) DEFAULT NULL
                    COMMENT 'Nur bei visibility=private: wer es sehen darf' AFTER visibility
        `);
        await db.query('ALTER TABLE packages ADD INDEX idx_visibility (visibility)');
        await db.query('ALTER TABLE packages ADD INDEX idx_guild (guild_id)');
        await db.query(`
            ALTER TABLE packages ADD CONSTRAINT chk_private_guild
                CHECK (visibility <> 'private' OR guild_id IS NOT NULL)
        `);
    }
};
