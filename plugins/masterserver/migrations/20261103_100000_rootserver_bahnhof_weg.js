'use strict';

/**
 * Ein vierter Grund, warum eine Leitung fehlt: der Busbahnhof (FireBus Etappe 4).
 *
 * Seit 9340 abgeschaltet ist, enden alle Leitungen im Bahnhof. Fehlt er, fehlen alle
 * Daemons zugleich, obwohl sie laufen. Ohne eigenen Zustand klopfte die Wache nach der
 * Frist an jede Maschine, fand sie erreichbar und meldete „Daemon nicht erreichbar".
 */
const ALT = "'da', 'neu_verbinden', 'angekuendigt', 'daemon_weg', 'maschine_weg'";
const KOMMENTAR = "COMMENT 'Zustand der Leitung, schreibt die VerbindungsWache'";

module.exports = {
    description: 'masterserver-rootserver-bahnhof-weg',

    async up(db) {
        // Name als Text: dbService.query ist execute, kein Platzhalter hinter SHOW … LIKE.
        const [spalte] = await db.query("SHOW COLUMNS FROM rootserver LIKE 'verbindung'");
        if (!spalte || String(spalte.Type).includes("'bahnhof_weg'")) return;
        await db.query(`ALTER TABLE rootserver
            MODIFY COLUMN verbindung ENUM(${ALT}, 'bahnhof_weg') NOT NULL DEFAULT 'da' ${KOMMENTAR}`);
    },

    async down(db) {
        await db.query("UPDATE rootserver SET verbindung = 'neu_verbinden' WHERE verbindung = 'bahnhof_weg'");
        await db.query(`ALTER TABLE rootserver
            MODIFY COLUMN verbindung ENUM(${ALT}) NOT NULL DEFAULT 'da' ${KOMMENTAR}`);
    }
};
