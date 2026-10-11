/**
 * Bitmaske: eine Einstellung, deren Wert die SUMME angekreuzter Möglichkeiten ist.
 *
 * Gebraucht seit dem 2026-10-11. Spiele der Quake- und Source-Familie legen
 * ganze Verhaltensgruppen in EINE Zahl — was Bots dürfen, worüber abgestimmt
 * werden kann, welche Waffen gesperrt sind. In der Doku steht dann
 * „1 = …, 2 = …, 4 = …, addieren". Als Zahlenfeld müsste der Spieler selbst
 * rechnen; als Auswahl ginge nur EIN Wert.
 *
 * Im Paket ist es der Typ `flags` mit demselben Feld `choices` wie die Auswahl:
 * Jede Möglichkeit ist ein Bit, ihr `value` eine Zweierpotenz. Kein
 * Zusatzschalter an `choice` — mehrere Stellen lesen `choice` als „genau einer
 * der Werte" und hätten mit einer Mehrfachwahl still falsch gerechnet.
 *
 * Gespeichert und geschrieben wird die Summe als Dezimalzahl. Der Daemon kennt
 * den Typ nicht und muss es nicht: Er bekommt die Zahl wie jede andere.
 *
 * Die Regel steht nur hier. Werkbank, Serverseite, Anlegen und der Wächter
 * `check-pakete.js` fragen dieses Modul, statt selbst zu rechnen.
 *
 * @module helpers/Bitmaske
 */

const TYP = 'flags';

// Bis 2^30: Die Summe aller Bits bleibt damit unter 2^31 und passt in die
// vorzeichenbehaftete 32-Bit-Zahl, als die diese Spiele ihre Variablen lesen.
const HOECHSTES_BIT = 2 ** 30;

function istBitmaske(einstellung) {
    return einstellung?.type === TYP;
}

/** Eine ganze Zahl ab 0 — als Zahl oder als Ziffernfolge. Sonst NaN. */
function liesZahl(v) {
    if (typeof v === 'number') return Number.isInteger(v) && v >= 0 ? v : NaN;
    if (typeof v === 'string' && /^\d{1,10}$/.test(v.trim())) return Number(v.trim());
    return NaN;
}

function istZweierpotenz(n) {
    return Number.isInteger(n) && n >= 1 && Number.isInteger(Math.log2(n));
}

/** Die Bits einer Einstellung, in der Reihenfolge des Pakets. */
function bits(einstellung) {
    return (Array.isArray(einstellung?.choices) ? einstellung.choices : []).map(c => liesZahl(c.value));
}

/** Alle Bits zusammen — der größte Wert, den die Einstellung annehmen kann. */
function maske(einstellung) {
    return bits(einstellung).reduce((s, b) => s + (Number.isFinite(b) ? b : 0), 0);
}

/**
 * Was an den Möglichkeiten nicht stimmt — ein Satz, oder null.
 *
 * Jede Möglichkeit muss EIN Bit sein. Ein zusammengesetzter Wert (3 = „beides")
 * ließe sich nicht unabhängig an- und abwählen: Wer 3 abwählt und 1 behält,
 * hat keinen Wert, der beides sagt.
 */
function fehlerDerBits(einstellung) {
    const liste = Array.isArray(einstellung?.choices) ? einstellung.choices : [];
    if (!liste.length) return 'eine Bitmaske braucht mindestens eine Möglichkeit.';
    const gesehen = new Set();
    for (const c of liste) {
        const n = liesZahl(c?.value);
        if (!istZweierpotenz(n)) {
            return `„${c?.value}" ist kein einzelnes Bit — erlaubt sind 1, 2, 4, 8, 16 … (Zweierpotenzen).`;
        }
        if (n > HOECHSTES_BIT) return `„${c.value}" ist zu groß — das höchste Bit ist ${HOECHSTES_BIT}.`;
        if (gesehen.has(n)) return `das Bit ${n} steht zweimal da.`;
        gesehen.add(n);
    }
    return null;
}

/**
 * Den Wert in seine Bits zerlegen.
 *
 * `fremd` ist, was im Wert steckt und das Paket nicht (mehr) anbietet — etwa
 * nach einem Paketwechsel. Die Ansicht sagt das, statt es still zu verlieren.
 *
 * @returns {{ lesbar: boolean, zahl: number, an: Set<number>, fremd: number }}
 */
