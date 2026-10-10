'use strict';

/**
 * Ein Paket auf den neuesten Bau seines Images umziehen — in einem Zug
 * (2026-10-10, Fortsetzung von Baustelle 177).
 *
 * ── Warum es das gibt ───────────────────────────────────────────────────────
 *
 * Ein Umzug war bis heute Handarbeit je Paket: in der Werkbank „Fertiges Paket
 * öffnen" (das installiert das Spiel ins Volume der Sitzung), darauf warten,
 * Prüfdurchlauf starten (der installiert es noch einmal, auf leerem Volume),
 * Fassung hochzählen, veröffentlichen, freigeben. Betreiber, 2026-10-10: *„es
 * ist ja nur die aktualisierung des build typs und des digest der ans paket
 * kommt, wir ändern ja an der ursprünglichen fassung nix"* — und: *„falls die
 * sitzung schon verworfen ist, muss ich eine neue anlage abwarten, bevor ich
 * überhaupt einen prüflauf starten kann."*
 *
 * ── Was hier geschieht ──────────────────────────────────────────────────────
 *
 * Dieselben Bausteine, ohne die Handgriffe dazwischen — KEIN zweiter Weg:
 *
 *   1. `paketOeffnen`     die neueste Fassung als Sitzung, OHNE ihre Schritte
 *                         im Volume der Sitzung auszuführen. Dafür ist die
 *                         Installation da, auf die bisher gewartet wurde; der
 *                         Durchlauf braucht sie nicht.
 *   2. `pruefen`          ganzes Rezept auf leerem Volume, auf dem neuesten Bau
 *   3. `veroeffentlichen` neue Fassung in `test`, mit Tag und Digest des
 *                         Durchlaufs — nur bei Grün
 *   4. `verwerfen`        die Sitzung wird nicht mehr gebraucht
 *
 * Der Prüfdurchlauf bleibt: Am Paket ändert sich nur das Image, und genau das
 * prüft er (neues fb-init, neue Bibliotheken, neues Proton). Die Freigabe nach
 * `stable` bleibt ein Klick des Betreibers (2026-10-09: „unsere Handschranke")
 * — `freigeben()` unten ist dieser Klick für alle auf einmal, kein Automat.
 *
 * ── Die Zusage „sonst ändert sich nichts" wird geprüft, nicht geglaubt ──────
 *
 * Vor dem Einliefern wird das neue Paket gegen die Fassung gelegt, aus der es
 * entstand (`unterschied`). Weicht mehr ab als Image, Fassungsnummer, Herkunft
 * und Statusvermerk, wird NICHT veröffentlicht: Die Sitzung bleibt offen, die
 * Zeile nennt die Teile. Ein Umzug, der nebenbei eine Einstellung verliert,
 * wäre der Fehler vom 2026-10-07 (Valheim 1.0.21 ohne `platform`).
 *
 * ── Wo der Stand liegt ──────────────────────────────────────────────────────
 *
 * In der Sitzung selbst (`entwurf.werkbank.umzug`), nicht im Speicher: Das
 * Urteil des Daemons kommt Minuten später und findet seinen Umzug auch nach
 * einem Neustart des Dashboards. Eine verworfene Sitzung behält ihren Vermerk —
 * daraus liest die Übersicht, was zuletzt umgezogen wurde.
 *
 * Immer nur EIN Durchlauf zugleich: Jeder installiert ein ganzes Spiel.
 */

const crypto = require('crypto');
const { ServiceManager } = require('dunebot-core');

const STAND = { wartet: 'wartet', laeuft: 'laeuft', gruen: 'gruen', rot: 'rot' };

// Auswechselbar für den Wächter (scripts/check-paket-umzug.js) — er prüft die
// Abfolge, nicht noch einmal die Bausteine.
const dienste = {
    S: () => require('./Sitzungen'),
    Paketfassung: () => require('../../../gameserver/dashboard/helpers/Paketfassung'),
    db: () => ServiceManager.get('dbService'),
    log: () => ServiceManager.get('Logger'),
};
function _setze(neu) { Object.assign(dienste, neu); }

function json(wert, ersatz) {
    if (wert && typeof wert === 'object') return wert;
    try { return JSON.parse(wert); } catch { return ersatz; }
}
const stabil = (x) => JSON.stringify(x, (k, v) => (v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map(n => [n, v[n]])) : v));

