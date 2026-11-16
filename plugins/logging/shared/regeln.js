'use strict';

/**
 * Logging: Regeln einer Guild lesen und anwenden (LG-1b, K382, 2026-11-16).
 *
 * Oben die reine Entscheidung `darf` (ohne Discord, ohne Datenbank), damit
 * `scripts/check-logging.js` sie prüft. Unten das Laden mit kurzem
 * Zwischenspeicher für den Bot und die Menge „Kategorie in mindestens einer
 * Guild an“, die ein Erfasser vor jeder Arbeit fragt.
 *
 * @module logging/shared/regeln
 */

const { KATEGORIEN } = require('./katalog');

// ---------------------------------------------------------------------------
// Reine Entscheidungen
// ---------------------------------------------------------------------------

/**
 * Regelzeilen einer Guild in eine Form, die `darf` schnell fragt.
 *
 * @param {Array<{regel: string, ziel: string, aktiv: number|boolean}>} zeilen
 * @returns {{kategorien: Object<string, boolean>, artenAus: Set<string>, mitglieder: Set<string>, rollen: Set<string>, kanaele: Set<string>, bots: boolean}}
 */
function ordne(zeilen) {
    const r = { kategorien: {}, artenAus: new Set(), mitglieder: new Set(), rollen: new Set(), kanaele: new Set(), bots: false };
    for (const z of zeilen || []) {
        const an = Boolean(Number(z.aktiv));
        const ziel = String(z.ziel || '');
        if (z.regel === 'kategorie') r.kategorien[ziel] = an;
        else if (z.regel === 'art' && !an) r.artenAus.add(ziel);
        else if (z.regel === 'mitglied' && an) r.mitglieder.add(ziel);
        else if (z.regel === 'rolle' && an) r.rollen.add(ziel);
        else if (z.regel === 'kanal' && an) r.kanaele.add(ziel);
        else if (z.regel === 'bots') r.bots = an;
    }
    return r;
}

/** Ist die Kategorie an? Ohne Zeile gilt die Vorgabe aus dem Katalog. */
function kategorieAn(regeln, kategorie) {
    if (!KATEGORIEN[kategorie]) return false;
    const wert = regeln?.kategorien?.[kategorie];
    return wert === undefined ? Boolean(KATEGORIEN[kategorie].vorgabe) : wert;
}

/**
 * Darf dieses Ereignis gespeichert werden?
 *
 *   Kategorie aus        → nein
 *   Art aus              → nein
 *   kritisch             → ja, an jedem Ausschluss vorbei (Idee §5.2)
 *   Akteur oder Betroffener ausgeschlossen → nein
 *   eine Rolle des Betroffenen ausgeschlossen → nein
 *   Kanal ausgeschlossen (auch Eltern-Kanal oder Kategorie) → nein
 *   Bots ausgeschlossen und der Akteur ist ein Bot → nein
 *
 * Kategorie und Art bleiben auch bei `kritisch` maßgeblich: Wer die
 * Kategorie abschaltet, will sie nicht. Ausschlüsse sind etwas anderes, sie
 * nehmen einzelne Menschen oder Orte heraus, und dort darf Kritisches nicht
 * verschwinden.
 *
 * @param {object} regeln aus `ordne`
 * @param {{kategorie: string, art: string, schwere?: string, akteur?: string|null, betroffen?: string|null,
 *          rollen?: string[], kanaele?: string[], akteurIstBot?: boolean}} e
 * @returns {{erlaubt: boolean, grund: string|null}}
 */
function darf(regeln, e) {
    if (!kategorieAn(regeln, e.kategorie)) return { erlaubt: false, grund: 'kategorie_aus' };
    if (regeln?.artenAus?.has(e.art)) return { erlaubt: false, grund: 'art_aus' };
    if (e.schwere === 'kritisch') return { erlaubt: true, grund: null };
    const m = regeln?.mitglieder || new Set();
    if ((e.akteur && m.has(String(e.akteur))) || (e.betroffen && m.has(String(e.betroffen)))) {
        return { erlaubt: false, grund: 'mitglied' };
    }
    if ((e.rollen || []).some((id) => regeln?.rollen?.has(String(id)))) return { erlaubt: false, grund: 'rolle' };
    if ((e.kanaele || []).some((id) => regeln?.kanaele?.has(String(id)))) return { erlaubt: false, grund: 'kanal' };
    if (regeln?.bots && e.akteurIstBot) return { erlaubt: false, grund: 'bots' };
    return { erlaubt: true, grund: null };
}

