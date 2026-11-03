'use strict';

const { EventEmitter } = require('events');
const WebSocket = require('ws');
const firebus = require('../../../packages/firebus');

/**
 * Das Dock am Busbahnhof (FireBus Etappe 4, `internal/bahnhof` im Daemon).
 *
 * Die Leitungen der Daemons enden im Bahnhof, das Dashboard hängt an einem lokalen
 * Socket. Jede Leitung kommt hier als `DockLeitung` an und läuft durch denselben
 * `_handleConnection` wie eine direkte: Der Code dahinter merkt keinen Unterschied.
 *
 * Seit 2026-11-03 ist das der einzige Weg zu den Daemons, der WebSocket-Server auf 9340
 * ist abgeschaltet. Der Pfad des Sockets kommt aus `FIREBUS_DOCK`. Fehlt der Bahnhof,
 * versucht es das Dock alle paar Sekunden weiter.
 *
 * Reißt das Dock, tragen die Leitungen `bahnhofWeg`: Ihre Daemons laufen weiter, nur der
 * Weg zu ihnen fehlt. Wer sie schließt, setzt deshalb keine Maschine auf offline.
 *
 * Dock-Fassung 2 (Paket 4): Jede Nachricht ist binär und trägt einen oder mehrere
 * Datensätze, je Satz Länge und Kopf (JSON), Länge und Inhalt (die Nachricht des
 * Daemons, roh). Beschrieben in `internal/bahnhof/dock.go`. Vorher steckte jede
 * Nachricht als Text in einem JSON-Rahmen und wurde zweimal gelesen. Der Bahnhof sagt
 * zuerst `hallo` mit seinem Fahrplan, erst dann gilt das Dock als angedockt. Tür und
 * Zählung laufen im Bahnhof, er meldet sie im Minutentakt (`zaehlung`, `kontrolle`).
 */

const NEUER_VERSUCH_MS = 2000;
/** Ein Bahnhof mit dem alten Dock ändert sich nicht in zwei Sekunden. */
const ALTER_BAHNHOF_MS = 30000;
const HALLO_FRIST_MS = 5000;
const MAX_RAHMEN_BYTES = 8 * 1024 * 1024;
const BUENDEL_BYTES = 1024 * 1024;
const DOCK_PFAD = '/dock/2';

/** Ein Datensatz: Länge, Kopf, Länge, Inhalt. */
function satz(kopf, inhalt) {
    const k = Buffer.from(JSON.stringify(kopf));
    const i = inhalt === undefined ? Buffer.alloc(0) : (Buffer.isBuffer(inhalt) ? inhalt : Buffer.from(String(inhalt)));
    const laengen = Buffer.allocUnsafe(8);
    laengen.writeUInt32BE(k.length, 0);
    laengen.writeUInt32BE(i.length, 4);
    return [laengen.subarray(0, 4), k, laengen.subarray(4, 8), i];
}

/** Zerlegt eine Dock-Nachricht in ihre Datensätze. Wirft bei kaputten Längen. */
function zerlege(daten) {
    const saetze = [];
    let pos = 0;
    const stueck = () => {
        if (pos + 4 > daten.length) throw new Error('Datensatz kaputt');
        const n = daten.readUInt32BE(pos);
        if (pos + 4 + n > daten.length) throw new Error('Datensatz kaputt');
        const s = daten.subarray(pos + 4, pos + 4 + n);
        pos += 4 + n;
        return s;
    };
    while (pos < daten.length) {
        const kopf = JSON.parse(stueck().toString());
        saetze.push({ kopf, inhalt: stueck() });
    }
    return saetze;
}

/** Sieht für `_handleConnection` aus wie ein WebSocket. */
class DockLeitung extends EventEmitter {
    constructor(dock, kanal) {
        super();
        this.dock = dock;
        this.kanal = kanal;
        this.zu = false;
        this.bahnhofWeg = false;
    }