/**
 * Was sich an einem umgezogenen Paket ändern DARF: die Fassungsnummer, woher
 * es kommt, wer es einlieferte — und am Image Tag, Digest und Anheftdatum.
 * `status` ist der Vermerk der Werkbank über den Durchlauf.
 */
function kern(paket) {
    const k = JSON.parse(JSON.stringify(paket || {}));
    delete k.status;
    if (k.identity) { delete k.identity.version; delete k.identity.origin; delete k.identity.author; }
    if (k.image) { delete k.image.tag; delete k.image.digest; delete k.image.pinned_at; }
    return k;
}

/** Die Teile, in denen sich zwei Pakete über das Erlaubte hinaus unterscheiden. */
function unterschied(alt, neu) {
    const a = kern(alt), n = kern(neu);
    const aus = [];
    for (const teil of new Set([...Object.keys(a), ...Object.keys(n)])) {
        if (stabil(a[teil]) === stabil(n[teil])) continue;
        const x = a[teil], y = n[teil];
        if (x && y && typeof x === 'object' && typeof y === 'object' && !Array.isArray(x) && !Array.isArray(y)) {
            for (const f of new Set([...Object.keys(x), ...Object.keys(y)])) {
                if (stabil(x[f]) !== stabil(y[f])) aus.push(`${teil}.${f}`);
            }
        } else {
            aus.push(teil);
        }
    }
    return aus.sort();
}

// ── Sitzungen mit Umzugsvermerk ──────────────────────────────────────────────

async function umzugsSitzungen({ nurOffene = false } = {}) {
    const zeilen = await dienste.db().query(
        `SELECT id, kennung, guild_id, name, status, rootserver_id, image, entwurf, created_at, updated_at
           FROM werkbank_sitzungen
          WHERE entwurf LIKE '%"umzug"%'${nurOffene ? " AND status = 'offen'" : ''}
          ORDER BY id`);
    const aus = [];
    for (const z of zeilen) {
        const entwurf = json(z.entwurf, {}) || {};
        const u = entwurf.werkbank?.umzug;
        if (!u || !u.paket_id) continue;   // „umzug" stand nur irgendwo im Text
        aus.push({ ...z, image: json(z.image, {}), entwurf, umzug: u });
    }
    return aus;
}

async function vermerke(sitzung, aenderung) {
    const S = dienste.S();
    await S.entwurfSchreiben(sitzung, (e) => {
        e.werkbank = { ...(e.werkbank || {}) };
        e.werkbank.umzug = { ...(e.werkbank.umzug || {}), ...aenderung };
    });
    sitzung.umzug = sitzung.entwurf.werkbank.umzug;
}

/** Die Sitzung so, wie die Werkbank sie lädt (geordnet) — samt Vermerk. */
async function ladeSitzung(kennung) {
    const [z] = await dienste.db().query('SELECT guild_id FROM werkbank_sitzungen WHERE kennung = ?', [kennung]);
    if (!z) return null;
    const s = await dienste.S().laden(z.guild_id, kennung);
    if (s) s.umzug = s.entwurf?.werkbank?.umzug || null;
    return s;
}

// ── Anstoßen ─────────────────────────────────────────────────────────────────

/**
 * Pakete zum Umzug vormerken und den ersten Durchlauf starten.
 *
 * Wirft nicht für ein einzelnes Paket: Was sich nicht vormerken ließ, steht mit
 * Grund in `abgelehnt` — die übrigen ziehen trotzdem um.
 *
 * @returns {Promise<{vorgemerkt: object[], abgelehnt: object[]}>}
 */
