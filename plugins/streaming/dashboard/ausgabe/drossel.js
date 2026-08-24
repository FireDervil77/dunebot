'use strict';

/**
 * Streaming - der Ausgang.
 *
 * Ein grosser Streamer geht live, 300 Guilds wollen im selben Augenblick
 * posten. Discord laesst **50 Anfragen je Sekunde je Bot-Token** zu und
 * **5 Nachrichten je 5 Sekunden je Kanal**. Beim Streamende kommt derselbe
 * Schwall ein zweites Mal, weil alle Nachrichten bearbeitet werden.
 *
 * Zwei Zahlen halten die Grenze ein:
 *
 *   - hoechstens 20 Auftraege je 500 ms = 40/s, unter den 50/s des Tokens
 *   - je Kanal hoechstens **einer** gleichzeitig - das haelt die Kanalgrenze,
 *     ohne sie nachzaehlen zu muessen
 *
 * Die Warteschlange ist eine **Tabelle**, kein Objekt im Speicher: Ein
 * Neustart mitten im Schwall darf keine Ankuendigung verschlucken.
 *
 * **Aufgeben ist eine Antwort, kein Verschwinden.** Ein Ziel, dessen Kanal
 * geloescht wurde, steht mit Grund auf der Zustandsseite. Stilles Fallenlassen
 * ist genau der Zustand, den die Marktanalyse als Marktluecke benennt.
 *
 * @module streaming/dashboard/ausgabe/drossel
 */

const { ServiceManager } = require('dunebot-core');
const nachricht = require('./nachricht');

const TAKT_MS = 500;
const JE_LAUF = 20;
const HOECHSTVERSUCHE = 5;

let laeuftGerade = false;
let uhr = null;

/**
 * @returns {Object} Datenbankdienst
 */
function db() {
    return ServiceManager.get('dbService');
}

/**
 * @returns {Object} Logger
 */
function log() {
    return ServiceManager.get('Logger');
}

/**
 * Auftrag an den Bot geben.
 *
 * Der Ereignisname ist der **Dateiname** des Handlers unter
 * `bot/events/ipc/` (`BotPlugin.js:183`) - deshalb `streaming:post` und nicht
 * `streaming:POST`.
 *
 * **Doppelte Huelle beachten:** Plugin-Ereignisse antworten
 * `{ success, data: { … } }`. Wer nur die aeussere Huelle liest, bekommt leere
 * Daten und haelt einen Fehler fuer einen Erfolg.
 *
 * @param {string} ereignis IPC-Ereignis
 * @param {Object} nutzlast Nutzlast
 * @returns {Promise<{ok: boolean, daten: Object, fehler: string|null, code: number|null}>} Ergebnis
 */
async function anDenBot(ereignis, nutzlast) {
    const ipcServer = ServiceManager.get('ipcServer');
    if (!ipcServer) return { ok: false, daten: {}, fehler: 'IPC nicht verfuegbar', code: null };

    const antwort = await ipcServer.broadcastOne(ereignis, nutzlast);
    const aeussere = Array.isArray(antwort) ? antwort[0] : antwort;

    if (!aeussere?.success) {
        return { ok: false, daten: {}, fehler: aeussere?.error || 'unbekannter Fehler', code: aeussere?.code ?? null };
    }

    const innere = aeussere.data || {};
    if (innere.success === false) {
        return { ok: false, daten: innere, fehler: innere.error || 'unbekannter Fehler', code: innere.code ?? null };
    }

    return { ok: true, daten: innere, fehler: null, code: null };
}

/**
 * Alles laden, was fuer eine Nachricht gebraucht wird.
 *
 * @param {Object} auftrag Outbox-Zeile
 * @returns {Promise<Object|null>} { ziel, streamer, zustand } oder null
 */
async function umfeldLaden(auftrag) {
    const zeilen = await db().query(`
        SELECT t.*, s.plattform, s.login, s.anzeigename, s.avatar_url, s.id AS streamer_id,
               z.titel, z.kategorie, z.zuschauer, z.vorschaubild, z.begonnen_am, z.beendet_am,
               z.sendung_id, z.ist_live
          FROM streaming_targets t
          JOIN streaming_streamers s ON s.id = t.streamer_id
          LEFT JOIN streaming_state z ON z.streamer_id = s.id
         WHERE t.id = ?
    `, [auftrag.target_id]);

    if (!zeilen.length) return null;
    const r = zeilen[0];

    return {
        ziel: {
            id: r.id, guild_id: r.guild_id, channel_id: r.channel_id, rolle_id: r.rolle_id,
            onair_channel: r.onair_channel, vorlage: r.vorlage, eigenes_bild: r.eigenes_bild,
            aufraeumen: r.aufraeumen, veroeffentlichen: r.veroeffentlichen
        },
        streamer: {
            id: r.streamer_id, plattform: r.plattform, login: r.login,
            anzeigename: r.anzeigename, avatar_url: r.avatar_url
        },
        zustand: {
            titel: r.titel, kategorie: r.kategorie, zuschauer: r.zuschauer,
            vorschaubild: r.vorschaubild, begonnen_am: r.begonnen_am,
            beendet_am: r.beendet_am, sendung_id: r.sendung_id, ist_live: r.ist_live
        }
    };
}

