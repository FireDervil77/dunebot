/**
 * Vorlademodul für check-attrappen-projektion.js (K108, 2026-11-09).
 *
 * Hängt sich an jede dbService-Attrappe, die ein Wächter über
 * ServiceManager.register anmeldet. Bei jedem SELECT vergleicht es die Zeilen
 * mit den Spalten, die die Abfrage nennt, und gibt mit SONDE_PROJIZIEREN=1
 * nur diese zurück — wie die echte Datenbank. Liefert eine Attrappe ganze
 * Zeilen, bliebe ein Wächter sonst grün, obwohl der Code eine Spalte liest,
 * die er nicht abfragt (gemessen: check-streaming-befehle 188/188 grün mit
 * fehlendem `antwort`, projiziert 29 Abweichungen).
 *
 * SELECT mit * oder mit Ausdrücken ohne AS-Namen misst es nicht, statt zu raten.
 */
'use strict';
const fs = require('fs');
const { ServiceManager } = require(require('path').join(__dirname, '..', '..', 'node_modules', 'dunebot-core'));
const ZIEL = process.env.SONDE_DATEI;
const skript = require('path').basename(process.argv[1] || '?');
const funde = new Map();   // sql -> {zuviel:Set, fehlt:Set}
function spalten(sql) {
    const m = /^SELECT\s+(?:DISTINCT\s+)?([\s\S]*?)\s+FROM\s/i.exec(sql);
    if (!m) return null;
    const teile = []; let tiefe = 0, akt = '';
    for (const z of m[1]) { if (z === '(') tiefe++; if (z === ')') tiefe--; if (z === ',' && tiefe === 0) { teile.push(akt); akt = ''; } else akt += z; }
    teile.push(akt);
    const namen = [];
    for (let t of teile) {
        t = t.trim();
        const alias = /\s+AS\s+`?([A-Za-z0-9_]+)`?\s*$/i.exec(t);
        if (alias) { namen.push(alias[1]); continue; }
        if (/\*/.test(t) || /[()\s]/.test(t)) return null;   // * oder Ausdruck ohne Namen: nicht raten
        namen.push(t.replace(/^`?[A-Za-z0-9_]+`?\./, '').replace(/`/g, ''));
    }
    return namen;
}
const orig = ServiceManager.register.bind(ServiceManager);
ServiceManager.register = function (name, service) {
    if (name === 'dbService' && service && typeof service.query === 'function' && !service.__sonde) {
        const q = service.query;
        service.query = async function (sql, ...rest) {
            const erg = await q.call(this, sql, ...rest);
            try {
                const s = String(sql).replace(/\s+/g, ' ').trim();
                const soll = /^SELECT/i.test(s) ? spalten(s) : null;
                if (soll && Array.isArray(erg) && erg.length && !Array.isArray(erg[0])) {
                    const f = funde.get(s) || { zuviel: new Set(), fehlt: new Set() };
                    for (const zeile of erg) {
                        if (!zeile || typeof zeile !== 'object') continue;
                        for (const k of Object.keys(zeile)) if (!soll.includes(k)) f.zuviel.add(k);
                        for (const k of soll) if (!(k in zeile)) f.fehlt.add(k);
                    }
                    if (f.zuviel.size || f.fehlt.size) funde.set(s, f);
                }
            } catch (_) { /* Messfehler der Sonde nicht in den Wächter tragen */ }
            if (process.env.SONDE_PROJIZIEREN === '1') {
                const s2 = String(sql).replace(/\s+/g, ' ').trim();
                const soll = /^SELECT/i.test(s2) ? spalten(s2) : null;
                if (soll && Array.isArray(erg) && !Array.isArray(erg[0])) {
                    return erg.map(z => (z && typeof z === 'object') ? Object.fromEntries(Object.entries(z).filter(([k]) => soll.includes(k))) : z);
                }
            }
            return erg;
        };
        service.__sonde = true;
    }
    return orig(name, service);
};
process.on('exit', () => {
    if (!funde.size || !ZIEL) return;
    const zeilen = [...funde].map(([sql, f]) => JSON.stringify({ skript, sql: sql.slice(0, 160), zuviel: [...f.zuviel], fehlt: [...f.fehlt] }));
    fs.appendFileSync(ZIEL, zeilen.join('\n') + '\n');
});
