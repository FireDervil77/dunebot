'use strict';

/**
 * Leveling: Eingaben der Einstellseiten prüfen (LV-1i, 2026-11-15).
 *
 * Reine Entscheidungen ohne Datenbank und ohne Discord, damit
 * `scripts/check-leveling.js` sie ohne Dashboard prüft. Die Seiten
 * (`dashboard/routes/guild.router.js`) prüfen hier, schreiben dann.
 *
 *   pruefeXp          Seite „XP-Regeln“: Quellen `nachricht`, `sprache` und
 *                     die Spamschutz-, Storno- und Sprachfelder aus
 *                     `level_einstellungen`
 *   raten             XP je Nachricht, Sekunden je Nachricht, XP je
 *                     Sprachminute — für die Kontrolltabelle der Stufen
 *   pruefeBelohnung   Seite „Belohnungen“: Stufe, Art, Rolle
 *   pruefeRegel       Seite „Ausschlüsse“: Kanal/Rolle, Wirkung, Faktor, Quelle
 *   wirkungAufKanaele Wie viele Kanäle eine Regel trifft, und wo XP noch geht
 *
 * Alle Werte sind frei (F-CL8). Die Grenzen schützen nur die Spalten (INT,
 * DECIMAL(6,2)) und den Bot vor Unsinn wie einer Taktung von −1.
 *
 * @module leveling/shared/einstellen
 */

const { ROLLEN_ARTEN } = require('./belohnungen');
const { pruefeRegeln } = require('./regeln');

/** Fehler mit Sprachschlüssel (unter `leveling:EINSTELLEN.`) und Werten. */
class Eingabefehler extends Error {
    constructor(schluessel, werte = {}) {
        super(schluessel);
        this.schluessel = schluessel;
        this.werte = werte;
    }
}

const GRENZEN = Object.freeze({
    xp: [0, 1_000_000],
    taktung_s: [0, 86_400],
    sprache_taktung_s: [60, 86_400],
    mindestlaenge: [0, 2_000],
    gleiche_fenster_s: [0, 86_400],
    storno_loeschen_min: [0, 10_080],
    sprache_min_menschen: [1, 99],
    stufe: [1, 10_000],
    faktor: [0.01, 100],
});

const QUELLEN = Object.freeze(['nachricht', 'sprache']);
const WIRKUNGEN = Object.freeze(['ausschliessen', 'nur', 'faktor']);
const ARTEN = Object.freeze(['kanal', 'rolle']);
const ID = /^\d{17,20}$/;

function ganz(wert, feld, [min, max]) {
    const s = String(wert ?? '').trim();
    if (!/^-?\d+$/.test(s)) throw new Eingabefehler('KEINE_ZAHL', { feld });
    const n = Number(s);
    if (n < min || n > max) throw new Eingabefehler('AUSSERHALB', { feld, min, max });
    return n;
}

function ja(wert) {
    return wert === true || wert === 'true' || wert === 1 || wert === '1' || wert === 'on';
}

/**
 * Seite „XP-Regeln“.
 *
 * @param {object} body `{ nachricht: {aktiv, xp_von, xp_bis, taktung_s}, sprache: {…}, einstellungen: {…} }`
 * @returns {{quellen: Object<string, {xp_von, xp_bis, taktung_s, aktiv}>, einstellungen: object}}
 * @throws {Eingabefehler}
 */
function pruefeXp(body) {
    const b = body || {};
    const quellen = {};
    for (const q of QUELLEN) {
        const roh = b[q] || {};
        const von = ganz(roh.xp_von, `${q}.xp_von`, GRENZEN.xp);
        const bis = ganz(roh.xp_bis, `${q}.xp_bis`, GRENZEN.xp);
        if (von > bis) throw new Eingabefehler('VON_UEBER_BIS', { feld: q });
        const takt = ganz(roh.taktung_s, `${q}.taktung_s`, q === 'sprache' ? GRENZEN.sprache_taktung_s : GRENZEN.taktung_s);
        quellen[q] = { xp_von: von, xp_bis: bis, taktung_s: takt, aktiv: ja(roh.aktiv) ? 1 : 0 };
    }
    const e = b.einstellungen || {};
    const einstellungen = {
        mindestlaenge: ganz(e.mindestlaenge, 'mindestlaenge', GRENZEN.mindestlaenge),
        gleiche_fenster_s: ganz(e.gleiche_fenster_s, 'gleiche_fenster_s', GRENZEN.gleiche_fenster_s),
        storno_loeschen_min: ganz(e.storno_loeschen_min, 'storno_loeschen_min', GRENZEN.storno_loeschen_min),
        storno_automod: ja(e.storno_automod) ? 1 : 0,
        sprache_min_menschen: ganz(e.sprache_min_menschen, 'sprache_min_menschen', GRENZEN.sprache_min_menschen),
        sprache_stumm_zaehlt: ja(e.sprache_stumm_zaehlt) ? 1 : 0,
    };
    return { quellen, einstellungen };
}

