'use strict';

/**
 * Eigene Tondateien im Dashboard hochladen und abspielen.
 *
 * Discords zehn Megabyte sind eine Grenze fuers **Hochladen** von Anhaengen -
 * mit dem Abspielen haben sie nichts zu tun. Der Bot schiebt Opus in die
 * Sprachverbindung; Discord sieht die Datei nie und kennt dort keine Groesse.
 * Wer eine grosse Datei spielen will, braucht also nur einen Weg, sie zum Bot
 * zu bringen, ohne sie durch Discord zu schicken.
 *
 * ── Warum es Grenzen gibt, obwohl es technisch keine gaebe ──────────────────
 *
 * Der Wunsch war ausdruecklich **nicht**, dass am Ende jede Guild Dateien bei
 * uns liegen laesst. Der Plattenplatz ist ein geteilter, endlicher Vorrat -
 * dieselbe Lage wie beim Streaming-Plugin. Deshalb drei Riegel, von denen zwei
 * hier stehen:
 *
 *   `datei_quota_mb`            Wie viel eine Guild belegen darf. 0 = unbegrenzt.
 *   `datei_aufbewahrung_tage`   Nach wie vielen Tagen ohne Abspielen eine Datei
 *                               von selbst verschwindet. 0 = nie.
 *
 * Der dritte Riegel ist ein eigenes Recht (`MUSIC.FILES.UPLOAD`) - wer es nicht
 * vergibt, fuer den existiert die Funktion in seiner Guild gar nicht.
 *
 * ── Zur Tabelle ────────────────────────────────────────────────────────────
 *
 * `dateiname` ist der selbst vergebene Name auf der Platte, `originalname` der,
 * den der Nutzer kennt. Beide getrennt, weil man den zweiten anzeigen und den
 * ersten niemals aus einer Eingabe uebernehmen will.
 *
 * `zuletzt_gespielt` traegt die Aufbewahrung. Ohne diese Spalte muesste der
 * Aufraeumer nach Hochladedatum gehen und wuerde genau die Dateien loeschen,
 * die staendig laufen.
 */
module.exports = {
    description: 'Musik: eigene Tondateien (Tabelle music_files, Obergrenze und Aufbewahrung)',

    async up(db) {
        await db.query(`
            CREATE TABLE IF NOT EXISTS music_files (
                id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                guild_id         VARCHAR(32)  NOT NULL,
                dateiname        VARCHAR(255) NOT NULL COMMENT 'Name auf der Platte, selbst vergeben',
                originalname     VARCHAR(255) NOT NULL COMMENT 'Name, den der Nutzer kennt',
                groesse_bytes    BIGINT UNSIGNED NOT NULL DEFAULT 0,
                dauer_sek        INT UNSIGNED DEFAULT NULL,
                hochgeladen_von  VARCHAR(32)  DEFAULT NULL,
                hochgeladen_am   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
                zuletzt_gespielt DATETIME     DEFAULT NULL,
                UNIQUE KEY uk_guild_datei (guild_id, dateiname),
                INDEX idx_guild (guild_id),
                INDEX idx_aufbewahrung (guild_id, zuletzt_gespielt)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        const spalten = [
            'datei_quota_mb SMALLINT UNSIGNED NOT NULL DEFAULT 250',
            'datei_aufbewahrung_tage SMALLINT UNSIGNED NOT NULL DEFAULT 30'
        ];

        for (const spalte of spalten) {
            await db.query(`ALTER TABLE music_settings ADD COLUMN IF NOT EXISTS ${spalte}`);
        }
    },

    /**
     * Der Rueckbau entfernt die Tabelle und die beiden Spalten - **nicht** aber
     * die Dateien auf der Platte. Eine Migration soll keine Nutzdaten wegwerfen,
     * die sie nie angelegt hat; das Verzeichnis bleibt stehen und laesst sich
     * von Hand aufraeumen.
     */
    async down(db) {
        await db.query('DROP TABLE IF EXISTS music_files');

        for (const spalte of ['datei_quota_mb', 'datei_aufbewahrung_tage']) {
            await db.query(`ALTER TABLE music_settings DROP COLUMN IF EXISTS ${spalte}`);
        }
    }
};
