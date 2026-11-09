'use strict';

/**
 * Anleitung je Spiel: Welcher Artikel der Wissensdatenbank gehört zu welchem
 * Spielpaket (2026-11-09, Wunsch des Betreibers: „gezieltere Hilfe“).
 *
 * Auf den Seiten eines Servers zeigt „Hilfe“ dann auf die Anleitung seines
 * Spiels statt auf den Steckbrief des Gameserver-Plugins. Die Zuordnung sitzt
 * am Artikel, wie beim Plugin (Betreiber: „Doch am Artikel“ — ein Feld am
 * Paket wirkte erst mit einer geprüften Fassung).
 *
 * Gespeichert wird die Kennung des Pakets (`addon_marketplace.id`, gleich
 * `packages.id` und `gameservers.addon_marketplace_id`), nicht das Kürzel.
 * Gemessen: Vier Paketkürzel weichen vom Artikel ab (`7day2die`,
 * `corekeeper`, `etlegacy`, `windorse` mit Tippfehler). Deshalb steht die
 * Liste hier ausdrücklich; für Windrose gilt auch das richtig geschriebene
 * Kürzel, falls es inzwischen korrigiert ist.
 *
 * Ohne Gameserver-Plugin (keine Tabelle `addon_marketplace`) entsteht nur die
 * Spalte. Ein Spiel, das schon einen Artikel hat, bleibt, wie es ist.
 */

const ANLEITUNGEN = [
    ['7-days-to-die', ['7day2die']], ['astro-colony', ['astro-colony']], ['core-keeper', ['corekeeper']],
    ['craftopia', ['craftopia']], ['enshrouded', ['enshrouded']], ['et-legacy', ['etlegacy']],
    ['factorio', ['factorio']], ['hytale', ['hytale']], ['icarus', ['icarus']],
    ['minecraft', ['minecraft']], ['satisfactory', ['satisfactory']], ['starrupture', ['starrupture']],
    ['valheim', ['valheim']], ['windrose', ['windrose', 'windorse']],
];

module.exports = {
    description: 'Wissensdatenbank: Anleitung je Spielpaket am Artikel',
    ANLEITUNGEN,

    async up(db) {
        await db.query(`ALTER TABLE kb_articles
            ADD COLUMN IF NOT EXISTS spiel INT UNSIGNED NULL DEFAULT NULL
                COMMENT 'addon_marketplace.id: auf den Seiten eines Servers dieses Spiels zeigt „Hilfe“ hierher' AFTER plugin,
            ADD UNIQUE KEY IF NOT EXISTS uq_kb_articles_spiel (spiel)`);

        const da = await db.query(
            `SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'addon_marketplace'`);
        if (!da.length) return;

        for (const [artikel, kuerzel] of ANLEITUNGEN) {
            const [paket] = await db.query(
                `SELECT id FROM addon_marketplace WHERE slug IN (${kuerzel.map(() => '?').join(', ')}) ORDER BY id LIMIT 1`, kuerzel);
            if (!paket) continue;
            const vergeben = await db.query('SELECT id FROM kb_articles WHERE spiel = ?', [paket.id]);
            if (vergeben.length) continue;
            await db.query(
                `UPDATE kb_articles a JOIN kb_categories c ON c.id = a.category_id
                    SET a.spiel = ?
                  WHERE c.slug = 'spiele' AND a.slug = ? AND a.spiel IS NULL`, [paket.id, artikel]);
        }
    },

    async down(db) {
        await db.query(`ALTER TABLE kb_articles
            DROP INDEX IF EXISTS uq_kb_articles_spiel,
            DROP COLUMN IF EXISTS spiel`);
    }
};
