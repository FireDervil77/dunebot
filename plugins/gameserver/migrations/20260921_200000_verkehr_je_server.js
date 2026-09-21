'use strict';

/**
 * Netzwerkverkehr je Gameserver (Wunsch des Betreibers, 2026-09-21).
 *
 * *„richtig objektiv geil wäre es doch wenn man zwischen den Tabs und den Köpfen
 * genau eine solche Anzeige pro Gameserver hätte und zwar CPU, Traffic und Memory
 * von dem jeweiligen Gameserver auf dem man gerade sitzt. […] sowas fehlt dort
 * nämlich gänzlich."*
 *
 * CPU und RAM kommen seit `20260921_180000` an (vorher gingen sie in die tote
 * `server_registry`, Baustelle 146). Der Verkehr fehlte ganz — **nicht weil er
 * nicht gemessen wird:** Der Docker-Stats-Strom liest `NetRxBytes` und
 * `NetTxBytes` seit jeher und legt sie auf den Ereignis-Bus. Sie wurden nur nicht
 * zwischengespeichert und reisten deshalb nie mit dem Herzschlag.
 *
 * ── Warum vier Spalten und nicht zwei ───────────────────────────────────────
 *
 * Docker zählt **Summen seit dem Start des Containers**. „1,2 GB empfangen" sagt
 * einem Spieler nicht, ob gerade etwas passiert; „180 KB/s" sagt es. Beides hat
 * seinen Zweck:
 *
 *   · die Summe für „wie viel hat dieser Server insgesamt gezogen"
 *   · die Rate für die Anzeige, die sich bewegt
 *
 * Die Rate rechnet der **Daemon** aus zwei Messungen des Stats-Stroms (~2 s
 * Abstand). Aus zwei Herzschlägen (30 s) käme nur ein Mittelwert über eine halbe
 * Minute — der verschluckt jede Spitze, und genau die will man sehen.
 *
 * ── Warum die Summen BIGINT sind ────────────────────────────────────────────
 *
 * Ein `INT` läuft bei 2,1 GB über. Ein Spielserver, der eine Woche läuft, zieht
 * mehr. Die Raten bleiben `INT`: 2,1 GB **pro Sekunde** erreicht keine Leitung,
 * die hier hängt.
 */
module.exports = {
    description: 'gameservers: Netzwerkverkehr je Server (Summen und Rate)',

    async up(db) {
        const [da] = await db.query(
            `SELECT COUNT(*) AS n
               FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME = 'gameservers'
                AND COLUMN_NAME = 'net_rx_bytes'`
        );
        if (da && Number(da.n) > 0) return;

        await db.query(`
            ALTER TABLE gameservers
                ADD COLUMN net_rx_bytes BIGINT NULL DEFAULT NULL
                    COMMENT 'Empfangen seit Containerstart, Bytes (vom Daemon)',
                ADD COLUMN net_tx_bytes BIGINT NULL DEFAULT NULL
                    COMMENT 'Gesendet seit Containerstart, Bytes (vom Daemon)',
                ADD COLUMN net_rx_rate INT NULL DEFAULT NULL
                    COMMENT 'Bytes je Sekunde, im Daemon aus zwei Messungen gerechnet',
                ADD COLUMN net_tx_rate INT NULL DEFAULT NULL
                    COMMENT 'Bytes je Sekunde, im Daemon aus zwei Messungen gerechnet'
        `);
    },

    async down(db) {
        const [da] = await db.query(
            `SELECT COUNT(*) AS n
               FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME = 'gameservers'
                AND COLUMN_NAME = 'net_rx_bytes'`
        );
        if (!da || Number(da.n) === 0) return;

        await db.query(`
            ALTER TABLE gameservers
                DROP COLUMN net_rx_bytes,
                DROP COLUMN net_tx_bytes,
                DROP COLUMN net_rx_rate,
                DROP COLUMN net_tx_rate
        `);
    }
};