/**
 * Raten für die Kontrolltabelle: „Stufe n ≈ so viele Nachrichten, so lange
 * Schreiben, so lange Sprache“. Mittel aus von…bis; eine abgeschaltete Quelle
 * oder 0 XP gibt `null` (die Seite zeigt dann „—“). Faktoren und Ausschlüsse
 * bleiben außen vor, die Tabelle zeigt den Regelfall.
 *
 * @param {Object<string, {xp_von, xp_bis, taktung_s, aktiv}>} quellen
 * @returns {{xpJeNachricht: number|null, sekundenJeNachricht: number|null, xpJeSprachminute: number|null}}
 */
function raten(quellen) {
    const mittel = (q) => (q && q.aktiv ? (Number(q.xp_von) + Number(q.xp_bis)) / 2 : 0);
    const n = quellen?.nachricht;
    const s = quellen?.sprache;
    const xpN = mittel(n);
    const xpS = mittel(s);
    const taktS = Math.max(60, Number(s?.taktung_s) || 60);
    return {
        xpJeNachricht: xpN > 0 ? xpN : null,
        // Taktung 0: jede Nachricht zählt, Zeit ist dann nicht abschätzbar.
        sekundenJeNachricht: xpN > 0 && Number(n.taktung_s) > 0 ? Number(n.taktung_s) : null,
        xpJeSprachminute: xpS > 0 ? xpS / (taktS / 60) : null,
    };
}

/**
 * Eine Belohnung der Seite „Belohnungen“.
 *
 * @param {{stufe, art, wert}} b
 * @param {{rollen?: Array<{id, managed?, editable?}>|null, guildId?: string}} [o]
 *   `rollen` aus dem Bot; ohne Liste (Bot fort) wird nur die Form geprüft.
 * @returns {{stufe: number, art: string, wert: string, warnung: string|null}}
 */
function pruefeBelohnung(b, { rollen = null, guildId = null } = {}) {
    const stufe = ganz(b?.stufe, 'stufe', GRENZEN.stufe);
    const art = String(b?.art || '');
    if (!ROLLEN_ARTEN.includes(art)) throw new Eingabefehler('FALSCHE_ART');
    const wert = String(b?.wert || '');
    if (!ID.test(wert) || (guildId && wert === String(guildId))) throw new Eingabefehler('FALSCHE_ROLLE');
    let warnung = null;
    if (Array.isArray(rollen)) {
        const r = rollen.find((x) => String(x.id) === wert);
        if (!r) throw new Eingabefehler('FALSCHE_ROLLE');
        if (r.managed) throw new Eingabefehler('ROLLE_VERWALTET');
        // Über der Bot-Rolle: speichern geht, vergeben nicht. Der Hinweis am
        // Feld sagt es, die Antwort auch.
        if (r.editable === false) warnung = 'ROLLE_ZU_HOCH';
    }
    return { stufe, art, wert, warnung };
}

/**
 * Eine Regel der Seite „Ausschlüsse“.
 *
 * @param {{art, ziel_id, wirkung, faktor?, quelle?}} r
 * @param {{kanaele?: Array<{id}>|null, rollen?: Array<{id}>|null, guildId?: string}} [o]
 * @returns {{art, ziel_id, wirkung, faktor: number|null, quelle: string|null}}
 */
