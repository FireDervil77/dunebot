/**
 * Öffentliche Statusseite eines Gameservers (E5)
 *
 * Diese Routen sind **ohne Anmeldung** erreichbar – sie hängen am `apiRouter`
 * bzw. `frontendRouter` des Plugins, nicht am guildRouter. Entsprechend
 * vorsichtig ist alles gebaut:
 *
 *   - Zugang nur über ein Token, das der Betreiber je Server ausdrücklich
 *     einschaltet. Kein Token, keine Seite.
 *   - Ausgeliefert wird ausschließlich das Anzeigemodell aus `PublicStatus`.
 *   - Keine Auskunft darüber, ob ein Token existiert, aber abgeschaltet ist:
 *     In beiden Fällen 404. Sonst ließe sich der Bestand abklopfen.
 *   - Eigene Bremse, weil hier jeder anklopfen kann.
 *
 * @module routes/public
 */

'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { ServiceManager } = require('dunebot-core');
const { resolveStatusConfig } = require('../helpers/StatusSchema');
const { baueAntwort } = require('../helpers/PublicStatus');

const router = express.Router();

/**
 * 60 Abrufe je Minute und IP. Großzügig genug für eine Website, die alle 30 s
 * aktualisiert, und eng genug, dass niemand den Endpunkt als Datenquelle
 * missbraucht.
 */
const bremse = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Zu viele Anfragen' },
});

/**
 * Lädt Server und Snapshot zu einem Token.
 *
 * @param {string} token
 * @returns {Promise<{server: object, snapshot: object, display: object}|null>}
 */
async function ladeStatus(token) {
    const dbService = ServiceManager.get('dbService');

    const [server] = await dbService.query(
        `SELECT gs.id, gs.name, gs.status, gs.public_status_players,
                am.name AS game_name,
                COALESCE(am.game_data, gs.frozen_game_data) AS game_data
         FROM gameservers gs
         LEFT JOIN addon_marketplace am ON gs.addon_marketplace_id = am.id
         WHERE gs.public_status_token = ? AND gs.public_status_enabled = 1
         LIMIT 1`,
        [token]
    );
    if (!server) return null;

    const [roh] = await dbService.query(
        `SELECT online, players_current, players_max, map, version, ping_ms,
                players_json, extra_json, source, queried_at
         FROM gameserver_status WHERE server_id = ? LIMIT 1`,
        [server.id]
    );

    const parse = (wert) => {
        if (!wert) return null;
        if (typeof wert === 'string') { try { return JSON.parse(wert); } catch (_) { return null; } }
        return wert;
    };

    const snapshot = roh ? {
        ...roh,
        players: parse(roh.players_json) || [],
        extra:   parse(roh.extra_json) || {},
    } : null;

    const gameData = typeof server.game_data === 'string'
        ? (() => { try { return JSON.parse(server.game_data); } catch (_) { return {}; } })()
        : (server.game_data || {});

    return { server, snapshot, display: resolveStatusConfig(gameData).display };
}

/**
 * GET /api/gameserver/status/:token
 * Öffentlicher Serverstatus als JSON.
 */
router.get('/status/:token', bremse, async (req, res) => {
    const Logger = ServiceManager.get('Logger');

    // Von fremden Websites aus aufrufbar – das ist der Zweck. Nur Lesezugriff,
    // keine Cookies, keine Anmeldung: Es gibt nichts zu entführen.
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cache-Control', 'public, max-age=15');

    // Helmet setzt global `Cross-Origin-Resource-Policy: same-origin`. Der
    // Header hat mit CORS nichts zu tun und wirkt zusätzlich: Er verbietet
    // fremden Seiten, die Ressource zu laden – auch dann, wenn CORS es erlaubt.
    // Für einen ausdrücklich öffentlichen Endpunkt ist das genau falsch herum.
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');

    try {
        const daten = await ladeStatus(req.params.token);
        if (!daten) {
            return res.status(404).json({ error: 'Nicht gefunden' });
        }

        return res.json(baueAntwort(daten));

    } catch (error) {
        Logger.error('[Gameserver] Öffentlicher Status fehlgeschlagen:', error);
        return res.status(500).json({ error: 'Interner Fehler' });
    }
});

module.exports = router;
