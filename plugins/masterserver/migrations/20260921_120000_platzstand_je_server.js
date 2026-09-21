'use strict';

/**
 * Der gemessene Platz je Gameserver (Baustelle 101, Weg C).
 *
 * Entschieden am 2026-09-21: Weil beide Rootserver `/` als ext4 **ohne**
 * `prjquota` eingehängt haben, greift die harte Projekt-Quota nicht. Statt
 * einer Zahl, die nichts bewirkt, gilt jetzt eine weiche Grenze im Daemon: Er
 * misst den belegten Platz in seinem eigenen Takt und meldet ihn im Herzschlag.
 *
 * ── Warum in `server_registry` und nicht in `gameservers` ────────────────────
 *
 * `gameservers` trägt, was **gebucht** ist (`allocated_disk_gb`) und ob die
 * harte Grenze greift (`disk_quota_enforced`, `disk_quota_note`) — Angaben, die
 * der Betreiber setzt. `server_registry` trägt, was **gemessen** ist: daneben
 * stehen schon `cpu_percent`, `ram_used_mb`, `current_players`. Der belegte
 * Platz ist eine Messung und gehört dorthin, wo die anderen Messungen stehen.
 *
 * ── Warum Bytes und nicht GiB ───────────────────────────────────────────────
 *
 * Der Daemon misst Bytes. Sie hier auf GiB zu runden hieße, eine Warnung bei
 * 20,9 von 21 GiB als „21 von 21" anzuzeigen — und die Anzeige würde Alarm
 * schlagen, wo noch 100 MiB frei sind. BIGINT reicht bis 8 Exbibyte.
 *
 * ── Warum `platz_ueber` eine eigene Spalte ist ──────────────────────────────
 *
 * Man könnte es aus `platz_belegt_bytes > allocated_disk_gb * 1024³` rechnen.
 * Das wäre eine zweite Rechnung neben der des Daemons — und die des Daemons ist
 * die, die den Start verweigert. Eine Anzeige, die anders rechnet als der
 * Torwächter, widerspricht ihm irgendwann. Deshalb steht hier, was der Daemon
 * gesagt hat.
 */
module.exports = {
    description: 'server_registry: gemessener Platz je Gameserver (B101, weiche Grenze)',

    async up(db) {
        const [vorhanden] = await db.query(
            `SELECT COUNT(*) AS n
               FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME = 'server_registry'
                AND COLUMN_NAME = 'platz_belegt_bytes'`
        );

        // Der Wächter fragt die Spalte, nicht `IF NOT EXISTS`: Bei einer Tabelle,
        // die schon einmal von Hand angefasst wurde, repariert `IF NOT EXISTS`
        // nichts, es schweigt nur.
        if (vorhanden && Number(vorhanden.n) > 0) return;

        await db.query(`
            ALTER TABLE server_registry
                ADD COLUMN platz_belegt_bytes BIGINT NULL DEFAULT NULL
                    COMMENT 'Vom Daemon gemessener belegter Platz des Volumes in Bytes',
                ADD COLUMN platz_grenze_bytes BIGINT NULL DEFAULT NULL
                    COMMENT 'Grenze, gegen die der Daemon geprueft hat (0/NULL = keine)',
                ADD COLUMN platz_gemessen_am DATETIME NULL DEFAULT NULL
                    COMMENT 'Zeitpunkt der Messung im Daemon, nicht des Eintreffens',
                ADD COLUMN platz_ueber TINYINT(1) NOT NULL DEFAULT 0
                    COMMENT 'Urteil des Daemons: liegt der Server ueber seiner Grenze?',
                ADD COLUMN platz_geschaetzt TINYINT(1) NOT NULL DEFAULT 0
                    COMMENT 'Seit der letzten Messung wurde ein Upload dazugerechnet'
        `);
    },

    async down(db) {
        const [vorhanden] = await db.query(
            `SELECT COUNT(*) AS n
               FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME = 'server_registry'
                AND COLUMN_NAME = 'platz_belegt_bytes'`
        );
        if (!vorhanden || Number(vorhanden.n) === 0) return;

        await db.query(`
            ALTER TABLE server_registry
                DROP COLUMN platz_belegt_bytes,
                DROP COLUMN platz_grenze_bytes,
                DROP COLUMN platz_gemessen_am,
                DROP COLUMN platz_ueber,
                DROP COLUMN platz_geschaetzt
        `);
    }
};
