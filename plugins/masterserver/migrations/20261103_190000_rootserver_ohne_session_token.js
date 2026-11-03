'use strict';

/**
 * FireBus Paket 5, F20: Die Sitzungs-JWT ist weg.
 *
 * Bis zur Innenhaut meldeten sich Daemons nach der ersten Anmeldung mit einer JWT an,
 * `markOnline` schrieb sie hierher. Gelesen hat sie hier nie jemand, geprüft wurde die
 * Unterschrift. Seit die Innenhaut den Daemon über den Token nachweist, schreibt sie auch
 * niemand mehr. `down` legt die Spalten leer wieder an: Eine alte JWT braucht niemand
 * zurück, sie wäre nach 30 Tagen ohnehin abgelaufen.
 */
module.exports = {
    description: 'masterserver-rootserver-ohne-session-token',

    async up(db) {
        // Name als Text: dbService.query ist execute, kein Platzhalter hinter SHOW … LIKE.
        for (const spalte of ['session_token_expires_at', 'session_token']) {
            const [da] = await db.query(`SHOW COLUMNS FROM rootserver LIKE '${spalte}'`);
            if (da) await db.query(`ALTER TABLE rootserver DROP COLUMN ${spalte}`);
        }
    },

    async down(db) {
        const [token] = await db.query("SHOW COLUMNS FROM rootserver LIKE 'session_token'");
        if (!token) await db.query('ALTER TABLE rootserver ADD COLUMN session_token TEXT NULL DEFAULT NULL AFTER api_key_neu');
        const [ablauf] = await db.query("SHOW COLUMNS FROM rootserver LIKE 'session_token_expires_at'");
        if (!ablauf) {
            await db.query(`ALTER TABLE rootserver ADD COLUMN session_token_expires_at TIMESTAMP NULL DEFAULT NULL
                COMMENT 'Session token expiration' AFTER session_token`);
        }
    }
};
