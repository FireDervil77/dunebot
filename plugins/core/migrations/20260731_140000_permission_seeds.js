'use strict';

/**
 * Merkt sich, welche Rechte einer Guild schon einmal angeboten wurden.
 *
 * Hintergrund: Bisher trug `PluginManager.registerPluginPermissions()` bei jedem
 * Start **alle** Rechte eines Plugins in die Administrator-Gruppe ein, sofern sie
 * dort nicht bereits auf `true` standen. Wer ein Recht bewusst entfernt hatte,
 * bekam es beim nächsten Neustart zurück – die Entscheidung des Admins hielt
 * genau bis zum nächsten Deploy.
 *
 * Künftig wird ein Recht **einmal** in die Gruppen eingetragen, die das Plugin
 * über `default_groups` benennt. Danach gehört es dem Betreiber. Diese Tabelle
 * ist das Gedächtnis dafür.
 *
 * Die Bestandsaufnahme unten ist der wichtige Teil: Alle heute bekannten Rechte
 * gelten für alle bestehenden Guilds als bereits angeboten. Ohne sie würde der
 * erste Start nach der Umstellung sämtliche Rechte neu verteilen – und damit
 * genau die Entfernungen rückgängig machen, die wir schützen wollen.
 */
module.exports = {
    description: 'permission-seeds-gedaechtnis',

    async up(db) {
        await db.query(`
            CREATE TABLE IF NOT EXISTS guild_permission_seeds (
                guild_id       VARCHAR(20)  NOT NULL,
                permission_key VARCHAR(100) NOT NULL,
                seeded_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (guild_id, permission_key),
                INDEX idx_guild (guild_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // Bestandsaufnahme: was es heute gibt, gilt als angeboten.
        const result = await db.query(`
            INSERT IGNORE INTO guild_permission_seeds (guild_id, permission_key)
            SELECT g.guild_id, p.permission_key
            FROM (SELECT DISTINCT guild_id FROM guild_groups) g
            CROSS JOIN (SELECT permission_key FROM permission_definitions WHERE is_active = 1) p
        `);

        const { ServiceManager } = require('dunebot-core');
        const Logger = ServiceManager.has('Logger') ? ServiceManager.get('Logger') : console;
        Logger.info(`[Migration] Bestandsaufnahme: ${result?.affectedRows ?? '?'} Guild/Recht-Paare als bereits angeboten vermerkt.`);
    },

    async down(db) {
        await db.query('DROP TABLE IF EXISTS guild_permission_seeds');
    }
};