function pruefeRegel(r, { kanaele = null, rollen = null, guildId = null } = {}) {
    const art = String(r?.art || '');
    if (!ARTEN.includes(art)) throw new Eingabefehler('FALSCHE_ART');
    const wirkung = String(r?.wirkung || '');
    if (!WIRKUNGEN.includes(wirkung)) throw new Eingabefehler('FALSCHE_WIRKUNG');
    const ziel = String(r?.ziel_id || '');
    if (!ID.test(ziel)) throw new Eingabefehler(art === 'kanal' ? 'FALSCHER_KANAL' : 'FALSCHE_ROLLE');
    // @everyone (ID der Guild) nie: Ein Faktor für alle gehört in die XP-Regeln.
    if (art === 'rolle' && guildId && ziel === String(guildId)) throw new Eingabefehler('FALSCHE_ROLLE');
    const liste = art === 'kanal' ? kanaele : rollen;
    if (Array.isArray(liste) && !liste.some((x) => String(x.id) === ziel)) {
        throw new Eingabefehler(art === 'kanal' ? 'FALSCHER_KANAL' : 'FALSCHE_ROLLE');
    }
    let faktor = null;
    if (wirkung === 'faktor') {
        const s = String(r?.faktor ?? '').trim().replace(',', '.');
        if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new Eingabefehler('FALSCHER_FAKTOR');
        faktor = Number(s);
        if (faktor < GRENZEN.faktor[0] || faktor > GRENZEN.faktor[1]) throw new Eingabefehler('FALSCHER_FAKTOR');
        if (faktor === 1) throw new Eingabefehler('FAKTOR_EINS');
    }
    const q = r?.quelle == null || r.quelle === '' ? null : String(r.quelle);
    if (q !== null && !QUELLEN.includes(q)) throw new Eingabefehler('FALSCHE_QUELLE');
    return { art, ziel_id: ziel, wirkung, faktor, quelle: q };
}

/**
 * Gibt es dieselbe Regel schon? Der Schlüssel der Tabelle hilft nicht:
 * `quelle` ist NULL für „überall“, und NULL ist in MySQL nie gleich.
 */
function istDoppelt(regel, vorhandene) {
    return (vorhandene || []).some((v) => v.art === regel.art && String(v.ziel_id) === regel.ziel_id
        && v.wirkung === regel.wirkung && (v.quelle ?? null) === (regel.quelle ?? null));
}

/** Kategorien zählen nicht als Kanal, nur als Eltern (`KanalTypen.KANAL`: KATEGORIE 4). */
const KATEGORIE = 4;
/** Sprach-XP gibt es nur in Sprachkanälen und auf Bühnen (VOICE 2, BUEHNE 13). */
const SPRACHKANAELE = new Set([2, 13]);

/**
 * Wie wirken die Kanalregeln auf die Kanäle der Guild? Rollenregeln bleiben
 * außen vor (sie hängen am Mitglied).
 *
 * @param {Array<{art, ziel_id, wirkung, faktor, quelle}>} regeln
 * @param {Array<{id, type, parentId}>} kanaele aus `GET_GUILD_CHANNELS` (mit Kategorien)
 * @returns {{je: Object<string, number>, quellen: Object<string, {gesamt: number, mitXp: number, ohneXp: string[], mitFaktor: number}>}}
 *   `je[regelSchluessel]` = Kanäle, die die Regel trifft (Kategorie: ihre Kanäle)
 */
function wirkungAufKanaele(regeln, kanaele) {
    const liste = (kanaele || []).filter((k) => Number(k.type) !== KATEGORIE);
    const kanalRegeln = (regeln || []).filter((r) => r.art === 'kanal');
    const je = {};
    for (const r of kanalRegeln) {
        je[regelSchluessel(r)] = liste.filter((k) => String(k.id) === String(r.ziel_id) || String(k.parentId) === String(r.ziel_id)).length;
    }
    const quellen = {};
    for (const q of QUELLEN) {
        // Chat gibt es auch in Sprachkanälen, Sprache nur dort.
        const hier = q === 'sprache' ? liste.filter((k) => SPRACHKANAELE.has(Number(k.type))) : liste;
        const aus = { gesamt: hier.length, mitXp: 0, ohneXp: [], mitFaktor: 0 };
        for (const k of hier) {
            const kette = [String(k.id), ...(k.parentId ? [String(k.parentId)] : [])];
            const u = pruefeRegeln(kanalRegeln, q, kette, []);
            if (!u.erlaubt) aus.ohneXp.push(String(k.id));
            else {
                aus.mitXp += 1;
                if (u.faktor !== 1) aus.mitFaktor += 1;
            }
        }
        quellen[q] = aus;
    }
    return { je, quellen };
}

/** Schlüssel einer Regel für Anzeige und Zuordnung. */
function regelSchluessel(r) {
    return `${r.art}|${r.ziel_id}|${r.wirkung}|${r.quelle ?? ''}`;
}

module.exports = {
    Eingabefehler, GRENZEN, QUELLEN, WIRKUNGEN, ARTEN,
    pruefeXp, raten, pruefeBelohnung, pruefeRegel, istDoppelt, wirkungAufKanaele, regelSchluessel,
};
