'use strict';

/**
 * Modrinth — der zweite Anbieter: suchen, Fassung holen, Abhaengigkeiten
 * aufloesen (E6/B.12).
 *
 * ── Warum Modrinth als naechstes ────────────────────────────────────────────
 *
 * Er passt in denselben Vertrag wie Thunderstore (siehe Quellen.js): Suche,
 * Angaben je Fassung mit Abhaengigkeiten, direkte Datei auf einem festen Host.
 * Kein Schluessel, keine Anmeldung. Und er deckt den groessten Block des
 * Egg-Bestands ab — die ganze Minecraft-Familie (Paper, Spigot, Bukkit, Fabric,
 * Forge, NeoForge, Velocity, Folia).
 *
 * ── Am 2026-09-14 an der echten API gemessen ────────────────────────────────
 *
 *   Suche     GET /v2/search?query=…&facets=[["categories:paper"]]&index=…
 *   Projekt   GET /v2/project/{slug}
 *   Fassungen GET /v2/project/{slug}/version?loaders=["paper"]  → neueste zuerst
 *   Fassung   GET /v2/version/{id}
 *   Datei     files[].url auf cdn.modrinth.com
 *
 * ⚠ Vier Messungen, die anders ausfielen als erwartet:
 *
 *  1. **`project_type` taugt nicht als Filter.** EssentialsX ist ein Plugin und
 *     meldet trotzdem `project_type: "mod"`. Gefiltert wird ueber den LADER
 *     (`categories:paper`), und der steht bei uns im Paket.
 *  2. **Die Suche zaehlt in `total_hits`**, nicht in `count`, und blaettert
 *     ueber `offset`, nicht ueber `page`.
 *  3. **`game_versions` ist eine Liste je Fassung** — EssentialsX 2.22.0 fuehrt
 *     alles von 1.8.8 bis 1.21.x. Daraus laesst sich eine echte Pruefung bauen
 *     („passt zu 1.21.8?"), was Thunderstore nicht kann. Der Filter ist exakt:
 *     `game_versions=["1.21.1"]` ergab 0 Treffer, `["1.21.8"]` einen.
 *  4. **Die Fassungsnummern sind frei.** Modrinth erzwingt kein SemVer
 *     („2.22.0", aber auch „1.21.1-fabric-0.6"). Deshalb entscheidet hier das
 *     **Datum** darueber, ob etwas neuer ist, nicht der Zeichenkettenvergleich.
 *
 * ── Die Kennung ist der Slug ────────────────────────────────────────────────
 *
 * Gespeichert wird `essentialsx`, nicht die unlesbare Projekt-ID `hXiIvTyT`.
 * Der Slug steht in jeder Adresse, in der Liste zum Weitergeben und in der
 * Karte. Er kann sich aendern — dann schlaegt das Aktualisieren mit „404" fehl,
 * und die Zeile sagt es. Eine ID waere stabil und im ganzen Panel unlesbar;
 * das ist der Tausch, bewusst so herum.
 */

const { ServiceManager } = require('dunebot-core');

/**
 * Von wo darf geladen werden.
 *
 * Nur der Auslieferungshost: `api.modrinth.com` ruft das DASHBOARD, die Datei
 * holt der Daemon von `cdn.modrinth.com` (gemessen — `files[].url` zeigt immer
 * dorthin, ohne Umleitung). Dieselbe Liste steht im Daemon
 * (`internal/gameserver/inhalte_holen.go`), `scripts/check-herkunftsliste.js`
 * haelt beide zusammen.
 */
const HERKUNFT = ['cdn.modrinth.com'];

const KENNUNG = 'modrinth';
const TITEL = 'Modrinth';
/** Wie der „Raum" bei diesem Anbieter heisst — fuer Texte in der Oberflaeche. */
const RAUM_NAME = 'Lader';

const BASIS = 'https://api.modrinth.com/v2';
const SEITE = 'https://modrinth.com';
const FRIST_MS = 15000;
const PRO_SEITE = 20;
const TIEFE = 5;

/**
 * Modrinth bittet in seiner Doku um einen sprechenden User-Agent mit
 * Kontaktweg. Ohne ihn drosselt der Dienst frueher — und ein anonymer Abruf
 * waere auch unhoeflich.
 */
const KOPF = {
    Accept: 'application/json',
    'User-Agent': 'firenetworks/firebot-dashboard (https://firenetworks.de)',
};

/** Diese Lader sind Plugins, nicht Mods — nur fuer den Verzeichnislink. */
const PLUGIN_LADER = ['bukkit', 'paper', 'spigot', 'purpur', 'folia', 'velocity', 'waterfall', 'sponge'];

