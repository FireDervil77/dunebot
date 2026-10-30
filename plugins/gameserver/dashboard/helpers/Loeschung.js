'use strict';

/**
 * Einen Server löschen — im Hintergrund, mit Sperre (2026-10-30).
 *
 * Betreiber: *„sollte die seite in die übersicht zurück springen und bis zum
 * löschen die zeile auch gesperrt sein in rot, so dass man sehen kann, dass der
 * server gerade gelöscht wird."* Bis dahin wartete die Anfrage bis zu vier
 * Minuten am offenen Fenster (Stopp 150 s, Deinstallation 60 s), und wer es
 * schloss, erfuhr nie, wie es ausging.
 *
 * Die Route nimmt den Auftrag an und antwortet 202; der Rest läuft hier.
 *
 * ── Der Zustand steht am Server, nicht im Speicher ───────────────────
 *
 *   loeschung_seit gesetzt, kein Fehler   läuft
 *   loeschung_seit gesetzt, mit Fehler    gescheitert, der Grund steht sieben
 *                                         Tage in Liste und Serverseite
 *
 * **Das Ventil ist `FRIST_MS`** (wie in ServerState): Startet das Dashboard
 * mitten im Löschen neu, ist der Ablauf weg, die Spalte aber nicht. Nach der
 * Frist gilt der Versuch als abgebrochen, und der Server lässt sich wieder
 * bedienen und erneut löschen. Das darf er auch: Jeder Schritt verträgt die
 * Wiederholung, und nichts wird gelöscht, bevor der Server unten ist.
 *
 * Gesperrt wird an drei Stellen, weil es drei Wege zum Server gibt: `sperre`
 * für die Routen, `IPCServer` für Discord, `cronEntscheidung` für geplante
 * Aufgaben. `ServerStopp` selbst sperrt nichts — das Löschen stoppt darüber.
 */

const { ServiceManager } = require('dunebot-core');

/** Was im Dialog einzutippen ist; die Route prüft es noch einmal. */
const WORT = 'löschen';

/**
 * Stopp 150 s, Deinstallation 60 s, je Datenbank wenige Sekunden: Zehn Minuten
 * erreicht kein lebender Ablauf.
 */
const FRIST_MS = 10 * 60 * 1000;

/** Wie beim Umzug: Ein alter Fehlschlag soll nicht für immer rot stehen. */
const FEHLER_SICHTBAR_MS = 7 * 24 * 3600 * 1000;

const SPALTEN = 'gs.loeschung_seit, gs.loeschung_fehler';

const ABGEBROCHEN = 'Das Löschen wurde nicht zu Ende geführt, vermutlich weil das Dashboard neu gestartet wurde. '
    + 'Der Server steht noch; lösche ihn einfach noch einmal.';

const GESPERRT = 'Dieser Server wird gerade gelöscht.';

const KEINE = Object.freeze({ laeuft: false, fehler: null });

/** Hat jemand das Wort getippt? Großschreibung ist keine Absicht: Handys machen sie von selbst. */
function bestaetigt(eingabe) {
    return String(eingabe ?? '').trim().toLowerCase() === WORT;
}

/**
 * Wie steht es um das Löschen dieses Servers? Reine Rechnung.
 *
 * @param {{loeschung_seit?: Date|string|null, loeschung_fehler?: string|null}} server
 * @returns {{laeuft: boolean, fehler: string|null}}
 */
function stand(server, jetzt = Date.now()) {
    const seit = server?.loeschung_seit ? new Date(server.loeschung_seit).getTime() : NaN;
    if (!Number.isFinite(seit)) return KEINE;
    const alter = jetzt - seit;
    if (!server.loeschung_fehler && alter <= FRIST_MS) return { laeuft: true, fehler: null };
    if (alter > FEHLER_SICHTBAR_MS) return KEINE;
    return { laeuft: false, fehler: server.loeschung_fehler || ABGEBROCHEN };
}

/** Für `router.param('serverId', …)`: Ändern ist gesperrt, Ansehen nicht. */
async function sperre(req, res, next) {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    try {
        const [zeile] = await ServiceManager.get('dbService').query(
            'SELECT loeschung_seit, loeschung_fehler FROM gameservers WHERE id = ?', [req.params.serverId]);
        if (stand(zeile).laeuft) return res.status(409).json({ success: false, message: GESPERRT });
    } catch (err) {
        ServiceManager.get('Logger').warn(`[Gameserver] Löschsperre nicht lesbar: ${err.message}`);
    }
    next();
}

