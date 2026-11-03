'use strict';

const crypto = require('crypto');

/**
 * Die Innenhaut des FireBus (Etappe 4, Paket 5), Seite des Dashboards.
 *
 * TLS endet am Busbahnhof. Die Innenhaut reicht von Daemon zu Dashboard: Der Bahnhof
 * liest den Umschlag (Name, Kennung, Frist), den Inhalt kann er weder lesen noch ändern.
 * Gerechnet wird wie in `internal/innenhaut` im Daemon, beide prüfen sich an denselben
 * Testwerten (`scripts/check-innenhaut.js`, `TestWieDasDashboard`):
 *
 *     K     = HKDF-SHA256(Token, info = "firebus innenhaut v1" ‖ daemon_id)
 *     d→a   = HKDF-SHA256(K, salt = Sitzung des Daemons, info = "d>a")
 *     a→d   = HKDF-SHA256(K, salt = Sitzung des Daemons ‖ Sitzung des Dashboards, info = "a>d")
 *     Nonce = 4 Nullbytes ‖ Zähler (uint64, big endian), AES-256-GCM
 *     AAD   = "fbih1" ‖ je Feld des Umschlags: Länge (uint32) und Wert, fehlt es: 0xFFFFFFFF
 *
 * Der Token ist `rootserver.api_key`. Ausgehandelt wird nichts (F19, 2026-11-03): So liest
 * das Dashboard nach jedem Neustart die Halle des Bahnhofs. Jede Seite würfelt beim
 * Start eine Sitzung (8 Bytes Nummer, 8 Bytes Zufall). Von der Gegenseite gilt nur ihre
 * neueste Sitzung, und Zähler laufen nur aufwärts. Die neueste Sitzung jedes Daemons und
 * seinen höchsten Zähler schreibt das Dashboard in `rootserver` (nicht geheim), beim
 * Heartbeat, beim Wechsel der Sitzung und beim Beenden.
 *
 * Token erneuern: Der neue steht in `api_key_neu`, bis der Daemon eine neue Sitzung unter
 * ihm beginnt. Erst dann rückt er nach `api_key`, und der alte gilt nicht mehr. Bis
 * dahin gelten beide, fällt eine Seite mittendrin aus, sperrt sich niemand aus.
 */

const LESBAR = ['type', 'namespace', 'action', 'id', 'command', 'frist_ms'];
const EIGENE = ['daemon', 's', 'an', 'n', 'inhalt'];
const ERLAUBT = new Set([...LESBAR, ...EIGENE]);
const FEHLT = 0xFFFFFFFF;
const SITZUNG = /^[0-9a-f]{32}$/;
/** Ein Siegel, das nicht passt, lädt den Token höchstens so oft neu. */
const NEU_LADEN_MS = 10000;

function fehler(text, art) {
    const e = new Error(text);
    e.innenhaut = art;
    return e;
}

function grundschluessel(token, daemonId) {
    return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(String(token)), Buffer.alloc(0),
        Buffer.from('firebus innenhaut v1' + daemonId), 32));
}

function richtung(k, salz, info) {
    return Buffer.from(crypto.hkdfSync('sha256', k, salz, Buffer.from(info), 32));
}

function nonce(n) {
    const b = Buffer.alloc(12);
    b.writeBigUInt64BE(BigInt(n), 4);
    return b;
}

function neueSitzung(nummer) {
    const s = crypto.randomBytes(16);
    s.writeBigUInt64BE(BigInt(nummer), 0);
    return s.toString('hex');
}

function nummerVon(sitzung) {
    return Number(Buffer.from(sitzung, 'hex').readBigUInt64BE(0));
}

const istZahl = (v) => Number.isSafeInteger(v) && v >= 0;

/** Die zusätzlich unterschriebenen Daten: genau die Felder des Umschlags. */
function aad(u) {
    const teile = [Buffer.from('fbih1')];
    const feld = (wert) => {
        const laenge = Buffer.alloc(4);
        if (wert === undefined) {
            laenge.writeUInt32BE(FEHLT);
            teile.push(laenge);
            return;
        }
        const w = Buffer.from(String(wert), 'utf8');
        laenge.writeUInt32BE(w.length);
        teile.push(laenge, w);
    };
    for (const name of ['daemon', 's', 'an', 'n', ...LESBAR]) feld(u[name]);
    return Buffer.concat(teile);
}

