#!/usr/bin/env node
/**
 * Ports, die erst ein Mod mitbringt — ohne Daemon, ohne Datenbank.
 *
 * ── Was hier geprueft wird (Baustelle 156, 2026-09-24) ──────────────────────
 *
 * Server 202 lief mit Simple Voice Chat, der Container gab 24454/udp nicht
 * frei — die Mitspieler hoerten sich nicht, und nichts meldete es. Seitdem
 * nennt das Paket solche Ports mit `needed_by`, und vor jedem Start gleicht
 * `helpers/Zusatzports.js` ab:
 *
 *   Anlegen     ein `needed_by`-Port wird NICHT gebucht
 *   Start       Datei da → buchen · Datei weg → freigeben
 *               Ordner fehlt → freigeben (das ist eine Antwort)
 *               Liste nicht lesbar → nichts anfassen
 *               Vorrat leer → Hinweis, kein halber Eintrag
 *   Verdrahtung buildStartPayload ruft den Abgleich VOR dem Lesen der Ports
 *   Paket       jeder `needed_by`-Port hat einen config[]-Eintrag mit seiner
 *               Nummer — sonst lauscht die Mod auf ihrer Vorgabe, und der
 *               gebuchte Port bleibt leer
 *
 * Die Attrappen WERFEN bei unerwarteten Abfragen und Befehlen.
 *
 *   node scripts/check-zusatzports.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ServiceManager } = require('dunebot-core');
const { ohneKommentare } = require('./lib/quelltext');

const still = () => {};
const gewarnt = [];
ServiceManager.register('Logger', { debug: still, info: still, warn: (t) => gewarnt.push(t), error: still, success: still });

const db = {
    vorrat: [],              // [{id, port, server_id}]
    serverPorts: null,       // was in gameservers.ports geschrieben wurde
    async query(sql, params) {
        const t = String(sql).replace(/\s+/g, ' ').trim();
        if (/^SELECT id, port FROM port_allocations WHERE rootserver_id = \? AND server_id IS NULL ORDER BY port ASC LIMIT 1$/.test(t)) {
            const frei = this.vorrat.filter(z => z.server_id === null).sort((a, b) => a.port - b.port);
            return frei.length ? [{ id: frei[0].id, port: frei[0].port }] : [];
        }
        if (/^UPDATE port_allocations SET server_id = \?, assigned_at = NOW\(\) WHERE id = \? AND server_id IS NULL$/.test(t)) {
            const z = this.vorrat.find(v => v.id === params[1] && v.server_id === null);
            if (z) z.server_id = params[0];
            return { affectedRows: z ? 1 : 0 };
        }
        if (/^UPDATE port_allocations SET server_id = NULL, assigned_at = NULL WHERE rootserver_id = \? AND port = \? AND server_id = \?$/.test(t)) {
            const z = this.vorrat.find(v => v.port === params[1] && v.server_id === params[2]);
            if (z) z.server_id = null;
            return { affectedRows: z ? 1 : 0 };
        }
        if (/^UPDATE gameservers SET ports = \? WHERE id = \?$/.test(t)) {
            this.serverPorts = JSON.parse(params[0]);
            return { affectedRows: 1 };
        }
        throw new Error('Unerwartete Abfrage: ' + t.slice(0, 100));
    },
};

const daemon = {
    antwort: null,           // was gameserver.files.list liefert
    gefragt: [],
    isDaemonOnline() { return true; },
    async sendCommand(daemonId, befehl, nutzlast) {
        if (befehl !== 'gameserver.files.list') throw new Error('Unerwarteter Befehl: ' + befehl);
        this.gefragt.push(nutzlast.path);
        return this.antwort;
    },
};

ServiceManager.register('dbService', db);
ServiceManager.register('ipmServer', daemon);

const HELFER = path.join(__dirname, '../plugins/gameserver/dashboard/helpers');
const Zusatzports = require(path.join(HELFER, 'Zusatzports.js'));
const { lesePortzwecke, portBedarf } = require(path.join(HELFER, 'Portvergabe.js'));

const paket = JSON.parse(fs.readFileSync(path.join(__dirname, '../packages/fbpkg/beispiele/minecraft.json'), 'utf8'));
const GEBUCHT = { game: { internal: 25004, external: 25004, protocol: 'tcp' }, rcon: { internal: 25005, external: 25005, protocol: 'tcp' } };
const server = (ports) => ({ id: 202, rootserver_id: 54, install_path: '', daemon_id: 'd1', ports: JSON.stringify(ports) });
const dateien = (...namen) => ({ success: true, data: { files: namen.map(n => ({ name: n, is_dir: false })) } });

let bestanden = 0;
async function pruefe(name, fn) {
    db.vorrat = [{ id: 1, port: 25006, server_id: null }, { id: 2, port: 25007, server_id: null }];
    db.serverPorts = null; daemon.gefragt = []; gewarnt.length = 0;
    try { await fn(); console.log(`  ✓ ${name}`); bestanden++; }
    catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

(async () => {
    console.log('\nPaket');

    await pruefe('Minecraft nennt einen voice-Port mit needed_by unter game/mods', async () => {
        const voice = paket.ports.find(p => p.purpose === 'voice');
        assert.ok(voice, 'kein voice-Port im Paket');
        assert.match(voice.needed_by, /^game\/mods\/voicechat-\*\.jar$/);
        assert.strictEqual(voice.required, false);
    });

    await pruefe('Jeder needed_by-Port wird per config[] in eine Datei geschrieben', async () => {
        for (const p of paket.ports.filter(x => x.needed_by)) {
            const ziel = (paket.config || []).find(c => Object.values(c.set || {}).some(v => v.includes(`{{port:${p.purpose}}}`)));
            assert.ok(ziel, `„${p.purpose}" wird gebucht, aber nirgends eingetragen — die Mod lauschte auf ihrer Vorgabe`);
        }
    });

    console.log('\nAnlegen');

    await pruefe('Das Anlegen bucht den Bedarfsport NICHT', async () => {
        const { basis, weiterePool, gekoppelt } = lesePortzwecke(paket);
        const zwecke = [basis?.purpose, ...weiterePool.map(w => w.zweck), ...gekoppelt.map(g => g.zweck)];
        assert.ok(!zwecke.includes('voice'), `voice steht in der Anlege-Buchung: ${zwecke.join(', ')}`);
        assert.strictEqual(portBedarf(paket), 2, 'Minecraft braucht beim Anlegen genau zwei Ports (game, rcon)');
    });

    console.log('\nStart');

    await pruefe('Mod da, Port fehlt → der niedrigste freie wird gebucht', async () => {
        daemon.antwort = dateien('jei-1.20.1.jar', 'voicechat-forge-1.20.1-2.6.22.jar');
        const e = await Zusatzports.gleicheAb({ server: server(GEBUCHT), paket });
        assert.deepStrictEqual(daemon.gefragt, ['/game/mods']);
        assert.strictEqual(e.geaendert, true);
        assert.deepStrictEqual(e.ports.voice, { internal: 25006, external: 25006, protocol: 'udp' });
        assert.strictEqual(db.vorrat[0].server_id, 202, 'im Vorrat gebucht');
        assert.deepStrictEqual(db.serverPorts.voice, e.ports.voice, 'gameservers.ports nachgezogen');
        assert.ok(db.serverPorts.game && db.serverPorts.rcon, 'die übrigen Ports bleiben');
    });

    await pruefe('Mod da, Port schon gebucht → nichts geschrieben', async () => {
        daemon.antwort = dateien('voicechat-fabric-1.21.1-2.6.0.jar');
        const e = await Zusatzports.gleicheAb({ server: server({ ...GEBUCHT, voice: { internal: 25007, external: 25007, protocol: 'udp' } }), paket });
        assert.strictEqual(e.geaendert, false);
        assert.strictEqual(db.serverPorts, null);
    });

    await pruefe('Mod weg → der Port wird freigegeben', async () => {
        db.vorrat[1].server_id = 202;
        daemon.antwort = dateien('jei-1.20.1.jar');
        const e = await Zusatzports.gleicheAb({ server: server({ ...GEBUCHT, voice: { internal: 25007, external: 25007, protocol: 'udp' } }), paket });
        assert.strictEqual(e.geaendert, true);
        assert.ok(!('voice' in e.ports));
        assert.strictEqual(db.vorrat[1].server_id, null, 'zurück im Vorrat');
        assert.ok(!('voice' in db.serverPorts));
    });

    await pruefe('Ordner fehlt (Wortlaut des Daemons) → freigeben, denn dort liegt keine Mod', async () => {
        db.vorrat[1].server_id = 202;
        daemon.antwort = { success: false, error: 'verzeichnis nicht gefunden: /game/mods' };
        const e = await Zusatzports.gleicheAb({ server: server({ ...GEBUCHT, voice: { internal: 25007, external: 25007, protocol: 'udp' } }), paket });
        assert.strictEqual(e.geaendert, true);
        assert.strictEqual(db.vorrat[1].server_id, null);
    });

    await pruefe('Liste nicht lesbar → NICHTS anfassen, aber laut', async () => {
        db.vorrat[1].server_id = 202;
        daemon.antwort = { success: false, error: 'Zeitüberschreitung' };
        const e = await Zusatzports.gleicheAb({ server: server({ ...GEBUCHT, voice: { internal: 25007, external: 25007, protocol: 'udp' } }), paket });
        assert.strictEqual(e.geaendert, false);
        assert.strictEqual(db.vorrat[1].server_id, 202, 'die Buchung bleibt');
        assert.ok(gewarnt.some(w => /nicht lesbar/.test(w)), 'es wird gewarnt');
    });

    await pruefe('Vorrat leer → Hinweis, kein halber Eintrag', async () => {
        db.vorrat.forEach(z => { z.server_id = 999; });
        daemon.antwort = dateien('voicechat-forge-1.20.1-2.6.22.jar');
        const e = await Zusatzports.gleicheAb({ server: server(GEBUCHT), paket });
        assert.strictEqual(e.geaendert, false);
        assert.ok(!('voice' in e.ports));
        assert.ok(e.hinweise.some(h => /kein freier/.test(h)), e.hinweise.join(' | '));
    });

    await pruefe('Das Muster trifft nur den Anfang, den es nennt', async () => {
        const { muster } = Zusatzports.zerlegeMuster('game/mods/voicechat-*.jar');
        assert.ok(muster.test('voicechat-forge-1.20.1-2.6.22.jar'));
        assert.ok(!muster.test('xvoicechat-forge.jar'), 'kein Treffer mitten im Namen');
        assert.ok(!muster.test('voicechat-forge.jar.disabled'), 'kein Treffer auf eine abgeschaltete Datei');
    });

    console.log('\nVerdrahtung');

    await pruefe('buildStartPayload gleicht ab, BEVOR es die Ports liest', async () => {
        const quelle = ohneKommentare(fs.readFileSync(path.join(HELFER, 'StartPayload.js'), 'utf8'));
        const a = quelle.indexOf("require('./Zusatzports').gleicheAb(");
        const b = quelle.indexOf('fehlendePorts(paket, ports)', a);
        assert.ok(a >= 0, 'kein Aufruf von Zusatzports.gleicheAb in StartPayload.js');
        assert.ok(b > a, 'der Abgleich steht nicht vor der Portprüfung');
    });

    console.log(`\n${bestanden} Prüfung(en) bestanden.\n`);
    process.exit(process.exitCode || 0);
})();
