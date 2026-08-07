/**
 * Musik - Klangfilter
 *
 * Die Filter sind ffmpeg-Audiofilter, die zwischen Quelle und Discord gelegt
 * werden. `prism-media` (kommt mit @discordjs/voice) startet dafuer einen
 * ffmpeg-Vorgang mit diesen Argumenten.
 *
 * Ein Filterwechsel greift erst beim naechsten Titel: der laufende Ton kommt
 * aus einem bereits gestarteten ffmpeg, dessen Argumente feststehen. Wer
 * sofort umschalten will, ueberspringt.
 *
 * @module music/bot/klangfilter
 */

/**
 * Die verfuegbaren Filter.
 *
 * `ffmpeg` ist die Filterkette, `tempo` sagt, ob der Filter die Abspielzeit
 * veraendert - dann stimmt die angezeigte Dauer nicht mehr.
 */
const FILTER = {
    aus: {
        name: 'Aus',
        ffmpeg: null,
        tempo: 1
    },
    bassboost: {
        name: 'Bassboost',
        ffmpeg: 'bass=g=15:f=110:w=0.6',
        tempo: 1
    },
    nightcore: {
        name: 'Nightcore',
        // Schneller und hoeher zugleich
        ffmpeg: 'aresample=48000,asetrate=48000*1.25',
        tempo: 1.25
    },
    vaporwave: {
        name: 'Vaporwave',
        // Langsamer und tiefer, mit etwas Hall
        ffmpeg: 'aresample=48000,asetrate=48000*0.8,aecho=0.8:0.9:500|1000:0.3|0.25',
        tempo: 0.8
    },
    achtd: {
        name: '8D',
        // Wandert langsam zwischen den Kanaelen
        ffmpeg: 'apulsator=hz=0.09',
        tempo: 1
    },
    karaoke: {
        name: 'Karaoke',
        // Nimmt die Mitte heraus, wo meist der Gesang liegt
        ffmpeg: 'stereotools=mlev=0.03',
        tempo: 1
    },
    treble: {
        name: 'Hoehen',
        ffmpeg: 'treble=g=8',
        tempo: 1
    },
    lautstaerkeAusgleich: {
        name: 'Lautstaerke ausgleichen',
        ffmpeg: 'dynaudnorm=f=200',
        tempo: 1
    },
    tiefpass: {
        name: 'Tiefpass',
        ffmpeg: 'lowpass=f=1500',
        tempo: 1
    }
};

/**
 * Ist der Name ein bekannter Filter?
 *
 * @param {string} name Filtername
 * @returns {boolean}
 */
function bekannt(name) {
    return Object.prototype.hasOwnProperty.call(FILTER, String(name || '').toLowerCase());
}

/**
 * Einen Filter holen; unbekannte Namen ergeben "aus".
 *
 * @param {string} name Filtername
 * @returns {Object} Filter
 */
function holen(name) {
    return FILTER[String(name || '').toLowerCase()] || FILTER.aus;
}

/**
 * Die ffmpeg-Argumente fuer einen Filter.
 *
 * Leer, wenn kein Filter gesetzt ist - dann laeuft der Ton unveraendert
 * durch und wir sparen uns den ffmpeg-Vorgang ganz.
 *
 * @param {string} name Filtername
 * @returns {Array<string>|null} Argumente oder null
 */
function ffmpegArgumente(name) {
    const filter = holen(name);
    if (!filter.ffmpeg) return null;

    return [
        '-analyzeduration', '0',
        '-loglevel', '0',
        '-f', 's16le',
        '-ar', '48000',
        '-ac', '2',
        '-af', filter.ffmpeg
    ];
}

/**
 * Alle Filter als Auswahlliste - fuer Befehl und Dashboard.
 *
 * @returns {Array<{wert: string, name: string}>}
 */
function auswahl() {
    return Object.entries(FILTER).map(([wert, f]) => ({ wert, name: f.name }));
}

module.exports = { FILTER, bekannt, holen, ffmpegArgumente, auswahl };
