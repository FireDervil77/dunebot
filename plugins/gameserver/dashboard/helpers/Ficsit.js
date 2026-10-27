'use strict';

/**
 * ficsit.app (Satisfactory Mod Repository) — suchen, Fassung waehlen,
 * Abhaengigkeiten aufloesen (Stufe 10, 2026-10-27).
 *
 * Dieselbe Rolle wie Thunderstore.js und Modrinth.js: Hier stehen die
 * ENTSCHEIDUNGEN (welcher Mod, welche Fassung, was kommt mit); die Datei holt
 * der Daemon (`gameserver.content.fetch`) — mit der Pruefsumme von hier.
 *
 * ── Alles hier ist am 2026-10-27 an der echten API gemessen ─────────────────
 *
 *   Abfragen  POST https://api.ficsit.app/v2/query (GraphQL, ohne Schluessel)
 *   Datei     GET  https://api.ficsit.app/v1/version/<id>/LinuxServer/download
 *             → 302 auf storage.ficsit.app/file/smr-prod-s3/mods/<id>/<Name>-LinuxServer-<v>.smod
 *
 * Eine `.smod` ist eine ZIP-Datei mit dem Plugin-Ordner an der Wurzel
 * (`SML.uplugin`, `Binaries/Linux/*.so`, `Content/Paks/LinuxServer/*`). Sie
 * gehoert nach `FactoryGame/Mods/<mod_reference>/` — einen Ordner je Mod.
 *
 * Je Fassung nennt die API:
 *  - `targets[]` — `Windows`, `WindowsServer`, `LinuxServer`, je mit eigener
 *    Adresse, SHA-256 und Groesse. Genommen wird NUR `LinuxServer`; die Summe
 *    am SML-Download nachgerechnet: stimmt.
 *  - `game_version` — ein Bereich gegen die CHANGELIST des Spiels (`>=491125`),
 *    nicht gegen „1.2.4.1". Die Changelist steht am Server in
 *    `Engine/Binaries/Linux/FactoryServer-Linux-Shipping.version` (513885).
 *  - `dependencies[]` — `mod_id` ist die mod_reference, `condition` ein
 *    SemVer-Bereich (`^3.12.0`), `optional` wird nicht mitinstalliert.
 *  - `required_on_remote` — der Spieler braucht den Mod auch.
 *  - `stability` (release/beta/alpha) und `approved`.
 *
 * Am Mod: `compatibility.EA.state` — Works, Damaged, Broken. Von den 100
 * meistgeladenen: 71 Works, 27 Broken, 2 Damaged; 12 ohne Ziel `LinuxServer`
 * (reine Client-Mods). **Broken und ohne LinuxServer fallen raus**
 * (Betreiber: „wir wollen nur hausgemachte Probleme"); Damaged bleibt, mit
 * seiner Begruendung als Warnung.
 */

const semver = require('semver');
const { ServiceManager } = require('dunebot-core');

/**
 * Von wo darf geladen werden. **Dieselbe Liste steht im Daemon**
 * (`internal/gameserver/inhalte_holen.go`); `scripts/check-herkunftsliste.js`
 * haelt beide zusammen. Gemessen: die API leitet auf `storage.` um.
 */
const HERKUNFT = ['api.ficsit.app', 'storage.ficsit.app'];

const KENNUNG = 'ficsit';
const TITEL = 'ficsit.app';
/** ficsit.app kennt nur ein Spiel — der „Raum" steht trotzdem im Paket, wie bei den anderen. */
const RAUM_NAME = 'Spiel';

const API = 'https://api.ficsit.app';
const FRIST_MS = 15000;
const PRO_SEITE = 20;
/** Wie viele Ebenen tief Abhaengigkeiten verfolgt werden. */
const TIEFE = 5;
/** Wie viele Fassungen eines Mods gefragt werden. */
const FASSUNGEN = 100;
/** Das Ziel unserer Server. */
const ZIEL = 'LinuxServer';
/** Der Zweig unserer Server — ficsit.app fuehrt `EA` (public) und `EXP` (experimental). */
const ZWEIG = 'EA';

function istErlaubt(adresse) {
    let u;
    try { u = new URL(adresse); } catch { return false; }
    if (u.protocol !== 'https:') return false;
    return HERKUNFT.includes(u.hostname);
}

