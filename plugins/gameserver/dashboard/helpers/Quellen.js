'use strict';

/**
 * Die Anbieter von Inhalten — und der Vertrag, den jeder erfuellt (E6/B.12).
 *
 * ── Warum eine Weiche und kein zweiter Weg ──────────────────────────────────
 *
 * Bis zum 2026-09-14 stand „thunderstore" an 18 Stellen im Code: in Routen, im
 * Holweg, in der Adressbildung. Ein zweiter Anbieter haette jede davon
 * verdoppelt — und beim naechsten Fund waere eine Haelfte berichtigt worden und
 * die andere nicht. Hier steht er einmal.
 *
 * Die Spalte `gameserver_content.quelle` trennt die Anbieter schon seit dem
 * 2026-09-08; sie trug bisher nur „thunderstore" und „upload". Der Name in der
 * Spalte ist derselbe wie der Schluessel hier — daran haengt alles Weitere.
 *
 * ── Der Vertrag ─────────────────────────────────────────────────────────────
 *
 * Ein Anbieter passt hier hinein, wenn er drei Dinge hat: eine **Suche**,
 * **Angaben je Fassung** samt Abhaengigkeiten und eine **direkte Datei auf
 * einem festen Host**. Fehlt eines, ist es kein Anbieter fuer diesen Weg,
 * sondern ein eigenes Verfahren (der Steam-Workshop zum Beispiel laedt ueber
 * SteamCMD, nicht ueber HTTP — der gehoert nicht hierher).
 *
 *   KENNUNG        so heisst er in `gameserver_content.quelle` und im Paket
 *   TITEL          so heisst er in der Oberflaeche
 *   RAUM_NAME      wie sein „Raum" heisst: Gemeinschaft, Lader, …
 *   HERKUNFT       von wo der Daemon laden darf (auch im Daemon hinterlegt)
 *   istErlaubt(adresse)
 *   suche(raum, begriff, {seite})    → {treffer, gesamt, seite, weiter, zurueck, proSeite}
 *   paket(raum, kennung, fassung?)   → ein Paket in gemeinsamer Form
 *   aufloesen(raum, kennung, fassung?) → {pakete, fehlend} — Abhaengigkeiten ZUERST
 *   aktualisierungen(raum, zeilen)   → [{id, kennung, installiert, neueste, neuer, …}]
 *   verzeichnis(raum)                → Seite zum Stoebern
 *   adresse(raum, kennung)           → Seite eines Mods
 *   hoeher(a, b)                     → ist Fassung a hoeher als b? (Lader-Regel)
 *   neuerAls(paket, zeile)           → lohnt ein Update dieser Zeile?
 *
 * `hoeher` und `neuerAls` sind mit Absicht zwei Fragen. Thunderstore erzwingt
 * SemVer und beantwortet beide mit der Nummer; Modrinth laesst die Nummern frei
 * („1.21.1-fabric-0.6") und entscheidet ueber das Erscheinungsdatum. Wer hier
 * selbst vergliche, haette bei jedem zweiten Minecraft-Mod recht — und beim
 * anderen still unrecht.
 *
 * ── Der „Raum" ──────────────────────────────────────────────────────────────
 *
 * Jeder Anbieter teilt seinen Katalog anders auf, und beide Male sagt das PAKET,
 * welcher Teil zu diesem Spiel gehoert (`content.source_ids.<anbieter>`):
 *
 *   Thunderstore  Gemeinschaft je Spiel   → `valheim`, `lethal-company`
 *   Modrinth      Lader                   → `paper`, `fabric`, `neoforge`
 *
 * Geraten wird nichts: Ohne Eintrag im Paket gibt es fuer dieses Spiel bei
 * diesem Anbieter keine Suche, und die Antwort sagt genau das.
 */

const Thunderstore = require('./Thunderstore');
const Modrinth = require('./Modrinth');

/** Alle Anbieter, die diesen Weg gehen. `upload` ist keiner — da bringt der Betreiber die Datei. */
const ANBIETER = {
    [Thunderstore.KENNUNG]: Thunderstore,
    [Modrinth.KENNUNG]: Modrinth,
};

/** Alle erlaubten Herkuenfte zusammen — `scripts/check-herkunftsliste.js` liest sie hier. */
const HERKUNFT = Object.values(ANBIETER).flatMap(a => a.HERKUNFT);

/**
 * Der Anbieter zu einem Namen.
 *
 * Wirft bei einem unbekannten Namen, statt auf Thunderstore zurueckzufallen:
 * Ein stiller Rueckfall installierte aus der falschen Quelle, und niemand saehe
 * es der Zeile an.
 */
function fuer(name) {
    const a = ANBIETER[String(name || '').toLowerCase()];
    if (!a) throw new Error(`Unbekannte Quelle: ${name}`);
    return a;
}

/** Kennt das System diesen Anbieter? */
function gibtEs(name) {
    return Boolean(ANBIETER[String(name || '').toLowerCase()]);
}

/**
 * Welche Anbieter nennt dieses Spiel — in der Reihenfolge des Pakets.
 *
 * `upload` und alles Unbekannte fallen raus. Ein Paket, das einen Anbieter
 * nennt, den es hier nicht gibt, ist kein Fehler: Es ist ein Paket, das auf
 * einem neueren Dashboard mehr kann.
 */
function ausPaket(inhalt) {
    return (inhalt?.sources || []).filter(gibtEs);
}

/** Der Raum dieses Spiels bei diesem Anbieter — oder null. */
function raumAus(inhalt, name) {
    return inhalt?.source_ids?.[String(name || '').toLowerCase()] || null;
}

/** Alle Raeume auf einmal — die Ansicht baut daraus ihre Adressen. */
function raeumeAus(inhalt) {
    const raeume = {};
    for (const name of ausPaket(inhalt)) raeume[name] = raumAus(inhalt, name);
    return raeume;
}

/**
 * Welcher Anbieter ist gemeint?
 *
 * Ohne Angabe der erste, den das Paket nennt — bei einem Spiel mit genau einer
 * Quelle (heute jedes) muss so niemand etwas mitschicken. Mit Angabe wird sie
 * gegen das Paket geprueft: Ein Spiel, das Modrinth nicht nennt, bekommt auch
 * dann nichts von dort, wenn es jemand in die Adresse schreibt.
 */
function waehle(inhalt, gewuenscht) {
    const moeglich = ausPaket(inhalt);
    if (!moeglich.length) return null;
    if (!gewuenscht) return moeglich[0];
    const name = String(gewuenscht).toLowerCase();
    return moeglich.includes(name) ? name : null;
}

module.exports = { ANBIETER, HERKUNFT, fuer, gibtEs, ausPaket, raumAus, raeumeAus, waehle };
