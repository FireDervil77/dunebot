'use strict';

/**
 * FireBus, Etappe 0: Zählung und Maschinenlast (2026-11-01).
 *
 * Zwei Tabellen, die `helpers/FireBusZaehler.js` füllt und 30 Tage aufhebt.
 *
 * `firebus_zaehlung` zählt je Stunde, Daemon und Nachrichtenname. `art` sagt, was
 * die Zeile meint: `ein` kam vom Daemon, `aus` ging an ihn, `lesefaden` ist die
 * Zeit, die ein Befehl den Lesefaden des Daemons belegte.
 *
 * `firebus_last` hält je Herzschlag die Last der Maschine. `druck_*` ist der
 * Anteil der Zeit in Prozent, in dem etwas warten musste (`/proc/pressure`).
 * NULL heißt: nicht gemessen, nicht null.
 *
 * Joins mit `rootserver` über `daemon_id` laufen im Auswerteskript in JavaScript,
 * siehe Notiz zur Kollationsgrenze.
 */
module.exports = {
    async up(db) {
        await db.query(`
            CREATE TABLE IF NOT EXISTS firebus_zaehlung (
                stunde          DATETIME NOT NULL,
                daemon_id       VARCHAR(64) NOT NULL,
                name            VARCHAR(80) NOT NULL,
                art             ENUM('ein', 'aus', 'lesefaden') NOT NULL,
                anzahl          BIGINT UNSIGNED NOT NULL DEFAULT 0,
                bytes           BIGINT UNSIGNED NOT NULL DEFAULT 0,
                groesste        INT UNSIGNED NOT NULL DEFAULT 0,
                dauer_summe_ms  BIGINT UNSIGNED NOT NULL DEFAULT 0,
                dauer_max_ms    INT UNSIGNED NOT NULL DEFAULT 0,
                fristen         INT UNSIGNED NOT NULL DEFAULT 0,
                PRIMARY KEY (stunde, daemon_id, name, art)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        await db.query(`
            CREATE TABLE IF NOT EXISTS firebus_last (
                id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                zeit         DATETIME NOT NULL,
                daemon_id    VARCHAR(64) NOT NULL,
                cpu_prozent  DECIMAL(5,2) NULL,
                ram_prozent  DECIMAL(5,2) NULL,
                druck_cpu    DECIMAL(6,3) NULL,
                druck_io     DECIMAL(6,3) NULL,
                druck_ram    DECIMAL(6,3) NULL,
                PRIMARY KEY (id),
                KEY daemon_zeit (daemon_id, zeit),
                KEY zeit (zeit)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
    },

    async down(db) {
        await db.query('DROP TABLE IF EXISTS firebus_last');
        await db.query('DROP TABLE IF EXISTS firebus_zaehlung');
    },
};
