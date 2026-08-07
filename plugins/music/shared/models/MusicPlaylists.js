const { ServiceManager } = require('dunebot-core');

/**
 * Gespeicherte Wiedergabelisten je Guild.
 *
 * Eine Liste haelt aufgeloeste Titel - also das, was der Bot direkt abspielen
 * kann, ohne die Quelle erneut zu befragen. Nur die Adresse wird beim
 * Abspielen frisch in einen Datenstrom verwandelt.
 */
class MusicPlaylists {
    /**
     * Alle Listen einer Guild, mit Anzahl der Titel.
     *
     * @param {string} guildId Discord-Guild-ID
     * @returns {Promise<Array>} Listen
     */
    static async getAll(guildId) {
        const dbService = ServiceManager.get('dbService');
        return await dbService.query(`
            SELECT p.*, COUNT(t.id) AS titel_anzahl,
                   COALESCE(SUM(t.duration_sec), 0) AS spielzeit_sek
              FROM music_playlists p
         LEFT JOIN music_playlist_tracks t ON t.playlist_id = p.id
             WHERE p.guild_id = ?
          GROUP BY p.id
          ORDER BY p.name ASC
        `, [guildId]);
    }

    /**
     * Eine Liste samt Titeln.
     *
     * @param {number} id Listen-ID
     * @param {string} guildId Discord-Guild-ID
     * @returns {Promise<Object|null>} Liste oder null
     */
    static async getWithTracks(id, guildId) {
        const dbService = ServiceManager.get('dbService');

        const zeilen = await dbService.query(
            'SELECT * FROM music_playlists WHERE id = ? AND guild_id = ?',
            [id, guildId]
        );
        if (zeilen.length === 0) return null;

        const liste = zeilen[0];
        liste.tracks = await dbService.query(
            'SELECT * FROM music_playlist_tracks WHERE playlist_id = ? ORDER BY position ASC, id ASC',
            [id]
        );
        return liste;
    }

    /**
     * Liste nach Namen suchen - dafuer gibt es den Befehl `/playlist`.
     *
     * @param {string} guildId Discord-Guild-ID
     * @param {string} name Listenname
     * @returns {Promise<Object|null>} Liste samt Titeln oder null
     */
    static async getByName(guildId, name) {
        const dbService = ServiceManager.get('dbService');
        const zeilen = await dbService.query(
            'SELECT * FROM music_playlists WHERE guild_id = ? AND name = ?',
            [guildId, name]
        );
        if (zeilen.length === 0) return null;
        return await this.getWithTracks(zeilen[0].id, guildId);
    }

    /**
     * Neue Liste anlegen.
     *
     * @param {string} guildId Discord-Guild-ID
     * @param {Object} daten { name, description, createdBy }
     * @returns {Promise<number>} ID der neuen Liste
     */
    static async create(guildId, daten) {
        const dbService = ServiceManager.get('dbService');
        const ergebnis = await dbService.query(
            'INSERT INTO music_playlists (guild_id, name, description, created_by) VALUES (?, ?, ?, ?)',
            [guildId, String(daten.name).substring(0, 128), daten.description || null, daten.createdBy || null]
        );
        return ergebnis?.insertId;
    }

    /**
     * Liste umbenennen oder beschreiben.
     *
     * @param {number} id Listen-ID
     * @param {string} guildId Discord-Guild-ID
     * @param {Object} updates { name, description }
     */
    static async update(id, guildId, updates) {
        const dbService = ServiceManager.get('dbService');

        const felder = [];
        const werte = [];
        if (updates.name !== undefined) { felder.push('name = ?'); werte.push(String(updates.name).substring(0, 128)); }
        if (updates.description !== undefined) { felder.push('description = ?'); werte.push(updates.description || null); }
        if (felder.length === 0) return false;

        const ergebnis = await dbService.query(
            `UPDATE music_playlists SET ${felder.join(', ')} WHERE id = ? AND guild_id = ?`,
            [...werte, id, guildId]
        );
        return (ergebnis?.affectedRows || 0) > 0;
    }

    /** Liste loeschen; die Titel gehen per Fremdschluessel mit. */
    static async delete(id, guildId) {
        const ergebnis = await ServiceManager.get('dbService').query(
            'DELETE FROM music_playlists WHERE id = ? AND guild_id = ?',
            [id, guildId]
        );
        return (ergebnis?.affectedRows || 0) > 0;
    }

    /**
     * Titel ans Ende einer Liste haengen.
     *
     * @param {number} playlistId Listen-ID
     * @param {Array<Object>} titel Aufgeloeste Titel
     * @param {string} [hinzugefuegtVon] Discord-ID
     */
    static async addTracks(playlistId, titel, hinzugefuegtVon = null) {
        const dbService = ServiceManager.get('dbService');
        if (!Array.isArray(titel) || titel.length === 0) return;

        const letzte = await dbService.query(
            'SELECT COALESCE(MAX(position), -1) AS letzte FROM music_playlist_tracks WHERE playlist_id = ?',
            [playlistId]
        );
        let position = Number(letzte[0]?.letzte ?? -1) + 1;

        for (const t of titel) {
            await dbService.query(`
                INSERT INTO music_playlist_tracks
                    (playlist_id, title, url, source, duration_sec, thumbnail, position, added_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                playlistId,
                String(t.title || '').substring(0, 512),
                String(t.url || '').substring(0, 1024),
                t.source || 'unbekannt',
                t.durationSec || null,
                t.thumbnail ? String(t.thumbnail).substring(0, 1024) : null,
                position++,
                hinzugefuegtVon
            ]);
        }
    }

    /** Einen Titel aus einer Liste entfernen. */
    static async removeTrack(trackId, playlistId) {
        const ergebnis = await ServiceManager.get('dbService').query(
            'DELETE FROM music_playlist_tracks WHERE id = ? AND playlist_id = ?',
            [trackId, playlistId]
        );
        return (ergebnis?.affectedRows || 0) > 0;
    }

    /** Alles einer Guild entfernen - beim Abschalten des Plugins. */
    static async deleteAll(guildId) {
        const dbService = ServiceManager.get('dbService');
        await dbService.query(
            'DELETE FROM music_playlist_tracks WHERE playlist_id IN (SELECT id FROM music_playlists WHERE guild_id = ?)',
            [guildId]
        );
        await dbService.query('DELETE FROM music_playlists WHERE guild_id = ?', [guildId]);
    }
}

module.exports = MusicPlaylists;
