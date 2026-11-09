'use strict';

/**
 * Hilfe im Dashboard: Welcher Artikel der Wissensdatenbank gehört zu welchem
 * Plugin (K290, 2026-11-09).
 *
 * Bisher konnte nur ein ganzer BEREICH einem Plugin gehören
 * (`kb_categories.plugin`). Gesetzt war das einzig bei „gameserver“, gelesen
 * hat es außer der Verwaltung niemand. Die anderen Plugins haben je einen
 * Steckbrief im Bereich „Plugins“, und auch Gameserver und Masterserver
 * haben dort einen, der in ihre Bereiche verweist. Deshalb sitzt die
 * Zuordnung jetzt am Artikel: höchstens ein Artikel je Plugin. Das Feld am
 * Bereich fällt weg, damit es nur einen Weg gibt (Betreiber, 2026-11-09).
 *
 * Vorbelegt werden die zwölf Steckbriefe. Die Kürzel passen nicht überall
 * zum Namen des Plugins (music → `musik`, ticket → `tickets`), deshalb steht
 * die Liste hier ausdrücklich und wird nicht aus dem Kürzel geraten. Fehlt
 * ein Artikel oder hat das Plugin schon einen, bleibt die Zeile, wie sie
 * ist — die Migration überschreibt keine Wahl aus der Verwaltung.
 */

const STECKBRIEFE = [
    ['automod', 'automod'], ['discord', 'discord'], ['dunemap', 'dunemap'],
    ['gameserver', 'gameserver'], ['giveaway', 'giveaway'], ['greeting', 'greeting'],
    ['information', 'information'], ['masterserver', 'masterserver'], ['moderation', 'moderation'],
    ['music', 'musik'], ['streaming', 'streaming'], ['ticket', 'tickets'],
];

module.exports = {
    description: 'Wissensdatenbank: Hilfe-Zuordnung vom Bereich an den Artikel',
    STECKBRIEFE,

    async up(db) {
        await db.query(`ALTER TABLE kb_articles
            ADD COLUMN IF NOT EXISTS plugin VARCHAR(60) NULL DEFAULT NULL
                COMMENT 'Plugin, auf dessen Dashboard-Seiten „Hilfe“ hierher zeigt' AFTER sort_order,
            ADD UNIQUE KEY IF NOT EXISTS uq_kb_articles_plugin (plugin)`);

        for (const [plugin, kuerzel] of STECKBRIEFE) {
            const vergeben = await db.query('SELECT id FROM kb_articles WHERE plugin = ?', [plugin]);
            if (vergeben.length) continue;
            await db.query(
                `UPDATE kb_articles a JOIN kb_categories c ON c.id = a.category_id
                    SET a.plugin = ?
                  WHERE c.slug = 'plugins' AND a.slug = ? AND a.plugin IS NULL`, [plugin, kuerzel]);
        }

        await db.query('ALTER TABLE kb_categories DROP COLUMN IF EXISTS plugin');
    },

    async down(db) {
        await db.query(`ALTER TABLE kb_categories
            ADD COLUMN IF NOT EXISTS plugin VARCHAR(60) NULL COMMENT 'Name des Plugins, dessen Hilfe dieser Bereich ist' AFTER sort_order`);
        await db.query(`UPDATE kb_categories SET plugin = 'gameserver' WHERE slug = 'gameserver' AND plugin IS NULL`);
        await db.query(`ALTER TABLE kb_articles
            DROP INDEX IF EXISTS uq_kb_articles_plugin,
            DROP COLUMN IF EXISTS plugin`);
    }
};
