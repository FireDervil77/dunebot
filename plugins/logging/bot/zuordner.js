'use strict';

/**
 * Logging: Täter aus dem Audit-Log zuordnen (LG-1c, K382, 2026-11-16).
 *
 * Discord schickt `guildAuditLogEntryCreate` selbst (Intent GuildModeration,
 * Recht „Audit-Log anzeigen“). Er kommt meist kurz nach dem Gateway-Ereignis,
 * manchmal davor. Deshalb gibt es zwei Seiten:
 *
 *   Ereignis zuerst   Es wartet höchstens `FENSTER_MS` (5 s, Konzept) auf
 *                     einen passenden Eintrag und wird dann geschrieben.
 *   Eintrag zuerst    Er bleibt `FENSTER_MS` im Speicher; ein passendes
 *                     Ereignis nimmt ihn sofort.
 *
 * Gewartet wird nur auf Arten, zu denen ein Eintrag kommen kann
 * (`audit.ARTEN_MIT_AUDIT`), und nur, wenn der Bot in der Guild das Recht hat.
 * Ohne Recht kommt nie ein Eintrag; das Ereignis wird sofort mit „unbekannt“
 * geschrieben (Rückfall), und die Seite „Ereignisse“ sagt es.
 *
 * Mehrdeutig (zwei Täter für dasselbe Ziel im Fenster): der zeitlich nächste,
 * Güte höchstens „wahrscheinlich“.
 *
 * Bündel: Löscht derselbe Moderator mehrere Nachrichten desselben Autors im
 * selben Kanal, zählt Discord den alten Eintrag hoch (ebenso beim
 * Verschieben/Trennen im Sprachkanal). Läuft ein Ereignis ohne Treffer ab und
 * kennt der Zuordner so ein Bündel aus den letzten 5 Minuten, fragt er das
 * Audit-Log genau einmal nach (`fetchAuditLogs`, Art und 10 Einträge) und
 * vergleicht die Zähler. Ohne bekanntes Bündel fragt er nie.
 *
 * Wartende Ereignisse leben nur im Speicher. Ein Neustart in diesen 5 s
 * verliert sie; das ist der Preis dafür, dass die Zeile (und mit LG-1d die
 * Meldung im Kanal) gleich mit Täter entsteht.
 *
 * @module logging/bot/zuordner
 */

const { PermissionFlagsBits } = require('discord.js');
const A = require('./audit');

const FENSTER_MS = 5_000;
const BUENDEL_MS = 5 * 60_000;
const HOECHSTENS_WARTEND = 2_000;
const ABRUF_TEILEN_MS = 1_000;

function standardGuild(guildId) {
    try {
        const client = require('dunebot-core').ServiceManager.get('client');
        return client?.guilds?.cache?.get(String(guildId)) || null;
    } catch {
        return null;
    }
}

class Zuordner {
    /**
     * @param {object} [o]
     * @param {Function} [o.guild]   guildId → Guild oder null (Wächter setzt eine Attrappe)
     * @param {Function} [o.jetzt]
     * @param {number} [o.fenster]
     */
    constructor({ guild = standardGuild, jetzt = Date.now, fenster = FENSTER_MS } = {}) {
        this.guild = guild;
        this.jetzt = jetzt;
        this.fenster = fenster;
        /** guildId → Array<{e, zeit, fertig, timer}> */
        this.wartend = new Map();
        /** guildId → Array<Kandidat & {zeit}> */
        this.eintraege = new Map();
        /** `${guildId}|${aktion}` → Map(eintragId → {k, anzahl, zeit}) */
        this.buendel = new Map();
        /** `${guildId}|${aktion}` → {zeit, promise} */
        this.abrufe = new Map();
        this.anzahlWartend = 0;
    }

    /** Hat der Bot in der Guild „Audit-Log anzeigen“? Ohne Guild im Speicher: nein. */
    hatRecht(guildId) {
        const g = this.guild(guildId);
        return Boolean(g?.members?.me?.permissions?.has?.(PermissionFlagsBits.ViewAuditLog));
    }