/**
 * Gehoert die Adresse zu einer erlaubten Herkunft?
 *
 * Exakter Namensvergleich, kein `endsWith`: `boese-cdn.modrinth.com` endet auch
 * auf `cdn.modrinth.com`. (Wortgleich zu Thunderstore.js — die Pruefung gehoert
 * zum Anbieter, nicht in einen gemeinsamen Topf: Wer hier einen Host ergaenzt,
 * soll nicht versehentlich den anderen Anbieter mit oeffnen.)
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
        headers: KOPF,
        signal: AbortSignal.timeout(FRIST_MS),
    });
    if (antwort.status === 404) {
        throw new Error(`Modrinth kennt ${pfad.split('?')[0]} nicht (404)`);
    }
    if (!antwort.ok) {
        throw new Error(`Modrinth antwortete ${antwort.status} auf ${pfad}`);
    }
    return antwort.json();
}

/** JSON-Listen wandern bei Modrinth als Zeichenkette in die Abfrage. */
const alsListe = (werte) => JSON.stringify(werte.map(String));

/**
 * Suchen — der „Raum" ist hier der Lader (`paper`, `fabric`, `neoforge` …).
 *
 * Ohne Suchbegriff die meistgeladenen, mit Begriff nach Trefferguete: Wer
 * stoebert, will wissen, was gross ist; wer sucht, will seinen Mod finden.
 * Thunderstore kann nur das eine (`most-downloaded`), Modrinth beides.
 */
async function suche(raum, begriff, optionen = {}) {
    if (!raum) throw new Error('Das Paket nennt keinen Modrinth-Lader (content.source_ids.modrinth)');

    const seite = Math.max(1, parseInt(optionen.seite, 10) || 1);
    const text = String(begriff || '').trim();
    // ── Modpacks gehoeren NICHT in diese Liste (2026-09-22) ────────────────
    //
    // Gemessen: Zur Kategorie `neoforge` gehoeren 31 407 Projekte, davon **2418
    // Modpacks**. Sie standen bisher mit in der Suche — nicht auf Seite 1 (die
    // sortiert nach Downloads und zeigt die grossen Mods), aber jeder, der nach
    // einem Namen sucht, traf sie.
    //
    // Ein Modpack ist keine Mod, sondern eine `.mrpack` — ein Archiv mit einer
    // Liste von Dateien (`modrinth.index.json`) und einem `overrides/`-Ordner.
    // Gemessen an einem Beispiel: **355 MB**. In `mods/` abgelegt tut sie
    // nichts: Der Lader ignoriert sie, der Platz ist weg, und niemand sieht der
    // Zeile an, warum das Spiel die Mods nicht hat.
    //
    // `project_type:!=modpack` lehnt die API ab („failed to parse facets",
    // gemessen). Die Aufzaehlung geht: Eine zweite Facettengruppe ist ein UND,
    // die Werte darin sind ein ODER. 28 891 Treffer statt 31 407 — genau die
    // Modpacks und die Ressourcenpakete weniger.
    //
    // `plugin` steht mit in der Liste, obwohl der paper-Raum heute nur `mod`
    // liefert (40 von 40 auf Seite 1 gemessen): Modrinth fuehrt beide Arten,
    // und EssentialsX meldet sich als `mod`, obwohl es ein Plugin ist. Wer sich
    // auf EINE Art verlaesst, verliert die andere, sobald Modrinth aufraeumt.
    // ── Die Spielfassung, wenn sie bekannt ist (2026-09-22) ────────────────
    //
    // Gemessen: Der neoforge-Raum hat 28 891 Projekte, davon passen zu Ausgabe
    // 26.2 genau 6 109. Ohne diesen Filter sind vier von fuenf Treffern Mods,
    // die sich nicht installieren lassen — und man erfaehrt es erst beim Klick.
    //
    // Die Facette heisst `versions`, nicht `game_versions` (das ist der Name an
    // der FASSUNG, nicht in der Suche). Beide am 2026-09-22 nachgemessen.
    //
    // Ist die Fassung unbekannt („latest", noch nie installiert), wird NICHT
    // gefiltert: Zu viele Treffer mit einem Hinweis sind besser als zu wenige
    // ohne Erklaerung.
    const gruppen = [
        alsListe([`categories:${raum}`]),
        alsListe(['project_type:mod', 'project_type:plugin']),
    ];
    if (optionen.spielfassung) {
        gruppen.push(alsListe([`versions:${optionen.spielfassung}`]));
    }

    const abfrage = new URLSearchParams({
        query: text,
        facets: `[${gruppen.join(',')}]`,
        index: text ? 'relevance' : 'downloads',
        limit: String(PRO_SEITE),
        offset: String((seite - 1) * PRO_SEITE),
    });

    const daten = await hole(`/search?${abfrage}`);
    const gesamt = Number(daten.total_hits) || 0;

    return {
        treffer: (daten.hits || []).map(t => ({
            kennung:      t.slug,
            name:         t.title,
            beschreibung: t.description || '',
            bild:         t.icon_url || null,
            downloads:    t.downloads || 0,
            bytes:        0,               // steht erst an der Fassung
            veraltet:     false,           // Modrinth kennt kein „deprecated"
            geaendert:    t.date_modified || null,
            // Modrinth sagt es je MOD statt je Spiel: „required" heisst, die
            // Mitspieler brauchen ihn auch.
            clientSeitig: t.client_side === 'required',
        })),
        gesamt,
        seite,
        weiter:  (seite * PRO_SEITE) < gesamt,
        zurueck: seite > 1,
        proSeite: PRO_SEITE,
    };
}

