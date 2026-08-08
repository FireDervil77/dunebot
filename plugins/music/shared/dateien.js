'use strict';

/**
 * Musik - wo hochgeladene Tondateien liegen
 *
 * Dashboard und Bot sind zwei getrennte Vorgaenge, greifen aber auf dieselben
 * Dateien zu: das Dashboard legt sie ab, der Bot liest sie. Deshalb steht die
 * Pfadberechnung hier **einmal** und nicht zweimal - sonst zeigt sie irgendwann
 * auseinander, und der Bot sucht dort, wo nichts liegt.
 *
 * Der Ort lehnt sich an die vorhandene Medien-Bibliothek an
 * (`apps/dashboard/uploads/media/<guildId>/`), liegt aber in einem eigenen
 * Zweig: Bilder und Tondateien haben verschiedene Grenzen, verschiedene Rechte
 * und verschiedene Aufbewahrung.
 *
 * @module music/shared/dateien
 */

const path = require('path');
const fs = require('fs');

/** Wurzel aller Musik-Uploads, absolut. */
function basisVerzeichnis() {
    // shared/ -> music/ -> plugins/ -> Projektwurzel
    return path.join(__dirname, '..', '..', '..', 'apps', 'dashboard', 'uploads', 'musik');
}

/**
 * Verzeichnis einer Guild. Legt es an, wenn es fehlt.
 *
 * @param {string} guildId Discord-Guild-ID
 * @returns {string} Absoluter Pfad
 */
function guildVerzeichnis(guildId) {
    const ziel = path.join(basisVerzeichnis(), String(guildId));
    fs.mkdirSync(ziel, { recursive: true });
    return ziel;
}

/**
 * Absoluter Pfad zu einer abgelegten Datei.
 *
 * Der Dateiname kommt aus der Datenbank und wird beim Ablegen selbst vergeben -
 * trotzdem wird hier geprueft, dass das Ergebnis im Guild-Verzeichnis bleibt.
 * Ein Datenbankeintrag ist kein Beweis: Wer es schafft, dort `../../` hinein zu
 * bekommen, laese sonst beliebige Dateien des Servers vor.
 *
 * @param {string} guildId Discord-Guild-ID
 * @param {string} dateiname Gespeicherter Name
 * @returns {string|null} Absoluter Pfad oder null, wenn er ausbrechen wuerde
 */
function pfadFuer(guildId, dateiname) {
    if (!guildId || !dateiname) return null;

    const verzeichnis = path.join(basisVerzeichnis(), String(guildId));
    const voll = path.resolve(verzeichnis, String(dateiname));

    // `path.resolve` loest `..` auf - danach muss der Pfad immer noch unterhalb
    // des Guild-Verzeichnisses liegen.
    if (voll !== verzeichnis && !voll.startsWith(verzeichnis + path.sep)) return null;

    return voll;
}

/** Erlaubte Tonformate. Was ffmpeg nicht kennt, hilft hier niemandem. */
const ERLAUBTE_TYPEN = [
    'audio/mpeg', 'audio/mp3',
    'audio/ogg', 'audio/opus',
    'audio/wav', 'audio/x-wav', 'audio/wave',
    'audio/flac', 'audio/x-flac',
    'audio/mp4', 'audio/x-m4a', 'audio/aac',
    'audio/webm'
];

/** Endungen, die dazu passen - fuer den Fall, dass der Typ nicht mitkommt. */
const ERLAUBTE_ENDUNGEN = ['.mp3', '.ogg', '.opus', '.wav', '.flac', '.m4a', '.aac', '.webm'];

module.exports = {
    basisVerzeichnis,
    guildVerzeichnis,
    pfadFuer,
    ERLAUBTE_TYPEN,
    ERLAUBTE_ENDUNGEN
};
