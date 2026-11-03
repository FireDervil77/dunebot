'use strict';

/**
 * FireBus Etappe 4, Paket 5: die Marke der Innenhaut je Rootserver.
 *
 * `helpers/Innenhaut.js` nimmt von jedem Daemon nur seine neueste Sitzung an, und den
 * Zähler nur aufwärts. Damit das einen Neustart des Dashboards übersteht, steht beides
 * hier. Geheim ist nichts davon, der Schlüssel folgt aus `api_key`. Solange
 * `innenhaut_sitzung` NULL ist, hat der Daemon noch nie versiegelt gesprochen, und sein
 * Klartext gilt (Übergang nach F20).
 */
module.exports = {
    description: 'masterserver-rootserver-innenhaut',

    async up(db) {
        // Name als Text: dbService.query ist execute, kein Platzhalter hinter SHOW … LIKE.
        const [sitzung] = await db.query("SHOW COLUMNS FROM rootserver LIKE 'innenhaut_sitzung'");
        if (!sitzung) {
            await db.query(`ALTER TABLE rootserver
                ADD COLUMN innenhaut_sitzung CHAR(32) NULL DEFAULT NULL
                    COMMENT 'Neueste Sitzung des Daemons (Innenhaut). NULL = spricht noch Klartext'`);
        }
        const [zaehler] = await db.query("SHOW COLUMNS FROM rootserver LIKE 'innenhaut_zaehler'");
        if (!zaehler) {
            await db.query(`ALTER TABLE rootserver
                ADD COLUMN innenhaut_zaehler BIGINT UNSIGNED NOT NULL DEFAULT 0
                    COMMENT 'Hoechster Zaehler dieser Sitzung, darunter ist alles Wiederholung'`);
        }
    },

    async down(db) {
        const [zaehler] = await db.query("SHOW COLUMNS FROM rootserver LIKE 'innenhaut_zaehler'");
        if (zaehler) await db.query('ALTER TABLE rootserver DROP COLUMN innenhaut_zaehler');
        const [sitzung] = await db.query("SHOW COLUMNS FROM rootserver LIKE 'innenhaut_sitzung'");
        if (sitzung) await db.query('ALTER TABLE rootserver DROP COLUMN innenhaut_sitzung');
    }
};
