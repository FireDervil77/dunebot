'use strict';

/**
 * Sicherungen merken sich, aus welcher Welt sie stammen (E-11).
 *
 * Solange jeder Server sein Paket eingefroren mit sich trug, gehörten Welt und
 * Paket automatisch zusammen — eine Sicherung konnte gar nicht zu etwas anderem
 * passen. Nach E-2 folgt ein Server einem **Kanal**: Eine drei Wochen alte Welt
 * trifft beim Wiederherstellen also auf das Paket von heute.
 *
 * Vier Spalten, damit man das überhaupt sehen kann:
 *
 *   package_slug      mit welchem Paket die Welt entstand
 *   package_version   in welcher Fassung
 *   package_checksum  erkennt auch stille Änderungen an der Fassung
 *   image_digest      in welcher Umgebung sie lief
 *
 * **Und die Regel dazu, die zur Spalte gehört:** Weicht die Fassung beim
 * Wiederherstellen ab, *sagt es die Oberfläche vorher* — als Hinweis, nicht als
 * Sperre. Eine Sperre wäre falsch: Meistens geht es gut, und wer seine Welt
 * zurückholen will, hat gerade andere Sorgen.
 *
 * Alle vier Spalten sind NULL-fähig, und NULL heißt hier etwas Bestimmtes:
 * *aus der Zeit vor dieser Kennzeichnung*. Die neun vorhandenen Sicherungen
 * (Stand 2026-08-16) bekommen keinen erfundenen Wert nachgetragen — geraten wäre
 * schlimmer als leer.
 */
module.exports = {
    description: 'gameserver_backups: mit welchem Paket und Image die Welt entstand (E-11)',

    async up(db) {
        const [vorhanden] = await db.query(
            "SHOW COLUMNS FROM gameserver_backups LIKE 'package_slug'"
        );
        if (vorhanden) return;

        await db.query(`
            ALTER TABLE gameserver_backups
            ADD COLUMN package_slug     VARCHAR(50) DEFAULT NULL
                COMMENT 'Paket, mit dem die Welt entstand. NULL = vor E-11 angelegt.' AFTER note,
            ADD COLUMN package_version  VARCHAR(20) DEFAULT NULL
                COMMENT 'Fassung des Pakets' AFTER package_slug,
            ADD COLUMN package_checksum CHAR(71)    DEFAULT NULL
                COMMENT 'sha256:… der Fassung — erkennt stille Aenderungen' AFTER package_version,
            ADD COLUMN image_digest     CHAR(71)    DEFAULT NULL
                COMMENT 'sha256:… des Images, in dem sie lief' AFTER package_checksum
        `);

        await db.query(`
            ALTER TABLE gameserver_backups
            ADD KEY idx_paket (package_slug, package_version)
        `);
    },

    async down(db) {
        await db.query('ALTER TABLE gameserver_backups DROP KEY idx_paket');
        await db.query(`
            ALTER TABLE gameserver_backups
            DROP COLUMN package_slug,
            DROP COLUMN package_version,
            DROP COLUMN package_checksum,
            DROP COLUMN image_digest
        `);
    }
};