/** Prüft die Form eines ankommenden Umschlags. */
function pruefeUmschlag(u) {
    for (const name of Object.keys(u)) {
        if (!ERLAUBT.has(name)) throw fehler(`Feld ${name} gehört nicht in den Umschlag`, 'umschlag');
    }
    for (const name of ['daemon', 's', 'an', 'inhalt', 'type', 'namespace', 'action', 'id', 'command']) {
        if (u[name] !== undefined && typeof u[name] !== 'string') throw fehler(`${name} ist kein Text`, 'umschlag');
    }
    for (const name of ['n', 'frist_ms']) {
        if (u[name] !== undefined && !istZahl(u[name])) throw fehler(`${name} ist keine Zahl`, 'umschlag');
    }
    if (!u.daemon || !SITZUNG.test(u.s || '') || !u.n) throw fehler('Umschlag unvollständig', 'umschlag');
}

/** Trennt eine Nachricht in Umschlag und Inhalt, wie `teile` im Daemon. */
function teile(nachricht) {
    const u = {};
    const rest = {};
    for (const [name, wert] of Object.entries(nachricht)) {
        if (wert === undefined) continue;
        if (EIGENE.includes(name)) throw fehler(`Die Nachricht trägt ${name}`, 'umschlag');
        const passt = name === 'frist_ms' ? istZahl(wert) : typeof wert === 'string';
        if (LESBAR.includes(name) && passt) u[name] = wert;
        else rest[name] = wert;
    }
    return { u, inhalt: Buffer.from(JSON.stringify(rest)) };
}

function verschliesse(schluessel, n, u, inhalt) {
    u.n = n;
    const c = crypto.createCipheriv('aes-256-gcm', schluessel, nonce(n));
    c.setAAD(aad(u));
    u.inhalt = Buffer.concat([c.update(inhalt), c.final(), c.getAuthTag()]).toString('base64');
    return JSON.stringify(u);
}

function oeffneMit(schluessel, u) {
    const siegel = Buffer.from(u.inhalt, 'base64');
    if (siegel.length < 16) throw fehler('Siegel passt nicht', 'siegel');
    let inhalt;
    try {
        const d = crypto.createDecipheriv('aes-256-gcm', schluessel, nonce(u.n));
        d.setAAD(aad(u));
        d.setAuthTag(siegel.subarray(siegel.length - 16));
        inhalt = Buffer.concat([d.update(siegel.subarray(0, siegel.length - 16)), d.final()]);
    } catch {
        throw fehler('Siegel passt nicht (falscher Token oder verändert)', 'siegel');
    }
    const nachricht = JSON.parse(inhalt.toString());
    if (!nachricht || typeof nachricht !== 'object' || Array.isArray(nachricht)) throw fehler('Inhalt ist kein Objekt', 'umschlag');
    // Nichts, das schon im Umschlag steht: Sonst sähe der Bahnhof einen anderen Namen,
    // als hier ausgeführt wird.
    for (const name of Object.keys(u)) {
        if (Object.hasOwn(nachricht, name)) throw fehler(`Der Inhalt trägt ${name}`, 'umschlag');
    }
    for (const name of LESBAR) {
        if (u[name] !== undefined) nachricht[name] = u[name];
    }
    return nachricht;
}

class Innenhaut {
    /**
     * @param {{db: () => {query: Function}, Logger: object, jetzt?: () => number,
     *          tokenGilt?: (daemonId: string) => void}} teile
     */
    constructor({ db, Logger, jetzt = Date.now, tokenGilt = () => {} }) {
        this.db = db;
        this.Logger = Logger;
        this.jetzt = jetzt;
        this.tokenGilt = tokenGilt;
        this.sitzung = null;
        /** daemon_id → Zustand, siehe `_daemon`. */
        this.daemons = new Map();
        this.laden = new Map();
    }

    /** Würfelt die Sitzung des Dashboards. Ihre Nummer steigt auch, wenn die Uhr zurückspringt. */
    async starte() {
        let nummer = this.jetzt();
        try {
            const [zeile] = await this.db().query('SELECT nummer FROM firebus_sitzung WHERE id = 1');
            if (zeile && Number(zeile.nummer) >= nummer) nummer = Number(zeile.nummer) + 1;
            await this.db().query(
                'INSERT INTO firebus_sitzung (id, nummer) VALUES (1, ?) ON DUPLICATE KEY UPDATE nummer = VALUES(nummer)',
                [nummer]);
        } catch (error) {
            // Ohne gespeicherte Nummer gilt die Uhr. Springt sie zurück, weisen die Daemons
            // diese Sitzung als ältere ab, bis sie selbst neu starten.
            this.Logger.error('[Innenhaut] Sitzungsnummer nicht gespeichert, es gilt die Uhr allein', error);
        }
        this.sitzung = neueSitzung(nummer);
        this.Logger.info(`[Innenhaut] Sitzung ${nummer}`);
    }

