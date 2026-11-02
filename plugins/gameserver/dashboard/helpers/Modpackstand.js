'use strict';

const { ServiceManager } = require('dunebot-core');

/**
 * Wird auf diesem Server gerade ein Modpack eingespielt? (2026-11-02, B218)
 *
 * Solange Dateien getauscht werden, darf niemand starten, und alle Tabs sollen
 * es sehen, nicht nur der, der es angestoßen hat. Gebaut wie `Loeschung.js`: Der
 * Zustand steht in der Zeile, überlebt also einen Seitenwechsel.
 *
 * Die Frist liegt knapp über der des Befehls (30 Minuten): Bleibt ein Eintrag nach
 * einem Abbruch stehen, sperrt er nicht für immer.
 */
const FRIST_MS = 31 * 60 * 1000;

const SPALTEN = 'gs.modpack_seit, gs.modpack_name';

const GESPERRT = 'Das Modpack wird gerade eingespielt, das geht gleich wieder.';

const KEINE = Object.freeze({ laeuft: false, name: null, seit: null });

/**
 * Reine Rechnung.
 *
 * @param {{modpack_seit?: Date|string|null, modpack_name?: string|null}} server
 * @returns {{laeuft: boolean, name: string|null, seit: Date|string|null}}
 */
function stand(server, jetzt = Date.now()) {
    const seit = server?.modpack_seit ? new Date(server.modpack_seit).getTime() : NaN;
    if (!Number.isFinite(seit) || jetzt - seit > FRIST_MS) return KEINE;
    return { laeuft: true, name: server.modpack_name || null, seit: server.modpack_seit };
}

/** Für Routen, die ändern: Lesen und Stoppen bleiben möglich. */
async function sperre(req, res, next) {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    try {
        const [zeile] = await ServiceManager.get('dbService').query(
            'SELECT modpack_seit, modpack_name FROM gameservers WHERE id = ?', [req.params.serverId]);
        if (stand(zeile).laeuft) return res.status(409).json({ success: false, message: GESPERRT });
    } catch (err) {
        ServiceManager.get('Logger').warn(`[Gameserver] Modpack-Sperre nicht lesbar: ${err.message}`);
    }
    next();
}

function melde(guildId, serverId, wie, name) {
    if (!ServiceManager.has('sseManager')) return;
    ServiceManager.get('sseManager').broadcast(guildId, 'gameserver', {
        action: 'modpack', server_id: String(serverId), stand: wie, name, timestamp: Date.now(),
    });
}

/**
 * Den Vorgang annehmen. Ein UPDATE statt Lesen und Schreiben: Von zwei Klicks
 * gewinnt genau einer.
 *
 * @returns {Promise<boolean>} false: Es läuft schon eines.
 */
async function beginne(serverId, guildId, name) {
    const ergebnis = await ServiceManager.get('dbService').query(
        `UPDATE gameservers SET modpack_seit = NOW(), modpack_name = ?
          WHERE id = ? AND guild_id = ?
            AND (modpack_seit IS NULL OR modpack_seit < NOW() - INTERVAL ${FRIST_MS / 60000} MINUTE)`,
        [String(name).slice(0, 190), serverId, guildId]);
    if (ergebnis.affectedRows !== 1) return false;
    melde(guildId, serverId, 'laeuft', name);
    return true;
}

async function beende(serverId, guildId, name) {
    await ServiceManager.get('dbService').query(
        'UPDATE gameservers SET modpack_seit = NULL, modpack_name = NULL WHERE id = ?', [serverId]);
    melde(guildId, serverId, 'fertig', name);
}

/** Beim Start: Der Vorgang lief im vorigen Prozess, niemand beendet ihn mehr. */
async function nachNeustart(dbService) {
    await dbService.query('UPDATE gameservers SET modpack_seit = NULL, modpack_name = NULL WHERE modpack_seit IS NOT NULL');
}

module.exports = { FRIST_MS, SPALTEN, GESPERRT, stand, sperre, beginne, beende, nachNeustart };
