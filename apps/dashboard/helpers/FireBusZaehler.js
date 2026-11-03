'use strict';

/**
 * FireBus, Etappe 0: Zählung auf der Leitung zum Daemon (2026-11-01).
 *
 * Für die neue Leitung fehlten die Mengen: Wie viele Nachrichten fahren je Name,
 * wie groß sind sie, wie lange dauert eine Antwort, und wie voll ist die Maschine
 * dabei? Das zählt diese Klasse je Stunde, Daemon und Name. Die Maschinenlast
 * beantwortet außerdem, ob eine dritte Maschine schneller macht oder nur trennt.
 *
 * Den Verkehr zählt seit Paket 4 (2026-11-03) der Busbahnhof
 * (`internal/bahnhof/zaehlung.go`), auch die Dauer einer Antwort. Er meldet seine
 * Zeilen im Minutentakt über das Dock, `uebernimm` trägt sie hier ein. Hier entsteht
 * nur noch, was nur das Dashboard weiß: abgelaufene Fristen, die Belegung und die
 * Maschinenlast aus dem Herzschlag. Geschrieben wird alles einmal je Minute.
 *
 * Auswerten: `node scripts/firebus-zaehlung.js`
 */

const { ServiceManager } = require('dunebot-core');
const firebus = require('../../../packages/firebus');

const TAKT_MS = 60 * 1000;
const AUFHEBEN_TAGE = 30;
/** Obergrenze im Speicher: Ein Daemon liefert die Namen, und er könnte beliebig viele schicken. */
const MAX_SCHLUESSEL = 5000;
const MAX_NAME = 80;
const UEBERLAUF = 'ueberlauf';

const stundeVon = (ms) => new Date(ms - (ms % 3600000));

class FireBusZaehler {
    /** @param {{db?: Function, jetzt?: Function}} [abhaengig] für den Wächter */
    constructor({ db, jetzt } = {}) {
        this.db = db || (() => ServiceManager.get('dbService'));
        this.jetzt = jetzt || Date.now;
        this.zeilen = new Map();
        this.lasten = [];
        this.letzterDruck = new Map();
        this.unbekannteGemeldet = new Set();
        this.letztesAufraeumen = 0;
        this.takt = null;
    }

    starte() {
        this.takt = setInterval(() => {
            this.schreibe().catch(fehler =>
                ServiceManager.get('Logger').error('[FireBus] Zählung nicht geschrieben', fehler));
        }, TAKT_MS);
        if (this.takt.unref) this.takt.unref();
    }

    /** Vor dem Schließen des Datenbank-Pools abwarten, sonst fehlt die letzte Minute. */
    async beende() {
        if (this.takt) clearInterval(this.takt);
        this.takt = null;
        await this.schreibe();
    }

    /** @private */
    _zeile(daemonId, name, art, stunde = stundeVon(this.jetzt())) {
        const sauber = String(name || '?').slice(0, MAX_NAME);
        const schluesselFuer = (n) => `${stunde.getTime()}|${daemonId}|${n}|${art}`;
        const voll = !this.zeilen.has(schluesselFuer(sauber)) && this.zeilen.size >= MAX_SCHLUESSEL;
        const gezaehlt = voll ? UEBERLAUF : sauber;
        const schluessel = schluesselFuer(gezaehlt);
        let zeile = this.zeilen.get(schluessel);
        if (!zeile) {
            zeile = { stunde, daemonId, name: gezaehlt, art, anzahl: 0, bytes: 0, groesste: 0, dauerSumme: 0, dauerMax: 0, fristen: 0 };
            this.zeilen.set(schluessel, zeile);
        }
        if (!firebus.kennt(sauber) && sauber !== UEBERLAUF && !this.unbekannteGemeldet.has(sauber)) {
            this.unbekannteGemeldet.add(sauber);
            ServiceManager.get('Logger').warn(`[FireBus] „${sauber}" steht nicht im Fahrplan`);
        }
        return zeile;
    }

    /**
     * Was der Bahnhof seit seinem letzten Takt gezählt hat (`zaehlung` auf dem Dock).
     * Die Stunde kommt mit: Eine Zeile aus 14:59 bleibt in ihrer Stunde.
     * @param {Array<{stunde: number, daemon: string, name: string, art: 'ein'|'aus', anzahl: number,
     *   bytes: number, groesste: number, dauer_summe_ms: number, dauer_max_ms: number}>} zeilen
     */
    uebernimm(zeilen) {
        if (!Array.isArray(zeilen)) return;
        const zahl = (x) => (Number.isFinite(Number(x)) && Number(x) > 0 ? Number(x) : 0);
        for (const z of zeilen) {
            if ((z?.art !== 'ein' && z?.art !== 'aus') || !z.daemon || !(zahl(z.stunde) > 0)) continue;
            const zeile = this._zeile(String(z.daemon).slice(0, 64), z.name, z.art, stundeVon(zahl(z.stunde) * 1000));
            zeile.anzahl += zahl(z.anzahl);
            zeile.bytes += zahl(z.bytes);
            zeile.groesste = Math.max(zeile.groesste, zahl(z.groesste));
            zeile.dauerSumme += zahl(z.dauer_summe_ms);
            zeile.dauerMax = Math.max(zeile.dauerMax, zahl(z.dauer_max_ms));
        }
    }

