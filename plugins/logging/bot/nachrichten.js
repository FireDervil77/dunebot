'use strict';

/**
 * Logging: Nachrichten, nur Metadaten (3.1; LG-1b Teil 2, K382, 2026-11-16).
 *
 * Gespeichert wird, DASS etwas mit einer Nachricht geschah, von wem, wo und
 * mit welchen Merkmalen (Anhänge, Embeds, Erwähnungen) – nie der Text. Den
 * gibt es erst mit Stufe 2 nach der Pflichtentscheidung (F-LG2, G-04). Der
 * Wächter prüft, dass hier nichts `.content` liest.
 *
 * Arten:
 *   nachricht.geloescht        Betroffen = Autor. Ohne Audit-Eintrag hat der
 *                              Autor selbst gelöscht (Discord vermerkt das
 *                              nicht); wer sonst, liefert LG-1c.
 *   nachricht.bearbeitet       Bearbeiten kann nur der Autor → Akteur sicher.
 *   nachricht.massenloeschung  `/clear`, `/purge`, Bann mit Löschen: Anzahl
 *                              und Autoren, keine Texte.
 *   nachricht.angeheftet / losgeheftet
 *   nachricht.everyone         Neue Nachricht mit @everyone oder @here. Die
 *                              einzige Art aus `messageCreate`: Jede Nachricht
 *                              zu erfassen hieße, die Menge aus G-18 in
 *                              `log_ereignisse` zu schreiben.
 *
 * Grenzen, die die Seite nennt:
 *   - War eine gelöschte Nachricht nicht im Speicher des Bots (älter als der
 *     Start, oder nie gesehen), sind Autor und Merkmale unbekannt
 *     (`im_speicher: false`).
 *   - `messageUpdate` kommt auch, wenn Discord nur eine Link-Vorschau
 *     nachreicht. Gezählt wird nur, wenn sich die Bearbeitungszeit ändert.
 *     Ist die alte Nachricht nicht im Speicher, zählt die Bearbeitung nur,
 *     wenn sie höchstens 60 s alt ist (sonst wäre es eine Vorschau zu einer
 *     längst bearbeiteten Nachricht).
 *
 * @module logging/bot/nachrichten
 */

const { erfasse, nameVon, rollenVon } = require('./erfasser');
const V = require('../shared/vergleich');

const iso = (t) => (t ? new Date(t).toISOString() : null);
const FRISCH_MS = 60_000;

/** Kanal-Kette für den Kanal-Ausschluss: Kanal oder Thread, sein Elternkanal, dessen Kategorie. */
function ketteVon(kanal) {
    return [kanal?.id, kanal?.parentId, kanal?.parent?.parentId].filter(Boolean).map(String);
}

/** Merkmale einer Nachricht, ohne Text. */
function merkmale(m) {
    const erw = m?.mentions;
    return {
        erstellt_am: iso(m?.createdTimestamp),
        anhaenge: m?.attachments?.size ?? 0,
        embeds: m?.embeds?.length ?? 0,
        erwaehnungen: (erw?.users?.size ?? 0) + (erw?.roles?.size ?? 0),
        everyone: Boolean(erw?.everyone),
        bot: Boolean(m?.author?.bot),
        webhook: Boolean(m?.webhookId),
        angeheftet: Boolean(m?.pinned),
    };
}

function objekt(m) {
    return { typ: 'nachricht', id: m.id };
}

function geloescht(m) {
    if (!m?.guildId) return [];
    const bekannt = !m.partial && Boolean(m.author);
    return [{
        art: 'nachricht.geloescht', schwere: 'info', betroffen: m.author?.id || null, kanal: m.channelId, objekt: objekt(m),
        vorher: bekannt ? merkmale(m) : { im_speicher: false },
    }];
}

/**
 * @param {Iterable<object>} nachrichten die Werte der Sammlung (`sammlung.values()`)
 * @param {object} kanal
 */
