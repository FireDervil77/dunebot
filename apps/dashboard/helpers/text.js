'use strict';

/**
 * Text aus HTML gewinnen.
 *
 * Die Inhalte im CMS kommen aus einem WYSIWYG-Editor und sind damit HTML —
 * auch die Anrisstexte. Wer sie irgendwo als reinen Text zeigen will (Karte,
 * Discord-Embed, Meta-Beschreibung), muss zweierlei tun: Tags entfernen **und**
 * Entities aufloesen. Wer nur das erste tut, bekommt `&nbsp;` als sichtbaren
 * Text auf die Seite — der Editor setzt sie reichlich, und `<%= %>` schreibt
 * das `&` anschliessend als `&amp;` weg.
 *
 * @module dashboard/helpers/text
 */

/**
 * Benannte Entities, die der Editor tatsaechlich erzeugt.
 *
 * Bewusst keine vollstaendige HTML-Entity-Tabelle: Alles, was nicht hier steht,
 * faellt in die numerische Form darunter und wird ebenfalls aufgeloest.
 */
const ENTITIES = {
    auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß',
    mdash: '—', ndash: '–', hellip: '…',
    eacute: 'é', laquo: '«', raquo: '»',
    bdquo: '„', ldquo: '“', rdquo: '”', lsquo: '‚', rsquo: '’',
    lt: '<', gt: '>', quot: '"', apos: "'",
    euro: '€', copy: '©', reg: '®', trade: '™', deg: '°', middot: '·', bull: '•', times: '×',
    nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ', shy: ''
};

/** Groesster Codepunkt, den `String.fromCodePoint` annimmt. */
const CODEPUNKT_MAX = 0x10FFFF;

/**
 * Einen numerischen Codepunkt in sein Zeichen wandeln.
 *
 * `String.fromCodePoint` wirft bei allem ausserhalb des gueltigen Bereichs —
 * ein Tippfehler im Editor (`&#999999999;`) wuerde damit die ganze Seite
 * abbrechen. Unbrauchbare Angaben bleiben deshalb stehen, wie sie sind.
 *
 * @param {string} treffer Der vollstaendige Fund, z. B. `&#8222;`
 * @param {number} code
 * @returns {string}
 */
function zeichenAusCode(treffer, code) {
    if (!Number.isInteger(code) || code < 0 || code > CODEPUNKT_MAX) return treffer;
    return String.fromCodePoint(code);
}

/**
 * HTML-Entities in die Zeichen aufloesen, die sie meinen.
 *
 * `&amp;` kommt zum Schluss, und das ist kein Schoenheitsfehler: Wuerde es
 * zuerst aufgeloest, entstuende aus `&amp;nbsp;` erst `&nbsp;` und daraus dann
 * ein Leerzeichen — aus einem Text, der das Wort `&nbsp;` zeigen wollte, waere
 * nichts geworden.
 *
 * @param {string} text
 * @returns {string}
 */
function entitiesAufloesen(text) {
    if (!text || typeof text !== 'string') return '';

    return text
        .replace(/&([A-Za-z]+);/g, (treffer, name) =>
            Object.prototype.hasOwnProperty.call(ENTITIES, name) && name !== 'amp'
                ? ENTITIES[name]
                : treffer)
        .replace(/&#(\d+);/g, (treffer, code) => zeichenAusCode(treffer, Number(code)))
        .replace(/&#x([0-9a-fA-F]+);/g, (treffer, hex) => zeichenAusCode(treffer, parseInt(hex, 16)))
        .replace(/&amp;/g, '&');
}

/**
 * HTML zu einer einzeiligen Vorschau.
 *
 * Blockenden werden zu Leerzeichen, bevor die Tags fallen. Ohne das klebt
 * `<p>Ende</p><p>Anfang</p>` als „EndeAnfang" zusammen — genau der Fehler, den
 * `htmlZuDiscordMarkdown` fuer Discord schon behoben hat.
 *
 * Gekuerzt wird an der letzten Wortgrenze davor, nicht mitten im Wort, und nur
 * dann bekommt der Text ein Auslassungszeichen. Ein Anriss, der ohnehin
 * hineinpasst, endet nicht mit „…" — das behauptet sonst, es kaeme noch etwas.
 *
 * @param {string} html
 * @param {number} [maxLaenge=150] Groesste Laenge des Ergebnisses ohne „…"
 * @returns {string}
 */
function htmlZuVorschautext(html, maxLaenge = 150) {
    if (!html || typeof html !== 'string') return '';

    let text = html
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<\/(p|div|li|h[1-6]|blockquote|tr)>/gi, ' ')
        .replace(/<[^>]+>/g, '');

    text = entitiesAufloesen(text);

    // Zusammenziehen: Umbrueche aus dem Quelltext, die eben eingesetzten
    // Leerzeichen und das geschuetzte Leerzeichen aus &nbsp; sind alle dasselbe.
    text = text.replace(/\s+/g, ' ').trim();

    if (text.length <= maxLaenge) return text;

    const abschnitt = text.slice(0, maxLaenge);
    const letzteLuecke = abschnitt.lastIndexOf(' ');

    // Ein einzelnes ueberlanges Wort hat keine Luecke — dann wird hart geschnitten.
    return (letzteLuecke > 0 ? abschnitt.slice(0, letzteLuecke) : abschnitt).replace(/[.,;:!?–—-]+$/, '') + '…';
}

module.exports = { entitiesAufloesen, htmlZuVorschautext };
