/**
 * Kern-Update 001: nav_items → guild_nav_items
 *
 * Benennt die Tabelle `nav_items` in `guild_nav_items` um.
 * Ist idempotent — prüft ob die alte Tabelle existiert.
 */
module.exports = {
    version: "7.0.0",
    description: "Tabelle nav_items in guild_nav_items umbenennen",

    async run(dbService, { Logger }) {
        // Prüfe ob alte Tabelle noch existiert
        const [tables] = await dbService.pool.execute(
            "SHOW TABLES LIKE 'nav_items'"
        );

        if (tables.length === 0) {
            Logger.debug("[Update 001] Tabelle nav_items existiert nicht mehr — bereits umbenannt.");
            return;
        }

        // Prüfe ob neue Tabelle bereits existiert (z.B. durch manuellen Eingriff)
        const [newTables] = await dbService.pool.execute(
            "SHOW TABLES LIKE 'guild_nav_items'"
        );

        if (newTables.length > 0) {
            // Beide existieren — alte droppen (Daten sollten in neuer sein)
            Logger.warn("[Update 001] Beide Tabellen existieren — lösche alte nav_items.");
            await dbService.pool.execute("DROP TABLE nav_items");
            return;
        }

        // Umbenennen
        await dbService.pool.execute("ALTER TABLE nav_items RENAME TO guild_nav_items");
        Logger.success("[Update 001] ✓ nav_items → guild_nav_items umbenannt");
    },
};
