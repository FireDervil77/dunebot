'use strict';

/**
 * `rootserver.base_directory` darf „unbekannt" sagen (Baustelle 143).
 *
 * ── Der Befund ───────────────────────────────────────────────────────────────
 *
 * Die Spalte stand bei beiden Rootservern auf `/opt/firebot` — dem Vorgabewert
 * aus der Baseline (`20260101_000000_baseline.js:28`). Auf der Maschine gibt es
 * drei Pfade, und der gespeicherte ist der einzige, den es nicht gibt:
 *
 *   /opt/firebot                    existiert nicht — und stand in der Datenbank
 *   /opt/firebot-daemon             der Daemon selbst (daemon.yaml, Binär, Kopien)
 *   /home/firebot/{id}/serverfiles  die Volumes
 *
 * Niemand hat den Wert je gesetzt: Der Daemon baut seine Pfade aus
 * `cfg.Filesystem.BaseDirectory` und hat das Feld nie gemeldet; im Daemon gibt es
 * für die empfangene Fassung (`internal/kopplung/vorlauf.go:55`) keinen einzigen
 * Leser. Es war eine Spalte, die nur noch angezeigt wurde — und sie zeigte
 * falsch.
 *
 * ── Warum NULL und nicht der richtige Pfad ──────────────────────────────────
 *
 * Weil das Dashboard den richtigen Pfad nicht weiß. Nur die Maschine weiß ihn,
 * und ab Daemon 1.0.75 meldet sie ihn bei jeder Anmeldung (dieselbe Form wie
 * beim SFTP-Port: der Wert, mit dem wirklich gearbeitet wird, nicht der aus einer
 * Konfiguration). Hier einen Pfad einzutragen, den ich für richtig halte, wäre
 * derselbe Fehler noch einmal — nur mit einer plausibleren Zahl.
 *
 * **NULL ist die einzige wahre Angabe, bis ein Daemon sich meldet.** Die
 * Rootserver-Seite zeigt dafür jetzt „vom Daemon nicht gemeldet" statt eines
 * Rückfalls. Der Rückfall war die gefährlichere Hälfte des Befunds: Er zeigte
 * `/opt/firebot-daemon` — einen Pfad, den es wirklich gibt, der aber das falsche
 * Ding ist. Ein nicht existierender Pfad fällt beim ersten `ls` auf. Ein
 * existierender mit anderer Bedeutung führt jemanden bis in ein `rm` hinein.
 *
 * ── Warum nur genau dieser eine Wert geleert wird ───────────────────────────
 *
 * `WHERE base_directory = '/opt/firebot'` — der unveränderte Vorgabewert, also
 * nachweislich nichts, was jemand eingetragen hat. Wer dort etwas anderes
 * stehen hat, hat es gesetzt, und das bleibt. „Nur zurück, was man gab."
 */
module.exports = {
    description: 'rootserver.base_directory: NULL erlaubt, der nie gesetzte Vorgabewert wird geleert (B143)',

    async up(db) {
        // Erst die Spalte, dann die Daten — umgekehrt scheitert das UPDATE an
        // NOT NULL.
        await db.query(`
            ALTER TABLE rootserver
                MODIFY COLUMN base_directory VARCHAR(512) NULL DEFAULT NULL
                    COMMENT 'Vom Daemon gemeldetes Volume-Verzeichnis (seit 1.0.75). NULL = nicht gemeldet'
        `);

        const ergebnis = await db.query(
            `UPDATE rootserver SET base_directory = NULL WHERE base_directory = '/opt/firebot'`
        );
        // Die Zahl gehört ins Protokoll: Sie sagt, wie viele Maschinen den Wert
        // nie gesetzt hatten — und damit, wie ernst der Befund war.
        const betroffen = ergebnis?.affectedRows ?? ergebnis?.[0]?.affectedRows ?? '?';
        console.log(`    [B143] base_directory geleert, wo der Vorgabewert nie ersetzt wurde: ${betroffen} Zeile(n)`);
    },

    async down(db) {
        // Zurück auf NOT NULL heißt: leere Werte brauchen wieder etwas. Der alte
        // Vorgabewert kommt zurück — mit allem, was daran falsch war. Deshalb
        // steht er hier und nicht oben.
        await db.query(
            `UPDATE rootserver SET base_directory = '/opt/firebot' WHERE base_directory IS NULL`
        );
        await db.query(`
            ALTER TABLE rootserver
                MODIFY COLUMN base_directory VARCHAR(512) NOT NULL DEFAULT '/opt/firebot'
        `);
    }
};