    /** Ein Befehl lief in seine Frist. */
    frist(daemonId, name) {
        this._zeile(daemonId, name, 'aus').fristen++;
    }

    /**
     * Was der Herzschlag an Dauern je Befehl mitbringt.
     * @param {string} daemonId
     * @param {'lesefaden'|'warten'|'arbeit'} art
     * @param {Object} [stand]
     */
    belegung(daemonId, art, stand) {
        if (!stand || typeof stand !== 'object') return;
        for (const [name, w] of Object.entries(stand)) {
            const zeile = this._zeile(daemonId, name, art);
            zeile.anzahl += Number(w?.anzahl) || 0;
            zeile.dauerSumme += Number(w?.summe_ms) || 0;
            zeile.dauerMax = Math.max(zeile.dauerMax, Number(w?.max_ms) || 0);
        }
    }

    /**
     * Maschinenlast aus dem Herzschlag. `druck` sind Zähler seit dem Start der
     * Maschine, also zählt die Spanne zum letzten Herzschlag. Der erste Wert
     * nach dem Start des Dashboards hat keine Spanne und ergibt keine Druckzahl.
     */
    last(daemonId, { druck, hardware }) {
        const jetzt = this.jetzt();
        const davor = this.letzterDruck.get(daemonId);
        if (druck) this.letzterDruck.set(daemonId, { am: jetzt, druck });

        const prozent = (feld) => {
            if (!druck || !davor) return null;
            const sekunden = (jetzt - davor.am) / 1000;
            const spanne = Number(druck[feld]) - Number(davor.druck[feld]);
            // Kleiner als null: Die Maschine wurde neu gestartet.
            if (!(sekunden > 0) || !Number.isFinite(spanne) || spanne < 0) return null;
            return Math.min(100, (spanne / 1e6 / sekunden) * 100);
        };
        this.lasten.push({
            zeit: new Date(jetzt), daemonId,
            cpu: hardware?.cpu?.usage_percent ?? null,
            ram: hardware?.ram?.used_percent ?? null,
            druckCpu: prozent('cpu_some_us'), druckIo: prozent('io_some_us'), druckRam: prozent('ram_some_us'),
        });
    }

    /** Schreibt, was seit dem letzten Mal zusammenkam. */
    async schreibe() {
        const db = this.db();
        const zeilen = [...this.zeilen.values()];
        const lasten = this.lasten;
        this.zeilen = new Map();
        this.lasten = [];

        for (const z of zeilen) {
            await db.query(
                `INSERT INTO firebus_zaehlung (stunde, daemon_id, name, art, anzahl, bytes, groesste, dauer_summe_ms, dauer_max_ms, fristen)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE anzahl = anzahl + VALUES(anzahl), bytes = bytes + VALUES(bytes),
                     groesste = GREATEST(groesste, VALUES(groesste)), dauer_summe_ms = dauer_summe_ms + VALUES(dauer_summe_ms),
                     dauer_max_ms = GREATEST(dauer_max_ms, VALUES(dauer_max_ms)), fristen = fristen + VALUES(fristen)`,
                [z.stunde, z.daemonId, z.name, z.art, z.anzahl, z.bytes, z.groesste, z.dauerSumme, z.dauerMax, z.fristen]);
        }
        for (const l of lasten) {
            await db.query(
                `INSERT INTO firebus_last (zeit, daemon_id, cpu_prozent, ram_prozent, druck_cpu, druck_io, druck_ram)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [l.zeit, l.daemonId, l.cpu, l.ram, l.druckCpu, l.druckIo, l.druckRam]);
        }

        const jetzt = this.jetzt();
        if (jetzt - this.letztesAufraeumen >= 3600000) {
            this.letztesAufraeumen = jetzt;
            await db.query('DELETE FROM firebus_zaehlung WHERE stunde < NOW() - INTERVAL ? DAY', [AUFHEBEN_TAGE]);
            await db.query('DELETE FROM firebus_last WHERE zeit < NOW() - INTERVAL ? DAY', [AUFHEBEN_TAGE]);
        }
    }
}

module.exports = FireBusZaehler;
module.exports.MAX_SCHLUESSEL = MAX_SCHLUESSEL;
module.exports.UEBERLAUF = UEBERLAUF;
