'use strict';

/**
 * Was prüft fb-init in diesem Lauf? — `bereitschaft_plan` (Stufe 9, 2026-10-25).
 *
 * Ein Paket kann seine Bereitschaft an eine Einstellung hängen
 * (`ready_when.cases`): Windrose prüft im P2P-Modus eine Logzeile (es öffnet
 * keinen Port), mit Direktverbindung den Port. Entschieden wird im Daemon beim
 * Auftragsbau; fb-init schickt den gewählten Plan mit JEDER Meldung zurück.
 * Die Serverseite zeichnet die Leiter aus diesem Plan, statt die Auswahl
 * nachzurechnen.
 *
 * JSON: {case, port, protocol, without_port, log_line, query}. NULL heisst: die
 * Meldung kam von einem älteren Image ohne Plan — dann gilt die Leiter aus dem
 * Paket wie bisher. Geschrieben zusammen mit `bereitschaft_am`, damit dieselbe
 * Prüfung „ist das von diesem Lauf?" auch für den Plan gilt.
 */
module.exports = {
    description: 'gameservers.bereitschaft_plan — welchen Fall fb-init prüft',

    async up(db) {
        await db.query(`
            ALTER TABLE gameservers
                ADD COLUMN IF NOT EXISTS bereitschaft_plan LONGTEXT DEFAULT NULL
                    COMMENT 'JSON von fb-init: {case, port, protocol, without_port, log_line, query}; NULL = altes Image'
                    AFTER bereitschaft_bereit
        `);
    },

    async down(db) {
        await db.query(`ALTER TABLE gameservers DROP COLUMN IF EXISTS bereitschaft_plan`);
    }
};
