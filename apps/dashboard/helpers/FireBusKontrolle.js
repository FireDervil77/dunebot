'use strict';

const { ServiceManager } = require('dunebot-core');

/**
 * Linie V: die Fahrkartenkontrolle (FireBus Etappe 3, F9), hier das Protokoll.
 *
 * Jede Nachricht vom Daemon wird an der Tür geprüft: Steht der Name im Fahrplan,
 * stimmt die Richtung, ist sie nicht zu groß, ist der Absender nicht zu schnell? Was
 * durchfällt, fährt nicht mit und steht auf der Seite `/admin/firebus`.
 *
 * Die Tür steht seit Paket 4 (2026-11-03) im Busbahnhof (`internal/bahnhof/tuer.go`).
 * Er meldet im Minutentakt über das Dock, was durchfiel, und diese Klasse schreibt es,
 * denn der Bahnhof fasst die Datenbank nie an. Bis dahin prüfte sie selbst.
 *
 * Gemeldet werden Name, Absender und Grund, nie die Nutzlast: Dort stehen Kennwörter.
 */

const TAKT_MS = 60 * 1000;
const AUFHEBEN_TAGE = 30;
const MAX_NAME = 80;

class FireBusKontrolle {
    /** @param {{db?: Function}} [abhaengig] für den Wächter */
    constructor({ db } = {}) {
        this.db = db || (() => ServiceManager.get('dbService'));
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
     * Was der Bahnhof seit seinem letzten Takt meldet.
     * @param {Array<{daemon: string, name: string, grund: string, anzahl: number}>} meldungen
     */
    uebernimm(meldungen) {
        if (!Array.isArray(meldungen)) return;
        for (const m of meldungen) {
            const anzahl = Number(m?.anzahl);
            if (!FireBusKontrolle.GRUENDE[m?.grund] || !(anzahl > 0)) continue;
            const name = String(m.name ?? '').slice(0, MAX_NAME);
            const daemonId = String(m.daemon ?? '').slice(0, 64);
            // Als JSON: Ein Name mit Zeilenumbruch zerlegte sonst den Schlüssel.
            const schluessel = JSON.stringify([daemonId, name, m.grund]);
            // Eine Zeile je Takt und Fall, sonst füllt ein Fehler das Log.
            if (!this.meldungen.has(schluessel) && ServiceManager.has('Logger')) {
                ServiceManager.get('Logger').warn(`[FireBus] Kontrolle im Bahnhof: ${name} von ${daemonId}: ${m.grund} (${anzahl}×)`);
            }
            this.meldungen.set(schluessel, (this.meldungen.get(schluessel) || 0) + anzahl);
        }
    }

    /** Schreibt, was seit dem letzten Takt aufgelaufen ist. */
    async schreibe() {
        if (!this.meldungen.size) return;
        const offen = this.meldungen;
        this.meldungen = new Map();
        const db = this.db();
        for (const [schluessel, anzahl] of offen) {
            const [daemonId, name, grund] = JSON.parse(schluessel);
            await db.query(
                `INSERT INTO firebus_kontrolle (stunde, daemon_id, name, grund, anzahl, zuletzt)
                 VALUES (DATE_FORMAT(NOW(), '%Y-%m-%d %H:00:00'), ?, ?, ?, ?, NOW())
                 ON DUPLICATE KEY UPDATE anzahl = anzahl + VALUES(anzahl), zuletzt = NOW()`,
                [daemonId, name, grund, anzahl]);
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
