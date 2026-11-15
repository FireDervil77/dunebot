'use strict';

/**
 * Leveling: Regeln einer Guild lesen und anwenden (LV-1c, 2026-11-15).
 *
 * Reine Entscheidungen ohne Discord und ohne Datenbank stehen oben
 * (`kanalKette`, `pruefeRegeln`, `normalisiere`, `menge`, `Drossel`), damit
 * `scripts/check-leveling.js` sie ohne Bot prüft. Unten das Laden aus der
 * Datenbank mit kurzem Zwischenspeicher für den Bot.
 *
 * @module leveling/shared/regeln
 */

const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Reine Entscheidungen
// ---------------------------------------------------------------------------

/**
 * Die Kanäle, für die eine Regel greift, vom genauesten zum gröbsten:
 * Kanal (oder Thread), bei Threads der Kanal darunter, dann die Kategorie.
 * Wer einen Kanal ausnimmt, meint seine Threads mit (wie automod).
 *
 * @param {{channelId: string, channel?: object}} message
 * @returns {string[]}
 */
function kanalKette(message) {
    const kette = [String(message.channelId)];
    const kanal = message.channel;
    let eltern = null;
    if (kanal?.isThread?.() && kanal.parentId) {
        kette.push(String(kanal.parentId));
        eltern = kanal.parent || null;
    } else {
        eltern = kanal || null;
    }
    if (eltern?.parentId) kette.push(String(eltern.parentId));
    return [...new Set(kette)];
}

/**
 * Darf diese Nachricht XP bekommen, und mit welchem Faktor?
 *
 *   ausschliessen  Kanal (Kette) oder Rolle trifft → nein
 *   nur            gibt es solche Regeln, muss eine treffen (Kanäle und
 *                  Rollen getrennt) → sonst nein
 *   faktor         Kanal: die genaueste Regel der Kette gilt (Thread vor
 *                  Kanal vor Kategorie). Rolle: der höchste Faktor unter den
 *                  Rollen des Mitglieds. Beide werden multipliziert.
 *
 * Eine Regel mit `quelle` gilt nur dort, ohne `quelle` überall.
 *
 * @param {Array<{art, ziel_id, wirkung, faktor, quelle}>} regeln
 * @param {string} quelle `nachricht`, `sprache`
 * @param {string[]} kanaele aus `kanalKette`
 * @param {string[]} rollen Rollen-IDs des Mitglieds
 * @returns {{erlaubt: boolean, grund: string|null, faktor: number}}
 */
function pruefeRegeln(regeln, quelle, kanaele, rollen) {
    const gilt = (regeln || []).filter((r) => r.quelle == null || r.quelle === quelle);
    const hatRolle = new Set((rollen || []).map(String));
    const imKanal = (r) => kanaele.includes(String(r.ziel_id));
    const mitRolle = (r) => hatRolle.has(String(r.ziel_id));
    const von = (art, wirkung) => gilt.filter((r) => r.art === art && r.wirkung === wirkung);

    if (von('kanal', 'ausschliessen').some(imKanal)) return { erlaubt: false, grund: 'kanal_ausgeschlossen', faktor: 0 };
    if (von('rolle', 'ausschliessen').some(mitRolle)) return { erlaubt: false, grund: 'rolle_ausgeschlossen', faktor: 0 };
    const nurKanal = von('kanal', 'nur');
    if (nurKanal.length && !nurKanal.some(imKanal)) return { erlaubt: false, grund: 'kanal_nicht_erlaubt', faktor: 0 };
    const nurRolle = von('rolle', 'nur');
    if (nurRolle.length && !nurRolle.some(mitRolle)) return { erlaubt: false, grund: 'rolle_nicht_erlaubt', faktor: 0 };

    let kanalFaktor = 1;
    const kanalRegeln = von('kanal', 'faktor');
    for (const id of kanaele) {
        const r = kanalRegeln.find((x) => String(x.ziel_id) === id);
        if (r) { kanalFaktor = Number(r.faktor); break; }
    }
    const rollenFaktoren = von('rolle', 'faktor').filter(mitRolle).map((r) => Number(r.faktor));
    const rollenFaktor = rollenFaktoren.length ? Math.max(...rollenFaktoren) : 1;
    const faktor = (Number.isFinite(kanalFaktor) ? kanalFaktor : 1) * (Number.isFinite(rollenFaktor) ? rollenFaktor : 1);
    if (!(faktor > 0)) return { erlaubt: false, grund: 'faktor_null', faktor: 0 };
    return { erlaubt: true, grund: null, faktor };
}

