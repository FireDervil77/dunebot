/**
 * Musik - kleine Darstellungshelfer
 *
 * Liegt bewusst fuer sich: `steuerung.js` und `GuildPlayer` brauchen beide
 * die Dauer-Darstellung. Laege sie weiter im `GuildPlayer`, muesste
 * `steuerung.js` ihn laden - und weil der `GuildPlayer` seinerseits
 * `steuerung.js` braucht, waere das ein Ringschluss. Node liefert bei so
 * etwas ein halb fertiges Modul aus, und der Fehler faellt erst beim ersten
 * Aufruf auf.
 *
 * @module music/bot/format
 */

/**
 * Sekunden als mm:ss oder h:mm:ss.
 *
 * @param {number|null} sek Sekunden
 * @returns {string} Lesbare Dauer; "live" wenn keine Dauer bekannt ist
 */
function dauerText(sek) {
    if (!sek || sek <= 0) return 'live';

    const stunden = Math.floor(sek / 3600);
    const minuten = Math.floor((sek % 3600) / 60);
    const rest = sek % 60;

    return stunden > 0
        ? `${stunden}:${String(minuten).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
        : `${minuten}:${String(rest).padStart(2, '0')}`;
}

/**
 * Ein Fortschrittsbalken aus Textzeichen.
 *
 * @param {number} position Sekunden
 * @param {number|null} dauer Gesamtdauer in Sekunden
 * @param {number} [breite=18] Anzahl Zeichen
 * @returns {string|null} Balken oder null, wenn es nichts zu zeigen gibt
 */
function fortschritt(position, dauer, breite = 18) {
    // Internetradio hat keine Dauer - da waere ein Balken eine Luege
    if (!dauer || dauer <= 0) return null;

    const anteil = Math.max(0, Math.min(1, position / dauer));
    const stelle = Math.min(breite - 1, Math.floor(anteil * breite));

    return '▬'.repeat(stelle) + '🔘' + '▬'.repeat(breite - stelle - 1);
}

module.exports = { dauerText, fortschritt };
