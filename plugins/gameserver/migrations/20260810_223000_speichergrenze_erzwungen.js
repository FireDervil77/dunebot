'use strict';

/**
 * Haelt fest, ob die gebuchte Platzgrenze wirklich greift (Baustellen 37).
 *
 * `disk_gb` steht seit jeher in der Ressourcen-Rechnung, wurde aber nirgends
 * durchgesetzt: Docker kann es nicht (die Serverdateien liegen in einem
 * Bind-Mount, nicht in der Schreibschicht), und der SystemQuotaManager im
 * Daemon setzt Benutzer-Quotas — der Systembenutzer gehoert aber dem
 * Rootserver, alle Gameserver darauf teilen ihn sich.
 *
 * Ab Daemon 1.0.26 setzt der Daemon stattdessen eine **Projekt-Quota** auf das
 * Serververzeichnis. Das setzt voraus, dass das Dateisystem mit `prjquota`
 * eingehaengt ist — was sich nicht annehmen laesst. Der Daemon meldet deshalb
 * nach jedem Start, ob es geklappt hat; hier liegt die Antwort.
 *
 * Vorgabe ist bewusst `NULL` und nicht `0`: "noch nie gemeldet" ist etwas
 * anderes als "geprueft und wirkt nicht". Die Oberflaeche unterscheidet das.
 */
module.exports = {
    async up(db) {
        const spalten = await db.query(`
            SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gameservers'
        `);
        const hat = (name) => spalten.some(s => s.COLUMN_NAME === name);

        if (!hat('disk_quota_enforced')) {
            await db.query(`
                ALTER TABLE gameservers
                ADD COLUMN disk_quota_enforced TINYINT(1) NULL
                    COMMENT 'Greift die Platzgrenze wirklich? NULL = noch nie gemeldet'
            `);
        }
        if (!hat('disk_quota_note')) {
            await db.query(`
                ALTER TABLE gameservers
                ADD COLUMN disk_quota_note VARCHAR(500) NULL
                    COMMENT 'Grund und Abhilfe, wenn die Grenze nicht greift'
            `);
        }
    },

    async down(db) {
        await db.query('ALTER TABLE gameservers DROP COLUMN disk_quota_enforced');
        await db.query('ALTER TABLE gameservers DROP COLUMN disk_quota_note');
    }
};