/**
 * Modpacks suchen.
 *
 * ── Die Lader-Kategorie ist kein Lader (gemessen 2026-09-23) ────────────────
 *
 * Es lag nahe, nach `categories:fabric` zu filtern. Nachgemessen an den je 20
 * groessten Modpacks je Kategorie, gegen den Lader ihrer neuesten Fassung:
 *
 *     categories:fabric     20 von 20 richtig
 *     categories:forge      17 von 20 richtig
 *     categories:neoforge   10 von 20 richtig
 *
 * Die Haelfte daneben — und die Ursache ist NICHT, dass Modrinth luegt (so
 * stand es hier bis heute). Ein Projekt traegt MEHRERE Kategorien, und Lader
 * und Themen stehen im selben Feld:
 *
 *     battlearmorytacz → combat, forge, multiplayer, neoforge, optimization
 *
 * `categories:neoforge` fragt also „hat neoforge irgendwo stehen", nicht „ist
 * neoforge". Als Filter ist das unbrauchbar, als Facette auch.
 *
 * ── Was stattdessen gefragt wird ────────────────────────────────────────────
 *
 * Der Lader steht an der FASSUNG (`loaders`), und den gibt es fuer eine ganze
 * Trefferseite in EINEM Abruf: Jeder Treffer nennt `latest_version`, und
 * `/versions?ids=[…]` loest bis zu 20 davon auf einmal auf (gemessen: 0,33 s
 * fuer 20). Nur wo die neueste Fassung nicht zur Spielfassung des Servers
 * passt, wird das eine Projekt einzeln nachgefragt.
 *
 * Die Spielfassung dagegen KANN die Suche selbst (`versions:26.2`) — sie steht
 * an jedem Treffer und nicht in einem Sammelfeld.
 *
 * ── Ohne `lader` bleibt alles wie vorher ────────────────────────────────────
 *
 * Beim ANLEGEN gibt es noch keinen Lader; dort bestimmt das Modpack ihn. Diese
 * Funktion filtert deshalb nur, wenn jemand einen Lader nennt — der Mods-Tab
 * eines bestehenden Servers tut das, der Anlege-Assistent nicht.
 */
