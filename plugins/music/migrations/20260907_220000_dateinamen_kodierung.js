'use strict';

/**
 * Falsch kodierte Dateinamen richtigstellen.
 *
 * Gefunden am 2026-09-07: In `music_files` stand `LÃVI - virtual love 2001`,
 * hochgeladen wurde `LÄVI - ...`. Ursache ist multer/busboy, das den Namen aus
 * dem mehrteiligen Formular als latin1 liest, waehrend Browser ihn als UTF-8
 * schicken. Der Fix steht in `apps/dashboard/helpers/Dateiname.js` und wirkt
 * nur nach vorn - diese Migration holt nach, was schon liegt.
 *
 * ## Warum das eine Migration ist und kein Skript
 *
 * Es ist eine **Datenaenderung**, und die soll nachvollziehbar einmal laufen,
 * nicht bei jedem Start oder auf Zuruf. Umkehren laesst sie sich nicht: Nach
 * der Korrektur ist nicht mehr erkennbar, welcher Name vorher falsch war und
 * welcher schon richtig - `down()` sagt das, statt es zu versuchen.
 *
 * ## Dieselbe Vorsicht wie im Helfer
 *
 * Geaendert wird nur, wo die Umwandlung ein Ergebnis ohne Ersetzungszeichen
 * liefert. Ein Name, der schon richtig ist, bleibt unangetastet - sonst
 * machte diese Migration kaputt, was sie reparieren soll.
 */

const { richtigstellen } = require('../../../apps/dashboard/helpers/Dateiname');

module.exports = {
    name: '20260907_220000_dateinamen_kodierung',
    description: 'music_files.originalname: latin1-Fehlkodierung richtigstellen',

    async up(db) {
        // **Nicht destrukturieren.** `db.query()` liefert die Zeilen direkt.
        const zeilen = await db.query('SELECT id, originalname FROM music_files');
        if (!zeilen?.length) return;

        let geaendert = 0;
        for (const zeile of zeilen) {
            const richtig = richtigstellen(zeile.originalname);
            if (richtig === zeile.originalname) continue;

            await db.query('UPDATE music_files SET originalname = ? WHERE id = ?',
                [richtig, zeile.id]);
            geaendert++;
        }

        if (geaendert) {
            console.log(`[Musik] ${geaendert} Dateiname(n) richtiggestellt (latin1 -> UTF-8)`);
        }
    },

    async down() {
        // Bewusst leer. Nach der Korrektur ist nicht mehr unterscheidbar,
        // welcher Name vorher falsch war - eine Rueckabwicklung wuerde raten.
    }
};