/**
 * Einen Auftrag ausfuehren.
 *
 * @param {Object} auftrag Outbox-Zeile
 * @returns {Promise<{ok: boolean, fehler: string|null, endgueltig: boolean}>} Ergebnis
 */
async function ausfuehren(auftrag) {
    const umfeld = await umfeldLaden(auftrag);
    if (!umfeld) return { ok: false, fehler: 'Ziel existiert nicht mehr', endgueltig: true };

    const { ziel, streamer, zustand } = umfeld;
    const sendungId = zustand.sendung_id || 'ohne';

    if (auftrag.aktion === 'posten') {
        const inhalt = nachricht.live({ streamer, zustand, ziel });

        // Platz reservieren, BEVOR gesendet wird: Der eindeutige Schluessel
        // (target_id, sendung_id) verhindert, dass zwei Laeufe dieselbe
        // Ankuendigung zweimal posten.
        try {
            await db().query(
                `INSERT INTO streaming_messages (target_id, sendung_id, channel_id, zustand)
                 VALUES (?, ?, ?, 'offen')`,
                [ziel.id, sendungId, ziel.channel_id]);
        } catch (e) {
            if (e.code === 'ER_DUP_ENTRY') {
                return { ok: true, fehler: null, endgueltig: true, hinweis: 'stand schon' };
            }
            throw e;
        }

        const antwort = await anDenBot('streaming:post', {
            guildId: ziel.guild_id, channelId: ziel.channel_id,
            veroeffentlichen: Boolean(ziel.veroeffentlichen), ...inhalt
        });

        if (!antwort.ok) {
            await db().query(
                "UPDATE streaming_messages SET zustand = 'fehler' WHERE target_id = ? AND sendung_id = ?",
                [ziel.id, sendungId]);
            return { ok: false, fehler: antwort.fehler, endgueltig: istEndgueltig(antwort) };
        }

        await db().query(
            `UPDATE streaming_messages SET message_id = ?, gesendet_am = NOW(), zustand = 'steht'
              WHERE target_id = ? AND sendung_id = ?`,
            [antwort.daten.messageId, ziel.id, sendungId]);

        return { ok: true, fehler: null, endgueltig: false };
    }

    // Bearbeiten und Aufraeumen brauchen eine stehende Nachricht.
    const gesendet = await db().query(
        "SELECT * FROM streaming_messages WHERE target_id = ? AND sendung_id = ? AND zustand = 'steht' LIMIT 1",
        [ziel.id, sendungId]);

    if (!gesendet.length) {
        return { ok: true, fehler: null, endgueltig: true, hinweis: 'keine stehende Nachricht' };
    }
    const zeile = gesendet[0];

    if (auftrag.aktion === 'bearbeiten') {
        const inhalt = nachricht.live({ streamer, zustand, ziel });
        const antwort = await anDenBot('streaming:edit', {
            guildId: ziel.guild_id, channelId: zeile.channel_id, messageId: zeile.message_id, ...inhalt
        });
        if (!antwort.ok) return { ok: false, fehler: antwort.fehler, endgueltig: istEndgueltig(antwort) };

        await db().query('UPDATE streaming_messages SET geaendert_am = NOW() WHERE id = ?', [zeile.id]);
        return { ok: true, fehler: null, endgueltig: false };
    }

    if (auftrag.aktion === 'aufraeumen') {
        // Kam der Streamer innerhalb der Karenz zurueck, ist er wieder live -
        // dann waere Aufraeumen falsch.
        if (zustand.ist_live) return { ok: true, fehler: null, endgueltig: true, hinweis: 'wieder live' };

        if (ziel.aufraeumen === 'stehenlassen') {
            return { ok: true, fehler: null, endgueltig: true, hinweis: 'stehenlassen' };
        }

        if (ziel.aufraeumen === 'loeschen') {
            const antwort = await anDenBot('streaming:remove', {
                guildId: ziel.guild_id, channelId: zeile.channel_id, messageId: zeile.message_id
            });
            if (!antwort.ok) return { ok: false, fehler: antwort.fehler, endgueltig: istEndgueltig(antwort) };

            await db().query("UPDATE streaming_messages SET zustand = 'weg' WHERE id = ?", [zeile.id]);
            return { ok: true, fehler: null, endgueltig: false };
        }

        // Vorgabe: zur Rueckschau umbauen
        const inhalt = nachricht.rueckschau({ streamer, zustand, ziel, vodUrl: null });
        const antwort = await anDenBot('streaming:edit', {
            guildId: ziel.guild_id, channelId: zeile.channel_id, messageId: zeile.message_id, ...inhalt
        });
        if (!antwort.ok) return { ok: false, fehler: antwort.fehler, endgueltig: istEndgueltig(antwort) };

        await db().query('UPDATE streaming_messages SET geaendert_am = NOW() WHERE id = ?', [zeile.id]);
        return { ok: true, fehler: null, endgueltig: false };
    }

    return { ok: false, fehler: `unbekannte Aktion "${auftrag.aktion}"`, endgueltig: true };
}