function massenloeschung(nachrichten, kanal) {
    if (!kanal?.guildId && !kanal?.guild) return [];
    const liste = [...(nachrichten || [])];
    const autoren = [...new Set(liste.map((m) => m?.author?.id).filter(Boolean).map(String))].sort();
    const zeiten = liste.map((m) => m?.createdTimestamp).filter(Boolean).sort((a, b) => a - b);
    return [{
        art: 'nachricht.massenloeschung', schwere: 'warnung', kanal: kanal.id, objekt: { typ: 'kanal', id: kanal.id, name: kanal.name },
        vorher: {
            anzahl: liste.length, im_speicher: liste.filter((m) => !m?.partial && m?.author).length,
            autoren: autoren.slice(0, 100), aelteste: iso(zeiten[0]), neueste: iso(zeiten[zeiten.length - 1]),
        },
    }];
}

function bearbeitet(alt, neu, jetzt = Date.now()) {
    if (!neu?.guildId) return [];
    const aus = [];
    const nach = neu.editedTimestamp || null;
    const vor = alt && !alt.partial ? (alt.editedTimestamp || null) : null;
    const istBearbeitung = nach && (alt && !alt.partial ? nach !== vor : jetzt - nach <= FRISCH_MS);
    if (istBearbeitung) {
        const autor = neu.author?.id || null;
        const felder = ['anhaenge', 'embeds', 'erwaehnungen', 'everyone'];
        const d = alt && !alt.partial ? V.unterschied(merkmale(alt), merkmale(neu), felder) : null;
        aus.push({
            art: 'nachricht.bearbeitet', schwere: 'info', akteur: autor, zuordnung: 'sicher', betroffen: autor,
            kanal: neu.channelId, objekt: objekt(neu),
            vorher: { bearbeitet_am: iso(vor), ...(d?.vorher || {}), ...(alt && !alt.partial ? {} : { im_speicher: false }) },
            nachher: { bearbeitet_am: iso(nach), erstellt_am: iso(neu.createdTimestamp), ...(d?.nachher || {}) },
        });
    }
    if (alt && !alt.partial && Boolean(alt.pinned) !== Boolean(neu.pinned)) {
        aus.push({
            art: neu.pinned ? 'nachricht.angeheftet' : 'nachricht.losgeheftet', schwere: 'info',
            betroffen: neu.author?.id || null, kanal: neu.channelId, objekt: objekt(neu),
            nachher: { erstellt_am: iso(neu.createdTimestamp) },
        });
    }
    return aus;
}

function everyone(m) {
    if (!m?.guildId || !m.mentions?.everyone) return [];
    const autor = m.author?.id || null;
    return [{
        art: 'nachricht.everyone', schwere: 'info', akteur: autor, zuordnung: 'sicher', betroffen: autor,
        kanal: m.channelId, objekt: objekt(m), nachher: merkmale(m),
    }];
}

/**
 * Erfassen. Kontext aus der Nachricht: Rollen des Autors (Rollen-Ausschluss),
 * Kanal-Kette (Kanal-Ausschluss), Bot oder nicht (Bots ausschließen: Eine
 * Nachricht, die ein Bot schrieb, bearbeitete oder selbst löschte, ist sein
 * Tun), Name für `log_namen`.
 */
async function melde(guildId, ereignisse, m, kanal) {
    if (!ereignisse.length) return;
    const n = m?.author && !m.partial ? nameVon(m.member || m.author) : null;
    const kontext = {
        rollen: rollenVon(m?.member), kanaele: ketteVon(kanal || m?.channel),
        akteurIstBot: Boolean(m?.author?.bot), namen: n ? [n] : [],
    };
    await Promise.all(ereignisse.map((e) => erfasse(guildId, e, kontext)));
}

module.exports = { geloescht, massenloeschung, bearbeitet, everyone, merkmale, ketteVon, melde, FRISCH_MS };
