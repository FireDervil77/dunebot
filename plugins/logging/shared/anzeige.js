'use strict';

/**
 * Logging: Ereignis lesbar machen (LG-1b/LG-1f Grundstock, K382, 2026-11-16).
 *
 * Rein: macht aus Vorher/Nachher eine Liste von Zeilen, die die Seite mit
 * Namen füllt. IDs bleiben IDs, die Seite löst sie auf (Mitglieder aus
 * `log_namen`, Rollen über den Bot). Escapt wird beim Anzeigen, nicht hier
 * ([[beim-anzeigen-escapen]]).
 *
 * Zeilenarten:
 *   { art: 'feld', feld, vorher, nachher }               einfache Änderung
 *   { art: 'rollen', dazu: [id], weg: [id] }              Rollen eines Mitglieds
 *   { art: 'rechte', ziel, typ, zustand, erlaubt, verboten }  Überschreibung oder Rollenrechte
 *
 * @module logging/shared/anzeige
 */

const IDS = /^\d{5,20}$/;

function alsJson(w) {
    if (w == null) return null;
    if (typeof w === 'object') return w;
    try { return JSON.parse(w); } catch { return null; }
}

/**
 * @param {{vorher: string|object|null, nachher: string|object|null, art: string}} e Zeile aus `log_ereignisse`
 * @returns {Array<object>}
 */
function zeilen(e) {
    const vorher = alsJson(e.vorher) || {};
    const nachher = alsJson(e.nachher) || {};
    const aus = [];
    if (Array.isArray(nachher.dazu) || Array.isArray(nachher.weg)) {
        aus.push({ art: 'rollen', dazu: nachher.dazu || [], weg: nachher.weg || [] });
    }
    for (const r of nachher.rechte || []) {
        aus.push({ art: 'rechte', ziel: r.ziel, typ: r.typ, zustand: r.zustand, erlaubt: r.erlaubt, verboten: r.verboten });
    }
    if (nachher.erlaubt && !Array.isArray(nachher.erlaubt)) {
        aus.push({ art: 'rechte', ziel: null, typ: 'rolle', zustand: 'geaendert', erlaubt: nachher.erlaubt, verboten: { neu: [], weg: [] } });
    }
    const sonder = new Set(['dazu', 'weg', 'rechte', 'erlaubt']);
    const felder = new Set([...Object.keys(vorher), ...Object.keys(nachher)].filter((f) => !sonder.has(f)));
    for (const f of felder) {
        aus.push({ art: 'feld', feld: f, vorher: wert(vorher[f]), nachher: wert(nachher[f]) });
    }
    return aus;
}

function wert(w) {
    if (w == null) return null;
    if (Array.isArray(w)) return w.join(', ');
    if (typeof w === 'object') return JSON.stringify(w);
    return String(w);
}

/** Alle Rollen-IDs, die eine Liste von Zeilen nennt (für eine Abfrage beim Bot). */
function rollenIds(listen) {
    const ids = new Set();
    for (const z of listen.flat()) {
        if (z.art === 'rollen') [...z.dazu, ...z.weg].forEach((id) => ids.add(String(id)));
        if (z.art === 'rechte' && z.typ === 'rolle' && z.ziel && IDS.test(String(z.ziel))) ids.add(String(z.ziel));
    }
    return [...ids];
}

/** Alle Mitglieds-IDs aus Überschreibungen (Namen aus `log_namen`). */
function mitgliedIds(listen) {
    const ids = new Set();
    for (const z of listen.flat()) {
        if (z.art === 'rechte' && z.typ === 'mitglied' && z.ziel && IDS.test(String(z.ziel))) ids.add(String(z.ziel));
    }
    return [...ids];
}

module.exports = { zeilen, rollenIds, mitgliedIds };
