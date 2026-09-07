'use strict';

/**
 * Verlosung: die eine Bedingung, die auf dem Stream-Weg gelten kann.
 *
 * # Warum eine eigene Spalte und keine Zeile in `giveaway_requirements`
 *
 * Die vorhandenen Bedingungen sind **Discord-Regeln**: Rolle, Kontoalter,
 * Servermitgliedschaft. `checkRequirements` braucht dafuer
 * `guild.members.fetch()`, und ein Twitch-Zuschauer hat dort nichts - das ist
 * keine Festlegung, sondern eine Tatsache. Eine Twitch-Regel in dieselbe
 * Tabelle zu legen hiesse, dass `checkRequirements` sie mitpruefen wollte und
 * an `member_not_found` scheiterte.
 *
 * Deshalb steht sie getrennt und wird auch getrennt geprueft: von dem, der den
 * Chat sieht. `!los` bekommt das Abonnenten-Abzeichen mit **jeder**
 * Chatnachricht mit (`badges`), es braucht dafuer keine Abfrage.
 *
 * Vorgabe 0 - jede bestehende Verlosung bleibt offen fuer alle.
 */
module.exports = {
    description: 'Stream-Weg: nur Abonnenten',

    async up(db) {
        const rows = await db.query(
            `SELECT COUNT(*) AS cnt FROM information_schema.columns
              WHERE table_schema = DATABASE() AND table_name = 'giveaways'
                AND column_name = 'stream_nur_abonnenten'`);
        if (Number(rows[0]?.cnt || rows?.cnt || 0) > 0) return;

        await db.query(`
            ALTER TABLE giveaways
              ADD COLUMN stream_nur_abonnenten TINYINT(1) NOT NULL DEFAULT 0
                  COMMENT 'Stream-Weg nur fuer Abonnenten des Kanals'
                  AFTER teilnahme
        `);
    },

    async down(db) {
        const rows = await db.query(
            `SELECT COUNT(*) AS cnt FROM information_schema.columns
              WHERE table_schema = DATABASE() AND table_name = 'giveaways'
                AND column_name = 'stream_nur_abonnenten'`);
        if (Number(rows[0]?.cnt || rows?.cnt || 0) > 0) {
            await db.query('ALTER TABLE giveaways DROP COLUMN stream_nur_abonnenten');
        }
    }
};
