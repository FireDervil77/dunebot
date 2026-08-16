'use strict';

/**
 * Pakete bekommen eine eigene, fassungsgeführte Heimat (E-1, E-1.1).
 *
 * Heute steht ein Spielpaket als eine Zeile in `addon_marketplace`: Identität und
 * Inhalt in derselben Zeile, mit einer JSON-Spalte, die beim Bearbeiten
 * überschrieben wird. Es gibt also immer nur einen Stand — keinen Rückweg, keine
 * Auskunft darüber, womit ein Server letzte Woche lief, und keinen Ort für die
 * Kanäle `stable`/`test`.
 *
 * Genau diese drei Dinge machen den Wegfall von `frozen_game_data` (E-2) erst
 * verantwortbar: Ein Server zeigt künftig nicht mehr starr auf eine eingefrorene
 * Kopie, sondern folgt einem **Kanal** — und ein Kanal kann nur auf etwas zeigen,
 * das es als eigenständige, unveränderliche Zeile gibt.
 *
 * Deshalb zwei Tabellen:
 *
 *   packages           WER es ist   — slug, Name, Kategorie, Sichtbarkeit
 *   package_versions   WAS drinsteht — FBPKG_v1-Dokument, Prüfsumme, Kanal
 *
 * ── Warum `packages.id` aus `addon_marketplace.id` kommt ────────────────────
 *
 * `addon_ratings`, `addon_comments` und `addon_favorites` zeigen heute auf
 * `addon_marketplace.id`. Eine Bewertung gilt dem *Spielpaket*, nicht der Fassung
 * 3.1.0 — sie gehört also an die Identität. Weil die Kennungen übernommen werden,
 * ziehen Bewertungen und Kommentare beim Schnitt einfach mit um, statt zu
 * zerfallen (E-1.1). Das ist die Bedingung, unter der der saubere Schnitt auch
 * für den Marktplatz gilt: Der *Paketinhalt* wird ersetzt, das *Drumherum* zieht um.
 *
 * ── Was diese Migration bewusst NICHT tut ───────────────────────────────────
 *
 * Sie hängt die Fremdschlüssel der drei sozialen Tabellen **noch nicht** um.
 * Solange `addon_marketplace` weiterläuft (bis Stufe 6), müssten sonst beide
 * Tabellen dauerhaft im Gleichschritt gehalten werden — eine Sync-Pflicht ohne
 * Gegenwert. Nachgemessen am 2026-08-16: Alle drei Tabellen sind **leer**, es
 * gibt also nichts zu retten, nur etwas vorzubereiten. Das Umhängen gehört in
 * den Schnitt, wo auch `gameservers.addon_marketplace_id` umzieht.
 *
 * Ebenfalls nicht: Daten einspielen. Die 273 übersetzten Pakete sind
 * unvollständig (`status.complete = false`) — sie hier abzulegen hiesse, einen
 * halbfertigen Marktplatz als echt auszugeben.
 *
 * ── Anmerkung zu den Spalten ────────────────────────────────────────────────
 *
 * E-1 nennt als Identität vier Felder (slug, Name, Kategorie, Sichtbarkeit).
 * Übernommen sind zusätzlich die Felder, ohne die der bestehende Marktplatz
 * nicht anzeigbar wäre — Beschreibung, Autor, Bilder, die Zähler der sozialen
 * Schicht. Alles davon steht heute schon in `addon_marketplace` und ist
 * Identität, nicht Inhalt: Es überlebt eine neue Fassung unverändert.
 * Feldnamen englisch nach E-7.
 */
module.exports = {
    description: 'packages + package_versions — Pakete mit Fassungen und Kanälen (E-1)',

    async up(db) {
        const [vorhanden] = await db.query("SHOW TABLES LIKE 'packages'");
        if (vorhanden) return;

        await db.query(`
            CREATE TABLE packages (
                id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
                slug            VARCHAR(50)  NOT NULL COMMENT 'Kürzel, dasselbe wie im FBPKG-Dokument',
                name            VARCHAR(100) NOT NULL,
                description     TEXT         DEFAULT NULL,
                category        ENUM('fps','survival','sandbox','mmorpg','racing','strategy','horror','scifi','other')
                                NOT NULL DEFAULT 'other',
                visibility      ENUM('official','public','unlisted','private') NOT NULL DEFAULT 'public',
                guild_id        VARCHAR(20)  DEFAULT NULL COMMENT 'Nur bei visibility=private: wer es sehen darf',
                author_user_id  VARCHAR(20)  DEFAULT NULL COMMENT 'Discord-Kennung des Erstellers',
                icon_url        VARCHAR(255) DEFAULT NULL,
                banner_url      VARCHAR(255) DEFAULT NULL,
                install_count   INT UNSIGNED NOT NULL DEFAULT 0,
                rating_avg      DECIMAL(3,2) NOT NULL DEFAULT 0.00,
                rating_count    INT UNSIGNED NOT NULL DEFAULT 0,
                created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                UNIQUE KEY uq_slug (slug),
                KEY idx_visibility (visibility),
                KEY idx_category (category),
                KEY idx_guild (guild_id),
                CONSTRAINT chk_private_guild CHECK (visibility <> 'private' OR guild_id IS NOT NULL),
                CONSTRAINT chk_rating_range  CHECK (rating_avg >= 0.00 AND rating_avg <= 5.00)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
              COMMENT='Identität eines Spielpakets (E-1). Der Inhalt steht in package_versions.'
        `);

        // Der Inhalt. Was hier steht, wird nie wieder verändert — deshalb gibt es
        // kein updated_at: Eine Fassung ist ein Stand, keine Akte. Beweglich ist
        // allein `channel`, denn genau das IST das Hochstufen von test nach stable.
        await db.query(`
            CREATE TABLE package_versions (
                id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
                package_id      INT UNSIGNED NOT NULL,
                version         VARCHAR(20)  NOT NULL COMMENT 'SemVer, z.B. 3.1.0',
                fbpkg           LONGTEXT     CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL
                                COMMENT 'Das vollständige FBPKG_v1-Dokument'
                                CHECK (json_valid(fbpkg)),
                checksum        CHAR(71)     NOT NULL
                                COMMENT 'sha256:… über das Dokument — erkennt auch stille Änderungen',
                channel         ENUM('stable','test') NOT NULL DEFAULT 'test'
                                COMMENT 'Welchem Kanal diese Fassung dient. Servers folgen dem Kanal (E-2).',
                changelog       TEXT         DEFAULT NULL,
                published_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
                published_by    VARCHAR(20)  DEFAULT NULL,
                test_passed_at  TIMESTAMP    NULL DEFAULT NULL
                                COMMENT 'Wann der Prüfdurchlauf bestanden wurde — Bedingung für stable (E-17)',
                released_at     TIMESTAMP    NULL DEFAULT NULL
                                COMMENT 'Wann der Betreiber freigegeben hat — zweite Bedingung für stable (E-17)',
                released_by     VARCHAR(20)  DEFAULT NULL,
                PRIMARY KEY (id),
                UNIQUE KEY uq_package_version (package_id, version),
                KEY idx_kanal (package_id, channel, published_at),
                CONSTRAINT fk_package_versions_package
                    FOREIGN KEY (package_id) REFERENCES packages (id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
              COMMENT='Unveränderliche Fassungen eines Pakets (E-1). Beweglich ist nur der Kanal.'
        `);
    },

    async down(db) {
        await db.query('DROP TABLE IF EXISTS package_versions');
        await db.query('DROP TABLE IF EXISTS packages');
    }
};
