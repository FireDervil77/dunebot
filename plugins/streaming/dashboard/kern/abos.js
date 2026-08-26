'use strict';

/**
 * Streaming - Abonnements bei der Plattform.
 *
 * Hier steckt die Regel, die den Mandantenbetrieb traegt:
 *
 *     Das Abonnement ist global, das Ziel gehoert der Guild.
 *
 * Wenn 200 Server denselben Kanal beobachten, gibt es trotzdem **ein** Abo.
 * Das ist keine Sparsamkeit: Twitch erlaubt hoechstens drei Abos mit gleichem
 * Typ und gleicher Bedingung. Ein Abo je Guild ist technisch unmoeglich.
 *
 * Umgekehrt gilt: Wenn die **letzte** Guild ein Ziel entfernt, muss das Abo
 * weg. Sonst laeuft das Kontingent langsam voll, und irgendwann laesst sich
 * kein neuer Kanal mehr eintragen — mit einer Fehlermeldung, die niemand mit
 * geloeschten Guilds in Verbindung bringt.
 *
 * Die Zahl der Nutzer wird **gerechnet**, nicht gezaehlt: Ein Zaehler in einer
 * Spalte laeuft auseinander, sobald eine Zeile per Hand verschwindet oder der
 * Bot aus einer Guild fliegt.
 *
 * @module streaming/dashboard/kern/abos
 */

const crypto = require('crypto');
const { ServiceManager } = require('dunebot-core');
const twitch = require('../plattformen/twitch');

/** @type {Object<string, Object>} Adapter je Plattform */
const ADAPTER = { twitch };

/**
 * Welche Ereignisse ein Kanal bekommt - **der Adapter sagt es**, nicht der Kern.
 *
 * Frueher stand die Liste hier. Das war ein Schichtenbruch: `stream.online`
 * ist ein Twitch-Wort, und Kick wie YouTube bringen eigene mit. Gefunden von
 * `scripts/check-streaming-schichten.js`.
 *
 * @param {string} plattform Plattform
 * @returns {Array<string>} Ereignisnamen der Plattform
 */
function ereignisseVon(plattform) {
    return ADAPTER[plattform]?.EREIGNISSE || [];
}

/**
 * Die zusaetzlichen Ereignisse fuer Abonnenten-Rollen (Stufe 12b).
 *
 * **Getrennt und nur auf Anforderung**, aus zwei Gruenden. Erstens kosten sie
 * eine Zusage des Kanalinhabers (`channel:read:subscriptions`) — sie
 * vorsorglich zu bestellen scheiterte einfach. Zweitens kostet jedes Abo
 * Kontingent: Ein Kanal, dessen Guilds gar keine Abonnenten-Rolle vergeben,
 * soll dafuer nichts bezahlen.
 *
 * @param {string} plattform Anbieter
 * @returns {Array<string>} Ereignisse
 */
function aboEreignisseVon(plattform) {
    return ADAPTER[plattform]?.EREIGNISSE_ABO || [];
}

/**
 * Will fuer diesen Kanal ueberhaupt jemand eine Abonnenten-Rolle vergeben?
 *
 * Referenzzaehlung wie bei allem anderen: Es genuegt EINE Guild, die es will,
 * und es braucht KEINE mehr, sobald es die letzte abschaltet.
 *
 * @param {number} streamerId Streamer
 * @returns {Promise<boolean>} true, wenn mindestens ein Ziel es will
 */
async function aboRollenGewuenscht(streamerId) {
    const zeilen = await db().query(`
        SELECT 1 FROM streaming_targets
         WHERE streamer_id = ? AND aktiv = 1
           AND abo_rolle_id IS NOT NULL AND abo_rolle_id <> ''
         LIMIT 1
    `, [streamerId]);
    return zeilen.length > 0;
}

/**
 * @returns {Object} Datenbankdienst
 */
function db() {
    return ServiceManager.get('dbService');
}

/**
 * Die Adresse, die die Plattform anruft.
 *
 * @returns {string} vollstaendige HTTPS-Adresse
 * @throws {Error} wenn keine Basisadresse gesetzt ist
 */
function rueckrufAdresse() {
    const basis = (process.env.DASHBOARD_BASE_URL || '').replace(/\/+$/, '');
    if (!basis.startsWith('https://')) {
        // Twitch verlangt HTTPS mit gueltigem Zertifikat. Ohne das scheitert
        // schon das Anlegen — besser hier mit klarem Text als dort mit einer
        // Fehlernummer.
        throw new Error(`DASHBOARD_BASE_URL fehlt oder ist kein HTTPS: "${basis}"`);
    }
    return `${basis}/api/streaming/webhook`;
}

/**
 * Wie viele aktive Ziele haengen an diesem Streamer - ueber alle Guilds.
 *
 * @param {number} streamerId Streamer
 * @returns {Promise<number>} Anzahl
 */
