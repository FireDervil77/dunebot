'use strict';

/**
 * Der gemessene Platz zieht nach `gameservers` um — Richtigstellung am selben Tag.
 *
 * ── Warum die erste Wahl falsch war, und woran ich es nicht gemerkt habe ─────
 *
 * Am 2026-09-21 mittags legte `masterserver/20260921_120000_platzstand_je_server`
 * die Spalten in `server_registry` an, mit der Begründung: „Dort stehen schon
 * `cpu_percent`, `ram_used_mb`, `current_players` — der belegte Platz ist eine
 * Messung und gehört dorthin, wo die anderen Messungen stehen."
 *
 * Die Begründung stimmte. Die Voraussetzung nicht: **`server_registry` hat null
 * Zeilen, und im ganzen Repo gibt es kein einziges `INSERT INTO
 * server_registry`.** Jedes `UPDATE server_registry SET …` im Herzschlag trifft
 * seit jeher 0 Zeilen. Die „anderen Messungen" stehen dort also nicht — sie
 * werden dorthin geschrieben und kommen nie an.
 *
 * Geprüft hatte ich, dass die Spalten existieren und dass der Herzschlag sie
 * schreibt. Nicht geprüft hatte ich, ob es eine Zeile gibt, in die er schreiben
 * kann. Genau die Lücke, gegen die in diesem Haus sonst jeder Wächter steht.
 *
 * ── Warum `gameservers` richtig ist ─────────────────────────────────────────
 *
 * Nicht weil dort die Buchung steht, sondern weil dort **schon Messungen des
 * Daemons stehen**: `bereitschaft_stufe`, `bereitschaft_grund`,
 * `bereitschaft_am` kommen aus demselben Daemon über dieselbe Leitung und werden
 * seit dem 2026-09-08 genau so gespeichert. Es gibt also ein Vorbild im Haus,
 * und es funktioniert. Dazu: die Tabelle hat Zeilen, eine je Server, und sie
 * verschwinden mit dem Server.
 *
 * Nebeneffekt, der die Sache einfacher macht: Die Serverseite und `/status`
 * lesen `gameservers` ohnehin. Die eigene Abfrage, die ich für `server_registry`
 * brauchte (varchar gegen int, keine JOIN-Möglichkeit), fällt damit weg.
 *
 * ── Warum die Spalten in `server_registry` wieder verschwinden ──────────────
 *
 * Weil nie etwas darin stand. Sie stehenzulassen hieße, an zwei Stellen dieselbe
 * Frage zu beantworten, und die tote Stelle würde beim nächsten Durchgang für
 * die Wahrheit gehalten. Was mit `server_registry` als Ganzem geschieht —
 * wiederbeleben oder zurückziehen —, ist eine Entscheidung des Betreibers und
 * steht in Baustelle 146.
 */
module.exports = {
    description: 'gameservers: gemessener Platz (B101) — zurück aus der toten server_registry',

    async up(db) {
        const [da] = await db.query(
            `SELECT COUNT(*) AS n
               FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME = 'gameservers'
                AND COLUMN_NAME = 'platz_belegt_bytes'`
        );

        if (!da || Number(da.n) === 0) {
            await db.query(`
                ALTER TABLE gameservers
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
        }

        // Die alten Spalten weg — nichts hat je darin gestanden.
        //
        // Nicht `DROP COLUMN IF EXISTS`: Das kennt MariaDB erst ab 10.5.2, und
        // ein Fehlschlag hier wäre stiller als eine Abfrage (vergleiche den
        // Befund „IF NOT EXISTS repariert nichts").
        const [alt] = await db.query(
            `SELECT COUNT(*) AS n
               FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME = 'server_registry'
                AND COLUMN_NAME = 'platz_belegt_bytes'`
        );
        if (alt && Number(alt.n) > 0) {
            await db.query(`
                ALTER TABLE server_registry
                    DROP COLUMN platz_belegt_bytes,
                    DROP COLUMN platz_grenze_bytes,
                    DROP COLUMN platz_gemessen_am,
                    DROP COLUMN platz_ueber,
                    DROP COLUMN platz_geschaetzt
            `);
        }
    },

    async down(db) {
        const [da] = await db.query(
            `SELECT COUNT(*) AS n
               FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME = 'gameservers'
                AND COLUMN_NAME = 'platz_belegt_bytes'`
        );
        if (da && Number(da.n) > 0) {
            await db.query(`
                ALTER TABLE gameservers
                    DROP COLUMN platz_belegt_bytes,
                    DROP COLUMN platz_grenze_bytes,
                    DROP COLUMN platz_gemessen_am,
                    DROP COLUMN platz_ueber,
                    DROP COLUMN platz_geschaetzt
            `);
        }
        // `server_registry` bekommt seine Spalten nicht zurück: Sie waren leer,
        // und die Migration, die sie angelegt hat, kann das selbst tun.
    }
};
