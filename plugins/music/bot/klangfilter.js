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
 * Grundlautheit, auf die jeder Titel gebracht wird.
 *
 * `loudnorm` misst nach EBU R128 und nicht nach Spitzenpegel — es zielt also
 * auf die *empfundene* Lautheit, nicht auf den lautesten Ausschlag. Genau
 * darum geht es hier: Ein leise gemasterter Titel und ein lauter sollen gleich
 * laut ankommen, ohne dass jemand nachregelt.
 *
 * Die Werte:
 *   I=-14    Zielllautheit in LUFS. Derselbe Wert, den Spotify und YouTube
 *            fahren — Quellen von dort werden dadurch kaum angefasst, und
 *            alles Leisere kommt auf deren Niveau.
 *   TP=-1.5  Obergrenze fuer echte Spitzen (dBTP). Etwas Luft, damit die
 *            spaetere Opus-Kodierung nicht in die Uebersteuerung laeuft.
 *   LRA=11   Erlaubter Lautheitsumfang. Kleiner hiesse staerkeres
 *            Zusammendruecken; 11 laesst Dynamik stehen.
 *
 * **Einfacher Durchgang, nicht zwei.** Die genaue Variante von `loudnorm`
 * misst erst die ganze Datei und korrigiert dann — das setzt voraus, dass die
 * Datei vorliegt. Hier kommt ein Datenstrom, der beim Messen schon gespielt
 * waere. Der einfache Durchgang regelt dafuer laufend nach; das ist der Preis
 * und der Grund, warum sich sehr dynamische Musik minimal "atmend" anhoeren
 * kann. Wem das auffaellt, schaltet es je Server ab.
 */
const GRUNDLAUTHEIT = 'loudnorm=I=-14:TP=-1.5:LRA=11';

/**
 * Die ffmpeg-Ausgabeargumente fuer einen Filter.
 *
 * Kommen immer, auch ohne Filter: der Ton geht ohnehin durch ffmpeg, weil
 * die Lautstaerkeregelung rohes PCM braucht. Ohne Filter und ohne
 * Normalisierung faellt lediglich die `-af`-Kette weg.
 *
 * Reihenfolge in der Kette: **erst der Klangfilter, dann die Normalisierung.**
 * Bassboost hebt den Pegel an, Nightcore verschiebt ihn — wuerde zuerst
 * normalisiert, machte der Filter die Arbeit gleich wieder zunichte. So misst
 * `loudnorm` das, was tatsaechlich herauskommt.
 *
 * @param {string} name Filtername
 * @param {boolean} [normalisieren=true] Grundlautheit angleichen
 * @returns {Array<string>} Argumente
 */
function ffmpegArgumente(name, normalisieren = true) {
    const filter = holen(name);

    const argumente = [
        '-analyzeduration', '0',
        '-loglevel', '0',
        '-f', 's16le',
        '-ar', '48000',
        '-ac', '2'
    ];

    const kette = [];
    if (filter.ffmpeg) kette.push(filter.ffmpeg);
    if (normalisieren) kette.push(GRUNDLAUTHEIT);

    if (kette.length) argumente.push('-af', kette.join(','));

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

module.exports = { FILTER, GRUNDLAUTHEIT, schluessel, bekannt, holen, ffmpegArgumente, auswahl };