// ---------------------------------------------------------------------------
// Laden (Bot)
// ---------------------------------------------------------------------------

const ZWISCHENSPEICHER_MS = 30_000;
const speicher = new Map();

/**
 * Regeln einer Guild, 30 s zwischengespeichert. Das Dashboard ruft nach dem
 * Speichern `vergiss` nur im eigenen Prozess; der Bot sieht die Änderung
 * spätestens nach 30 s.
 */
async function lade(guildId, { frisch = false, db = null } = {}) {
    const jetzt = Date.now();
    const alt = speicher.get(guildId);
    if (!frisch && alt && jetzt - alt.zeit < ZWISCHENSPEICHER_MS) return alt.wert;
    const d = db || require('dunebot-core').ServiceManager.get('dbService');
    const wert = ordne(await d.query('SELECT regel, ziel, aktiv FROM log_regeln WHERE guild_id = ?', [guildId]));
    speicher.set(guildId, { zeit: jetzt, wert });
    return wert;
}

function vergiss(guildId) {
    if (guildId == null) speicher.clear();
    else speicher.delete(guildId);
}

/**
 * Kategorien, die in mindestens einer Guild mit Logging an sind
 * (LG-1b: „Ein Erfasser hört nur, wenn der Bereich in mindestens einer Guild
 * an ist“). Einmal je Minute aus der Datenbank, sonst aus dem Speicher;
 * fragt der Erfasser, kostet das keine Abfrage.
 *
 * Ohne JOIN: Plugin-Tabellen und `guild_plugins` haben verschiedene
 * Kollationen ([[kollationsgrenze]]).
 */
const GLOBAL_MS = 60_000;
let global = { zeit: 0, menge: new Set(), laeuft: null };

async function ladeGlobal(db) {
    const enabled = await db.query("SELECT guild_id FROM guild_plugins WHERE plugin_name = 'logging' AND is_enabled = 1");
    const guilds = new Set(enabled.map((z) => String(z.guild_id)));
    const zeilen = guilds.size
        ? await db.query("SELECT guild_id, ziel, aktiv FROM log_regeln WHERE regel = 'kategorie'")
        : [];
    return mengeAus(guilds, zeilen);
}

/** Rein: Guilds mit Logging + Kategorie-Zeilen → Menge der Kategorien, die irgendwo an sind. */
function mengeAus(guilds, zeilen) {
    const jeGuild = new Map();
    for (const z of zeilen) {
        if (!guilds.has(String(z.guild_id))) continue;
        if (!jeGuild.has(String(z.guild_id))) jeGuild.set(String(z.guild_id), {});
        jeGuild.get(String(z.guild_id))[z.ziel] = Boolean(Number(z.aktiv));
    }
    const menge = new Set();
    for (const g of guilds) {
        const r = { kategorien: jeGuild.get(g) || {} };
        for (const k of Object.keys(KATEGORIEN)) if (kategorieAn(r, k)) menge.add(k);
    }
    return menge;
}

/**
 * Ist die Kategorie in irgendeiner Guild an? Beim ersten Aufruf und nach
 * einer Minute wird nachgeladen; bis dahin gilt der alte Stand. Scheitert
 * das Laden, bleibt der alte Stand und der nächste Aufruf versucht es neu.
 */
async function irgendwoAn(kategorie, { db = null } = {}) {
    if (Date.now() - global.zeit >= GLOBAL_MS) {
        if (!global.laeuft) {
            const d = db || require('dunebot-core').ServiceManager.get('dbService');
            global.laeuft = ladeGlobal(d)
                .then((menge) => { global = { zeit: Date.now(), menge, laeuft: null }; })
                .catch((err) => {
                    global.laeuft = null;
                    require('dunebot-core').ServiceManager.get('Logger')?.warn?.(`[Logging] Kategorien nicht geladen: ${err.message}`);
                });
        }
        if (!global.zeit) await global.laeuft;
    }
    return global.menge.has(kategorie);
}

/** Für Proben und nach dem Einschalten: nächster Aufruf lädt neu. */
function vergissGlobal() {
    global = { zeit: 0, menge: new Set(), laeuft: null };
}

module.exports = { ordne, kategorieAn, darf, mengeAus, lade, vergiss, irgendwoAn, vergissGlobal, ZWISCHENSPEICHER_MS };
