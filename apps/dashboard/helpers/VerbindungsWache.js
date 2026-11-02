'use strict';

const net = require('net');
const { execFile } = require('child_process');
const { ServiceManager } = require('dunebot-core');

/** So lange darf ein Daemon weg sein, bevor das Panel es als Ausfall zeigt. */
const GNADENFRIST_MS = 30 * 1000;
/** Ein angekündigter Neustart, etwa ein Update, darf länger dauern. */
const ANKUENDIGUNG_MS = 3 * 60 * 1000;
/** Daemon oder Maschine: Das kann sich ändern, solange die Leitung fehlt. */
const NACHPRUEFEN_MS = 60 * 1000;
const PROBE_MS = 3000;

const STELLEN = new Set(['running', 'starting', 'online']);

/**
 * Führt je Maschine, wie die Leitung steht (2026-11-02, F15).
 *
 * Ein Abriss ist noch kein Ausfall: Das Dashboard startet oft neu, und der Daemon
 * ist nach Sekunden zurück. Erst nach der Gnadenfrist klopft die Wache selbst an
 * die Maschine, denn ein stiller Daemon sagt nichts über die Spieler.
 *
 *   da → neu_verbinden → daemon_weg oder maschine_weg → da
 *   da → angekuendigt  → da
 *
 * Etappe 4 ruft dieselben Einstiege aus dem Bahnhof. `getrennt` heißt dann: Alle
 * drei Leitungen sind weg.
 */
class VerbindungsWache {
    /**
     * @param {object} abhaengig
     * @param {Function} abhaengig.istVerbunden `daemonId → boolean`
     * @param {Function} [abhaengig.db] für den Wächter
     * @param {Function} [abhaengig.pruefe] `({host, ports}) → Promise<boolean>`
     * @param {Function} [abhaengig.jetzt]
     */
    constructor({ istVerbunden, db, pruefe, jetzt }) {
        this.istVerbunden = istVerbunden;
        this.db = db || (() => ServiceManager.get('dbService'));
        this.pruefe = pruefe || VerbindungsWache.maschineAntwortet;
        this.jetzt = jetzt || Date.now;
        this.uhren = new Map();
        this.angekuendigt = new Map();
        this.nachAusfall = new Set();
    }

    /** Beim Start des Dashboards: Niemand ist verbunden, alle bekommen ihre Frist. */
    async beimStart() {
        await this.db().query(
            `UPDATE rootserver SET verbindung = 'neu_verbinden', verbindung_seit = NOW()
              WHERE verbindung = 'da' AND daemon_id IS NOT NULL`);
        const zeilen = await this.db().query(
            "SELECT daemon_id FROM rootserver WHERE verbindung <> 'da' AND daemon_id IS NOT NULL");
        for (const z of zeilen || []) this._plane(z.daemon_id, GNADENFRIST_MS);
    }

    beende() {
        for (const uhr of this.uhren.values()) clearTimeout(uhr);
        this.uhren.clear();
    }

    /** Der nächste Abriss dieses Daemons ist gewollt, etwa ein Update. */
    kuendigeAn(daemonId) {
        this.angekuendigt.set(daemonId, this.jetzt() + ANKUENDIGUNG_MS);
    }

    _istAngekuendigt(daemonId) {
        return (this.angekuendigt.get(daemonId) || 0) > this.jetzt();
    }

    /** Die letzte Leitung des Daemons ist weg. */
    async getrennt(daemonId) {
        const gewollt = this._istAngekuendigt(daemonId);
        await this._setze(daemonId, gewollt ? 'angekuendigt' : 'neu_verbinden');
        this._plane(daemonId, gewollt ? ANKUENDIGUNG_MS : GNADENFRIST_MS);
    }

    /** Der Daemon ist angemeldet. */
    async angemeldet(daemonId) {
        this._halte(daemonId);
        this.angekuendigt.delete(daemonId);
        const m = await this._maschine(daemonId);
        if (!m) return;
        if (m.verbindung === 'daemon_weg' || m.verbindung === 'maschine_weg') {
            this.nachAusfall.add(daemonId);
        }
        await this._setze(daemonId, 'da');
    }

