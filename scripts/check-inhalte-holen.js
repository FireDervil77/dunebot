#!/usr/bin/env node
/**
 * Der Weg eines Mods von Thunderstore auf den Server — ohne Netz, ohne Daemon.
 *
 * Geprueft wird das, was man an einem echten Lauf erst im Spiel merken wuerde:
 * ob der LADER in die Serverwurzel geht und der Mod in `content.path`, ob die
 * Abhaengigkeit VOR dem Mod liegt, ob ein Fehlschlag eine Zeile hinterlaesst —
 * und ob das Entfernen die richtigen Dateien nimmt statt des ganzen Ordners.
 *
 * Die Attrappen WERFEN bei unerwarteten Abfragen. Eine Attrappe, die still
 * antwortet, prueft nichts (siehe scripts/check-startpayload.js).
 *
 *   node scripts/check-inhalte-holen.js
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

// ── Das Paket, gegen das geprueft wird ──────────────────────────────────────
const INHALT = {
    supported: true,
    sources: ['upload', 'thunderstore'],
    source_ids: { thunderstore: 'valheim' },
    loader: { key: 'bepinex', path: 'game',
              packages: { thunderstore: 'denikson-BepInExPack_Valheim' } },
    path: 'game/BepInEx/plugins',
    client_side: true,
    needs_restart: true,
};

// ── Attrappen ───────────────────────────────────────────────────────────────
const db = {
    zeilen: [],          // gameserver_content
    async query(sql, params) {
        if (/FROM rootserver WHERE id/.test(sql)) return [{ daemon_id: 'd1' }];
        if (/INSERT INTO gameserver_content/.test(sql)) {
            const [serverId, guildId, art, quelle, kennung, name, fassung, reihenfolge,
                   ablage, dateien, clientSide, status, fehler] = params;
            const da = this.zeilen.find(z => z.kennung === kennung && z.quelle === quelle);
            const zeile = da || { id: this.zeilen.length + 1, server_id: serverId, quelle, kennung };
            Object.assign(zeile, { guild_id: guildId, art, name, fassung, reihenfolge,
                ablage, dateien, client_side: clientSide, status, fehler });
            if (!da) this.zeilen.push(zeile);
            return { insertId: da ? 0 : zeile.id };
        }
        if (/SELECT id FROM gameserver_content WHERE server_id = \? AND quelle = \? AND kennung = \?/.test(sql)) {
            const z = this.zeilen.find(x => x.kennung === params[2]);
            return z ? [z] : [];
        }
        if (/SELECT id, kennung, fassung FROM gameserver_content/.test(sql)) {
            const gesucht = /status = 'installiert'/.test(sql) ? 'installiert' : 'geplant';
            return this.zeilen.filter(z => z.status === gesucht);
        }
        if (/FROM gameservers WHERE id = \? AND guild_id = \?/.test(sql)) {
            return [{ id: 186, name: 'Bude', guild_id: 'g1', rootserver_id: 55,
                      install_path: '186-valheim', addon_marketplace_id: 173, status: this.serverStatus || 'online' }];
        }
        if (/FROM packages pk/.test(sql)) {
            return [{ paket_slug: 'valheim', paket_version: '1.0.10', paket_channel: 'test',
                      paket_json: JSON.stringify({ identity: { slug: 'valheim' }, content: INHALT }) }];
        }
        if (/SELECT \* FROM gameserver_content WHERE id = \? AND server_id = \?/.test(sql)
            || /SELECT \* FROM gameserver_content\s+WHERE id = \? AND server_id = \? AND quelle/.test(sql)) {
            const z = this.zeilen.find(x => String(x.id) === String(params[0]));
            return z ? [z] : [];
        }
        if (/UPDATE gameserver_content SET status = 'entfernt'/.test(sql)) {
            const z = this.zeilen.find(x => String(x.id) === String(params[0]));
            if (z) { z.status = 'entfernt'; z.aktiv = 0; }
            return { affectedRows: 1 };
        }
        if (/SELECT id, art, quelle, kennung/.test(sql)) return this.zeilen;
        if (/UPDATE gameserver_content SET status = 'fehlgeschlagen'/.test(sql)) {
            const z = this.zeilen.find(x => x.id === params[1]);
            if (z) { z.status = 'fehlgeschlagen'; z.fehler = params[0]; }
            return { affectedRows: 1 };
        }
        if (/UPDATE gameserver_content SET aktiv = \?/.test(sql)) {
            const z = this.zeilen.find(x => String(x.id) === String(params[1]) && x.status !== 'entfernt');
            if (z) z.aktiv = params[0];
            return { affectedRows: z ? 1 : 0 };
        }
        throw new Error('Unerwartete Abfrage: ' + String(sql).trim().slice(0, 70));
    },
};

const daemon = {
    abrufe: [],          // gameserver.content.fetch
    geloescht: [],       // gameserver.files.delete
    scheitern: new Set(),
    isDaemonOnline: () => true,
    async sendCommand(daemonId, befehl, nutzlast) {
        if (befehl === 'gameserver.content.fetch') {
            this.abrufe.push(nutzlast);
            if (this.scheitern.has(nutzlast.adresse)) {
                return { success: false, error: 'herkunft nicht erlaubt: boese.example' };
            }
            const wurzel = nutzlast.ziel ? nutzlast.ziel + '/' : '';
            return { success: true, data: { dateien: [wurzel + 'A.dll', wurzel + 'B.dll'] } };
        }
        if (befehl === 'gameserver.files.delete') {
            this.geloescht.push(nutzlast.path);
            return { success: true };
        }
        throw new Error('Unerwarteter Befehl: ' + befehl);
    },
};

if (!ServiceManager.has('dbService')) ServiceManager.register('dbService', db);
if (!ServiceManager.has('ipmServer')) ServiceManager.register('ipmServer', daemon);

const Thunderstore = require(path.join(HELFER, 'Thunderstore.js'));
const InhalteHolen = require(path.join(HELFER, 'InhalteHolen.js'));

// Thunderstore wird NICHT befragt — die echten Abrufe sind am 2026-09-09 an der
// API gemessen und stehen in Baustelle 111. Hier geht es um den Weg danach.
const ECHT = { aufloesen: Thunderstore.aufloesen, paket: Thunderstore.paket,
               suche: Thunderstore.suche, aktualisierungen: Thunderstore.aktualisierungen };
function stelleThunderstore(pakete, neueste = null) {
    Thunderstore.aufloesen = async () => ({ pakete, fehlend: [] });
    Thunderstore.paket = async (ns, name) => neueste || pakete[pakete.length - 1];
}

const SERVER = { id: 186, rootserver_id: 55, install_path: '186-valheim' };

const BEPINEX = { kennung: 'denikson-BepInExPack_Valheim', name: 'BepInExPack_Valheim',
                  fassung: '5.4.2333', adresse: 'https://thunderstore.io/package/download/denikson/BepInExPack_Valheim/5.4.2333/', bytes: 1 };
const JOTUNN  = { kennung: 'ValheimModding-Jotunn', name: 'Jotunn', fassung: '2.29.2',
                  adresse: 'https://thunderstore.io/package/download/ValheimModding/Jotunn/2.29.2/', bytes: 1 };

let bestanden = 0;
async function pruefe(name, fn) {
    db.zeilen = []; daemon.abrufe = []; daemon.geloescht = []; daemon.scheitern = new Set(); db.serverStatus = null;
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
    console.log('\nInstallieren');

    await pruefe('Der Lader geht neben das Spiel, der Mod in content.path', async () => {
        stelleThunderstore([BEPINEX, JOTUNN]);
        const e = await InhalteHolen.installiere({
            server: SERVER, inhalt: INHALT, guildId: 'g1', kennung: 'ValheimModding-Jotunn' });
        assert.strictEqual(e.installiert.length, 2);
        // Beide Pfade kommen aus dem PAKET und sind relativ zur Volume-Wurzel.
        // Der Lader muss neben der Spieldatei liegen: Doorstop laedt ihn mit
        // Pfaden relativ zum Arbeitsverzeichnis, und das ist game/. Lag er in
        // der Wurzel, zeigten sie ins Leere — am 2026-09-12 an Server 188
        // gemessen, der Start brach ab.
        assert.strictEqual(daemon.abrufe[0].ziel, 'game', 'Lader gehoert neben das Spiel');
        assert.strictEqual(daemon.abrufe[1].ziel, 'game/BepInEx/plugins');
        assert.strictEqual(db.zeilen[0].art, 'loader');
        assert.strictEqual(db.zeilen[1].art, 'mod');
    });

    // ── Der Fund vom 2026-09-13 (Server 189) ────────────────────────────────
    //
    // Ein Mod verlangte BepInEx 5.4.2200, installiert war 5.4.2333. `legeAb`
    // schrieb die neue Dateiliste per ON DUPLICATE KEY UPDATE ueber die alte —
    // die Dateien der alten Fassung blieben liegen und standen danach in KEINER
    // Liste mehr. Fuenf Waisen, darunter `.doorstop_version`: Sie wies den
    // Lader als Doorstop 4 aus, waehrend Doorstop 3 installiert war, und
    // schickte die Fehlersuche in die falsche Richtung.
    await pruefe('Eine andere Fassung raeumt erst auf', async () => {
        db.zeilen.push({ id: 1, server_id: 186, quelle: 'thunderstore', art: 'loader',
            kennung: 'denikson-BepInExPack_Valheim', fassung: '5.4.2333', status: 'installiert',
            ablage: 'game',
            dateien: JSON.stringify(['game/.doorstop_version', 'game/BepInEx/core/BepInEx.pdb']) });
        stelleThunderstore([{ ...BEPINEX, fassung: '5.4.2200' }]);
        await InhalteHolen.installiere({ server: SERVER, inhalt: INHALT, guildId: 'g1',
            kennung: 'denikson-BepInExPack_Valheim' });
        assert.deepStrictEqual(daemon.geloescht,
            ['/game/.doorstop_version', '/game/BepInEx/core/BepInEx.pdb'],
            'die Dateien der alten Fassung muessen VOR dem Holen weg');
        assert.strictEqual(db.zeilen[0].fassung, '5.4.2200');
    });

    await pruefe('Dieselbe Fassung raeumt NICHT auf', async () => {
        db.zeilen.push({ id: 1, server_id: 186, quelle: 'thunderstore', art: 'loader',
            kennung: 'denikson-BepInExPack_Valheim', fassung: '5.4.2333', status: 'installiert',
            ablage: 'game', dateien: JSON.stringify(['game/.doorstop_version']) });
        stelleThunderstore([BEPINEX]);
        await InhalteHolen.installiere({ server: SERVER, inhalt: INHALT, guildId: 'g1',
            kennung: 'denikson-BepInExPack_Valheim' });
        assert.deepStrictEqual(daemon.geloescht, [],
            'ohne Fassungswechsel gibt es nichts zu entfernen');
    });

    await pruefe('Die Abhaengigkeit liegt VOR dem Mod', async () => {
        stelleThunderstore([BEPINEX, JOTUNN]);
        await InhalteHolen.installiere({ server: SERVER, inhalt: INHALT, guildId: 'g1',
            kennung: 'ValheimModding-Jotunn' });
        assert.deepStrictEqual(db.zeilen.map(z => z.reihenfolge), [0, 1]);
        assert.match(daemon.abrufe[0].adresse, /BepInExPack/);
    });

    await pruefe('Die geschriebenen Dateien werden aufgehoben', async () => {
        stelleThunderstore([JOTUNN]);
        await InhalteHolen.installiere({ server: SERVER, inhalt: INHALT, guildId: 'g1',
            kennung: 'ValheimModding-Jotunn' });
        assert.deepStrictEqual(JSON.parse(db.zeilen[0].dateien),
            ['game/BepInEx/plugins/A.dll', 'game/BepInEx/plugins/B.dll']);
        assert.strictEqual(db.zeilen[0].status, 'installiert');
    });

    await pruefe('Ein Fehlschlag hinterlaesst eine Zeile mit Grund', async () => {
        stelleThunderstore([JOTUNN]);
        daemon.scheitern.add(JOTUNN.adresse);
        const e = await InhalteHolen.installiere({ server: SERVER, inhalt: INHALT, guildId: 'g1',
            kennung: 'ValheimModding-Jotunn' });
        assert.strictEqual(e.fehlgeschlagen.length, 1);
        assert.strictEqual(db.zeilen[0].status, 'fehlgeschlagen');
        assert.match(db.zeilen[0].fehler, /herkunft/);
    });

    await pruefe('Ohne loader.path bleibt der Lader in der Wurzel', async () => {
        // Rueckwaertsvertraeglich: Ein Spiel, das AUS der Volume-Wurzel startet,
        // braucht den Lader auch dort. Das Feld sagt es, es raet niemand.
        stelleThunderstore([BEPINEX]);
        const ohnePfad = { ...INHALT, loader: { ...INHALT.loader, path: undefined } };
        await InhalteHolen.installiere({ server: SERVER, inhalt: ohnePfad, guildId: 'g1',
            kennung: 'denikson-BepInExPack_Valheim' });
        assert.strictEqual(daemon.abrufe[0].ziel, '');
    });

    await pruefe('Ohne Thunderstore im Paket gibt es keine Installation', async () => {
        stelleThunderstore([JOTUNN]);
        await assert.rejects(
            InhalteHolen.installiere({ server: SERVER, inhalt: { ...INHALT, sources: ['upload'] },
                guildId: 'g1', kennung: 'ValheimModding-Jotunn' }),
            /Thunderstore nicht als Quelle/);
        assert.strictEqual(daemon.abrufe.length, 0);
    });

    console.log('\nVorgemerkt beim Anlegen');

    await pruefe('Geplante Zeilen werden nach der Grundinstallation geholt', async () => {
        stelleThunderstore([JOTUNN]);
        db.zeilen.push({ id: 1, server_id: 186, quelle: 'thunderstore', art: 'mod',
            kennung: 'ValheimModding-Jotunn', fassung: null, status: 'geplant', reihenfolge: 0 });
        const e = await InhalteHolen.holeGeplante({ server: SERVER, inhalt: INHALT, guildId: 'g1' });
        assert.strictEqual(e.installiert.length, 1);
        assert.strictEqual(db.zeilen[0].status, 'installiert');
    });

    await pruefe('Ohne Vorgemerktes passiert nichts', async () => {
        stelleThunderstore([JOTUNN]);
        assert.strictEqual(
            await InhalteHolen.holeGeplante({ server: SERVER, inhalt: INHALT, guildId: 'g1' }), null);
        assert.strictEqual(daemon.abrufe.length, 0);
    });

    console.log('\nEntfernen');

    await pruefe('Geloescht wird die Liste, nicht der Zielordner', async () => {
        const zeile = { art: 'mod', ablage: 'BepInEx/plugins',
            dateien: JSON.stringify(['BepInEx/plugins/Jotunn.dll', 'BepInEx/plugins/Jotunn.xml']) };
        const weg = await InhalteHolen.entferneDateien({ server: SERVER, zeile, inhalt: INHALT });
        assert.strictEqual(weg.weg, 2);
        assert.deepStrictEqual(daemon.geloescht,
            ['/BepInEx/plugins/Jotunn.dll', '/BepInEx/plugins/Jotunn.xml']);
    });

    await pruefe('Eine Altzeile ohne Liste loescht NICHTS', async () => {
        const zeile = { art: 'mod', ablage: 'BepInEx/plugins', dateien: null };
        const weg = await InhalteHolen.entferneDateien({ server: SERVER, zeile, inhalt: INHALT });
        assert.strictEqual(weg.ohneListe, true);
        assert.deepStrictEqual(daemon.geloescht, [], 'der ganze Ordner haette alle Mods mitgenommen');
    });

    await pruefe('Eine Altzeile mit EINER Datei loescht diese', async () => {
        const zeile = { art: 'mod', ablage: 'BepInEx/plugins/Alt.dll', dateien: null };
        const weg = await InhalteHolen.entferneDateien({ server: SERVER, zeile, inhalt: INHALT });
        assert.strictEqual(weg.weg, 1);
        assert.deepStrictEqual(daemon.geloescht, ['/BepInEx/plugins/Alt.dll']);
    });

    console.log('\nAktualisieren');

    await pruefe('Erst die alten Dateien weg, dann die neue Fassung', async () => {
        stelleThunderstore([{ ...JOTUNN, fassung: '2.30.0' }], { ...JOTUNN, fassung: '2.30.0' });
        const zeile = { id: 1, art: 'mod', kennung: 'ValheimModding-Jotunn', fassung: '2.29.2',
            ablage: 'BepInEx/plugins', dateien: JSON.stringify(['BepInEx/plugins/Jotunn.dll']) };
        const e = await InhalteHolen.aktualisiere({ server: SERVER, inhalt: INHALT, guildId: 'g1', zeile });
        assert.strictEqual(e.geaendert, true);
        assert.strictEqual(e.vorher, '2.29.2');
        assert.strictEqual(e.nachher, '2.30.0');
        assert.deepStrictEqual(daemon.geloescht, ['/BepInEx/plugins/Jotunn.dll']);
        assert.strictEqual(daemon.abrufe.length, 1);
    });

    await pruefe('Ist nichts Neueres da, passiert nichts', async () => {
        stelleThunderstore([JOTUNN], JOTUNN);
        const zeile = { id: 1, art: 'mod', kennung: 'ValheimModding-Jotunn', fassung: '2.29.2',
            dateien: JSON.stringify(['BepInEx/plugins/Jotunn.dll']) };
        const e = await InhalteHolen.aktualisiere({ server: SERVER, inhalt: INHALT, guildId: 'g1', zeile });
        assert.strictEqual(e.geaendert, false);
        assert.deepStrictEqual(daemon.geloescht, [], 'nichts anfassen, wenn nichts neu ist');
        assert.strictEqual(daemon.abrufe.length, 0);
    });

    // ── Die Routen: ist der Weg wirklich verdrahtet? ────────────────────────
    //
    // Ein Helfer ohne Aufrufer faellt nicht auf — bis ihn jemand braucht.
    console.log('\nRouten');

    const router = require(path.join(__dirname, '../plugins/gameserver/dashboard/routes/inhalte.js'));
    function handlerFuer(methode, pfad) {
        const schicht = router.stack.find(l => l.route && l.route.path === pfad && l.route.methods[methode]);
        assert.ok(schicht, `Route ${methode.toUpperCase()} ${pfad} fehlt`);
        return schicht.route.stack[schicht.route.stack.length - 1].handle;
    }
    async function rufe(methode, pfad, { params = {}, query = {}, body = {} } = {}) {
        let status = 200, antwort = null;
        const res = {
            locals: { guildId: 'g1' },
            status(s) { status = s; return this; },
            json(o) { antwort = o; return this; },
        };
        await handlerFuer(methode, pfad)({ params: { serverId: '186', ...params }, query, body }, res);
        return { status, antwort };
    }

    await pruefe('Suche liefert die Treffer des Spiels', async () => {
        Thunderstore.suche = async (gemeinschaft, begriff) => {
            assert.strictEqual(gemeinschaft, 'valheim', 'die Gemeinschaft kommt aus dem Paket');
            assert.strictEqual(begriff, 'jotunn');
            return { treffer: [{ kennung: 'ValheimModding-Jotunn', name: 'Jotunn' }],
                     gesamt: 19, seite: 1, weiter: false, zurueck: false, proSeite: 20 };
        };
        const r = await rufe('get', '/:serverId/inhalte/suche', { query: { q: 'jotunn' } });
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.antwort.treffer.length, 1);
        assert.strictEqual(r.antwort.lader, 'denikson-BepInExPack_Valheim');
    });

    await pruefe('Die Vorschau zeigt den Lader als das, was er ist', async () => {
        stelleThunderstore([BEPINEX, JOTUNN]);
        const r = await rufe('get', '/:serverId/inhalte/vorschau',
            { query: { kennung: 'ValheimModding-Jotunn' } });
        assert.strictEqual(r.status, 200);
        assert.deepStrictEqual(r.antwort.pakete.map(p => p.art), ['loader', 'mod']);
        assert.strictEqual(r.antwort.pakete[0].schonDa, false);
    });

    await pruefe('Installieren ueber die Route legt beide ab', async () => {
        stelleThunderstore([BEPINEX, JOTUNN]);
        const r = await rufe('post', '/:serverId/inhalte/thunderstore',
            { body: { kennung: 'ValheimModding-Jotunn' } });
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.antwort.installiert.length, 2);
        assert.strictEqual(r.antwort.neustartNoetig, true);
        assert.strictEqual(daemon.abrufe.length, 2);
    });

    await pruefe('Ohne kennung gibt es eine Absage, keinen Abruf', async () => {
        stelleThunderstore([JOTUNN]);
        const r = await rufe('post', '/:serverId/inhalte/thunderstore', { body: {} });
        assert.strictEqual(r.status, 400);
        assert.strictEqual(daemon.abrufe.length, 0);
    });

    await pruefe('Aktualisierungen fragen nur das Installierte ab', async () => {
        db.zeilen.push({ id: 7, quelle: 'thunderstore', kennung: 'ValheimModding-Jotunn',
            fassung: '2.29.2', status: 'installiert', art: 'mod' });
        db.zeilen.push({ id: 8, quelle: 'thunderstore', kennung: 'Irgendwas-Geplant',
            fassung: null, status: 'geplant', art: 'mod' });
        Thunderstore.aktualisierungen = async (zeilen) => {
            assert.deepStrictEqual(zeilen.map(z => z.id), [7], 'nur installierte Zeilen');
            return [{ id: 7, kennung: 'ValheimModding-Jotunn', installiert: '2.29.2',
                      neueste: '2.30.0', neuer: true }];
        };
        const r = await rufe('get', '/:serverId/inhalte/aktualisierungen');
        assert.strictEqual(r.antwort.stand[0].neuer, true);
    });

    await pruefe('Entfernen loescht die Liste, nicht den Ordner', async () => {
        db.zeilen.push({ id: 9, server_id: 186, quelle: 'thunderstore', art: 'mod',
            kennung: 'ValheimModding-Jotunn', fassung: '2.29.2', status: 'installiert',
            ablage: 'BepInEx/plugins',
            dateien: JSON.stringify(['BepInEx/plugins/Jotunn.dll']) });
        const r = await rufe('delete', '/:serverId/inhalte/:id', { params: { id: '9' } });
        assert.strictEqual(r.status, 200);
        assert.deepStrictEqual(daemon.geloescht, ['/BepInEx/plugins/Jotunn.dll']);
        assert.strictEqual(db.zeilen.find(z => z.id === 9).status, 'entfernt');
    });

    // ── Die Seite, auf die man verweisen kann ───────────────────────────────
    console.log('\nAdressen');

    const Inhalte = require(path.join(HELFER, 'Inhalte.js'));

    await pruefe('Die Adresse traegt das SPIEL im Pfad', async () => {
        assert.strictEqual(
            Inhalte.paketAdresse({ quelle: 'thunderstore', kennung: 'ValheimModding-Jotunn' }, 'valheim'),
            'https://thunderstore.io/c/valheim/p/ValheimModding/Jotunn/');
        // Ohne Gemeinschaft KEINE Adresse: Die naheliegende Form
        // thunderstore.io/package/<ns>/<name>/ leitet auf die Gemeinschaft um,
        // in der das Paket zuerst erschien — bei Jotunn auf riskofrain2
        // (gemessen am 2026-09-12).
        assert.strictEqual(
            Inhalte.paketAdresse({ quelle: 'thunderstore', kennung: 'ValheimModding-Jotunn' }, null), null);
    });

    await pruefe('Eine hochgeladene Datei hat keine Seite', async () => {
        assert.strictEqual(
            Inhalte.paketAdresse({ quelle: 'upload', kennung: 'MeinMod.dll' }, 'valheim'), null);
    });

    await pruefe('Suche ohne Begriff heisst stoebern — mit Adressen', async () => {
        Thunderstore.suche = async (gemeinschaft, begriff) => {
            assert.strictEqual(begriff, '', 'leer heisst leer, nicht undefined');
            return { treffer: [{ kennung: 'ValheimModding-Jotunn', name: 'Jotunn', downloads: 4152121 }],
                     gesamt: 5746, seite: 1, weiter: true, zurueck: false, proSeite: 20 };
        };
        const r = await rufe('get', '/:serverId/inhalte/suche', { query: {} });
        assert.strictEqual(r.antwort.gestoebert, true, 'ohne Begriff wird gestoebert');
        assert.strictEqual(r.antwort.treffer[0].url,
            'https://thunderstore.io/c/valheim/p/ValheimModding/Jotunn/');
    });

    await pruefe('Die Liste eines Servers traegt die Adressen mit', async () => {
        db.zeilen.push({ id: 3, server_id: 186, art: 'mod', quelle: 'thunderstore',
            kennung: 'ValheimModding-Jotunn', fassung: '2.30.0', status: 'installiert', aktiv: 1 });
        const r = await rufe('get', '/:serverId/inhalte');
        assert.strictEqual(r.antwort.gemeinschaft, 'valheim');
        assert.strictEqual(r.antwort.mods[0].url,
            'https://thunderstore.io/c/valheim/p/ValheimModding/Jotunn/');
    });

    await pruefe('Der Umfang und die Seite gehen an die Ansicht', async () => {
        // Ohne diese Zahlen blaettert man blind: 5746 Mods bei Valheim, 20 je
        // Seite. Die Quelle sagt es (`count`/`next`), ein eigener Katalog waere
        // 162 MB und taeglich veraltet.
        Thunderstore.suche = async (gemeinschaft, begriff, optionen) => {
            assert.strictEqual(optionen.seite, '3', 'die gewuenschte Seite kommt durch');
            return { treffer: [], gesamt: 5746, seite: 3, weiter: true, zurueck: true, proSeite: 20 };
        };
        const r = await rufe('get', '/:serverId/inhalte/suche', { query: { seite: '3' } });
        assert.strictEqual(r.antwort.gesamt, 5746);
        assert.strictEqual(r.antwort.seiten, 288, '5746 / 20, aufgerundet');
        assert.strictEqual(r.antwort.weiter, true);
        assert.strictEqual(r.antwort.zurueck, true);
        assert.strictEqual(r.antwort.verzeichnis, 'https://thunderstore.io/c/valheim/');
    });

    // ── Verdrahtung: haengt der Abruf an einem Ereignis, das ankommt? ───────
    //
    // Am 2026-09-12 tat er das NICHT: Der Aufruf sass in
    // `_handleInstallCompleted`, einer Methode ohne Aufrufer. Der Daemon meldete
    // „Installation abgeschlossen", und beide Mod-Zeilen blieben auf `geplant`.
    // Genau dieser Fehler ist von aussen unsichtbar — deshalb steht er hier.
    console.log('\nVerdrahtung');

    const fs = require('fs');
    const ohneKommentare = (text) => text
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n').map(z => z.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');
    const plugin = ohneKommentare(fs.readFileSync(
        path.join(__dirname, '../plugins/gameserver/dashboard/index.js'), 'utf8'));

    await pruefe('Der Abruf haengt an einem REGISTRIERTEN Ereignis', async () => {
        const block = plugin.match(
            /eventRouter\.register\(\s*MessageTypes\.NS_INSTALL,\s*MessageTypes\.INSTALL_COMPLETED,[\s\S]{0,500}?\{\s*priority/);
        assert.ok(block, 'keine Registrierung fuer install/completed gefunden');
        assert.match(block[0], /_holeVorgemerkteMods/,
            'die Registrierung ruft den Abruf nicht auf');
    });

    await pruefe('Daneben liegt kein Handler ohne Aufrufer', async () => {
        assert.ok(!/_handleInstallCompleted/.test(plugin),
            '_handleInstallCompleted ist wieder da — sie wird nirgends registriert, '
            + 'und was darin steht, laeuft nie');
    });

    await pruefe('Vorgemerktes laesst sich von Hand nachholen', async () => {
        stelleThunderstore([JOTUNN]);
        db.zeilen.push({ id: 1, server_id: 186, quelle: 'thunderstore', art: 'mod',
            kennung: 'ValheimModding-Jotunn', fassung: null, status: 'geplant', reihenfolge: 0 });
        const r = await rufe('post', '/:serverId/inhalte/geplant-holen');
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.antwort.installiert.length, 1);
        assert.strictEqual(db.zeilen[0].status, 'installiert');
    });

    await pruefe('Ohne Vorgemerktes sagt die Route das, statt zu schweigen', async () => {
        const r = await rufe('post', '/:serverId/inhalte/geplant-holen');
        assert.strictEqual(r.antwort.nichts, true);
        assert.strictEqual(daemon.abrufe.length, 0);
    });

    // ── Rueckmeldung: Toasts und der Neustart-Hinweis (2026-09-13) ──────────
    //
    // Mods laedt das Spiel beim START. Wer im laufenden Betrieb installiert oder
    // entfernt, sieht im Spiel nichts, bis der Server neu startet — und der
    // Reiter sagte das nur in zwei von fuenf Wegen, ueber Browser-Dialoge, ohne
    // zu wissen, ob der Server gerade laeuft (Betreiber, 2026-09-13).
    console.log('\nRueckmeldung');

    const reiter = ohneKommentare(fs.readFileSync(path.join(__dirname,
        '../plugins/gameserver/dashboard/views/guild/partials/server-detail-inhalte.ejs'), 'utf8'));
    const JOTUNN_ZEILE = () => ({ id: 9, server_id: 186, quelle: 'thunderstore', art: 'mod',
        kennung: 'ValheimModding-Jotunn', fassung: '2.30.0', status: 'installiert', aktiv: 1,
        dateien: JSON.stringify(['game/BepInEx/plugins/Jotunn.dll']) });

    await pruefe('Der Reiter meldet ueber das Toast-System, nicht ueber Browser-Dialoge', async () => {
        const dialoge = reiter.match(/\balert\s*\(/g) || [];
        assert.strictEqual(dialoge.length, 0, `${dialoge.length} Browser-Dialog(e) im Mods-Reiter`);
        assert.match(reiter, /showToast\(/, 'kein showToast im Reiter');
    });

    await pruefe('Entfernen bei laufendem Server: Neustart noetig', async () => {
        db.zeilen.push(JOTUNN_ZEILE());
        const r = await rufe('delete', '/:serverId/inhalte/:id', { params: { id: '9' } });
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.antwort.laeuft, true);
        assert.strictEqual(r.antwort.neustartNoetig, true);
    });

    await pruefe('Gestoppter Server: wirkt beim naechsten Start', async () => {
        db.serverStatus = 'offline';
        db.zeilen.push(JOTUNN_ZEILE());
        const r = await rufe('delete', '/:serverId/inhalte/:id', { params: { id: '9' } });
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.antwort.laeuft, false, 'offline darf nicht als laufend gelten');
        assert.strictEqual(r.antwort.neustartNoetig, true);
    });

    await pruefe('Schalten sagt es auch — und meldet einen Fehlschlag', async () => {
        db.zeilen.push(JOTUNN_ZEILE());
        let r = await rufe('post', '/:serverId/inhalte/:id/schalten',
            { params: { id: '9' }, body: { aktiv: false } });
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.antwort.laeuft, true);
        assert.strictEqual(db.zeilen[0].aktiv, 0);
        r = await rufe('post', '/:serverId/inhalte/:id/schalten',
            { params: { id: '77' }, body: { aktiv: true } });
        assert.strictEqual(r.status, 404);
    });

    await pruefe('Installieren sagt es auch', async () => {
        stelleThunderstore([BEPINEX, JOTUNN]);
        const r = await rufe('post', '/:serverId/inhalte/thunderstore',
            { body: { kennung: 'ValheimModding-Jotunn' } });
        assert.strictEqual(r.status, 200, JSON.stringify(r.antwort));
        assert.strictEqual(r.antwort.installiert.length, 2);
        assert.strictEqual(r.antwort.laeuft, true);
        assert.strictEqual(r.antwort.neustartNoetig, true);
    });

    Object.assign(Thunderstore, ECHT);
    console.log(`\n${bestanden} Pruefung(en) bestanden.\n`);
})();
