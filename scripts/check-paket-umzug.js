#!/usr/bin/env node
/**
 * Umzug eines Pakets auf den neuesten Bau — in einem Zug (2026-10-10).
 *
 * ── Was hier geprüft wird ───────────────────────────────────────────────────
 *
 * Betreiber, 2026-10-10: *„es ist ja nur die aktualisierung des build typs und
 * des digest der ans paket kommt, wir ändern ja an der ursprünglichen fassung
 * nix"* — und: *„falls die sitzung schon verworfen ist, muss ich eine neue
 * anlage abwarten, bevor ich überhaupt einen prüflauf starten kann."*
 *
 * Der Umzug (plugins/werkbank/dashboard/helpers/Umzug.js) ist eine Kette aus
 * vorhandenen Bausteinen: Paket öffnen (ohne Installation in die Sitzung),
 * Prüfdurchlauf, veröffentlichen, Sitzung verwerfen. Geprüft wird:
 *
 *   1. Die Zusage „sonst ändert sich nichts" an JEDEM eingelieferten Paket
 *      (neueste Fassung, nur lesend) — mit den echten Funktionen der Werkbank.
 *      Und umgekehrt: Was sich doch ändert, wird beim Namen genannt.
 *   2. Die Kette: einer nach dem anderen; Grün liefert ein und räumt auf, Rot
 *      lässt die Sitzung stehen; ein Paket, das nicht starten kann, hält die
 *      anderen nicht auf; ein Urteil, das niemand hörte, wird nachgeholt.
 *   3. Die Sperre: Würde mehr als das Image anders, wird NICHT veröffentlicht.
 *   4. Die Freigabe bleibt ein Klick — und der Sammelknopf gibt nur frei, was
 *      aus einer freigegebenen Fassung umgezogen ist.
 *   5. Die Knöpfe: Die Routen stehen vor `/:id`; was umzieht, entscheidet der
 *      Image-Stand auf dem Server, nicht die Liste aus dem Browser.
 *
 * In der Kette sind die Bausteine mit Ein- und Ausgabe Attrappen (Daemon,
 * Datenbank); alles Rechnende ist die echte Werkbank. Die Bausteine selbst
 * prüfen check-werkbank.js und check-werkbank-oeffnen.js.
 *
 *   node scripts/check-paket-umzug.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const WURZEL = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(WURZEL, 'apps/dashboard/.env'), quiet: true });
const mysql = require('mysql2/promise');
const { ServiceManager } = require('dunebot-core');
const { ohneKommentare, ohneKommentareEjs } = require('./lib/quelltext');

// Kein Baustein hier darf an die echte Datenbank: Jede Abfrage, die die
// Attrappe nicht kennt, ist ein Befund.
let dbAbfrage = (sql) => { throw new Error(`Attrappe kennt die Abfrage nicht: ${sql.trim().slice(0, 90)}`); };
const protokoll = [];
ServiceManager.register('dbService', { query: (sql, p) => dbAbfrage(sql, p) });
ServiceManager.register('Logger', {
    info: (t) => protokoll.push(['info', t]), warn: (t) => protokoll.push(['warn', t]),
    error: (t, e) => protokoll.push(['error', t + ' ' + (e && e.message)]), debug: () => {},
});

const S = require('../plugins/werkbank/dashboard/helpers/Sitzungen');
const Umzug = require('../plugins/werkbank/dashboard/helpers/Umzug');
const Imagestand = require('../plugins/gameserver/dashboard/helpers/Imagestand');

let fehler = 0;
async function pruefe(was, tun) {
    try { await tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.stack || e.message).split('\n').slice(0, 4).join('\n      ')}`); }
}
const j = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
const kopie = (v) => JSON.parse(JSON.stringify(v));
const DIGEST = 'sha256:' + 'b'.repeat(64);

// ── Die Welt der Attrappe ────────────────────────────────────────────────────
//
// Pakete mit Fassungen, Sitzungen, Schritte, Prüfdurchläufe — im Speicher.
let welt;
function neueWelt(pakete) {
    welt = { pakete: new Map(), sitzungen: [], pruefungen: [], aufrufe: [], naechsteId: 1, stoerung: {} };
    for (const [id, p, kanal] of pakete) {
        welt.pakete.set(id, { slug: p.identity.slug, fassungen: [{ id: id * 100, version: p.identity.version, channel: kanal || 'stable',
            test_passed_at: '2026-10-01 10:00:00', fbpkg: kopie(p) }] });
    }
}
const neuesteVon = (id) => { const p = welt.pakete.get(Number(id)); return p ? p.fassungen[p.fassungen.length - 1] : null; };
const sitzungNach = (kennung) => welt.sitzungen.find(s => s.kennung === kennung);

const attrappeS = {
    // Alles Rechnende ist echt.
    naechsteFassung: S.naechsteFassung, veroeffentlichungsPaket: S.veroeffentlichungsPaket, RE_KENNUNG: S.RE_KENNUNG,

    async paketOeffnen({ guildId, userId, paketId, rootserverId }) {
        welt.aufrufe.push(['oeffnen', Number(paketId)]);
        const f = neuesteVon(paketId);
        const { entwurf, schritte, rest } = S.entwurfAusPaket(kopie(f.fbpkg));
        assert.deepStrictEqual(rest, [], 'das Paket lässt sich nicht verlustfrei öffnen');
        entwurf.werkbank = { portnummern: S.vorlaeufigePortnummern(entwurf.ports),
            geoeffnet: { slug: f.fbpkg.identity.slug, version: f.version, paket_id: Number(paketId), ziele: S.zieleAusPaket(f.fbpkg) } };
        const id = welt.naechsteId++;
        const kennung = 'wbumzug' + String(id).padStart(5, '0');
        welt.sitzungen.push({ id, kennung, guild_id: guildId, angelegt_von: userId, name: f.fbpkg.identity.name || f.fbpkg.identity.slug,
            status: 'offen', rootserver_id: rootserverId, image: { ref: f.fbpkg.image.ref, tag: 'latest' }, entwurf,
            schritte: schritte.map((s, i) => ({ id: id * 100 + i, nr: i + 1, schritt: s, status: 'uebernommen', uebernommen_aus: `${f.fbpkg.identity.slug} ${f.version}` })) });
        return { kennung, slug: f.fbpkg.identity.slug, version: f.version, schritte: schritte.length };
    },
    async laden(guildId, kennung) {
        const s = sitzungNach(kennung);
        return s && String(s.guild_id) === String(guildId) ? { ...kopie(s), entwurf: S.ordne(kopie(s.entwurf)) } : null;
    },
    async entwurfSchreiben(sitzung, aendern) {
        const e = kopie(sitzung.entwurf || {});
        aendern(e);
        sitzungNach(sitzung.kennung).entwurf = kopie(e);
        sitzung.entwurf = e;
        return e;
    },
    async schritte(id) { return kopie(welt.sitzungen.find(s => s.id === id).schritte); },
    async pruefen(sitzung, liste) {
        welt.aufrufe.push(['pruefen', sitzung.kennung]);
        if (welt.stoerung.pruefen === sitzung.entwurf.identity.slug) throw new Error('Der Daemon der Maschine ist nicht erreichbar.');
        // Wie die echte Werkbank: geprüft wird der Entwurf, wie er JETZT ist.
        const pruefId = welt.naechsteId++;
        welt.pruefungen.push({ id: pruefId, sitzung_id: sitzung.id, kennung: sitzung.kennung, status: 'laeuft',
            entwurf: S.entwurfAlsPaket(sitzung, liste), ergebnis: null, beendet_am: null });
        return { pruefId };
    },
    async laufendePruefung(kennung) {
        const p = welt.pruefungen.find(x => x.kennung === kennung && x.status === 'laeuft');
        return p ? { pruefId: p.id, guildId: sitzungNach(kennung).guild_id } : null;
    },
    async pruefungen(sitzungId) {
        return kopie(welt.pruefungen.filter(p => p.sitzung_id === sitzungId).sort((a, b) => b.id - a.id));
    },
    async pruefungAbbrechen(sitzung) {
        welt.aufrufe.push(['pruefungAbbrechen', sitzung.kennung]);
        const p = welt.pruefungen.find(x => x.kennung === sitzung.kennung && x.status === 'laeuft');
        Object.assign(p, { status: 'rot', ergebnis: { gruen: false, gruende: ['von Hand abgebrochen — das Urteil des Daemons kam nicht'] }, beendet_am: new Date().toISOString() });
    },
    async veroeffentlichen(sitzung, liste, pruefListe, { autor } = {}) {
        welt.aufrufe.push(['veroeffentlichen', sitzung.kennung]);
        const f = neuesteVon(sitzung.entwurf.werkbank.geoeffnet.paket_id);
        const paket = S.veroeffentlichungsPaket(sitzung, liste, pruefListe[0], autor, f.fbpkg.image);
        const p = welt.pakete.get(Number(sitzung.entwurf.werkbank.geoeffnet.paket_id));
        p.fassungen.push({ id: welt.naechsteId++, version: paket.identity.version, channel: 'test', test_passed_at: '2026-10-10 11:00:00', fbpkg: paket });
        return { slug: paket.identity.slug, version: paket.identity.version, paketId: Number(sitzung.entwurf.werkbank.geoeffnet.paket_id) };
    },
    async verwerfen(sitzung) {
        welt.aufrufe.push(['verwerfen', sitzung.kennung]);
        if (welt.stoerung.verwerfen) throw new Error('Der Daemon der Maschine ist nicht erreichbar — das Volume bliebe liegen.');
        sitzungNach(sitzung.kennung).status = 'verworfen';
    },
};
const attrappePaketfassung = {
    async ladeNeuesteFassung(db, { paketId }) {
        const p = welt.pakete.get(Number(paketId)); const f = neuesteVon(paketId);
        return f ? { paket_id: Number(paketId), slug: p.slug, version: f.version, channel: f.channel, fbpkg: JSON.stringify(f.fbpkg) } : null;
    },
    async fassungenZuPaket(db, paketId) {
        return [...welt.pakete.get(Number(paketId)).fassungen].reverse().map(f => ({ id: f.id, version: f.version, channel: f.channel, test_passed_at: f.test_passed_at }));
    },
    async freigeben(db, { paketId, fassungId, userId }) {
        welt.aufrufe.push(['freigeben', Number(paketId), fassungId, userId]);
        const f = welt.pakete.get(Number(paketId)).fassungen.find(x => x.id === fassungId);
        if (!f.test_passed_at) throw new Error('kein grüner Prüfdurchlauf');
        f.channel = 'stable';
        return f;
    },
};
const attrappeDb = {
    async query(sql, p) {
        const q = sql.replace(/\s+/g, ' ').trim();
        if (q.startsWith('SELECT id, kennung, guild_id, name, status, rootserver_id, image, entwurf, created_at, updated_at FROM werkbank_sitzungen WHERE entwurf LIKE')) {
            const nurOffene = q.includes("status = 'offen'");
            return welt.sitzungen.filter(s => JSON.stringify(s.entwurf).includes('"umzug"') && (!nurOffene || s.status === 'offen'))
                .map(s => ({ ...s, schritte: undefined, image: JSON.stringify(s.image), entwurf: JSON.stringify(s.entwurf) }));
        }
        if (q === 'SELECT guild_id FROM werkbank_sitzungen WHERE kennung = ?') {
            const s = sitzungNach(p[0]); return s ? [{ guild_id: s.guild_id }] : [];
        }
        if (q === 'UPDATE werkbank_sitzungen SET name = ? WHERE id = ?') {
            welt.sitzungen.find(s => s.id === p[1]).name = p[0]; return {};
        }
        throw new Error(`Attrappe kennt die Abfrage nicht: ${q.slice(0, 90)}`);
    },
};
Umzug._setze({ S: () => attrappeS, Paketfassung: () => attrappePaketfassung, db: () => attrappeDb });

/** Das Urteil des Daemons kommt an — wie Ereignisse.beiPruefung es weiterreicht. */
async function urteil(kennung, gruen, gruende = []) {
    const p = welt.pruefungen.find(x => x.kennung === kennung && x.status === 'laeuft');
    assert.ok(p, `für ${kennung} läuft kein Durchlauf`);
    Object.assign(p, { status: gruen ? 'gruen' : 'rot', beendet_am: new Date().toISOString(),
        ergebnis: { gruen, gruende, image_digest: DIGEST, image_tag: '2026.10', bereitschaft: 'port' } });
    return Umzug.beiUrteil(kennung);
}
const vermerk = (kennung) => sitzungNach(kennung).entwurf.werkbank.umzug;
const zaehle = (was) => welt.aufrufe.filter(a => a[0] === was).length;
const AUFTRAG = { guildId: '1', userId: '42', autor: 'Betreiber', rootserverId: 54 };

