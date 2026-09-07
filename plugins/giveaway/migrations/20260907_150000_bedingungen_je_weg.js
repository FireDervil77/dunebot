'use strict';

/**
 * Verlosung: Bedingungen je Weg.
 *
 * # Der Anlass
 *
 * Der Betreiber am 2026-09-07: „die anforderungen tragen aktuell nur den
 * discord weg. schoen waere es wenn wir fuer twitch und discord die
 * bedingungen je nach anwendung anbieten koennten."
 *
 * Er hat recht, und das Bisherige war schlechter als gedacht: Am Vormittag
 * bekam der Stream-Weg **eine einzelne Spalte** (`stream_nur_abonnenten`)
 * neben einem allgemeinen Bedingungssystem. Zwei Mechanismen fuer dieselbe
 * Sache sind genau die doppelte Wahrheit, gegen die dieses Haus schreibt -
 * die zweite Twitch-Bedingung haette eine zweite Spalte gebraucht.
 *
 * # Drei Aenderungen
 *
 * **`weg`** trennt die Regelwerke. Vorgabe `discord`: Jede vorhandene Zeile
 * ist damit richtig beschrieben, ohne sie anzufassen. `checkRequirements`
 * liest ab jetzt nur noch `discord` - eine Twitch-Regel dort wuerde jeden
 * Discord-Teilnehmer ablehnen, weil ihr Typ in keinem `case` steht.
 *
 * **`type` wird VARCHAR statt ENUM.** Welche Bedingungen der Stream-Weg
 * kennt, weiss die Losquelle und nicht das Verlosungs-Plugin. Ein ENUM hier
 * hiesse, dass jede neue Twitch-Bedingung eine Migration im *fremden* Plugin
 * braucht - und dass `giveaway` den Namen `twitch_abonnent` kennen muss.
 * Genau die Abhaengigkeitsrichtung, die wir vermeiden.
 *
 * **`stream_nur_abonnenten` wird eingeschmolzen.** Vorhandene Einstellungen
 * werden zu einer Zeile `twitch_abonnent`, dann faellt die Spalte weg. Sie
 * ist seit heute Vormittag im Bestand und war noch nirgends benutzt; sie
 * stehen zu lassen hiesse, zwei Orte fuer dieselbe Frage zu pflegen.
 */
module.exports = {
    description: 'Bedingungen je Teilnahmeweg statt einer Sonderspalte',

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
                [table, column]);
            return Number(rows[0]?.cnt || rows?.cnt || 0) > 0;
        }

        if (!await spalteDa('giveaway_requirements', 'weg')) {
            await db.query(`
                ALTER TABLE giveaway_requirements
                  ADD COLUMN weg ENUM('discord','stream') NOT NULL DEFAULT 'discord'
                      COMMENT 'Fuer welchen Teilnahmeweg die Bedingung gilt'
                      AFTER giveaway_id
            `);
        }

        // ENUM -> VARCHAR. Die vorhandenen Werte bleiben, sie sind gueltige
        // Zeichenketten.
        await db.query(`
            ALTER TABLE giveaway_requirements
              MODIFY COLUMN type VARCHAR(64) NOT NULL
                  COMMENT 'Art der Bedingung; beim Stream-Weg von der Losquelle bestimmt'
        `);

        // Die Sonderspalte einschmelzen - erst umtragen, dann loeschen.
        if (await spalteDa('giveaways', 'stream_nur_abonnenten')) {
            await db.query(`
                INSERT INTO giveaway_requirements (giveaway_id, weg, type, value)
                SELECT id, 'stream', 'twitch_abonnent', '1'
                  FROM giveaways
                 WHERE stream_nur_abonnenten = 1
            `);
            await db.query('ALTER TABLE giveaways DROP COLUMN stream_nur_abonnenten');
        }
    },

    async down(db) {
        const rows = await db.query(
            `SELECT COUNT(*) AS cnt FROM information_schema.columns
              WHERE table_schema = DATABASE() AND table_name = 'giveaways'
                AND column_name = 'stream_nur_abonnenten'`);

        if (Number(rows[0]?.cnt || rows?.cnt || 0) === 0) {
            await db.query(`
                ALTER TABLE giveaways
                  ADD COLUMN stream_nur_abonnenten TINYINT(1) NOT NULL DEFAULT 0 AFTER teilnahme
            `);
            await db.query(`
                UPDATE giveaways g
                   SET stream_nur_abonnenten = 1
                 WHERE EXISTS (SELECT 1 FROM giveaway_requirements r
                                WHERE r.giveaway_id = g.id AND r.type = 'twitch_abonnent')
            `);
        }

        await db.query("DELETE FROM giveaway_requirements WHERE weg = 'stream'");
        await db.query('ALTER TABLE giveaway_requirements DROP COLUMN weg');
        await db.query(`
            ALTER TABLE giveaway_requirements
              MODIFY COLUMN type ENUM('role','min_account_age','min_server_age') NOT NULL
        `);
    }
};