async function anstossen({ paketIds, guildId, userId, autor, rootserverId }) {
    const S = dienste.S();
    const offene = await umzugsSitzungen({ nurOffene: true });
    const vorgemerkt = [], abgelehnt = [];

    for (const paketId of [...new Set((paketIds || []).map(Number))].filter(Number.isInteger)) {
        let slug = String(paketId);
        try {
            const zeile = await dienste.Paketfassung().ladeNeuesteFassung(dienste.db(), { paketId });
            if (!zeile) throw new Error('Dieses Paket gibt es nicht.');
            slug = zeile.slug;
            const schon = offene.filter(s => Number(s.umzug.paket_id) === paketId);
            if (schon.some(s => s.umzug.stand === STAND.wartet || s.umzug.stand === STAND.laeuft)) {
                throw new Error('Dieses Paket zieht gerade um.');
            }
            // Ein roter Versuch von vorhin: Er wird abgelöst. Liegen bleibt er
            // nur, wenn sich sein Volume gerade nicht löschen lässt.
            for (const alt of schon) {
                try {
                    await S.verwerfen(alt);
                } catch (fehler) {
                    dienste.log().warn(`[Umzug] Alter Versuch ${alt.kennung} blieb liegen: ${fehler.message}`);
                }
            }
            const offen = await S.paketOeffnen({ guildId, userId, paketId, rootserverId });
            const sitzung = await S.laden(guildId, offen.kennung);
            const nach = S.naechsteFassung(zeile.version);
            await S.entwurfSchreiben(sitzung, (e) => {
                e.identity = { ...(e.identity || {}), version: nach };
                e.werkbank = { ...(e.werkbank || {}), umzug: {
                    paket_id: paketId, slug: zeile.slug, von: zeile.version, von_kanal: zeile.channel, nach,
                    stand: STAND.wartet, am: new Date().toISOString(), autor: autor || null,
                } };
            });
            await dienste.db().query('UPDATE werkbank_sitzungen SET name = ? WHERE id = ?',
                [`Umzug · ${sitzung.name}`.slice(0, 100), sitzung.id]);
            await kennwortDerFernsteuerung(sitzung);
            vorgemerkt.push({ paket_id: paketId, slug: zeile.slug, von: zeile.version, nach, kennung: offen.kennung });
        } catch (fehler) {
            abgelehnt.push({ paket_id: paketId, slug, grund: fehler.message });
        }
    }
    if (vorgemerkt.length) await weiter();
    return { vorgemerkt, abgelehnt };
}

/**
 * Das Kennwort der Fernsteuerung für den Durchlauf erzeugen.
 *
 * Erster echter Lauf, 2026-10-10: Factorio wurde nach 1,1 Minuten rot —
 * „RCON_PASSWORD ist leer oder fehlt". Die Einstellung dahinter hat keine
 * Vorgabe (ein Kennwort gehört in kein Paket), und die frisch geöffnete
 * Sitzung hat keinen Probewert. Von Hand trägt man in der Werkbank einen ein;
 * ein echter Server bekommt ein erzeugtes (StartPayload.paketWerteAnlegen).
 * Der Umzug tut dasselbe: ein Wegwerf-Kennwort als PROBEWERT. Probewerte
 * gehören der Sitzung — sie stehen nicht im Paket und nicht im Fingerabdruck.
 *
 * Welche Einstellung es ist, sagt die Werkbank (`rconStand`), nicht ein
 * Feldname. Hat sie schon einen Wert, bleibt er stehen.
 */
async function kennwortDerFernsteuerung(sitzung) {
    const S = dienste.S();
    if (!sitzung.entwurf?.management?.rcon?.password_variable) return;
    const key = S.rconStand(sitzung).quelle;
    if (!key || S.probewerte(sitzung)[key] !== '') return;
    await S.probewerteSetzen(sitzung, { [key]: crypto.randomBytes(18).toString('base64url') });
}

// ── Die Kette ────────────────────────────────────────────────────────────────

// Ein Tor: `weiter` wird vom Anstoßen UND von jedem Urteil gerufen. Ohne es
// starteten zwei Aufrufe im selben Augenblick zwei Durchläufe.
let tor = Promise.resolve();
function weiter() {
    tor = tor.then(naechster, naechster);
    return tor;
}

