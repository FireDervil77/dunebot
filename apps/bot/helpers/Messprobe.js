'use strict';

/**
 * Messprobe Nachrichtenmenge (G-18, K382, 2026-11-15).
 *
 * Zählt je Guild und Stunde, wie viele Nachrichten anfallen, und schreibt es
 * einmal je Minute in `messprobe_nachrichten` (Kern-Migration
 * `20261115_120000_messprobe_nachrichten.js`, Spalten dort erklärt). Gespeichert
 * werden nur Anzahlen: kein Inhalt, keine Mitglieds-, Kanal- oder
 * Nachrichten-ID. Die Paare (Mitglied, Minute) für `mitglied_minuten` liegen
 * nur im Speicher und nur für die laufende Stunde.
 *
 * Sieben Tage: Sobald die älteste Zeile 7 × 24 + 1 Stunden zurückliegt, hört
 * der Zähler von selbst auf (die erste Stunde ist angebrochen). Die Frage
 * stellt jeder Shard selbst an die Tabelle, einmal je Stunde; so übersteht das
 * Ende jeden Neustart.
 *
 * Eine Guild hängt an genau einem Shard. Deshalb zählt jeder Shard-Prozess
 * für sich, und `mitglied_minuten` ist trotzdem genau. Geht der Prozess zu
 * Boden, fehlt höchstens die letzte Minute.
 *
 * Aufrufer: `apps/bot/events/messageCreate.js`, `messageUpdate.js`,
 * `messageDelete.js`, `messageDeleteBulk.js`. Wächter: `scripts/check-messprobe.js`.
 */
const { ServiceManager } = require('dunebot-core');

const TAKT_MS = 60_000;
const STUNDE_MS = 3_600_000;
const DAUER_STUNDEN = 7 * 24 + 1;
const ZAHLEN = ['menschen', 'bots', 'inhalt_bytes', 'anhaenge', 'bearbeitet', 'geloescht'];

/** 'JJJJ-MM-TT HH:00:00' in UTC */
function stundeVon(ms) {
    return new Date(Math.floor(ms / STUNDE_MS) * STUNDE_MS).toISOString().slice(0, 19).replace('T', ' ');
}

class Messprobe {
    /**
     * @param {{ uhr?: () => number }} [optionen] `uhr` nur für den Wächter
     */
    constructor({ uhr = Date.now } = {}) {
        this.uhr = uhr;
        /** @type {Map<string, object>} `${guild}|${stunde}` → Eimer */
        this.eimer = new Map();
        this.zeitgeber = null;
        this.beendet = false;
        this.endeGeprueftUm = 0;
        this.fehlerGemeldetUm = 0;
        this.schreibtGerade = false;
    }

    _eimer(guildId) {
        if (this.beendet || !guildId) return null;
        if (!this.zeitgeber) {
            this.zeitgeber = setInterval(() => this.schreibe(), TAKT_MS);
            this.zeitgeber.unref?.();
        }
        const stunde = stundeVon(this.uhr());
        const schluessel = `${guildId}|${stunde}`;
        let e = this.eimer.get(schluessel);
        if (!e) {
            e = { guildId: String(guildId), stunde, minuten: new Set(), minutenGeschrieben: 0 };
            for (const z of ZAHLEN) e[z] = 0;
            this.eimer.set(schluessel, e);
        }
        return e;
    }

    /** @param {import('discord.js').Message} message */
    nachricht(message) {
        const e = this._eimer(message?.guildId);
        if (!e) return;
        const bot = Boolean(message.author?.bot || message.webhookId);
        if (bot) e.bots++;
        else {
            e.menschen++;
            if (message.author?.id) e.minuten.add(`${message.author.id}:${Math.floor(this.uhr() / 60_000)}`);
        }
        e.inhalt_bytes += Buffer.byteLength(message.content || '', 'utf8');
        e.anhaenge += message.attachments?.size || 0;
    }

    /**
     * Nur echte Bearbeitungen: Discord schickt `messageUpdate` auch, wenn eine
     * Vorschau nachgeladen wird; dann bleibt der Bearbeitungszeitpunkt gleich
     * oder fehlt.
     *
     * @param {import('discord.js').Message} alt
     * @param {import('discord.js').Message} neu
     */
    bearbeitet(alt, neu) {
        if (!neu?.editedTimestamp) return;
        if (alt && !alt.partial && alt.editedTimestamp === neu.editedTimestamp) return;
        const e = this._eimer(neu.guildId);
        if (e) e.bearbeitet++;
    }

