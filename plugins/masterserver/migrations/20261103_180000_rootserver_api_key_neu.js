'use strict';

/**
 * FireBus Etappe 4, Paket 5: der Knopf „Token erneuern".
 *
 * Der neue Token steht hier, bis der Daemon eine Sitzung unter ihm beginnt. Erst dann
 * rückt er nach `api_key` (`helpers/Innenhaut.js`). Bis dahin gelten beide: Fällt eine
 * Seite mittendrin aus, sperrt sich niemand aus.
 */
module.exports = {
    description: 'masterserver-rootserver-api-key-neu',

    async up(db) {
        // Name als Text: dbService.query ist execute, kein Platzhalter hinter SHOW … LIKE.
        const [spalte] = await db.query("SHOW COLUMNS FROM rootserver LIKE 'api_key_neu'");
        if (spalte) return;
        await db.query(`ALTER TABLE rootserver
            ADD COLUMN api_key_neu VARCHAR(255) NULL DEFAULT NULL
                COMMENT 'Neuer Token, bis der Daemon unter ihm spricht. Bis dahin gelten beide' AFTER api_key`);
    },

    async down(db) {
        const [spalte] = await db.query("SHOW COLUMNS FROM rootserver LIKE 'api_key_neu'");
        if (spalte) await db.query('ALTER TABLE rootserver DROP COLUMN api_key_neu');
    }
};
