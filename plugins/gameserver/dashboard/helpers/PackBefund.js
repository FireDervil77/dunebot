'use strict';

/**
 * Der Server-Befund je Modpack-Fassung (K226, vorher Baustelle 187).
 *
 * ── Die Frage ───────────────────────────────────────────────────────────────
 *
 * Läuft diese Fassung dieses Modpacks auf einem Server — und wenn ja, ohne
 * welche Dateien? Betreiber, 2026-10-14: „wichtig ist, dass die suche es
 * schafft, modpacks von client files zu unterscheiden, und das am besten schon
 * am modpack."
 *
 * Die Angabe des Pack-Autors reicht dafür nicht (gemessen): BMC4 v59 führt
 * alle 340 Dateien als „Server nötig", 63 davon sind laut ihren eigenen
 * Autoren reine Client-Mods, und drei Pflicht-Mods liegen dem Paket gar nicht
 * bei, sondern sollen von CurseForge nachgeladen werden.
 *
 * ── Ein Befund, eine Stelle ─────────────────────────────────────────────────
 *
 * Eine Fassung bei Modrinth ändert sich nie. Der Befund wird deshalb EINMAL
 * gerechnet und in `modpack_befunde` gespeichert — Katalogwissen ohne
 * Guild-Bezug. Suche, Auswahl und Einspielen lesen denselben Befund über
 * `befund()`; niemand rechnet daneben selbst.
 *
 * ── Zwei Stufen ─────────────────────────────────────────────────────────────
 *
 *   1  Sekunden, nur die API: die Bestandteile der Fassung und was Modrinth an
 *      jedem Projekt führt → welche Dateien reine Client-Mods sind.
 *   2  gründlich, beim Auswählen: das Archiv per HTTP-Range (Verzeichnis,
 *      `modrinth.index.json`, beigelegte Mods, Liste externer Downloads) und
 *      von jeder Mod ihre Beschreibung → fehlen Pflichtabhängigkeiten?
 *
 * ── Wann „unvollständig" ────────────────────────────────────────────────────
 *
 * Nur wenn eine Mod, die auf dem Server landet, eine Pflichtabhängigkeit
 * nennt, die KEINE Datei des Pakets erfüllt, und alle Dateien lesbar waren.
 * Das Urteil blendet ein Paket für alle aus; im Zweifel heißt es `unklar`.
 * Die Nachsicht im Einzelnen steht in `ModBeschreibung.js`.
 *
 * ── `regel` ─────────────────────────────────────────────────────────────────
 *
 * Wird die Prüfregel besser, wird `REGEL` erhöht: Ein Befund mit älterer
 * Regel gilt als nicht vorhanden und wird neu gerechnet, statt einem alten
 * Urteil zu glauben.
 */

const { ServiceManager } = require('dunebot-core');
const ZipFern = require('./ZipFern');
const ModBeschreibung = require('./ModBeschreibung');

// 2 (2026-11-13, K379): `ModBeschreibung` liest eingebettete Jars auch aus der
// Manifest-Angabe `Embedded-Dependencies-Mod` und direkt aus `META-INF/jarjar/`
// (Connector). Ein Befund nach Regel 1 konnte `connectormod` als fehlend führen.
const REGEL = 2;
const QUELLE = 'modrinth';

const URTEIL = Object.freeze({
    LAEUFT: 'laeuft',
    OHNE_CLIENT: 'laeuft_ohne_client',
    UNVOLLSTAENDIG: 'unvollstaendig',
    UNKLAR: 'unklar',
});

/** So viele Kennungen je Sammelabruf — die Adresse bleibt damit weit unter jeder Grenze. */
const STUECK = 80;
/** So viele Mods werden zugleich gelesen (cdn.modrinth.com, nicht die API mit ihrem Limit). */
const GLEICHZEITIG = 8;
/** Das Ende eines Mod-Jars: Das Verzeichnis ist klein. */
const JAR_SCHWANZ = 32 * 1024;
const INDEX_GRENZE = 32 * 1024 * 1024;
const BEIGABE_GRENZE = 64 * 1024 * 1024;
const LISTE_GRENZE = 2 * 1024 * 1024;

/** Was der Lader selbst mitbringt. */
const EINGEBAUT = ['minecraft', 'java', 'forge', 'neoforge', 'fabricloader', 'fabric-loader'];

