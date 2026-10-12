'use strict';

const fs = require('fs');
const path = require('path');
const { ServiceManager, Spielemeldungen } = require('dunebot-core');

/**
 * Die Bilder einer Meldung in die Medienablage holen.
 *
 * Discord liefert einen Anhang unter einer Adresse aus, die abläuft. Ein Bild,
 * das im Blog stehen soll, muss also bei uns liegen: Der Bot lädt es in die
 * Medienablage der Guild, zu der der Kanal gehört (`apps/dashboard/uploads/
 * media/<guildId>/`, ausgeliefert unter `/uploads/media/…`), und trägt es dort
 * ein — im Ordner `spiele-updates`, damit der Betreiber in der Medienablage
 * sieht, wozu die Dateien gehören.
 *
 * Welche Anhänge mitkommen, wie die Datei heißt und woran ein Bild erkannt
 * wird, steht in `dunebot-core/lib/Spielemeldungen.js`. Hier steht nur das
 * Holen und Ablegen.
 *
 * Ein Bild, das sich nicht holen lässt, kostet nie die Meldung: Sie erscheint
 * dann ohne dieses Bild, und das Protokoll sagt, warum.
 */

/** Wie `plugins/music/shared/dateien.js`: der Ordner liegt beim Dashboard. */
const ABLAGE = path.join(__dirname, '..', '..', 'dashboard', 'uploads', 'media');
const FRIST = 20_000;

const q = (sql, werte) => ServiceManager.get('dbService').query(sql, werte);

async function lade(adresse) {
    const antwort = await fetch(adresse, { signal: AbortSignal.timeout(FRIST), redirect: 'error' });
    if (!antwort.ok) throw new Error(`HTTP ${antwort.status}`);
    const angesagt = Number(antwort.headers.get('content-length') || 0);
    if (angesagt > Spielemeldungen.BILD_HOECHSTENS) throw new Error(`${angesagt} Bytes — zu groß`);
    return Buffer.from(await antwort.arrayBuffer());
}

/**
 * @param {object} n         die Nachricht in der Form von `Spielemeldungen.ausDiscordJs`
 * @param {string} guildId   die Guild des Kanals
 * @param {string} botId     wer als Hochladender eingetragen wird
 * @param {string} [alt]     Alt-Text und Titel in der Medienablage
 * @param {string} [ablage] nur für den Wächter: ein anderer Ort als die echte Medienablage
 * @returns {Promise<Array<{adresse: string, alt: string}>>} die Bilder, die jetzt bei uns liegen
 */
async function sichere(n, guildId, botId, alt = '', ablage = ABLAGE) {
    const Logger = ServiceManager.get('Logger');
    const bilder = Spielemeldungen.bildAnhaenge(n);
    if (!bilder.length || !/^\d{17,20}$/.test(String(guildId))) return [];

    const ordner = path.join(ablage, String(guildId));
    const aus = [];
    for (const b of bilder) {
        const ziel = path.join(ordner, b.name);
        try {
            const eingetragen = await q('SELECT id FROM guild_media WHERE guild_id = ? AND stored_name = ? LIMIT 1', [String(guildId), b.name]);
            const liegtDa = fs.existsSync(ziel);
            if (!liegtDa) {
                const daten = await lade(b.adresse);
                if (!Spielemeldungen.istBild(daten, b.typ)) throw new Error(`kein ${b.typ} (Dateikopf passt nicht oder zu groß)`);
                await fs.promises.mkdir(ordner, { recursive: true });
                await fs.promises.writeFile(ziel, daten, { mode: 0o644 });
            }
            if (!eingetragen.length) {
                await q(
                    `INSERT INTO guild_media (guild_id, uploaded_by, filename, stored_name, mime_type, file_size, width, height, folder, alt_text, title)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [String(guildId), String(botId || '0').slice(0, 20), b.original, b.name, b.typ, fs.statSync(ziel).size,
                     b.breite, b.hoehe, Spielemeldungen.BILD_ORDNER, alt.slice(0, 255) || null, alt.slice(0, 255) || null]);
            }
            aus.push({ adresse: `/uploads/media/${guildId}/${b.name}`, alt });
        } catch (fehler) {
            Logger.warn(`[SpieleUpdates] Bild ${b.name} nicht geholt: ${fehler.message}`);
        }
    }
    return aus;
}

module.exports = { sichere, ABLAGE };
