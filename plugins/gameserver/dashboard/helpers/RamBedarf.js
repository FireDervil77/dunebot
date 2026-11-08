/**
 * Wie viel Arbeitsspeicher braucht ein Server wirklich? (K055, 2026-11-08)
 *
 * Beim Verkleinern prüfte bisher niemand etwas. Gebucht ist die Grenze des
 * Containers: Braucht das Spiel mehr, beendet das System den Prozess. Das
 * zeigt sich nicht beim Speichern, sondern irgendwann im Spiel als Absturz.
 *
 * Grundlage ist die gemessene Spitze (`server_metrics.ram_mb_max`, aus dem
 * Herzschlag), nicht `gameservers.ram_used_mb`: Die steht auch bei einem
 * gestoppten Server noch auf dem letzten Wert. Eine Angabe im Paket
 * (`requirements.min_ram_mb`) gab es am 2026-11-08 bei keinem Paket.
 *
 * Gewarnt wird unter der Spitze der letzten 30 Tage plus 10 % Puffer. Die
 * Spitze selbst reicht nicht: Wer genau sie bucht, steht beim nächsten
 * Höchststand an der Grenze.
 */
'use strict';

const TAGE = 30;
const PUFFER = 1.1;

const SQL = `
    SELECT MAX(ram_mb_max) AS spitze
      FROM server_metrics
     WHERE server_id = ?
       AND ram_mb_max IS NOT NULL
       AND bucket_start > NOW() - INTERVAL ${TAGE} DAY`;

/** 5120 → „5 GiB“, 3031 → „3 GiB“ (auf eine Stelle), 900 → „900 MiB“. */
function alsText(mb) {
    if (mb < 1024) return `${mb} MiB`;
    const gib = Math.round((mb / 1024) * 10) / 10;
    return `${String(gib).replace('.', ',')} GiB`;
}

/**
 * Rechnet aus der Spitze den Bedarf. Rein, ohne Datenbank.
 *
 * @param {number|string|null} spitzeMb  MAX(ram_mb_max) der letzten 30 Tage
 * @returns {null|{spitzeMb: number, grenzeMb: number, text: string}}
 *          null heißt: nichts gemessen, es gibt nichts zu warnen
 */
function beurteile(spitzeMb) {
    const spitze = Number(spitzeMb);
    if (!Number.isFinite(spitze) || spitze <= 0) return null;
    const grenzeMb = Math.ceil(spitze * PUFFER);
    return {
        spitzeMb: spitze,
        grenzeMb,
        text: `Gemessen hat der Server in den letzten ${TAGE} Tagen bis zu ${alsText(spitze)} gebraucht. `
            + `Mit weniger als ${alsText(grenzeMb)} (Spitze plus 10 %) wird er beim nächsten Höchststand `
            + 'vom System beendet und stürzt ab.',
    };
}

/**
 * Prüft eine neue Grenze. Gewarnt wird nur beim Verkleinern: Eine bestehende
 * Buchung unter dem Bedarf ist ein Befund für die Serverseite, kein Grund,
 * das Speichern des Namens zu verweigern.
 *
 * @param {?object} bedarf      Ergebnis von `beurteile`
 * @param {number} neuMb        die gewählte Grenze
 * @param {?number} bisherMb    die bisherige Grenze (null = kein Limit)
 * @returns {null|string}       die Warnung, oder null
 */
function warnung(bedarf, neuMb, bisherMb) {
    if (!bedarf || !Number.isFinite(neuMb)) return null;
    const verkleinert = bisherMb == null || neuMb < Number(bisherMb);
    if (!verkleinert || neuMb >= bedarf.grenzeMb) return null;
    return `${alsText(neuMb)} ist weniger, als der Server braucht. ${bedarf.text}`;
}

/**
 * @param {{query: Function}} db   dbService (gibt die Zeilen direkt zurück)
 * @param {number|string} serverId
 */
async function lade(db, serverId) {
    const [zeile] = await db.query(SQL, [serverId]);
    return beurteile(zeile ? zeile.spitze : null);
}

module.exports = { lade, beurteile, warnung, alsText, TAGE, PUFFER, SQL };
