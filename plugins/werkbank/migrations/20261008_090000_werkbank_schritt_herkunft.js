'use strict';

/**
 * Schritte aus einem geöffneten Paket tragen ihre Herkunft (2026-10-08).
 *
 * Seit gestern öffnet die Werkbank fertige Pakete; deren Schritte standen als
 * `uebernommen` in der Liste, liefen im Volume der Sitzung aber nie — und es
 * gab keinen Weg, sie laufen zu lassen. Eine geöffnete Sitzung hatte damit
 * kein Volume: kein Probestart, keine Beobachtung der Ports, keine Dateien
 * (Betreiber am 2026-10-08, Astro Colony: „die Sitzung hat noch kein Volume").
 *
 * Jetzt laufen sie beim Öffnen. Dafür muss ein Schritt auch dann noch wissen,
 * woher er kommt, wenn sein Zustand gerade `laeuft` ist:
 *
 *   - scheitert er, fällt er auf `uebernommen` zurück statt auf `fehler` —
 *     sonst fiele ein bewährter Schritt wegen eines Netzwerkfehlers aus dem
 *     Entwurf und fehlte still im nächsten veröffentlichten Paket;
 *   - gelingt er, startet der nächste übernommene.
 *
 * Im Speicher des Dashboards gehalten überlebte das keinen Neustart mitten in
 * einem langen SteamCMD-Lauf. Deshalb eine Spalte.
 *
 * Vorhandene Zeilen im Zustand `uebernommen` bekommen die Herkunft aus ihrer
 * Sitzung nachgetragen (dort steht, welches Paket geöffnet wurde).
 */
module.exports = {
    description: 'werkbank_schritte.uebernommen_aus — aus welchem Paket ein Schritt stammt',

    async up(db) {
        const spalten = await db.query("SHOW COLUMNS FROM werkbank_schritte LIKE 'uebernommen_aus'");
        if (!spalten.length) {
            await db.query(`
                ALTER TABLE werkbank_schritte
                    ADD COLUMN uebernommen_aus VARCHAR(120) NULL DEFAULT NULL
                    COMMENT 'Aus einem geöffneten Paket: "<slug> <fassung>". NULL = in dieser Sitzung angelegt'
                    AFTER status
            `);
        }
        await db.query(`
            UPDATE werkbank_schritte x
              JOIN werkbank_sitzungen s ON s.id = x.sitzung_id
               SET x.uebernommen_aus = LEFT(CONCAT(
                       JSON_UNQUOTE(JSON_EXTRACT(s.entwurf, '$.werkbank.geoeffnet.slug')), ' ',
                       JSON_UNQUOTE(JSON_EXTRACT(s.entwurf, '$.werkbank.geoeffnet.version'))), 120)
             WHERE x.status = 'uebernommen'
               AND x.uebernommen_aus IS NULL
               AND JSON_EXTRACT(s.entwurf, '$.werkbank.geoeffnet.slug') IS NOT NULL
        `);
    },

    async down(db) {
        await db.query('ALTER TABLE werkbank_schritte DROP COLUMN uebernommen_aus');
    }
};
