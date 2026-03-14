/**
 * Migration 1.1.0: RootServer Features (MySQL, Backups, Webhosting)
 * 
 * Erweitert die rootserver Tabelle um Felder für:
 * - MySQL Support (Enabled + Limits)
 * - Backup Limits
 * - Webhosting (Domain)
 * 
 * @version 1.1.0
 */

module.exports = {
    version: '1.1.0',
    name: 'RootServer Features',

    async up(dbService, guildId) {
        const Logger = require('dunebot-core').ServiceManager.get('Logger');
        Logger.info(`[Masterserver Migration 1.1.0] Adding RootServer features...`);

        try {
            // 1. Spalten zur rootserver Tabelle hinzufügen
            // Wir nutzen ADD COLUMN IF NOT EXISTS (MySQL 8.0+) oder prüfen vorher
            // Da wir native MySQL Queries nutzen, machen wir es robust mit try-catch pro Spalte oder einem Block

            const columns = [
                "ADD COLUMN mysql_enabled BOOLEAN DEFAULT FALSE",
                "ADD COLUMN mysql_db_limit INT DEFAULT 0",
                "ADD COLUMN backup_limit INT DEFAULT 3",
                "ADD COLUMN web_domain VARCHAR(255) DEFAULT NULL"
            ];

            for (const col of columns) {
                try {
                    await dbService.query(`ALTER TABLE rootserver ${col}`);
                } catch (err) {
                    // Ignorieren wenn Spalte schon existiert (Error 1060)
                    if (err.code !== 'ER_DUP_FIELDNAME') {
                        throw err;
                    }
                }
            }

            // 2. Tabelle für belegte Ports erstellen (für Auto-Port-Management)
            await dbService.query(`
                CREATE TABLE IF NOT EXISTS rootserver_ports (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    rootserver_id INT NOT NULL,
                    ip_address VARCHAR(45) NOT NULL,
                    port INT NOT NULL,
                    protocol ENUM('tcp', 'udp') DEFAULT 'tcp',
                    service_name VARCHAR(100) DEFAULT NULL, -- z.B. "csgo-server-1"
                    reserved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (rootserver_id) REFERENCES rootserver(id) ON DELETE CASCADE,
                    UNIQUE KEY unique_port (rootserver_id, ip_address, port, protocol)
                )
            `);

            Logger.success(`[Masterserver Migration 1.1.0] Successfully applied!`);
            return { success: true };

        } catch (error) {
            Logger.error(`[Masterserver Migration 1.1.0] Failed:`, error);
            throw error;
        }
    },

    async down(dbService, guildId) {
        // Rollback logic
        await dbService.query(`ALTER TABLE rootserver DROP COLUMN mysql_enabled`);
        await dbService.query(`ALTER TABLE rootserver DROP COLUMN mysql_db_limit`);
        await dbService.query(`ALTER TABLE rootserver DROP COLUMN backup_limit`);
        await dbService.query(`ALTER TABLE rootserver DROP COLUMN web_domain`);
        await dbService.query(`DROP TABLE IF EXISTS rootserver_ports`);
    }
};
