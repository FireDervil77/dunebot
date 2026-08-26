'use strict';

/**
 * Tabelle fuer **Zusagen**: erteilte Berechtigungen samt Zugangsschluessel.
 *
 * Hintergrund in `docs/streamer-plugin/12-Anmeldung-und-Chat.md`. Kurz: Die
 * Verknuepfung vom 2026-08-26 fragt **keinen** Scope ab und beweist nur
 * Identitaet. Fuer Abonnenten-Rollen, Chat und Moderation braucht Twitch
 * erteilte Berechtigungen und damit erneuerbare Nutzer-Token.
 *
 * ## Warum eine ZWEITE Tabelle und nicht zwei Spalten mehr
 *
 * `user_connections` traegt die Zusage *„mir gehoert dieses Konto"*. Diese
 * Aussage bleibt wahr, auch wenn jede Berechtigung widerrufen ist. Steckte
 * der Schluessel in derselben Zeile, wuerde ein Widerruf entweder den
 * Nachweis mitloeschen oder eine halbleere Zeile hinterlassen.
 *
 * Der zweite Grund ist eine Zusage, die wir schon gegeben haben:
 * `scripts/check-verbindungen.js` prueft **live gegen die Datenbank**, dass
 * `user_connections` keine Token-Spalte hat. Diese Pruefung soll gruen
 * bleiben — sie ist nicht laestig, sie ist der Grund, warum man dem Satz
 * "der Nachweis enthaelt keinen Schluessel" glauben kann.
 *
 * ## Der Fremdschluessel ist die Sicherheitseigenschaft
 *
 *   verbindung_id -> user_connections(id) ON DELETE CASCADE
 *
 * Wer seine Verknuepfung loest, verliert damit **zwangslaeufig** alle
 * Schluessel. Das kann kein Aufrufer vergessen, weil es niemand ausfuehrt.
 * Ohne den Fremdschluessel waere "loesen" eine Absichtserklaerung.
 *
 * ## Was verschluesselt liegt und was nicht
 *
 * `zugang_ver` und `erneuerung_ver` gehen durch `Cryptr`/`TOKEN_ENCRYPTION_KEY`
 * — die Endung `_ver` steht fuer verschluesselt und ist Absicht: Wer die
 * Spalte im Klartext beschreibt, faellt beim Lesen auf.
 *
 * `scopes` liegt im Klartext. Es ist keine Geheimnis, sondern die Auskunft
 * *„das hast du uns erlaubt"* — und die muss man anzeigen koennen, ohne einen
 * Schluessel zu entschluesseln.
 *
 * ## laeuft_ab_am ist ein Hinweis, kein Zaun
 *
 * Twitch empfiehlt ausdruecklich, **reaktiv auf HTTP 401** zu erneuern statt
 * proaktiv nach `expires_in`. Der Wert steht hier fuer die Anzeige und fuer
 * die Fehlersuche, nicht als Bedingung im Code.
 */

module.exports = {
    description: 'Tabelle user_connection_grants fuer erteilte Berechtigungen',

    async up(db) {
        await db.query(`
            CREATE TABLE IF NOT EXISTS user_connection_grants (
                id              INT AUTO_INCREMENT PRIMARY KEY,
                verbindung_id   INT          NOT NULL,
                scopes          TEXT         NOT NULL,
                zugang_ver      TEXT         NOT NULL,
                erneuerung_ver  TEXT         DEFAULT NULL,
                laeuft_ab_am    DATETIME     DEFAULT NULL,
                geprueft_am     DATETIME     DEFAULT NULL,
                fehlertext      VARCHAR(512) DEFAULT NULL,
                angelegt_am     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
                geaendert_am    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uniq_verbindung (verbindung_id),
                CONSTRAINT fk_zusage_verbindung
                    FOREIGN KEY (verbindung_id) REFERENCES user_connections(id)
                    ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
    },

    async down(db) {
        await db.query('DROP TABLE IF EXISTS user_connection_grants');
    }
};
