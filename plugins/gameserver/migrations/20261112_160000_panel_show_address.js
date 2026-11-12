'use strict';

/**
 * Discord-Panel: Adresse zeigen (K373, 2026-11-12).
 *
 * Bis dahin stand im Panel nur dann eine Adresse, wenn das Paket `connect`
 * nannte — und das tat am 2026-11-12 keines der 15 freigegebenen Pakete. Die
 * Serverseite zeigte die Adresse längst, das Panel schwieg (Betreiber bei
 * Stormforge, 2026-11-11).
 *
 * Wie bei den übrigen Schaltern entscheidet der Besitzer je Panel. Vorgabe AN:
 * Die Adresse ist der Sinn eines Panels, mit dem Spieler beitreten sollen, und
 * sie ist nichts Geheimes — das Geheime ist das Passwort, das seinen eigenen
 * Schalter mit Vorgabe AUS hat. Bestandspanels bekommen die Adresse deshalb
 * beim nächsten Push mit; alle sechs gehörten am 2026-11-12 dem Betreiber.
 */
module.exports = {
    description: 'gameserver-panel-show-address',

    async up(db) {
        const [existing] = await db.query(`
            SELECT COUNT(*) AS n
            FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'gameserver_status_panels'
              AND COLUMN_NAME = 'show_address'
        `);

        if (Number(existing?.n) > 0) return;

        await db.query(`
            ALTER TABLE gameserver_status_panels
            ADD COLUMN show_address BOOLEAN NOT NULL DEFAULT TRUE
                COMMENT 'Adresse (IP:Port) im Panel, wie auf der Serverseite (K373)'
                AFTER show_password
        `);
    },

    async down(db) {
        await db.query('ALTER TABLE gameserver_status_panels DROP COLUMN show_address');
    }
};
