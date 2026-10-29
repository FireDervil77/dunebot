'use strict';

/**
 * Auslastung eines RootServers zum Zeichnen — eine Rechnung für Seite und Live-Strom.
 *
 * Das Widget „RootServer" rechnete Prozent und Farbe im EJS, die Detailseite
 * rechnet sie im Browser mit eigenen Schwellen. Seit 2026-10-28 (Baustelle 207)
 * zieht das Widget live nach: Damit dafür nicht eine dritte Kopie der Schwellen
 * im Browser entsteht, rechnet der Server hier, und das Widget zeichnet nur —
 * beim Laden aus der Zeile (`ausZeile`), danach aus `host_stats`: Herzschlag
 * (30 s) und Live-Takt (3 s, solange bestellt) gehen beide durch
 * `IPMServer._sendeHostStats`, das `anzeige` mit `baue` rechnet.
 *
 * Zahlen aus MySQL kommen bei DECIMAL als Text; darum überall `Number()`.
 *
 * @module helpers/Auslastung
 */

/** Ab wie viel Prozent gelb (warnung) und rot (gefahr); darunter die Grundfarbe. */
const SCHWELLEN = {
    cpu:  { warnung: 60, gefahr: 80, grund: 'success' },
    ram:  { warnung: 65, gefahr: 85, grund: 'info' },
    disk: { warnung: 70, gefahr: 90, grund: 'primary' },
};

/** @returns {number|null} Zahl, oder null, wenn keine da ist */
function zahl(wert) {
    if (wert === null || wert === undefined || wert === '') return null;
    const n = Number(wert);
    return Number.isFinite(n) ? n : null;
}

/**
 * Ein Balken: Prozent, Farbe, Text. Ohne Messwert `pct: null` und Text „–".
 *
 * @param {'cpu'|'ram'|'disk'} art
 * @param {number|null} pct
 * @returns {{pct: number|null, farbe: string, text: string}}
 */
function balken(art, pct) {
    const s = SCHWELLEN[art];
    if (pct === null) return { pct: null, farbe: s.grund, text: '–' };
    const gerundet = Math.round(Math.min(100, Math.max(0, pct)));
    const farbe = gerundet >= s.gefahr ? 'danger' : gerundet >= s.warnung ? 'warning' : s.grund;
    return { pct: gerundet, farbe, text: gerundet + '%' };
}

/** @returns {number|null} Anteil in Prozent, oder null ohne Gesamtgröße */
function anteil(teil, ganz) {
    const t = zahl(teil), g = zahl(ganz);
    return t !== null && g !== null && g > 0 ? (t / g) * 100 : null;
}

/**
 * @param {{online: boolean, cpu_percent?, ram_used_gb?, ram_total_gb?, disk_used_gb?, disk_total_gb?}} werte
 * @returns {{online: boolean, cpu: Object, ram: Object, disk: Object}}
 */
function baue(werte) {
    return {
        online: Boolean(werte.online),
        cpu:  balken('cpu', zahl(werte.cpu_percent)),
        ram:  balken('ram', anteil(werte.ram_used_gb, werte.ram_total_gb)),
        disk: balken('disk', anteil(werte.disk_used_gb, werte.disk_total_gb)),
    };
}

/**
 * Aus einer Zeile der Tabelle `rootserver` (wie `RootServer.getByGuild` sie liefert).
 *
 * @param {Object} rs
 */
function ausZeile(rs) {
    return baue({
        online: rs.daemon_status === 'online',
        cpu_percent: rs.cpu_usage_percent,
        ram_used_gb: rs.ram_usage_gb, ram_total_gb: rs.ram_total_gb,
        disk_used_gb: rs.disk_usage_gb, disk_total_gb: rs.disk_total_gb,
    });
}

module.exports = { baue, ausZeile, SCHWELLEN };
