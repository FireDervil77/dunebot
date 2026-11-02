'use strict';

const { EventEmitter } = require('events');
const WebSocket = require('ws');

/**
 * Das Dock am Busbahnhof (FireBus Etappe 4, `internal/bahnhof` im Daemon).
 *
 * Die Leitungen der Daemons enden im Bahnhof, das Dashboard hängt an einem lokalen
 * Socket. Jede Leitung kommt hier als `DockLeitung` an und läuft durch denselben
 * `_handleConnection` wie eine direkte: Der Code dahinter merkt keinen Unterschied.
 *
 * Solange noch Daemons direkt verbinden, laufen beide Wege nebeneinander. Das ist der
 * Übergang, zuerst zieht nur Maschine 55 um.
 *
 * Eingeschaltet wird das Dock über `FIREBUS_DOCK` mit dem Pfad des Sockets. Fehlt der
 * Bahnhof, versucht es das Dock alle paar Sekunden weiter, direkte Leitungen stört das nicht.
 */

const NEUER_VERSUCH_MS = 2000;
const MAX_RAHMEN_BYTES = 8 * 1024 * 1024;

/** Sieht für `_handleConnection` aus wie ein WebSocket. */
class DockLeitung extends EventEmitter {
    constructor(dock, kanal) {
        super();
        this.dock = dock;
        this.kanal = kanal;
        this.zu = false;
    }

    send(text) {
        if (!this.zu) this.dock.sende({ k: this.kanal, a: 'daten', d: String(text) });
    }

    /** Schließt die Leitung beim Bahnhof: Der Daemon verbindet sich dann neu. */
    close(code = 1000) {
        if (!this.dock.beendet) this.dock.sende({ k: this.kanal, a: 'zu', code });
        this.geschlossen();
    }

    geschlossen() {
        if (this.zu) return;
        this.zu = true;
        this.dock.leitungen.delete(this.kanal);
        this.emit('close');
    }
}

class BusDock {
    /**
     * @param {{_handleConnection: Function, Logger: object}} ipm
     * @param {string} pfad Socket des Bahnhofs
     */
    constructor(ipm, pfad) {
        this.ipm = ipm;
        this.pfad = pfad;
        this.leitungen = new Map();
        this.socket = null;
        this.beendet = false;
        this.gemeldet = false;
    }

    starte() {
        this._verbinde();
    }

    /** Beim Herunterfahren: Die Leitungen bleiben beim Bahnhof offen, das ist sein Zweck. */
    beende() {
        this.beendet = true;
        clearTimeout(this.wartet);
        this.socket?.close();
    }

    sende(rahmen) {
        if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(rahmen));
    }

    _verbinde() {
        if (this.beendet) return;
        const socket = new WebSocket(`ws+unix://${this.pfad}:/dock`, { maxPayload: MAX_RAHMEN_BYTES, perMessageDeflate: false });
        this.socket = socket;

        socket.on('open', () => {
            this.gemeldet = false;
            this.ipm.Logger.info('[BusDock] Am Bahnhof angedockt');
        });
        socket.on('message', (daten) => {
            try {
                this._nimm(JSON.parse(daten.toString()));
            } catch (fehler) {
                this.ipm.Logger.error('[BusDock] Rahmen nicht lesbar:', fehler);
            }
        });
        socket.on('error', (fehler) => {
            // Einmal melden, nicht alle zwei Sekunden: `close` folgt ohnehin.
            if (!this.gemeldet) this.ipm.Logger.warn(`[BusDock] Bahnhof nicht erreichbar: ${fehler.message}`);
            this.gemeldet = true;
        });
        socket.on('close', () => {
            // Ohne Dock gibt es keinen Weg zu diesen Daemons, das sagt die Trennung.
            if (!this.beendet) for (const leitung of [...this.leitungen.values()]) leitung.geschlossen();
            if (!this.beendet) this.wartet = setTimeout(() => this._verbinde(), NEUER_VERSUCH_MS);
        });
    }

    _nimm({ k, a, d, ip }) {
        if (a === 'auf') {
            const leitung = new DockLeitung(this, k);
            this.leitungen.set(k, leitung);
            this.ipm._handleConnection(leitung, { headers: { 'x-forwarded-for': ip }, socket: { remoteAddress: ip } });
        } else if (a === 'daten') {
            this.leitungen.get(k)?.emit('message', Buffer.from(d));
        } else if (a === 'zu') {
            this.leitungen.get(k)?.geschlossen();
        }
    }
}

module.exports = BusDock;
