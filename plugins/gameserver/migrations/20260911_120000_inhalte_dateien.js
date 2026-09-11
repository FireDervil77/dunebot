'use strict';

/**
 * `gameserver_content.dateien` — was wirklich geschrieben wurde (E6/B.12).
 *
 * ── Warum eine Liste und nicht ein Ort ──────────────────────────────────────
 *
 * `ablage` haelt EINEN Pfad. Bei einer .zip mit mehreren Dateien steht dort
 * seit dem 2026-09-08 der ZIELORDNER — bei Valheim also `BepInEx/plugins`.
 * Entfernen loeschte damit den Ordner: **alle** Mods des Servers, nicht den
 * einen. Gemessen an den echten Archiven: Jotunn 2.29.2 legt vier Dateien
 * direkt in `plugins`, keine davon in einem eigenen Unterordner — es gibt also
 * gar keinen Pfad, der nur diesen Mod meint.
 *
 * Der Daemon antwortet auf `gameserver.content.fetch` und `…content.install`
 * ohnehin mit der Liste der geschriebenen Dateien. Sie wegzuwerfen und spaeter
 * zu raten war der Fehler; hier wird sie aufgehoben.
 *
 * `ablage` bleibt: Sie ist die Anzeige in der Karte („wo liegt das?"), die
 * Liste ist die Wahrheit fuers Entfernen und Aktualisieren. LONGTEXT statt
 * JSON, wie ueberall sonst in diesem Schema.
 */
module.exports = {
    description: 'gameserver_content.dateien — die geschriebenen Dateien je Eintrag (E6/B.12)',

    async up(db) {
        // Erst nachsehen, dann aendern: `ADD COLUMN IF NOT EXISTS` kennt MySQL
        // nicht, und ein Fehlschlag mitten in einer Migration laesst die
        // Tabelle halb umgebaut zurueck.
        const [vorhanden] = await db.query("SHOW COLUMNS FROM gameserver_content LIKE 'dateien'");
        if (vorhanden) return;

        await db.query(`
            ALTER TABLE gameserver_content
              ADD COLUMN dateien LONGTEXT DEFAULT NULL
              COMMENT 'JSON-Liste der geschriebenen Dateien, relativ zum Serververzeichnis'
              AFTER ablage
        `);
    },

    async down(db) {
        const [vorhanden] = await db.query("SHOW COLUMNS FROM gameserver_content LIKE 'dateien'");
        if (!vorhanden) return;
        await db.query('ALTER TABLE gameserver_content DROP COLUMN dateien');
    }
};
