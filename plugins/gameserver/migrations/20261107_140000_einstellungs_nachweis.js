'use strict';

/**
 * Einstellungs-Nachweis je Server (Baustelle 171, F7, 2026-11-07).
 *
 * Der Daemon (ab dem Commit „Einstellungs-Nachweis reist mit `started`")
 * hängt an die Bereitschaftsmeldung `started` je Einstellung und Ziel, ob ihr
 * Wert beim Start ankam — dieselben Zustände wie der B1-Nachweis der Werkbank
 * (angekommen, nicht_gefunden, fehlgeschlagen, keine_meldung,
 * nicht_verdrahtet, nicht_pruefbar). Werte stehen nicht darin.
 *
 * Gespeichert wird der letzte, mit dem Zeitpunkt — die Serverseite sagt dazu,
 * von welchem Start er stammt. NULL heißt: noch kein Start mit einem Daemon,
 * der den Nachweis schickt.
 */
module.exports = {
    description: 'gameservers.einstellungs_nachweis(_am) — kam jede Einstellung beim letzten Start an (B171)',

    async up(db) {
        const [n] = await db.query("SHOW COLUMNS FROM gameservers LIKE 'einstellungs_nachweis'");
        if (!n) {
            await db.query(`
                ALTER TABLE gameservers
                  ADD COLUMN einstellungs_nachweis LONGTEXT DEFAULT NULL
                  COMMENT 'JSON-Liste {key, ziel, wo, zustand, hinweis} vom Daemon bei started; NULL = noch keiner'
                  AFTER bereitschaft_plan
            `);
        }
        const [am] = await db.query("SHOW COLUMNS FROM gameservers LIKE 'einstellungs_nachweis_am'");
        if (!am) {
            await db.query(`
                ALTER TABLE gameservers
                  ADD COLUMN einstellungs_nachweis_am DATETIME DEFAULT NULL
                  AFTER einstellungs_nachweis
            `);
        }
    },

    async down(db) {
        const [am] = await db.query("SHOW COLUMNS FROM gameservers LIKE 'einstellungs_nachweis_am'");
        if (am) await db.query('ALTER TABLE gameservers DROP COLUMN einstellungs_nachweis_am');
        const [n] = await db.query("SHOW COLUMNS FROM gameservers LIKE 'einstellungs_nachweis'");
        if (n) await db.query('ALTER TABLE gameservers DROP COLUMN einstellungs_nachweis');
    }
};
