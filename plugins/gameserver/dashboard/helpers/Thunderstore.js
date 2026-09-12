'use strict';

/**
 * Thunderstore — suchen, Fassung holen, Abhaengigkeiten aufloesen (E6/B.12).
 *
 * ── Warum das Dashboard fragt und der Daemon nur holt ───────────────────────
 *
 * Hier stehen ENTSCHEIDUNGEN: welches Paket, welche Fassung, was kommt mit.
 * Die Datei selbst holt der Daemon (`gameserver.content.fetch`) — sonst liefe
 * jeder Mod base64-kodiert durch die WebSocket-Leitung (45-MB-Grenze) und
 * zusaetzlich durch die Leitung des Dashboards.
 *
 * ── Alles hier ist am 2026-09-09 an der echten API gemessen ─────────────────
 *
 *   Suche    GET /api/cyberstorm/listing/{community}/?q=…&ordering=most-downloaded
 *   Paket    GET /api/experimental/package/{ns}/{name}/           → .latest
 *   Fassung  GET /api/experimental/package/{ns}/{name}/{fassung}/ → direkt
 *   Datei    GET /package/download/{ns}/{name}/{fassung}/  → 302 auf gcdn
 *
 * ⚠ Drei Messungen, die anders ausfielen als erwartet:
 *
 *  1. Der Suchparameter heisst `q`. `search` wird STILL IGNORIERT — die Anfrage
 *     antwortet 200 und liefert alle 5571 Valheim-Pakete statt der 14 Treffer.
 *     Genau die Sorte Fehler, die wie ein Ergebnis aussieht.
 *  2. `/c/{community}/api/v1/package/` waere die vollstaendige Liste — 162 MB.
 *     Als Suche unbrauchbar; deshalb die Cyberstorm-Liste.
 *  3. Es gibt KEIN `dependencies` auf oberster Ebene, nur unter `latest` bzw.
 *     an der einzelnen Fassung. Der alte Egg las `jq -r '.dependencies[]'` und
 *     faende heute keine einzige Abhaengigkeit.
 */

const { ServiceManager } = require('dunebot-core');

/**
 * Von wo darf geladen werden.
 *
 * **Dieselbe Liste steht im Daemon** (`internal/gameserver/inhalte_holen.go`),
 * und `scripts/check-herkunftsliste.js` haelt beide zusammen. Zwei Listen sind
 * hier kein Doppel, sondern der Sinn der Sache: Das Dashboard stellt nur
 * erlaubte Adressen aus, und der Daemon glaubt ihm nicht.
 *
 * Der Downloadweg ist gemessen: `thunderstore.io/package/download/…` antwortet
 * 302 auf `gcdn.thunderstore.io`. Ohne den zweiten Namen ginge kein Download.
 */
const HERKUNFT = ['thunderstore.io', 'gcdn.thunderstore.io'];

const BASIS = 'https://thunderstore.io';
const FRIST_MS = 15000;

/** Wie viele Ebenen tief Abhaengigkeiten verfolgt werden. */
const TIEFE = 5;

/**
 * Gehoert die Adresse zu einer erlaubten Herkunft?
 *
 * Exakter Namensvergleich, kein `endsWith`: `boese-thunderstore.io` endet auch
 * auf `thunderstore.io`.
 */
function istErlaubt(adresse) {
    let u;
    try { u = new URL(adresse); } catch { return false; }
    if (u.protocol !== 'https:') return false;
    return HERKUNFT.includes(u.hostname);
}

/** Ein Aufruf gegen die API — mit Frist, mit Fehlertext, ohne stille Rueckfaelle. */
async function hole(pfad) {
    const antwort = await fetch(`${BASIS}${pfad}`, {
        headers: { Accept: 'application/json', 'User-Agent': 'firebot-dashboard' },
        signal: AbortSignal.timeout(FRIST_MS),
    });
    if (!antwort.ok) {
        throw new Error(`Thunderstore antwortete ${antwort.status} auf ${pfad}`);
    }
    return antwort.json();
}

/**
 * Suchen in einer Community.
 *
 * @param {string} community Kennung aus dem Paket (`content.source_ids.thunderstore`)
 * @param {string} begriff
 * @param {number} [grenze]
 */