    /** @param {string} guildId @param {number} [anzahl] */
    geloescht(guildId, anzahl = 1) {
        const e = this._eimer(guildId);
        if (e) e.geloescht += anzahl;
    }

    /** Einmal je Stunde: Ist die Woche voll? */
    async _pruefeEnde(db) {
        const jetzt = this.uhr();
        if (jetzt - this.endeGeprueftUm < STUNDE_MS) return;
        this.endeGeprueftUm = jetzt;
        const [z] = await db.query('SELECT TIMESTAMPDIFF(HOUR, MIN(stunde), ?) AS stunden FROM messprobe_nachrichten', [stundeVon(jetzt)]);
        if (z?.stunden == null || Number(z.stunden) < DAUER_STUNDEN) return;
        this.beendet = true;
        this.eimer.clear();
        if (this.zeitgeber) clearInterval(this.zeitgeber);
        this.zeitgeber = null;
        ServiceManager.get('Logger').info(`[Messprobe] G-18: sieben Tage gezählt (${z.stunden} h), Zähler aus. Auswerten: node scripts/messprobe-auswerten.js`);
    }

    /** Schreibt die Zuwächse seit dem letzten Mal. Zählt weiter, wenn es scheitert. */
    async schreibe() {
        // Hängt die Datenbank länger als ein Takt, schreibt kein zweiter Lauf dieselben Zuwächse.
        if (this.beendet || this.schreibtGerade) return;
        this.schreibtGerade = true;
        const db = ServiceManager.get('dbService');
        try {
            await this._pruefeEnde(db);
            if (this.beendet) return;
            const aktuell = stundeVon(this.uhr());
            for (const [schluessel, e] of this.eimer) {
                const stand = { minuten: e.minuten.size };
                for (const z of ZAHLEN) stand[z] = e[z];
                const neueMinuten = stand.minuten - e.minutenGeschrieben;
                if (neueMinuten > 0 || ZAHLEN.some((z) => stand[z] > 0)) {
                    await db.query(
                        `INSERT INTO messprobe_nachrichten
                            (guild_id, stunde, menschen, bots, inhalt_bytes, anhaenge, mitglied_minuten, bearbeitet, geloescht)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                         ON DUPLICATE KEY UPDATE
                            menschen = menschen + VALUES(menschen),
                            bots = bots + VALUES(bots),
                            inhalt_bytes = inhalt_bytes + VALUES(inhalt_bytes),
                            anhaenge = anhaenge + VALUES(anhaenge),
                            mitglied_minuten = mitglied_minuten + VALUES(mitglied_minuten),
                            bearbeitet = bearbeitet + VALUES(bearbeitet),
                            geloescht = geloescht + VALUES(geloescht)`,
                        [e.guildId, e.stunde, stand.menschen, stand.bots, stand.inhalt_bytes, stand.anhaenge,
                            neueMinuten, stand.bearbeitet, stand.geloescht]
                    );
                    // Abziehen, was geschrieben ist: Was während des Schreibens
                    // dazukam, bleibt für das nächste Mal.
                    for (const z of ZAHLEN) e[z] -= stand[z];
                    e.minutenGeschrieben = stand.minuten;
                }
                if (e.stunde < aktuell && ZAHLEN.every((z) => e[z] === 0) && e.minuten.size === e.minutenGeschrieben) {
                    this.eimer.delete(schluessel);
                }
            }
        } catch (error) {
            const jetzt = this.uhr();
            if (jetzt - this.fehlerGemeldetUm >= STUNDE_MS) {
                this.fehlerGemeldetUm = jetzt;
                ServiceManager.get('Logger').error('[Messprobe] G-18: Schreiben gescheitert, zähle weiter und versuche es in einer Minute wieder:', error);
            }
        } finally {
            this.schreibtGerade = false;
        }
    }
}

module.exports = new Messprobe();
module.exports.Messprobe = Messprobe;
module.exports.stundeVon = stundeVon;
module.exports.DAUER_STUNDEN = DAUER_STUNDEN;
