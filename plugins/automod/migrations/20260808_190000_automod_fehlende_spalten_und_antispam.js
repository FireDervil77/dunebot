'use strict';

/**
 * Zwei Dinge auf einmal, weil sie dieselbe Tabelle betreffen.
 *
 * ── 1. Zehn Spalten, die es nur in der Datenbank gab ────────────────────────
 *
 * `bot/events/guildMemberAdd.js` liest den kompletten Raid-Schutz aus
 * `automod_settings`, und `messageCreate.js` liest `active_keyword_lists`.
 * In der laufenden Datenbank sind alle diese Spalten vorhanden - **in keiner
 * Migration** aber standen sie je. Die Baseline kennt sie nicht, und die
 * einzige spaetere Migration fuegt nur `dm_message` hinzu.
 *
 * Auf einer frischen Installation heisst das: `raid_protection_enabled` ist
 * `undefined`, der Handler kehrt in Zeile 40 sofort zurueck, Stichwortlisten
 * bleiben leer, und `updateSettings({ raid_lockdown_active })` wirft. Der
 * Raid-Schutz waere dort vollstaendig tot, ohne dass es auffaellt.
 *
 * Die Angaben unten entsprechen genau dem, was `SHOW COLUMNS` auf dem
 * laufenden System meldet - damit ergibt eine Neuinstallation dieselbe Tabelle
 * wie der Bestand.
 *
 * ── 2. Drei neue Spalten fuer den neuen Anti-Spam ───────────────────────────
 *
 * Der alte Anti-Spam hatte seine Schwelle fest im Code (3000 ms) und mass
 * ohnehin das Falsche. Der neue misst eine **Rate**, und die gehoert
 * einstellbar:
 *
 *   anti_spam_messages   - wie viele Nachrichten
 *   anti_spam_seconds    - in wie vielen Sekunden
 *   anti_spam_duplicates - ab wie vielen gleichen Nachrichten hintereinander
 *
 * Die Vorgaben (5 in 5 s, 3 Wiederholungen) sind bewusst nachsichtig: Sie
 * sollen ein Gespraech nicht bestrafen, sondern Fluten abfangen.
 */
module.exports = {
    description: 'automod_settings: Raid-/Stichwort-Spalten nachtragen und Anti-Spam-Schwellen ergaenzen',

    async up(db) {
        const spalten = [
            // --- Raid-Schutz (bestand nur in der Datenbank) ---
            "raid_protection_enabled BOOLEAN DEFAULT FALSE",
            "raid_join_threshold TINYINT UNSIGNED DEFAULT 5",
            "raid_join_timespan SMALLINT UNSIGNED DEFAULT 10",
            "raid_min_account_age_days TINYINT UNSIGNED DEFAULT 7",
            "raid_action ENUM('KICK', 'BAN') DEFAULT 'KICK'",
            "raid_lockdown_enabled BOOLEAN DEFAULT FALSE",
            "raid_lockdown_active BOOLEAN DEFAULT FALSE",
            "raid_alert_channel VARCHAR(20) DEFAULT NULL",
            "raid_alert_mention_mods BOOLEAN DEFAULT TRUE",
            "raid_trusted_invites JSON DEFAULT NULL",

            // --- Stichwortlisten (bestand nur in der Datenbank) ---
            "active_keyword_lists JSON DEFAULT NULL",

            // --- Neu: Anti-Spam als Rate ---
            "anti_spam_messages TINYINT UNSIGNED DEFAULT 5",
            "anti_spam_seconds SMALLINT UNSIGNED DEFAULT 5",
            "anti_spam_duplicates TINYINT UNSIGNED DEFAULT 3"
        ];

        // Einzeln, damit eine bereits vorhandene Spalte die anderen nicht
        // aufhaelt. `IF NOT EXISTS` kann MariaDB bei ADD COLUMN.
        for (const spalte of spalten) {
            await db.query(`ALTER TABLE automod_settings ADD COLUMN IF NOT EXISTS ${spalte}`);
        }
    },

    /**
     * Nur die drei neuen Anti-Spam-Spalten werden zurueckgebaut.
     *
     * Die Raid- und Stichwort-Spalten fallen ausdruecklich **nicht** weg: Auf
     * bestehenden Installationen sind sie aelter als diese Migration und
     * enthalten Einstellungen. Sie hier zu loeschen wuerde Daten vernichten,
     * die diese Migration nie angelegt hat.
     */
    async down(db) {
        for (const spalte of ['anti_spam_messages', 'anti_spam_seconds', 'anti_spam_duplicates']) {
            await db.query(`ALTER TABLE automod_settings DROP COLUMN IF EXISTS ${spalte}`);
        }
    }
};
