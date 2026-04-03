'use strict';

module.exports = {
    description: 'Fügt cpu_percent, ram_used_mb, ram_total_mb Spalten zu server_registry hinzu für Live-Metriken',

    async up(db) {
        await db.query(`
            ALTER TABLE server_registry
                ADD COLUMN IF NOT EXISTS cpu_percent DECIMAL(5,2) DEFAULT NULL COMMENT 'Aktuelle CPU-Auslastung in Prozent',
                ADD COLUMN IF NOT EXISTS ram_used_mb INT DEFAULT NULL COMMENT 'Aktuell genutzter RAM in MB',
                ADD COLUMN IF NOT EXISTS ram_total_mb INT DEFAULT NULL COMMENT 'Zugewiesener RAM in MB (Quota)'
        `);
    },

    async down(db) {
        await db.query(`
            ALTER TABLE server_registry
                DROP COLUMN IF EXISTS cpu_percent,
                DROP COLUMN IF EXISTS ram_used_mb,
                DROP COLUMN IF EXISTS ram_total_mb
        `);
    }
};