async function nutzerZaehlen(streamerId) {
    const zeilen = await db().query(
        'SELECT COUNT(*) AS anzahl FROM streaming_targets WHERE streamer_id = ? AND aktiv = 1',
        [streamerId]);
    return Number(zeilen[0]?.anzahl || 0);
}

/**
 * Streamer anlegen oder den vorhandenen wiederverwenden.
 *
 * @param {string} plattform Plattform
 * @param {Object} kanal Aufgeloester Kanal
 * @returns {Promise<{id: number, neu: boolean}>} Streamer
 */
async function streamerSichern(plattform, kanal) {
    const vorhanden = await db().query(
        'SELECT id FROM streaming_streamers WHERE plattform = ? AND kanal_id = ? LIMIT 1',
        [plattform, String(kanal.kanal_id)]);

    if (vorhanden.length) {
        // Anzeigename und Bild koennen sich geaendert haben.
        await db().query(
            `UPDATE streaming_streamers
                SET login = ?, anzeigename = ?, avatar_url = ?, geprueft_am = NOW()
              WHERE id = ?`,
            [kanal.login, kanal.anzeigename || null, kanal.avatar || null, vorhanden[0].id]);
        return { id: vorhanden[0].id, neu: false };
    }

    const ergebnis = await db().query(
        `INSERT INTO streaming_streamers (plattform, kanal_id, login, anzeigename, avatar_url, geprueft_am)
         VALUES (?, ?, ?, ?, ?, NOW())`,
        [plattform, String(kanal.kanal_id), kanal.login, kanal.anzeigename || null, kanal.avatar || null]);

    // `query` liefert bei INSERT den ResultSetHeader direkt - kein
    // Destrukturieren, das ist der Fehler aus Baustelle 63a.
    return { id: ergebnis.insertId, neu: true };
}

/**
 * Sicherstellen, dass dieser Streamer bei der Plattform abonniert ist.
 *
 * Legt nur an, was fehlt. Ein vorhandenes, bestaetigtes Abo wird nicht
 * angefasst — ein zweites waere nicht nur ueberfluessig, sondern liefe in die
 * Grenze von drei gleichen Abos.
 *
 * @param {number} streamerId Streamer
 * @param {string} plattform Plattform
 * @param {string} kanalId Kanal bei der Plattform
 * @returns {Promise<Array>} je Ereignis ein Ergebnis
 */
async function abosSichern(streamerId, plattform, kanalId) {
    const Logger = ServiceManager.get('Logger');
    const adapter = ADAPTER[plattform];
    if (!adapter) throw new Error(`Keine Unterstuetzung fuer Plattform "${plattform}"`);

    const vorhanden = await db().query(
        'SELECT ereignis, zustand FROM streaming_subscriptions WHERE streamer_id = ?', [streamerId]);
    const schonDa = new Map(vorhanden.map(z => [z.ereignis, z.zustand]));

    const ergebnisse = [];

    // Die Abo-Ereignisse kommen nur dazu, wenn eine Guild sie braucht.
    const gewuenscht = [...ereignisseVon(plattform)];
    if (await aboRollenGewuenscht(streamerId)) gewuenscht.push(...aboEreignisseVon(plattform));

    for (const ereignis of gewuenscht) {
        const zustand = schonDa.get(ereignis);
        if (zustand === 'bestaetigt' || zustand === 'angefragt') {
            ergebnisse.push({ ereignis, uebersprungen: true, zustand });
            continue;
        }

        // Je Abo ein eigenes Geheimnis: Ein verlorenes kostet dann ein Abo,
        // nicht alle.
        const geheimnis = crypto.randomBytes(32).toString('hex');

        // Erst eintragen, dann anlegen. Andersherum kann die
        // Bestaetigungsanfrage schneller da sein als unsere Zeile — Twitch
        // ruft sofort an, und der Eingang faende kein Abo und damit kein
        // Geheimnis.
        await db().query(
            `INSERT INTO streaming_subscriptions (streamer_id, ereignis, geheimnis, zustand)
             VALUES (?, ?, ?, 'angefragt')
             ON DUPLICATE KEY UPDATE geheimnis = VALUES(geheimnis), zustand = 'angefragt', fehlertext = NULL`,
            [streamerId, ereignis, geheimnis]);

        const [antwort] = await adapter.abonnieren(kanalId, [ereignis], rueckrufAdresse(), geheimnis);

        if (antwort.ok) {
            await db().query(
                `UPDATE streaming_subscriptions
                    SET anbieter_abo_id = ?, kosten = ?, fehlertext = NULL
                  WHERE streamer_id = ? AND ereignis = ?`,
                [antwort.anbieter_abo_id, antwort.kosten, streamerId, ereignis]);
            Logger.info(`[Streaming] Abo angelegt: ${ereignis} fuer Kanal ${kanalId} (Kosten ${antwort.kosten})`);
        } else {
            await db().query(
                `UPDATE streaming_subscriptions SET zustand = 'fehler', fehlertext = ?
                  WHERE streamer_id = ? AND ereignis = ?`,
                [String(antwort.fehler).slice(0, 255), streamerId, ereignis]);
            Logger.error(`[Streaming] Abo abgelehnt (${ereignis}, HTTP ${antwort.status}): ${antwort.fehler}`);
        }

        ergebnisse.push(antwort);
    }

    return ergebnisse;
}