function zerlege(einstellung, wert) {
    const zahl = liesZahl(typeof wert === 'number' ? wert : String(wert ?? ''));
    if (!Number.isFinite(zahl)) return { lesbar: false, zahl: 0, an: new Set(), fremd: 0 };
    const an = new Set();
    let bekannt = 0;
    for (const b of bits(einstellung)) {
        if (!istZweierpotenz(b)) continue;
        if (Math.floor(zahl / b) % 2 === 1) { an.add(b); bekannt += b; }
    }
    return { lesbar: true, zahl, an, fremd: zahl - bekannt };
}

/** Was an einem Wert nicht stimmt — ein Satz, oder null. */
function fehlerDesWerts(einstellung, wert) {
    const z = zerlege(einstellung, wert);
    if (!z.lesbar) return `„${wert}" ist keine Summe aus den Möglichkeiten (erwartet wird eine ganze Zahl ab 0).`;
    if (z.fremd !== 0) {
        return `${z.zahl} enthält ${z.fremd}, das keine der Möglichkeiten ist — möglich ist höchstens ${maske(einstellung)}.`;
    }
    return null;
}

/**
 * Alle Bitmasken eines Pakets gegen einen Satz Werte prüfen — für das Anlegen,
 * wo die Werte aus einem Formular oder aus Discord kommen.
 *
 * @returns {string|null} Der erste Fehler als Satz, oder null.
 */
function fehlerInWerten(paket, werte) {
    for (const e of paket?.settings || []) {
        if (!istBitmaske(e) || !Object.prototype.hasOwnProperty.call(werte || {}, e.key)) continue;
        const fehler = fehlerDesWerts(e, werte[e.key]);
        if (fehler) return `„${e.name?.de || e.name?.en || e.key}": ${fehler}`;
    }
    return null;
}

// Ab so vielen Möglichkeiten steht die Liste zugeklappt da, mit „3 von 18
// aktiv" als Zeile. Manche Masken haben fünfzehn bis zwanzig Bits; offen
// drückten sie jede andere Einstellung aus dem Bild.
const ZUGEKLAPPT_AB = 9;

/**
 * Was die Ansicht zum Zeichnen braucht — der Server rechnet, der Browser
 * zeichnet. Null, wenn die Einstellung keine Bitmaske ist.
 *
 * `wert` ist, was gilt: der gespeicherte Wert, sonst die Vorgabe des Pakets
 * (die schickt der Start ohnehin mit, siehe StartPayload.werteFuerDaemon).
 *
 * @returns {null|{ bits: Array<{wert: number, name: string, hinweis: string, an: boolean}>,
 *   summe: number, aktiv: number, gesamt: number, fremd: number, lesbar: boolean,
 *   zugeklappt: boolean }}
 */
function fuerAnzeige(einstellung, wert) {
    if (!istBitmaske(einstellung)) return null;
    const leer = wert === undefined || wert === null || wert === '';
    const z = zerlege(einstellung, leer ? 0 : wert);
    const liste = (Array.isArray(einstellung.choices) ? einstellung.choices : [])
        .map(c => ({ c, n: liesZahl(c.value) }))
        .filter(x => istZweierpotenz(x.n))
        .map(({ c, n }) => ({
            wert: n,
            name: c.name?.de || c.name?.en || String(n),
            hinweis: c.hint?.de || c.hint?.en || '',
            an: z.an.has(n),
        }));
    return {
        bits: liste,
        // Die Summe der ANGEKREUZTEN Bits — nicht der gespeicherte Wert: Was
        // das Paket nicht anbietet, steht in `fremd` und fällt beim Speichern weg.
        summe: liste.reduce((s, b) => s + (b.an ? b.wert : 0), 0),
        aktiv: liste.filter(b => b.an).length,
        gesamt: liste.length,
        fremd: z.fremd,
        lesbar: leer || z.lesbar,
        zugeklappt: liste.length >= ZUGEKLAPPT_AB,
    };
}

module.exports = {
    ZUGEKLAPPT_AB,
    istBitmaske, maske, fuerAnzeige,
    fehlerDerBits, fehlerDesWerts, fehlerInWerten,
};
