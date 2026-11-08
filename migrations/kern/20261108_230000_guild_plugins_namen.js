'use strict';

/**
 * Namen zu `enabled_by` und `disabled_by` (K158, 2026-11-08).
 *
 * Die Plugin-Seite zeigt, wer ein Plugin wann ein- oder abschaltete. Die
 * Tabelle `users` kennt nur Discord-IDs, einen Namensspeicher gibt es nicht.
 * Deshalb wird der Name beim Schalten mitgeschrieben — aus der Anmeldung im
 * Dashboard oder aus Discord bei `/plugin status`. Er ist der Name von damals;
 * benennt sich jemand um, bleibt der alte stehen.
 */
module.exports = {
    async up(db) {
        await db.query(`ALTER TABLE guild_plugins
            ADD COLUMN IF NOT EXISTS enabled_by_name VARCHAR(100) DEFAULT NULL
                COMMENT 'Name beim Einschalten, wie Discord ihn damals nannte' AFTER enabled_by,
            ADD COLUMN IF NOT EXISTS disabled_by_name VARCHAR(100) DEFAULT NULL
                COMMENT 'Name beim Abschalten' AFTER disabled_by`);
    },

    async down(db) {
        await db.query(`ALTER TABLE guild_plugins
            DROP COLUMN IF EXISTS enabled_by_name,
            DROP COLUMN IF EXISTS disabled_by_name`);
    }
};