/**
 * Listen, über die ein Paket Mods von außerhalb nachlädt.
 *
 * `missing_mods_checker.json` gehört zur Mod „Missing Mods Checker": Sie
 * fordert den Spieler beim ersten Start auf, die genannten Dateien von
 * CurseForge zu holen (gemessen an BMC4 v59, 2026-11-12: 23 Einträge mit
 * `displayName`, `pattern`, `url`). Ein Server holt nichts nach.
 */
const EXTERNE_LISTEN = /^(?:overrides|server-overrides)\/config\/missing_mods_checker\.json$/;

const BEIGELEGTE_MOD = /^(overrides|server-overrides)\/mods\/([^/]+\.jar)$/i;

/** Wie der Daemon (`istModJar`): nur direkt in `mods/`. */
const istModJar = (pfad) => /^mods\/[^/]+\.jar$/i.test(String(pfad || ''));

const stuecke = (werte) => {
    const aus = [];
    for (let i = 0; i < werte.length; i += STUECK) aus.push(werte.slice(i, i + STUECK));
    return aus;
};

const alsListe = (werte) => JSON.stringify(werte.map(String));

/** Für den Vergleich von Namen: nur Buchstaben und Ziffern, klein. */
const kern = (text) => String(text || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Mehrere Aufgaben, höchstens `GLEICHZEITIG` auf einmal. Der erste Fehler bricht ab. */
async function nebeneinander(dinge, tue, beiSchritt = () => {}) {
    let naechstes = 0;
    let fertig = 0;
    const laeufer = async () => {
        while (naechstes < dinge.length) {
            const ding = dinge[naechstes++];
            await tue(ding);
            beiSchritt(++fertig, dinge.length);
        }
    };
    await Promise.all(Array.from({ length: Math.min(GLEICHZEITIG, dinge.length) }, laeufer));
}

/** Womit gerechnet wird — die Wächter setzen hier Attrappen ein. */
function umgebung(u = {}) {
    const Modrinth = require('./Modrinth');
    return {
        hole: u.hole || Modrinth.hole,
        abruf: u.abruf || fetch,
        erlaubt: u.erlaubt || Modrinth.istErlaubt,
        kopf: u.kopf || Modrinth.KOPF,
        db: u.db || ServiceManager.get('dbService'),
    };
}

/**
 * Stufe 1 — aus der Fassung und den Projekten, ohne das Archiv.
 *
 * Die Fassung eines Pakets nennt, was sie enthält (`dependencies`, je mit
 * `project_id` und `version_id`). Am PROJEKT steht, was der Autor der Mod
 * sagt (`server_side`) — er weiß es, der Autor des Pakets oft nicht („One
 * block horror" 1.0.4: alle 42 als nötig markiert, darunter Oculus und
 * Rubidium).
 *
 * @returns {Promise<{client: Array<{name: string, sha1: string[]}>, einzelheiten: Object}>}
 */
async function rechneEins(version, u) {
    const alle = version.dependencies || [];
    const enthalten = alle.filter(d => d.project_id && d.version_id);
    const ohneHerkunft = alle.filter(d => !d.project_id);

    const projekte = new Map();
    for (const teil of stuecke([...new Set(enthalten.map(d => d.project_id))])) {
        for (const p of await u.hole(`/projects?ids=${encodeURIComponent(alsListe(teil))}`)) projekte.set(p.id, p);
    }
    const seite = (d) => projekte.get(d.project_id)?.server_side || 'unknown';
    const nurClient = enthalten.filter(d => seite(d) === 'unsupported');

    const client = [];
    for (const teil of stuecke(nurClient.map(d => d.version_id))) {
        for (const f of await u.hole(`/versions?ids=${encodeURIComponent(alsListe(teil))}`)) {
            const sha1 = (f.files || [])
                .map(datei => String(datei.hashes?.sha1 || '').toLowerCase())
                .filter(summe => /^[0-9a-f]{40}$/.test(summe));
            client.push({ name: projekte.get(f.project_id)?.title || f.project_id, sha1 });
        }
    }

    const zahl = (wert) => enthalten.filter(d => seite(d) === wert).length;
    return {
        client,
        einzelheiten: {
            bestandteile: alle.length,
            mit_herkunft: enthalten.length,
            ohne_herkunft: ohneHerkunft.length,
            ohne_herkunft_dateien: ohneHerkunft.map(d => d.file_name).filter(Boolean).slice(0, 200),
            server_noetig: zahl('required'),
            server_optional: zahl('optional'),
            nur_client: nurClient.length,
            ohne_auskunft: zahl('unknown'),
        },
    };
}

/** Aus der Liste der Client-Mods das, was der Daemon bekommt. */
function alsAuslassen(client) {
    return {
        sha1: [...new Set(client.flatMap(c => c.sha1))],
        namen: [...new Set(client.map(c => c.name))].sort(),
    };
}

/** Ein Lesefehler, der an der DATEI liegt (kaputt, fremdes Format) — nicht am Netz. */
function liegtAnDerDatei(fehler) {
    if (fehler?.netz) return false;
    return /^Zip:/.test(fehler?.message || '') || String(fehler?.code || '').startsWith('Z_')
        || fehler?.code === 'ERR_BUFFER_TOO_LARGE' || fehler instanceof SyntaxError;
}

/**
 * Stufe 2 — das Archiv und die Mods selbst.
 *
 * @returns {Promise<{urteil: string, auslassen: Object, fehlt: Object[], einzelheiten: Object}>}
 */
async function rechneZwei(paket, version, eins, u, beiFortschritt) {
    const zaehler = { abrufe: 0, bytes: 0 };
    const netz = { abruf: u.abruf, kopf: u.kopf, zaehler };

    const datei = (version.files || []).find(f => f.primary) || (version.files || [])[0];
    if (!datei?.url) throw new Error('Die Fassung nennt keine Datei');
    if (!u.erlaubt(datei.url)) throw new Error(`Das Archiv liegt nicht bei Modrinth (${new URL(datei.url).hostname})`);

    beiFortschritt({ phase: 'befund_archiv' });
    const archiv = await ZipFern.fernQuelle(datei.url, { ...netz, groesse: datei.size });
    const eintraege = await ZipFern.verzeichnis(archiv);
    const indexEintrag = eintraege.find(e => e.name === 'modrinth.index.json');
    if (!indexEintrag) throw new Error('Zip: Das Archiv enthält kein modrinth.index.json');
    const index = JSON.parse((await ZipFern.liesEintrag(archiv, indexEintrag, INDEX_GRENZE)).toString('utf8'));

    // ── Was auf dem Server landet ───────────────────────────────────────────
    //
    // Dieselbe Auswahl wie im Daemon (`waehleFuerServer`, `schreibeBeigaben`):
    // aus dem Verzeichnis alles, was das Paket nicht selbst als Client-Datei
    // führt und was nicht im Abgleich steht; dazu die beigelegten Mods aus
    // `overrides/` und `server-overrides/`.
    const clientNach = new Map();
    for (const c of eins.client) for (const summe of c.sha1) clientNach.set(summe, c);

    const kandidaten = [];
    let paketClient = 0;
    for (const f of index.files || []) {
        if (!istModJar(f.path)) continue;
        if (f.env && f.env.server === 'unsupported') { paketClient++; continue; }
        const sha1 = String(f.hashes?.sha1 || '').toLowerCase();
        kandidaten.push({
            datei: String(f.path).slice(5),
            sha1,
            adressen: Array.isArray(f.downloads) ? f.downloads : [],
            groesse: Number(f.fileSize) || 0,
            client: clientNach.get(sha1) || null,
        });
    }
    const beigelegt = new Map();
    for (const e of eintraege) {
        const m = BEIGELEGTE_MOD.exec(e.name);
        // `server-overrides` überschreibt `overrides` — so schreibt es auch der Daemon.
        if (m && (m[1] === 'server-overrides' || !beigelegt.has(m[2]))) beigelegt.set(m[2], e);
    }
    for (const [name, eintrag] of beigelegt) kandidaten.push({ datei: name, eintrag, client: null });

    const eingebettetUnlesbar = [];
    const lies = async (k) => {
        try {
            if (k.eintrag) {
                k.quelle = ZipFern.pufferQuelle(await ZipFern.liesEintrag(archiv, k.eintrag, BEIGABE_GRENZE));
            } else {
                const adresse = k.adressen.find(u.erlaubt);
                if (!adresse) { k.nichtGelesen = 'liegt nicht bei Modrinth'; return; }
                k.quelle = await ZipFern.fernQuelle(adresse, { ...netz, groesse: k.groesse, schwanz: JAR_SCHWANZ });
            }
            k.b = await ModBeschreibung.beschreibe(k.quelle, paket.lader);
            if (k.b.unlesbar) k.nichtGelesen = k.b.unlesbar;
            if (k.eintrag) {
                // Eine beigelegte Mod liegt ganz im Speicher (im Archiv ist sie
                // gepackt, Teilstücke gibt es nicht). Was in ihr steckt, wird
                // deshalb gleich gelesen und der Speicher wieder freigegeben —
                // sonst hielte der Befund alle Beigaben eines Pakets zugleich.
                const innen = await ModBeschreibung.eingebetteteKennungen(k.quelle, k.b, paket.lader);
                k.innen = innen.kennungen;
                eingebettetUnlesbar.push(...innen.unlesbar.map(t => `${k.datei} → ${t}`));
                k.quelle = null;
            }
        } catch (fehler) {
            // Am Netz gescheitert: kein Befund, später noch einmal. An der
            // Datei gescheitert: Das ist ein Befund über die Datei.
            if (!liegtAnDerDatei(fehler)) throw fehler;
            k.nichtGelesen = fehler.message;
        }
    };
    await nebeneinander(kandidaten, lies,
        (fertig, gesamt) => beiFortschritt({ phase: 'befund', fertig, gesamt }));

    // ── Pflichtabhängigkeiten gegen den Server-Bestand ──────────────────────
    const nameVon = (k) => k.b?.name || k.datei;
    const bietet = (k) => [...(k.b?.kennungen || []), ...(k.innen || [])];
    const aktiv = kandidaten.filter(k => !k.client);
    const zurueckgestellt = kandidaten.filter(k => k.client);
    const behalten = [];

    const offene = () => {
        const da = new Set(EINGEBAUT);
        for (const k of aktiv) for (const kennung of bietet(k)) da.add(kennung);
        const fehlt = new Map();
        for (const k of aktiv) {
            for (const kennung of k.b?.braucht || []) {
                if (da.has(kennung)) continue;
                if (!fehlt.has(kennung)) fehlt.set(kennung, []);
                fehlt.get(kennung).push(nameVon(k));
            }
        }
        return fehlt;
    };

    // ── Eine „Client-Mod", die der Server doch braucht, bleibt ──────────────
    //
    // Modrinth führt sie als reine Client-Mod, eine Mod auf dem Server nennt
    // sie aber als Pflicht. Ohne sie bricht der Lader mit Sicherheit ab, mit
    // ihr nur vielleicht — also bleibt sie, und der Befund nennt sie.
    const loeseAuf = () => {
        for (;;) {
            let bewegt = false;
            for (const [kennung, von] of offene()) {
                const stelle = zurueckgestellt.findIndex(k => bietet(k).includes(kennung));
                if (stelle < 0) continue;
                const [k] = zurueckgestellt.splice(stelle, 1);
                aktiv.push(k);
                behalten.push({ name: k.client.name, kennung, gebraucht_von: von.slice(0, 5) });
                bewegt = true;
            }
            if (!bewegt) return;
        }
    };
    loeseAuf();

    // Erst wenn dann noch etwas fehlt, werden die eingebetteten Jars geöffnet
    // (Jar-in-Jar) — das kostet je Jar einen Abruf und ist meist nicht nötig.
    if (offene().size) {
        beiFortschritt({ phase: 'befund_eingebettet' });
        await nebeneinander(kandidaten.filter(k => k.quelle && k.b?.eingebettet.length), async (k) => {
            const innen = await ModBeschreibung.eingebetteteKennungen(k.quelle, k.b, paket.lader);
            k.innen = innen.kennungen;
            eingebettetUnlesbar.push(...innen.unlesbar.map(t => `${k.datei} → ${t}`));
        });
        loeseAuf();
    }

    // ── Was das Paket von außerhalb nachladen lässt ─────────────────────────
    const extern = [];
    for (const e of eintraege.filter(x => EXTERNE_LISTEN.test(x.name))) {
        try {
            const liste = JSON.parse((await ZipFern.liesEintrag(archiv, e, LISTE_GRENZE)).toString('utf8'));
            for (const z of Array.isArray(liste) ? liste : []) {
                if (!z?.displayName && !z?.pattern) continue;
                let host = null;
                try { host = new URL(z.url).hostname; } catch { host = null; }
                extern.push({ name: String(z.displayName || z.pattern), muster: String(z.pattern || ''), host });
            }
        } catch (fehler) {
            if (!liegtAnDerDatei(fehler)) throw fehler;
        }
    }

    const fehlt = [...offene()].map(([kennung, von]) => {
        const liste = extern.find(x => kern(x.name) === kern(kennung) || (kennung.length >= 3 && kern(x.muster).startsWith(kern(kennung))));
        return {
            kennung,
            name: liste ? liste.name : kennung,
            gebraucht_von: [...new Set(von)].slice(0, 5),
            grund: liste ? 'extern' : 'nicht_im_paket',
            host: liste ? liste.host : null,
        };
    }).sort((a, b) => a.name.localeCompare(b.name));

    const nichtGelesen = kandidaten.filter(k => k.nichtGelesen && !zurueckgestellt.includes(k))
        .map(k => `${k.datei}: ${k.nichtGelesen}`).concat(eingebettetUnlesbar);

    const client = eins.client.filter(c => zurueckgestellt.some(k => k.client === c)
        || !kandidaten.some(k => k.client === c));
    const auslassen = alsAuslassen(client);

    let urteil = auslassen.sha1.length || paketClient ? URTEIL.OHNE_CLIENT : URTEIL.LAEUFT;
    if (fehlt.length) urteil = nichtGelesen.length ? URTEIL.UNKLAR : URTEIL.UNVOLLSTAENDIG;

    return {
        urteil,
        auslassen,
        fehlt,
        einzelheiten: {
            ...eins.einzelheiten,
            mods_im_verzeichnis: kandidaten.filter(k => !k.eintrag).length,
            mods_beigelegt: beigelegt.size,
            paket_client: paketClient,
            ohne_beschreibung: kandidaten.filter(k => k.b?.ohneBeschreibung).length,
            nicht_gelesen: nichtGelesen.slice(0, 50),
            behalten,
            extern: extern.slice(0, 100).map(x => ({ name: x.name, host: x.host })),
            abrufe: zaehler.abrufe,
            netz_bytes: zaehler.bytes,
        },
    };
}

const alsObjekt = (wert, sonst) => {
    if (wert === null || wert === undefined || wert === '') return sonst;
    if (typeof wert !== 'string') return wert;
    try { return JSON.parse(wert); } catch { return sonst; }
};

function ausZeile(zeile) {
    return {
        quelle: zeile.quelle,
        fassungId: zeile.fassung_id,
        kennung: zeile.kennung,
        fassung: zeile.fassung,
        stufe: Number(zeile.stufe),
        regel: Number(zeile.regel),
        urteil: zeile.urteil,
        auslassen: alsObjekt(zeile.auslassen, { sha1: [], namen: [] }),
        fehlt: alsObjekt(zeile.fehlt, []),
        einzelheiten: alsObjekt(zeile.einzelheiten, {}),
        gepruefAm: zeile.geprueft_am,
        dauerMs: Number(zeile.dauer_ms) || 0,
    };
}

async function liesZeile(db, fassungId) {
    const [zeile] = await db.query(
        'SELECT * FROM modpack_befunde WHERE quelle = ? AND fassung_id = ?', [QUELLE, fassungId]);
    return zeile && Number(zeile.regel) === REGEL ? ausZeile(zeile) : null;
}

async function speichere(db, paket, b) {
    await db.query(
        `INSERT INTO modpack_befunde
            (quelle, fassung_id, kennung, fassung, stufe, regel, urteil, auslassen, fehlt, einzelheiten, geprueft_am, dauer_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)
         ON DUPLICATE KEY UPDATE
            kennung = VALUES(kennung), fassung = VALUES(fassung), stufe = VALUES(stufe), regel = VALUES(regel),
            urteil = VALUES(urteil), auslassen = VALUES(auslassen), fehlt = VALUES(fehlt),
            einzelheiten = VALUES(einzelheiten), geprueft_am = VALUES(geprueft_am), dauer_ms = VALUES(dauer_ms)`,
        [QUELLE, paket.fassungId, String(paket.kennung || '').slice(0, 190), String(paket.fassung || '').slice(0, 190),
            b.stufe, REGEL, b.urteil, JSON.stringify(b.auslassen), JSON.stringify(b.fehlt),
            JSON.stringify(b.einzelheiten), b.dauerMs]);
}

/** Was gerade gerechnet wird: Zwei, die dasselbe Paket wählen, rechnen einmal. */
const laufend = new Map();

async function rechne(paket, stufe, u, beiFortschritt) {
    const anfang = Date.now();
    const version = await u.hole(`/version/${encodeURIComponent(paket.fassungId)}`);
    const eins = await rechneEins(version, u);

    let ergebnis = {
        stufe: 1,
        urteil: eins.client.length ? URTEIL.OHNE_CLIENT : URTEIL.LAEUFT,
        auslassen: alsAuslassen(eins.client),
        fehlt: [],
        einzelheiten: eins.einzelheiten,
    };
    let stufe2Fehler = null;
    if (stufe === 2) {
        try {
            ergebnis = { stufe: 2, ...await rechneZwei(paket, version, eins, u, beiFortschritt) };
        } catch (fehler) {
            // Stufe 1 steht trotzdem. Der Aufrufer erfährt, dass die
            // gründliche Prüfung ausfiel — sie wird beim nächsten Mal versucht.
            stufe2Fehler = fehler.message;
            ServiceManager.get('Logger').warn(`[Gameserver/PackBefund] ${paket.kennung} ${paket.fassung}: `
                + `Stufe 2 nicht möglich (${fehler.message}) — es gilt Stufe 1`);
        }
    }
    ergebnis.dauerMs = Date.now() - anfang;
    await speichere(u.db, paket, ergebnis);
    return {
        quelle: QUELLE, fassungId: paket.fassungId, kennung: paket.kennung, fassung: paket.fassung,
        regel: REGEL, gepruefAm: new Date(), ...ergebnis, stufe2Fehler,
    };
}

/**
 * Der Befund zu einer Fassung — gelesen, oder gerechnet und gespeichert.
 *
 * @param {Object} paket    wie von `Modrinth.modpackFassung`: `fassungId`,
 *                          `kennung`, `fassung`, `lader`
 * @param {{stufe?: number, beiFortschritt?: Function, umgebung?: Object}} optionen
 * @returns {Promise<{urteil: string, stufe: number, auslassen: {sha1: string[], namen: string[]},
 *           fehlt: Object[], einzelheiten: Object, stufe2Fehler?: string|null}>}
 */
async function befund(paket, optionen = {}) {
    const stufe = optionen.stufe === 2 ? 2 : 1;
    const u = umgebung(optionen.umgebung);
    const id = String(paket?.fassungId || '');
    if (!id) throw new Error('Pack-Befund: Die Fassung nennt keine Kennung');

    const da = await liesZeile(u.db, id);
    if (da && da.stufe >= stufe) return da;

    const schluessel = `${id}:${stufe}`;
    if (!laufend.has(schluessel)) {
        laufend.set(schluessel, rechne(paket, stufe, u, optionen.beiFortschritt || (() => {}))
            .finally(() => laufend.delete(schluessel)));
    }
    return laufend.get(schluessel);
}

/**
 * Der Satz, warum ein unvollständiges Paket nicht eingespielt wird.
 *
 * Er nennt die fehlenden Mods und wer sie braucht — „unvollständig" allein
 * ließe den Betreiber raten, ob das Panel oder das Paket schuld ist.
 */
function satzUnvollstaendig(paket, b) {
    const GENANNT = 5;
    const namen = b.fehlt.slice(0, GENANNT)
        .map(f => `${f.name} (gebraucht von ${f.gebraucht_von.slice(0, 2).join(', ')})`);
    const mehr = b.fehlt.length > GENANNT ? ` und ${b.fehlt.length - GENANNT} weitere` : '';
    const extern = b.fehlt.some(f => f.grund === 'extern');
    return `„${paket.name || paket.kennung}" ${paket.fassung} läuft so nicht auf einem Server: `
        + `${b.fehlt.length === 1 ? 'Eine Pflicht-Mod liegt' : `${b.fehlt.length} Pflicht-Mods liegen`} dem Paket nicht bei — `
        + `${namen.join('; ')}${mehr}.`
        + (extern ? ' Das Paket lässt sie beim Spieler von außerhalb nachladen; ein Server holt nichts nach.' : '');
}

/** Wird diese Fassung gerade gerechnet? */
function laeuft(fassungId, stufe = 2) {
    return laufend.has(`${fassungId}:${stufe}`);
}

/**
 * Gespeicherte Befunde zu mehreren Fassungen — für die Suche, ohne zu rechnen.
 *
 * @returns {Promise<Map<string, Object>>} Fassungs-ID → Befund
 */
async function gespeichert(fassungIds, optionen = {}) {
    const ids = [...new Set((fassungIds || []).map(String).filter(Boolean))];
    const aus = new Map();
    if (!ids.length) return aus;
    const u = umgebung(optionen.umgebung);
    const zeilen = await u.db.query(
        `SELECT * FROM modpack_befunde WHERE quelle = ? AND regel = ? AND fassung_id IN (${ids.map(() => '?').join(',')})`,
        [QUELLE, REGEL, ...ids]);
    for (const zeile of zeilen) aus.set(zeile.fassung_id, ausZeile(zeile));
    return aus;
}

/**
 * Der Befund in der Form, die eine Seite zeigt — ohne Prüfsummen.
 *
 * @returns {{urteil: string, stufe: number, clientMods: number, clientNamen: string[],
 *           fehlt: Object[], behalten: string[], satz: string|null, hinweis: string|null}}
 */
function fuerAnzeige(paket, b) {
    return {
        urteil: b.urteil,
        stufe: b.stufe,
        clientMods: b.auslassen.namen.length,
        clientNamen: b.auslassen.namen.slice(0, 12),
        fehlt: b.fehlt.slice(0, 20).map(f => ({ name: f.name, gebraucht_von: f.gebraucht_von, grund: f.grund })),
        behalten: (b.einzelheiten.behalten || []).map(x => x.name),
        satz: b.urteil === URTEIL.UNVOLLSTAENDIG ? satzUnvollstaendig(paket, b) : null,
        // Stufe 1 statt 2: Die gründliche Prüfung fiel aus, und die Seite sagt es.
        hinweis: b.stufe2Fehler ? `Die gründliche Prüfung war nicht möglich (${b.stufe2Fehler}).` : null,
    };
}

/**
 * Eine Trefferliste der Suche mit dem, was über die Pakete schon bekannt ist.
 *
 * „Unvollständiges für alle ausblenden" (Betreiber, 2026-10-29): Ein Paket,
 * dessen Fassung als unvollständig befunden wurde, steht nicht in der Liste —
 * für niemanden, denn der Befund ist Katalogwissen. Gerechnet wird hier
 * nichts: Stufe 2 läuft beim Auswählen, die Suche liest nur.
 *
 * Wie viele ausgeblendet wurden, steht in der Antwort. Eine Liste, die
 * kürzer ist als erwartet, soll ihren Grund nennen können.
 *
 * @param {{treffer: Object[]}} ergebnis  wie von `Modrinth.sucheModpacks`
 */
async function fuerSuche(ergebnis, optionen = {}) {
    const befunde = await gespeichert((ergebnis.treffer || []).map(t => t.fassungId), optionen);
    const treffer = [];
    let ausgeblendet = 0;
    for (const t of ergebnis.treffer || []) {
        const b = befunde.get(t.fassungId);
        if (b && b.urteil === URTEIL.UNVOLLSTAENDIG) { ausgeblendet++; continue; }
        treffer.push({ ...t, befund: b ? { urteil: b.urteil, stufe: b.stufe, clientMods: b.auslassen.namen.length } : null });
    }
    return { ...ergebnis, treffer, ausgeblendet };
}

module.exports = {
    befund, laeuft, gespeichert, fuerSuche, fuerAnzeige, satzUnvollstaendig,
    URTEIL, REGEL, rechneEins, rechneZwei,
    // Auch für einzelne Mods (`ModPflichten.js`, K379): eine Liste, ein Weg.
    EINGEBAUT, nebeneinander,
};