    /**
     * Der erste Herzschlag nach einem Ausfall trägt, was der Daemon wirklich hat.
     *
     * Ein Neustart der Maschine beendet die Spiele, und niemand meldet das: 7 Days
     * stand am 2026-11-02 danach weiter auf `online`. Wer laut Panel lief und nicht
     * als laufend gemeldet wird, hat den Ausfall nicht überlebt. Das Anhängen an
     * laufende Container geschieht im Daemon schon bei der Anmeldung, davor kommt
     * also kein Herzschlag.
     *
     * @param {string} daemonId
     * @param {Array<{server_id: *, status?: string}>} gemeldet
     */
    async herzschlag(daemonId, gemeldet) {
        if (!this.nachAusfall.delete(daemonId)) return;
        const m = await this._maschine(daemonId);
        if (!m) return;

        const laeuft = new Set(gemeldet.filter(s => STELLEN.has(s.status)).map(s => String(s.server_id)));
        const zeilen = await this.db().query(
            `SELECT id, name, guild_id FROM gameservers
              WHERE rootserver_id = ? AND status IN ('online', 'starting', 'stopping')`, [m.id]);

        for (const z of zeilen || []) {
            if (laeuft.has(String(z.id))) continue;
            await this.db().query(
                `UPDATE gameservers
                    SET status = 'offline', last_status_update = NOW(), laeuft_seit = NULL,
                        last_crash_reason = ?, last_crash_at = NOW()
                  WHERE id = ? AND status IN ('online', 'starting', 'stopping')`,
                [require('../../../plugins/gameserver/dashboard/helpers/Verbindung').AUSFALL_GRUND, z.id]);
            ServiceManager.get('Logger').warn(`[Verbindung] ${z.name} (${z.id}) hat den Ausfall nicht überlebt`);
            this._sende(z.guild_id, { action: 'status_changed', server_id: z.id, status: 'offline' });
        }
    }

    _halte(daemonId) {
        clearTimeout(this.uhren.get(daemonId));
        this.uhren.delete(daemonId);
    }

    _plane(daemonId, ms) {
        this._halte(daemonId);
        const uhr = setTimeout(() => {
            this._pruefeNach(daemonId).catch(fehler =>
                ServiceManager.get('Logger').error('[Verbindung] Nachprüfen gescheitert', fehler));
        }, ms);
        if (uhr.unref) uhr.unref();
        this.uhren.set(daemonId, uhr);
    }

    /** Die Frist ist um, oder es wird erneut nachgesehen. */
    async _pruefeNach(daemonId) {
        this.uhren.delete(daemonId);
        if (this.istVerbunden(daemonId)) return;

        const m = await this._maschine(daemonId);
        if (!m) return;
        const antwortet = await this.pruefe({ host: m.host, ports: [22, m.sftp_port, m.abruf_port].filter(Boolean) });
        if (this.istVerbunden(daemonId)) return;

        await this._setze(daemonId, antwortet ? 'daemon_weg' : 'maschine_weg');
        this._plane(daemonId, NACHPRUEFEN_MS);
    }

    async _maschine(daemonId) {
        const [m] = await this.db().query(
            `SELECT id, guild_id, name, host, sftp_port, abruf_port, verbindung, verbindung_seit
               FROM rootserver WHERE daemon_id = ?`, [daemonId]);
        return m || null;
    }

    /** Schreibt nur eine Änderung, und `seit` bleibt der Beginn des Ausfalls. */
    async _setze(daemonId, verbindung) {
        const m = await this._maschine(daemonId);
        if (!m || m.verbindung === verbindung) return;

        const da = verbindung === 'da';
        await this.db().query(
            `UPDATE rootserver
                SET verbindung = ?, verbindung_seit = ${da ? 'NULL' : 'COALESCE(verbindung_seit, NOW())'}
              WHERE id = ?`, [verbindung, m.id]);

        ServiceManager.get('Logger').info(`[Verbindung] ${m.name}: ${m.verbindung} → ${verbindung}`);
        this._sende(m.guild_id, { action: 'verbindung', daemon_id: daemonId, rootserver_id: m.id, verbindung });
    }

    _sende(guildId, nutzlast) {
        if (!guildId || !ServiceManager.has('sseManager')) return;
        ServiceManager.get('sseManager').broadcast(guildId, 'gameserver', { ...nutzlast, timestamp: this.jetzt() });
    }

    /**
     * Antwortet die Maschine, auch ohne Daemon?
     *
     * Ein abgewiesener Port zählt als Antwort: Abweisen kann nur, wer läuft. SFTP
     * und der Abruf hängen selbst am Daemon, deshalb reicht ihr Schweigen nicht,
     * und Ping und Port 22 fragen mit.
     *
     * @param {{host: string, ports: number[]}} ziel
     * @returns {Promise<boolean>}
     */
    static async maschineAntwortet({ host, ports }) {
        if (!/^[\w.:-]+$/.test(String(host || ''))) return false;

        const klopfe = (port) => new Promise((fertig) => {
            const s = net.connect({ host, port, timeout: PROBE_MS });
            const ende = (ja) => { s.destroy(); fertig(ja); };
            s.once('connect', () => ende(true));
            s.once('timeout', () => ende(false));
            s.once('error', (fehler) => ende(fehler.code === 'ECONNREFUSED'));
        });
        const pinge = () => new Promise((fertig) => {
            execFile('ping', ['-c', '2', '-W', '2', host], { timeout: PROBE_MS * 2 }, fehler => fertig(!fehler));
        });

        const antworten = await Promise.all([pinge(), ...ports.map(klopfe)]);
        return antworten.some(Boolean);
    }
}

module.exports = VerbindungsWache;
module.exports.GNADENFRIST_MS = GNADENFRIST_MS;
module.exports.NACHPRUEFEN_MS = NACHPRUEFEN_MS;
