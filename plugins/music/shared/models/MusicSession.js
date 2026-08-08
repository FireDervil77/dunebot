const { ServiceManager } = require('dunebot-core');

/** Der laufende Titel steht mit dieser Position in `music_queue`. */
const LAEUFT_GERADE = -1;

/**
 * Die laufende Sitzung: Sprachkanal, Einstellungen und Warteschlange.
 *
 * Gedacht fuer genau einen Zweck - dass ein Bot-Neustart oder ein
 * Verbindungsabriss eine muehsam zusammengestellte Liste nicht vernichtet.
 * Es ist **kein** Verlauf (dafuer gibt es `MusicHistory`) und **keine**
 * gespeicherte Wiedergabeliste (dafuer `MusicPlaylists`): hier steht immer
 * nur der eine Stand von jetzt, und er wird bei jeder Aenderung ersetzt.
 */
class MusicSession {
    /**
     * Eine Zeile aus `music_queue` in die Form bringen, die der Abspieler
     * erwartet.
     *
     * @param {Object} zeile Datenbankzeile
     * @returns {Object} Titel
     * @private
     */
    static _zuTitel(zeile) {
        return {
            title: zeile.title,
            url: zeile.url || null,
            source: zeile.source,
            durationSec: zeile.duration_sec ?? null,
            thumbnail: zeile.thumbnail || null,
            artist: zeile.artist || null,
            suchbegriff: zeile.suchbegriff || null,
            herkunftUrl: zeile.herkunft_url || null,
            requestedBy: zeile.requested_by || null
        };
    }

    /**
     * Einen Titel in die Werte fuer `music_queue` uebersetzen.
     *
     * @param {string} guildId Discord-Guild-ID
     * @param {Object} t Titel
     * @param {number} position -1 fuer den laufenden, sonst ab 0
     * @returns {Array} Werte in Spaltenreihenfolge
     * @private
     */
    static _zuZeile(guildId, t, position) {
        const kurz = (wert, laenge) =>
            wert === null || wert === undefined ? null : String(wert).substring(0, laenge);

        return [
            guildId,
            position,
            kurz(t.title, 512) || 'Unbekannter Titel',
            kurz(t.url, 1024),
            kurz(t.source, 32) || 'unbekannt',
            t.durationSec ?? null,
            kurz(t.thumbnail, 1024),
            kurz(t.artist, 255),
            kurz(t.suchbegriff, 512),
            kurz(t.herkunftUrl, 1024),
            kurz(t.requestedBy, 32)
        ];
    }

    /**
     * Den ganzen Stand sichern - Sitzung und Warteschlange.
     *
     * Ersetzt, was vorher dastand. In einer Transaktion, damit nie eine halbe
     * Warteschlange in der Datenbank steht: ohne sie waere ein Absturz genau
     * zwischen Loeschen und Einfuegen der schlimmste Fall, naemlich eine
     * scheinbar leere Liste.
     *
     * @param {string} guildId Discord-Guild-ID
     * @param {Object} stand { sprachKanalId, textKanalId, lautstaerke,
     *   wiederholung, filter, autoplay, dauerbetrieb, positionSek, aktuell,
     *   warteschlange }
     */
    static async sichern(guildId, stand) {
        const dbService = ServiceManager.get('dbService');

        // Ohne Sprachkanal gibt es nichts wiederherzustellen
        if (!stand.sprachKanalId) return await MusicSession.loeschen(guildId);

        await dbService.transaction(async (verbindung) => {
            await verbindung.query(`
                INSERT INTO music_sessions
                    (guild_id, voice_channel, text_channel, volume, repeat_mode,
                     audio_filter, autoplay, mode_247, position_sec)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    voice_channel = VALUES(voice_channel),
                    text_channel  = VALUES(text_channel),
                    volume        = VALUES(volume),
                    repeat_mode   = VALUES(repeat_mode),
                    audio_filter  = VALUES(audio_filter),
                    autoplay      = VALUES(autoplay),
                    mode_247      = VALUES(mode_247),
                    position_sec  = VALUES(position_sec)
            `, [
                guildId,
                String(stand.sprachKanalId),
                stand.textKanalId ? String(stand.textKanalId) : null,
                stand.lautstaerke ?? 50,
                stand.wiederholung || 'aus',
                stand.filter || 'aus',
                stand.autoplay ? 1 : 0,
                stand.dauerbetrieb ? 1 : 0,
                Math.max(0, Math.round(stand.positionSek || 0))
            ]);

            await verbindung.query('DELETE FROM music_queue WHERE guild_id = ?', [guildId]);

            const zeilen = [];
            if (stand.aktuell) zeilen.push(MusicSession._zuZeile(guildId, stand.aktuell, LAEUFT_GERADE));
            (stand.warteschlange || []).forEach((t, i) => {
                zeilen.push(MusicSession._zuZeile(guildId, t, i));
            });

            if (zeilen.length === 0) return;

            // Alles in einer Anweisung - bei langen Listen waere jede Zeile
            // einzeln ein Vielfaches an Zeit
            const platzhalter = zeilen.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
            await verbindung.query(`
                INSERT INTO music_queue
                    (guild_id, position, title, url, source, duration_sec,
                     thumbnail, artist, suchbegriff, herkunft_url, requested_by)
                VALUES ${platzhalter}
            `, zeilen.flat());
        });
    }

    /**
     * Den gesicherten Stand einer Guild holen.
     *
     * @param {string} guildId Discord-Guild-ID
     * @returns {Promise<Object|null>} Stand oder null
     */
    static async laden(guildId) {
        const dbService = ServiceManager.get('dbService');

        const [sitzung] = await dbService.query(
            'SELECT * FROM music_sessions WHERE guild_id = ? LIMIT 1', [guildId]
        );
        if (!sitzung) return null;

        const zeilen = await dbService.query(
            'SELECT * FROM music_queue WHERE guild_id = ? ORDER BY position ASC', [guildId]
        );

        const laufend = zeilen.find(z => z.position === LAEUFT_GERADE);

        return {
            guildId,
            sprachKanalId: sitzung.voice_channel,
            textKanalId: sitzung.text_channel,
            lautstaerke: sitzung.volume,
            wiederholung: sitzung.repeat_mode,
            filter: sitzung.audio_filter,
            autoplay: Boolean(sitzung.autoplay),
            dauerbetrieb: Boolean(sitzung.mode_247),
            positionSek: sitzung.position_sec,
            gesichertUm: sitzung.updated_at,
            aktuell: laufend ? MusicSession._zuTitel(laufend) : null,
            warteschlange: zeilen
                .filter(z => z.position >= 0)
                .map(z => MusicSession._zuTitel(z))
        };
    }

    /**
     * Alle gesicherten Sitzungen - fuer das Wiederherstellen beim Start.
     *
     * @returns {Promise<Array<Object>>} Staende
     */
    static async alle() {
        const dbService = ServiceManager.get('dbService');
        const sitzungen = await dbService.query('SELECT guild_id FROM music_sessions');

        const staende = [];
        for (const s of sitzungen) {
            const stand = await MusicSession.laden(s.guild_id);
            if (stand) staende.push(stand);
        }
        return staende;
    }

    /**
     * Den gesicherten Stand verwerfen.
     *
     * @param {string} guildId Discord-Guild-ID
     */
    static async loeschen(guildId) {
        // music_queue haengt per Fremdschluessel daran und geht mit
        await ServiceManager.get('dbService').query(
            'DELETE FROM music_sessions WHERE guild_id = ?', [guildId]
        );
    }
}

MusicSession.LAEUFT_GERADE = LAEUFT_GERADE;

module.exports = MusicSession;
