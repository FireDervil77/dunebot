'use strict';

const { ServiceManager } = require('dunebot-core');
const ServerStopp = require('./ServerStopp');

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

const KEINE = Object.freeze({ laeuft: false, name: null, seit: null, fortschritt: null });

/** So oft geht ein Fortschritt an die Browser. Der Daemon drosselt selbst, das Entfernen nicht. */
const FORTSCHRITT_TAKT_MS = 500;

/**
 * Laufende Vorgänge dieses Prozesses, serverId → { guildId, fortschritt, gemeldet }.
 * Nur im Speicher: Ein Fortschritt ist nach Sekunden überholt, und ein Neustart
 * beendet den Vorgang hier ohnehin (`nachNeustart`).
 */
const laufend = new Map();

/**
 * Reine Rechnung.
 *
 * @param {{modpack_seit?: Date|string|null, modpack_name?: string|null}} server
 * @returns {{laeuft: boolean, name: string|null, seit: Date|string|null}}
 */
function stand(server, jetzt = Date.now()) {
    const seit = server?.modpack_seit ? new Date(server.modpack_seit).getTime() : NaN;
    if (!Number.isFinite(seit) || jetzt - seit > FRIST_MS) return KEINE;
    return {
        laeuft: true,
        name: server.modpack_name || null,
        seit: server.modpack_seit,
        fortschritt: laufend.get(String(server.id))?.fortschritt || null,
    };
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

function melde(guildId, serverId, wie, name, ergebnis = null) {
    if (!ServiceManager.has('sseManager')) return;
    ServiceManager.get('sseManager').broadcast(guildId, 'gameserver', {
        action: 'modpack', server_id: String(serverId), stand: wie, name, ergebnis, timestamp: Date.now(),
    });
}

/**
 * Wie weit ist der Vorgang? Kommt vom Daemon (`mods`, `beigaben`, `paket`) und vom
 * Dashboard selbst (`stoppen`, `entfernen`, `abgleich`). Ohne laufenden Vorgang verfällt es:
 * So landet eine nachgelieferte Meldung des Daemons nicht in der Anzeige.
 *
 * @param {string|number} serverId
 * @param {{phase: string, fertig?: number, gesamt?: number}} teil
 */
function fortschritt(serverId, { phase, fertig = 0, gesamt = 0 }) {
    const vorgang = laufend.get(String(serverId));
    if (!vorgang) return;
    const jetzt = Date.now();
    const neuePhase = vorgang.fortschritt?.phase !== phase;
    vorgang.fortschritt = { phase, fertig, gesamt };
    if (!neuePhase && fertig < gesamt && jetzt - vorgang.gemeldet < FORTSCHRITT_TAKT_MS) return;
    vorgang.gemeldet = jetzt;
    if (!ServiceManager.has('sseManager')) return;
    ServiceManager.get('sseManager').broadcast(vorgang.guildId, 'gameserver', {
        action: 'modpack_stand', server_id: String(serverId), phase, fertig, gesamt, timestamp: jetzt,
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
    laufend.set(String(serverId), { guildId, fortschritt: null, gemeldet: 0 });
    melde(guildId, serverId, 'laeuft', name);
    return true;
}

/**
 * @param {string|number} serverId
 * @param {string} guildId
 * @param {string} name
 * @param {object} [ergebnis] Geht an die Browser, sie sagen damit, wie es ausging.
 */
async function beende(serverId, guildId, name, ergebnis = null) {
    laufend.delete(String(serverId));
    await ServiceManager.get('dbService').query(
        'UPDATE gameservers SET modpack_seit = NULL, modpack_name = NULL WHERE id = ?', [serverId]);
    melde(guildId, serverId, 'fertig', name, ergebnis);
}

/**
 * Erst stoppen, dann `arbeit`. Ein Modpack tauscht die Dateien unter dem Server,
 * dafür gilt dieselbe Regel wie beim Neuinstallieren (`ServerStopp.stoppeFallsLaeuft`).
 * Bis zum 2026-11-02 lief Java weiter, während 292 Jars eines alten Pakets gingen.
 *
 * Der Status wird hier frisch gelesen: Zwischen Klick und Vorgang kann der Server
 * gestartet sein. Er bleibt danach aus, wie nach der Neuinstallation. Kommt er nicht
 * sicher herunter, wird nichts angefasst.
 *
 * @param {string|number} serverId
 * @param {string} guildId
 * @param {() => Promise<object>} arbeit
 * @returns {Promise<object>} Das Ergebnis von `arbeit`, dazu `gestoppt`.
 */
async function nachStopp(serverId, guildId, arbeit) {
    const [server] = await ServiceManager.get('dbService').query(
        `SELECT gs.*, r.daemon_id
           FROM gameservers gs
           LEFT JOIN rootserver r ON gs.rootserver_id = r.id
          WHERE gs.id = ? AND gs.guild_id = ?`,
        [serverId, guildId]);
    if (!server) return { success: false, fehler: 'Der Server ist nicht mehr vorhanden.' };

    if (server.status !== 'offline') fortschritt(serverId, { phase: 'stoppen' });
    const stopp = await ServerStopp.stoppeFallsLaeuft({ server, guildId });
    if (!stopp.ok) return { success: false, fehler: `${stopp.grund}. Es wurde nichts eingespielt.` };

    return { ...await arbeit(), gestoppt: Boolean(stopp.gestoppt) };
}

/** Beim Start: Der Vorgang lief im vorigen Prozess, niemand beendet ihn mehr. */
async function nachNeustart(dbService) {
    await dbService.query('UPDATE gameservers SET modpack_seit = NULL, modpack_name = NULL WHERE modpack_seit IS NOT NULL');
}

module.exports = { FRIST_MS, SPALTEN, GESPERRT, stand, sperre, beginne, beende, fortschritt, nachStopp, nachNeustart };
