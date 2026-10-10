'use strict';

/**
 * Muster für Dateien, die SPIELER abrufen dürfen (`files.public`, 2026-10-10).
 *
 * Dieselben Regeln wie im Daemon (`internal/pkgspec/oeffentlich.go`) — dort
 * gelten sie beim Ausliefern, hier beim Tippen: Der Fehler soll in der Werkbank
 * kommen und nicht erst als Lücke beim Start. `scripts/check-fastdl.js` hält
 * beide Seiten an derselben Liste von Fällen fest.
 *
 * Warum so streng: Ausgeliefert wird ohne Anmeldung, und neben den Karten
 * liegt die Konfiguration des Servers mit seinen Kennwörtern
 * (`etmain/etl_server.cfg` neben `etmain/*.pk3`).
 */

const MAX_MUSTER = 20;
const MAX_LAENGE = 200;

const RE_STUECK = /^[A-Za-z0-9_.*-]+$/;
const RE_ENDUNG = /\.([A-Za-z0-9]{1,8})$/;

/** Konfiguration, Geheimnisse, Datenbanken, Programme, Protokolle. */
const GESPERRT = new Set(['cfg', 'conf', 'config', 'ini', 'json', 'yaml', 'yml', 'xml', 'toml', 'properties', 'env', 'txt',
    'log', 'db', 'sqlite', 'sqlite3', 'dat', 'key', 'pem', 'crt', 'pid', 'bak', 'old', 'sh', 'bat',
    'cmd', 'exe', 'dll', 'so', 'lua', 'jar', 'php']);

/** Was an EINEM Muster nicht stimmt — leer heisst: in Ordnung. */
function pruefeMuster(m) {
    if (typeof m !== 'string' || !m.trim()) return 'leeres Muster';
    if (m.length > MAX_LAENGE) return 'zu lang';
    if (m.startsWith('/')) return 'beginnt mit „/" — Muster gelten ab game/';
    if (m.includes('\\')) return 'Ordner werden mit „/" getrennt';
    const stuecke = m.split('/');
    for (const s of stuecke) {
        if (s === '') return 'doppelter oder abschließender Schrägstrich';
        if (s === '..' || s === '.') return `„${s}" führt aus dem Ordner heraus`;
        if (s.startsWith('.')) return 'versteckte Dateien und Ordner werden nicht freigegeben';
        if (s.includes('**')) return '„**" gibt es nicht — der Stern steht für ein Stück Name, nicht für Unterordner';
        if (!RE_STUECK.test(s)) return 'erlaubt sind Buchstaben, Ziffern, _ . - und der Stern';
    }
    const endung = RE_ENDUNG.exec(stuecke[stuecke.length - 1]);
    if (!endung) return 'das Muster nennt keine Endung — freigegeben wird nur nach Dateiart, etwa *.pk3';
    if (GESPERRT.has(endung[1].toLowerCase())) {
        return `die Endung .${endung[1]} wird nicht freigegeben (Konfiguration, Geheimnis oder Programm)`;
    }
    return '';
}

/** Mängel einer ganzen Liste — leer heisst: in Ordnung. */
function pruefe(muster) {
    const mangel = [];
    if (!Array.isArray(muster)) return ['files.public ist keine Liste'];
    if (muster.length > MAX_MUSTER) mangel.push(`mehr als ${MAX_MUSTER} Muster`);
    for (const m of muster) {
        const grund = pruefeMuster(m);
        if (grund) mangel.push(`„${m}": ${grund}`);
    }
    return mangel;
}

module.exports = { MAX_MUSTER, MAX_LAENGE, GESPERRT, pruefeMuster, pruefe };