async function suche(community, begriff, optionen = {}) {
    if (!community) throw new Error('Das Paket nennt keine Thunderstore-Community');

    const seite = Math.max(1, parseInt(optionen.seite, 10) || 1);
    const abfrage = new URLSearchParams({
        q: String(begriff || ''),
        ordering: 'most-downloaded',
        page: String(seite),
    });
    const daten = await hole(
        `/api/cyberstorm/listing/${encodeURIComponent(community)}/?${abfrage}`);

    const treffer = (daten.results || []).map(t => ({
        kennung:    `${t.namespace}-${t.name}`,
        namespace:  t.namespace,
        name:       t.name,
        beschreibung: t.description || '',
        bild:       t.icon_url || null,
        downloads:  t.download_count || 0,
        bytes:      t.size || 0,
        veraltet:   Boolean(t.is_deprecated),
        geaendert:  t.last_updated || null,
    }));

    // ── Blaettern statt Zwischenspeichern ───────────────────────────────────
    //
    // Die vollstaendige Liste waere `/c/<spiel>/api/v1/package/` — **162 MB**
    // fuer Valheim, und sie aendert sich taeglich. Sie hier zu halten hiesse,
    // einen Katalog zu pflegen, den die Quelle besser kennt
    // (dieselbe Ueberlegung wie bei `gameserver_content`: die installierten
    // Inhalte sind unsere Sache, die moeglichen nicht).
    //
    // Die Cyberstorm-Liste blaettert von sich aus: feste 20 je Seite, dazu
    // `count`, `next` und `previous`. `count` ist die Antwort auf „wie viel
    // gibt es hier ueberhaupt?" — am 2026-09-12 waren es 5746 fuer Valheim.
    return {
        treffer,
        gesamt:   Number(daten.count) || treffer.length,
        seite,
        weiter:   Boolean(daten.next),
        zurueck:  Boolean(daten.previous),
        proSeite: PRO_SEITE,
    };
}

/** Wie viele Treffer die Cyberstorm-Liste je Seite liefert (fest). */
const PRO_SEITE = 20;

/**
 * Die Seite des Spiels bei Thunderstore — zum selber Stoebern.
 *
 * Ein Verzeichnis mit tausenden Eintraegen laesst sich in einer Karte nicht
 * abbilden; wer wirklich schauen will, ist dort besser aufgehoben.
 */
function verzeichnis(community) {
    return community ? 'https://thunderstore.io/c/' + encodeURIComponent(community) + '/' : null;
}

/**
 * Ein Paket in einer bestimmten oder in seiner neuesten Fassung.
 *
 * Beide Wege liefern dieselbe Form zurueck — der Aufrufer soll nicht wissen
 * muessen, ob die Fassung von ihm kam oder von Thunderstore.
 */
async function paket(namespace, name, fassung = null) {
    const p = `/api/experimental/package/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/`;
    const daten = fassung
        ? await hole(`${p}${encodeURIComponent(fassung)}/`)
        : (await hole(p)).latest;

    if (!daten) throw new Error(`${namespace}/${name}: keine Fassung gefunden`);

    return {
        kennung:      `${namespace}-${name}`,
        namespace,
        name,
        fassung:      daten.version_number,
        beschreibung: daten.description || '',
        adresse:      daten.download_url,
        bytes:        daten.file_size || 0,
        abhaengig:    daten.dependencies || [],
    };
}

/**
 * `denikson-BepInExPack_Valheim-5.4.2333` auseinandernehmen.
 *
 * ── Von RECHTS trennen, nicht global ersetzen ───────────────────────────────
 *
 * Der alte Egg machte `sed 's/-/\//g'` — jeder Bindestrich wird ein
 * Schraegstrich. Das geht gut, solange kein NAME einen Bindestrich hat; bei
 * `Foo-Bar-Mod-1.0.0` entsteht Unsinn, und zwar lautlos: Die Adresse existiert
 * einfach nicht.
 *
 * Richtig ist die Form `namespace-name-fassung`: letztes Stueck ist die
 * Fassung, erstes der Namensraum, alles dazwischen der Name.
 *
 * @returns {{namespace: string, name: string, fassung: string}|null}
 */
function teileKennung(text) {
    const stuecke = String(text || '').split('-');
    if (stuecke.length < 3) return null;

    const fassung = stuecke[stuecke.length - 1];
    const namespace = stuecke[0];
    const name = stuecke.slice(1, -1).join('-');
    if (!namespace || !name || !fassung) return null;

    return { namespace, name, fassung };
}