    send(text) {
        if (!this.zu) this.dock.sende({ k: this.kanal, a: 'daten' }, text);
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
     * @param {{_handleConnection: Function, Logger: object, _angedockt?: Function, _vomBahnhof?: Function}} ipm
     * @param {string} pfad Socket des Bahnhofs
     */
    constructor(ipm, pfad) {
        this.ipm = ipm;
        this.pfad = pfad;
        this.leitungen = new Map();
        this.socket = null;
        this.beendet = false;
        this.gemeldet = false;
        this.angedockt = false;
        /** Was der Bahnhof beim Andocken sagt: `{fassung, stand}`. */
        this.bahnhof = null;
        this.ausgang = [];
        this.ausgangBytes = 0;
        this.geplant = false;
    }

    starte() {
        this._verbinde();
    }

    /** Beim Herunterfahren: Die Leitungen bleiben beim Bahnhof offen, das ist sein Zweck. */
    beende() {
        this.beendet = true;
        clearTimeout(this.wartet);
        clearTimeout(this.halloFrist);
        this._leere();
        this.socket?.close();
    }

    /**
     * Reiht einen Datensatz ein. Was im selben Durchlauf der Ereignisschleife
     * zusammenkommt, geht als eine Nachricht raus.
     */
    sende(kopf, inhalt) {
        if (this.socket?.readyState !== WebSocket.OPEN) return;
        const teile = satz(kopf, inhalt);
        this.ausgang.push(...teile);
        for (const t of teile) this.ausgangBytes += t.length;
        if (this.ausgangBytes >= BUENDEL_BYTES) this._leere();
        else if (!this.geplant) {
            this.geplant = true;
            setImmediate(() => this._leere());
        }
    }

    _leere() {
        this.geplant = false;
        if (!this.ausgang.length) return;
        const nachricht = Buffer.concat(this.ausgang, this.ausgangBytes);
        this.ausgang = [];
        this.ausgangBytes = 0;
        if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(nachricht, { binary: true });
    }

    _verbinde() {
        if (this.beendet) return;
        const socket = new WebSocket(`ws+unix://${this.pfad}:${DOCK_PFAD}`, { maxPayload: MAX_RAHMEN_BYTES, perMessageDeflate: false });
        this.socket = socket;
        this.zuAlt = false;

        socket.on('open', () => {
            this.gemeldet = false;
            // Ein Bahnhof vor Paket 4 nimmt jeden Pfad an und sagt nie hallo.
            this.halloFrist = setTimeout(() => this._zuAlt('sagt kein hallo'), HALLO_FRIST_MS);
        });
        socket.on('message', (daten, binaer) => {
            if (socket !== this.socket) return;
            if (!binaer) return this._zuAlt('spricht das alte Dock');
            let saetze;
            try {
                saetze = zerlege(daten);
            } catch (fehler) {
                this.ipm.Logger.error('[BusDock] Nachricht vom Bahnhof nicht lesbar:', fehler);
                return;
            }
            for (const { kopf, inhalt } of saetze) this._nimm(kopf, inhalt);
        });
        socket.on('error', (fehler) => {
            // Einmal melden, nicht alle zwei Sekunden: `close` folgt ohnehin.
            if (!this.gemeldet) this.ipm.Logger.warn(`[BusDock] Bahnhof nicht erreichbar: ${fehler.message}`);
            this.gemeldet = true;
        });
        socket.on('close', () => {
            clearTimeout(this.halloFrist);
            if (this.angedockt && !this.beendet) this.ipm.Logger.warn('[BusDock] Vom Bahnhof abgedockt, die Daemons sind nicht erreichbar');
            this.angedockt = false;
            this.ausgang = [];
            this.ausgangBytes = 0;
            // Ohne Dock gibt es keinen Weg zu diesen Daemons, das sagt die Trennung.
            if (!this.beendet) {
                for (const leitung of [...this.leitungen.values()]) {
                    leitung.bahnhofWeg = true;
                    leitung.geschlossen();
                }
            }
            if (!this.beendet) this.wartet = setTimeout(() => this._verbinde(), this.zuAlt ? ALTER_BAHNHOF_MS : NEUER_VERSUCH_MS);
        });
    }

    /** Der Bahnhof läuft noch ohne Paket 4: abdocken, bis `bh-prod.sh` gelaufen ist. */
    _zuAlt(grund) {
        if (this.zuAlt) return;
        this.zuAlt = true;
        this.ipm.Logger.error(`[BusDock] Der Bahnhof ${grund}: Er braucht den Stand mit Dock-Fassung 2 (./bh-prod.sh). Neuer Versuch in ${ALTER_BAHNHOF_MS / 1000} s`);
        this.socket?.terminate();
    }

    _nimm({ k, a, ip, fassung, stand }, inhalt) {
        if (a === 'daten') {
            this.leitungen.get(k)?.emit('message', inhalt);
        } else if (a === 'auf') {
            const leitung = new DockLeitung(this, k);
            this.leitungen.set(k, leitung);
            this.ipm._handleConnection(leitung, { headers: { 'x-forwarded-for': ip }, socket: { remoteAddress: ip } });
        } else if (a === 'zu') {
            this.leitungen.get(k)?.geschlossen();
        } else if (a === 'hallo') {
            clearTimeout(this.halloFrist);
            this.angedockt = true;
            this.bahnhof = { fassung, stand };
            this.ipm.Logger.info(`[BusDock] Am Bahnhof angedockt (Stand ${stand}, Fahrplan ${fassung})`);
            // Die Tür prüft nach dem Fahrplan des Bahnhofs: Ein neuer Name fährt erst,
            // wenn der Bahnhof ihn kennt.
            if (fassung !== firebus.fassung) {
                this.ipm.Logger.warn(`[BusDock] Der Bahnhof fährt Fahrplan ${fassung}, das Dashboard ${firebus.fassung}: Bahnhof neu bauen (./bh-prod.sh)`);
            }
            this.ipm._angedockt?.();
        } else if (a === 'zaehlung' || a === 'kontrolle') {
            try {
                this.ipm._vomBahnhof?.(a, JSON.parse(inhalt.toString()));
            } catch (fehler) {
                this.ipm.Logger.error(`[BusDock] ${a} vom Bahnhof nicht übernommen:`, fehler);
            }
        }
    }
}

module.exports = BusDock;
module.exports.satz = satz;
module.exports.zerlege = zerlege;
module.exports.DOCK_PFAD = DOCK_PFAD;
