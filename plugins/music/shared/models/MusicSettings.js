const { ServiceManager } = require('dunebot-core');

/**
 * Einstellungen einer Guild.
 *
 * `allowed_voice` haelt eine Liste erlaubter Sprachkanaele als JSON-Text;
 * leer bedeutet "ueberall erlaubt".
 */
class MusicSettings {
    /**
     * Einstellungen laden, beim ersten Zugriff mit Standardwerten anlegen.
     *
     * @param {string} guildId Discord-Guild-ID
     * @returns {Promise<Object>} Einstellungen
     */
    static async getSettings(guildId) {
        const dbService = ServiceManager.get('dbService');

        const zeilen = await dbService.query('SELECT * FROM music_settings WHERE guild_id = ?', [guildId]);
        if (zeilen.length > 0) return this._aufbereiten(zeilen[0]);

        await dbService.query('INSERT IGNORE INTO music_settings (guild_id) VALUES (?)', [guildId]);
        const neu = await dbService.query('SELECT * FROM music_settings WHERE guild_id = ?', [guildId]);
        return this._aufbereiten(neu[0]);
    }

    /**
     * Einzelne Felder schreiben.
     *
     * @param {string} guildId Discord-Guild-ID
     * @param {Object} updates Nur die zu aendernden Felder
     */
    static async updateSettings(guildId, updates) {
        const dbService = ServiceManager.get('dbService');

        const erlaubt = [
            'dj_role_id', 'default_volume', 'max_queue_size', 'max_track_seconds',
            'allowed_voice', 'announce_channel', 'announce_now_playing',
            'leave_when_empty', 'leave_after_seconds',
            'allow_youtube', 'allow_soundcloud', 'allow_spotify', 'allow_direct'
        ];

        const felder = [];
        const werte = [];
        for (const [feld, wert] of Object.entries(updates)) {
            if (!erlaubt.includes(feld)) continue;
            felder.push(`${feld} = ?`);
            werte.push(Array.isArray(wert) ? JSON.stringify(wert) : wert);
        }
        if (felder.length === 0) return;

        // Sicherstellen, dass die Zeile existiert
        await dbService.query('INSERT IGNORE INTO music_settings (guild_id) VALUES (?)', [guildId]);
        await dbService.query(
            `UPDATE music_settings SET ${felder.join(', ')} WHERE guild_id = ?`,
            [...werte, guildId]
        );
    }

    /** JSON-Felder lesbar machen und Wahrheitswerte als Boolean liefern. */
    static _aufbereiten(zeile) {
        let kanaele = [];
        if (zeile.allowed_voice) {
            try {
                const gelesen = typeof zeile.allowed_voice === 'string'
                    ? JSON.parse(zeile.allowed_voice)
                    : zeile.allowed_voice;
                if (Array.isArray(gelesen)) kanaele = gelesen;
            } catch { kanaele = []; }
        }

        return {
            ...zeile,
            allowed_voice: kanaele,
            announce_now_playing: Boolean(zeile.announce_now_playing),
            leave_when_empty: Boolean(zeile.leave_when_empty),
            allow_youtube: Boolean(zeile.allow_youtube),
            allow_soundcloud: Boolean(zeile.allow_soundcloud),
            allow_spotify: Boolean(zeile.allow_spotify),
            allow_direct: Boolean(zeile.allow_direct)
        };
    }
}

module.exports = MusicSettings;
