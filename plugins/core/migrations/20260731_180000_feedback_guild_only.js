'use strict';

/**
 * Ergänzt die fehlende Spalte `user_feedback.guild_only`.
 *
 * Bug Report und Feature Request sind bewusst guild-übergreifend: Jede Guild hat
 * ihre eigene Seite, der Inhalt aber gehört allen, die den Bot einsetzen. Genau
 * das setzt der Router um – `WHERE type = ? AND (guild_only = 0 OR guild_id = ?)`
 * – und beide Formulare bieten ein Häkchen an, mit dem der Verfasser einen
 * Eintrag auf seine eigene Guild beschränken kann.
 *
 * Nur: Die Spalte gab es nie. Sie kam mit dem Router und den Ansichten ins Repo,
 * ohne Migration. Folge im Betrieb – und das ist der eigentliche Schaden:
 *
 *   - Die Listen waren **immer leer**. Die Abfrage lief in ER_BAD_FIELD_ERROR,
 *     ein `.catch()` fing den Fehler ab und lieferte `[]` zurück. Für den
 *     Besucher sah das aus wie „noch keine Einträge", nicht wie ein Defekt.
 *   - Das Anlegen scheiterte ebenfalls, weil das INSERT dieselbe Spalte nennt.
 *
 * Beides erklärt, warum in `user_feedback` seit Oktober 2025 nichts mehr
 * dazugekommen ist.
 *
 * Der Standardwert 0 ist die richtige Wahl: sichtbar für alle. Die Beschränkung
 * auf die eigene Guild bleibt die bewusste Ausnahme, die der Verfasser ankreuzt.
 */
module.exports = {
    description: 'user_feedback.guild_only nachtragen',

    async up(db) {
        const [spalte] = await db.query(`
            SELECT COLUMN_NAME
            FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'user_feedback'
              AND COLUMN_NAME = 'guild_only'
        `);

        if (spalte) return;

        await db.query(`
            ALTER TABLE user_feedback
            ADD COLUMN guild_only TINYINT(1) NOT NULL DEFAULT 0
            COMMENT '1 = nur in der eigenen Guild sichtbar, 0 = fuer alle'
            AFTER category
        `);

        // Die beiden Altbestände sind vor dem Häkchen entstanden und sollen
        // sichtbar bleiben - der Default deckt das bereits ab, hier nur explizit.
        await db.query('UPDATE user_feedback SET guild_only = 0 WHERE guild_only IS NULL');
    },

    async down(db) {
        await db.query('ALTER TABLE user_feedback DROP COLUMN guild_only');
    },
};
