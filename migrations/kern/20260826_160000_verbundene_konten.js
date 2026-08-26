'use strict';

/**
 * Tabelle fuer verbundene Konten: Discord-Benutzer <-> Konto einer Plattform.
 *
 * Hintergrund in `docs/streamer-plugin/11-Kontoverknuepfung.md`. Kurz: Der
 * gesamte Markt zieht die Grenze nicht zwischen oeffentlichen und privaten
 * Daten, sondern zwischen einer Aussage ueber einen **Kanal** und einer
 * Aussage ueber eine **Person**. Eine Ankuendigung verlangt nirgends eine
 * Verknuepfung; eine Rolle an einem Mitglied verlangt sie bei Discord wie bei
 * Streamcord. Unsere Live-Rolle stand bis heute auf der falschen Seite:
 * `streaming_targets.mitglied_id` ist ein Auswahlfeld, in dem die
 * Serverleitung ein beliebiges Mitglied anklickt.
 *
 * ## Zwei Eindeutigkeiten, und die zweite ist der ganze Punkt
 *
 *   uniq_benutzer_plattform  — ein Benutzer hat je Plattform hoechstens ein Konto
 *   uniq_plattform_konto     — ein Konto gehoert hoechstens einem Benutzer
 *
 * Die zweite verwandelt die Verknuepfung von einer Behauptung in einen
 * Nachweis: Sobald jemand `twitch/firedervil` beansprucht hat, kann es kein
 * zweiter mehr. Ohne sie waere die Tabelle nur eine hoeflichere Form
 * desselben Auswahlfeldes.
 *
 * ## Was hier NICHT steht: der Zugangsschluessel
 *
 * Kein `access_token`, kein `refresh_token`. Am selben Tag wurde genau das aus
 * `users.tokens` entfernt (Baustelle 74), weil es dort niemand las — es waere
 * absurd, es hier neu einzufuehren.
 *
 * Gespeichert wird der **Nachweis**, nicht der Schluessel: "diese Person hat
 * belegt, dass ihr dieses Konto gehoert". Braucht eine Funktion spaeter
 * dauerhaften Zugriff im Namen des Benutzers, ist das eine eigene
 * Entscheidung mit eigener Begruendung — und dann verschluesselt und mit
 * einem echten Verwender, nicht auf Vorrat.
 *
 * ## Warum im Kern und nicht im Plugin
 *
 * Widerruf, Loeschung und Auskunft muessen an EINER Stelle passieren. Lebten
 * die Verknuepfungen je Plugin, haette ein geloeschtes Konto irgendwo noch
 * einen Eintrag. Die Plattformen selbst kennt der Kern nicht — die tragen
 * sich ueber `VerbindungsRegistry` ein, so wie Webhooks es schon tun.
 */

module.exports = {
    description: 'Tabelle user_connections fuer verbundene Konten',

    async up(db) {
        await db.query(`
            CREATE TABLE IF NOT EXISTS user_connections (
                id           INT AUTO_INCREMENT PRIMARY KEY,
                user_id      VARCHAR(32)  NOT NULL,
                plattform    VARCHAR(32)  NOT NULL,
                konto_id     VARCHAR(64)  NOT NULL,
                konto_name   VARCHAR(128) DEFAULT NULL,
                angelegt_am  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
                geprueft_am  DATETIME     DEFAULT NULL,
                UNIQUE KEY uniq_benutzer_plattform (user_id, plattform),
                UNIQUE KEY uniq_plattform_konto (plattform, konto_id),
                KEY idx_benutzer (user_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
    },

    async down(db) {
        await db.query('DROP TABLE IF EXISTS user_connections');
    }
};
