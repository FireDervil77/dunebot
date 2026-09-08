'use strict';

/**
 * Wie lang ist eine Tondatei?
 *
 * ── Warum es diese Datei gibt (Befund des Betreibers, 2026-09-07) ───────────
 *
 * „die gesamte restspielzeit der box wird ebenfalls nicht angegeben."
 *
 * Gemessen: `music_files.dauer_sek` wurde an DREI Stellen gelesen und an
 * KEINER geschrieben. Alle sechs Dateien in der Ablage standen auf NULL. Die
 * Restspielzeit ist die Summe der Dauern — sie war also immer 0, und
 * `spielzeitText(0)` schreibt „—". Die Anzeige war richtig, ihre Eingabe fehlte.
 *
 * ── Warum ffmpeg und nicht ffprobe ─────────────────────────────────────────
 *
 * `ffprobe` liegt hier nicht (gemessen: nicht im PATH, und `ffmpeg-static`
 * liefert nur ffmpeg). ffmpeg selbst nennt die Dauer im Kopf seiner Ausgabe,
 * wenn man ihm kein Ziel gibt: Es liest den Dateikopf, meldet „Duration:
 * 00:02:04.49" und bricht mit Rueckgabewert 1 ab, weil nichts zu tun ist.
 * **Dieser Fehlschlag ist der Normalfall** — deshalb wird `stderr` auch im
 * Fehlerzweig gelesen und der Rueckgabewert nicht geprueft.
 *
 * Kein Dekodieren der ganzen Datei (`-f null -`): Das laedt bei einer Stunde
 * Musik minutenlang die CPU, um eine Zahl zu erfahren, die im Kopf steht.
 */

const { execFile } = require('child_process');
const ffmpegPfad = require('ffmpeg-static');

/**
 * Wie lange darf das Messen dauern.
 *
 * Zehn Sekunden sind fuer einen Dateikopf absurd viel — genau deshalb ist die
 * Zahl so gewaehlt: Wer sie reisst, hat kein langsames Laufwerk, sondern eine
 * kaputte Datei, an der ffmpeg haengt. Ohne Frist haengt der Upload mit.
 */
const FRIST_MS = 10000;

/**
 * Die Dauer einer Tondatei in Sekunden.
 *
 * **Wirft nie.** Eine unbekannte Dauer ist ein Anzeigemangel, kein Grund, einen
 * Upload scheitern zu lassen — die Datei ist dann trotzdem abspielbar.
 *
 * @param {string} pfad Vollstaendiger Pfad zur Datei
 * @returns {Promise<number|null>} Sekunden (gerundet) oder null
 */
function dauerLesen(pfad) {
    return new Promise((fertig) => {
        if (!pfad || !ffmpegPfad) return fertig(null);

        execFile(ffmpegPfad, ['-hide_banner', '-i', pfad],
            { timeout: FRIST_MS, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 },
            (_fehler, _aus, fehlerstrom) => fertig(ausText(fehlerstrom)));
    });
}

/**
 * Die Zeile „Duration: 00:02:04.49" aus ffmpegs Ausgabe holen.
 *
 * Ausdruecklich exportiert, damit `scripts/check-musik-dauer.js` sie ohne
 * ffmpeg pruefen kann — sonst haenge die Pruefung an einer fremden Ausgabe,
 * die niemand nachstellt.
 *
 * @param {string} text Was ffmpeg nach stderr geschrieben hat
 * @returns {number|null} Sekunden oder null
 */
function ausText(text) {
    // „Duration: N/A" kommt bei Datenstroemen ohne Kopf vor. Kein Treffer ist
    // dann richtig — eine 0 waere eine Behauptung.
    const treffer = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(String(text || ''));
    if (!treffer) return null;

    const sek = Number(treffer[1]) * 3600 + Number(treffer[2]) * 60 + Number(treffer[3]);
    if (!Number.isFinite(sek) || sek <= 0) return null;

    return Math.round(sek);
}

module.exports = { dauerLesen, ausText };