/** Text für Länge und Gleichheit: ohne Groß/klein, Leerraum zusammengezogen. */
function normalisiere(text) {
    return String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Länge in Zeichen (Emoji zählen einmal), nicht in UTF-16-Einheiten. */
function laenge(text) {
    return [...String(text || '')].length;
}

/**
 * XP einer Vergabe: zufällig von…bis (beide eingeschlossen), mal Faktor,
 * gerundet. 0, wenn nichts übrig bleibt.
 *
 * @param {number} von
 * @param {number} bis
 * @param {number} faktor
 * @param {() => number} [zufall]
 */
function menge(von, bis, faktor = 1, zufall = Math.random) {
    const a = Math.min(Number(von), Number(bis));
    const b = Math.max(Number(von), Number(bis));
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
    const roh = a + Math.floor(zufall() * (b - a + 1));
    return Math.max(0, Math.round(roh * faktor));
}

/**
 * Taktung und Gleichheit je Mitglied, im Speicher des Bots. Ein Neustart
 * vergisst beides; schlimmstenfalls bekommt jemand nach dem Neustart eine
 * Vergabe früher.
 */
class Drossel {
    constructor({ uhr = Date.now } = {}) {
        this.uhr = uhr;
        /** `${guild}|${mitglied}|${quelle}` → letzte Vergabe (ms) */
        this.zuletzt = new Map();
        /** `${guild}|${mitglied}` → Map(hash → ms) */
        this.texte = new Map();
    }

    /**
     * Darf jetzt vergeben werden? Merkt sich die Vergabe gleich mit, damit
     * zwei Nachrichten in derselben Millisekunde nicht beide zählen.
     *
     * @returns {{ja: boolean, grund: string|null}}
     */
    pruefe({ guildId, mitglied, quelle, taktungS, text = null, fensterS = 0 }) {
        const jetzt = this.uhr();
        const k = `${guildId}|${mitglied}|${quelle}`;
        const letzte = this.zuletzt.get(k);
        if (letzte != null && jetzt - letzte < Number(taktungS) * 1000) return { ja: false, grund: 'taktung' };
        if (text != null && Number(fensterS) > 0) {
            const hash = crypto.createHash('sha1').update(text).digest('base64');
            const mk = `${guildId}|${mitglied}`;
            const bekannt = this.texte.get(mk) || new Map();
            const zeit = bekannt.get(hash);
            if (zeit != null && jetzt - zeit < Number(fensterS) * 1000) return { ja: false, grund: 'gleicher_text' };
            bekannt.set(hash, jetzt);
            this.texte.set(mk, bekannt);
        }
        this.zuletzt.set(k, jetzt);
        return { ja: true, grund: null };
    }

    /** Vergessen, was älter als `hoechstensS` ist (einmal je Minute). */
    aufraeumen(hoechstensS = 3600) {
        const grenze = this.uhr() - hoechstensS * 1000;
        for (const [k, t] of this.zuletzt) if (t < grenze) this.zuletzt.delete(k);
        for (const [k, m] of this.texte) {
            for (const [h, t] of m) if (t < grenze) m.delete(h);
            if (!m.size) this.texte.delete(k);
        }
    }
}

// ---------------------------------------------------------------------------
// Laden
// ---------------------------------------------------------------------------

/** So lange gilt eine gelesene Regel im Bot. Die Einstellseiten kommen mit LV-1i. */
const ZWISCHENSPEICHER_MS = 30_000;
const speicher = new Map();

/**
 * Regeln einer Guild: Einstellungen, Quellen, Kanal- und Rollenregeln.
 * `null`, wenn die Guild noch keine Einstellungen hat (das Dashboard spielt
 * sie beim Einschalten ein); dann vergibt der Bot nichts.
 *
 * @param {string} guildId
 * @param {{frisch?: boolean, db?: object}} [o]
 * @returns {Promise<{einstellungen: object, quellen: Object<string, object>, regeln: object[]}|null>}
 */
async function lade(guildId, { frisch = false, db = null } = {}) {
    const jetzt = Date.now();
    const alt = speicher.get(guildId);
    if (!frisch && alt && jetzt - alt.zeit < ZWISCHENSPEICHER_MS) return alt.wert;
    const d = db || require('dunebot-core').ServiceManager.get('dbService');
    const [einstellungen] = await d.query('SELECT * FROM level_einstellungen WHERE guild_id = ?', [guildId]);
    let wert = null;
    if (einstellungen) {
        const quellen = {};
        for (const q of await d.query('SELECT quelle, xp_von, xp_bis, taktung_s, aktiv FROM level_quellen WHERE guild_id = ?', [guildId])) {
            quellen[q.quelle] = { xp_von: Number(q.xp_von), xp_bis: Number(q.xp_bis), taktung_s: Number(q.taktung_s), aktiv: Boolean(q.aktiv) };
        }
        // DECIMAL kommt als Text: Number() vor dem Rechnen.
        const regeln = (await d.query('SELECT art, ziel_id, wirkung, faktor, quelle FROM level_regeln WHERE guild_id = ?', [guildId]))
            .map((r) => ({ ...r, ziel_id: String(r.ziel_id), faktor: r.faktor == null ? null : Number(r.faktor) }));
        wert = { einstellungen, quellen, regeln };
    }
    speicher.set(guildId, { zeit: jetzt, wert });
    return wert;
}

/** Nach dem Speichern im Dashboard oder für Proben. */
function vergiss(guildId) {
    if (guildId == null) speicher.clear();
    else speicher.delete(guildId);
}

module.exports = { kanalKette, pruefeRegeln, normalisiere, laenge, menge, Drossel, lade, vergiss, ZWISCHENSPEICHER_MS };
