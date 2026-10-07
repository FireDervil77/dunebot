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
            const [serverId, guildId, art, quelle, kennung, name, fassung, veroeffentlicht,
                   reihenfolge, ablage, dateien, clientSide, status, fehler] = params;
            const da = this.zeilen.find(z => z.kennung === kennung && z.quelle === quelle);
            const zeile = da || { id: this.zeilen.length + 1, server_id: serverId, quelle, kennung };
            Object.assign(zeile, { guild_id: guildId, art, name, fassung, veroeffentlicht, reihenfolge,
                ablage, dateien, client_side: clientSide, status, fehler });
            if (!da) this.zeilen.push(zeile);
            return { insertId: da ? 0 : zeile.id };
        }
        if (/SELECT id FROM gameserver_content WHERE server_id = \? AND quelle = \? AND kennung = \?/.test(sql)) {
            const z = this.zeilen.find(x => x.kennung === params[2]);
            return z ? [z] : [];
        }
        // Vorgemerkte Zeilen — seit dem 2026-09-14 mit ihrer Quelle und auf die
        // bekannten Anbieter eingegrenzt.
        if (/SELECT id, kennung, fassung, quelle FROM gameserver_content/.test(sql)) {
            return this.zeilen.filter(z => z.status === 'geplant');
        }
        // Der Aktualisierungsstand — installierte Zeilen aller Kataloge.
        if (/SELECT id, kennung, fassung, quelle,\s+DATE_FORMAT/.test(sql)) {
            return this.zeilen.filter(z => z.status === 'installiert');
        }
        if (/FROM gameservers WHERE id = \? AND guild_id = \?/.test(sql)) {
            return [{ id: 186, name: 'Bude', guild_id: 'g1', rootserver_id: 55,
                      install_path: '186-valheim', addon_marketplace_id: 173, status: this.serverStatus || 'online' }];
        }
        // Zwei Fragen seit dem 2026-10-07 (Baustelle 172): das Paket eines
        // bestehenden Servers (über gameservers, nach seinem Kanal) und das Paket
        // beim Anlegen (über packages) — die Modsuche stellt die zweite.
        if (/FROM gameservers gs\s+JOIN packages pk/.test(sql) || /FROM packages pk\s+LEFT JOIN package_versions pv/.test(sql)) {
            return [{ paket_slug: 'valheim', paket_version: '1.0.10', paket_channel: 'test',
                      paket_json: JSON.stringify({ identity: { slug: 'valheim' }, content: INHALT }) }];
        }
        if (/SELECT \*(, DATE_FORMAT)?[\s\S]*?FROM gameserver_content\s+WHERE id = \? AND server_id = \?/.test(sql)
            || /SELECT \* FROM gameserver_content WHERE id = \? AND server_id = \?/.test(sql)) {
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
    gelistet: [], gelesen: [], logInhalt: '', logFehlt: false,
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
        if (befehl === 'gameserver.files.list') {
            this.gelistet.push(nutzlast.path);
            return { success: true, data: { files: this.logFehlt ? [] : [
                { name: 'LogOutput.log', is_dir: false, size: this.logInhalt.length, mod_time: '2026-09-13T14:26:42Z' }] } };
        }
        if (befehl === 'gameserver.files.read') {
            this.gelesen.push(nutzlast.path);
            // Wie `HandleFileRead` im Daemon: immer Base64 (Baustelle 135).
            return { success: true, data: { content: Buffer.from(this.logInhalt, 'utf8').toString('base64') } };
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
    // Seit dem 2026-09-14 hat jeder Anbieter dieselbe Signatur
    // (raum, kennung, fassung) — die Attrappe muss sie mitsprechen, sonst
    // prueft sie einen Weg, den es nicht mehr gibt.
    Thunderstore.aufloesen = async (raum, kennung, fassung) => ({ pakete, fehlend: [] });
    Thunderstore.paket = async (raum, kennung) => neueste || pakete[pakete.length - 1];
}

const SERVER = { id: 186, rootserver_id: 55, install_path: '186-valheim' };

const BEPINEX = { kennung: 'denikson-BepInExPack_Valheim', name: 'BepInExPack_Valheim',
                  fassung: '5.4.2333', adresse: 'https://thunderstore.io/package/download/denikson/BepInExPack_Valheim/5.4.2333/', bytes: 1 };
// Die Erscheinungstage sind bei Thunderstore abgefragt (2026-09-14), nicht
// erfunden: Jotunn 2.29.2 → 13.07.2026, TeleportEverything 2.9.1 → 08.02.2026.
const JOTUNN  = { kennung: 'ValheimModding-Jotunn', name: 'Jotunn', fassung: '2.29.2',
                  adresse: 'https://thunderstore.io/package/download/ValheimModding/Jotunn/2.29.2/', bytes: 1,
                  veroeffentlicht: '2026-07-13T05:41:39.807962Z' };

let bestanden = 0;
async function pruefe(name, fn) {
    db.zeilen = []; daemon.abrufe = []; daemon.geloescht = []; daemon.scheitern = new Set(); db.serverStatus = null;
    daemon.gelistet = []; daemon.gelesen = []; daemon.logInhalt = ''; daemon.logFehlt = false;
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
            server: SERVER, inhalt: INHALT, guildId: 'g1', quelle: 'thunderstore', kennung: 'ValheimModding-Jotunn' });
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
    // Seit dem 2026-09-13 wird der gewaehlte Lader nicht mehr herabgestuft —
    // der Fassungswechsel, an dem hier das Aufraeumen geprueft wird, ist deshalb
    // ein HOCHstufen. Die Waisen von 189 entstanden beim Herabstufen.
    await pruefe('Eine andere Fassung raeumt erst auf', async () => {
        db.zeilen.push({ id: 1, server_id: 186, quelle: 'thunderstore', art: 'loader',
            kennung: 'denikson-BepInExPack_Valheim', fassung: '5.4.2200', status: 'installiert',
            ablage: 'game',
            dateien: JSON.stringify(['game/.doorstop_version', 'game/BepInEx/core/BepInEx.pdb']) });
        stelleThunderstore([BEPINEX]);
        await InhalteHolen.installiere({ server: SERVER, inhalt: INHALT, guildId: 'g1',
            quelle: 'thunderstore', kennung: 'denikson-BepInExPack_Valheim' });
        assert.deepStrictEqual(daemon.geloescht,
            ['/game/.doorstop_version', '/game/BepInEx/core/BepInEx.pdb'],
            'die Dateien der alten Fassung muessen VOR dem Holen weg');
        assert.strictEqual(db.zeilen[0].fassung, '5.4.2333');
    });

    await pruefe('Dieselbe Fassung raeumt NICHT auf', async () => {
        db.zeilen.push({ id: 1, server_id: 186, quelle: 'thunderstore', art: 'loader',
            kennung: 'denikson-BepInExPack_Valheim', fassung: '5.4.2333', status: 'installiert',
            ablage: 'game', dateien: JSON.stringify(['game/.doorstop_version']) });
        stelleThunderstore([BEPINEX]);
        await InhalteHolen.installiere({ server: SERVER, inhalt: INHALT, guildId: 'g1',
            quelle: 'thunderstore', kennung: 'denikson-BepInExPack_Valheim' });
        assert.deepStrictEqual(daemon.geloescht, [],
            'ohne Fassungswechsel gibt es nichts zu entfernen');
    });

    // ── Der Lader wird nie herabgestuft, wenn er gewaehlt ist ──────────────
    //
    // Betreiber, 2026-09-13. Anlass: TeleportEverything verlangte BepInEx
    // 5.4.2200 und zog das installierte 5.4.2333 fuer alle Mods herunter.
    console.log('\nLader-Regel');

    const LADER_ZEILE = (fassung, status = 'installiert') => ({ id: 1, server_id: 186,
        quelle: 'thunderstore', art: 'loader', kennung: 'denikson-BepInExPack_Valheim',
        fassung, status, ablage: 'game', dateien: JSON.stringify(['game/BepInEx/core/BepInEx.dll']) });
    const geholt = () => daemon.abrufe.map(a => a.adresse.match(/download\/[^/]+\/([^/]+)/)[1]);

    await pruefe('Ein Mod mit aelterer Lader-Angabe stuft den Lader nicht herab', async () => {
        db.zeilen.push(LADER_ZEILE('5.4.2350'));
        stelleThunderstore([{ ...BEPINEX, fassung: '5.4.2200' }, JOTUNN]);
        const e = await InhalteHolen.installiere({ server: SERVER, inhalt: INHALT, guildId: 'g1',
            quelle: 'thunderstore', kennung: 'ValheimModding-Jotunn' });
        assert.deepStrictEqual(geholt(), ['Jotunn'], 'nur der Mod wird geholt, nicht der aeltere Lader');
        assert.deepStrictEqual(daemon.geloescht, [], 'am Lader wird nichts geloescht');
        assert.strictEqual(db.zeilen.find(z => z.art === 'loader').fassung, '5.4.2350');
        assert.deepStrictEqual(e.beibehalten,
            [{ kennung: 'denikson-BepInExPack_Valheim', fassung: '5.4.2350', verlangt: '5.4.2200' }]);
        assert.strictEqual(e.installiert.length, 1);
    });

    await pruefe('Hochstufen bleibt erlaubt', async () => {
        db.zeilen.push(LADER_ZEILE('5.4.2200'));
        stelleThunderstore([BEPINEX, JOTUNN]);
        const e = await InhalteHolen.installiere({ server: SERVER, inhalt: INHALT, guildId: 'g1',
            quelle: 'thunderstore', kennung: 'ValheimModding-Jotunn' });
        assert.deepStrictEqual(geholt(), ['BepInExPack_Valheim', 'Jotunn']);
        assert.strictEqual(db.zeilen.find(z => z.art === 'loader').fassung, '5.4.2333');
        assert.deepStrictEqual(e.beibehalten, []);
    });

    await pruefe('Auch ein vorgemerkter Lader wird nicht herabgestuft', async () => {
        db.zeilen.push(LADER_ZEILE('5.4.2350', 'geplant'));
        stelleThunderstore([{ ...BEPINEX, fassung: '5.4.2200' }, JOTUNN]);
        const e = await InhalteHolen.installiere({ server: SERVER, inhalt: INHALT, guildId: 'g1',
            quelle: 'thunderstore', kennung: 'ValheimModding-Jotunn' });
        assert.deepStrictEqual(geholt(), ['Jotunn']);
        assert.strictEqual(e.beibehalten.length, 1);
    });

    await pruefe('Ein fehlgeschlagener Lader ist nicht gewaehlt — er wird geholt', async () => {
        db.zeilen.push(LADER_ZEILE('5.4.2350', 'fehlgeschlagen'));
        stelleThunderstore([{ ...BEPINEX, fassung: '5.4.2200' }, JOTUNN]);
        const e = await InhalteHolen.installiere({ server: SERVER, inhalt: INHALT, guildId: 'g1',
            quelle: 'thunderstore', kennung: 'ValheimModding-Jotunn' });
        assert.deepStrictEqual(geholt(), ['BepInExPack_Valheim', 'Jotunn']);
        assert.deepStrictEqual(e.beibehalten, []);
    });

    await pruefe('Die Vorschau sagt dasselbe: bleibt, nicht ersetzt', async () => {
        db.zeilen.push(LADER_ZEILE('5.4.2350'));
        stelleThunderstore([{ ...BEPINEX, fassung: '5.4.2200' }, JOTUNN]);
        let v = await InhalteHolen.vorschau({ serverId: 186, inhalt: INHALT, quelle: 'thunderstore', kennung: 'ValheimModding-Jotunn' });
        assert.strictEqual(v.pakete[0].bleibt, true, 'aelterer Lader: bleibt');
        assert.strictEqual(v.pakete[1].bleibt, false, 'ein Mod faellt nie unter die Regel');
        stelleThunderstore([{ ...BEPINEX, fassung: '5.4.2400' }, JOTUNN]);
        v = await InhalteHolen.vorschau({ serverId: 186, inhalt: INHALT, quelle: 'thunderstore', kennung: 'ValheimModding-Jotunn' });
        assert.strictEqual(v.pakete[0].bleibt, false, 'neuerer Lader: wird ersetzt');
    });

    await pruefe('Der Reiter zeigt es an — in der Vorschau und als Toast', async () => {
        const text = require('fs').readFileSync(path.join(__dirname,
            '../plugins/gameserver/dashboard/views/guild/partials/server-detail-inhalte.ejs'), 'utf8');
        assert.match(text, /p\.bleibt \?/, 'die Vorschau kennt "bleibt" nicht');
        assert.match(text, /d\.beibehalten/, 'der Toast meldet den beibehaltenen Lader nicht');
    });

    await pruefe('Die Abhaengigkeit liegt VOR dem Mod', async () => {
        stelleThunderstore([BEPINEX, JOTUNN]);
        await InhalteHolen.installiere({ server: SERVER, inhalt: INHALT, guildId: 'g1',
            quelle: 'thunderstore', kennung: 'ValheimModding-Jotunn' });
        assert.deepStrictEqual(db.zeilen.map(z => z.reihenfolge), [0, 1]);
        assert.match(daemon.abrufe[0].adresse, /BepInExPack/);
    });

    await pruefe('Die geschriebenen Dateien werden aufgehoben', async () => {
        stelleThunderstore([JOTUNN]);
        await InhalteHolen.installiere({ server: SERVER, inhalt: INHALT, guildId: 'g1',
            quelle: 'thunderstore', kennung: 'ValheimModding-Jotunn' });
        assert.deepStrictEqual(JSON.parse(db.zeilen[0].dateien),
            ['game/BepInEx/plugins/A.dll', 'game/BepInEx/plugins/B.dll']);
        assert.strictEqual(db.zeilen[0].status, 'installiert');
    });

    await pruefe('Ein Fehlschlag hinterlaesst eine Zeile mit Grund', async () => {
        stelleThunderstore([JOTUNN]);
        daemon.scheitern.add(JOTUNN.adresse);
        const e = await InhalteHolen.installiere({ server: SERVER, inhalt: INHALT, guildId: 'g1',
            quelle: 'thunderstore', kennung: 'ValheimModding-Jotunn' });
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
            quelle: 'thunderstore', kennung: 'denikson-BepInExPack_Valheim' });
        assert.strictEqual(daemon.abrufe[0].ziel, '');
    });

    await pruefe('Was das Paket nicht nennt, wird nicht geholt', async () => {
        stelleThunderstore([JOTUNN]);
        // Verlangt, aber nicht im Paket: abgewiesen, und die Absage nennt ihn.
        await assert.rejects(
            InhalteHolen.installiere({ server: SERVER, inhalt: { ...INHALT, sources: ['upload'] },
                guildId: 'g1', quelle: 'thunderstore', kennung: 'ValheimModding-Jotunn' }),
            /thunderstore nicht als Quelle/);
        // Und ohne Angabe faellt nichts still auf irgendeinen Anbieter zurueck.
        await assert.rejects(
            InhalteHolen.installiere({ server: SERVER, inhalt: { ...INHALT, sources: ['upload'] },
                guildId: 'g1', kennung: 'ValheimModding-Jotunn' }),
            /keine Quelle/);
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
        assert.strictEqual(weg.bestaetigt, 2);
        assert.strictEqual(weg.gesamt, 2);
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
        assert.strictEqual(weg.bestaetigt, 1);
        assert.deepStrictEqual(daemon.geloescht, ['/BepInEx/plugins/Alt.dll']);
    });

    // ── Die Zahl zaehlt Bestaetigungen, keine Dateien (gemessen 2026-09-14) ─
    //
    // `os.RemoveAll` im Daemon gibt bei einem fehlenden Pfad `nil` zurueck — ein
    // Loeschauftrag fuer eine Datei, die es nicht gibt, kommt als Erfolg
    // zurueck. Das ist fuer die Handlung richtig und fuer die Meldung eine
    // Falle: Der doppelte Aufraeumlauf vom 13.09. meldete beim zweiten Mal
    // dieselben 111 Dateien. Deshalb heisst das Feld `bestaetigt`.
    await pruefe('Ein Loeschauftrag auf eine fehlende Datei zaehlt als bestaetigt, nicht als geloescht', async () => {
        const zeile = { art: 'mod', ablage: 'BepInEx/plugins',
            dateien: JSON.stringify(['BepInEx/plugins/Weg.dll', 'BepInEx/plugins/Auch-weg.dll']) };
        const weg = await InhalteHolen.entferneDateien({ server: SERVER, zeile, inhalt: INHALT });
        // Die Attrappe antwortet wie der Daemon: Erfolg, ohne nachzusehen.
        assert.strictEqual(weg.bestaetigt, 2, 'der Daemon hat zweimal bestaetigt');
        assert.strictEqual(weg.gesamt, 2, 'gestellt wurden zwei Auftraege');
        assert.deepStrictEqual(weg.blieb, [], 'nur Ablehnungen sind hart');
        assert.strictEqual(weg.weg, undefined,
            'das alte Feld `weg` behauptete „so viele Dateien lagen da" — es darf nicht zurueckkommen');
    });

    console.log('\nAktualisieren');

    // ── Ein Weg, nicht zwei (Betreiber, 2026-09-14) ─────────────────────────
    //
    // Bis zum 2026-09-14 raeumte `aktualisiere` selbst auf UND `legeAb` gleich
    // danach noch einmal — dieselben Dateien, zwei Runden IPC, und der zweite
    // Lauf loeschte, was es nicht mehr gab. Die Zeile steht deshalb hier in der
    // Datenbank, so wie im echten Lauf: Nur dann kann `legeAb` sie ueberhaupt
    // finden, und nur dann faellt ein doppeltes Loeschen auf.
    await pruefe('Erst die alten Dateien weg, dann die neue Fassung — und das genau einmal', async () => {
        stelleThunderstore([{ ...JOTUNN, fassung: '2.30.0' }], { ...JOTUNN, fassung: '2.30.0' });
        const zeile = { id: 1, server_id: 186, quelle: 'thunderstore', art: 'mod',
            kennung: 'ValheimModding-Jotunn', fassung: '2.29.2', status: 'installiert',
            ablage: 'BepInEx/plugins', dateien: JSON.stringify(['BepInEx/plugins/Jotunn.dll']) };
        db.zeilen.push(zeile);
        const e = await InhalteHolen.aktualisiere({ server: SERVER, inhalt: INHALT, guildId: 'g1', zeile });
        assert.strictEqual(e.geaendert, true);
        assert.strictEqual(e.vorher, '2.29.2');
        assert.strictEqual(e.nachher, '2.30.0');
        assert.deepStrictEqual(daemon.geloescht, ['/BepInEx/plugins/Jotunn.dll'],
            'die alte Datei muss genau EINMAL geloescht werden');
        assert.strictEqual(daemon.abrufe.length, 1);
        // Der Toast der Karte liest diese Felder — sie kommen jetzt aus `legeAb`.
        assert.strictEqual(e.alteDateienBestaetigtWeg, 1);
        assert.deepStrictEqual(e.alteDateienBlieben, []);
        assert.strictEqual(e.ohneListe, false);
        assert.deepStrictEqual(e.aufgeraeumt.map(a => a.kennung), ['ValheimModding-Jotunn']);
    });

    await pruefe('Eine Altzeile ohne Dateiliste sagt es beim Aktualisieren', async () => {
        stelleThunderstore([{ ...JOTUNN, fassung: '2.30.0' }], { ...JOTUNN, fassung: '2.30.0' });
        const zeile = { id: 1, server_id: 186, quelle: 'thunderstore', art: 'mod',
            kennung: 'ValheimModding-Jotunn', fassung: '2.29.2', status: 'installiert',
            ablage: 'BepInEx/plugins', dateien: null };
        db.zeilen.push(zeile);
        const e = await InhalteHolen.aktualisiere({ server: SERVER, inhalt: INHALT, guildId: 'g1', zeile });
        assert.strictEqual(e.ohneListe, true, 'der Hinweis darf auf dem neuen Weg nicht verloren gehen');
        assert.deepStrictEqual(daemon.geloescht, []);
    });

    await pruefe('Ist nichts Neueres da, passiert nichts', async () => {
        stelleThunderstore([JOTUNN], JOTUNN);
        const zeile = { id: 1, art: 'mod', quelle: 'thunderstore', kennung: 'ValheimModding-Jotunn',
            fassung: '2.29.2', dateien: JSON.stringify(['BepInEx/plugins/Jotunn.dll']) };
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
        Thunderstore.suche = async (raum, begriff) => {
            assert.strictEqual(raum, 'valheim', 'die Gemeinschaft kommt aus dem Paket');
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
        const r = await rufe('post', '/:serverId/inhalte/holen',
            { body: { kennung: 'ValheimModding-Jotunn', quelle: 'thunderstore' } });
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.antwort.installiert.length, 2);
        assert.strictEqual(r.antwort.neustartNoetig, true);
        assert.strictEqual(daemon.abrufe.length, 2);
    });

    await pruefe('Ohne kennung gibt es eine Absage, keinen Abruf', async () => {
        stelleThunderstore([JOTUNN]);
        const r = await rufe('post', '/:serverId/inhalte/holen', { body: {} });
        assert.strictEqual(r.status, 400);
        assert.strictEqual(daemon.abrufe.length, 0);
    });

    await pruefe('Aktualisierungen fragen nur das Installierte ab', async () => {
        db.zeilen.push({ id: 7, quelle: 'thunderstore', kennung: 'ValheimModding-Jotunn',
            fassung: '2.29.2', status: 'installiert', art: 'mod' });
        db.zeilen.push({ id: 8, quelle: 'thunderstore', kennung: 'Irgendwas-Geplant',
            fassung: null, status: 'geplant', art: 'mod' });
        Thunderstore.aktualisierungen = async (raum, zeilen) => {
            assert.strictEqual(raum, 'valheim', 'auch hier kommt der Raum aus dem Paket');
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
        // Seit dem 2026-09-14 nennt die Liste ALLE Kataloge des Spiels mit
        // ihrem Raum — die Karte baut daraus ihre Auswahl.
        assert.deepStrictEqual(r.antwort.raeume, { thunderstore: 'valheim' });
        assert.deepStrictEqual(r.antwort.quellen,
            [{ kennung: 'thunderstore', titel: 'Thunderstore',
               raumName: 'Gemeinschaft', raum: 'valheim' }]);
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
        const r = await rufe('post', '/:serverId/inhalte/holen',
            { body: { kennung: 'ValheimModding-Jotunn', quelle: 'thunderstore' } });
        assert.strictEqual(r.status, 200, JSON.stringify(r.antwort));
        assert.strictEqual(r.antwort.installiert.length, 2);
        assert.strictEqual(r.antwort.laeuft, true);
        assert.strictEqual(r.antwort.neustartNoetig, true);
    });

    // ── Ladestand: was BepInEx beim letzten Start geladen hat (Betreiber: B) ─
    //
    // Die beiden Logs sind WOERTLICH aus echten Laeufen vom 2026-09-13 — beim
    // Schreiben dieses Waechters aus den Dateien eingelesen, nicht abgetippt:
    //   FEHLER_LOG  Kopie von Server 189 mit TeleportEverything 2.9.1 (Absturz beim Laden)
    //   SAUBER_LOG  Server 189 selbst, BepInEx 5.4.23.5 mit Jotunn 2.30.0
    console.log('\nLadestand');

    const BepInExLog = require(path.join(HELFER, 'BepInExLog.js'));
    const FEHLER_LOG = "[Message:   BepInEx] BepInEx 5.4.23.5 - valheim_server (09/12/2026 14:19:32)\n[Message:   BepInEx] User is running BepInExPack Valheim version 5.4.2350 from Thunderstore\n[Info   :   BepInEx] Running under Unity vUnknown (post-2017)\n[Info   :   BepInEx] CLR runtime version: 4.0.30319.42000\n[Info   :   BepInEx] Supports SRE: True\n[Info   :   BepInEx] System platform: Bits64, Linux\n[Message:   BepInEx] Preloader started\n[Info   :   BepInEx] Loaded 1 patcher method from [BepInEx.Preloader 5.4.23.5]\n[Info   :   BepInEx] 1 patcher plugin loaded\n[Info   :   BepInEx] Patching [UnityEngine.CoreModule] with [BepInEx.Chainloader]\n[Message:   BepInEx] Preloader finished\n[Info   :   BepInEx] Detected Unity version: v6000.0.75f1\n[Message:   BepInEx] Chainloader ready\n[Message:   BepInEx] Chainloader started\n[Info   :   BepInEx] 2 plugins to load\n[Info   :   BepInEx] Loading [Jotunn 2.30.0]\n[Info   :Jotunn.Main] Initializing ModCompatibility\n[Info   :Jotunn.Main] Initializing SynchronizationManager\n[Info   :Jotunn.Main] Initializing NetworkManager\n[Info   :   BepInEx] Loading [TeleportEverything 2.9.1]\n[Warning:  HarmonyX] AccessTools.DeclaredMethod: Could not find method for type ItemDrop+ItemData and name GetTooltip and parameters (ItemDrop+ItemData, int, bool, float, int)\n[Error  : Unity Log] ArgumentException: Undefined target method for patch method static void TeleportEverything.Plugin+GetTooltip_Patch::Postfix(ItemDrop+ItemData item, String& __result)\nStack trace:\nHarmonyLib.PatchClassProcessor.PatchWithAttributes (System.Reflection.MethodBase& lastOriginal) (at <474744d65d8e460fa08cd5fd82b5d65f>:0)\nHarmonyLib.PatchClassProcessor.Patch () (at <474744d65d8e460fa08cd5fd82b5d65f>:0)\nRethrow as HarmonyException: Patching exception in method null\nHarmonyLib.PatchClassProcessor.ReportException (System.Exception exception, System.Reflection.MethodBase original) (at <474744d65d8e460fa08cd5fd82b5d65f>:0)\nHarmonyLib.PatchClassProcessor.Patch () (at <474744d65d8e460fa08cd5fd82b5d65f>:0)\nHarmonyLib.Harmony.<PatchAll>b__11_0 (System.Type type) (at <474744d65d8e460fa08cd5fd82b5d65f>:0)\nHarmonyLib.CollectionExtensions.Do[T] (System.Collections.Generic.IEnumerable`1[T] sequence, System.Action`1[T] action) (at <474744d65d8e460fa08cd5fd82b5d65f>:0)\nHarmonyLib.Harmony.PatchAll (System.Reflection.Assembly assembly) (at <474744d65d8e460fa08cd5fd82b5d65f>:0)\nHarmonyLib.Harmony.PatchAll () (at <474744d65d8e460fa08cd5fd82b5d65f>:0)\nTeleportEverything.Plugin.Awake () (at <cda60ebd653a4bec842f096420f9dd76>:0)\nUnityEngine.GameObject:AddComponent(Type)\nBepInEx.Bootstrap.Chainloader:Start()\nUnityEngine.GameObject:.cctor()\nPlatformInitializer:EarlyInitialize()\n\n[Message:   BepInEx] Chainloader startup complete\n[Info   : Unity Log] 09/13/2026 16:38:19: Set background loading budget to Low\n\n[Info   : Unity Log] 09/13/2026 16:38:19: Loading first scene!\n";
    const SAUBER_LOG = "[Message:   BepInEx] BepInEx 5.4.23.5 - valheim_server (09/12/2026 12:19:32)\n[Message:   BepInEx] User is running BepInExPack Valheim version 5.4.2350 from Thunderstore\n[Info   :   BepInEx] Running under Unity vUnknown (post-2017)\n[Info   :   BepInEx] CLR runtime version: 4.0.30319.42000\n[Info   :   BepInEx] Supports SRE: True\n[Info   :   BepInEx] System platform: Bits64, Linux\n[Message:   BepInEx] Preloader started\n[Info   :   BepInEx] Loaded 1 patcher method from [BepInEx.Preloader 5.4.23.5]\n[Info   :   BepInEx] 1 patcher plugin loaded\n[Info   :   BepInEx] Patching [UnityEngine.CoreModule] with [BepInEx.Chainloader]\n[Message:   BepInEx] Preloader finished\n[Info   :   BepInEx] Detected Unity version: v6000.0.75f1\n[Message:   BepInEx] Chainloader ready\n[Message:   BepInEx] Chainloader started\n[Info   :   BepInEx] 1 plugin to load\n[Info   :   BepInEx] Loading [Jotunn 2.30.0]\n[Info   :Jotunn.Main] Initializing ModCompatibility\n[Info   :Jotunn.Main] Initializing SynchronizationManager\n[Info   :Jotunn.Main] Initializing NetworkManager\n[Message:   BepInEx] Chainloader startup complete\n[Info   : Unity Log] 09/13/2026 13:06:51: Set background loading budget to Low\n\n[Info   : Unity Log] 09/13/2026 13:06:51: Loading first scene!\n\n";
    const nachName = (e, name) => e.plugins.find(x => x.name === name);

    await pruefe('Echter Absturz: Jotunn geladen, TeleportEverything laedt nicht — mit Grund', async () => {
        const e = BepInExLog.werteAus(FEHLER_LOG);
        assert.strictEqual(e.vollstaendig, true);
        assert.strictEqual(e.anzahl, 2);
        assert.strictEqual(nachName(e, 'Jotunn').status, 'geladen');
        const te = nachName(e, 'TeleportEverything');
        assert.strictEqual(te.fassung, '2.9.1');
        assert.strictEqual(te.status, 'fehler');
        assert.match(te.grund, /Undefined target method/);
        assert.ok(te.warnungen.some(w => /HarmonyX/.test(w)), 'die HarmonyX-Warnung gehoert zu ihm');
    });

    await pruefe('Echter sauberer Start: alles geladen, Fassungen gelesen', async () => {
        const e = BepInExLog.werteAus(SAUBER_LOG);
        assert.strictEqual(e.vollstaendig, true);
        assert.strictEqual(e.bepinex, '5.4.23.5');
        assert.strictEqual(e.pack, '5.4.2350');
        assert.deepStrictEqual(e.plugins.map(p => [p.name, p.status]), [['Jotunn', 'geladen']]);
    });

    // Im echten Log von 189 stehen nach dem Chainloader Unity-Fehler (Shader,
    // Video, AsyncResourceUpload). Sie gehoeren dem SPIEL. Ohne diese Pruefung
    // fiele nicht auf, wenn sie dem zuletzt geladenen Mod angehaengt wuerden —
    // beide Ausschnitte oben enden vor ihnen.
    const LANG_LOG = "[Message:   BepInEx] BepInEx 5.4.23.5 - valheim_server (09/12/2026 12:19:32)\n[Message:   BepInEx] User is running BepInExPack Valheim version 5.4.2350 from Thunderstore\n[Info   :   BepInEx] Running under Unity vUnknown (post-2017)\n[Info   :   BepInEx] CLR runtime version: 4.0.30319.42000\n[Info   :   BepInEx] Supports SRE: True\n[Info   :   BepInEx] System platform: Bits64, Linux\n[Message:   BepInEx] Preloader started\n[Info   :   BepInEx] Loaded 1 patcher method from [BepInEx.Preloader 5.4.23.5]\n[Info   :   BepInEx] 1 patcher plugin loaded\n[Info   :   BepInEx] Patching [UnityEngine.CoreModule] with [BepInEx.Chainloader]\n[Message:   BepInEx] Preloader finished\n[Info   :   BepInEx] Detected Unity version: v6000.0.75f1\n[Message:   BepInEx] Chainloader ready\n[Message:   BepInEx] Chainloader started\n[Info   :   BepInEx] 1 plugin to load\n[Info   :   BepInEx] Loading [Jotunn 2.30.0]\n[Info   :Jotunn.Main] Initializing ModCompatibility\n[Info   :Jotunn.Main] Initializing SynchronizationManager\n[Info   :Jotunn.Main] Initializing NetworkManager\n[Message:   BepInEx] Chainloader startup complete\n[Info   : Unity Log] 09/13/2026 13:06:51: Set background loading budget to Low\n\n[Info   : Unity Log] 09/13/2026 13:06:51: Loading first scene!\n\n[Info   : Unity Log] 09/13/2026 13:06:51: Preferences initialized! Activating first scene!\n\n[Info   : Unity Log] 09/13/2026 13:06:53: Loading: Starting to load scene: start.unity (169d7618616154c03be07e9ad3af5893)\n\n[Info   : Unity Log] 09/13/2026 13:06:53: Set background loading budget to Normal\n\n[Info   : Unity Log] 09/13/2026 13:06:53: Loaded localization file #0 - 'localization' language: 'English'\n\n[Info   : Unity Log] 09/13/2026 13:06:53: Loaded localization file #1 - 'localization_extra' language: 'English'\n\n[Info   : Unity Log] 09/13/2026 13:06:53: Loaded localization file #2 - 'heightmap_message' language: 'English'\n\n[Info   : Unity Log] 09/13/2026 13:06:53: Loaded localization file #3 - 'localization_witch' language: 'English'\n\n[Info   : Unity Log] 09/13/2026 13:06:53: Loaded localization file #4 - 'localization_ashlands' language: 'English'\n\n[Info   : Unity Log] 09/13/2026 13:06:53: Loaded localization file #5 - 'localization_deepnorth' language: 'English'\n\n[Info   : Unity Log] 09/13/2026 13:06:53: Loaded localization file #6 - 'localization_captions' language: 'English'\n\n[Info   : Unity Log] 09/13/2026 13:06:53: Loaded localization file #7 - 'localization_warriortitles' language: 'English'\n\n[Info   : Unity Log] 09/13/2026 13:06:53: Loaded localization file #8 - 'localization_combatupdate' language: 'English'\n\n[Info   : Unity Log] 09/13/2026 13:06:53: Loaded localization file #9 - 'localization_ps' language: 'English'\n\n[Info   : Unity Log] 09/13/2026 13:06:53: Loaded localization file #10 - 'localization_celebrationupdate' language: 'English'\n\n[Info   : Unity Log] 09/13/2026 13:06:53: Loaded localization file #11 - 'localization_xbox' language: 'English'\n\n[Info   : Unity Log] 09/13/2026 13:06:53: Loaded localization file #12 - 'localization_switch' language: 'English'\n\n[Info   : Unity Log] 09/13/2026 13:06:57: Set background loading budget to High\n\n[Info   : Unity Log] 09/13/2026 13:06:57: GPU Device: 0000:0000 (Unknown)\n\n[Error  : Unity Log] AsyncResourceUpload failed.\n[Error  : Unity Log] AsyncResourceUpload failed.\n[Info   : Unity Log] 09/13/2026 13:07:02: Loading: Done, Total time: -9.856241\n\n[Info   : Unity Log] 09/13/2026 13:07:25: Set background loading budget to Low\n\n[Warning: Unity Log] HDR Render Texture not supported, disabling HDR on reflection probe.\n[Error  : Unity Log] This custom render path shader needs to have at least 1 passes.\n[Error  : Unity Log] Could not find material Hidden/VideoDecode. Make sure the Video shaders are included in your build, in the Built-in Shader Settings section of the Graphics Settings.\n[Error  : Unity Log] Could not find video decode shader pass YCbCr_To_RGB1 in shader <not found>\n[Error  : Unity Log] Could not find video decode shader pass YCbCrA_To_RGBAFull in shader <not found>\n[Error  : Unity Log] Could not find video decode shader pass YCbCrA_To_RGBA in shader <not found>\n[Error  : Unity Log] Could not find video decode shader pass Flip_RGBA_To_RGBA in shader <not found>\n[Error  : Unity Log] Could not find video decode shader pass Flip_RGBASplit_To_RGBA in shader <not found>\n[Error  : Unity Log] This custom render path shader needs to have at least 1 passes.\n";
    await pruefe('Unity-Fehler nach dem Chainloader gehoeren dem Spiel, nicht dem letzten Mod', async () => {
        assert.match(LANG_LOG, /\[Error  : Unity Log\] AsyncResourceUpload failed/, 'Ausschnitt ohne Unity-Fehler');
        const e = BepInExLog.werteAus(LANG_LOG);
        assert.strictEqual(nachName(e, 'Jotunn').status, 'geladen');
        assert.strictEqual(nachName(e, 'Jotunn').grund, null);
    });

    await pruefe('Endet der Start mitten im Laden, heisst das abgebrochen — nicht geladen', async () => {
        const bis = FEHLER_LOG.split('\n');
        const i = bis.findIndex(z => z.includes('Loading [TeleportEverything 2.9.1]'));
        const e = BepInExLog.werteAus(bis.slice(0, i + 1).join('\n'));
        assert.strictEqual(e.vollstaendig, false);
        assert.strictEqual(nachName(e, 'TeleportEverything').status, 'abgebrochen');
        assert.strictEqual(nachName(e, 'Jotunn').status, 'geladen');
    });

    // Nicht aus einem Lauf, sondern im Satzbau aus BepInEx.dll 5.4.23.5
    // (`strings -e l`): Meldungen, die ein Plugin nennen, ohne es zu laden.
    await pruefe('Chainloader-Meldungen ohne Loading-Zeile werden erkannt', async () => {
        const e = BepInExLog.werteAus([
            '[Error  :   BepInEx] Could not load [XPortal 1.2.24] because it has missing dependencies: com.jotunn.jotunn (2.27.1)',
            '[Warning:   BepInEx] Skipping [Alt 1.0.0] because a newer version exists (Alt 1.1.0)',
            '[Message:   BepInEx] Chainloader startup complete',
        ].join('\n'));
        assert.strictEqual(nachName(e, 'XPortal').status, 'nicht_geladen');
        assert.match(nachName(e, 'XPortal').grund, /Fehlende Abhängigkeiten: com\.jotunn\.jotunn/);
        assert.strictEqual(nachName(e, 'Alt').status, 'uebersprungen');
    });

    await pruefe('Zuordnung: Name, Fremdes separat, neu seit dem Start, ausgeschaltet und doch geladen', async () => {
        const e = BepInExLog.werteAus(FEHLER_LOG);
        const stand = '2026-09-13T14:26:42Z';
        const r = BepInExLog.ordneZu(e, {
            lader: { id: 17, art: 'loader', status: 'installiert', fassung: '5.4.2350', installiert_am: '2026-09-13T08:34:11Z' },
            mods: [
                { id: 23, name: 'TeleportEverything', kennung: 'OdinPlus-TeleportEverything', fassung: '2.9.1',
                  status: 'installiert', aktiv: 1, installiert_am: '2026-09-13T08:00:00Z' },
                { id: 30, name: 'Neu', kennung: 'X-Neu', fassung: '1.0.0',
                  status: 'installiert', aktiv: 1, installiert_am: '2026-09-13T15:00:00Z' },
            ],
        }, stand);
        assert.strictEqual(r.zeilen[23].status, 'fehler');
        assert.strictEqual(r.zeilen[30].status, 'neu_seit_start');
        assert.strictEqual(r.zeilen[17].status, 'geladen');
        assert.deepStrictEqual(r.fremd.map(p => p.name), ['Jotunn'], 'Jotunn hat hier keine Zeile — also fremd');

        const aus = BepInExLog.ordneZu(BepInExLog.werteAus(SAUBER_LOG), { lader: null, mods: [
            { id: 19, name: 'Jotunn', kennung: 'ValheimModding-Jotunn', fassung: '2.30.0',
              status: 'installiert', aktiv: 0, installiert_am: '2026-09-13T08:00:00Z' }] }, stand);
        assert.strictEqual(aus.zeilen[19].trotzAus, true, 'Schalten laesst die Datei liegen — BepInEx laedt sie');
    });

    await pruefe('Ohne content.loader.log sagt die Route es — ohne Daemon zu fragen', async () => {
        const r = await rufe('get', '/:serverId/inhalte/ladestand');
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.antwort.verfuegbar, false);
        assert.match(r.antwort.grund, /content\.loader\.log/);
        assert.strictEqual(daemon.gelesen.length, 0);
    });

    await pruefe('Mit content.loader.log liest die Route die Datei und ordnet zu', async () => {
        INHALT.loader.log = 'game/BepInEx/LogOutput.log';
        try {
            daemon.logInhalt = FEHLER_LOG;
            db.zeilen.push({ id: 23, server_id: 186, quelle: 'thunderstore', art: 'mod',
                kennung: 'OdinPlus-TeleportEverything', name: 'TeleportEverything', fassung: '2.9.1',
                status: 'installiert', aktiv: 1, installiert_am: '2026-09-13T08:00:00Z' });
            const r = await rufe('get', '/:serverId/inhalte/ladestand');
            assert.strictEqual(r.status, 200, JSON.stringify(r.antwort));
            assert.strictEqual(r.antwort.verfuegbar, true);
            assert.deepStrictEqual(daemon.gelistet, ['/game/BepInEx']);
            assert.deepStrictEqual(daemon.gelesen, ['/game/BepInEx/LogOutput.log']);
            assert.strictEqual(r.antwort.stand, '2026-09-13T14:26:42Z');
            assert.strictEqual(r.antwort.zeilen[23].status, 'fehler');

            daemon.gelesen = []; daemon.logFehlt = true;
            const leer = await rufe('get', '/:serverId/inhalte/ladestand');
            assert.strictEqual(leer.antwort.verfuegbar, false);
            assert.match(leer.antwort.grund, /noch keinen Start/);
            assert.strictEqual(daemon.gelesen.length, 0, 'ohne Datei wird nichts gelesen');
        } finally {
            delete INHALT.loader.log;
        }
    });

    await pruefe('Der Reiter holt den Ladestand und zeigt ihn je Zeile', async () => {
        assert.match(reiter, /\/ladestand`/, 'der Reiter fragt /ladestand nicht ab');
        assert.match(reiter, /LADESTAND\.zeilen\[e\.id\]/, 'die Zeile liest ihren Ladestand nicht');
        assert.match(reiter, /lauf\.trotzAus/, '"ausgeschaltet — laedt trotzdem" fehlt');
    });

    // ── Vorschlag A: das Alter einer Fassung gegen den Spielstand ───────────
    //
    // Betreiber, 2026-09-13/14: Thunderstore nennt keine Spielfassung, also
    // vergleichen wir zwei Daten — den Erscheinungstag der Mod-Fassung und den
    // Stand der Spieldateien aus der Kopfzeile des BepInEx-Logs.
    console.log('\nAlter gegen den Spielstand');

    await pruefe('Die Kopfzeile nennt den Stand der Spieldatei', async () => {
        const k = BepInExLog.spielstandAus('BepInEx 5.4.23.5 - valheim_server (09/12/2026 14:19:32)');
        assert.strictEqual(k.fassung, '5.4.23.5');
        assert.strictEqual(k.prozess, 'valheim_server');
        assert.strictEqual(k.stand, '2026-09-12');
        assert.strictEqual(k.roh, '09/12/2026 14:19:32');
    });

    await pruefe('Eine unbekannte Schreibweise wird gemeldet, nicht geraten', async () => {
        // Ein Container mit deutscher Kultur schriebe 12.09.2026. Aus 09.12.2026
        // wuerde bei einem Rateversuch still der 9. Dezember — eine falsche
        // Auskunft, die wie eine richtige aussieht.
        const de = BepInExLog.spielstandAus('BepInEx 5.4.23.5 - valheim_server (12.09.2026 14:19:32)');
        assert.strictEqual(de.stand, null);
        assert.strictEqual(de.roh, '12.09.2026 14:19:32', 'die Rohangabe gehoert trotzdem weitergereicht');
        // Monat 13 gibt es nicht — JavaScript rechnet stillschweigend weiter.
        assert.strictEqual(BepInExLog.spielstandAus('BepInEx 5.4 - x (13/12/2026 00:00:00)').stand, null);
        // Ohne Klammer gibt es kein Datum, aber sehr wohl eine Fassung.
        const ohne = BepInExLog.spielstandAus('BepInEx 5.4.23.5 - valheim_server');
        assert.strictEqual(ohne.stand, null);
        assert.strictEqual(ohne.fassung, '5.4.23.5');
    });

    await pruefe('Das echte Log traegt den Stand mit — ohne zweiten Griff zum Daemon', async () => {
        const e = BepInExLog.werteAus(FEHLER_LOG);
        assert.strictEqual(e.spiel.stand, '2026-09-12');
        assert.strictEqual(e.bepinex, '5.4.23.5', 'die Fassung darf darueber nicht verlorengehen');

        INHALT.loader.log = 'game/BepInEx/LogOutput.log';
        try {
            daemon.logInhalt = FEHLER_LOG;
            const r = await rufe('get', '/:serverId/inhalte/ladestand');
            assert.strictEqual(r.antwort.spiel.stand, '2026-09-12', 'die Route reicht den Stand nicht durch');
            assert.deepStrictEqual(daemon.gelesen, ['/game/BepInEx/LogOutput.log'], 'genau eine Datei');
        } finally {
            delete INHALT.loader.log;
        }
    });

    await pruefe('Der Erscheinungstag wird beim Installieren aufgehoben', async () => {
        stelleThunderstore([JOTUNN]);
        await InhalteHolen.installiere({ server: SERVER, inhalt: INHALT, guildId: 'g1',
            quelle: 'thunderstore', kennung: 'ValheimModding-Jotunn' });
        assert.strictEqual(db.zeilen[0].veroeffentlicht, '2026-07-13',
            'ohne die Spalte muesste die Liste je Mod bei Thunderstore nachfragen');
    });

    await pruefe('Die Vorschau kennt ihn auch — der Verdacht gehoert VOR die Installation', async () => {
        stelleThunderstore([JOTUNN]);
        const v = await InhalteHolen.vorschau({ serverId: 186, inhalt: INHALT, quelle: 'thunderstore',
            kennung: 'ValheimModding-Jotunn' });
        assert.strictEqual(v.pakete[0].veroeffentlicht, '2026-07-13T05:41:39.807962Z');
    });

    await pruefe('Der Reiter rechnet den Abstand aus — gegen die echten Daten', async () => {
        // Der Vergleich passiert im Browser: Liste und Ladestand kommen aus zwei
        // Abrufen, und nur dort liegen beide vor. Geprueft wird deshalb der
        // Code, der wirklich ausgeliefert wird — aus der Vorlage geschnitten.
        const roh = fs.readFileSync(path.join(__dirname,
            '../plugins/gameserver/dashboard/views/guild/partials/server-detail-inhalte.ejs'), 'utf8');
        const von = roh.indexOf('const TAG_MS');
        const bis = roh.indexOf('\n  }\n', roh.indexOf('function alterZeile')) + 4;
        assert.ok(von > 0 && bis > von, 'der Rechenblock steht nicht mehr in der Vorlage');
        const baue = (stand) => new Function('LADESTAND', 'escape',
            roh.slice(von, bis) + '; return alterZeile;')({ verfuegbar: Boolean(stand), spiel: { stand } }, String);

        const mit = baue('2026-09-12');
        // Die beiden Faelle vom 13.09.: TeleportEverything 2.9.1 stuerzte ab,
        // Jotunn 2.30.0 lief. Die Zahl 216 ist gerechnet, nicht gesetzt.
        assert.strictEqual(mit('2026-02-08T00:52:06.908446Z'),
            'Fassung vom 08.02.2026 — 216 Tage vor den Spieldateien');
        assert.strictEqual(mit('2026-09-09T21:49:37.646168Z'),
            'Fassung vom 09.09.2026 — 3 Tage vor den Spieldateien');
        assert.strictEqual(mit('2026-09-12'), 'Fassung vom 12.09.2026 — vom selben Tag wie die Spieldateien');
        assert.strictEqual(mit('2026-09-14'), 'Fassung vom 14.09.2026 — 2 Tage nach den Spieldateien');
        assert.strictEqual(mit(null), '', 'ohne Erscheinungstag steht da nichts');
        // Ohne Ladestand bleibt die Auskunft halb — aber sie luegt nicht.
        assert.strictEqual(baue(null)('2026-09-09T21:49:37.646168Z'), 'Fassung vom 09.09.2026');
    });

    await pruefe('Der Reiter zeigt ihn an drei Stellen: Kopf, Zeile, Vorschau', async () => {
        assert.match(reiter, /Spieldateien vom/, 'die Kopfzeile nennt den Spielstand nicht');
        assert.match(reiter, /alterZeile\(e\.veroeffentlicht/, 'die Mod-Zeile zeigt den Erscheinungstag nicht');
        assert.match(reiter, /alterZeile\(p\.veroeffentlicht\)/, 'die Vorschau zeigt ihn nicht');
        // Altzeilen ohne Spaltenwert: „Auf Aktualisierungen pruefen" liefert den
        // Tag mit, wenn die installierte Fassung die neueste ist.
        assert.match(reiter, /neuere\.installiertVom/, 'der Ersatzweg fuer Altzeilen fehlt');
    });

    await pruefe('Der Toast behauptet nicht, geloescht zu haben, was schon fehlte', async () => {
        assert.match(reiter, /sind vom Server weg/, 'die ehrliche Formulierung fehlt');
        assert.doesNotMatch(reiter, /Datei\(en\) gelöscht/, 'die alte Behauptung steht wieder da');
        db.zeilen.push(JOTUNN_ZEILE());
        const r = await rufe('delete', '/:serverId/inhalte/:id', { params: { id: '9' } });
        assert.strictEqual(r.antwort.bestaetigtWeg, 1);
        assert.strictEqual(r.antwort.dateien, undefined, 'das Feld `dateien` hiess wie eine Dateizahl');
    });

    // ════════════════════════════════════════════════════════════════════════
    // Die Fassungswahl (Betreiber, 2026-09-23)
    // ════════════════════════════════════════════════════════════════════════
    //
    // Betreiber: „muss noch die versionierung ausprobieren. wenn ich mit
    // verschiedenen versionen anstelle von latest mods mache."
    //
    // Es ging nicht — und der Grund ist der interessante Teil: **Jedes einzelne
    // Stueck war da.** `paket()`, `aufloesen()`, `installiere()`, die Vorschau-
    // und die Holroute nahmen eine Fassung alle entgegen. Nur nannte sie
    // niemand: Die Oberflaeche schickte nie eine, und es kam immer die neueste.
    //
    // Geprueft wird deshalb die VERBINDUNG, nicht das Vorhandensein der Teile.

    await pruefe('Die gewaehlte Fassung kommt beim Anbieter an', async () => {
        let gesehen = 'nie aufgerufen';
        Thunderstore.aufloesen = async (raum, kennung, fassung) => {
            gesehen = fassung;
            return { pakete: [JOTUNN], fehlend: [] };
        };
        Thunderstore.paket = async () => JOTUNN;

        await rufe('post', '/:serverId/inhalte/holen',
            { body: { kennung: 'ValheimModding-Jotunn', fassung: '2.29.2' } });
        assert.strictEqual(gesehen, '2.29.2',
            `die Fassung kam als ${JSON.stringify(gesehen)} an — der Weg reisst ab`);
    });

    await pruefe('Ohne Wahl bleibt es ausdruecklich die neueste (null, nicht "")', async () => {
        let gesehen = 'nie aufgerufen';
        Thunderstore.aufloesen = async (raum, kennung, fassung) => {
            gesehen = fassung;
            return { pakete: [JOTUNN], fehlend: [] };
        };
        Thunderstore.paket = async () => JOTUNN;

        await rufe('post', '/:serverId/inhalte/holen', { body: { kennung: 'ValheimModding-Jotunn' } });
        // `null` heisst „such du die neueste". Ein leerer String waere eine
        // Fassung mit dem Namen „" und wuerde gesucht werden.
        assert.strictEqual(gesehen, null, `es kam ${JSON.stringify(gesehen)} statt null an`);
    });

    await pruefe('Die Oberflaeche schickt die Fassung ueberhaupt mit', async () => {
        // Der eigentliche Fehler von vorher: Der Knopf schickte nur die
        // Kennung, und der ganze Unterbau lief darum herum ins Leere.
        assert.match(reiter, /body: JSON\.stringify\(\{ kennung, quelle: quelleJetzt\(\), fassung: FASSUNG \}\)/,
            'der Installieren-Knopf schickt keine Fassung — dann waehlt die Auswahl nichts aus');
        assert.match(reiter, /window\.inhaltVorschau = function \(kennung, knopf, fassung\)/,
            'die Vorschau nimmt keine Fassung entgegen');
        assert.match(reiter, /onchange="inhaltVorschau\(/,
            'das Auswahlfeld laedt die Vorschau nicht neu — die Abhaengigkeiten blieben die der neuesten');
    });

    await pruefe('Die Wahl gehoert zu EINEM Mod und ueberlebt den Listenwechsel nicht', async () => {
        // Sonst traegt der naechste Klick auf „Ansehen" die Nummer des vorigen
        // mit sich, und die Vorschau meldet „Fassung gibt es nicht (mehr)" fuer
        // ein Paket, das niemand angefasst hat.
        const i = reiter.indexOf('window.inhaltSuchen = function');
        assert.ok(i > -1, 'inhaltSuchen gibt es nicht mehr');
        assert.match(reiter.slice(i, i + 700), /FASSUNG = null;/,
            'die Fassungswahl wird beim Zurueck zur Liste nicht vergessen');
    });

    await pruefe('Ein Anbieter, der seine Fassungen nicht nennen kann, sagt das', async () => {
        // Gemessen am 2026-09-23: Thunderstore hat KEINEN Einzelabruf dafuer.
        // Die Gesamtliste haette sie (94 853 fuer Valheim), kostet aber 169 MB.
        //
        // Die falsche Antwort waere eine leere Liste — sie saehe aus wie „dieses
        // Paket hat keine Fassungen". Richtig ist: eine Fassung, `vollstaendig:
        // false` und der Grund im Klartext.
        // ⚠ `Thunderstore.paket` zu ersetzen greift hier NICHT: `fassungen()`
        // ruft die modulinterne Funktion, nicht die exportierte. Beim Bauen
        // dieses Tests ist er deshalb ins ECHTE Netz gegangen und hat Jotunns
        // wirkliche Fassung geholt (2.30.2 statt der erwarteten 2.29.2). Waere
        // die Nummer zufaellig dieselbe gewesen, waere er gruen gewesen — und
        // haette trotzdem das Netz gebraucht, entgegen der Zusage im Kopf
        // dieser Datei.
        //
        // Abgefangen wird deshalb `fetch`, wie in check-quellen.js: Damit
        // laeuft der echte Weg durch `paket()`, nur die Gegenstelle ist unser.
        const echtesFetch = global.fetch;
        global.fetch = async (adresse) => {
            const u = new URL(String(adresse));
            if (!/\/api\/experimental\/package\//.test(u.pathname)) {
                throw new Error('Unerwarteter Abruf: ' + adresse);
            }
            return { ok: true, status: 200, json: async () => ({
                latest: { version_number: JOTUNN.fassung, download_url: JOTUNN.adresse,
                          file_size: 1, dependencies: [],
                          date_created: JOTUNN.veroeffentlicht, description: '' },
            }) };
        };
        let f;
        try {
            f = await Thunderstore.fassungen('valheim', 'ValheimModding-Jotunn');
        } finally {
            global.fetch = echtesFetch;
        }
        assert.strictEqual(f.vollstaendig, false, 'Thunderstore behauptet, vollstaendig zu sein');
        assert.ok(f.liste.length >= 1, 'eine leere Liste sieht aus wie „hat keine Fassungen"');
        assert.ok(f.grund && f.grund.length > 20, 'der Grund fehlt oder ist zu knapp');
        assert.strictEqual(f.liste[0].fassung, JOTUNN.fassung);
    });

    await pruefe('Jeder Anbieter erfuellt den Fassungs-Vertrag', async () => {
        const Modrinth = require(path.join(HELFER, 'Modrinth.js'));
        for (const anbieter of [Thunderstore, Modrinth]) {
            assert.strictEqual(typeof anbieter.fassungen, 'function',
                `${anbieter.TITEL} hat keine fassungen() — die Route faellt auf „kann er nicht" zurueck`);
        }
    });

    Object.assign(Thunderstore, ECHT);
    console.log(`\n${bestanden} Pruefung(en) bestanden.\n`);
})();
