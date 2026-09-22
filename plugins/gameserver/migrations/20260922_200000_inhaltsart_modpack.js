'use strict';

/**
 * `gameserver_content.art` bekommt „modpack" (Betreiberbefund 2026-09-22).
 *
 * ── Woher es kommt ──────────────────────────────────────────────────────────
 *
 * *„Die mod seite zeigt die installierten mods nicht an die dem paket bekannt
 * sind."*
 *
 * Gemessen: Der Reiter „Mods" sagte „Noch nichts installiert", während in
 * `mods/` achtundvierzig Dateien lagen. Grund: Das Modpack schreibt seine
 * Dateien im Installationsskript — das Panel erfuhr davon nie, weil niemand eine
 * Zeile in `gameserver_content` anlegte.
 *
 * ── Warum EINE Zeile und nicht achtundvierzig ───────────────────────────────
 *
 * Ein Modpack ist eine Einheit. Seine Mods einzeln zu führen wäre eine Lüge über
 * die Verwaltbarkeit: Wer eine davon aktualisiert, zerlegt das Paket, und die
 * nächste Fassung des Packs räumt sie ohnehin weg. Die Liste soll sagen „hier
 * liegt Paket X in Fassung Y", nicht achtundvierzig Zeilen, die aussehen wie
 * einzeln gewählte Mods.
 *
 * Deshalb eine dritte Art neben `loader` und `mod` — dieselbe Spalte, die den
 * Unterschied schon heute trägt.
 *
 * ── Warum die Aufzählung und nicht ein Freitext ─────────────────────────────
 *
 * `art` ist ein `enum`, und das bleibt es. Eine Spalte, die drei Werte kennt,
 * meldet einen vierten als Fehler statt ihn stillschweigend zu speichern — und
 * genau das will man bei einer Unterscheidung, an der die Anzeige hängt.
 */
module.exports = {
    description: 'gameserver_content.art: dritte Art „modpack"',

    async up(db) {
        const [da] = await db.query(
            `SELECT COLUMN_TYPE AS t
               FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME = 'gameserver_content'
                AND COLUMN_NAME = 'art'`
        );
        // Schon erweitert? Dann nichts tun — die Migration läuft bei jedem Start
        // durch die Prüfung, und ein zweites ALTER wäre reine Sperrzeit.
        if (!da || String(da.t).includes("'modpack'")) return;

        await db.query(`
            ALTER TABLE gameserver_content
                MODIFY COLUMN art ENUM('loader','mod','modpack') NOT NULL
                    COMMENT 'loader = Mod-Lader, mod = einzelne Mod, modpack = ganzes Paket (eine Zeile)'
        `);
    },

    async down(db) {
        const [da] = await db.query(
            `SELECT COLUMN_TYPE AS t
               FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME = 'gameserver_content'
                AND COLUMN_NAME = 'art'`
        );
        if (!da || !String(da.t).includes("'modpack'")) return;

        // Zeilen dieser Art zuerst weg: Ein MODIFY, das einen vorhandenen Wert
        // nicht mehr kennt, macht daraus stillschweigend '' — und dann steht in
        // der Liste ein Eintrag ohne Art.
        await db.query("DELETE FROM gameserver_content WHERE art = 'modpack'");
        await db.query(`
            ALTER TABLE gameserver_content
                MODIFY COLUMN art ENUM('loader','mod') NOT NULL
        `);
    },
};
