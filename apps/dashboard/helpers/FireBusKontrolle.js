'use strict';

const { ServiceManager } = require('dunebot-core');
const firebus = require('../../../packages/firebus');

/**
 * Linie V: die Fahrkartenkontrolle (FireBus Etappe 3, F9).
 *
 * Jede Nachricht vom Daemon wird an der Tür geprüft: Steht der Name im Fahrplan,
 * stimmt die Richtung, ist sie nicht zu groß, ist der Absender nicht zu schnell? Was
 * durchfällt, fährt nicht mit und steht auf der Seite `/admin/firebus`.
 *
 * Gemeldet werden Name, Absender und Grund, nie die Nutzlast: Dort stehen Kennwörter.
 *
 * Gemessen vor dem Einschalten, 2026-11-01 bis 02: Außerhalb des Fahrplans lagen nur die
 * drei Befehle, die Etappe 2 entfernt hat, eine falsche Richtung gab es nicht, die
 * Spitze lag im Stundenmittel bei 3,2 Nachrichten je Sekunde.
 *
 * Antworten auf Befehle prüft die Tür nicht: Sie tragen keinen Namen, und ohne Antwort
 * bliebe ein Befehl bis zu seiner Frist offen.
 */

/** Nachrichten je Sekunde und Daemon. Gesetzt, nicht gemessen: 600-mal die Spitze. */
const TEMPO_GRENZE = 2000;
const TAKT_MS = 60 * 1000;
const AUFHEBEN_TAGE = 30;

class FireBusKontrolle {
    /** @param {{db?: Function, jetzt?: Function, tempoGrenze?: number}} [abhaengig] für den Wächter */
    constructor({ db, jetzt, tempoGrenze } = {}) {
        this.db = db || (() => ServiceManager.get('dbService'));
        this.jetzt = jetzt || Date.now;
        this.tempoGrenze = tempoGrenze || TEMPO_GRENZE;
        this.tempo = new Map();
        this.meldungen = new Map();
    }

    starte() {
        this.takt = setInterval(() => {
            this.schreibe().catch(e => ServiceManager.get('Logger').error('[FireBus] Kontrolle nicht geschrieben', e));
        }, TAKT_MS);
        this.takt.unref?.();
    }

    async beende() {
        if (this.takt) clearInterval(this.takt);
        await this.schreibe();
    }

    /**
     * @param {string} daemonId
     * @param {string|undefined} name Name der Nachricht
     * @param {number} bytes
     * @returns {boolean} Darf sie mitfahren?
     */
    pruefe(daemonId, name, bytes) {
        const zeile = name ? firebus.zeile(name) : null;
        if (!zeile) return this._halt(daemonId, name || '(ohne Namen)', 'unbekannt');
        if (zeile.von !== 'daemon') return this._halt(daemonId, name, 'richtung');
        if (zeile.max_bytes && bytes > zeile.max_bytes) return this._halt(daemonId, name, 'groesse');
        if (this._zuSchnell(daemonId)) {
            // Was nie verloren gehen darf, fährt mit: Gemeldet wird es trotzdem.
            if (zeile.verlust === 'nie') {
                this._melde(daemonId, name, 'tempo');
                return true;
            }
            return this._halt(daemonId, name, 'tempo');
        }
        return true;
    }

    _zuSchnell(daemonId) {
        const sekunde = Math.floor(this.jetzt() / 1000);
        const stand = this.tempo.get(daemonId);
        if (!stand || stand.sekunde !== sekunde) {
            this.tempo.set(daemonId, { sekunde, anzahl: 1 });
            return false;
        }
        stand.anzahl++;
        return stand.anzahl > this.tempoGrenze;
    }

    _halt(daemonId, name, grund) {
        this._melde(daemonId, name, grund);
        return false;
    }

    _melde(daemonId, name, grund) {
        const schluessel = `${daemonId}\n${name}\n${grund}`;
        const neu = !this.meldungen.has(schluessel);
        this.meldungen.set(schluessel, (this.meldungen.get(schluessel) || 0) + 1);
        // Eine Zeile je Minute und Fall, sonst füllt ein Fehler das Log.
        if (neu && ServiceManager.has('Logger')) {
            ServiceManager.get('Logger').warn(`[FireBus] Kontrolle: ${name} von ${daemonId}: ${grund}`);
        }
    }

    /** Schreibt, was seit dem letzten Takt aufgelaufen ist. */
    async schreibe() {
        if (!this.meldungen.size) return;
        const offen = this.meldungen;
        this.meldungen = new Map();
        const db = this.db();
        for (const [schluessel, anzahl] of offen) {
            const [daemonId, name, grund] = schluessel.split('\n');
            await db.query(
                `INSERT INTO firebus_kontrolle (stunde, daemon_id, name, grund, anzahl, zuletzt)
                 VALUES (DATE_FORMAT(NOW(), '%Y-%m-%d %H:00:00'), ?, ?, ?, ?, NOW())
                 ON DUPLICATE KEY UPDATE anzahl = anzahl + VALUES(anzahl), zuletzt = NOW()`,
                [daemonId, String(name).slice(0, 80), grund, anzahl]);
        }
        await db.query('DELETE FROM firebus_kontrolle WHERE stunde < NOW() - INTERVAL ? DAY', [AUFHEBEN_TAGE]);
    }
}

FireBusKontrolle.GRUENDE = {
    unbekannt: 'Steht nicht im Fahrplan',
    richtung: 'Falsche Richtung',
    groesse: 'Zu groß',
    tempo: 'Absender zu schnell',
};

module.exports = FireBusKontrolle;
