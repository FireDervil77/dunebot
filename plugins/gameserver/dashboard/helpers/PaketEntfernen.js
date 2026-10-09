'use strict';

/**
 * Ein Spielpaket ganz entfernen — mit allem, was nur zu ihm gehört
 * (Baustelle 178, 2026-10-09).
 *
 * ── Warum es das gibt ───────────────────────────────────────────────────────
 *
 * `DELETE /admin/addons/:id` weist den Anker eines Spielpakets immer ab: Ohne
 * ihn wäre das Paket wählbar, aber nicht mehr anlegbar. Einen Weg, das Paket
 * SAMT Anker loszuwerden, gab es nicht. Anlass war `factorio-werkbank` — am
 * 2026-09-24 neben dem von Hand geschriebenen `factorio` entstanden, als Beleg,
 * dass die Werkbank ein Paket hervorbringt. Danach standen zwei Factorios in
 * jeder Auswahl.
 *
 * Betreiber, 2026-10-09: „das vollständige Entfernen inklusive der
 * dazugehörigen Werkbank-Fassungen, falls es welche gibt."
 *
 * ── Zwei Hälften, eine Reihenfolge ──────────────────────────────────────────
 *
 *   Werkbank   Die Sitzungen des Pakets: ihr Volume liegt beim Daemon, ihre
 *              Zeilen in vier Tabellen. Das weiss die Werkbank
 *              (Sitzungen.zuPaket / entfernbar / sitzungEntfernen).
 *   Paket      Fassungen, Tags, Bewertungen, Paket, Anker — in EINER
 *              Transaktion. Die Regel steht in Paketfassung.entfernen.
 *
 * Die Werkbank zuerst, und davor für ALLE Sitzungen die Frage, ob sie jetzt
 * entfernt werden können. Andersherum bliebe nach einem Fehler ein Entwurf
 * ohne Paket liegen — und der nächste Klick auf „Veröffentlichen" brächte das
 * Paket zurück. Scheitert es mitten in den Sitzungen, steht das Paket noch,
 * und der Fehler nennt, was schon weg ist: Ein zweiter Anlauf räumt den Rest.
 *
 * Die Werkbank ist ein eigenes Plugin. Fehlt es, hat ein Paket keine
 * Sitzungen — dann wird nur das Paket entfernt.
 */

const Paketfassung = require('./Paketfassung');

/** Der Helfer der Werkbank — null, wenn es das Plugin in diesem Dashboard nicht gibt. */
function werkbank() {
    try { return require('../../../werkbank/dashboard/helpers/Sitzungen'); }
    catch (err) {
        if (err.code === 'MODULE_NOT_FOUND' && /werkbank/.test(err.message)) return null;
        throw err;
    }
}

/** Was mitginge — für die Rückfrage. `paket: null`: Dieses Spiel trägt kein Paket. */
async function vorschau(dbService, paketId) {
    const v = await Paketfassung.entfernenVorschau(dbService, paketId);
    if (!v) return { paket: null };
    const W = werkbank();
    const sitzungen = W ? await W.zuPaket({ paketId: v.paket.id, slug: v.paket.slug }) : [];
    return { ...v, sitzungen };
}

/**
 * Entfernen. Wirft mit einem Satz, der sagt, was (noch) da ist.
 *
 * @returns {Promise<{slug: string, weg: object, sitzungen: string[]}>}
 */
async function entfernen(dbService, { paketId, slug }) {
    const v = await Paketfassung.entfernenVorschau(dbService, paketId);
    if (!v) throw new Error('Zu diesem Spiel gibt es kein Spielpaket. Nichts entfernt.');
    // Dieselben beiden Bedingungen prüft Paketfassung.entfernen noch einmal, in
    // der Transaktion. Hier stehen sie, damit keine Sitzung weg ist, bevor
    // feststeht, dass das Paket überhaupt gehen darf.
    if (String(slug || '') !== v.paket.slug) {
        throw new Error(`Zur Bestätigung gehört der Name des Pakets („${v.paket.slug}"). Nichts entfernt.`);
    }
    if (v.server > 0) {
        throw new Error(`${v.server} Server ${v.server === 1 ? 'läuft' : 'laufen'} mit „${v.paket.slug}" — ein Server ohne Paket startet nicht. Erst die Server löschen. Nichts entfernt.`);
    }

    const W = werkbank();
    const sitzungen = W ? await W.zuPaket({ paketId: v.paket.id, slug: v.paket.slug }) : [];
    try {
        for (const z of sitzungen) await W.entfernbar(z);
    } catch (err) {
        throw new Error(`${err.message} Nichts entfernt.`);
    }

    const entfernt = [];
    try {
        for (const z of sitzungen) {
            await W.sitzungEntfernen(z);
            entfernt.push(`${z.name} (${z.kennung})`);
        }
        const { weg } = await Paketfassung.entfernen(dbService, { paketId: v.paket.id, slug: v.paket.slug });
        return { slug: v.paket.slug, weg, sitzungen: entfernt };
    } catch (err) {
        // Was schon weg ist, gehört in die Meldung — sonst sucht jemand eine
        // Sitzung, die es nicht mehr gibt, oder hält das Paket für entfernt.
        const schon = entfernt.length
            ? ` Schon entfernt: ${entfernt.length === 1 ? 'die Werkbank-Sitzung' : 'die Werkbank-Sitzungen'} ${entfernt.join(', ')}. Das Paket „${v.paket.slug}" steht noch — ein zweiter Anlauf räumt den Rest.`
            : ` Das Paket „${v.paket.slug}" steht unverändert.`;
        const fehler = new Error(err.message + schon);
        fehler.sitzungen = entfernt;
        throw fehler;
    }
}

module.exports = { vorschau, entfernen };