/**
 * Ist a hoeher als b? Thunderstore-Fassungen sind immer `x.y.z` (Zahlen).
 *
 * Warum das gebraucht wird: Zwei Mods koennen denselben Lader in
 * verschiedenen Fassungen anfordern. Wer die niedrigere zuletzt installiert,
 * ueberschreibt die hoehere — und der Fehler zeigt sich erst im Spiel.
 */
function hoeher(a, b) {
    const zahlen = s => String(s || '0').split('.').map(n => parseInt(n, 10) || 0);
    const x = zahlen(a), y = zahlen(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
        const d = (x[i] || 0) - (y[i] || 0);
        if (d !== 0) return d > 0;
    }
    return false;
}

/**
 * Was alles installiert werden muss, damit dieses Paket laeuft.
 *
 * Abhaengigkeiten kommen mit FESTER Fassung (`…-5.4.2333`), nicht als Bereich.
 * Die wird genommen und nicht durch die neueste ersetzt: Sie ist die, gegen die
 * der Mod-Autor gebaut hat. Gemessen: Jotunn 2.29.2 nennt BepInEx 5.4.2333,
 * neuestes BepInEx ist 5.4.2350 — wer stillschweigend das neuere nimmt,
 * installiert etwas, das niemand so getestet hat.
 *
 * Abhaengigkeiten stehen VORNE: Der Lader muss liegen, bevor der Mod kommt.
 *
 * @returns {Promise<Array>} Pakete in Installationsreihenfolge, ohne Doppel
 */
async function aufloesen(namespace, name, fassung = null) {
    const gefunden = new Map();   // kennung → Paket
    const fehlend = [];

    async function verfolge(ns, nm, fs, tiefe) {
        if (tiefe > TIEFE) return null;

        let p;
        try {
            p = await paket(ns, nm, fs);
        } catch (fehler) {
            // Melden, nicht ueberspringen: Ein Mod, dessen Abhaengigkeit es
            // nicht mehr gibt, wird nicht laufen. Das gehoert VOR die
            // Installation, nicht in ein Log danach.
            fehlend.push(`${ns}-${nm}${fs ? '-' + fs : ''}: ${fehler.message}`);
            return null;
        }

        // Erst die Abhaengigkeiten — sie sollen vor dem Paket stehen.
        for (const eintrag of p.abhaengig) {
            const teil = teileKennung(eintrag);
            if (!teil) {
                fehlend.push(`Unlesbare Abhaengigkeit: ${eintrag}`);
                continue;
            }
            await verfolge(teil.namespace, teil.name, teil.fassung, tiefe + 1);
        }

        const schon = gefunden.get(p.kennung);
        if (schon) {
            // Zweimal dasselbe Paket: die hoehere Fassung gewinnt, und die
            // Reihenfolge bleibt die des ersten Auftretens.
            if (hoeher(p.fassung, schon.fassung)) gefunden.set(p.kennung, p);
        } else {
            gefunden.set(p.kennung, p);
        }
        return p;
    }

    const wurzel = await verfolge(namespace, name, fassung, 0);
    if (!wurzel) {
        throw new Error(fehlend[0] || `${namespace}/${name} nicht gefunden`);
    }

    return { pakete: [...gefunden.values()], fehlend };
}

/**
 * Gibt es eine neuere Fassung als die installierte?
 *
 * Fehler eines einzelnen Pakets beenden die Liste nicht — sonst verschwiegen
 * ein geloeschtes Paket und ein Netzausfall die Auskunft ueber alle anderen.
 */
async function aktualisierungen(zeilen) {
    const Logger = ServiceManager.get('Logger');
    const ergebnis = [];

    for (const zeile of zeilen) {
        const teil = zeile.kennung ? zeile.kennung.split('-') : [];
        if (teil.length < 2) continue;

        try {
            const p = await paket(teil[0], teil.slice(1).join('-'));
            ergebnis.push({
                id: zeile.id,
                kennung: zeile.kennung,
                installiert: zeile.fassung,
                neueste: p.fassung,
                neuer: hoeher(p.fassung, zeile.fassung),
            });
        } catch (fehler) {
            Logger.warn(`[Thunderstore] ${zeile.kennung} nicht abfragbar: ${fehler.message}`);
            ergebnis.push({
                id: zeile.id, kennung: zeile.kennung,
                installiert: zeile.fassung, neueste: null, neuer: false,
                fehler: fehler.message,
            });
        }
    }
    return ergebnis;
}

module.exports = {
    HERKUNFT, istErlaubt, suche, paket, teileKennung, hoeher, aufloesen, aktualisierungen,
    verzeichnis, PRO_SEITE,
};