async function sucheModpacks(begriff, optionen = {}) {
    const seite = Math.max(1, parseInt(optionen.seite, 10) || 1);
    const text = String(begriff || '').trim();
    const lader = optionen.lader ? String(optionen.lader) : null;
    const spielfassung = optionen.spielfassung ? String(optionen.spielfassung) : null;

    const roheSeite = async (nr) => {
        const gruppen = [alsListe(['project_type:modpack'])];
        // Die Facette heisst `versions`, nicht `game_versions` — derselbe
        // Unterschied wie bei den Mods (siehe `suche`).
        if (spielfassung) gruppen.push(alsListe([`versions:${spielfassung}`]));

        const abfrage = new URLSearchParams({
            query: text,
            facets: `[${gruppen.join(',')}]`,
            index: text ? 'relevance' : 'downloads',
            limit: String(PRO_SEITE),
            offset: String((nr - 1) * PRO_SEITE),
        });
        return hole(`/search?${abfrage}`);
    };

    const alsTreffer = (t, passend) => ({
        kennung:      t.slug,
        name:         t.title,
        beschreibung: t.description || '',
        bild:         t.icon_url || null,
        downloads:    t.downloads || 0,
        geaendert:    t.date_modified || null,
        // Was die Karte anzeigt, wenn gefiltert wurde — und was der Klick
        // danach nicht noch einmal erfragen muss.
        lader:        passend ? laderBeiUns(passend.loaders) : null,
        spielfassung: passend ? (passend.game_versions || [])[0] || null : null,
        fassung:      passend ? passend.version_number : null,
    });

    // Ohne Lader: die alte, ungefilterte Auskunft.
    if (!lader) {
        const daten = await roheSeite(seite);
        const gesamt = Number(daten.total_hits) || 0;
        return {
            treffer: (daten.hits || []).map(t => alsTreffer(t, null)),
            gesamt, seite,
            weiter:  (seite * PRO_SEITE) < gesamt,
            zurueck: seite > 1,
            proSeite: PRO_SEITE,
            gefiltert: false,
        };
    }

    // ── Mit Lader: nachfiltern und die Seite AUFFUELLEN ─────────────────────
    //
    // Nachfiltern macht Seiten kurz: Von 20 Rohtreffern bleiben bei neoforge
    // gemessen 10 uebrig. Eine Trefferliste mit drei Eintraegen und einem
    // „weiter"-Knopf sieht aber kaputt aus, nicht gefiltert. Deshalb werden
    // weitere Rohseiten geholt, bis eine volle Seite zusammen ist.
    //
    // Die Obergrenze steht, weil sonst eine Suche ohne Treffer den ganzen
    // Katalog durchginge: Wer „Pixelmon" auf einem Fabric-Server sucht,
    // bekaeme sonst 100 Abrufe und nach einer Minute eine leere Liste.
    const MAX_RUNDEN = 4;
    const gesammelt = [];
    let rohNr = seite;
    let erschoepft = false;
    let gesamtRoh = 0;

    for (let runde = 0; runde < MAX_RUNDEN && gesammelt.length < PRO_SEITE; runde++) {
        const daten = await roheSeite(rohNr);
        gesamtRoh = Number(daten.total_hits) || 0;
        const hits = daten.hits || [];
        if (!hits.length) { erschoepft = true; break; }

        for (const [t, passend] of await passendeFassungen(hits, lader, spielfassung)) {
            if (passend) gesammelt.push(alsTreffer(t, passend));
        }
        rohNr++;
        if (rohNr * PRO_SEITE > gesamtRoh + PRO_SEITE) { erschoepft = true; break; }
    }

    return {
        treffer: gesammelt.slice(0, PRO_SEITE),
        // ── Diese Zahl ist die UNGEFILTERTE ────────────────────────────────
        //
        // Und sie wird als solche ausgewiesen (`gefiltert: true`), statt eine
        // genaue zu erfinden: Wie viele Modpacks es fuer Fabric 26.2 wirklich
        // gibt, weiss man erst, wenn man jede Fassung jedes Pakets gefragt hat
        // — das waeren tausende Abrufe fuer eine Zahl, die niemand braucht.
        gesamt: gesamtRoh,
        seite,
        weiter:  !erschoepft && gesammelt.length >= PRO_SEITE,
        zurueck: seite > 1,
        proSeite: PRO_SEITE,
        gefiltert: true,
    };
}

/**
 * Zu jedem Treffer die Fassung, die zu Lader und Spielfassung passt — oder null.
 *
 * Zwei Stufen, und die zweite ist der Grund fuer die erste: Der Sammelabruf
 * kostet EINEN Aufruf fuer die ganze Seite, kennt aber nur die NEUESTE Fassung
 * jedes Pakets. Wessen neueste nicht passt, kann trotzdem eine aeltere haben,
 * die passt — ein Paket, das schon auf 26.3 ist, waehrend der Server noch 26.2
 * faehrt. Diese und nur diese werden einzeln gefragt.
 *
 * @returns {Promise<Array<[object, object|null]>>} Treffer und passende Fassung
 */
