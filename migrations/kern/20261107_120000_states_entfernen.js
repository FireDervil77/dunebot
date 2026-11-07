'use strict';

/**
 * `states` entfernen: OAuth-Rücksprünge liegen in der Sitzung (Kassensturz K034, 2026-11-07).
 *
 * Gemessen vor dem Umbau (2026-11-07): 739 Zeilen, die älteste vom
 * 2026-08-06, keine je verbraucht. Geschrieben hat sie `CheckAuth` bei jedem
 * Aufruf ohne Anmeldung, gelesen hat sie niemand — der Login wertete `?state=`
 * nie aus. Die Kontoverknüpfungen nutzten die Tabelle als Einzige wirklich,
 * mit einem Wert, der an keinen Nutzer gebunden war.
 *
 * Seitdem gehört der `state` der Sitzung (`apps/dashboard/helpers/Ruecksprung.js`),
 * für Anmeldung, Einladung und Verknüpfungen. Das Model `State`, das die
 * Tabelle bei jedem Start neu anlegte, ist mit demselben Commit weg.
 *
 * Kein `down`: Die Zeilen waren Minuten gültig, nichts davon ist wiederzuholen.
 */
module.exports = {
    async up(db) {
        await db.query('DROP TABLE IF EXISTS states');
    }
};