    /** Zustand eines Daemons, beim ersten Mal aus der Datenbank. null: kein Rootserver dazu. */
    async _daemon(daemonId) {
        const da = this.daemons.get(daemonId);
        if (da) return da;
        if (!this.laden.has(daemonId)) {
            this.laden.set(daemonId, (async () => {
                try {
                    const [zeile] = await this.db().query(
                        'SELECT api_key, api_key_neu, innenhaut_sitzung, innenhaut_zaehler FROM rootserver WHERE daemon_id = ? LIMIT 1',
                        [daemonId]);
                    if (!zeile || !zeile.api_key) return null;
                    const sitzung = zeile.innenhaut_sitzung || null;
                    const d = {
                        k: grundschluessel(zeile.api_key, daemonId),
                        tokenNeu: zeile.api_key_neu || null,
                        kNeu: zeile.api_key_neu ? grundschluessel(zeile.api_key_neu, daemonId) : null,
                        geladen: this.jetzt(),
                        marke: { sitzung, nummer: sitzung ? nummerVon(sitzung) : 0, hoch: Number(zeile.innenhaut_zaehler) || 0 },
                        geschrieben: { sitzung, hoch: Number(zeile.innenhaut_zaehler) || 0 },
                        ein: null,
                        aus: new Map(),
                    };
                    this.daemons.set(daemonId, d);
                    return d;
                } finally {
                    this.laden.delete(daemonId);
                }
            })());
        }
        return this.laden.get(daemonId);
    }

    /**
     * Öffnet eine Nachricht vom Bahnhof. Klartext kommt als `{klartext: true, nachricht}`:
     * Der IPMServer weist ihn ab (F20), braucht aber die Nachricht für seine Meldung. Wirft mit `fehler.innenhaut` = umschlag, siegel,
     * unbekannt, wiederholung oder alt.
     */
    async oeffne(text) {
        let u;
        try {
            u = JSON.parse(text);
        } catch {
            throw fehler('Nachricht ist kein JSON', 'umschlag');
        }
        if (!u || typeof u !== 'object' || Array.isArray(u)) throw fehler('Nachricht ist kein Objekt', 'umschlag');
        if (!Object.hasOwn(u, 'inhalt')) return { klartext: true, nachricht: u };
        pruefeUmschlag(u);
        try {
            return await this._oeffneVon(u);
        } catch (error) {
            error.daemonId = u.daemon;
            throw error;
        }
    }

    async _oeffneVon(u) {
        let d = await this._daemon(u.daemon);
        if (!d) throw fehler(`Daemon ${u.daemon} ist hier nicht eingetragen`, 'unbekannt');
        const salz = Buffer.from(u.s, 'hex');
        let schluessel = d.ein?.sitzung === u.s ? d.ein.schluessel : richtung(d.k, salz, 'd>a');
        let nachricht;
        let mitNeuem = false;
        try {
            nachricht = oeffneMit(schluessel, u);
        } catch (error) {
            if (error.innenhaut !== 'siegel') throw error;
            // Unter dem neuen Token spricht nur eine neue Sitzung (Token erneuern).
            if (d.kNeu && d.marke.sitzung !== u.s) {
                try {
                    schluessel = richtung(d.kNeu, salz, 'd>a');
                    nachricht = oeffneMit(schluessel, u);
                    mitNeuem = true;
                } catch {
                    nachricht = null;
                }
            }
            if (!mitNeuem) {
                // Vielleicht hat sich der Token geändert (Rootserver neu angelegt): einmal neu laden.
                if (this.jetzt() - d.geladen < NEU_LADEN_MS) throw error;
                this.daemons.delete(u.daemon);
                d = await this._daemon(u.daemon);
                if (!d) throw error;
                schluessel = richtung(d.k, salz, 'd>a');
                nachricht = oeffneMit(schluessel, u);
            }
        }
        // Der Vorlauf des Wizards hat eine eigene Sitzung, die nichts verbucht.
        if (nachricht.type === 'register' && nachricht.payload?.probe === true) {
            return { nachricht, daemonId: u.daemon, sitzung: u.s, probe: true };
        }
        this._pruefeReihe(u.daemon, d, u);
        d.ein = { sitzung: u.s, schluessel };
        if (mitNeuem) this._neuerTokenGilt(u.daemon, d);
        return { nachricht, daemonId: u.daemon, sitzung: u.s, probe: false };
    }

