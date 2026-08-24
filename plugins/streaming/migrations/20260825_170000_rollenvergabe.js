'use strict';

/**
 * Merken, welche Rollen das Plugin selbst vergeben hat.
 *
 * **Warum das noetig ist — ein Vorfall vom 2026-08-25:**
 *
 * Der Betreiber hatte auf seinem Server bereits eine Rolle „onAir", die den
 * privaten Streaming-Bereich freischaltet: Wer sie traegt, sieht die Kanaele.
 * Sie ist ein **Zugangsrecht** und dauerhaft. Genau diese Rolle wurde als
 * Live-Rolle eingetragen.
 *
 * Der Rollenabgleich fragte darauf: „Wer traegt die Rolle, und wer sollte sie
 * tragen?" — fand vier Traeger, von denen niemand sendete, und nahm sie
 * **allen vier** weg. Aus seiner Sicht voellig richtig. Fuer den Server ein
 * Zugangsverlust.
 *
 * Der Denkfehler war meiner: Ich hatte „traegt die Rolle" mit „hat sie von uns
 * bekommen" gleichgesetzt. Eine Rolle kann aber aus zehn anderen Gruenden an
 * jemandem haengen — von Hand vergeben, aus einem Rollenmenue, von einem
 * anderen Bot.
 *
 * **Die Regel, die daraus folgt und ueberall gelten sollte: Ein Bot nimmt nur
 * zurueck, was er selbst gegeben hat.** Alles andere gehoert ihm nicht.
 *
 * Diese Tabelle ist das Gedaechtnis dafuer. Sie ist bewusst klein und ohne
 * Fremdschluessel auf `streaming_targets`: Die Vergabe ueberlebt das Loeschen
 * eines Ziels, sonst bliebe die Rolle nach dem Aufraeumen haengen.
 */
module.exports = {
    description: 'Gedaechtnis: welche Live-Rollen hat das Plugin selbst vergeben',

    async up(db) {
        await db.query(`
            CREATE TABLE IF NOT EXISTS streaming_role_grants (
                id          BIGINT AUTO_INCREMENT PRIMARY KEY,
                guild_id    VARCHAR(32) NOT NULL,
                mitglied_id VARCHAR(32) NOT NULL,
                rolle_id    VARCHAR(32) NOT NULL,
                vergeben_am DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uniq_vergabe (guild_id, mitglied_id, rolle_id),
                KEY idx_rolle (guild_id, rolle_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
    },

    async down(db) {
        await db.query('DROP TABLE IF EXISTS streaming_role_grants');
    }
};
