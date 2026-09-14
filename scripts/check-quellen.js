#!/usr/bin/env node
/**
 * Zwei Anbieter, ein Weg — ohne Netz.
 *
 * ── Warum es diesen Waechter gibt ───────────────────────────────────────────
 *
 * Am 2026-09-14 kam mit Modrinth der zweite Anbieter dazu. Bis dahin stand
 * „thunderstore" an 18 Stellen im Code; jetzt steht dort eine Weiche
 * (`Quellen.js`). Eine Weiche, die nur einer nimmt, ist keine — deshalb prueft
 * dieser Waechter den ZWEITEN Anbieter auf demselben Weg: aufloesen, ablegen,
 * Zeile schreiben, Adresse bilden.
 *
 * **Es gibt heute kein Spiel-Paket, das Modrinth nennt** (nur Valheim und Astro
 * Colony existieren als FBPKG). Genau deshalb steht der Weg hier unter Zwang:
 * Ohne diese Pruefungen waere Modrinth Code ohne Aufrufer — und der versagt
 * beim ersten echten Einsatz lautlos.
 *
 * ── Die Antworten sind gemessen, nicht erfunden ─────────────────────────────
 *
 * Die Attrappe von `fetch` gibt Ausschnitte echter Antworten der Modrinth-API
 * vom 2026-09-14 zurueck (EssentialsX fuer Paper, REI fuer Fabric samt drei
 * Pflicht-Abhaengigkeiten). Gekuerzt sind nur Felder, die der Code nicht liest.
 * Eine unerwartete Adresse WIRFT — eine Attrappe, die still antwortet, prueft
 * nichts.
 *
 *   node scripts/check-quellen.js
 */
'use strict';

const assert = require('assert');
const path = require('path');
const { ServiceManager } = require('dunebot-core');

const still = () => {};
if (!ServiceManager.has('Logger')) {
    ServiceManager.register('Logger', { debug: still, info: still, warn: still, error: still, success: still });
}

const HELFER = path.join(__dirname, '../plugins/gameserver/dashboard/helpers');

// ── Gemessene Ausschnitte (2026-09-14) ──────────────────────────────────────
const SUCHE_PAPER = {
    total_hits: 142, limit: 20, offset: 0,
    hits: [{
        slug: 'essentialsx', title: 'EssentialsX', description: 'The essential plugin suite',
        downloads: 797007, icon_url: 'https://cdn.modrinth.com/data/hXiIvTyT/icon.png',
        date_modified: '2026-05-31T15:05:35.376401Z',
        client_side: 'unsupported', server_side: 'required', project_type: 'mod',
    }],
};

const FASSUNG_ESSENTIALS = {
    id: 'aBcDeFgH', project_id: 'hXiIvTyT', name: 'EssentialsX 2.22.0',
    version_number: '2.22.0', date_published: '2026-05-31T15:05:35.376401Z',
    loaders: ['bukkit', 'paper', 'spigot'], game_versions: ['1.8.8', '1.21.8', '1.21.11'],
    dependencies: [{ version_id: null, project_id: 'Vebnzrzj', file_name: null, dependency_type: 'optional' }],
    // ⚠ Die Hauptdatei steht mit ABSICHT nicht an erster Stelle: Mit ihr vorn
    // bestuende die Pruefung „nimmt die Hauptdatei" auch dann, wenn der Code
    // schlicht die erste naehme. Am 2026-09-14 genau so bemerkt — die
    // Gegenprobe schlug nicht an, weil die Attrappe zu freundlich war.
    files: [
        { url: 'https://cdn.modrinth.com/data/hXiIvTyT/versions/aBcDeFgH/sources.jar',
          filename: 'sources.jar', size: 1, primary: false },
        { url: 'https://cdn.modrinth.com/data/hXiIvTyT/versions/aBcDeFgH/EssentialsX-2.22.0.jar',
          filename: 'EssentialsX-2.22.0.jar', size: 4861125, primary: true },
    ],
};

