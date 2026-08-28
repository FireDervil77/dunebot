'use strict';

/**
 * Zusagen, die **der Anlage** gehoeren und keinem Benutzer (Stufe 13a).
 *
 * ## Warum das nicht in `user_connections` passt
 *
 * Der Chatbot braucht ein eigenes Twitch-Konto, das unserer Anwendung einmal
 * zustimmt (`user:bot`, `user:read:chat`, `user:write:chat`). Twitch dazu:
 * *"only needed to be performed once and kept alive through refreshing the
 * access token."*
 *
 * Der naheliegende Platz waere `user_connections` — und er geht nicht. Am
 * Schema nachgesehen, nicht vermutet:
 *
 *     UNIQUE KEY uniq_benutzer_plattform (user_id, plattform)
 *     UNIQUE KEY uniq_plattform_konto    (plattform, konto_id)
 *
 * Der Betreiber hat dort bereits sein eigenes Twitch-Konto. Ein zweites unter
 * demselben Benutzer lehnt der Schluessel ab.
 *
 * **Und selbst wenn es ginge, waere es falsch.** `user_connection_grants`
 * haengt per `ON DELETE CASCADE` an der Verknuepfung einer Person. Loest diese
 * Person ihre Verknuepfung — ein voellig normaler Vorgang, den ihr niemand
 * verwehren darf —, waere der Chatbot fuer **alle** Kanaele tot. Eine
 * Betriebsgrundlage darf nicht am Profil eines Menschen haengen.
 *
 * ## Warum eine Tabelle und nicht zwei
 *
 * Bei `user_connections` + `user_connection_grants` trennt die erste Tabelle
 * den **Nachweis** ("mir gehoert dieses Konto") von der **Zusage**
 * ("du darfst damit dies und das"). Die Trennung hat einen Grund: Der Nachweis
 * bleibt wahr, auch wenn jede Berechtigung widerrufen ist.
 *
 * Hier gibt es nichts zu trennen. Es gibt keinen Dritten, dem etwas gehoert —
 * die Anlage autorisiert sich selbst. Zwei Tabellen waeren hier Symmetrie um
 * ihrer selbst willen.
 *
 * ## `zweck` statt "das eine Bot-Konto"
 *
 * Heute gibt es genau einen Zweck: `chatbot`. Die Spalte steht trotzdem da,
 * weil absehbar ein zweiter kommt (etwa ein Konto nur zum Lesen, das nie
 * schreibt und deshalb kein Sendekontingent verbraucht). Ohne sie hiesse die
 * Erweiterung "zweite Tabelle".
 *
 * ## Was hier NICHT steht
 *
 * Client-ID und Client-Secret. Die liegen weiter in `configs` bzw. `.env`
 * (`shared/models.js`, `zugangsdaten()`) — sie sind die Entwicklerdaten des
 * Betreibers (F-2) und aendern sich nie durch eine Zustimmung.
 */

module.exports = {
    description: 'Betreiber-Zusagen: Token der Anlage selbst (Chatbot-Konto)',

    async up(db) {
        await db.query(`
            CREATE TABLE IF NOT EXISTS betreiber_zusagen (
                id             INT AUTO_INCREMENT PRIMARY KEY,

                plattform      VARCHAR(32)  NOT NULL,
                -- Wofuer dieses Konto da ist. Heute nur 'chatbot'.
                zweck          VARCHAR(32)  NOT NULL DEFAULT 'chatbot',

                -- Wer es ist. Steht spaeter in jedem Chat, also gehoert der
                -- Name sichtbar in die Oberflaeche und nicht nur die Kennung.
                konto_id       VARCHAR(64)  DEFAULT NULL,
                konto_name     VARCHAR(128) DEFAULT NULL,

                -- Klartext, wie bei den Benutzer-Zusagen: "das hast du erlaubt"
                -- muss man zeigen koennen.
                scopes         VARCHAR(512) DEFAULT NULL,

                -- Verschluesselt (Cryptr/TOKEN_ENCRYPTION_KEY). Das Suffix _ver
                -- ist im Haus die Ansage: hier steht nichts im Klartext.
                zugang_ver     TEXT         DEFAULT NULL,
                erneuerung_ver TEXT         DEFAULT NULL,

                laeuft_ab_am   DATETIME     DEFAULT NULL,
                geprueft_am    DATETIME     DEFAULT NULL,
                -- Ein Fehler wird VERMERKT, nicht durch Loeschen beantwortet:
                -- ein abgelaufener Schluessel ist kein Widerruf.
                fehlertext     VARCHAR(512) DEFAULT NULL,

                angelegt_am    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
                geaendert_am   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                                            ON UPDATE CURRENT_TIMESTAMP,

                -- Je Plattform und Zweck genau eine. Ohne diesen Schluessel
                -- entstuenden bei jedem erneuten Zustimmen neue Zeilen, und
                -- niemand wuesste, welche gilt.
                UNIQUE KEY uniq_plattform_zweck (plattform, zweck)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
    },

    async down(db) {
        // Hier darf geloescht werden: Die Tabelle enthaelt ausschliesslich
        // Token, die sich jederzeit neu beschaffen lassen — kein Nachweis, kein
        // Benutzerdatum, nichts Unwiederbringliches.
        await db.query('DROP TABLE IF EXISTS betreiber_zusagen');
    }
};