/**
 * Abos abbestellen, wenn keine Guild den Streamer mehr beobachtet.
 *
 * @param {number} streamerId Streamer
 * @returns {Promise<{abbestellt: number, behalten: boolean}>} Ergebnis
 */
async function aboEreignisseAufraeumen(streamerId) {
    const Logger = ServiceManager.get('Logger');

    // Solange EINE Guild die Rolle vergibt, bleiben die Abos. Referenzzaehlung
    // wie ueberall sonst.
    if (await aboRollenGewuenscht(streamerId)) return { abbestellt: 0, behalten: true };

    const zeilen = await db().query(
        'SELECT s.plattform, a.id, a.ereignis, a.anbieter_abo_id FROM streaming_subscriptions a ' +
        'JOIN streaming_streamers s ON s.id = a.streamer_id WHERE a.streamer_id = ?', [streamerId]);

    let abbestellt = 0;

    for (const zeile of zeilen) {
        const adapter = ADAPTER[zeile.plattform];
        if (!adapter || !aboEreignisseVon(zeile.plattform).includes(zeile.ereignis)) continue;

        if (zeile.anbieter_abo_id) {
            try {
                if (await adapter.abbestellen(zeile.anbieter_abo_id)) abbestellt++;
            } catch (err) {
                // Zeile stehen lassen: Sonst kennt niemand mehr ein Abo, das
                // bei Twitch weiterlebt und Kontingent kostet.
                Logger.warn(`[Streaming] Abo-Ereignis abbestellen fehlgeschlagen (${zeile.ereignis}): ${err.message}`);
                continue;
            }
        }
        await db().query('DELETE FROM streaming_subscriptions WHERE id = ?', [zeile.id]);
    }

    // **Die Abonnentenliste geht mit.** Sie ohne Zusage weiterzufuehren waere
    // ein Vorrat an Daten, den niemand mehr braucht und niemand mehr pflegt.
    if (abbestellt) {
        await db().query('DELETE FROM streaming_subscribers WHERE streamer_id = ?', [streamerId]);
        Logger.info(`[Streaming] Abonnenten-Ereignisse fuer Streamer ${streamerId} abbestellt (${abbestellt})`);
    }

    return { abbestellt, behalten: false };
}

/**
 * Abos abbestellen, wenn die letzte Guild ihr Ziel entfernt hat.
 *
 * @param {number} streamerId Streamer
 * @returns {Promise<{abbestellt: number, behalten: boolean}>} Ergebnis
 */
async function abosAufraeumen(streamerId) {
    const Logger = ServiceManager.get('Logger');

    if (await nutzerZaehlen(streamerId) > 0) return { abbestellt: 0, behalten: true };

    const zeilen = await db().query(
        'SELECT s.plattform, a.id, a.ereignis, a.anbieter_abo_id FROM streaming_subscriptions a ' +
        'JOIN streaming_streamers s ON s.id = a.streamer_id WHERE a.streamer_id = ?', [streamerId]);

    let abbestellt = 0;

    for (const zeile of zeilen) {
        const adapter = ADAPTER[zeile.plattform];
        if (zeile.anbieter_abo_id && adapter) {
            try {
                if (await adapter.abbestellen(zeile.anbieter_abo_id)) abbestellt++;
            } catch (err) {
                // Die Zeile trotzdem loeschen waere falsch: Dann kennt niemand
                // mehr das Abo, das bei Twitch weiterlebt. Der taegliche
                // Abgleich findet es sonst nie wieder.
                Logger.warn(`[Streaming] Abbestellen fehlgeschlagen (${zeile.ereignis}): ${err.message}`);
                continue;
            }
        }
        await db().query('DELETE FROM streaming_subscriptions WHERE id = ?', [zeile.id]);
    }

    Logger.info(`[Streaming] Streamer ${streamerId} wird von niemandem mehr beobachtet - ${abbestellt} Abo(s) abbestellt`);
    return { abbestellt, behalten: false };
}

module.exports = {
    aboEreignisseVon, aboRollenGewuenscht, aboEreignisseAufraeumen,
    ADAPTER,
    ereignisseVon,
    rueckrufAdresse,
    nutzerZaehlen,
    streamerSichern,
    abosSichern,
    abosAufraeumen
};