    /** Der Daemon spricht unter dem neuen Token: Ab jetzt gilt nur noch er. */
    _neuerTokenGilt(daemonId, d) {
        const token = d.tokenNeu;
        d.k = d.kNeu;
        d.kNeu = null;
        d.tokenNeu = null;
        d.aus.clear();
        this.db().query('UPDATE rootserver SET api_key = api_key_neu, api_key_neu = NULL WHERE daemon_id = ? AND api_key_neu = ?',
            [daemonId, token])
            .then(() => this.tokenGilt(daemonId))
            .catch(error => this.Logger.error(`[Innenhaut] Neuer Token von ${daemonId} gilt, aber nicht gespeichert`, error));
        this.Logger.info(`[Innenhaut] ${daemonId} spricht unter dem neuen Token, der alte gilt nicht mehr`);
    }

    /** Knopf „Token erneuern": Bis der Daemon unter ihm spricht, gilt der neue neben dem alten. */
    neuerToken(daemonId, token) {
        const d = this.daemons.get(daemonId);
        if (!d) return;
        d.tokenNeu = token || null;
        d.kNeu = token ? grundschluessel(token, daemonId) : null;
    }

    /** Nur die neueste Sitzung, nur aufwärts. Erst nach dem Siegel gerufen. */
    _pruefeReihe(daemonId, d, u) {
        const m = d.marke;
        if (m.sitzung === u.s) {
            if (u.n <= m.hoch) throw fehler(`Zähler ${u.n} nicht größer als ${m.hoch}, Wiederholung`, 'wiederholung');
            m.hoch = u.n;
            return;
        }
        const nummer = nummerVon(u.s);
        if (m.sitzung && nummer <= m.nummer) throw fehler('Ältere Sitzung des Daemons', 'alt');
        m.sitzung = u.s;
        m.nummer = nummer;
        m.hoch = u.n;
        for (const an of d.aus.keys()) if (an !== u.s) d.aus.delete(an);
        // Sofort, nicht erst beim Heartbeat: Sonst gälte die alte Sitzung nach einem
        // Absturz wieder.
        this.merke(daemonId).catch(error =>
            this.Logger.error(`[Innenhaut] Neue Sitzung von ${daemonId} nicht gespeichert`, error));
    }

    /** Versiegelt eine Nachricht an die Sitzung `an` eines Daemons. */
    siegle(daemonId, an, nachricht) {
        const d = this.daemons.get(daemonId);
        if (!d || !this.sitzung) throw fehler(`Keine Innenhaut zu ${daemonId}`, 'unbekannt');
        let aus = d.aus.get(an);
        if (!aus) {
            aus = { schluessel: richtung(d.k, Buffer.concat([Buffer.from(an, 'hex'), Buffer.from(this.sitzung, 'hex')]), 'a>d'), n: 0 };
            d.aus.set(an, aus);
        }
        aus.n += 1;
        const { u, inhalt } = teile(nachricht);
        Object.assign(u, { daemon: daemonId, s: this.sitzung, an });
        return verschliesse(aus.schluessel, aus.n, u, inhalt);
    }

    /** Für den Vorlauf des Wizards: Seine Sitzung kommt nie wieder. */
    vergiss(daemonId, an) {
        this.daemons.get(daemonId)?.aus.delete(an);
    }

    /** Schreibt die Marke eines Daemons, wenn sie sich geändert hat. */
    async merke(daemonId) {
        const d = this.daemons.get(daemonId);
        if (!d || !d.marke.sitzung) return;
        const { sitzung, hoch } = d.marke;
        if (d.geschrieben.sitzung === sitzung && d.geschrieben.hoch === hoch) return;
        await this.db().query(
            'UPDATE rootserver SET innenhaut_sitzung = ?, innenhaut_zaehler = ? WHERE daemon_id = ?',
            [sitzung, hoch, daemonId]);
        d.geschrieben = { sitzung, hoch };
    }

    async merkeAlle() {
        for (const daemonId of this.daemons.keys()) await this.merke(daemonId);
    }
}

module.exports = Innenhaut;
Object.assign(module.exports, { grundschluessel, richtung, neueSitzung, nummerVon, aad, teile, verschliesse, oeffneMit, pruefeUmschlag });
