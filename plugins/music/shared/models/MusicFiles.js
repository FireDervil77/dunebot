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
            `INSERT INTO music_files
                (guild_id, dateiname, originalname, herkunft, fuer_stream, groesse_bytes,
                 dauer_sek, hochgeladen_von)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [guildId, daten.dateiname, daten.originalname,
             daten.herkunft || null,
             // **Freigeben ist eine Handlung.** Eine Datei kommt nie
             // freigegeben in die Welt, auch wenn das Formular den Schalter
             // vergisst - der Stream-Weg ist die Stelle, an der nichts
             // versehentlich hineinrutschen darf.
             daten.fuerStream ? 1 : 0,
             daten.groesseBytes || 0,
             // NULL heisst „nicht gemessen", nicht „null Sekunden lang". Die
             // Restspielzeit rechnet mit `|| 0`; eine 0 in der Spalte waere
             // eine Behauptung ueber eine Datei, die niemand angesehen hat.
             Number.isFinite(daten.dauerSek) && daten.dauerSek > 0 ? daten.dauerSek : null,
             daten.hochgeladenVon || null]
        );
        return ergebnis.insertId;
    }

    /**
     * Herkunft und Stream-Freigabe nachtragen.
     *
     * Beide zusammen, weil sie zusammen bearbeitet werden: Wer eine Datei
     * freigibt, traegt bei der Gelegenheit ein, woher sie kam.
     *
     * @param {number} id Datensatz-ID
     * @param {string} guildId Guild - schuetzt vor dem Bearbeiten fremder Zeilen
     * @param {{herkunft: string|null, fuerStream: boolean}} merkmale Neue Werte
     * @returns {Promise<boolean>} true, wenn eine Zeile getroffen wurde
     */
    static async merkmaleSetzen(id, guildId, merkmale) {
        const dbService = ServiceManager.get('dbService');
        const ergebnis = await dbService.query(
            `UPDATE music_files SET herkunft = ?, fuer_stream = ? WHERE id = ? AND guild_id = ?`,
            [merkmale.herkunft || null, merkmale.fuerStream ? 1 : 0, id, guildId]
        );
        return Number(ergebnis?.affectedRows || 0) > 0;
    }

    /**
     * Die fuer den Stream freigegebenen Dateien einer Guild.
     *
     * Der Wunschbefehl sucht spaeter **nur** hierueber. Ein zweiter Weg an
     * dieser Abfrage vorbei waere genau das Loch, gegen das die Ablage gebaut
     * ist (`docs/musikwunsch/README.md`).
     *
     * @param {string} guildId Guild
     * @param {string} [suche] Teil des Namens, gross/klein egal
     * @returns {Promise<Array>} Dateien
     */
    static async fuerStream(guildId, suche = null) {
        const dbService = ServiceManager.get('dbService');
        const werte = [guildId];
        let wo = 'guild_id = ? AND fuer_stream = 1';

        if (suche && String(suche).trim()) {
            wo += ' AND originalname LIKE ?';
            werte.push(`%${String(suche).trim()}%`);
        }

        return await dbService.query(
            `SELECT * FROM music_files WHERE ${wo} ORDER BY originalname ASC`, werte);
    }

    /**
     * **Eine** freigegebene Datei, ueber ihre Kennung.
     *
     * `fuerStream()` sucht nach Namen; der Player und die Warteschlange kennen
     * dagegen die Kennung. **Der Filter `fuer_stream = 1` steht hier genauso**,
     * und das ist der ganze Punkt: Eine Abfrage nach `id` ohne ihn waere der
     * zweite Weg, gegen den die Ablage gebaut ist - eine einmal freigegebene
     * und danach gesperrte Datei liefe sonst weiter, weil ihre Kennung ja schon
     * in der Warteschlange steht.
     *
     * `guild_id` steht mit in der Bedingung, damit eine fremde Kennung nicht
     * die Datei einer anderen Guild liefert.
     *
     * @param {string} guildId Guild
     * @param {number} id Datensatz-ID
     * @returns {Promise<Object|null>} Die Datei oder null
     */
    static async fuerStreamEine(guildId, id) {
        const dbService = ServiceManager.get('dbService');
        const zeilen = await dbService.query(
            `SELECT * FROM music_files WHERE id = ? AND guild_id = ? AND fuer_stream = 1 LIMIT 1`,
            [Number(id), guildId]
        );
        return zeilen?.[0] || null;
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
