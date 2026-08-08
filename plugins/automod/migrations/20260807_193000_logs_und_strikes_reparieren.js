'use strict';

/**
 * automod_logs und automod_strikes hatten weder Primaerschluessel noch
 * AUTO_INCREMENT noch die Indizes aus der Baseline.
 *
 * Folge: **jedes** Schreiben lief in
 * `ER_NO_DEFAULT_FOR_FIELD: Field 'id' doesn't have a default value`.
 * Beide Tabellen standen deshalb bei 0 Zeilen - Strikes wurden nie gezaehlt,
 * also ist auch die Eskalation nie ausgeloest worden.
 *
 * Die Baseline legt beide Tabellen richtig an, greift aber nur bei
 * `CREATE TABLE IF NOT EXISTS`. Die Tabellen gab es schon aus einem Import,
 * bei dem die Schluessel verloren gegangen sind - der uebliche Fall, wenn ein
 * Abzug ohne die nachgestellten `ALTER TABLE ... ADD KEY` eingespielt wird.
 *
 * Der Umbau ist gefahrlos, solange die Tabellen leer sind; sollten doch Zeilen
 * darin stehen, bekommen sie beim Umbau fortlaufende Nummern.
 */
module.exports = {
    description: 'automod_logs/automod_strikes: fehlende Primaerschluessel, AUTO_INCREMENT und Indizes nachtragen',

    async up(db) {
        await reparieren(db, 'automod_logs', 'INT UNSIGNED', [
            'ADD INDEX idx_guild (guild_id)',
            'ADD INDEX idx_member (member_id)',
            'ADD INDEX idx_logged_at (logged_at)',
            'ADD INDEX idx_guild_member_time (guild_id, member_id, logged_at)'
        ]);

        await reparieren(db, 'automod_strikes', 'INT UNSIGNED', [
            'ADD UNIQUE KEY unique_member (guild_id, member_id)',
            'ADD INDEX idx_guild_member (guild_id, member_id)',
            'ADD INDEX idx_strikes (strikes)'
        ]);
    },

    /**
     * Bewusst leer.
     *
     * Ein Rueckbau wuerde die Tabellen wieder unbeschreibbar machen - das ist
     * kein Zustand, in den man zurueck will.
     */
    async down() {
        // absichtlich nichts
    }
};

/**
 * Einer Tabelle Primaerschluessel, AUTO_INCREMENT und Indizes nachtragen.
 *
 * Jeder Schritt prueft erst, ob er noetig ist - die Migration darf mehrfach
 * laufen, ohne zu scheitern.
 *
 * @param {Object} db Datenbank-Verbindung der Migration
 * @param {string} tabelle Tabellenname
 * @param {string} typ Spaltentyp der id-Spalte
 * @param {string[]} indizes ALTER-Teile fuer die fehlenden Indizes
 */
async function reparieren(db, tabelle, typ, indizes) {
    const vorhanden = await db.query(
        `SELECT COUNT(*) AS anzahl FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        [tabelle]
    );
    if (!Number(vorhanden[0]?.anzahl)) return;

    // Primaerschluessel zuerst - ohne Schluessel nimmt MariaDB kein
    // AUTO_INCREMENT an.
    const pk = await db.query(
        `SELECT COUNT(*) AS anzahl FROM information_schema.TABLE_CONSTRAINTS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_TYPE = 'PRIMARY KEY'`,
        [tabelle]
    );
    if (!Number(pk[0]?.anzahl)) {
        await db.query(`ALTER TABLE \`${tabelle}\` ADD PRIMARY KEY (id)`);
    }

    const spalte = await db.query(
        `SELECT EXTRA FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'id'`,
        [tabelle]
    );
    if (!String(spalte[0]?.EXTRA || '').includes('auto_increment')) {
        await db.query(`ALTER TABLE \`${tabelle}\` MODIFY id ${typ} NOT NULL AUTO_INCREMENT`);
    }

    // Indizes einzeln, damit ein bereits vorhandener die anderen nicht aufhaelt
    for (const teil of indizes) {
        const name = teil.match(/(?:INDEX|KEY)\s+(\w+)\s*\(/i)?.[1];
        if (!name) continue;

        const da = await db.query(
            `SELECT COUNT(*) AS anzahl FROM information_schema.STATISTICS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
            [tabelle, name]
        );
        if (Number(da[0]?.anzahl)) continue;

        await db.query(`ALTER TABLE \`${tabelle}\` ${teil}`);
    }
}