    /** Wer handelte? id, bot, name für `log_namen`. */
    akteurVon(guildId, id) {
        const g = this.guild(guildId);
        const m = g?.members?.cache?.get(String(id));
        const u = m?.user || g?.client?.users?.cache?.get(String(id));
        const name = u?.username ? { id: String(id), name: u.username, anzeigename: m?.displayName || u.globalName || '', bot: Boolean(u.bot) } : null;
        return { id: String(id), bot: u ? Boolean(u.bot) : undefined, name };
    }

    #aufraeumen(guildId) {
        const grenze = this.jetzt() - this.fenster;
        const liste = (this.eintraege.get(guildId) || []).filter((k) => k.zeit >= grenze);
        if (liste.length) this.eintraege.set(guildId, liste);
        else this.eintraege.delete(guildId);
        const bgrenze = this.jetzt() - BUENDEL_MS;
        for (const [schl, m] of this.buendel) {
            for (const [id, b] of m) if (b.zeit < bgrenze) m.delete(id);
            if (!m.size) this.buendel.delete(schl);
        }
    }

    /** Bester Kandidat aus einer Liste: nächster in der Zeit; zwei Täter → höchstens wahrscheinlich. */
    #waehle(treffer, zeit) {
        if (!treffer.length) return null;
        const best = treffer.reduce((a, b) => (Math.abs(b.zeit - zeit) < Math.abs(a.zeit - zeit) ? b : a));
        const mehrere = new Set(treffer.map((k) => k.akteur)).size > 1;
        return { k: best, guete: mehrere ? 'wahrscheinlich' : best.guete };
    }

    #ergebnis(guildId, e, k, guete) {
        return { e: A.wende(e, k, guete), akteur: this.akteurVon(guildId, k.akteur) };
    }

    /**
     * Ereignis: sofort mit Täter, nach Warten mit Täter, oder unverändert.
     *
     * @returns {Promise<{e: object, akteur: object|null}>}
     */
    async ordneZu(guildId, e) {
        guildId = String(guildId);
        const roh = { e, akteur: null };
        if (!A.ARTEN_MIT_AUDIT.has(e?.art)) return roh;
        if (e.akteur && e.zuordnung === 'sicher') return roh;
        if (!this.hatRecht(guildId)) return roh;

        this.#aufraeumen(guildId);
        const zeit = this.jetzt();
        const treffer = (this.eintraege.get(guildId) || []).filter((k) => A.passt(k, e));
        const w = this.#waehle(treffer, zeit);
        if (w) return this.#ergebnis(guildId, e, w.k, w.guete);

        if (this.anzahlWartend >= HOECHSTENS_WARTEND) return roh;
        return new Promise((fertig) => {
            const eintrag = { e, zeit, fertig, timer: null };
            eintrag.timer = setTimeout(() => this.#ablauf(guildId, eintrag), this.fenster);
            if (!this.wartend.has(guildId)) this.wartend.set(guildId, []);
            this.wartend.get(guildId).push(eintrag);
            this.anzahlWartend++;
        });
    }

    #nimm(guildId, eintrag) {
        const liste = this.wartend.get(guildId) || [];
        const i = liste.indexOf(eintrag);
        if (i < 0) return false;
        liste.splice(i, 1);
        if (!liste.length) this.wartend.delete(guildId);
        clearTimeout(eintrag.timer);
        this.anzahlWartend--;
        return true;
    }

    async #ablauf(guildId, eintrag) {
        if (!this.#nimm(guildId, eintrag)) return;
        let aus = { e: eintrag.e, akteur: null };
        try {
            const b = await this.#nachBuendel(guildId, eintrag.e);
            if (b) aus = this.#ergebnis(guildId, eintrag.e, b, 'wahrscheinlich');
        } catch (error) {
            require('dunebot-core').ServiceManager.get('Logger')?.warn?.(`[Logging] Audit-Nachfrage in ${guildId}: ${error.message}`);
        }
        eintrag.fertig(aus);
    }

    /**
     * Audit-Eintrag aus `guildAuditLogEntryCreate`. Weckt passende wartende
     * Ereignisse und bleibt für spätere `FENSTER_MS` im Speicher.
     *
     * @returns {number} Anzahl zugeordneter wartender Ereignisse
     */
    eintrag(guildId, auditEintrag) {
        guildId = String(guildId);
        const zeit = this.jetzt();
        let zugeordnet = 0;
        for (const roh of A.kandidaten(auditEintrag)) {
            const k = { ...roh, zeit };
            if (k.buendel) this.#merkeBuendel(guildId, k);
            for (const w of [...(this.wartend.get(guildId) || [])]) {
                if (!A.passt(k, w.e)) continue;
                // Mehrdeutig, wenn schon ein anderer Täter für dieses Ereignis im Speicher steht.
                const andere = (this.eintraege.get(guildId) || []).filter((x) => A.passt(x, w.e) && x.akteur !== k.akteur);
                if (!this.#nimm(guildId, w)) continue;
                w.fertig(this.#ergebnis(guildId, w.e, k, andere.length ? 'wahrscheinlich' : k.guete));
                zugeordnet++;
            }
            if (!this.eintraege.has(guildId)) this.eintraege.set(guildId, []);
            this.eintraege.get(guildId).push(k);
        }
        this.#aufraeumen(guildId);
        return zugeordnet;
    }

    #merkeBuendel(guildId, k) {
        const schl = `${guildId}|${k.aktion}`;
        if (!this.buendel.has(schl)) this.buendel.set(schl, new Map());
        const m = this.buendel.get(schl);
        const alt = m.get(k.eintragId);
        // Kommt derselbe Eintrag noch einmal geschoben, ist das eine Zählung mehr.
        m.set(k.eintragId, { k, anzahl: Math.max(k.anzahl, alt?.anzahl || 0), zeit: k.zeit });
    }

    /** Einmal je Guild und Aktion abrufen; gleichzeitige Abläufe teilen sich die Antwort. */
    #abrufen(guildId, aktion) {
        const schl = `${guildId}|${aktion}`;
        const alt = this.abrufe.get(schl);
        if (alt && this.jetzt() - alt.zeit < ABRUF_TEILEN_MS) return alt.promise;
        const g = this.guild(guildId);
        const promise = g?.fetchAuditLogs
            ? g.fetchAuditLogs({ type: aktion, limit: 10 }).then((l) => [...(l?.entries?.values?.() || [])])
            : Promise.resolve([]);
        this.abrufe.set(schl, { zeit: this.jetzt(), promise });
        return promise;
    }

    /**
     * Nach Ablauf: Hat ein bekanntes Bündel hochgezählt? Nur wenn eins
     * bekannt ist, das zum Ereignis passt; sonst keine Abfrage.
     */
    async #nachBuendel(guildId, e) {
        for (const aktion of A.BUENDEL_AKTIONEN[e.art] || []) {
            const m = this.buendel.get(`${guildId}|${aktion}`);
            const bekannt = [...(m?.values() || [])].filter((b) => A.passt(b.k, e));
            if (!bekannt.length) continue;
            const frisch = await this.#abrufen(guildId, aktion);
            for (const b of bekannt) {
                const neu = frisch.find((x) => String(x.id) === b.k.eintragId);
                const anzahl = Number(neu?.extra?.count ?? 0);
                if (anzahl > b.anzahl) {
                    b.anzahl += 1;
                    b.zeit = this.jetzt();
                    return b.k;
                }
            }
        }
        return null;
    }

    /** Für den Wächter und beim Entladen: alles Wartende sofort ohne Täter freigeben. */
    leeren() {
        for (const [guildId, liste] of [...this.wartend]) {
            for (const w of [...liste]) if (this.#nimm(guildId, w)) w.fertig({ e: w.e, akteur: null });
        }
        this.eintraege.clear();
        this.buendel.clear();
        this.abrufe.clear();
    }
}

/** Ein Zuordner für den Bot-Prozess. */
const zuordner = new Zuordner();

module.exports = { Zuordner, zuordner, FENSTER_MS, BUENDEL_MS };