async function naechster() {
    const S = dienste.S();
    for (;;) {
        const offene = await umzugsSitzungen({ nurOffene: true });
        for (const s of offene.filter(x => x.umzug.stand === STAND.laeuft)) {
            if (await S.laufendePruefung(s.kennung)) return;   // einer läuft — warten
            // Der Vermerk sagt „läuft", der Durchlauf ist aber schon beurteilt:
            // Das Urteil kam, während niemand zuhörte. Jetzt nachholen.
            await abschliessen(s.kennung);
        }
        const wartend = (await umzugsSitzungen({ nurOffene: true })).find(x => x.umzug.stand === STAND.wartet);
        if (!wartend) return;
        const sitzung = await ladeSitzung(wartend.kennung);
        try {
            const liste = await S.schritte(sitzung.id);
            const { pruefId } = await S.pruefen(sitzung, liste);
            await vermerke(sitzung, { stand: STAND.laeuft, pruef_id: pruefId, begonnen: new Date().toISOString() });
            dienste.log().info(`[Umzug] ${sitzung.umzug.slug} ${sitzung.umzug.von} → ${sitzung.umzug.nach}: Prüfdurchlauf ${pruefId} läuft`);
            return;
        } catch (fehler) {
            // Nicht startbar (Daemon weg, Mangel im Paket): rot mit Grund, und
            // der nächste kommt dran — einer soll nicht alle aufhalten.
            await vermerke(sitzung, { stand: STAND.rot, grund: `Der Prüfdurchlauf ließ sich nicht starten: ${fehler.message}`,
                beendet: new Date().toISOString() });
        }
    }
}

/**
 * Das Urteil eines Durchlaufs ist da (aufgerufen aus Ereignisse.beiPruefung).
 * Für jede Sitzung ohne Umzugsvermerk geschieht nichts.
 */
async function beiUrteil(kennung) {
    const s = await ladeSitzung(kennung);
    if (!s?.umzug || s.umzug.stand !== STAND.laeuft) return false;
    await abschliessen(kennung);
    await weiter();
    return true;
}

async function abschliessen(kennung) {
    const S = dienste.S();
    const sitzung = await ladeSitzung(kennung);
    if (!sitzung?.umzug || sitzung.umzug.stand !== STAND.laeuft) return;
    const u = sitzung.umzug;
    const jetzt = () => new Date().toISOString();
    const [liste, pruefListe] = await Promise.all([S.schritte(sitzung.id), S.pruefungen(sitzung.id)]);
    const letzte = pruefListe[0];

    if (!letzte || letzte.status !== 'gruen') {
        const gruende = letzte?.ergebnis?.gruende || [];
        await vermerke(sitzung, { stand: STAND.rot, beendet: jetzt(),
            grund: gruende.length ? gruende.join(' · ') : 'Der Prüfdurchlauf war rot.' });
        dienste.log().info(`[Umzug] ${u.slug} ${u.von} → ${u.nach}: rot`);
        return;
    }
    try {
        // Seit dem Vormerken kann jemand veröffentlicht haben. Dann stimmt
        // weder die Fassungsnummer noch der Vergleich darunter.
        const zeile = await dienste.Paketfassung().ladeNeuesteFassung(dienste.db(), { paketId: u.paket_id });
        if (!zeile || zeile.version !== u.von) {
            throw new Error(`Inzwischen ist ${zeile ? zeile.version : 'keine Fassung'} die neueste — umgezogen werden sollte ${u.von}. Neu anstoßen.`);
        }
        const alt = json(zeile.fbpkg, null);
        const neu = S.veroeffentlichungsPaket(sitzung, liste, letzte, u.autor, alt?.image || null);
        const anders = unterschied(alt, neu);
        if (anders.length) {
            throw new Error(`Der Umzug würde mehr ändern als das Image: ${anders.join(', ')}. `
                + 'Die Sitzung bleibt offen — dort lässt sich nachsehen und von Hand veröffentlichen.');
        }
        const r = await S.veroeffentlichen(sitzung, liste, pruefListe, { autor: u.autor });
        await vermerke(sitzung, { stand: STAND.gruen, beendet: jetzt(), nach: r.version,
            image_tag: letzte.ergebnis?.image_tag || null, image_digest: letzte.ergebnis?.image_digest || null });
        dienste.log().info(`[Umzug] ${u.slug} ${u.von} → ${r.version}: grün, in test eingeliefert`);
    } catch (fehler) {
        await vermerke(sitzung, { stand: STAND.rot, beendet: jetzt(),
            grund: `Prüfdurchlauf grün, aber nicht veröffentlicht: ${fehler.message}` });
        dienste.log().warn(`[Umzug] ${u.slug}: grün, aber nicht veröffentlicht — ${fehler.message}`);
        return;
    }
    // Die Sitzung hat ihren Zweck erfüllt. Bleibt sie liegen, schadet es nicht
    // — sie hat kein Volume, und der Vermerk steht schon auf grün.
    try {
        await S.verwerfen(sitzung);
    } catch (fehler) {
        dienste.log().warn(`[Umzug] Sitzung ${kennung} blieb nach dem Umzug offen: ${fehler.message}`);
    }
}

