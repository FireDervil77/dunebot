'use strict';

/**
 * Öffentlicher Status je Gameserver (E5).
 *
 * Ein Token statt der Server-ID, damit die öffentliche Adresse nichts über die
 * interne Zählung verrät und sich zurückziehen lässt: Token neu würfeln, alte
 * Einbindungen sind tot. Mit der ID ginge das nicht.
 *
 * Zwei getrennte Schalter, weil es zwei getrennte Entscheidungen sind:
 *   - `public_status_enabled`  – gibt es die Seite überhaupt?
 *   - `public_status_players`  – stehen dort auch Spielernamen?
 *
 * Namen sind personenbezogen und eine öffentliche Website ist noch einmal etwas
 * anderes als ein Discord-Kanal: Sie wird indexiert. Deshalb ist der zweite
 * Schalter aus, auch wenn der erste an ist.
 */
module.exports = {
    description: 'gameserver-public-status-token',

    async up(db) {
        const [vorhanden] = await db.query(`
            SELECT COUNT(*) AS n
            FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'gameservers'
              AND COLUMN_NAME = 'public_status_token'
        `);
        if (Number(vorhanden?.n) > 0) return;

        await db.query(`
            ALTER TABLE gameservers
            ADD COLUMN public_status_token   VARCHAR(32) NULL
                COMMENT 'Adresse der oeffentlichen Statusseite; neu wuerfeln = alte Einbindungen tot',
            ADD COLUMN public_status_enabled BOOLEAN NOT NULL DEFAULT 0,
            ADD COLUMN public_status_players BOOLEAN NOT NULL DEFAULT 0
                COMMENT 'Spielernamen oeffentlich zeigen - bewusst getrennt schaltbar',
            ADD UNIQUE KEY uniq_public_status_token (public_status_token)
        `);
    },

    async down(db) {
        await db.query(`
            ALTER TABLE gameservers
            DROP INDEX uniq_public_status_token,
            DROP COLUMN public_status_players,
            DROP COLUMN public_status_enabled,
            DROP COLUMN public_status_token
        `);
    }
};
