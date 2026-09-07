'use strict';

/**
 * Verlosung: der Teilnahmeweg und die Herkunft eines Gewinners.
 *
 * # Der Schalter
 *
 * `teilnahme` entscheidet, ob eine Verlosung nur im Discord, nur im Stream
 * oder in beidem mitspielbar ist. **Vorgabe `discord`** - damit verhaelt sich
 * jede bestehende Verlosung unveraendert weiter, ohne dass jemand etwas
 * nachtraegt.
 *
 * Bewusst **kein vierter Zustand "aus"**: Den gibt es schon als
 * `status IN ('paused','ended','cancelled')`. Ein zweiter Aus-Schalter hiesse,
 * bei einer Verlosung ohne Teilnahme an zwei Stellen nachzusehen, welche davon
 * zumacht - und die beiden koennen sich widersprechen.
 *
 * # Die Herkunft
 *
 * `giveaway_winners.user_id` haelt bis heute ausschliesslich Discord-
 * Kennungen. Kaeme eine Twitch-Kennung dazu, ohne dass daneben steht, woher
 * sie stammt, wuerden `<@id>`-Erwaehnungen, Direktnachrichten und die
 * Teilnehmerstatistik stillschweigend auf zwei verschiedenen Namensraeumen
 * rechnen. Nichts davon stuerzt ab; es wird nur leise falsch.
 *
 * Deshalb `quelle`, mit Vorgabe `discord`: Jede vorhandene Zeile ist damit
 * korrekt beschrieben, ohne sie anzufassen.
 */
module.exports = {
    description: 'Teilnahmeweg je Verlosung und Herkunft je Gewinner',

    async up(db) {
        /**
         * @param {string} table Tabelle
         * @param {string} column Spalte
         * @returns {Promise<boolean>} true, wenn vorhanden
         */
        async function spalteDa(table, column) {
            const rows = await db.query(
                `SELECT COUNT(*) AS cnt FROM information_schema.columns
                  WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
                [table, column]
            );
            return Number(rows[0]?.cnt || rows?.cnt || 0) > 0;
        }

        if (!await spalteDa('giveaways', 'teilnahme')) {
            await db.query(`
                ALTER TABLE giveaways
                  ADD COLUMN teilnahme ENUM('discord','stream','beide')
                      NOT NULL DEFAULT 'discord'
                      COMMENT 'Wo mitgemacht werden kann'
                      AFTER status
            `);
        }

        if (!await spalteDa('giveaway_winners', 'quelle')) {
            await db.query(`
                ALTER TABLE giveaway_winners
                  ADD COLUMN quelle VARCHAR(32) NOT NULL DEFAULT 'discord'
                      COMMENT 'Namensraum der Kennung in user_id'
                      AFTER user_id
            `);
        }

        if (!await spalteDa('giveaway_winners', 'anzeigename')) {
            // Der Twitch-Name zum Zeitpunkt des Gewinns. Bei Discord bleibt er
            // leer - dort loest die Erwaehnung den Namen selbst auf. Bei einer
            // fremden Quelle gibt es niemanden, der das spaeter noch koennte:
            // Ist das Plugin abgeschaltet, steht sonst nur eine nackte Zahl da.
            await db.query(`
                ALTER TABLE giveaway_winners
                  ADD COLUMN anzeigename VARCHAR(128) NULL DEFAULT NULL
                      COMMENT 'Name bei fremder Quelle, zum Zeitpunkt des Gewinns'
                      AFTER quelle
            `);
        }
    },

    async down(db) {
        /**
         * @param {string} table Tabelle
         * @param {string} column Spalte
         * @returns {Promise<boolean>} true, wenn vorhanden
         */
        async function spalteDa(table, column) {
            const rows = await db.query(
                `SELECT COUNT(*) AS cnt FROM information_schema.columns
                  WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
                [table, column]
            );
            return Number(rows[0]?.cnt || rows?.cnt || 0) > 0;
        }

        if (await spalteDa('giveaways', 'teilnahme')) {
            await db.query('ALTER TABLE giveaways DROP COLUMN teilnahme');
        }
        if (await spalteDa('giveaway_winners', 'anzeigename')) {
            await db.query('ALTER TABLE giveaway_winners DROP COLUMN anzeigename');
        }
        if (await spalteDa('giveaway_winners', 'quelle')) {
            await db.query('ALTER TABLE giveaway_winners DROP COLUMN quelle');
        }
    }
};
