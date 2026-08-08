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
    // Der Schluessel hiess `lautstaerkeAusgleich`, mit grossem A. Gesucht wird
    // aber immer kleingeschrieben - der Filter war damit als einziger nicht
    // auffindbar: die Auswahlliste bot ihn an, das Setzen antwortete "Diesen
    // Filter kenne ich nicht", und das Dashboard speicherte still "aus".
    // Alle Schluessel sind jetzt klein; `schluessel()` haelt es auch so.
    ausgleich: {
        name: 'Lautstaerke ausgleichen',
        ffmpeg: 'dynaudnorm=f=200',
        tempo: 1
    },
    tiefpass: {
        name: 'Tiefpass',
        ffmpeg: 'lowpass=f=1500',
        tempo: 1
    },

    // Tempo und Tonhoehe getrennt. `atempo` laesst die Tonhoehe in Ruhe und
    // aendert nur die Geschwindigkeit; `rubberband` umgekehrt. Beides kann das
    // mitgelieferte ffmpeg - nachgesehen, `rubberband` ist einkompiliert.
    // Nightcore und Vaporwave aendern dagegen beides zugleich, weil sie genau
    // das sein sollen.
    schnell: {
        name: 'Schneller',
        ffmpeg: 'atempo=1.25',
        tempo: 1.25
    },
    langsam: {
        name: 'Langsamer',
        ffmpeg: 'atempo=0.8',
        tempo: 0.8
    },
    hoeher: {
        name: 'Hoehere Tonlage',
        ffmpeg: 'rubberband=pitch=1.15',
        tempo: 1
    },
    tiefer: {
        name: 'Tiefere Tonlage',
        ffmpeg: 'rubberband=pitch=0.87',
        tempo: 1
    }
};

/**
 * Nachschlagewerk: kleingeschriebener Name -> wirklicher Schluessel.
 *
 * Aufgebaut aus `FILTER` selbst, damit ein Schluessel mit Grossbuchstaben den
 * Filter nicht noch einmal unauffindbar machen kann. Genau daran scheiterte
 * `lautstaerkeAusgleich`: gesucht wurde klein, abgelegt war es gemischt.
 */
const INDEX = new Map(Object.keys(FILTER).map(k => [k.toLowerCase(), k]));

/**
 * Den wirklichen Schluessel zu einem Namen finden.
 *
 * @param {string} name Filtername in beliebiger Schreibweise
 * @returns {string|null} Schluessel, oder null bei unbekanntem Namen
 */
function schluessel(name) {
    return INDEX.get(String(name || '').toLowerCase()) || null;
}

/**
 * Ist der Name ein bekannter Filter?
 *
 * @param {string} name Filtername
 * @returns {boolean}
 */
function bekannt(name) {
    return schluessel(name) !== null;
}

/**
 * Einen Filter holen; unbekannte Namen ergeben "aus".
 *
 * @param {string} name Filtername
 * @returns {Object} Filter
 */
function holen(name) {
    return FILTER[schluessel(name)] || FILTER.aus;
}

/**
 * Die ffmpeg-Ausgabeargumente fuer einen Filter.
 *
 * Kommen immer, auch ohne Filter: der Ton geht ohnehin durch ffmpeg, weil
 * die Lautstaerkeregelung rohes PCM braucht. Ohne Filter faellt lediglich
 * die `-af`-Kette weg.
 *
 * @param {string} name Filtername
 * @returns {Array<string>} Argumente
 */
function ffmpegArgumente(name) {
    const filter = holen(name);

    const argumente = [
        '-analyzeduration', '0',
        '-loglevel', '0',
        '-f', 's16le',
        '-ar', '48000',
        '-ac', '2'
    ];

    if (filter.ffmpeg) argumente.push('-af', filter.ffmpeg);

    return argumente;
}

/**
 * Alle Filter als Auswahlliste - fuer Befehl und Dashboard.
 *
 * @returns {Array<{wert: string, name: string}>}
 */
function auswahl() {
    return Object.entries(FILTER).map(([wert, f]) => ({ wert, name: f.name }));
}

module.exports = { FILTER, schluessel, bekannt, holen, ffmpegArgumente, auswahl };