(async () => {
    const c = await mysql.createConnection({
        host: process.env.MYSQL_HOST, port: process.env.MYSQL_PORT, user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE, dateStrings: true,
    });
    const [zeilen] = await c.query('SELECT v.fbpkg FROM package_versions v ORDER BY v.published_at, v.id');
    await c.end();
    const neueste = new Map();
    for (const z of zeilen) { const p = j(z.fbpkg); neueste.set(p.identity.slug, p); }
    assert.ok(neueste.size >= 3, 'weniger als drei Pakete in der Datenbank — der Wächter mässe nichts');
    const echte = [...neueste.values()];
    const [A, B, C] = echte;

    console.log(`\nDie Zusage: außer dem Image ändert sich nichts — an ${echte.length} echten Paketen`);

    /** Ein Paket durch die Kette schicken, wie der Umzug es tut — ohne Daemon. */
    async function durchDieKette(paket) {
        neueWelt([[1, paket]]);
        const r = await Umzug.anstossen({ ...AUFTRAG, paketIds: [1] });
        assert.deepStrictEqual(r.abgelehnt, []);
        await urteil(r.vorgemerkt[0].kennung, true);
        return { kennung: r.vorgemerkt[0].kennung, neu: neuesteVon(1).fbpkg };
    }

    for (const paket of echte) {
        await pruefe(`${paket.identity.slug} ${paket.identity.version}: umgezogen unterscheidet es sich nur in Image, Fassung, Herkunft und Vermerk`, async () => {
            const { kennung, neu } = await durchDieKette(paket);
            assert.strictEqual(vermerk(kennung).stand, 'gruen', vermerk(kennung).grund);
            assert.deepStrictEqual(Umzug.unterschied(paket, neu), []);
            assert.strictEqual(neu.identity.version, S.naechsteFassung(paket.identity.version));
            assert.strictEqual(neu.image.digest, DIGEST, 'angeheftet wird der Digest des Durchlaufs');
            assert.strictEqual(neu.image.tag.split('-')[0], '2026.10', 'ins Paket gehört der Name des geprüften Standes, nie „latest": ' + neu.image.tag);
            assert.strictEqual(neu.image.ref, paket.image.ref);
        });
    }

    await pruefe('Gegenprobe: was sich über das Erlaubte hinaus ändert, wird beim Namen genannt', async () => {
        const mitPlattform = { ...kopie(A), image: { ...A.image, platform: 'linux/amd64' } };
        const ohne = kopie(mitPlattform); delete ohne.image.platform;
        assert.deepStrictEqual(Umzug.unterschied(mitPlattform, ohne), ['image.platform'], 'der Verlust vom 2026-10-07 (Valheim 1.0.21) fiele nicht auf');
        const p = kopie(A); p.ports = [...(p.ports || []), { purpose: 'extra', protocol: 'udp' }];
        assert.deepStrictEqual(Umzug.unterschied(A, p), ['ports']);
        const n = kopie(A); n.identity.name = 'Anders';
        assert.deepStrictEqual(Umzug.unterschied(A, n), ['identity.name']);
        const s = kopie(A); s.start = { ...s.start, program: './anderes' };
        assert.deepStrictEqual(Umzug.unterschied(A, s), ['start.program']);
        // Erlaubt — und NUR das:
        const e = kopie(A);
        Object.assign(e.identity, { version: '9.9.9', origin: { type: 'installer' }, author: 'x' });
        Object.assign(e.image, { tag: '2099.01', digest: DIGEST, pinned_at: '2099-01-01' });
        e.status = { complete: false, open: ['anders'] };
        assert.deepStrictEqual(Umzug.unterschied(A, e), []);
        e.image.ref = 'anderes/image';
        assert.deepStrictEqual(Umzug.unterschied(A, e), ['image.ref'], 'ein anderes Image ist kein Umzug');
    });

    console.log('\nDie Kette');

    await pruefe('Anstoßen: je Paket eine Sitzung, Fassung hochgezählt — und es läuft genau EIN Durchlauf', async () => {
        neueWelt([[1, A], [2, B], [3, C]]);
        const r = await Umzug.anstossen({ ...AUFTRAG, paketIds: [1, 2, 3, 2] });
        assert.strictEqual(r.vorgemerkt.length, 3, 'ein doppelt genanntes Paket zog zweimal um');
        assert.strictEqual(zaehle('oeffnen'), 3);
        assert.strictEqual(zaehle('pruefen'), 1, 'jeder Durchlauf installiert ein ganzes Spiel — nie zwei zugleich');
        const [erste, zweite] = r.vorgemerkt.map(v => v.kennung);
        assert.strictEqual(vermerk(erste).stand, 'laeuft');
        assert.strictEqual(vermerk(zweite).stand, 'wartet');
        assert.strictEqual(vermerk(erste).von, A.identity.version);
        assert.strictEqual(sitzungNach(erste).entwurf.identity.version, S.naechsteFassung(A.identity.version));
        assert.match(sitzungNach(erste).name, /^Umzug · /, 'in der Werkbank muss erkennbar sein, was das für eine Sitzung ist');
        assert.strictEqual(sitzungNach(erste).rootserver_id, 54);
        // Der Kern des Wunsches: In der Sitzung wird NICHTS installiert.
        assert.ok(sitzungNach(erste).schritte.every(s => s.status === 'uebernommen'), 'ein Schritt lief im Volume der Sitzung');
        assert.strictEqual(typeof attrappeS.uebernommeneAusfuehren, 'undefined', 'die Attrappe böte die Installation an — die Probe mässe nichts');
    });

    await pruefe('Grün: eingeliefert in test, Sitzung verworfen, das nächste Paket beginnt', async () => {
        neueWelt([[1, A], [2, B]]);
        const r = await Umzug.anstossen({ ...AUFTRAG, paketIds: [1, 2] });
        const [erste, zweite] = r.vorgemerkt.map(v => v.kennung);
        assert.strictEqual(await urteil(erste, true), true);
        const f = neuesteVon(1);
        assert.strictEqual(f.version, S.naechsteFassung(A.identity.version));
        assert.strictEqual(f.channel, 'test', 'stable bekommt nichts von selbst');
        assert.strictEqual(f.fbpkg.identity.author, 'Betreiber');
        assert.strictEqual(sitzungNach(erste).status, 'verworfen');
        assert.deepStrictEqual([vermerk(erste).stand, vermerk(erste).nach, vermerk(erste).image_tag], ['gruen', f.version, '2026.10']);
        assert.strictEqual(vermerk(zweite).stand, 'laeuft');
        assert.strictEqual(zaehle('pruefen'), 2);
        assert.strictEqual(zaehle('freigeben'), 0, 'der Umzug hat freigegeben — das ist der Klick des Betreibers');
    });

    await pruefe('Rot: nichts eingeliefert, die Sitzung bleibt mit Grund stehen, das nächste Paket beginnt', async () => {
        neueWelt([[1, A], [2, B]]);
        const r = await Umzug.anstossen({ ...AUFTRAG, paketIds: [1, 2] });
        const [erste, zweite] = r.vorgemerkt.map(v => v.kennung);
        await urteil(erste, false, ['Bereitschaft: der Port antwortete nicht', 'Stoppfolge endete mit sigkill']);
        assert.strictEqual(welt.pakete.get(1).fassungen.length, 1);
        assert.strictEqual(sitzungNach(erste).status, 'offen', 'eine rote Sitzung wird gebraucht — zum Nachsehen');
        assert.strictEqual(vermerk(erste).stand, 'rot');
        assert.match(vermerk(erste).grund, /Port antwortete nicht · Stoppfolge/);
        assert.strictEqual(zaehle('veroeffentlichen'), 0);
        assert.strictEqual(vermerk(zweite).stand, 'laeuft');
    });

    await pruefe('Sperre: würde mehr als das Image anders, wird nicht veröffentlicht', async () => {
        neueWelt([[1, A]]);
        const r = await Umzug.anstossen({ ...AUFTRAG, paketIds: [1] });
        const k = r.vorgemerkt[0].kennung;
        // Der geprüfte Entwurf weicht ab — als hätte das Öffnen etwas verloren.
        const p = welt.pruefungen.find(x => x.kennung === k);
        p.entwurf.ports = [...(p.entwurf.ports || []), { purpose: 'fremd', protocol: 'udp' }];
        await urteil(k, true);
        assert.strictEqual(vermerk(k).stand, 'rot');
        assert.match(vermerk(k).grund, /mehr ändern als das Image: ports/);
        assert.strictEqual(zaehle('veroeffentlichen'), 0, 'trotz Abweichung eingeliefert');
        assert.strictEqual(sitzungNach(k).status, 'offen');
    });

    await pruefe('Sperre: inzwischen gibt es eine neuere Fassung — dann nicht', async () => {
        neueWelt([[1, A]]);
        const r = await Umzug.anstossen({ ...AUFTRAG, paketIds: [1] });
        const k = r.vorgemerkt[0].kennung;
        welt.pakete.get(1).fassungen.push({ id: 999, version: '99.0.0', channel: 'test', test_passed_at: null, fbpkg: kopie(A) });
        await urteil(k, true);
        assert.strictEqual(vermerk(k).stand, 'rot');
        assert.match(vermerk(k).grund, /Inzwischen ist 99\.0\.0 die neueste/);
        assert.strictEqual(zaehle('veroeffentlichen'), 0);
    });

    await pruefe('Ein Paket, dessen Durchlauf nicht startet, hält die anderen nicht auf', async () => {
        neueWelt([[1, A], [2, B]]);
        welt.stoerung.pruefen = A.identity.slug;
        const r = await Umzug.anstossen({ ...AUFTRAG, paketIds: [1, 2] });
        const [erste, zweite] = r.vorgemerkt.map(v => v.kennung);
        assert.strictEqual(vermerk(erste).stand, 'rot');
        assert.match(vermerk(erste).grund, /ließ sich nicht starten: Der Daemon/);
        assert.strictEqual(vermerk(zweite).stand, 'laeuft');
    });

    await pruefe('Ein Urteil, das niemand hörte (Neustart), wird beim nächsten Anlass nachgeholt', async () => {
        neueWelt([[1, A], [2, B]]);
        const r = await Umzug.anstossen({ ...AUFTRAG, paketIds: [1, 2] });
        const [erste, zweite] = r.vorgemerkt.map(v => v.kennung);
        // Das Urteil steht in der Datenbank, beiUrteil lief aber nie.
        Object.assign(welt.pruefungen.find(x => x.kennung === erste), { status: 'gruen', beendet_am: new Date().toISOString(),
            ergebnis: { gruen: true, gruende: [], image_digest: DIGEST, image_tag: '2026.10', bereitschaft: 'port' } });
        assert.strictEqual(vermerk(erste).stand, 'laeuft');
        await Umzug.weiter();
        assert.strictEqual(vermerk(erste).stand, 'gruen');
        assert.strictEqual(neuesteVon(1).channel, 'test');
        assert.strictEqual(vermerk(zweite).stand, 'laeuft');
    });

    await pruefe('Zweimal zugleich gerufen startet trotzdem nur einen Durchlauf', async () => {
        neueWelt([[1, A], [2, B], [3, C]]);
        const r = await Umzug.anstossen({ ...AUFTRAG, paketIds: [1, 2, 3] });
        Object.assign(welt.pruefungen[0], { status: 'rot', ergebnis: { gruen: false, gruende: ['x'] } });
        await Promise.all([Umzug.weiter(), Umzug.weiter(), Umzug.beiUrteil(r.vorgemerkt[0].kennung)]);
        assert.strictEqual(welt.pruefungen.filter(p => p.status === 'laeuft').length, 1);
        assert.strictEqual(zaehle('pruefen'), 2);
    });

    await pruefe('Noch einmal anstoßen: was gerade umzieht, wird abgelehnt; ein roter Versuch wird abgelöst', async () => {
        neueWelt([[1, A], [2, B]]);
        const r = await Umzug.anstossen({ ...AUFTRAG, paketIds: [1, 2] });
        const [erste, zweite] = r.vorgemerkt.map(v => v.kennung);
        const nochmal = await Umzug.anstossen({ ...AUFTRAG, paketIds: [1, 2, 77] });
        assert.deepStrictEqual(nochmal.vorgemerkt, []);
        assert.deepStrictEqual(nochmal.abgelehnt.map(a => a.grund), ['Dieses Paket zieht gerade um.', 'Dieses Paket zieht gerade um.', 'Dieses Paket gibt es nicht.']);
        await urteil(erste, false, ['rot']);
        await urteil(zweite, false, ['rot']);
        const dritte = await Umzug.anstossen({ ...AUFTRAG, paketIds: [1] });
        assert.strictEqual(dritte.vorgemerkt.length, 1);
        assert.strictEqual(sitzungNach(erste).status, 'verworfen', 'der rote Versuch blieb neben dem neuen liegen');
        assert.strictEqual(sitzungNach(zweite).status, 'offen', 'ein fremder roter Versuch wurde mit weggeräumt');
        // Lässt sich der alte gerade nicht verwerfen, zieht das Paket trotzdem um.
        welt.stoerung.verwerfen = true;
        await urteil(dritte.vorgemerkt[0].kennung, false, ['rot']);
        const vierte = await Umzug.anstossen({ ...AUFTRAG, paketIds: [1] });
        assert.strictEqual(vierte.vorgemerkt.length, 1);
        assert.ok(protokoll.some(([art, t]) => art === 'warn' && /blieb liegen/.test(t)), 'das Liegenbleiben wurde verschwiegen');
    });

    await pruefe('Abbrechen: wartend wird rot; laufend bricht den Durchlauf ab — und der nächste beginnt', async () => {
        neueWelt([[1, A], [2, B], [3, C]]);
        const r = await Umzug.anstossen({ ...AUFTRAG, paketIds: [1, 2, 3] });
        const [erste, zweite, dritte] = r.vorgemerkt.map(v => v.kennung);
        await Umzug.abbrechen(zweite);
        assert.strictEqual(vermerk(zweite).stand, 'rot');
        assert.match(vermerk(zweite).grund, /Von Hand abgebrochen/);
        assert.strictEqual(vermerk(erste).stand, 'laeuft', 'das Abbrechen eines wartenden traf den laufenden');
        await Umzug.abbrechen(erste);
        assert.strictEqual(zaehle('pruefungAbbrechen'), 1);
        assert.strictEqual(vermerk(erste).stand, 'rot');
        assert.match(vermerk(erste).grund, /von Hand abgebrochen/);
        assert.strictEqual(vermerk(dritte).stand, 'laeuft');
        await assert.rejects(Umzug.abbrechen(erste), /schon beendet/);
        await assert.rejects(Umzug.abbrechen('wbgibtesnicht'), /keinen Umzug/);
    });

    await pruefe('Eine Sitzung ohne Umzugsvermerk: das Urteil geht den Umzug nichts an', async () => {
        neueWelt([[1, A]]);
        await attrappeS.paketOeffnen({ guildId: '1', userId: '42', paketId: 1, rootserverId: 54 });
        const k = welt.sitzungen[0].kennung;
        assert.strictEqual(await Umzug.beiUrteil(k), false);
        assert.strictEqual(await Umzug.beiUrteil('wbunbekannt'), false);
        assert.strictEqual(zaehle('veroeffentlichen') + zaehle('verwerfen') + zaehle('pruefen'), 0);
    });

    console.log('\nÜbersicht und Freigabe');

    await pruefe('Freigebbar ist nur, was aus einer freigegebenen Fassung umzog — und freigegeben wird mit EINEM Klick', async () => {
        neueWelt([[1, A, 'stable'], [2, B, 'test'], [3, C, 'stable']]);
        const r = await Umzug.anstossen({ ...AUFTRAG, paketIds: [1, 2, 3] });
        const [erste, zweite, dritte] = r.vorgemerkt.map(v => v.kennung);
        await urteil(erste, true);
        await urteil(zweite, true);
        let st = await Umzug.stand();
        const nach = Object.fromEntries(st.umzuege.map(u => [u.paket_id, u]));
        assert.strictEqual(nach[1].freigebbar, true);
        assert.strictEqual(nach[2].freigebbar, false, 'die Vorlage war selbst nur Entwurf — der Sammelknopf gäbe frei, was nie jemand freigeben wollte');
        assert.strictEqual(nach[3].stand, 'laeuft');
        assert.deepStrictEqual(st.zaehlung, { wartet: 0, laeuft: 1, gruen: 2, rot: 0, freigebbar: 1 });
        assert.strictEqual(nach[1].sitzung_offen, false);

        const f = await Umzug.freigeben({ userId: '42' });
        assert.deepStrictEqual(f.freigegeben, [{ slug: A.identity.slug, version: S.naechsteFassung(A.identity.version) }]);
        assert.strictEqual(neuesteVon(1).channel, 'stable');
        assert.strictEqual(neuesteVon(2).channel, 'test');
        assert.deepStrictEqual(welt.aufrufe.filter(a => a[0] === 'freigeben').map(a => a[3]), ['42'], 'wer freigab, muss ankommen');
        st = await Umzug.stand();
        assert.strictEqual(st.zaehlung.freigebbar, 0);
        assert.deepStrictEqual((await Umzug.freigeben({ userId: '42' })).freigegeben, [], 'ein zweiter Klick gab noch einmal frei');
        // Nicht mehr die neueste Fassung: dann nicht über den Sammelknopf.
        await urteil(dritte, true);
        welt.pakete.get(3).fassungen.push({ id: 998, version: '99.0.0', channel: 'test', test_passed_at: '2026-10-10 12:00:00', fbpkg: kopie(C) });
        assert.strictEqual((await Umzug.stand()).umzuege.find(u => u.paket_id === 3).freigebbar, false);
    });

    console.log('\nDie Knöpfe');

    await pruefe('Routen: vor /:id — und was umzieht, entscheidet der Image-Stand auf dem Server', async () => {
        const router = require('../apps/dashboard/routes/admin/addons.router');
        const pfade = router.stack.filter(s => s.route).map(s => `${Object.keys(s.route.methods)[0]} ${s.route.path}`);
        for (const p of ['get /umzug', 'post /umzug', 'post /umzug/freigeben', 'post /umzug/:kennung/abbrechen']) {
            assert.ok(pfade.includes(p), `Route fehlt: ${p}`);
            assert.ok(pfade.indexOf(p) < pfade.indexOf('get /:id'), `${p} steht hinter /:id — „umzug" wäre eine Kennung`);
        }
        const handler = (methode, pfad) => router.stack.find(s => s.route && s.route.path === pfad && s.route.methods[methode]).route.stack.slice(-1)[0].handle;
        const antwort = () => { const r = { code: 200, locals: { user: { id: '42', username: 'Betreiber' } }, status(c) { r.code = c; return r; }, json(d) { r.daten = d; return r; } }; return r; };

        const merk = { stand: Imagestand.stand, maschinen: S.maschinen, guild: process.env.CONTROL_GUILD_ID };
        let angestossen = null;
        Umzug._setze({});   // die Dienste bleiben; nur anstossen wird belauscht
        const echtesAnstossen = Umzug.anstossen;
        try {
            process.env.CONTROL_GUILD_ID = '1';
            Imagestand.stand = async () => ({ fehler: null, pakete: [
                { paket_id: 1, stand: 'neuer_bau' }, { paket_id: 2, stand: 'aktuell' }, { paket_id: 3, stand: 'neuer_bau' }, { paket_id: 4, stand: 'unbekannt' }] });
            S.maschinen = async () => [{ id: 54, name: 'Eins', online: false }, { id: 55, name: 'Zwei', online: true }];
            Umzug.anstossen = async (a) => { angestossen = a; return { vorgemerkt: a.paketIds.map(id => ({ paket_id: id, slug: 's' + id, von: '1.0.0', nach: '1.0.1' })), abgelehnt: [] }; };

            let r = antwort();
            await handler('post', '/umzug')({ body: { pakete: 'alle' } }, r);
            assert.deepStrictEqual(angestossen.paketIds, [1, 3], '„alle" sind die, die zurückliegen — nicht mehr, nicht weniger');
            assert.strictEqual(angestossen.rootserverId, 55, 'ohne Wahl die erste ERREICHBARE Maschine');
            assert.deepStrictEqual([angestossen.guildId, angestossen.userId, angestossen.autor], ['1', '42', 'Betreiber']);
            assert.strictEqual(r.daten.success, true);

            r = antwort(); angestossen = null;
            await handler('post', '/umzug')({ body: { pakete: [2, 3, 4, 99] } }, r);
            assert.deepStrictEqual(angestossen.paketIds, [3], 'ein Paket am neuesten Bau zog um — eine Fassung ohne Inhalt');

            r = antwort(); angestossen = null;
            await handler('post', '/umzug')({ body: { pakete: [2] } }, r);
            assert.strictEqual(r.code, 400);
            assert.strictEqual(angestossen, null);
            assert.match(r.daten.message, /Keines der gewählten Pakete/);

            r = antwort();
            await handler('post', '/umzug')({ body: { pakete: 'alle', rootserver_id: 54 } }, r);
            assert.strictEqual(r.code, 400);
            assert.match(r.daten.message, /„Eins" ist nicht erreichbar/);

            Imagestand.stand = async () => ({ fehler: 'Kein Daemon ist erreichbar — der neueste Bau lässt sich nicht erfragen.', pakete: [] });
            r = antwort(); angestossen = null;
            await handler('post', '/umzug')({ body: { pakete: 'alle' } }, r);
            assert.strictEqual(r.code, 400);
            assert.match(r.daten.message, /Kein Daemon ist erreichbar/);
            assert.strictEqual(angestossen, null, 'ohne Auskunft über den neuesten Bau wurde trotzdem umgezogen');

            delete process.env.CONTROL_GUILD_ID;
            r = antwort();
            await handler('post', '/umzug')({ body: { pakete: 'alle' } }, r);
            assert.match(r.daten.message, /CONTROL_GUILD_ID/);
        } finally {
            Imagestand.stand = merk.stand; S.maschinen = merk.maschinen; Umzug.anstossen = echtesAnstossen;
            if (merk.guild === undefined) delete process.env.CONTROL_GUILD_ID; else process.env.CONTROL_GUILD_ID = merk.guild;
        }
    });

    await pruefe('Das Urteil eines Durchlaufs erreicht den Umzug — auch der Abbruch von Hand', async () => {
        const Ereignisse = require('../plugins/werkbank/dashboard/helpers/Ereignisse');
        const echt = Umzug.beiUrteil;
        const gerufen = [];
        try {
            Umzug.beiUrteil = async (k) => { gerufen.push(k); if (k === 'wbkaputt') throw new Error('absichtlich'); };
            Ereignisse.umzugWeiter('wbprobe');
            Ereignisse.umzugWeiter('wbkaputt');
            await new Promise(r => setImmediate(r));
            assert.deepStrictEqual(gerufen, ['wbprobe', 'wbkaputt']);
            assert.ok(protokoll.some(([art, t]) => art === 'error' && /wbkaputt/.test(t)), 'ein Fehler der Kette verschwand lautlos');
        } finally { Umzug.beiUrteil = echt; }
        const ereignisse = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'plugins/werkbank/dashboard/helpers/Ereignisse.js'), 'utf8'));
        const urteilsteil = ereignisse.slice(ereignisse.indexOf('async function beiPruefung'), ereignisse.indexOf('function umzugWeiter'));
        assert.match(urteilsteil, /pruefungBeenden\([\s\S]+umzugWeiter\(kennung\)/, 'beiPruefung reicht das Urteil nicht weiter — oder bevor es gespeichert ist');
        const router = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'plugins/werkbank/dashboard/routes/guild.router.js'), 'utf8'));
        assert.match(router, /pruefungAbbrechen\(sitzung\);[\s\S]{0,200}umzugWeiter\(sitzung\.kennung\)/, 'der Abbruch in der Werkbank liesse den Umzug auf „läuft" stehen');
    });

    await pruefe('Die Seite: Knopf je Paket, einer für alle, Freigabe mit Rückfrage — ohne confirm()', async () => {
        const seite = ohneKommentareEjs(fs.readFileSync(path.join(WURZEL, 'apps/dashboard/themes/default/views/admin/addons/index.ejs'), 'utf8'));
        assert.match(seite, /data-umzug="<%= addon\.id %>"/);
        for (const id of ['umzugAlle', 'umzugFreigeben', 'umzugFreigebenModal', 'umzugFreigebenKnopf', 'umzugMaschine']) {
            assert.ok(seite.includes(`id="${id}"`), `fehlt: #${id}`);
        }
        const skript = ohneKommentare(seite.slice(seite.indexOf('async function ladeImageStand'), seite.indexOf('ladeImageStand().then(ladeUmzug')));
        assert.ok(skript.length > 2000, 'der Umzugsteil des Skripts wurde nicht gefunden');
        assert.doesNotMatch(skript, /\b(confirm|alert|prompt)\(/);
        assert.doesNotMatch(skript, /innerHTML/, 'Namen und Gründe kommen aus Paketen und vom Daemon — als Text setzen');
        assert.match(skript, /'\/admin\/addons\/umzug\/freigeben'/);
        assert.match(skript, /pakete, rootserver_id/);
    });

    console.log(fehler ? `\n❌ ${fehler} Prüfung(en) fehlgeschlagen` : '\n✅ Umzug: eine Kette aus den Bausteinen der Werkbank, außer dem Image ändert sich nichts, und freigegeben wird mit einem Klick');
    process.exit(fehler ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