/**
 * Ist der Fehler dauerhaft? Dann hilft kein zweiter Versuch.
 *
 * @param {Object} antwort Antwort des Bots
 * @returns {boolean} true bei dauerhaftem Fehler
 */
function istEndgueltig(antwort) {
    const text = String(antwort.fehler || '').toLowerCase();
    if (antwort.code === 50013 || antwort.code === 50001) return true;   // fehlende Rechte
    if (antwort.code === 10003 || antwort.code === 10008) return true;   // Kanal/Nachricht weg
    return /unknown channel|unknown message|missing (access|permissions)/.test(text);
}

/**
 * Ein Durchlauf.
 *
 * @returns {Promise<void>}
 */
async function lauf() {
    if (laeuftGerade) return;
    laeuftGerade = true;

    try {
        const faellig = await db().query(`
            SELECT * FROM streaming_outbox
             WHERE zustand = 'offen' AND faellig_ab <= NOW(3)
             ORDER BY id ASC LIMIT ?
        `, [JE_LAUF]);

        const belegteKanaele = new Set();

        for (const auftrag of faellig) {
            const ziel = await db().query('SELECT channel_id FROM streaming_targets WHERE id = ?', [auftrag.target_id]);
            const kanal = ziel[0]?.channel_id;

            // Je Kanal hoechstens einer je Lauf - das haelt die Grenze von
            // 5 Nachrichten je 5 Sekunden ohne Nachzaehlen.
            if (kanal && belegteKanaele.has(kanal)) continue;
            if (kanal) belegteKanaele.add(kanal);

            try {
                const ergebnis = await ausfuehren(auftrag);

                if (ergebnis.ok) {
                    await db().query("UPDATE streaming_outbox SET zustand = 'fertig', fehlertext = ? WHERE id = ?",
                        [ergebnis.hinweis || null, auftrag.id]);
                    continue;
                }

                const versuche = auftrag.versuche + 1;
                const aufgeben = ergebnis.endgueltig || versuche >= HOECHSTVERSUCHE;

                await db().query(`
                    UPDATE streaming_outbox
                       SET versuche = ?, fehlertext = ?,
                           zustand = ?,
                           faellig_ab = DATE_ADD(NOW(3), INTERVAL ? SECOND)
                     WHERE id = ?
                `, [versuche, String(ergebnis.fehler).slice(0, 512),
                    aufgeben ? 'aufgegeben' : 'offen', Math.min(60, 2 ** versuche), auftrag.id]);

                if (aufgeben) {
                    log().error(`[Streaming] Auftrag ${auftrag.id} (${auftrag.aktion}) aufgegeben: ${ergebnis.fehler}`);
                }
            } catch (err) {
                await db().query(
                    "UPDATE streaming_outbox SET versuche = versuche + 1, fehlertext = ?, zustand = IF(versuche + 1 >= ?, 'aufgegeben', 'offen') WHERE id = ?",
                    [String(err.message).slice(0, 512), HOECHSTVERSUCHE, auftrag.id]);
                log().error(`[Streaming] Auftrag ${auftrag.id} fehlgeschlagen:`, err);
            }
        }
    } catch (err) {
        log().error('[Streaming] Ausgang-Lauf fehlgeschlagen:', err);
    } finally {
        laeuftGerade = false;
    }
}

/**
 * @returns {void}
 */
function starten() {
    if (uhr) return;
    uhr = setInterval(() => lauf().catch(() => {}), TAKT_MS);
    uhr.unref?.();
    log().info(`[Streaming] Ausgang gestartet (${JE_LAUF} Auftraege je ${TAKT_MS} ms)`);
}

/**
 * @returns {void}
 */
function anhalten() {
    if (uhr) clearInterval(uhr);
    uhr = null;
}

module.exports = { TAKT_MS, JE_LAUF, HOECHSTVERSUCHE, starten, anhalten, lauf, ausfuehren, istEndgueltig };