async function passendeFassungen(hits, lader, spielfassung) {
    const passt = (v) => {
        if (!v) return false;
        if (!laderBeiUns(v.loaders) || laderBeiUns(v.loaders) !== lader) return false;
        if (spielfassung && !(v.game_versions || []).includes(spielfassung)) return false;
        return true;
    };

    // Stufe 1 — eine Abfrage fuer die ganze Seite.
    const ids = hits.map(t => t.latest_version).filter(Boolean);
    const neueste = new Map();
    if (ids.length) {
        const liste = await hole(`/versions?ids=${encodeURIComponent(alsListe(ids))}`)
            .catch(() => []);
        for (const v of Array.isArray(liste) ? liste : []) neueste.set(v.project_id, v);
    }

    // Stufe 2 — nur fuer die, deren neueste nicht passt.
    const ergebnis = [];
    const nachzufragen = [];
    for (const t of hits) {
        const v = neueste.get(t.project_id);
        if (passt(v)) { ergebnis.push([t, v]); continue; }
        nachzufragen.push(t);
    }

    const nachgefragt = await Promise.all(nachzufragen.map(async (t) => {
        const abfrage = new URLSearchParams({ loaders: alsListe(laderBeiModrinth(lader)) });
        if (spielfassung) abfrage.set('game_versions', alsListe([spielfassung]));
        const liste = await hole(`/project/${encodeURIComponent(t.slug)}/version?${abfrage}`)
            .catch(() => []);
        const treffer = (Array.isArray(liste) ? liste : []).find(passt) || null;
        return [t, treffer];
    }));

    return ergebnis.concat(nachgefragt);
}

/**
 * Welche Lader kennt dieses Haus — und wie heissen sie bei Modrinth?
 *
 * Modrinth fuehrt auch `forge` und `quilt`. Wir nicht: Das Minecraft-Paket
 * kennt vanilla, paper, fabric, neoforge. Ein Paket fuer Forge wird deshalb
 * ABGEWIESEN und nicht auf NeoForge umgebogen — die beiden sind nicht
 * vertraeglich, und ein stillschweigender Tausch gaebe einen Server, der
 * startet und die Haelfte der Mods nicht laedt.
 */
const LADER_BEI_UNS = { fabric: 'fabric', neoforge: 'neoforge' };

/** Der Lader dieser Fassung, in unseren Worten — oder null. */
function laderBeiUns(loaders) {
    return (loaders || []).map(l => LADER_BEI_UNS[l]).filter(Boolean)[0] || null;
}

/**
 * Umgekehrt: unser Name → die Namen, unter denen Modrinth ihn fuehrt.
 *
 * Eine Liste und kein einzelner Wert, weil die Zuordnung nicht eins zu eins
 * bleiben muss: Sollte `fabric` dort einmal zusaetzlich als `fabric-loader`
 * gefuehrt werden, faengt es diese Stelle ab und nicht jeder Aufrufer.
 */
function laderBeiModrinth(unser) {
    return Object.entries(LADER_BEI_UNS)
        .filter(([, u]) => u === unser)
        .map(([bei]) => bei);
}

/**
 * Die gewaehlte Fassung eines Modpacks — samt dem, was sie VORSCHREIBT.
 *
 * Der Lader und die Spielfassung stehen an der Fassung selbst; das Archiv muss
 * dafuer nicht geladen werden (gemessen: `loaders: ["fabric"]`,
 * `game_versions: ["26.3"]`). Das Dashboard kann damit die Einstellungen des
 * Servers setzen, bevor irgendetwas heruntergeladen wird.
 *
 * @returns {Promise<object>} { kennung, name, fassung, url, sha1, bytes, lader, spielfassung }
 */
async function modpackFassung(kennung, fassung = null) {
    const slug = String(kennung || '').trim();
    if (!slug) throw new Error('Keine Kennung');

    const projektDaten = await projekt(slug);
    if (projektDaten?.art !== 'modpack') {
        throw new Error(`„${slug}" ist kein Modpack (Modrinth fuehrt es als ${projektDaten?.art || 'unbekannt'}).`);
    }

    const liste = await hole(`/project/${encodeURIComponent(slug)}/version`);
    if (!Array.isArray(liste) || !liste.length) throw new Error(`${slug}: keine Fassung`);
    const gewaehlt = fassung ? liste.find(v => v.version_number === fassung) : liste[0];
    if (!gewaehlt) throw new Error(`${slug}: Fassung ${fassung} gibt es nicht (mehr)`);

    // Die Hauptdatei ist die `.mrpack`. `primary` markiert sie; hat keine das
    // Merkmal, gilt die erste — so steht es auch bei den Mods.
    const datei = (gewaehlt.files || []).find(f => f.primary) || (gewaehlt.files || [])[0];
    if (!datei) throw new Error(`${slug} ${gewaehlt.version_number}: keine Datei`);

    const fremd = (gewaehlt.loaders || []).filter(l => !LADER_BEI_UNS[l]);
    const unser = (gewaehlt.loaders || []).map(l => LADER_BEI_UNS[l]).filter(Boolean)[0] || null;
    if (!unser) {
        throw new Error(`„${projektDaten.name}" verlangt ${fremd.join(' oder ') || 'einen Lader'}. `
            + 'Dieses Panel kennt fuer Minecraft Fabric und NeoForge — Forge und Quilt nicht. '
            + 'Ein Tausch waere kein Tausch: Die Lader sind untereinander unvertraeglich.');
    }

    return {
        kennung: slug,
        name: projektDaten.name,
        fassung: gewaehlt.version_number,
        url: datei.url,
        sha1: datei.hashes?.sha1 || null,
        bytes: datei.size || 0,
        lader: unser,
        spielfassung: (gewaehlt.game_versions || [])[0] || null,
    };
}

