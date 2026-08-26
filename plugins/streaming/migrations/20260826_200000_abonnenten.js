'use strict';

/**
 * Abonnenten-Rollen (Stufe 12b).
 *
 * Hintergrund in `docs/streamer-plugin/12-Anmeldung-und-Chat.md`. Der
 * staerkste Einzelpunkt des ganzen Vorhabens: Discords eingebaute
 * Twitch-Verknuepfung kann nur Abonnenten-Rollen und tut es unzuverlaessig —
 * ein Aergernis, das jeder Streamer kennt.
 *
 * ## Was hier dazukommt
 *
 * `streaming_targets.abo_rolle_id` — die Rolle, die Abonnenten in DIESER Guild
 * bekommen. Je Guild eine andere: Derselbe Streamer kann auf einem Server
 * "Supporter" heissen und auf einem anderen "Abo". Deshalb am Ziel und nicht
 * am Streamer.
 *
 * `streaming_subscribers` — wer gerade abonniert hat. **Das ist kein
 * Zwischenspeicher aus Bequemlichkeit**, sondern die Grundlage des Abgleichs:
 * Ein `channel.subscription.end`, das verlorengeht, wuerde sonst nie
 * auffallen, und die Rolle bliebe fuer immer. Einmal am Tag wird die Liste
 * gegen Twitch geprueft — dieselbe Vorsichtsmassnahme wie bei der Live-Rolle.
 *
 * ## Warum die Twitch-Kennung und nicht die Discord-Kennung
 *
 * Ein Abonnement gehoert einem **Twitch-Konto**. Ob dahinter ein
 * Discord-Mitglied steht, ist eine zweite Frage, die sich jederzeit aendern
 * kann: Jemand kann heute abonnieren und erst naechste Woche sein Konto
 * verknuepfen. Wuerde hier die Discord-Kennung stehen, waere sein Abonnement
 * bis dahin unbekannt — und danach nicht nachtraeglich auffindbar.
 *
 * Die Uebersetzung Twitch -> Discord passiert deshalb erst beim Vergeben, ueber
 * `user_connections`. Wer nicht verknuepft ist, steht hier trotzdem drin und
 * bekommt seine Rolle in dem Moment, in dem er sich verknuepft.
 */

module.exports = {
    description: 'Abonnenten-Rollen: abo_rolle_id am Ziel und streaming_subscribers',

    async up(db) {
        // Nachgesehen am 2026-08-26 mit SHOW COLUMNS: Die Spalte gibt es
        // wirklich noch nicht. `IF NOT EXISTS` kennt MySQL bei ADD COLUMN
        // nicht durchgaengig, deshalb die Abfrage von Hand statt eines
        // Fehlers, der wie ein kaputter Umzug aussieht.
        const [vorhanden] = await db.query(`
            SELECT COLUMN_NAME FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'streaming_targets'
               AND COLUMN_NAME = 'abo_rolle_id'
        `);
        const schonDa = Array.isArray(vorhanden) ? vorhanden.length : Number(vorhanden || 0);

        if (!schonDa) {
            await db.query(`
                ALTER TABLE streaming_targets
                  ADD COLUMN abo_rolle_id VARCHAR(32) DEFAULT NULL AFTER rolle_id
            `);
        }

        await db.query(`
            CREATE TABLE IF NOT EXISTS streaming_subscribers (
                id             BIGINT AUTO_INCREMENT PRIMARY KEY,
                streamer_id    INT         NOT NULL,
                konto_id       VARCHAR(64) NOT NULL,
                konto_name     VARCHAR(128) DEFAULT NULL,
                stufe          VARCHAR(16) DEFAULT NULL,
                geschenkt      TINYINT(1)  NOT NULL DEFAULT 0,
                gesehen_am     DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
                angelegt_am    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uniq_streamer_konto (streamer_id, konto_id),
                KEY idx_streamer (streamer_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
    },

    async down(db) {
        await db.query('DROP TABLE IF EXISTS streaming_subscribers');
        // Die Spalte bleibt. Sie zu entfernen wuerde die Einstellung jeder
        // Guild verlieren, und ein Rueckbau ist kein Grund dafuer.
    }
};
