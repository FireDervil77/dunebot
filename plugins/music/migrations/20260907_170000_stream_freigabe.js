'use strict';

/**
 * Musik: Herkunft und Stream-Freigabe je Tondatei.
 *
 * # Wofuer
 *
 * Vorbereitung fuer den Musikwunsch aus dem Twitch-Chat
 * (`docs/musikwunsch/README.md`). Dort spielt der Stream-Weg **ausschliesslich**
 * aus dieser Ablage - damit verschwindet die Lizenzfrage aus der Software: Der
 * Betreiber laedt hoch, was er spielen darf, und nichts anderes ist erreichbar.
 *
 * # `herkunft` ist kein Lizenznachweis
 *
 * Der Betreiber am 2026-09-07: „die royality frage kannste dir sparen zu
 * klaeren da ich meine streammusik nur von seiten hole die auch lizenzfreie
 * und damit gema freie musik ohne jegliche lizensbindungen anbieten."
 *
 * Damit ist die rechtliche Frage entschieden und nicht unsere. Das Feld haelt
 * deshalb nur fest, **von welcher Seite** ein Titel kam - damit in einem Jahr
 * noch nachlesbar ist, wo nachzulegen waere. Reintext, keine Pruefung, keine
 * Pflicht.
 *
 * # `fuer_stream` ist eine eigene Entscheidung
 *
 * Nicht jede hochgeladene Datei gehoert in den Stream: Jingles,
 * Soundeffekte, ein Intro. Vorgabe **0** - eine schon vorhandene Datei wird
 * durch diese Migration nicht stillschweigend freigegeben. Freigeben ist eine
 * Handlung, kein Nebeneffekt.
 */
module.exports = {
    description: 'Herkunft und Stream-Freigabe an music_files',

    async up(db) {
        /**
         * @param {string} spalte Spaltenname
         * @returns {Promise<boolean>} true, wenn vorhanden
         */
        async function da(spalte) {
            const rows = await db.query(
                `SELECT COUNT(*) AS cnt FROM information_schema.columns
                  WHERE table_schema = DATABASE() AND table_name = 'music_files'
                    AND column_name = ?`, [spalte]);
            return Number(rows[0]?.cnt || rows?.cnt || 0) > 0;
        }

        if (!await da('herkunft')) {
            await db.query(`
                ALTER TABLE music_files
                  ADD COLUMN herkunft VARCHAR(255) DEFAULT NULL
                      COMMENT 'Woher der Titel stammt - Reintext, kein Nachweis'
                      AFTER originalname
            `);
        }

        if (!await da('fuer_stream')) {
            await db.query(`
                ALTER TABLE music_files
                  ADD COLUMN fuer_stream TINYINT(1) NOT NULL DEFAULT 0
                      COMMENT 'Darf im Stream gewuenscht und gespielt werden'
                      AFTER herkunft
            `);
            // Der Wunschbefehl sucht spaeter genau hierueber.
            await db.query(`
                ALTER TABLE music_files
                  ADD INDEX idx_stream (guild_id, fuer_stream)
            `);
        }
    },

    async down(db) {
        /**
         * @param {string} spalte Spaltenname
         * @returns {Promise<boolean>} true, wenn vorhanden
         */
        async function da(spalte) {
            const rows = await db.query(
                `SELECT COUNT(*) AS cnt FROM information_schema.columns
                  WHERE table_schema = DATABASE() AND table_name = 'music_files'
                    AND column_name = ?`, [spalte]);
            return Number(rows[0]?.cnt || rows?.cnt || 0) > 0;
        }

        if (await da('fuer_stream')) {
            await db.query('ALTER TABLE music_files DROP INDEX idx_stream');
            await db.query('ALTER TABLE music_files DROP COLUMN fuer_stream');
        }
        if (await da('herkunft')) {
            await db.query('ALTER TABLE music_files DROP COLUMN herkunft');
        }
    }
};
