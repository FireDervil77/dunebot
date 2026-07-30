'use strict';

/**
 * Zähler, mit dem ein Panel-Push atomar beansprucht wird.
 *
 * Anlass: Beim ersten Anlegen erschien das Panel **zweimal** in Discord. Zwei
 * Pushes lagen 43 ms auseinander – der erzwungene Push aus `PanelService.create()`
 * und der reguläre aus dem Poller, der die neue Zeile beim Index-Neuladen sofort
 * sah. Beide lasen `message_id = NULL`, beide schlossen daraus "noch nie
 * gepostet" und schickten eine neue Nachricht; die zweite überschrieb die
 * `message_id` der ersten, womit die erste zur Waise wurde.
 *
 * `last_pushed_at` taugt nicht als Anspruchsmarke: Zwei Pushes in derselben
 * Sekunde schreiben denselben DATETIME-Wert, und dann meldet MySQL keine
 * geänderte Zeile, obwohl die Bedingung zutraf. Ein Zähler ändert sich immer.
 *
 * Ablauf: Zeile mit `push_seq` lesen, dann
 * `UPDATE … SET push_seq = push_seq + 1 WHERE id = ? AND push_seq = ?`.
 * Nur wer genau eine Zeile trifft, darf senden – der Verlierer überspringt.
 */
module.exports = {
    description: 'gameserver-panel-push-seq',

    async up(db) {
        const [existing] = await db.query(`
            SELECT COUNT(*) AS n
            FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'gameserver_status_panels'
              AND COLUMN_NAME = 'push_seq'
        `);

        if (Number(existing?.n) > 0) return;

        await db.query(`
            ALTER TABLE gameserver_status_panels
            ADD COLUMN push_seq INT UNSIGNED NOT NULL DEFAULT 0
                COMMENT 'Anspruchsmarke gegen doppelte Pushes'
        `);
    },

    async down(db) {
        await db.query('ALTER TABLE gameserver_status_panels DROP COLUMN push_seq');
    }
};
