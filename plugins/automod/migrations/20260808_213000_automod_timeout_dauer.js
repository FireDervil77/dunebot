'use strict';

/**
 * Die Dauer der Hauptaktion war nirgends einstellbar.
 *
 * `automod_settings.action` sagt, **was** bei Erreichen von `max_strikes`
 * passiert (TIMEOUT, KICK, BAN) - aber nicht, **wie lange** ein Timeout gilt.
 * Der Aufruf ging ohne Dauer an `addModAction`, und die griff auf ihre feste
 * Vorgabe von 24 Stunden zurueck.
 *
 * Die Eskalationsstufen haben ihre eigene Dauer je Stufe
 * (`automod_escalation_config.duration`, in Minuten) - die bleibt, wie sie ist.
 * Diese Spalte hier gilt nur fuer den Rueckfall, wenn gar keine Eskalation
 * eingerichtet ist.
 *
 * Einheit ist **Minuten**, genau wie bei den Eskalationsstufen. Obergrenze
 * 40320 = 28 Tage, das ist die Grenze, die Discord fuer Timeouts setzt.
 * Vorgabe 1440 = 24 Stunden, damit sich am bisherigen Verhalten nichts aendert,
 * solange niemand etwas einstellt.
 */
module.exports = {
    description: 'automod_settings: Dauer der Timeout-Hauptaktion einstellbar machen',

    async up(db) {
        await db.query(`
            ALTER TABLE automod_settings
            ADD COLUMN IF NOT EXISTS action_duration SMALLINT UNSIGNED DEFAULT 1440
        `);
    },

    async down(db) {
        await db.query(`ALTER TABLE automod_settings DROP COLUMN IF EXISTS action_duration`);
    }
};
