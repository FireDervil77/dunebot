'use strict';

/**
 * Maschinenidentität: Absicht, Messung und Fähigkeit werden getrennt.
 *
 * Gemessen am 2026-08-20 (siehe docs/spielpakete/arbeitsplan/08-Maschinenidentitaet.md):
 * Vier Felder auf dieser Tabelle versprachen etwas, das dahinter nicht stand.
 *
 *   `hostname`  — beschriftet mit „nur zur Anzeige", entschied aber tatsächlich
 *                 die Adresse, die ein Spieler bekommt (`baueAdresse`:
 *                 bind_ip || hostname || host). Wer dort etwas Falsches eintrug,
 *                 verteilte eine Adresse, an der niemand ankommt.
 *   `fqdn`      — geschrieben, von keiner einzigen Zeile gelesen.
 *   `fastdl_*`  — ein Schalter, der eine 1 in eine Spalte schrieb. Kein Nginx,
 *                 keine Zeile im Daemon.
 *   MySQL       — umgekehrt: kein Feld, aber der Daemon richtete ungefragt ein
 *                 Konto mit allen Rechten ein, das niemand benutzte (M-8).
 *
 * ── Die Trennung, die das aufhebt ───────────────────────────────────────────
 *
 * Drei Sorten Wissen, die bisher in denselben Spalten lagen:
 *
 *   ABSICHT     was der Betreiber WILL      — Formular      (`fqdn`, `*_gewuenscht`)
 *   MESSUNG     was auf der Maschine IST    — Daemon        (`virtualisierung`,
 *                                                            `webserver`, `fqdn_zeigt_auf`)
 *   FÄHIGKEIT   was daraus GEHT, mit Grund  — daraus abgeleitet (`*_moeglich`, `*_grund`)
 *
 * Und die Regel, die daraus folgt: **Ein Häkchen im Formular schaltet nichts
 * frei. Erst die gemeldete Fähigkeit tut das.**
 *
 * ── Warum `fqdn` bleibt und `hostname` seine Rolle verliert ─────────────────
 *
 * Zwei Felder für einen Namen waren der Kern des Problems. `fqdn` heisst, was es
 * ist, und wird ab jetzt die ABSICHT: der Name, den der Betreiber benutzen will.
 * Ob er benutzt WIRD, entscheidet `fqdn_gilt` — und das setzt keine Eingabe,
 * sondern eine Messung.
 *
 * `hostname` wird nicht gelöscht (Bestandsdaten anderer Guilds könnten daran
 * hängen), verliert aber jede Wirkung auf die Adresse. Das erledigt die
 * Adressfunktion im gameserver-Plugin, nicht diese Migration.
 *
 * ── Warum `fqdn_zeigt_auf` neben `fqdn_gilt` steht ──────────────────────────
 *
 * Ein Ja/Nein allein wäre wertlos. Am 2026-08-19 löste `node1.firenetworks.de`
 * auf — nur eben auf den Webhost, wegen eines Platzhalter-Eintrags
 * `*.firenetworks.de`. Eine Existenzprüfung hätte „ja" gesagt. Gefragt ist
 * deshalb nicht „gibt es den Namen", sondern „zeigt er HIERHER" — und wohin er
 * stattdessen zeigt, gehört danebengeschrieben, sonst sucht der Betreiber im
 * Dunkeln.
 */
module.exports = {
    description: 'Maschinenidentität: Absicht, Messung und Fähigkeit getrennt (M-1 bis M-6)',

    async up(db) {
        // ── MESSUNG: was der Daemon über seine Maschine berichtet ────────────
        await db.query(`
            ALTER TABLE rootserver
                ADD COLUMN IF NOT EXISTS gesehene_ip VARCHAR(45) DEFAULT NULL
                    COMMENT 'IP, von der der Daemon verbindet — die einzige Adresse, die niemand tippt',
                ADD COLUMN IF NOT EXISTS virtualisierung VARCHAR(32) DEFAULT NULL
                    COMMENT 'kvm/lxc/openvz/none — entscheidet, ob /proc-Werte zu trauen ist',
                ADD COLUMN IF NOT EXISTS webserver VARCHAR(32) DEFAULT NULL
                    COMMENT 'nginx/apache/keiner/fremd',
                ADD COLUMN IF NOT EXISTS webserver_grund VARCHAR(255) DEFAULT NULL
        `);

        // ── NAME: Absicht (fqdn) und Messung getrennt ────────────────────────
        await db.query(`
            ALTER TABLE rootserver
                ADD COLUMN IF NOT EXISTS fqdn_zeigt_auf VARCHAR(255) DEFAULT NULL
                    COMMENT 'wohin der Name tatsaechlich aufloest',
                ADD COLUMN IF NOT EXISTS fqdn_geprueft_am DATETIME DEFAULT NULL,
                ADD COLUMN IF NOT EXISTS fqdn_gilt TINYINT(1) NOT NULL DEFAULT 0
                    COMMENT 'nur wenn 1, darf der Name als Adresse ausgegeben werden',
                ADD COLUMN IF NOT EXISTS fqdn_grund VARCHAR(255) DEFAULT NULL
                    COMMENT 'warum er nicht gilt — gehoert in die Oberflaeche, nicht nur ins Log'
        `);

        // ── FASTDL: fastdl_enabled ist ab jetzt die ABSICHT ──────────────────
        // Bewusst wiederverwendet statt ein zweites Wunschfeld danebenzustellen.
        await db.query(`
            ALTER TABLE rootserver
                ADD COLUMN IF NOT EXISTS fastdl_moeglich TINYINT(1) NOT NULL DEFAULT 0,
                ADD COLUMN IF NOT EXISTS fastdl_grund VARCHAR(255) DEFAULT NULL
        `);

        // ── DATENBANKEN: neu, gleiche Bauart wie FastDL ──────────────────────
        //
        // `db_je_server` ist eine Grenze wie RAM oder Platte und gehoert deshalb
        // an die Maschine, nicht in den Code. 0 heisst: keine.
        await db.query(`
            ALTER TABLE rootserver
                ADD COLUMN IF NOT EXISTS db_gewuenscht TINYINT(1) NOT NULL DEFAULT 0,
                ADD COLUMN IF NOT EXISTS db_moeglich TINYINT(1) NOT NULL DEFAULT 0,
                ADD COLUMN IF NOT EXISTS db_grund VARCHAR(255) DEFAULT NULL,
                ADD COLUMN IF NOT EXISTS db_je_server INT NOT NULL DEFAULT 0
                    COMMENT 'wieviele Datenbanken ein Gameserver auf dieser Maschine haben darf'
        `);
    },

    async down(db) {
        await db.query(`
            ALTER TABLE rootserver
                DROP COLUMN IF EXISTS gesehene_ip,
                DROP COLUMN IF EXISTS virtualisierung,
                DROP COLUMN IF EXISTS webserver,
                DROP COLUMN IF EXISTS webserver_grund,
                DROP COLUMN IF EXISTS fqdn_zeigt_auf,
                DROP COLUMN IF EXISTS fqdn_geprueft_am,
                DROP COLUMN IF EXISTS fqdn_gilt,
                DROP COLUMN IF EXISTS fqdn_grund,
                DROP COLUMN IF EXISTS fastdl_moeglich,
                DROP COLUMN IF EXISTS fastdl_grund,
                DROP COLUMN IF EXISTS db_gewuenscht,
                DROP COLUMN IF EXISTS db_moeglich,
                DROP COLUMN IF EXISTS db_grund,
                DROP COLUMN IF EXISTS db_je_server
        `);
    }
};
