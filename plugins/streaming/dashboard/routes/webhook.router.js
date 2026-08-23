'use strict';

/**
 * Streaming - der Eingang.
 *
 * Erreichbar unter `/api/streaming/webhook` (der Kern-Mount reicht hierher
 * durch und legt den unveraenderten Koerper als `req.rawBody` bei).
 *
 * **Die eine Regel, die alles andere schlaegt:**
 *
 *     annehmen -> pruefen -> wegschreiben -> 2xx -> ERST DANN arbeiten
 *
 * Nie Discord anrufen, nie anreichern, nie IPC sprechen, bevor geantwortet
 * wurde. Twitch widerruft bei zu vielen langsamen Antworten das Abo — und zwar
 * das eine, globale, an dem **alle** Guilds haengen. Ein paar Stunden
 * Verzoegerung reissen die Ankuendigungen aller Kunden mit, und danach ist
 * einfach Stille.
 *
 * Deshalb endet dieser Router nach `res.status(204).end()`. Die Verarbeitung
 * uebernimmt der Takt des Kerns (Stufe 3).
 *
 * @module streaming/dashboard/routes/webhook
 */

const express = require('express');
const router = express.Router();
const { ServiceManager } = require('dunebot-core');
const twitch = require('../plattformen/twitch');

/**
 * @returns {Object} Datenbankdienst
 */
function db() {
    return ServiceManager.get('dbService');
}

/**
 * Das Geheimnis dieses Abos holen.
 *
 * Der Koerper ist an dieser Stelle **unbestaetigt** - er wird ausschliesslich
 * zum Nachschlagen benutzt. Ueber die Echtheit entscheidet danach die
 * Signatur, nicht dieser Datensatz.
 *
 * @param {Object} koerper Geparster Koerper
 * @returns {Promise<Object|null>} Abo-Zeile oder null
 */
async function aboFinden(koerper) {
    const aboId = koerper?.subscription?.id;
    if (aboId) {
        const zeilen = await db().query(
            'SELECT * FROM streaming_subscriptions WHERE anbieter_abo_id = ? LIMIT 1', [aboId]);
        if (zeilen.length) return zeilen[0];
    }

    // Bei der Bestaetigungsanfrage kennen wir die Abo-Kennung unter Umstaenden
    // noch nicht - dann ueber Kanal und Ereignistyp.
    const kanal = koerper?.subscription?.condition?.broadcaster_user_id;
    const typ = koerper?.subscription?.type;
    if (!kanal || !typ) return null;

    const zeilen = await db().query(`
        SELECT a.* FROM streaming_subscriptions a
        JOIN streaming_streamers s ON s.id = a.streamer_id
        WHERE s.plattform = 'twitch' AND s.kanal_id = ? AND a.ereignis = ?
        LIMIT 1
    `, [String(kanal), String(typ)]);

    return zeilen.length ? zeilen[0] : null;
}

router.post('/', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const beginn = process.hrtime.bigint();

    /**
     * Ablehnen — mit Grund im Log. Ohne das ist ein Fehlschlag nicht von einem
     * Angriff zu unterscheiden.
     *
     * @param {number} code HTTP-Status
     * @param {string} grund Klartext
     * @returns {*} Antwort
     */
    const ablehnen = (code, grund) => {
        Logger.warn(`[Streaming/Eingang] abgelehnt (${code}): ${grund} — von ${req.ip}`);
        return res.status(code).end();
    };

    try {
        const kopf = req.headers;
        const art = twitch.einordnen(kopf);

        if (art === 'unbekannt') return ablehnen(400, `unbekannte Nachrichtenart "${kopf['twitch-eventsub-message-type']}"`);
        if (!req.rawBody?.length)  return ablehnen(400, 'leerer Koerper');
        if (!req.body)             return ablehnen(400, 'Koerper ist kein JSON');
        if (twitch.zuAlt(kopf))    return ablehnen(403, 'Zeitstempel zu alt oder fehlt');

        const abo = await aboFinden(req.body);
        if (!abo) return ablehnen(404, `kein Abo zu subscription.id=${req.body?.subscription?.id}`);

        if (!twitch.signaturPruefen(kopf, req.rawBody, abo.geheimnis)) {
            return ablehnen(403, `Signatur ungueltig (Abo ${abo.id})`);
        }

        // ---------------------------------------------------------------
        // Ab hier ist die Zustellung echt.
        // ---------------------------------------------------------------

        if (art === 'bestaetigung') {
            // Rohtext, kein JSON: `res.json(challenge)` schickt Anfuehrungs-
            // zeichen mit und laesst die Bestaetigung scheitern.
            const challenge = String(req.body.challenge || '');
            res.status(200).type('text/plain').send(challenge);

            await db().query(
                `UPDATE streaming_subscriptions
                    SET zustand = 'bestaetigt', anbieter_abo_id = COALESCE(?, anbieter_abo_id),
                        fehlertext = NULL
                  WHERE id = ?`,
                [req.body?.subscription?.id || null, abo.id]);

            Logger.success(`[Streaming/Eingang] Abo ${abo.id} bestaetigt (${abo.ereignis})`);
            return;
        }

        if (art === 'widerruf') {
            res.status(204).end();

            const grund = req.body?.subscription?.status || 'unbekannt';
            await db().query(
                `UPDATE streaming_subscriptions SET zustand = 'widerrufen', fehlertext = ? WHERE id = ?`,
                [grund, abo.id]);

            // Kein Randfall: Das ist der Zustand, in dem stillschweigend nichts
            // mehr passiert. Er muss laut sein.
            Logger.error(`[Streaming/Eingang] Twitch hat Abo ${abo.id} WIDERRUFEN (${abo.ereignis}): ${grund}`);
            return;
        }

        // --- Ereignis: wegschreiben, antworten, fertig ---
        const msgId = String(kopf['twitch-eventsub-message-id']);

        try {
            await db().query(
                `INSERT INTO streaming_events (plattform, anbieter_msg_id, ereignis, nutzlast)
                 VALUES ('twitch', ?, ?, ?)`,
                [msgId, String(kopf['twitch-eventsub-subscription-type'] || ''), JSON.stringify(req.body)]);
        } catch (e) {
            if (e.code === 'ER_DUP_ENTRY') {
                // Twitch stellt ausdruecklich "mindestens einmal" zu.
                // Mehrfachzustellung ist Normalbetrieb, kein Fehler.
                res.status(204).end();
                await db().query(
                    `UPDATE streaming_events SET zustand = 'dublette'
                      WHERE plattform = 'twitch' AND anbieter_msg_id = ? AND zustand = 'neu'`, [msgId]);
                Logger.debug(`[Streaming/Eingang] Dublette ${msgId}`);
                return;
            }
            throw e;
        }

        res.status(204).end();

        await db().query(
            'UPDATE streaming_subscriptions SET letzte_meldung_am = NOW() WHERE id = ?', [abo.id]);

        const ms = Number(process.hrtime.bigint() - beginn) / 1e6;
        Logger.info(`[Streaming/Eingang] ${kopf['twitch-eventsub-subscription-type']} angenommen in ${ms.toFixed(1)} ms`);
    } catch (error) {
        Logger.error('[Streaming/Eingang] Fehler:', error);
        if (!res.headersSent) res.status(500).end();
    }
});

// Ein GET auf den Eingang ist kein Fehler, sondern ein Scanner oder ein
// neugieriger Mensch. Kurz und ohne Auskunft.
router.get('/', (req, res) => res.status(405).type('text/plain').send('POST only'));

module.exports = router;