const FASSUNG_ALT = { ...FASSUNG_ESSENTIALS, version_number: '2.21.2',
    date_published: '2025-11-02T10:00:00.000000Z' };

// REI verlangt drei Projekte — gemessen: fabric-api, architectury-api, cloth-config.
const FASSUNG_REI = {
    id: 'reiVers1', project_id: 'nfn13YXA', name: 'REI',
    version_number: '26.2.820+fabric', date_published: '2026-09-10T12:00:00.000000Z',
    loaders: ['fabric'], game_versions: ['26.2'],
    dependencies: [
        { version_id: null, project_id: 'P7dR8mSH', file_name: null, dependency_type: 'required' },
        { version_id: null, project_id: 'lhGA9TYQ', file_name: null, dependency_type: 'required' },
        { version_id: null, project_id: '9s6osm5g', file_name: null, dependency_type: 'required' },
    ],
    files: [{ url: 'https://cdn.modrinth.com/data/nfn13YXA/versions/reiVers1/rei.jar',
              filename: 'rei.jar', size: 2, primary: true }],
};
const NUR_FASSUNG = (slug, id) => ({
    id: slug + 'V', project_id: id, name: slug, version_number: '1.0.0',
    date_published: '2026-09-01T00:00:00.000000Z', loaders: ['fabric'], game_versions: ['26.2'],
    dependencies: [],
    files: [{ url: `https://cdn.modrinth.com/data/${id}/versions/x/${slug}.jar`,
              filename: slug + '.jar', size: 1, primary: true }],
});

const PROJEKTE = {
    P7dR8mSH: { slug: 'fabric-api', title: 'Fabric API', client_side: 'required' },
    lhGA9TYQ: { slug: 'architectury-api', title: 'Architectury API', client_side: 'required' },
    '9s6osm5g': { slug: 'cloth-config', title: 'Cloth Config API', client_side: 'required' },
};

let abrufe = [];
global.fetch = async (adresse) => {
    abrufe.push(String(adresse));
    const u = new URL(String(adresse));
    const pfad = u.pathname;
    const antwort = (koerper) => ({ ok: true, status: 200, json: async () => koerper });

    if (pfad === '/v2/search') return antwort(SUCHE_PAPER);
    if (pfad === '/v2/project/essentialsx/version') {
        return antwort(u.searchParams.get('loaders') === '["fabric"]' ? [] : [FASSUNG_ESSENTIALS, FASSUNG_ALT]);
    }
    if (pfad === '/v2/project/rei/version') return antwort([FASSUNG_REI]);
    if (pfad === '/v2/project/gibtesnicht/version') return { ok: false, status: 404, json: async () => ({}) };
    const projekt = pfad.match(/^\/v2\/project\/([^/]+)\/version$/);
    if (projekt) {
        const eintrag = Object.entries(PROJEKTE).find(([, p]) => p.slug === projekt[1]);
        if (eintrag) return antwort([NUR_FASSUNG(eintrag[1].slug, eintrag[0])]);
    }
    // Die echte API nimmt ID ODER Slug — die Attrappe auch, sonst prueft sie
    // einen Weg, den es so nicht gibt.
    const einzeln = pfad.match(/^\/v2\/project\/([^/]+)$/);
    if (einzeln) {
        if (PROJEKTE[einzeln[1]]) return antwort(PROJEKTE[einzeln[1]]);
        const ueberSlug = Object.values(PROJEKTE).find(x => x.slug === einzeln[1]);
        if (ueberSlug) return antwort(ueberSlug);
        if (einzeln[1] === 'essentialsx') {
            return antwort({ slug: 'essentialsx', title: 'EssentialsX', client_side: 'unsupported' });
        }
        if (einzeln[1] === 'rei') {
            return antwort({ slug: 'rei', title: 'Roughly Enough Items', client_side: 'required' });
        }
    }

    throw new Error('Unerwarteter Abruf: ' + adresse);
};

const Quellen = require(path.join(HELFER, 'Quellen.js'));
const Modrinth = require(path.join(HELFER, 'Modrinth.js'));