/**
 * Den Auftrag annehmen. Ein UPDATE statt Lesen und Schreiben: Von zwei Klicks
 * gewinnt genau einer.
 *
 * @returns {Promise<boolean>} false: Es läuft schon ein Löschen.
 */
async function beginne(serverId, guildId) {
    const ergebnis = await ServiceManager.get('dbService').query(
        `UPDATE gameservers SET loeschung_seit = NOW(), loeschung_fehler = NULL
          WHERE id = ? AND guild_id = ?
            AND (loeschung_seit IS NULL OR loeschung_fehler IS NOT NULL
                 OR loeschung_seit < NOW() - INTERVAL ${FRIST_MS / 60000} MINUTE)`,
        [serverId, guildId]);
    return ergebnis.affectedRows === 1;
}

/** SSE ist im Betrieb immer da, in einem Prüflauf nicht zwingend. */
function melde(guildId, server, wie, grund = null) {
    if (!ServiceManager.has('sseManager')) return;
    ServiceManager.get('sseManager').broadcast(guildId, 'gameserver', {
        action: 'loeschung',
        server_id: String(server.id),
        name: server.name,
        stand: wie,
        grund,
        timestamp: Date.now(),
    });
}

/**
 * Die Schritte in ihrer Reihenfolge: stoppen, Datenbanken, Dateien, Zeile.
 *
 * @param {{server: object, guildId: string, erzwingen?: boolean}} auftrag
 *        `server` braucht id, status, last_status_update, daemon_id,
 *        rootserver_id, addon_slug
 * @returns {Promise<{ok: boolean, grund?: string}>}
 */
