'use strict';

/**
 * Artikel „Bot einladen": zwei Wege statt einem (Betreiber, 2026-10-12).
 *
 * Betreiber: „die Bot-einladen-Seite beschreibt übrigens kein einziges Mal, wie
 * es ist, wenn man auf der Webseite direkt auf den Dashboard-Link klickt. Dann
 * kommt ja auch eine Auswahl von Servern, auf denen man mindestens die
 * Management-Rolle haben muss, sonst werden sie nicht angezeigt. Von dort aus
 * könnte man den Bot also auch einladen."
 *
 * Der Artikel kannte nur den Einladungslink. Jetzt steht der Weg über die
 * Serverauswahl davor — so, wie er im Code ist (`auth.controller.js`,
 * `getServerSelector`): Aufgeführt wird ein Server, wenn man dort Besitzer oder
 * Administrator ist oder „Server verwalten" hat (oder im Dashboard eingeladen
 * wurde); ohne Bot steht „Bot nicht in Guild" und der Knopf „Bot hinzufügen".
 *
 * ── Warum eine Migration, obwohl es Inhalt ist ──────────────────────────────
 *
 * Der neue Text verweist auf `/invite`. Die Adresse entsteht im selben Stand
 * und wird mit demselben Neustart wirksam, der diese Migration fährt.
 *
 * ── Geschrieben wird nur über den unveränderten Text ────────────────────────
 *
 * Ersetzt wird die deutsche Fassung NUR, wenn sie noch genau der eingespielte
 * Text ist (nach der Verweis-Migration `…100000_einladung_im_artikel`) — am
 * Fingerabdruck erkannt. Hat der Betreiber den Artikel inzwischen selbst
 * geändert, bleibt seine Fassung stehen und das Log sagt es. Andere Sprachen
 * werden nicht angefasst.
 */

const crypto = require('crypto');

/** sha256 der deutschen Fassung, wie sie am 2026-10-12 in der Datenbank stand (Verweis schon auf /invite). */
const VORHER = '6b96e19d0332ddf55ca1d5fe104e402f880f716e399cb57e8d8d314f91910a38';

const NEU = `So fügst du FireBot zu deinem Discord-Server hinzu. Es gibt zwei Wege, beide führen zum selben Ergebnis.

## Voraussetzungen

- Du brauchst auf dem Discord-Server, zu dem der Bot soll, die Berechtigung **Server verwalten** — oder du bist dort Besitzer oder Administrator
- Ein Discord-Account (logisch!)

## Weg 1: Über das Dashboard

Der bequemere Weg, wenn du den Server danach gleich einrichten willst.

1. Klicke auf der Webseite auf **Dashboard** und melde dich mit Discord an
2. Du kommst zur Serverauswahl. Aufgeführt sind die Server, auf denen du Besitzer oder Administrator bist oder die Berechtigung **Server verwalten** hast
3. Bei einem Server ohne FireBot steht **Bot nicht in Guild**. Klicke dort auf **Bot hinzufügen**
4. Discord öffnet sich, dein Server ist schon ausgewählt — weiter bei [Bei Discord bestätigen](#bei-discord-bestaetigen)

Dein Server fehlt in der Liste? Dann hast du dort die Berechtigung **Server verwalten** nicht. Bitte den Besitzer, sie dir zu geben oder den Bot selbst einzuladen.

## Weg 2: Direkt über den Einladungslink

> **[FireBot einladen](/invite)**

Der Link führt ohne Umweg zu Discord. Den Server wählst du dort aus — auch Discord bietet nur Server an, auf denen du **Server verwalten** darfst.

## Bei Discord bestätigen

1. Wähle den Server aus, zu dem der Bot hinzugefügt werden soll (bei Weg 1 ist er schon ausgewählt)
2. Stelle sicher, dass alle angeforderten Berechtigungen aktiviert bleiben — FireBot braucht diese, um korrekt zu funktionieren
3. Klicke auf **Autorisieren**
4. Bestätige die Captcha-Abfrage

Danach bringt dich Discord zurück zu FireBot. Bist du angemeldet, landest du auf der Willkommensseite deines Servers. Sonst meldest du dich mit Discord an und wählst deinen Server in der Serverauswahl.

## Bot ist da!

FireBot erscheint jetzt in deiner Serverliste. Er wird automatisch:

- Deinen Server im System registrieren
- Standard-Berechtigungsgruppen anlegen (Administrator, Moderator, Support, User)
- Das Core-Plugin aktivieren

## Was passiert im Hintergrund?

Beim Beitritt zu einem neuen Server führt FireBot automatisch ein **Guild-Setup** durch:

1. Server-Daten werden in der Datenbank gespeichert
2. Standard-Gruppen werden erstellt
3. Der Server-Besitzer bekommt automatisch die Administrator-Gruppe
4. Das Core-Plugin wird aktiviert

## Nächster Schritt

Öffne jetzt das [Dashboard](/kb/dashboard/uebersicht), um deinen Server zu konfigurieren.

→ Weiter: [Erste Schritte](/kb/getting-started/erste-schritte)`;

const fingerabdruck = (text) => crypto.createHash('sha256').update(String(text)).digest('hex');

function melde(text) {
    try { require('dunebot-core').ServiceManager.get('Logger').warn(text); } catch { /* ohne Logger kein Log — die Migration scheitert daran nicht */ }
}

module.exports = {
    description: 'Wissensdatenbank: Artikel „Bot einladen" beschreibt auch den Weg über die Serverauswahl',
    VORHER, NEU, fingerabdruck,

    async up(db) {
        // **Nicht destrukturieren** — `db.query()` liefert die Zeilen direkt.
        const da = await db.query(
            `SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kb_articles'`);
        if (!da.length) return;
        const zeilen = await db.query(
            `SELECT a.id, a.content_translations FROM kb_articles a JOIN kb_categories c ON c.id = a.category_id
              WHERE c.slug = 'getting-started' AND a.slug = 'bot-einladen'`);
        if (!zeilen.length) return;   // neue Anlage ohne eingespielten Bestand

        const inhalt = typeof zeilen[0].content_translations === 'string'
            ? JSON.parse(zeilen[0].content_translations) : (zeilen[0].content_translations || {});
        if (inhalt['de-DE'] === NEU) return;
        if (fingerabdruck(inhalt['de-DE']) !== VORHER) {
            melde('[Migration] Artikel „Bot einladen" wurde seit dem Einspielen geändert — der Abschnitt '
                + '„Weg 1: Über das Dashboard" wird NICHT eingefügt, die vorhandene Fassung bleibt.');
            return;
        }
        inhalt['de-DE'] = NEU;
        await db.query('UPDATE kb_articles SET content_translations = ? WHERE id = ?', [JSON.stringify(inhalt), zeilen[0].id]);
    },

    async down() {
        // Kein Rückweg: Der alte Text liegt nur noch in `documentation/` (solange
        // es den Ordner gibt) und im Git. Ein Artikel wird in der Verwaltung geändert.
    },
};
