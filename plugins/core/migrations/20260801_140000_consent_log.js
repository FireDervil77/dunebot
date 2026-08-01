'use strict';

/**
 * Legt `consent_log` an – den Nachweis über erteilte Cookie-Einwilligungen.
 *
 * Die DSGVO verlangt, dass der Verantwortliche eine Einwilligung **nachweisen**
 * kann (Art. 7 Abs. 1). Ein Cookie im Browser des Besuchers taugt dafür nicht:
 * Es liegt bei ihm, nicht bei uns, und er kann es jederzeit löschen. Deshalb
 * dieser Nachweis auf unserer Seite – so hat der Betreiber sich entschieden.
 *
 * **Kein Klartext, der selbst ein Datenschutzproblem wäre.** Ein Nachweis, für
 * den man IP-Adressen sammelt, tauscht ein Risiko gegen ein größeres. Gespeichert
 * wird deshalb nur ein gesalzener Hash: Er genügt, um zwei Einträge derselben
 * Herkunft zuzuordnen, und lässt sich ohne das Salz nicht zurückrechnen.
 *
 * `version` ist der Grund, warum es überhaupt eine Fassungsnummer gibt: Ändert
 * sich der Einwilligungstext wesentlich, wird sie erhöht, alte Einwilligungen
 * verlieren ihre Gültigkeit und die Abfrage erscheint erneut. Ohne diese Spalte
 * gäbe es keinen Weg, eine veraltete Einwilligung ungültig zu machen.
 */
module.exports = {
    description: 'Nachweistabelle fuer Cookie-Einwilligungen',

    async up(db) {
        await db.query(`
            CREATE TABLE IF NOT EXISTS consent_log (
                id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                erteilt_am    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
                kategorien    VARCHAR(255)    NOT NULL
                              COMMENT 'zugestimmte Kategorien, kommagetrennt',
                version       INT UNSIGNED    NOT NULL DEFAULT 1
                              COMMENT 'Fassung des Einwilligungstextes',
                herkunft      ENUM('banner','einstellungen','widerruf') NOT NULL DEFAULT 'banner',
                besucher_hash CHAR(64)        NULL
                              COMMENT 'gesalzener SHA-256 - nie IP im Klartext',
                user_agent    VARCHAR(255)    NULL,
                PRIMARY KEY (id),
                KEY idx_erteilt_am (erteilt_am),
                KEY idx_version (version),
                KEY idx_besucher (besucher_hash)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
              COMMENT='Nachweis erteilter Cookie-Einwilligungen (DSGVO Art. 7 Abs. 1)'
        `);
    },

    async down(db) {
        await db.query('DROP TABLE IF EXISTS consent_log');
    },
};
