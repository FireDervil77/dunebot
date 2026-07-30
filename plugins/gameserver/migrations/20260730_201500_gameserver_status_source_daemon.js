'use strict';

/**
 * `daemon` als dritte Statusquelle.
 *
 * Anlass: Hytale (Server 155) lief, während das Panel „offline" zeigte. Der
 * Daemon wusste es – `gameservers.status` stand auf `online` –, aber der
 * Snapshot fragt nur Query und RCON, und Hytale hat beides nicht. Also blieb
 * `online = 0`, und kein Aktualisieren der Welt hätte daran etwas geändert:
 * Es gibt schlicht nichts zu fragen.
 *
 * Dieselbe Lage bei Windrose, das ausgehend zu einem Relay verbindet und
 * überhaupt keinen Port öffnet.
 *
 * Für solche Spiele gilt ab jetzt der Daemon als Quelle. Bewusst NUR, wenn gar
 * keine Quelle konfiguriert ist: Bei einem Spiel MIT Query würde „Container
 * läuft" ein abgestürztes Spiel als online ausweisen – genau die Lüge, die E1
 * abgeschafft hat.
 */
module.exports = {
    description: 'gameserver-status-source-daemon',

    async up(db) {
        await db.query(`
            ALTER TABLE gameserver_status
            MODIFY COLUMN source ENUM('query','rcon','merged','daemon','none')
                NOT NULL DEFAULT 'none'
        `);
    },

    async down(db) {
        // Bestehende 'daemon'-Zeilen müssen weg, bevor der Wert aus dem ENUM
        // verschwinden darf – sonst macht MySQL daraus stillschweigend ''.
        await db.query("UPDATE gameserver_status SET source = 'none' WHERE source = 'daemon'");
        await db.query(`
            ALTER TABLE gameserver_status
            MODIFY COLUMN source ENUM('query','rcon','merged','none')
                NOT NULL DEFAULT 'none'
        `);
    }
};