/** Die Seite zum Stoebern — Plugins und Mods liegen bei Modrinth getrennt. */
function verzeichnis(raum) {
    if (!raum) return null;
    return PLUGIN_LADER.includes(String(raum).toLowerCase())
        ? `${SEITE}/discover/plugins`
        : `${SEITE}/discover/mods`;
}

/**
 * Die Seite eines Mods.
 *
 * `/mod/<slug>` leitet auf den richtigen Typ um (gemessen: 301 auf
 * `/plugin/essentialsx`) — einen Typ zu raten waere also nicht noetig und
 * ginge bei Datenpaketen und Shadern auch schief.
 */
function adresse(raum, kennung) {
    return kennung ? `${SEITE}/mod/${encodeURIComponent(kennung)}` : null;
}

/** Aus der Antwort der API die Form machen, die alle Anbieter liefern. */
function alsPaket(slug, name, fassung) {
    const datei = (fassung.files || []).find(f => f.primary) || (fassung.files || [])[0];
    if (!datei) throw new Error(`${slug} ${fassung.version_number}: keine Datei an dieser Fassung`);

    return {
        kennung:      slug,
        name:         name || slug,
        fassung:      fassung.version_number,
        beschreibung: fassung.name || '',
        adresse:      datei.url,
        bytes:        datei.size || 0,
        // Nur PFLICHT-Abhaengigkeiten. Modrinth kennt auch „optional",
        // „incompatible" und „embedded" — die mitzuinstallieren hiesse, dem
        // Betreiber Dinge unterzuschieben, die er nicht gewaehlt hat.
        abhaengig:    (fassung.dependencies || []).filter(d => d.dependency_type === 'required'),
        veroeffentlicht: fassung.date_published || null,
        // Woran man sieht, ob die Fassung zum Server passt — das, was
        // Thunderstore nicht hat.
        spielfassungen: fassung.game_versions || [],
        lader:        fassung.loaders || [],
    };
}

/**
 * Ein Projekt in einer bestimmten oder in seiner neuesten Fassung.
 *
 * Gefiltert wird nach LADER: Eine Fabric-Fassung auf einem Paper-Server ist
 * keine Fassung, sondern eine Datei, die nicht laedt. Steht im Paket zusaetzlich
 * eine Spielfassung (`optionen.spielfassung`), wird auch danach gefiltert.
 */
async function paket(raum, kennung, fassung = null, optionen = {}) {
    const slug = String(kennung || '').trim();
    if (!slug) throw new Error('Keine Kennung');

    const abfrage = new URLSearchParams();
    if (raum) abfrage.set('loaders', alsListe([raum]));
    if (optionen.spielfassung) abfrage.set('game_versions', alsListe([optionen.spielfassung]));

    // Das zweite Tor. Die Suche haelt Modpacks heraus — aber eine Kennung kann
    // auch von Hand kommen (Adresszeile, Discord-Befehl, alte Zeile in der
    // Datenbank). Ohne diese Pruefung landete eine 355-MB-`.mrpack` in `mods/`
    // und taete dort nichts.
    const art = (await projekt(slug))?.art || null;
    if (art === 'modpack') {
        throw new Error(`„${slug}" ist ein MODPACK, keine einzelne Mod. Ein Modpack ist ein Archiv `
            + 'mit einer Liste von Dateien und einem overrides-Ordner; es bestimmt ausserdem Lader '
            + 'und Spielfassung selbst. Dieses Panel kann das noch nicht installieren — es würde '
            + 'nur die Archivdatei ablegen, wo das Spiel sie nie liest.');
    }

    const liste = await hole(`/project/${encodeURIComponent(slug)}/version?${abfrage}`);
    if (!Array.isArray(liste) || !liste.length) {
        throw new Error(`${slug}: keine Fassung für ${raum || 'diesen Server'}`
            + (optionen.spielfassung ? ` und ${optionen.spielfassung}` : ''));
    }

    // Die Liste kommt neueste zuerst (gemessen). Eine verlangte Fassung wird
    // darin gesucht — einen Endpunkt „Fassung nach Nummer" gibt es nicht.
    const gewaehlt = fassung
        ? liste.find(v => v.version_number === fassung)
        : liste[0];
    if (!gewaehlt) throw new Error(`${slug}: Fassung ${fassung} gibt es nicht (mehr)`);

    return alsPaket(slug, optionen.name || null, gewaehlt);
}