/** Eine Abfrage gegen die API — mit Frist, mit Fehlertext, ohne stille Rueckfaelle. */
async function frage(abfrage, variablen = {}) {
    const antwort = await fetch(`${API}/v2/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'firebot-dashboard' },
        body: JSON.stringify({ query: abfrage, variables: variablen }),
        signal: AbortSignal.timeout(FRIST_MS),
    });
    if (!antwort.ok) throw new Error(`ficsit.app antwortete ${antwort.status}`);
    const daten = await antwort.json();
    // GraphQL antwortet auch bei Fehlern mit 200 — die stehen in `errors`.
    if (Array.isArray(daten.errors) && daten.errors.length) {
        throw new Error(`ficsit.app: ${daten.errors.map(e => e.message).join('; ')}`);
    }
    return daten.data;
}

/**
 * Passt ein `game_version`-Bereich zur Changelist des Servers?
 *
 * `true`/`false`, oder `null`, wenn es sich nicht sagen laesst (Changelist
 * unbekannt, Bereich unlesbar). Die Changelist ist eine ganze Zahl; als
 * `513885.0.0` versteht SemVer `>=491125` richtig (gemessen am Bereich der SML).
 */
function passt(bereich, changelist) {
    const cl = parseInt(changelist, 10);
    if (!Number.isFinite(cl) || cl <= 0 || !String(bereich || '').trim()) return null;
    try {
        if (!semver.validRange(bereich)) return null;
        return semver.satisfies(`${cl}.0.0`, bereich);
    } catch {
        return null;
    }
}

/** Der Stand des Mods auf unserem Zweig — `Works`, `Damaged`, `Broken` oder null. */
function stand(mod) {
    return mod?.compatibility?.[ZWEIG]?.state || null;
}

/** Die Begruendung, wenn der Mod beschaedigt ist — sonst null. */
function warnungVon(mod) {
    if (stand(mod) !== 'Damaged') return null;
    const notiz = String(mod.compatibility[ZWEIG].note || '').trim();
    return `ficsit.app führt ihn als „Damaged"${notiz ? ': ' + notiz : ''}`;
}

function linuxZiel(fassung) {
    return (fassung?.targets || []).find(t => t.targetName === ZIEL) || null;
}

/** Warum ein Treffer nicht angeboten wird — oder null. Dieselbe Regel in Suche und Paket. */
function ausschluss(mod, fassung, changelist) {
    if (stand(mod) === 'Broken') return `ficsit.app führt „${mod.name || mod.mod_reference}" als Broken`;
    if (!fassung) return 'keine veröffentlichte Fassung';
    if (!linuxZiel(fassung)) return 'kein Linux-Server-Ziel — ein reiner Client-Mod';
    if (passt(fassung.game_version, changelist) === false) {
        return `verlangt Spielfassung ${fassung.game_version}, der Server hat ${changelist}`;
    }
    return null;
}

const SUCHFELDER = `mod_reference name short_description logo downloads last_version_date
    compatibility { ${ZWEIG} { state note } }
    latestVersions { release { version game_version required_on_remote size targets { targetName } } }`;

/**
 * Suchen.
 *
 * Gefiltert wird HIER, nach dem Abruf — die API kennt keinen Filter fuer
 * Kompatibilitaet oder Ziel. `gesamt` ist deshalb die Zahl der API, und eine
 * Seite kann weniger als 20 Treffer zeigen; `ausgeblendet` sagt, wie viele auf
 * dieser Seite herausfielen. Ohne Changelist (Server noch nie installiert)
 * wird nach Spielfassung nicht gefiltert — wie bei Modrinth.
 */
async function suche(raum, begriff, optionen = {}) {
    const seite = Math.max(1, parseInt(optionen.seite, 10) || 1);
    const text = String(begriff || '').trim();
    const filter = {
        limit: PRO_SEITE, offset: (seite - 1) * PRO_SEITE,
        order_by: text ? 'search' : 'downloads', order: 'desc',
        ...(text ? { search: text } : {}),
    };
    const daten = await frage(`query ($f: ModFilter) { getMods(filter: $f) { count mods { ${SUCHFELDER} } } }`, { f: filter });
    const roh = daten.getMods?.mods || [];
    const gesamt = Number(daten.getMods?.count) || 0;

    const treffer = [];
    for (const m of roh) {
        const f = m.latestVersions?.release || null;
        if (ausschluss(m, f, optionen.spielfassung)) continue;
        treffer.push({
            kennung:      m.mod_reference,
            name:         m.name,
            beschreibung: m.short_description || '',
            bild:         m.logo || null,
            downloads:    m.downloads || 0,
            bytes:        f.size || 0,
            veraltet:     false,
            geaendert:    m.last_version_date || null,
            fassung:      f.version,
            spielfassungen: [f.game_version].filter(Boolean),
            clientSeitig: Boolean(f.required_on_remote),
            warnung:      warnungVon(m),
        });
    }
    return {
        treffer, gesamt, seite,
        weiter: seite * PRO_SEITE < gesamt,
        zurueck: seite > 1,
        proSeite: PRO_SEITE,
        ausgeblendet: roh.length - treffer.length,
    };
}

function verzeichnis() {
    return 'https://ficsit.app/mods';
}

function adresse(raum, kennung) {
    const k = String(kennung || '').trim();
    return k ? `https://ficsit.app/mod/${encodeURIComponent(k)}` : null;
}

/** Ein Mod mit seinen Fassungen (neueste zuerst) — oder ein Fehler, der ihn nennt. */
async function modMitFassungen(kennung) {
    const k = String(kennung || '').trim();
    if (!k) throw new Error('Keine Kennung');
    const daten = await frage(`query ($r: ModReference!, $f: VersionFilter) { getModByReference(modReference: $r) {
        mod_reference name compatibility { ${ZWEIG} { state note } }
        versions(filter: $f) { version stability approved game_version required_on_remote created_at
            targets { targetName link hash size } dependencies { mod_id condition optional } } } }`,
    { r: k, f: { limit: FASSUNGEN, order_by: 'created_at', order: 'desc' } });
    const mod = daten.getModByReference;
    if (!mod) throw new Error(`${k}: gibt es bei ficsit.app nicht`);
    return mod;
}

/** Die Form, die der gemeinsame Weg kennt (wie alsPaket bei Modrinth). */
function alsPaket(mod, f) {
    const ziel = linuxZiel(f);
    return {
        kennung:      mod.mod_reference,
        name:         mod.name || mod.mod_reference,
        fassung:      f.version,
        beschreibung: '',
        adresse:      `${API}${ziel.link}`,
        bytes:        ziel.size || 0,
        // Die Summe der LINUX-Datei, nicht die der Fassung — gemessen an der SML.
        sha256:       ziel.hash || null,
        abhaengig:    (f.dependencies || []).filter(d => !d.optional),
        veroeffentlicht: f.created_at || null,
        spielfassungen: [f.game_version].filter(Boolean),
        clientSeitig: Boolean(f.required_on_remote),
        warnung:      warnungVon(mod),
    };
}

/** Darf diese Fassung auf einen Server? Nur freigegebene mit Linux-Ziel. */
function installierbar(f) {
    return Boolean(f && f.approved !== false && linuxZiel(f));
}

/**
 * Ein Mod in einer bestimmten oder in seiner neuesten passenden Fassung.
 *
 * Ohne Fassung: die neueste FREIGEGEBENE `release`-Fassung mit Linux-Ziel, die
 * zur Changelist passt (wenn bekannt). `bereich` (aus einer Abhaengigkeit)
 * waehlt die hoechste Fassung darin.
 *
 * Das zweite Tor wie bei Modrinth: Eine Kennung kann auch von Hand kommen —
 * ein Broken-Mod scheitert dann HIER, nicht erst im Spiel.
 */
async function paket(raum, kennung, fassung = null, optionen = {}) {
    const mod = await modMitFassungen(kennung);
    if (stand(mod) === 'Broken') {
        throw new Error(`ficsit.app führt „${mod.name}" als Broken — er wird nicht installiert`);
    }
    const alle = (mod.versions || []).filter(installierbar);
    let gewaehlt;
    if (fassung) {
        gewaehlt = alle.find(f => f.version === fassung);
        if (!gewaehlt) throw new Error(`${mod.mod_reference}: Fassung ${fassung} gibt es nicht für Linux-Server`);
    } else {
        const passend = alle.filter(f => passt(f.game_version, optionen.spielfassung) !== false
            && (!optionen.bereich || (semver.valid(f.version) && semver.satisfies(f.version, optionen.bereich))));
        gewaehlt = passend.find(f => f.stability === 'release') || null;
        if (!gewaehlt) {
            throw new Error(`${mod.mod_reference}: keine veröffentlichte Fassung für Linux-Server`
                + (optionen.bereich ? ` im Bereich ${optionen.bereich}` : '')
                + (optionen.spielfassung ? ` zu Spielfassung ${optionen.spielfassung}` : ''));
        }
    }
    const grund = ausschluss(mod, gewaehlt, optionen.spielfassung);
    if (grund) throw new Error(`${mod.mod_reference} ${gewaehlt.version}: ${grund}`);
    return alsPaket(mod, gewaehlt);
}

/**
 * Alle Fassungen, die auf diesen Server passen — neueste zuerst.
 *
 * Gefiltert wie ueberall: Linux-Ziel, freigegeben, und zur Changelist passend,
 * wenn sie bekannt ist. `art` ist die Stabilitaet (release/beta/alpha).
 */
async function fassungen(raum, kennung, optionen = {}) {
    const mod = await modMitFassungen(kennung);
    const liste = (mod.versions || [])
        .filter(f => installierbar(f) && passt(f.game_version, optionen.spielfassung) !== false)
        .map(f => ({
            fassung: f.version,
            veroeffentlicht: f.created_at || null,
            bytes: linuxZiel(f).size || 0,
            art: f.stability || null,
            spielfassungen: [f.game_version].filter(Boolean),
        }));
    const voll = (mod.versions || []).length < FASSUNGEN;
    return {
        liste,
        vollstaendig: voll,
        grund: voll ? null : `Gezeigt werden die neuesten ${FASSUNGEN} Fassungen — ältere stehen auf der Seite des Mods.`,
    };
}

/**
 * Was alles installiert werden muss — Abhaengigkeiten VORNE.
 *
 * Eine Abhaengigkeit kommt als BEREICH (`SML ^3.12.0`), nicht als feste
 * Fassung wie bei Thunderstore. Genommen wird die hoechste Fassung im Bereich,
 * die zum Server passt. Braucht ein zweiter Mod denselben in einem anderen
 * Bereich, wird geprueft, ob die gewaehlte auch dort liegt — sonst steht es in
 * `fehlend`, statt still eine zu nehmen, die einer von beiden nicht will.
 */
async function aufloesen(raum, kennung, fassung = null, optionen = {}) {
    const gefunden = new Map();      // kennung → Paket
    const bereiche = new Map();      // kennung → [Bereich, wer verlangt]
    const fehlend = [];

    async function verfolge(k, fest, bereich, von, tiefe) {
        if (tiefe > TIEFE) return null;
        if (bereich) {
            if (!bereiche.has(k)) bereiche.set(k, []);
            bereiche.get(k).push([bereich, von]);
        }
        if (gefunden.has(k)) return gefunden.get(k);

        let p;
        try {
            p = await paket(raum, k, fest, { ...optionen, bereich });
        } catch (fehler) {
            fehlend.push(`${k}${fest ? ' ' + fest : bereich ? ' ' + bereich : ''}: ${fehler.message}`);
            return null;
        }
        for (const d of p.abhaengig) {
            await verfolge(d.mod_id, null, d.condition || null, p.kennung, tiefe + 1);
        }
        gefunden.set(p.kennung, p);
        return p;
    }

    const wurzel = await verfolge(String(kennung), fassung, null, null, 0);
    if (!wurzel) throw new Error(fehlend[0] || `${kennung} nicht gefunden`);

    for (const [k, liste] of bereiche) {
        const p = gefunden.get(k);
        if (!p || !semver.valid(p.fassung)) continue;
        for (const [bereich, von] of liste) {
            if (!semver.satisfies(p.fassung, bereich)) {
                fehlend.push(`${von} verlangt ${k} ${bereich}, gewählt ist ${p.fassung}`);
            }
        }
    }
    return { pakete: [...gefunden.values()], fehlend };
}

/** Ist a hoeher als b? SemVer, wo es geht; sonst Zahl fuer Zahl wie bei Thunderstore. */
function hoeher(a, b) {
    if (semver.valid(a) && semver.valid(b)) return semver.gt(a, b);
    const zahlen = s => String(s || '0').split('.').map(n => parseInt(n, 10) || 0);
    const x = zahlen(a), y = zahlen(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
        const d = (x[i] || 0) - (y[i] || 0);
        if (d !== 0) return d > 0;
    }
    return false;
}

function neuerAls(paketNeu, zeile) {
    return hoeher(paketNeu?.fassung, zeile?.fassung);
}

/**
 * Gibt es eine neuere Fassung? Fehler eines Mods beenden die Liste nicht.
 *
 * ⚠ Ohne Changelist (bis Stufe 10 S3) kann eine Fassung vorgeschlagen werden,
 * die ein neueres Spiel verlangt — `paket` filtert dann nicht nach Spielfassung.
 */
async function aktualisierungen(raum, zeilen, optionen = {}) {
    const Logger = ServiceManager.get('Logger');
    const ergebnis = [];
    for (const zeile of zeilen) {
        try {
            const p = await paket(raum, zeile.kennung, null, optionen);
            ergebnis.push({
                id: zeile.id, kennung: zeile.kennung,
                installiert: zeile.fassung, neueste: p.fassung,
                neuer: hoeher(p.fassung, zeile.fassung),
                neuesteVom: p.veroeffentlicht,
                installiertVom: p.fassung === zeile.fassung ? p.veroeffentlicht : null,
            });
        } catch (fehler) {
            Logger.warn(`[Ficsit] ${zeile.kennung} nicht abfragbar: ${fehler.message}`);
            ergebnis.push({
                id: zeile.id, kennung: zeile.kennung,
                installiert: zeile.fassung, neueste: null, neuer: false, fehler: fehler.message,
            });
        }
    }
    return ergebnis;
}

module.exports = {
    KENNUNG, TITEL, RAUM_NAME, HERKUNFT, PRO_SEITE,
    istErlaubt, suche, verzeichnis, adresse, paket, aufloesen, aktualisierungen, fassungen,
    hoeher, neuerAls,
    // für den Wächter
    passt, ausschluss,
};
