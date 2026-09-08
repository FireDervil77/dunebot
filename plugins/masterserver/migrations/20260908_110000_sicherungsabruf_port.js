'use strict';

/**
 * Wohin der Browser eine Sicherung holen darf (Baustelle 106).
 *
 * Der Daemon liefert Sicherungen seit dem 2026-09-08 ueber einen eigenen
 * HTTP-Zuhoerer aus, gegen eine unterschriebene, kurzlebige Adresse. Damit das
 * Dashboard diese Adresse bauen kann, muss es den PORT kennen — und zwar den,
 * auf dem wirklich gelauscht wird, nicht den aus einer Konfiguration, die
 * niemand nachgepflegt hat. Der Daemon meldet ihn deshalb bei jeder Anmeldung
 * aus dem laufenden Zuhoerer, genau wie den SFTP-Port.
 *
 * ── NULL heisst: kein Abruf ─────────────────────────────────────────────────
 *
 * Ein Daemon aelterer Bauart meldet nichts, und ein Daemon, dessen Zuhoerer
 * nicht starten konnte (belegter Port), meldet ebenfalls nichts. In beiden
 * Faellen bietet das Dashboard das Herunterladen gar nicht erst an — besser
 * kein Knopf als einer, der auf eine tote Adresse zeigt.
 *
 * Deshalb hat die Spalte auch keinen Vorgabewert: Eine 9350 als Vorgabe waere
 * die Behauptung, dort lausche jemand.
 */
module.exports = {
    description: 'rootserver.abruf_port — Port des Sicherungsabrufs, vom Daemon gemeldet (B106)',

    async up(db) {
        await db.query(`
            ALTER TABLE rootserver
                ADD COLUMN IF NOT EXISTS abruf_port SMALLINT UNSIGNED DEFAULT NULL
                    COMMENT 'Port des HTTP-Sicherungsabrufs auf der Maschine. NULL = laeuft dort nicht.'
        `);
    },

    async down(db) {
        await db.query('ALTER TABLE rootserver DROP COLUMN IF EXISTS abruf_port');
    }
};
