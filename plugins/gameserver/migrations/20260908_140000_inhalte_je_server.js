'use strict';

/**
 * Inhalte je Server: Mods und der Lader, der sie traegt (E6 / B.12).
 *
 * ── Warum eine Tabelle und nicht die Startzeile ─────────────────────────────
 *
 * Heute stehen Mods bei ARK in `gameservers.launch_params` — und die wird beim
 * Anlegen **eingefroren**. Eine Paketaenderung erreicht bestehende Server nie;
 * genau deshalb brauchte es die Migration `20260811_120000_ark_leere_modliste`.
 * Eine Modliste in einer eingefrorenen Startzeile ist kein Zustand, den man
 * pflegen kann.
 *
 * ── Was hier NICHT steht: der Katalog ───────────────────────────────────────
 *
 * Diese Tabelle haelt, was auf EINEM Server liegt — eine Handvoll Zeilen. Sie
 * ist kein Verzeichnis der moeglichen Mods eines Spiels; das haben Thunderstore,
 * Modrinth und CurseForge als API, und ein handgepflegter Katalog waere in einer
 * Woche veraltet. Betreiber am 2026-09-08: „woher und wo muessen wir diese infos
 * zu moeglichen mods eines spiels ja anlegen und vor allem auch pflegen koennen"
 * — die Antwort ist: die moeglichen nicht, die installierten hier.
 *
 * ── Der Lader ist eine Zeile, kein Sonderfall ───────────────────────────────
 *
 * `art = 'loader'`. Damit ist „ist BepInEx scharf?" eine Abfrage statt eines
 * zweiten Mechanismus neben der Liste, und `loader.installable_as_content: true`
 * aus dem Paketschema meint genau das: Der Lader wird wie ein Inhalt behandelt.
 *
 * ── Die Fassung ist der Kern ────────────────────────────────────────────────
 *
 * B.12 nennt das Mod-Update mitten in der Woche als haeufigste Ursache dafuer,
 * dass ein Server nicht mehr startet. Deshalb `fassung` — dieselbe Ueberlegung
 * wie bei `gameserver_backups.package_version` und `package_checksum`, die
 * stille Aenderungen sichtbar machen.
 *
 * ── Entfernte Zeilen bleiben stehen ─────────────────────────────────────────
 *
 * Entscheidung des Betreibers, 2026-09-08: „behalten, denn dann ist das ganze
 * ein lernender Prozess den man ueberblicken kann." `status = 'entfernt'` statt
 * DELETE. Damit ist der Rueckweg auf eine vorige Fassung moeglich (B.12
 * verlangt ihn ausdruecklich) und im Nachhinein sichtbar, welcher Mod wann
 * dazukam — die Frage, die nach einem kaputten Server als erste gestellt wird.
 */
module.exports = {
    description: 'gameserver_content — Mods und Lader je Server, mit fester Fassung (E6/B.12)',

    async up(db) {
        // `SHOW TABLES` statt `CREATE TABLE IF NOT EXISTS`: Letzteres legt bei
        // einer abweichenden Tabelle nichts an und meldet trotzdem Erfolg.
        const [vorhanden] = await db.query("SHOW TABLES LIKE 'gameserver_content'");
        if (vorhanden) return;

        await db.query(`
            CREATE TABLE gameserver_content (
                id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
                server_id      INT UNSIGNED NOT NULL,
                guild_id       VARCHAR(20)  NOT NULL
                               COMMENT 'Wie bei den Sicherungen: Filter ohne JOIN',

                art            ENUM('loader','mod') NOT NULL DEFAULT 'mod'
                               COMMENT 'Der Lader ist die erste Zeile, kein Sonderfall',
                quelle         ENUM('thunderstore','modrinth','curseforge','steam-workshop','upload')
                               NOT NULL
                               COMMENT 'Dieselben Werte wie content.sources im Paketschema',
                kennung        VARCHAR(190) NOT NULL
                               COMMENT 'Kennung an der Quelle; bei upload der Dateiname',
                name           VARCHAR(190) DEFAULT NULL,

                fassung        VARCHAR(64)  DEFAULT NULL
                               COMMENT 'Die FESTE Fassung. NULL = unbekannt, nicht "neueste".',

                aktiv          TINYINT(1)   NOT NULL DEFAULT 1
                               COMMENT 'An/aus ohne Loeschen (B.12)',
                reihenfolge    SMALLINT UNSIGNED NOT NULL DEFAULT 0
                               COMMENT 'Nur wenn das Paket order_matters sagt',
                ablage         VARCHAR(255) DEFAULT NULL
                               COMMENT 'Wohin es gelegt wurde, relativ zu content.path — sonst ist Entfernen Raten',
                client_side    TINYINT(1)   NOT NULL DEFAULT 0
                               COMMENT 'Muessen die Mitspieler das auch haben? (B.12)',

                status         ENUM('geplant','installiert','fehlgeschlagen','entfernt')
                               NOT NULL DEFAULT 'geplant',
                fehler         TEXT DEFAULT NULL,

                installiert_am TIMESTAMP NULL DEFAULT NULL,
                created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

                PRIMARY KEY (id),
                UNIQUE KEY uq_inhalt (server_id, quelle, kennung),
                KEY idx_server (server_id),
                KEY idx_guild (guild_id),
                KEY idx_status (status),
                CONSTRAINT fk_gameserver_content_server
                    FOREIGN KEY (server_id) REFERENCES gameservers (id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
              COMMENT='Mods und Lader je Server (E6/B.12). Kein Katalog moeglicher Mods.'
        `);
    },

    async down(db) {
        await db.query('DROP TABLE IF EXISTS gameserver_content');
    }
};