async function ablauf({ server, guildId, erzwingen = false }) {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const ipmServer = ServiceManager.has('ipmServer') ? ServiceManager.get('ipmServer') : null;
    const ServerStopp = require('./ServerStopp');
    const Datenbanken = require('./Datenbanken');

    // ── Läuft er noch? Dann erst stoppen, dann löschen ──────────────────
    //
    // Betreiber, 2026-09-14: „Dass man den Server stoppen muss zum Löschen —
    // das könnte diese Funktion ja auch von alleine machen." Bis dahin wies
    // die Route hier nur ab (Baustelle 115: ein hängendes `starting` machte
    // das Löschen ganz unmöglich).
    //
    // **Gewartet wird auf die Meldung des Daemons, nicht auf die Antwort
    // des Befehls.** Der Daemon reiht den Stopp nur ein, und beim
    // Deinstallieren stoppt er selbst NICHTS — er löscht Volume und
    // Verzeichnis, auch unter einem noch laufenden Container. Deshalb gilt:
    // Kommt der Server nicht sicher herunter, wird nichts gelöscht.
    // Der Ablauf selbst steht seit 2026-09-24 in ServerStopp.stoppeFallsLaeuft
    // — die Neuinstallation braucht denselben (Baustelle 155).
    const stopp = await ServerStopp.stoppeFallsLaeuft({ server, guildId });
    if (!stopp.ok) {
        Logger.warn(`[Gameserver] Löschen von Server ${server.id} abgebrochen: ${stopp.grund}`);
        return { ok: false, grund: `${stopp.grund}. Es wurde nichts gelöscht — der Server bleibt, bis er sicher unten ist.` };
    }

    // Datenbanken zuerst (Stufe 11 S4): Scheitert eine, ist noch nichts
    // gelöscht — der Server bleibt, wie beim Deinstallieren lässt es sich
    // erzwingen. Ohne diesen Schritt blieben Datenbank und Konto im
    // Container stehen, und niemand wüsste mehr von ihnen.
    const dbLoeschung = await Datenbanken.allesLoeschen(
        { id: Number(server.id), daemon_id: server.daemon_id }, { erzwingen });
    if (dbLoeschung.fehler.length && !erzwingen) {
        return { ok: false, grund: `Datenbank nicht gelöscht (${dbLoeschung.fehler.join('; ')}). Server wurde NICHT gelöscht.` };
    }
    // Ab hier sind die Datenbanken weg — scheitert danach die
    // Deinstallation, muss die Meldung das sagen.
    const dbHinweis = dbLoeschung.geloescht.length
        ? ` Die Datenbank(en) ${dbLoeschung.geloescht.join(', ')} sind bereits gelöscht.` : '';

    if (server.daemon_id && ipmServer?.isDaemonOnline(server.daemon_id)) {
        try {
            Logger.info(`[Gameserver] Sende Uninstall-Command an Daemon ${server.daemon_id}`, {
                serverId: server.id, rootserverId: server.rootserver_id });
            const antwort = await ipmServer.sendCommand(server.daemon_id, 'gameserver.uninstall', {
                server_id: String(server.id),
                guild_id: guildId,
                rootserver_id: server.rootserver_id,
                daemon_id: server.daemon_id,
                addon_slug: server.addon_slug,
            }, 60000);
            if (!antwort.success) throw new Error(antwort.error || 'Uninstall fehlgeschlagen');
            Logger.success(`[Gameserver] Server ${server.id} erfolgreich deinstalliert (${antwort.deleted_files || 0} Dateien gelöscht)`);
        } catch (err) {
            Logger.error(`[Gameserver] Daemon-Uninstall fehlgeschlagen: ${err.message}`);
            if (!erzwingen) {
                return { ok: false, grund: `Deinstallation fehlgeschlagen: ${err.message}. Server wurde NICHT aus der Datenbank gelöscht.${dbHinweis}` };
            }
            Logger.warn('[Gameserver] Force-Delete aktiv, lösche aus DB trotz Daemon-Fehler');
        }
    } else {
        Logger.warn(`[Gameserver] Daemon ${server.daemon_id} offline`);
        if (!erzwingen) {
            return { ok: false, grund: `Daemon ist offline. Server kann nicht deinstalliert werden.${dbHinweis}` };
        }
        Logger.warn('[Gameserver] Force-Delete aktiv, lösche aus DB ohne Daemon-Bestätigung');
    }

    await dbService.query(
        'UPDATE port_allocations SET server_id = NULL, assigned_at = NULL WHERE server_id = ?', [server.id]);
    Logger.info(`[Gameserver] Port-Allocations für Server ${server.id} freigegeben`);

    await dbService.query('DELETE FROM gameservers WHERE id = ?', [server.id]);
    Logger.success(`[Gameserver] Server ${server.id} aus DB gelöscht`);

    // Der SFTP-Zugang muss mit dem Server verschwinden. Er lebt in der
    // Datenbank des Daemons weiter und würde sonst weiter angenommen:
    // Der Pfad-Auflöser setzt den Verzeichnisnamen nur zusammen und
    // meldet keinen Fehler, wenn es das Verzeichnis nicht mehr gibt.
    //
    // Der Abgleich schickt den verbliebenen Bestand des Rootservers und
    // löscht dort alles andere — deshalb genügt ein Aufruf ohne
    // eigenen Lösch-Befehl.
    if (server.daemon_id && ipmServer?.isDaemonOnline(server.daemon_id)) {
        ipmServer.syncSftpUsers(server.daemon_id)
            .catch(err => Logger.warn(`[Gameserver] SFTP-Abgleich nach Löschen fehlgeschlagen: ${err.message}`));
    }
    return { ok: true };
}

/**
 * Der Ablauf samt Ausgang. Wirft nie: Die Antwort an den Browser ist längst
 * raus, ein Fehler hier hätte niemanden mehr, der ihn fängt.
 *
 * Gescheitert heißt: Grund am Server festhalten, die Sperre fällt damit.
 */
async function fuehreAus(auftrag) {
    const { server, guildId } = auftrag;
    const Logger = ServiceManager.get('Logger');

    let ergebnis;
    try {
        melde(guildId, server, 'laeuft');
        ergebnis = await ablauf(auftrag);
    } catch (err) {
        Logger.error(`[Gameserver] Fehler beim Löschen von Server ${server.id}:`, err);
        ergebnis = { ok: false, grund: `Interner Fehler beim Löschen: ${err.message}` };
    }

    try {
        if (!ergebnis.ok) {
            await ServiceManager.get('dbService').query(
                'UPDATE gameservers SET loeschung_fehler = ? WHERE id = ?', [ergebnis.grund, server.id]);
        }
        melde(guildId, server, ergebnis.ok ? 'fertig' : 'gescheitert', ergebnis.grund || null);
    } catch (err) {
        // Dann greift die Frist: Nach zehn Minuten gilt das Löschen als abgebrochen.
        Logger.error(`[Gameserver] Ausgang des Löschens von Server ${server.id} nicht festgehalten:`, err);
    }
    return ergebnis;
}

module.exports = {
    WORT, FRIST_MS, SPALTEN, GESPERRT,
    bestaetigt, stand, sperre, beginne, ablauf, fuehreAus,
};