/**
 * Das Projekt zu einer ID oder einem Slug.
 *
 * Zwei Dinge stehen NUR hier und nicht an der Fassung: der lesbare Titel
 * („EssentialsX" statt `essentialsx`) und `client_side`. Letzteres ist die
 * Antwort auf „brauchen die Mitspieler ihn auch?" — und die kann bei Minecraft
 * nicht aus dem Spielpaket kommen: Ein Paper-Server traegt Plugins, die nur er
 * kennt, UND Fabric-Mods, die jeder Spieler haben muss.
 *
 * ⚠ `environment` an der Fassung sieht aus wie eine billigere Auskunft, ist es
 * aber nicht: Gemessen am 2026-09-14 meldet EssentialsX dort „unknown" und
 * Fabric API „client_or_server_prefers_both". Daraus etwas abzuleiten waere
 * geraten.
 */
async function projekt(id) {
    const p = await hole(`/project/${encodeURIComponent(id)}`);
    return {
        slug: p.slug,
        name: p.title,
        clientSeitig: p.client_side === 'required',
        // `project_type` sagt, WAS das ist: mod, plugin, modpack, resourcepack,
        // shader. Gebraucht wird es, um ein Modpack abzuweisen, bevor jemand
        // eine 355-MB-Archivdatei nach `mods/` laedt (2026-09-22).
        art: p.project_type || null,
    };
}

/**
 * Ein Projekt samt allem, was es zwingend braucht.
 *
 * Gleiche Form und gleiche Regel wie bei Thunderstore: Abhaengigkeiten stehen
 * VOR dem Paket, Fehlendes wird gemeldet statt uebersprungen. Der Unterschied
 * ist die Aufloesung — Modrinth nennt in einer Abhaengigkeit die Projekt-ID und
 * nur manchmal eine Fassung. Ohne Fassung nehmen wir die neueste, die zum Lader
 * passt; das ist dieselbe Wahl, die ein Mensch auf der Seite treffen wuerde.
 */
async function aufloesen(raum, kennung, fassung = null, optionen = {}) {
    const gefunden = new Map();
    const fehlend = [];

    // Dasselbe Projekt wird auf diesem Weg mehrfach gebraucht: einmal, um aus
    // der Abhaengigkeits-ID den Slug zu machen, und einmal fuer Titel und
    // `client_side`. Ein Zwischenspeicher fuer die Dauer EINER Aufloesung —
    // nichts, was veralten koennte.
    const projekte = new Map();
    const projektVon = async (id) => {
        if (!projekte.has(id)) projekte.set(id, await projekt(id));
        return projekte.get(id);
    };

    async function verfolge(slug, fest, tiefe) {
        if (tiefe > TIEFE) return null;

        let p;
        try {
            p = await paket(raum, slug, fest, optionen);
            // Titel und „brauchen die Mitspieler ihn auch?" stehen am PROJEKT.
            // Beim Aktualisieren wird das nicht geholt — dort geht es nur um
            // die Fassung, und ein zweiter Abruf je Zeile waere Verschwendung.
            const pr = await projektVon(slug);
            p.name = pr.name || p.name;
            p.clientSeitig = pr.clientSeitig;
        } catch (fehler) {
            fehlend.push(`${slug}${fest ? ' ' + fest : ''}: ${fehler.message}`);
            return null;
        }

        for (const d of p.abhaengig) {
            let ziel = null;
            try {
                if (d.version_id) {
                    const v = await hole(`/version/${encodeURIComponent(d.version_id)}`);
                    const pr = await projektVon(v.project_id);
                    ziel = { slug: pr.slug, fassung: v.version_number };
                } else if (d.project_id) {
                    const pr = await projektVon(d.project_id);
                    ziel = { slug: pr.slug, fassung: null };
                }
            } catch (fehler) {
                fehlend.push(`Abhängigkeit von ${slug}: ${fehler.message}`);
                continue;
            }
            if (!ziel) {
                fehlend.push(`Unlesbare Abhängigkeit von ${slug}`);
                continue;
            }
            if (gefunden.has(ziel.slug)) continue;
            await verfolge(ziel.slug, ziel.fassung, tiefe + 1);
        }

        const schon = gefunden.get(p.kennung);
        if (!schon || neuer(p, schon)) gefunden.set(p.kennung, p);
        return p;
    }

    const wurzel = await verfolge(String(kennung), fassung, 0);
    if (!wurzel) throw new Error(fehlend[0] || `${kennung} nicht gefunden`);

    return { pakete: [...gefunden.values()], fehlend };
}

