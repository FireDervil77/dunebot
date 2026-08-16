'use strict';

/**
 * Kennzahlen über die Zeit (E-8).
 *
 * Heute überträgt der Daemon CPU und RAM je Container alle 30 Sekunden im
 * Heartbeat — und niemand hebt sie auf. Es gibt keinen Verlauf, also auch keine
 * Antwort auf die einzige Frage, die ein Betreiber wirklich stellt: „War der
 * Server gestern Abend am Anschlag, als alle geklagt haben?"
 *
 * ── Die Form: breit, nicht schmal ───────────────────────────────────────────
 *
 * Eine Zeile je Server und Zeitkorb mit einer Spalte je Messwert. Ein
 * Schlüssel-Wert-Paar je Messwert wäre viermal so viele Zeilen für dieselbe
 * Auskunft.
 *
 * ── Der Takt: eine Zeile je Minute, nicht je Heartbeat ──────────────────────
 *
 * Der Heartbeat kommt alle 30 s, macht zwei Messwerte je Korb — daher `samples`.
 * Sekundengenau braucht für einen Verlauf niemand.
 *
 * ── Zwei Aufbewahrungsstufen in EINER Tabelle ───────────────────────────────
 *
 * Minutenzeilen 14 Tage, danach zu Stundenzeilen verdichtet, diese 13 Monate
 * (13, damit der Jahresvergleich möglich ist). Beides steht hier, unterschieden
 * durch `bucket`; so liest eine Abfrage über eine Zeitspanne beide Stufen ohne
 * Fallunterscheidung. Aufgeräumt wird über den vorhandenen CronWorker, täglich —
 * kein neuer Mechanismus.
 *
 * **Ohne Verdichtung wächst das unbegrenzt** (bei 100 Servern ~3 GB im Jahr).
 * Das ist der Grund, warum diese Entscheidung vor dem ersten Messwert fiel und
 * nicht danach.
 *
 * ── Wer schreibt: das Dashboard ─────────────────────────────────────────────
 *
 * Beim Empfang des Heartbeats, nicht der Daemon. Der Daemon misst und meldet, er
 * verwaltet nicht (Invariante I4) — er bleibt ohne Gedächtnis.
 *
 * ── NULL heißt "nicht gemessen", 0 heißt "gemessen: keiner" ─────────────────
 *
 * Wichtig bei den Spielerzahlen: Die gibt es heute nirgends (der Daemon schickt
 * `"players": nil` mit einem TODO daneben). Bis das über K3/K4 kommt, bleiben
 * diese Spalten NULL. Sie mit 0 zu füllen hiesse zu behaupten, es sei gemessen
 * worden und niemand war da — genau die Art stiller Falschaussage, die dieses
 * Vorhaben abschaffen soll.
 *
 * Keine Zeitreihen-Datenbank: technisch besser, betrieblich teurer (eigener
 * Dienst, eigene Adresse, eigene Sicherung). Neu zu bewerten bei Sekunden-
 * auflösung oder ~100 Maschinen.
 */
module.exports = {
    description: 'server_metrics — Verlauf von CPU, RAM und Spielerzahl in Minuten- und Stundenkörben (E-8)',

    async up(db) {
        const [vorhanden] = await db.query("SHOW TABLES LIKE 'server_metrics'");
        if (vorhanden) return;

        await db.query(`
            CREATE TABLE server_metrics (
                id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                server_id     INT UNSIGNED    NOT NULL,
                bucket        ENUM('minute','hour') NOT NULL DEFAULT 'minute'
                              COMMENT 'Auflösung der Zeile. Minutenzeilen werden nach 14 Tagen zu Stundenzeilen verdichtet.',
                bucket_start  DATETIME        NOT NULL
                              COMMENT 'Beginn des Korbs, auf die Auflösung abgerundet',
                cpu_avg       DECIMAL(6,2)    DEFAULT NULL
                              COMMENT 'Prozent; kann ueber 100 liegen (mehrere Kerne). NULL = nicht gemessen.',
                ram_mb_avg    INT UNSIGNED    DEFAULT NULL,
                ram_mb_max    INT UNSIGNED    DEFAULT NULL,
                players_avg   DECIMAL(6,1)    DEFAULT NULL
                              COMMENT 'NULL = nicht gemessen (heute der Regelfall). 0 = gemessen, niemand da.',
                players_max   SMALLINT UNSIGNED DEFAULT NULL,
                samples       SMALLINT UNSIGNED NOT NULL DEFAULT 0
                              COMMENT 'Wie viele Heartbeats in diesen Korb eingegangen sind — 0 macht die Zeile wertlos und sichtbar so.',
                PRIMARY KEY (id),
                UNIQUE KEY uq_korb (server_id, bucket, bucket_start),
                KEY idx_aufraeumen (bucket, bucket_start),
                CONSTRAINT fk_server_metrics_server
                    FOREIGN KEY (server_id) REFERENCES gameservers (id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
              COMMENT='Verlauf je Server (E-8). Geschrieben vom Dashboard beim Heartbeat, nie vom Daemon (I4).'
        `);
    },

    async down(db) {
        await db.query('DROP TABLE IF EXISTS server_metrics');
    }
};