let bestanden = 0;
async function pruefe(name, fn) {
    abrufe = [];
    try {
        await fn();
        console.log(`  ✓ ${name}`);
        bestanden++;
    } catch (fehler) {
        console.error(`  ✗ ${name}\n    ${fehler.message}`);
        process.exitCode = 1;
    }
}

(async () => {
    console.log('\nDer Vertrag');

    // Die Liste steht hier NOCH EINMAL und nicht in Quellen.js: Ein Waechter,
    // der seine Erwartung aus dem Gepruefte holt, prueft nichts.
    const VERTRAG = ['KENNUNG', 'TITEL', 'RAUM_NAME', 'HERKUNFT', 'istErlaubt', 'suche', 'paket',
                     'aufloesen', 'aktualisierungen', 'verzeichnis', 'adresse', 'hoeher', 'neuerAls'];

    await pruefe('Jeder Anbieter kann alles, was der Weg von ihm verlangt', async () => {
        const namen = Object.keys(Quellen.ANBIETER);
        assert.ok(namen.length >= 2, `nur ${namen.length} Anbieter — die Weiche prueft sich dann selbst nicht`);
        for (const [name, a] of Object.entries(Quellen.ANBIETER)) {
            const fehlt = VERTRAG.filter(f => a[f] === undefined);
            assert.deepStrictEqual(fehlt, [], `${name} fehlt: ${fehlt.join(', ')}`);
            assert.strictEqual(a.KENNUNG, name, 'der Schluessel ist der Name in der Spalte `quelle`');
        }
    });

    await pruefe('Eine unbekannte Quelle wirft, statt still auf die erste zu zeigen', async () => {
        assert.throws(() => Quellen.fuer('curseforge'), /Unbekannte Quelle/);
        assert.strictEqual(Quellen.gibtEs('upload'), false, '`upload` ist kein Katalog');
    });

    await pruefe('Das Paket entscheidet, wer gefragt wird', async () => {
        const inhalt = { sources: ['upload', 'modrinth', 'curseforge'],
                         source_ids: { modrinth: 'paper', curseforge: '432' } };
        assert.deepStrictEqual(Quellen.ausPaket(inhalt), ['modrinth'],
            'was dieses Dashboard nicht kann, faellt raus — und ist kein Fehler');
        assert.strictEqual(Quellen.waehle(inhalt), 'modrinth', 'ohne Wunsch der erste des Pakets');
        assert.strictEqual(Quellen.waehle(inhalt, 'thunderstore'), null,
            'ein Anbieter, den das Paket nicht nennt, kommt auch auf Wunsch nicht');
        assert.deepStrictEqual(Quellen.raeumeAus(inhalt), { modrinth: 'paper' });
    });

    console.log('\nModrinth');

    await pruefe('Die Suche filtert nach Lader und zaehlt in total_hits', async () => {
        const s = await Modrinth.suche('paper', 'essentials', {});
        assert.strictEqual(s.gesamt, 142);
        assert.strictEqual(s.treffer[0].kennung, 'essentialsx', 'die Kennung ist der Slug');
        assert.strictEqual(s.treffer[0].clientSeitig, false, 'client_side: unsupported');
        const u = new URL(abrufe[0]);
        assert.strictEqual(u.searchParams.get('facets'), '[["categories:paper"]]',
            'ohne Lader-Facette kaemen Fabric-Mods in eine Paper-Liste');
        assert.strictEqual(u.searchParams.get('index'), 'relevance', 'mit Begriff nach Trefferguete');
        const stoebern = await Modrinth.suche('paper', '', {});
        assert.strictEqual(new URL(abrufe[1]).searchParams.get('index'), 'downloads',
            'ohne Begriff die beliebtesten');
        assert.strictEqual(stoebern.weiter, true, '142 Treffer sind mehr als eine Seite');
    });

    await pruefe('Ein Paket nimmt die HAUPTdatei, nicht die erste', async () => {
        const p = await Modrinth.paket('paper', 'essentialsx');
        assert.strictEqual(p.fassung, '2.22.0', 'die Liste kommt neueste zuerst');
        assert.match(p.adresse, /EssentialsX-2\.22\.0\.jar$/, 'sources.jar waere die falsche Datei');
        assert.strictEqual(p.bytes, 4861125);
        assert.strictEqual(p.veroeffentlicht, '2026-05-31T15:05:35.376401Z');
        assert.deepStrictEqual(p.spielfassungen, ['1.8.8', '1.21.8', '1.21.11']);
        assert.strictEqual(Modrinth.istErlaubt(p.adresse), true);
    });

    await pruefe('Eine verlangte Fassung wird in der Liste gesucht', async () => {
        const p = await Modrinth.paket('paper', 'essentialsx', '2.21.2');
        assert.strictEqual(p.fassung, '2.21.2');
        await assert.rejects(Modrinth.paket('paper', 'essentialsx', '9.9.9'), /gibt es nicht/);
    });

    await pruefe('Kein Treffer fuer diesen Lader ist eine Auskunft, kein leeres Ergebnis', async () => {
        await assert.rejects(Modrinth.paket('fabric', 'essentialsx'), /keine Fassung für fabric/);
    });

    await pruefe('Pflicht-Abhaengigkeiten kommen mit — und stehen VOR dem Mod', async () => {
        const a = await Modrinth.aufloesen('fabric', 'rei');
        assert.deepStrictEqual(a.pakete.map(p => p.kennung),
            ['fabric-api', 'architectury-api', 'cloth-config', 'rei'],
            'wer zuerst geladen werden muss, wird zuerst abgelegt');
        assert.deepStrictEqual(a.fehlend, []);
    });

    await pruefe('Optionale Abhaengigkeiten werden NICHT untergeschoben', async () => {
        const a = await Modrinth.aufloesen('paper', 'essentialsx');
        assert.deepStrictEqual(a.pakete.map(p => p.kennung), ['essentialsx'],
            'die optionale Abhaengigkeit von EssentialsX gehoert dem Betreiber, nicht uns');
    });

    await pruefe('Neuer entscheidet das DATUM, nicht die Nummer', async () => {
        const neu = { fassung: '2.22.0', veroeffentlicht: '2026-05-31T15:05:35Z' };
        // Nummer kleiner, Datum spaeter — bei freien Fassungsnummern der Normalfall.
        assert.strictEqual(Modrinth.neuerAls(neu, { fassung: '10.0.0', veroeffentlicht: '2025-01-01T00:00:00Z' }), true);
        assert.strictEqual(Modrinth.neuerAls(neu, { fassung: '2.21.2', veroeffentlicht: '2026-08-01T00:00:00Z' }), false,
            'aelter als die installierte: kein Update anbieten');
        assert.strictEqual(Modrinth.neuerAls(neu, { fassung: '2.22.0', veroeffentlicht: '2020-01-01T00:00:00Z' }), false,
            'dieselbe Fassung ist nie neuer');
        // Ohne Datum bleibt nur die Nummer — und wenn die nichts hergibt, „nein".
        assert.strictEqual(Modrinth.neuerAls(neu, { fassung: '2.21.2' }), true);
        assert.strictEqual(Modrinth.neuerAls({ fassung: 'v3' }, { fassung: '1.21.1-fabric-0.6' }), false,
            'lieber kein Update anbieten als eine Herabstufung');
    });

    await pruefe('Der Aktualisierungsstand fuellt auch den Erscheinungstag nach', async () => {
        const stand = await Modrinth.aktualisierungen('paper', [
            { id: 5, kennung: 'essentialsx', fassung: '2.22.0', veroeffentlicht: null },
            { id: 6, kennung: 'essentialsx', fassung: '2.21.2', veroeffentlicht: '2025-11-02' },
        ]);
        assert.strictEqual(stand[0].neuer, false, 'gleiche Fassung');
        assert.strictEqual(stand[0].installiertVom, '2026-05-31T15:05:35.376401Z',
            'steht die Zeile auf der neuesten Fassung, ist die Abfrage zugleich die Auskunft');
        assert.strictEqual(stand[1].neuer, true);
        assert.strictEqual(stand[1].installiertVom, null, 'andere Fassung — kein Tag zu verschenken');
    });

    await pruefe('Ein Fehlschlag beendet die Liste nicht', async () => {
        const stand = await Modrinth.aktualisierungen('paper', [
            { id: 9, kennung: 'gibtesnicht', fassung: '1.0.0' },
            { id: 5, kennung: 'essentialsx', fassung: '2.21.2', veroeffentlicht: '2025-11-02' },
        ]);
        assert.match(stand[0].fehler, /404|nicht/);
        assert.strictEqual(stand[1].neuer, true, 'der zweite wird trotzdem gefragt');
    });

    await pruefe('Adresse und Verzeichnis zeigen auf die richtige Sorte Seite', async () => {
        assert.strictEqual(Modrinth.adresse('paper', 'essentialsx'), 'https://modrinth.com/mod/essentialsx');
        assert.strictEqual(Modrinth.verzeichnis('paper'), 'https://modrinth.com/discover/plugins');
        assert.strictEqual(Modrinth.verzeichnis('fabric'), 'https://modrinth.com/discover/mods');
    });

    // ── Der ganze Weg, nicht nur der Anbieter ───────────────────────────────
    //
    // Hier entscheidet sich, ob die Weiche wirklich eine ist: Dasselbe
    // `installiere`, das Valheim von Thunderstore holt, muss ein Paper-Plugin
    // von Modrinth ablegen — mit der richtigen Quelle in der Zeile, dem Ziel aus
    // dem Paket und ohne eine einzige Thunderstore-Annahme unterwegs.
    console.log('\nDer ganze Weg');

    const PAPER = {
        supported: true,
        sources: ['upload', 'modrinth'],
        source_ids: { modrinth: 'paper' },
        // Kein `loader` — bei Minecraft ist der Serverkern das Paket selbst und
        // kommt nicht aus dem Katalog. Genau das darf den Weg nicht stoeren.
        path: 'plugins',
        client_side: false,
        needs_restart: true,
    };
    const SERVER = { id: 42, rootserver_id: 55, install_path: '42-paper' };

    const db = {
        zeilen: [],
        async query(sql, params) {
            if (/FROM rootserver WHERE id/.test(sql)) return [{ daemon_id: 'd1' }];
            if (/INSERT INTO gameserver_content/.test(sql)) {
                const [serverId, guildId, art, quelle, kennung, name, fassung, veroeffentlicht,
                       reihenfolge, ablage, dateien, clientSide, status] = params;
                const da = this.zeilen.find(z => z.kennung === kennung && z.quelle === quelle);
                const zeile = da || { id: this.zeilen.length + 1, server_id: serverId, quelle, kennung };
                Object.assign(zeile, { guild_id: guildId, art, name, fassung, veroeffentlicht,
                    reihenfolge, ablage, dateien, client_side: clientSide, status });
                if (!da) this.zeilen.push(zeile);
                return { insertId: da ? 0 : zeile.id };
            }
            if (/SELECT id FROM gameserver_content WHERE server_id = \? AND quelle = \? AND kennung = \?/.test(sql)) {
                const z = this.zeilen.find(x => x.kennung === params[2] && x.quelle === params[1]);
                return z ? [z] : [];
            }
            if (/SELECT id, art, quelle, kennung/.test(sql)) return this.zeilen;
            throw new Error('Unerwartete Abfrage: ' + String(sql).trim().slice(0, 70));
        },
    };
    const daemon = {
        abrufe: [],
        isDaemonOnline: () => true,
        async sendCommand(id, befehl, nutzlast) {
            if (befehl === 'gameserver.content.fetch') {
                this.abrufe.push(nutzlast);
                const wurzel = nutzlast.ziel ? nutzlast.ziel + '/' : '';
                return { success: true, data: { dateien: [wurzel + nutzlast.dateiname.replace(/\.zip$/, '.jar')] } };
            }
            throw new Error('Unerwarteter Befehl: ' + befehl);
        },
    };
    if (!ServiceManager.has('dbService')) ServiceManager.register('dbService', db);
    if (!ServiceManager.has('ipmServer')) ServiceManager.register('ipmServer', daemon);

    const InhalteHolen = require(path.join(HELFER, 'InhalteHolen.js'));
    const Inhalte = require(path.join(HELFER, 'Inhalte.js'));

    await pruefe('Ein Plugin von Modrinth geht denselben Weg wie ein Mod von Thunderstore', async () => {
        db.zeilen = []; daemon.abrufe = [];
        const e = await InhalteHolen.installiere({ server: SERVER, inhalt: PAPER, guildId: 'g1',
            quelle: 'modrinth', kennung: 'essentialsx' });

        assert.strictEqual(e.installiert.length, 1);
        assert.strictEqual(daemon.abrufe[0].ziel, 'plugins', 'das Ziel kommt aus dem Paket');
        assert.match(daemon.abrufe[0].adresse, /^https:\/\/cdn\.modrinth\.com\//);
        const zeile = db.zeilen[0];
        assert.strictEqual(zeile.quelle, 'modrinth', 'die Zeile merkt sich, woher sie kam');
        assert.strictEqual(zeile.fassung, '2.22.0');
        assert.strictEqual(zeile.veroeffentlicht, '2026-05-31', 'der Erscheinungstag reist mit');
        assert.strictEqual(zeile.art, 'mod', 'ohne loader.packages.modrinth ist nichts der Lader');
        assert.strictEqual(zeile.status, 'installiert');
    });

    await pruefe('„Mitspieler brauchen ihn auch" sagt hier der KATALOG, nicht das Paket', async () => {
        db.zeilen = []; daemon.abrufe = [];
        // Das Paket sagt `client_side: false` fuer alle Mods. Fabric API ist
        // laut Modrinth `client_side: required` — die genauere Angabe gewinnt.
        await InhalteHolen.installiere({ server: SERVER, inhalt: { ...PAPER, source_ids: { modrinth: 'fabric' } },
            guildId: 'g1', quelle: 'modrinth', kennung: 'rei' });
        const api = db.zeilen.find(z => z.kennung === 'fabric-api');
        assert.ok(api, 'die Pflicht-Abhaengigkeit wurde abgelegt');
        assert.strictEqual(api.client_side, 1, 'Modrinth weiss es je Mod, das Paket nur je Spiel');
        assert.deepStrictEqual(db.zeilen.map(z => z.reihenfolge), [0, 1, 2, 3],
            'die Reihenfolge bleibt die des Aufloesens');
    });

    await pruefe('Die Vorschau zeigt vorher, was kaeme — samt Spielfassungen', async () => {
        db.zeilen = [];
        const v = await InhalteHolen.vorschau({ serverId: null, inhalt: PAPER,
            quelle: 'modrinth', kennung: 'essentialsx' });
        assert.strictEqual(v.quelle, 'modrinth');
        assert.strictEqual(v.pakete[0].kennung, 'essentialsx');
        assert.deepStrictEqual(v.pakete[0].spielfassungen, ['1.8.8', '1.21.8', '1.21.11'],
            'die Pruefung, die Thunderstore nicht kann');
    });

    await pruefe('Die Adresse der Zeile kommt vom richtigen Anbieter', async () => {
        const raeume = Quellen.raeumeAus(PAPER);
        assert.strictEqual(
            Inhalte.paketAdresse({ quelle: 'modrinth', kennung: 'essentialsx' }, raeume),
            'https://modrinth.com/mod/essentialsx');
        assert.strictEqual(
            Inhalte.paketAdresse({ quelle: 'thunderstore', kennung: 'a-b' }, raeume), null,
            'dieses Spiel hat keine Thunderstore-Gemeinschaft — dann gibt es auch keine Adresse');
    });

    console.log(`\n${bestanden} Pruefung(en) bestanden.\n`);
})();
