'use strict';

/**
 * Nachrichtenvorlagen: mehrere Vorlagen eines Anlasses je Guild (K389,
 * 2026-11-14).
 *
 * Bis hier hatte `guild_vorlagen` eine Zeile je Guild und Anlass. Ticket hat
 * aber je Kategorie eine eigene Eröffnungsnachricht. Dafür bekommt die Tabelle
 * die Spalte `stelle` im Schlüssel: bei `ticket:eroeffnung` die ID der
 * Kategorie, leer für Tickets ohne Kategorie. Anlässe ohne Stellen (alle von
 * greeting) behalten die leere Stelle, ihre Zeilen bleiben, wie sie sind.
 *
 * Welcher Anlass Stellen hat, erklärt das Plugin in seiner package.json
 * (`vorlagen.anlaesse.<name>.je`). `Vorlage.js` lehnt eine Stelle an einem
 * Anlass ohne `je` ab.
 *
 * Spalten über `SHOW COLUMNS`, damit die Migration auch ein zweites Mal
 * durchläuft.
 */
module.exports = {
    description: 'guild_vorlagen: Spalte stelle im Schlüssel (K389)',

    async up(db) {
        const rows = await db.query('SHOW COLUMNS FROM guild_vorlagen');
        const da = new Set((rows || []).map((r) => r.Field));
        if (da.has('stelle')) return;
        await db.query(`
            ALTER TABLE guild_vorlagen
                ADD COLUMN stelle VARCHAR(40) NOT NULL DEFAULT '' AFTER anlass,
                DROP PRIMARY KEY,
                ADD PRIMARY KEY (guild_id, anlass, stelle)
        `);
    },

    async down(db) {
        const mit = await db.query("SELECT COUNT(*) AS n FROM guild_vorlagen WHERE stelle <> ''");
        if (Number(mit?.[0]?.n) > 0) {
            throw new Error('guild_vorlagen: Vorlagen mit Stelle vorhanden, zurück ginge eine verloren');
        }
        await db.query(`
            ALTER TABLE guild_vorlagen
                DROP PRIMARY KEY,
                ADD PRIMARY KEY (guild_id, anlass),
                DROP COLUMN stelle
        `);
    }
};
