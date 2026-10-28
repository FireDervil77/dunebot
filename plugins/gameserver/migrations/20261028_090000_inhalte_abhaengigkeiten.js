'use strict';

/**
 * `gameserver_content.mitgebracht` und `.braucht` — wer hat wen auf den Server
 * gebracht (Betreiber, 2026-10-28).
 *
 * ── Der Befund ──────────────────────────────────────────────────────────────
 *
 * Satisfactory, Server 223: PowerChecker brachte MarcioCommonLibs und SML mit.
 * Wer PowerChecker entfernte, liess beide liegen — und der Server laedt SML,
 * solange es in `FactoryGame/Mods/` liegt. Kein Spieler ohne SML kam mehr
 * drauf. Die Anbieter nennen die Abhaengigkeiten bei JEDER Installation; wir
 * haben sie nur nicht aufgehoben.
 *
 * Entscheidung des Betreibers: **Was nur als Abhaengigkeit kam und von keinem
 * verbleibenden Inhalt mehr gebraucht wird, geht beim Entfernen mit.** Was man
 * selbst gewaehlt hat, bleibt.
 *
 *   mitgebracht  1 = kam nur als Abhaengigkeit, 0 = selbst gewaehlt,
 *                NULL = unbekannt (Zeilen von vor heute) — wird nie mitentfernt
 *   braucht      JSON-Liste der Kennungen (derselben Quelle), die dieser
 *                Inhalt braucht. NULL = unbekannt (Hochgeladenes, Modpacks,
 *                Altzeilen) — dann kann er alles brauchen, und es wird nichts
 *                mitentfernt.
 *
 * ── Und der Schalter ────────────────────────────────────────────────────────
 *
 * „Aus" an einem einzelnen Mod setzte nur `aktiv = 0`. Das las niemand: Die
 * Dateien blieben liegen, und das Spiel lud sie. Der Schalter ist weg
 * (Betreiber, 2026-10-28). Eine Mod-Zeile, die noch auf 0 steht, wird deshalb
 * auf 1 gesetzt — ihre Dateien laden ohnehin, die 0 war eine Behauptung. Der
 * Lader behaelt `aktiv`: Bei BepInEx wirkt er (loader.adds).
 */
module.exports = {
    description: 'gameserver_content.mitgebracht/braucht — Abhaengigkeiten gehen beim Entfernen mit',

    async up(db) {
        const [mit] = await db.query("SHOW COLUMNS FROM gameserver_content LIKE 'mitgebracht'");
        if (!mit) {
            await db.query(`
                ALTER TABLE gameserver_content
                  ADD COLUMN mitgebracht TINYINT(1) DEFAULT NULL
                  COMMENT '1 = nur als Abhaengigkeit gekommen, 0 = selbst gewaehlt, NULL = unbekannt'
                  AFTER client_side
            `);
        }
        const [braucht] = await db.query("SHOW COLUMNS FROM gameserver_content LIKE 'braucht'");
        if (!braucht) {
            await db.query(`
                ALTER TABLE gameserver_content
                  ADD COLUMN braucht LONGTEXT DEFAULT NULL
                  COMMENT 'JSON-Liste der Kennungen (gleiche Quelle), die dieser Inhalt braucht; NULL = unbekannt'
                  AFTER mitgebracht
            `);
        }

        await db.query(
            "UPDATE gameserver_content SET aktiv = 1 WHERE art <> 'loader' AND aktiv = 0 AND status <> 'entfernt'");
    },

    async down(db) {
        for (const spalte of ['braucht', 'mitgebracht']) {
            const [da] = await db.query(`SHOW COLUMNS FROM gameserver_content LIKE '${spalte}'`);
            if (da) await db.query(`ALTER TABLE gameserver_content DROP COLUMN ${spalte}`);
        }
    }
};
