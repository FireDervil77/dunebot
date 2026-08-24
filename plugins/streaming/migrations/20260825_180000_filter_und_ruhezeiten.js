'use strict';

/**
 * Ausschlussfilter und Ruhezeiten je Ziel.
 *
 * **Ausschluss** ist das Gegenstueck zum vorhandenen Filter: Bisher liess sich
 * nur sagen „melde NUR bei diesen Spielen". Der haeufigere Wunsch ist der
 * umgekehrte — „melde bei allem AUSSER Just Chatting". Beim Wettbewerb ist das
 * eine Bezahlfunktion (Streamcord loest es mit regulaeren Ausdruecken, was
 * maechtiger und fuer die meisten unbedienbar ist).
 *
 * **Ruhezeiten** unterdruecken Ankuendigungen in einem Zeitfenster. Gedacht
 * fuer Server, die nachts keinen Ping wollen. Die Zeiten sind reine Uhrzeiten
 * ohne Datum; in welcher Zeitzone sie gelten, steht als Guild-Einstellung
 * (`ZEITZONE`, Vorgabe Europe/Berlin) - sonst waere es die Zeitzone des
 * Servers, und die kennt niemand, der das Feld ausfuellt.
 *
 * `ruhe_von > ruhe_bis` ist ausdruecklich erlaubt und der Normalfall: 23:00 bis
 * 08:00 laeuft ueber Mitternacht.
 */
module.exports = {
    description: 'Ausschlussfilter und Ruhezeiten je Ziel',

    async up(db) {
        const vorhanden = await db.query(`
            SELECT COLUMN_NAME FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'streaming_targets'
               AND COLUMN_NAME IN ('filter_spiel_aus', 'filter_titel_aus', 'ruhe_von', 'ruhe_bis')
        `);
        const da = new Set(vorhanden.map(z => z.COLUMN_NAME));

        const spalten = [
            ['filter_spiel_aus', "VARCHAR(255) DEFAULT NULL COMMENT 'Kategorien, bei denen NICHT gemeldet wird'"],
            ['filter_titel_aus', "VARCHAR(255) DEFAULT NULL COMMENT 'Wort im Titel, das die Meldung verhindert'"],
            ['ruhe_von',         "TIME DEFAULT NULL COMMENT 'Beginn der Ruhezeit, Zeitzone der Guild'"],
            ['ruhe_bis',         "TIME DEFAULT NULL COMMENT 'Ende der Ruhezeit'"]
        ];

        for (const [name, art] of spalten) {
            if (da.has(name)) continue;
            await db.query(`ALTER TABLE streaming_targets ADD COLUMN ${name} ${art}`);
        }
    },

    async down(db) {
        for (const name of ['filter_spiel_aus', 'filter_titel_aus', 'ruhe_von', 'ruhe_bis']) {
            const da = await db.query(`
                SELECT COLUMN_NAME FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'streaming_targets'
                   AND COLUMN_NAME = ?`, [name]);
            if (da.length) await db.query(`ALTER TABLE streaming_targets DROP COLUMN ${name}`);
        }
    }
};
