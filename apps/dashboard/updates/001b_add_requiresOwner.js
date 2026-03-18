/**
 * Kern-Update 001b: requiresOwner Spalte zu guild_nav_items
 *
 * Stellt sicher, dass die requiresOwner-Spalte existiert.
 * (War vorher in Migration 6.7.1, die evtl. auf der alten Tabelle lief)
 */
module.exports = {
    version: "7.0.0",
    description: "requiresOwner Spalte in guild_nav_items sicherstellen",

    async run(dbService, { Logger }) {
        const [columns] = await dbService.pool.execute(`
            SELECT COLUMN_NAME 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_SCHEMA = DATABASE() 
            AND TABLE_NAME = 'guild_nav_items' 
            AND COLUMN_NAME = 'requiresOwner'
        `);

        if (columns.length > 0) {
            Logger.debug("[Update 001b] Spalte requiresOwner existiert bereits.");
            return;
        }

        await dbService.pool.execute(`
            ALTER TABLE guild_nav_items 
            ADD COLUMN requiresOwner TINYINT(1) DEFAULT 0 
            COMMENT 'Wenn TRUE: Nur Bot-Owner (OWNER_IDS) können dieses Nav-Item sehen'
        `);

        Logger.success("[Update 001b] ✓ requiresOwner Spalte hinzugefügt");
    },
};
