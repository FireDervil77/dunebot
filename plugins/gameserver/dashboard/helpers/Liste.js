/**
 * Liste: eine Einstellung, deren Wert aus mehreren Einträgen besteht — eine
 * Zeile je Eintrag.
 *
 * Gebraucht seit dem 2026-10-15. Enshrouded führt gesperrte Konten als Liste
 * (`bannedAccounts: ["7656…", …]`); als Text ließe sich das nicht schreiben,
 * als Auswahl erst recht nicht. Im Paket ist es der Typ `list`, dazu optional
 * `item_pattern` (Regel, die JEDER Eintrag ganz erfüllen muss) und `max_items`.
 *
 * Gespeichert wird der Wert wie jeder andere als Text: die Einträge, durch
 * Zeilenumbrüche getrennt. Erst der Schreiber im Container (fb-cfg) macht in
 * json/yaml eine echte Liste daraus — mit derselben Regel wie hier: leere
 * Zeilen fallen weg, Leerraum am Rand auch (Daemon `listenWert`).
 *
 * Die Regel steht nur hier. Werkbank, Serverseite, Anlegen und Speichern fragen
 * dieses Modul, statt selbst zu zerlegen.
 *
 * @module helpers/Liste
 */

const TYP = 'list';

function istListe(einstellung) {
    return einstellung?.type === TYP;
}

/** Die Einträge eines Werts — wie der Daemon sie liest. */
function eintraege(wert) {
    if (wert === undefined || wert === null) return [];
    return String(wert).replace(/\r\n/g, '\n').split('\n').map(z => z.trim()).filter(Boolean);
}

/** Der Wert so, wie er gespeichert wird: ein Eintrag je Zeile, nichts Leeres. */
function normalisiere(wert) {
    return eintraege(wert).join('\n');
}

/**
 * Was an einem Wert nicht stimmt — in einem Satz, oder null.
 *
 * Eine kaputte Prüfregel im Paket ist ein Fehler des Pakets; sie wird gemeldet,
 * statt jeden Eintrag still durchzulassen.
 */
function fehlerDesWerts(einstellung, wert) {
    const liste = eintraege(wert);
    const hoechstens = Number(einstellung?.max_items);
    if (Number.isInteger(hoechstens) && hoechstens > 0 && liste.length > hoechstens) {
        return `höchstens ${hoechstens} Einträge, es sind ${liste.length}`;
    }
    if (einstellung?.item_pattern) {
        let regel;
        try {
            regel = new RegExp(`^(?:${einstellung.item_pattern})$`);
        } catch {
            return 'die Prüfregel im Paket ist kein gültiger Ausdruck';
        }
        const falsch = liste.find(e => !regel.test(e));
        if (falsch !== undefined) return `„${falsch}" passt nicht zur Regel ${einstellung.item_pattern}`;
    }
    return null;
}

/**
 * Der erste Fehler unter allen Listen eines Pakets — für Anlegen (Dashboard und
 * Discord), wo alle Werte auf einmal kommen. Null, wenn alles passt.
 */
function fehlerInWerten(paket, werte) {
    for (const e of paket?.settings || []) {
        if (!istListe(e) || !werte || !(e.key in werte)) continue;
        const fehler = fehlerDesWerts(e, werte[e.key]);
        if (fehler) return `„${(e.name && (e.name.de || e.name.en)) || e.key}": ${fehler}`;
    }
    return null;
}

module.exports = { TYP, istListe, eintraege, normalisiere, fehlerDesWerts, fehlerInWerten };
