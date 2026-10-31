'use strict';

/**
 * Nexus Mods — nur suchen und zeigen, nie laden (Baustelle 191, 2026-10-31).
 *
 * ── Warum das kein Anbieter ist wie die anderen ─────────────────────────────
 *
 * Der Vertrag in `Quellen.js` verlangt eine direkte Datei. Die gibt es hier fuer
 * das Panel nicht (entschieden vom Betreiber, F36):
 *
 *  - Download-Links bekommen nur Premium-Nutzer, Dateien mit „direct download"
 *    und offizielle Dateien; alle anderen brauchen einen Schluessel, den nur
 *    der Knopf auf der Webseite erzeugt. Gemessen am 2026-10-31: Direct Download
 *    bei 0 von 80 der meistgeladenen Mods von Valheim und von Enshrouded.
 *  - Persoenliche API-Schluessel sind in oeffentlichen Anwendungen verboten,
 *    Schluessel der Nutzer auf eigenen Servern zu speichern ebenso (API
 *    Acceptable Use Policy). Das Panel benutzen fremde Guilds.
 *
 * Deshalb steht dieses Modul in `Quellen.NUR_KATALOG`, nicht in `ANBIETER`, und
 * hat weder `paket` noch `aufloesen`. Die Datei holt der Nutzer auf der Webseite
 * und spielt sie ueber den vorhandenen Upload ein. Ein Schluessel kommt hier
 * nicht vor: Die Suche ist oeffentlich.
 *
 * ── Gemessen am 2026-10-31 (POST api.nexusmods.com/v2/graphql, ohne Schluessel) ──
 *
 *   `name` kennt nur EQUALS, NOT_EQUALS und WILDCARD; „loot" trifft bei Valheim
 *   59 Mods. Die v3-Suche `/mods/search` hat keinen Suchbegriff und ist
 *   Experimental, deshalb v2. Ohne Filter stehen bei Valheim 69 Erwachsenen-Mods
 *   in der Liste (3362 statt 3293) — die gehoeren nicht in ein Guild-Panel.
 *
 * Der „Raum" ist die Spielkennung aus der Adresse: `valheim`, `enshrouded`.
 */

const KENNUNG = 'nexus';
const TITEL = 'Nexus Mods';
const RAUM_NAME = 'Spielkennung';

/**
 * Steht in der Trefferliste. Die Formate sind keine Hoeflichkeit: Der Upload
 * packt nur ZIP aus (`routes/inhalte.js`), ein `.7z` laege unausgepackt im
 * Mod-Ordner, und das Spiel saehe nichts. Von 1047 Dateien der 15
 * meistgeladenen Valheim-Mods waren 287 `.7z` oder `.rar`.
 */
const HINWEIS = 'Nexus Mods gibt Dateien nicht an das Panel heraus: Lade die Mod dort herunter '
    + 'und spiele sie hier über „Datei hochladen" ein. ZIP-Archive packt das Panel aus, 7z und RAR nicht — '
    + 'die musst du vorher auspacken. Lader, Abhängigkeiten und Aktualisierungen übernimmt das Panel '
    + 'bei diesen Mods nicht, darum kümmerst du dich selbst.';

const API = 'https://api.nexusmods.com/v2/graphql';
const SEITE = 'https://www.nexusmods.com';
const FRIST_MS = 15000;
const PRO_SEITE = 20;
/** Laenger ist kein Mod-Name, nur eine Last fuer die fremde Suche. */
const MAX_BEGRIFF = 100;
/** Spielkennung, wie sie in der Adresse steht — sie landet in Links. */
const RE_RAUM = /^[a-z0-9][a-z0-9_-]*$/i;

const ABFRAGE = `query ($filter: ModsFilter, $sort: [ModsSort!], $count: Int, $offset: Int) {
  mods(filter: $filter, sort: $sort, count: $count, offset: $offset) {
    totalCount
    nodes { modId name summary downloads updatedAt thumbnailUrl }
  }
}`;

/** Eine Abfrage gegen die API — mit Frist, mit Fehlertext, ohne stille Rueckfaelle. */
async function frage(variablen) {
    const antwort = await fetch(API, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json', Accept: 'application/json',
            // Die Nutzungsregeln verlangen beide Koepfe.
            'Application-Name': 'firebot-dashboard', 'Application-Version': '1.0.0',
            'User-Agent': 'firebot-dashboard',
        },
        body: JSON.stringify({ query: ABFRAGE, variables: variablen }),
        signal: AbortSignal.timeout(FRIST_MS),
    });
    if (!antwort.ok) throw new Error(`Nexus Mods antwortete ${antwort.status}`);
    const daten = await antwort.json();
    // GraphQL antwortet auch bei Fehlern mit 200 — die stehen in `errors`.
    if (Array.isArray(daten.errors) && daten.errors.length) {
        throw new Error(`Nexus Mods: ${daten.errors.map(e => e.message).join('; ')}`);
    }
    return daten.data;
}

function pruefeRaum(raum) {
    if (!RE_RAUM.test(String(raum || ''))) throw new Error('Das Paket nennt keine gültige Spielkennung für Nexus Mods');
    return String(raum);
}

/**
 * Suche, oder ohne Begriff die meistgeladenen. Sortiert wird immer nach
 * Downloads: Die Liste kennt keine Relevanz, und die alphabetische Reihenfolge
 * hilft bei tausenden Mods niemandem.
 */
async function suche(raum, begriff, optionen = {}) {
    const spiel = pruefeRaum(raum);
    const seite = Math.max(1, parseInt(optionen.seite, 10) || 1);
    const text = String(begriff || '').trim().slice(0, MAX_BEGRIFF);

    const filter = {
        gameDomainName: [{ value: spiel, op: 'EQUALS' }],
        adultContent: [{ value: false, op: 'EQUALS' }],
    };
    if (text) filter.name = [{ value: text, op: 'WILDCARD' }];

    const daten = await frage({
        filter, sort: [{ downloads: { direction: 'DESC' } }],
        count: PRO_SEITE, offset: (seite - 1) * PRO_SEITE,
    });
    const gesamt = Number(daten?.mods?.totalCount) || 0;

    return {
        treffer: (daten?.mods?.nodes || []).map(m => ({
            kennung:      String(m.modId),
            name:         m.name,
            beschreibung: m.summary || '',
            bild:         m.thumbnailUrl || null,
            downloads:    m.downloads || 0,
            veraltet:     false,
            geaendert:    m.updatedAt || null,
        })),
        gesamt, seite,
        weiter: seite * PRO_SEITE < gesamt,
        zurueck: seite > 1,
        proSeite: PRO_SEITE,
    };
}

function verzeichnis(raum) {
    return `${SEITE}/${encodeURIComponent(pruefeRaum(raum))}/mods`;
}

function adresse(raum, kennung) {
    return `${SEITE}/${encodeURIComponent(pruefeRaum(raum))}/mods/${encodeURIComponent(String(kennung))}`;
}

module.exports = { KENNUNG, TITEL, RAUM_NAME, HINWEIS, PRO_SEITE, suche, verzeichnis, adresse };
