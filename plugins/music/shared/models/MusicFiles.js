'use strict';

const { ServiceManager } = require('dunebot-core');

/**
 * Hochgeladene Tondateien einer Guild.
 *
 * Die Datei selbst liegt auf der Platte (siehe `shared/dateien.js`), hier steht
 * nur, was zu ihr bekannt ist. Beides muss zusammen bleiben - deshalb loescht
 * `entfernen` immer beides und meldet Erfolg auch dann, wenn eines der beiden
 * schon fehlte: ein Eintrag ohne Datei ist genauso wertlos wie umgekehrt.
 *
 * @module music/shared/models/MusicFiles
 */
class MusicFiles {
    /**
     * Alle Dateien einer Guild, neueste zuerst.
     *
     * @param {string} guildId Discord-Guild-ID
     * @returns {Promise<Array>} Datensaetze
     */
    static async getAll(guildId) {
        const dbService = ServiceManager.get('dbService');
        return await dbService.query(
            `SELECT * FROM music_files WHERE guild_id = ? ORDER BY hochgeladen_am DESC`,
            [guildId]
        );
    }

    /**
     * Eine Datei - immer mit guildId, damit keine fremde herauskommt.
     *
     * @param {number} id Datensatz-ID
     * @param {string} guildId Discord-Guild-ID
     * @returns {Promise<Object|null>} Datensatz
     */
    static async get(id, guildId) {
        const dbService = ServiceManager.get('dbService');
        const [zeile] = await dbService.query(
            `SELECT * FROM music_files WHERE id = ? AND guild_id = ?`,
            [id, guildId]
        );
        return zeile || null;
    }

    /**
     * Eine Datei ohne Guild-Angabe holen.
     *
     * Nur fuer den Bot: Der bekommt aus `datei:<id>` keine Guild mitgeliefert
     * und prueft die Zugehoerigkeit selbst gegen die Guild des Abspielers.
     *
     * @param {number} id Datensatz-ID
     * @returns {Promise<Object|null>} Datensatz
     */
    static async getById(id) {
        const dbService = ServiceManager.get('dbService');
        const [zeile] = await dbService.query(`SELECT * FROM music_files WHERE id = ?`, [id]);
        return zeile || null;
    }

    /**
     * Belegten Platz und Anzahl einer Guild.
     *
     * @param {string} guildId Discord-Guild-ID
     * @returns {Promise<{anzahl: number, bytes: number}>} Belegung
     */
    static async belegung(guildId) {
        const dbService = ServiceManager.get('dbService');
        const [zeile] = await dbService.query(
            `SELECT COUNT(*) AS anzahl, COALESCE(SUM(groesse_bytes), 0) AS bytes
               FROM music_files WHERE guild_id = ?`,
            [guildId]
        );
        return { anzahl: Number(zeile?.anzahl) || 0, bytes: Number(zeile?.bytes) || 0 };
    }

    /**
     * Eine Datei eintragen.
     *
     * @param {string} guildId Discord-Guild-ID
     * @param {Object} daten Angaben zur Datei
     * @returns {Promise<number>} Neue ID
     */
    static async anlegen(guildId, daten) {
        const dbService = ServiceManager.get('dbService');
        const ergebnis = await dbService.query(
            `INSERT INTO music_files (guild_id, dateiname, originalname, groesse_bytes, hochgeladen_von)
             VALUES (?, ?, ?, ?, ?)`,
            [guildId, daten.dateiname, daten.originalname, daten.groesseBytes || 0, daten.hochgeladenVon || null]
        );
        return ergebnis.insertId;
    }

    /**
     * Merken, dass die Datei gerade gespielt wurde.
     *
     * Traegt die Aufbewahrung: Was laeuft, wird nicht weggeraeumt. Ein
     * Fehlschlag darf die Wiedergabe nicht stoeren - deshalb still.
     *
     * @param {number} id Datensatz-ID
     * @returns {Promise<void>}
     */
    static async gespielt(id) {
        try {
            const dbService = ServiceManager.get('dbService');
            await dbService.query(
                `UPDATE music_files SET zuletzt_gespielt = NOW() WHERE id = ?`,
                [id]
            );
        } catch {
            /* Ohne diesen Vermerk laeuft der Ton trotzdem */
        }
    }

    /**
     * Eintrag entfernen (die Datei loescht der Aufrufer).
     *
     * @param {number} id Datensatz-ID
     * @param {string} guildId Discord-Guild-ID
     * @returns {Promise<boolean>} Ob eine Zeile betroffen war
     */
    static async entfernen(id, guildId) {
        const dbService = ServiceManager.get('dbService');
        const ergebnis = await dbService.query(
            `DELETE FROM music_files WHERE id = ? AND guild_id = ?`,
            [id, guildId]
        );
        return (ergebnis.affectedRows || 0) > 0;
    }

    /**
     * Dateien, deren Aufbewahrung abgelaufen ist.
     *
     * Gezaehlt wird ab dem letzten Abspielen; wurde nie gespielt, ab dem
     * Hochladen. Guilds mit `datei_aufbewahrung_tage = 0` bleiben aussen vor -
     * dort gilt "nie".
     *
     * @returns {Promise<Array>} Datensaetze samt Guild
     */
    static async abgelaufene() {
        const dbService = ServiceManager.get('dbService');
        return await dbService.query(`
            SELECT f.*
              FROM music_files f
              JOIN music_settings s ON s.guild_id = f.guild_id
             WHERE s.datei_aufbewahrung_tage > 0
               AND COALESCE(f.zuletzt_gespielt, f.hochgeladen_am)
                   < DATE_SUB(NOW(), INTERVAL s.datei_aufbewahrung_tage DAY)
        `);
    }

    /**
     * Alle Eintraege einer Guild loeschen (beim Abschalten des Plugins).
     *
     * @param {string} guildId Discord-Guild-ID
     * @returns {Promise<void>}
     */
    static async alleEntfernen(guildId) {
        const dbService = ServiceManager.get('dbService');
        await dbService.query(`DELETE FROM music_files WHERE guild_id = ?`, [guildId]);
    }
}

module.exports = MusicFiles;