/**
 * Ist a neuer als b?
 *
 * **Ueber das Datum, nicht ueber die Nummer.** Modrinth erzwingt kein SemVer:
 * Neben „2.22.0" gibt es „1.21.1-fabric-0.6" und „v3". Ein Zeichenkettenvergleich
 * waere hier genau die Sorte Pruefung, die meistens stimmt und dann still das
 * Falsche sagt.
 */
function neuer(a, b) {
    const ta = Date.parse(a?.veroeffentlicht || '');
    const tb = Date.parse(b?.veroeffentlicht || '');
    if (Number.isNaN(ta) || Number.isNaN(tb)) return false;
    return ta > tb;
}

/**
 * Vergleich zweier Fassungsnummern — fuer die Lader-Regel im gemeinsamen Weg.
 *
 * Modrinth-Projekte sind bei uns nie der Lader (der Serverkern kommt aus dem
 * Paket, nicht aus dem Katalog). Die Funktion muss es trotzdem geben, weil der
 * gemeinsame Weg sie kennt — sie antwortet ehrlich mit „weiss nicht", also
 * `false`, wenn die Nummern kein SemVer sind.
 */
function hoeher(a, b) {
    const teile = (s) => String(s || '').split('.').map(x => parseInt(x, 10));
    const va = teile(a), vb = teile(b);
    if (![...va, ...vb].every(Number.isFinite) || !va.length || !vb.length) return false;
    for (let i = 0; i < Math.max(va.length, vb.length); i++) {
        const x = va[i] || 0, y = vb[i] || 0;
        if (x !== y) return x > y;
    }
    return false;
}

/**
 * Ist diese Fassung neuer als die, die auf dem Server liegt?
 *
 * Zuerst das Datum (die Zeile fuehrt es seit dem 2026-09-14 mit), sonst die
 * Nummer — und wenn auch die nichts hergibt, lautet die Antwort „nein".
 * **Nein heisst hier „ich weiss es nicht":** Lieber bietet das Panel kein
 * Update an, als eines, das in Wahrheit eine Herabstufung ist.
 */
function neuerAls(paketNeu, zeile) {
    if (!paketNeu || !zeile) return false;
    if (paketNeu.fassung === zeile.fassung) return false;
    if (zeile.veroeffentlicht) return neuer(paketNeu, { veroeffentlicht: zeile.veroeffentlicht });
    return hoeher(paketNeu.fassung, zeile.fassung);
}

/**
 * Gibt es eine neuere Fassung als die installierte?
 *
 * Verglichen wird mit dem Erscheinungstag der installierten Fassung, den die
 * Zeile seit dem 2026-09-14 mitfuehrt. Fehlt er (Zeile von vorher), bleibt nur
 * der Nummernvergleich — und wenn auch der nichts sagt, meldet die Zeile das,
 * statt „nein" zu behaupten.
 */
async function aktualisierungen(raum, zeilen) {
    const Logger = ServiceManager.get('Logger');
    const ergebnis = [];

    for (const zeile of zeilen) {
        try {
            const p = await paket(raum, zeile.kennung);
            const gleich = p.fassung === zeile.fassung;

            ergebnis.push({
                id: zeile.id,
                kennung: zeile.kennung,
                installiert: zeile.fassung,
                neueste: p.fassung,
                neuer: neuerAls(p, zeile),
                neuesteVom: p.veroeffentlicht,
                installiertVom: gleich ? p.veroeffentlicht : null,
                spielfassungen: p.spielfassungen,
            });
        } catch (fehler) {
            Logger.warn(`[Modrinth] ${zeile.kennung} nicht abfragbar: ${fehler.message}`);
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
    sucheModpacks, modpackFassung, laderBeiUns, laderBeiModrinth,
    KENNUNG, TITEL, RAUM_NAME, HERKUNFT, PRO_SEITE,
    istErlaubt, suche, verzeichnis, adresse, paket, aufloesen, aktualisierungen,
    hoeher, neuerAls,
};
