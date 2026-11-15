'use strict';

/**
 * Leveling: Zähler je Mitglied (LV-1c, 2026-11-15).
 *
 * Nachrichten und Sprachminuten (später Reaktionen) für Abzeichen und
 * Profil, ohne Inhalt. Gezählt wird im Speicher, geschrieben einmal je
 * Minute als Zuwachs, wie bei der Messprobe G-18: eine Zeile je aktivem
 * Mitglied und Minute statt einer je Nachricht. Ein Neustart verliert
 * höchstens die laufende Minute. Scheitert das Schreiben, bleibt alles
 * gezählt; der Fehler steht einmal je Stunde im Log.
 *
 * @module leveling/bot/zaehler
 */

const { ServiceManager } = require('dunebot-core');

const STUNDE_MS = 3_600_000;

class Zaehler {
    constructor({ uhr = Date.now } = {}) {
        this.uhr = uhr;
        /** `${guild}|${mitglied}` → { guildId, mitglied, nachrichten, sprachminuten, reaktionen, erste } */
        this.offen = new Map();
        this.schreibtGerade = false;
        this.fehlerGemeldetUm = 0;
    }

    _eintrag(guildId, mitglied) {
        const k = `${guildId}|${mitglied}`;
        let e = this.offen.get(k);
        if (!e) {
            e = { guildId: String(guildId), mitglied: String(mitglied), nachrichten: 0, sprachminuten: 0, reaktionen: 0, erste: null };
            this.offen.set(k, e);
        }
        return e;
    }

    nachricht(guildId, mitglied) {
        const e = this._eintrag(guildId, mitglied);
        e.nachrichten++;
        if (!e.erste) e.erste = new Date(this.uhr());
    }

    /** Eine Minute im Sprachkanal, die die Bedingungen erfüllt (LV-1d). */
    sprachminute(guildId, mitglied) {
        this._eintrag(guildId, mitglied).sprachminuten++;
    }

    /** Schreibt die Zuwächse; was währenddessen dazukommt, bleibt für das nächste Mal. */
    async schreibe(db = ServiceManager.get('dbService')) {
        if (this.schreibtGerade || !this.offen.size) return 0;
        this.schreibtGerade = true;
        let zeilen = 0;
        try {
            for (const [k, e] of [...this.offen]) {
                const stand = { nachrichten: e.nachrichten, sprachminuten: e.sprachminuten, reaktionen: e.reaktionen, erste: e.erste };
                await db.query(
                    `INSERT INTO level_zaehler (guild_id, mitglied_id, nachrichten, sprachminuten, reaktionen, erste_nachricht)
                     VALUES (?, ?, ?, ?, ?, ?)
                     ON DUPLICATE KEY UPDATE
                        nachrichten = nachrichten + VALUES(nachrichten),
                        sprachminuten = sprachminuten + VALUES(sprachminuten),
                        reaktionen = reaktionen + VALUES(reaktionen),
                        erste_nachricht = COALESCE(erste_nachricht, VALUES(erste_nachricht))`,
                    [e.guildId, e.mitglied, stand.nachrichten, stand.sprachminuten, stand.reaktionen, stand.erste]
                );
                zeilen++;
                e.nachrichten -= stand.nachrichten;
                e.sprachminuten -= stand.sprachminuten;
                e.reaktionen -= stand.reaktionen;
                if (!e.nachrichten && !e.sprachminuten && !e.reaktionen) this.offen.delete(k);
                else e.erste = null;
            }
        } catch (error) {
            const jetzt = this.uhr();
            if (jetzt - this.fehlerGemeldetUm >= STUNDE_MS) {
                this.fehlerGemeldetUm = jetzt;
                ServiceManager.get('Logger').error('[Leveling] Zähler nicht geschrieben, zähle weiter und versuche es in einer Minute wieder:', error);
            }
        } finally {
            this.schreibtGerade = false;
        }
        return zeilen;
    }
}

module.exports = new Zaehler();
module.exports.Zaehler = Zaehler;