/** Einen Umzug von Hand beenden: wartend → rot, laufend → Durchlauf abbrechen. */
async function abbrechen(kennung) {
    const S = dienste.S();
    const sitzung = await ladeSitzung(kennung);
    if (!sitzung?.umzug) throw new Error('Zu dieser Kennung gibt es keinen Umzug.');
    if (sitzung.umzug.stand === STAND.wartet) {
        await vermerke(sitzung, { stand: STAND.rot, grund: 'Von Hand abgebrochen, bevor der Prüfdurchlauf begann.', beendet: new Date().toISOString() });
    } else if (sitzung.umzug.stand === STAND.laeuft) {
        // Rot setzen, auch wenn das Urteil des Daemons nie kommt (Daemon neu
        // gestartet). Kommt es doch noch, findet es keinen laufenden Durchlauf.
        if (await S.laufendePruefung(kennung)) await S.pruefungAbbrechen(sitzung);
        await abschliessen(kennung);
    } else {
        throw new Error('Dieser Umzug ist schon beendet.');
    }
    await weiter();
}

// ── Übersicht und Freigabe ───────────────────────────────────────────────────

/**
 * Je Paket der jüngste Umzug — wartend, laufend, grün oder rot.
 *
 * `freigebbar`: Die umgezogene Fassung liegt noch in `test`, ist die neueste,
 * und die Fassung, AUS der sie entstand, war freigegeben. Ein Umzug einer
 * Fassung, die selbst noch Entwurf war, wird hier nicht zur Freigabe angeboten
 * — dann gäbe der Sammelknopf etwas frei, das nie jemand freigeben wollte.
 */
async function stand() {
    const alle = await umzugsSitzungen();
    const jePaket = new Map();
    for (const s of alle) jePaket.set(Number(s.umzug.paket_id), s);   // nach id sortiert: der letzte gewinnt
    const aus = [];
    for (const [paketId, s] of jePaket) {
        const u = s.umzug;
        const zeile = { paket_id: paketId, slug: u.slug, von: u.von, nach: u.nach, stand: u.stand, grund: u.grund || null,
            kennung: s.kennung, sitzung_offen: s.status === 'offen', guild_id: s.guild_id,
            am: u.am || null, begonnen: u.begonnen || null, beendet: u.beendet || null,
            image_tag: u.image_tag || null, image_digest: u.image_digest || null,
            freigebbar: false, fassung_id: null, kanal: null };
        if (u.stand === STAND.gruen) {
            const fassungen = await dienste.Paketfassung().fassungenZuPaket(dienste.db(), paketId);
            const f = fassungen.find(x => x.version === u.nach);
            zeile.fassung_id = f ? f.id : null;
            zeile.kanal = f ? f.channel : null;
            zeile.freigebbar = Boolean(f && f.channel === 'test' && f.test_passed_at
                && fassungen[0] && fassungen[0].id === f.id && u.von_kanal === 'stable');
        }
        aus.push(zeile);
    }
    const zaehlung = { wartet: 0, laeuft: 0, gruen: 0, rot: 0, freigebbar: 0 };
    for (const z of aus) { zaehlung[z.stand]++; if (z.freigebbar) zaehlung.freigebbar++; }
    return { umzuege: aus.sort((a, b) => a.slug.localeCompare(b.slug)), zaehlung };
}

/** Alle umgezogenen, noch nicht freigegebenen Fassungen freigeben — der eine Klick. */
async function freigeben({ userId }) {
    const { umzuege } = await stand();
    const freigegeben = [], nicht = [];
    for (const z of umzuege.filter(x => x.freigebbar)) {
        try {
            await dienste.Paketfassung().freigeben(dienste.db(), { paketId: z.paket_id, fassungId: z.fassung_id, userId });
            freigegeben.push({ slug: z.slug, version: z.nach });
        } catch (fehler) {
            nicht.push({ slug: z.slug, version: z.nach, grund: fehler.message });
        }
    }
    return { freigegeben, nicht };
}

module.exports = { STAND, kern, unterschied, anstossen, weiter, beiUrteil, abbrechen, stand, freigeben, _setze };
