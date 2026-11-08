#!/usr/bin/env node
/**
 * Reste: Platte gegen Datenbank (K313, 2026-11-08).
 *
 * Anlass: Auf 54 lagen bei zwei Servern 36 Laufzeitordner und fünf
 * Sicherungsordner, und Port 25004 nutzte Server 221, gebucht war er für
 * niemanden. Ohne diese Prüfung merkt man ein Leck erst, wenn die Platte voll
 * ist oder ein Port zweimal vergeben wird (E-12).
 *
 * Seit Daemon 1.1.21 räumt der Daemon beim Verbinden selbst weg, was keinem
 * Server seiner Maschine gehört (internal/gameserver/reste.go), und meldet
 * danach seinen Bestand als `reste.befund`. Das Dashboard speichert ihn in
 * `rootserver.reste_befund`; helpers/Reste.js vergleicht ihn mit der Datenbank.
 *
 *   Vergleich   an Attrappen: jede Regel einmal rot, eine saubere Maschine grün
 *   Übernahme   reste.befund wird bereinigt gespeichert
 *   Verdrahtung Daemon räumt alle vier Orte, das Löschen nimmt .run mit,
 *               der tote systemd-Befehl ist weg
 *   Maschinen   der echte Stand jeder Maschine — muss 0 Befunde melden
 *
 * Nur lesend.
 *
 *   node scripts/check-reste.js
 *
 * Exitcode 1 bei jeder Abweichung, auch bei einem Befund an einer Maschine.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { ServiceManager } = require('dunebot-core');
const { ohneKommentare } = require('./lib/quelltext');

const WURZEL = path.join(__dirname, '..');
const DAEMON = path.join(WURZEL, '..', 'firebot_daemon');
const still = () => {};
ServiceManager.register('Logger', { debug: still, info: still, warn: still, error: still, success: still });

const Reste = require(path.join(WURZEL, 'plugins/masterserver/dashboard/helpers/Reste'));

let fehler = 0;
async function pruefe(name, fn) {
    try {
        await fn();
        console.log(`  ✓ ${name}`);
    } catch (e) {
        fehler++;
        console.log(`  ✗ ${name}\n      ${String(e.message).split('\n').join('\n      ')}`);
    }
}

const STUNDE = 3600e3;
const JETZT = Date.parse('2026-11-08T20:00:00Z');
const vor = (h) => new Date(JETZT - h * STUNDE);

// Eine saubere Maschine: zwei Server, ihre Ports gebucht, ihre Archive da.
function sauber() {
    return {
        jetzt: JETZT,
        befundAm: vor(1),
        befund: Reste.bereinige({
            am: Math.round((JETZT - STUNDE) / 1000),
            volumes: ['217', '221'],
            sicherungen: { 217: [{ name: 'Core_2026-10-28.tar.gz', bytes: 240e6 }], 221: [] },
            werkbank: ['wba4b1efe430'],
            entfernt: [{ art: 'laufordner', name: '190', bytes: 27 }],
            geblieben: [],
        }),
        server: [
            { id: 217, name: 'Core Keeper', status: 'offline', created_at: vor(500),
                ports: '{"game":{"internal":25007,"external":25007},"query":{"internal":25008,"external":25008}}' },
            { id: 221, name: 'Windrose', status: 'offline', created_at: vor(400), ports: { game: { internal: 25004, external: 25004 } } },
        ],
        zugezogen: [],
        sicherungen: [{ server_id: 217, name: 'Core_2026-10-28', status: 'completed', pruned_at: null, completed_at: vor(200) },
            { server_id: 217, name: 'alt', status: 'completed', pruned_at: vor(100), completed_at: vor(300) },
            { server_id: 221, name: 'kaputt', status: 'failed', pruned_at: null, completed_at: null }],
        buchungen: [{ port: 25007, server_id: 217 }, { port: 25008, server_id: 217 }, { port: 25004, server_id: 221 }],
        sitzungen: [{ kennung: 'wba4b1efe430', created_at: vor(150) }],
    };
}
const mit = (aenderung) => { const d = sauber(); aenderung(d); return Reste.vergleiche(d); };
const genau = (befunde, muster) => {
    assert.strictEqual(befunde.length, 1, `erwartet genau einen Befund, gekommen:\n${befunde.join('\n') || '(keiner)'}`);
    assert.match(befunde[0], muster);
};

(async () => {
    console.log('\nVergleich');
    await pruefe('eine saubere Maschine: kein Befund (fehlgeschlagene und ausgedünnte Sicherungen zählen nicht)', () => {
        assert.deepStrictEqual(Reste.vergleiche(sauber()), []);
    });
    await pruefe('54 am 2026-11-08: Port 25004 nutzt 221, gebucht ist er für niemanden', () => {
        genau(mit(d => { d.buchungen = d.buchungen.filter(b => b.port !== 25004); }),
            /Port 25004 \(„game"\) von Server 221 ist im Vorrat nicht gebucht/);
    });
    await pruefe('Port für einen anderen gebucht', () => {
        const b = mit(d => { d.buchungen.find(x => x.port === 25004).server_id = 233; });
        assert.ok(b.some(x => /Port 25004 \(„game"\) nutzt Server 221, gebucht ist er für Server 233/.test(x)), b.join('\n'));
        assert.ok(b.some(x => /Port 25004 ist für Server 233 gebucht, den es auf dieser Maschine nicht gibt/.test(x)), b.join('\n'));
    });
    await pruefe('zwei IPs: dieselbe Nummer zweimal gebucht, eine davon für den Server — kein Befund', () => {
        assert.deepStrictEqual(mit(d => { d.buchungen.push({ port: 25004, server_id: 0, assigned_at: vor(0.1) }); }), []);
    });
    await pruefe('Vormerkung (server_id 0) älter als eine Stunde', () => {
        genau(mit(d => { d.buchungen.push({ port: 25010, server_id: 0, assigned_at: vor(3) }); }), /Port 25010 ist seit .* vorgemerkt/);
        assert.deepStrictEqual(mit(d => { d.buchungen.push({ port: 25010, server_id: 0, assigned_at: vor(0.5) }); }), []);
    });
    await pruefe('Buchung für einen Server, der den Port nicht nutzt', () => {
        genau(mit(d => { d.buchungen.push({ port: 25009, server_id: 217 }); }), /Port 25009 ist für Server 217 gebucht, der ihn nicht nutzt/);
    });
    await pruefe('ohne Befund des Daemons: gemeldet — die Ports prüft die Datenbank trotzdem', () => {
        const b = mit(d => { d.befund = null; d.buchungen = []; });
        assert.ok(b.some(x => /noch keinen Bestand gemeldet/.test(x)), b.join('\n'));
        assert.strictEqual(b.filter(x => /im Vorrat nicht gebucht/.test(x)).length, 3, b.join('\n'));
    });
    await pruefe('was der Daemon nicht entfernte, steht da — mit Größe und Grund', () => {
        genau(mit(d => { d.befund.geblieben = [{ art: 'sicherungen', name: '190', bytes: 4.1e9, grund: 'erst 5 min alt — bleibt' }]; }),
            /liegt noch sicherungen 190 \(4,10 GB\): erst 5 min alt/);
    });
    await pruefe('Server ohne Dateien auf der Maschine — außer er kam nach dem Befund oder wird gerade gelöscht', () => {
        genau(mit(d => { d.befund.volumes = ['217']; }), /Server 221 \(„Windrose"\) steht im Panel, auf der Maschine hat er keine Dateien/);
        assert.deepStrictEqual(mit(d => { d.befund.volumes = ['217']; d.server[1].created_at = vor(0.5); }), []);
        assert.deepStrictEqual(mit(d => { d.befund.volumes = ['217']; d.zugezogen = [{ server_id: 221, completed_at: vor(0.5) }]; }), []);
        assert.deepStrictEqual(mit(d => { d.befund.volumes = ['217']; d.server[1].loeschung_seit = vor(0.2); }), []);
        assert.deepStrictEqual(mit(d => { d.befund.volumes = ['217']; d.server[1].status = 'installing'; }), []);
    });
    await pruefe('Volume ohne Server im Panel', () => {
        genau(mit(d => { d.befund.volumes.push('190'); }), /das Volume 190, im Panel gibt es den Server hier nicht/);
    });
    await pruefe('Archiv ohne Zeile, Zeile ohne Archiv', () => {
        genau(mit(d => { d.befund.sicherungen['221'] = [{ name: 'heimlich.tar.gz', bytes: 5e6 }]; }),
            /Archiv heimlich\.tar\.gz \(5,0 MB\) von Server 221 liegt auf der Maschine, im Panel steht es nicht/);
        genau(mit(d => { d.befund.sicherungen['217'] = []; }), /Sicherung „Core_2026-10-28" von Server 217 steht im Panel, das Archiv fehlt/);
        assert.deepStrictEqual(mit(d => { d.befund.sicherungen['217'] = []; d.sicherungen[0].completed_at = vor(0.5); }), [],
            'eine Sicherung nach dem Befund kann er nicht kennen');
    });
    await pruefe('Werkbank: Ordner ohne offene Sitzung, offene Sitzung ohne Ordner', () => {
        genau(mit(d => { d.sitzungen = []; }), /Werkbank-Ordner wba4b1efe430 liegt auf der Maschine, eine offene Sitzung dazu gibt es nicht/);
        genau(mit(d => { d.befund.werkbank = []; }), /Werkbank-Sitzung wba4b1efe430 ist offen, ihr Ordner fehlt/);
    });

    console.log('\nÜbernahme');
    await pruefe('bereinige: fremde Arten und Felder fallen weg, Übergrößen werden gekürzt', () => {
        const b = Reste.bereinige({
            am: 5, volumes: ['1', 2], sicherungen: { 7: [{ name: 'a', bytes: '9' }], boese: [{ name: 'x' }] },
            entfernt: [{ art: 'volume', name: 'x'.repeat(500), bytes: -3, extra: 1 }, { art: 'rm -rf', name: 'y' }],
            geblieben: 'kein Feld', fremd: true,
        });
        assert.deepStrictEqual(Object.keys(b).sort(), ['am', 'entfernt', 'geblieben', 'sicherungen', 'volumes', 'werkbank']);
        assert.deepStrictEqual(b.volumes, ['1', '2']);
        assert.deepStrictEqual(b.sicherungen, { 7: [{ name: 'a', bytes: 9 }] });
        assert.strictEqual(b.entfernt.length, 1);
        assert.strictEqual(b.entfernt[0].name.length, 200);
        assert.strictEqual(b.entfernt[0].bytes, 0);
        assert.deepStrictEqual(b.geblieben, []);
    });
    await pruefe('RootServer.uebernimmReste schreibt den bereinigten Befund in die Zeile der Maschine', async () => {
        const spur = [];
        ServiceManager.register('dbService', { query: async (sql, w) => { spur.push({ sql: sql.replace(/\s+/g, ' ').trim(), w }); return { affectedRows: 1 }; } });
        const RootServer = require(path.join(WURZEL, 'plugins/masterserver/dashboard/models/RootServer'));
        const b = await RootServer.uebernimmReste('d-54', { volumes: ['217'], entfernt: [{ art: 'laufordner', name: '190', bytes: 27 }], geheim: 'x' });
        assert.strictEqual(spur.length, 1);
        assert.strictEqual(spur[0].sql, 'UPDATE rootserver SET reste_befund = ?, reste_am = NOW() WHERE daemon_id = ?');
        assert.deepStrictEqual(JSON.parse(spur[0].w[0]), b);
        assert.ok(!/geheim/.test(spur[0].w[0]));
        assert.strictEqual(spur[0].w[1], 'd-54');
    });
    await pruefe('das Ereignis reste.befund ist abonniert, Entferntes kommt ins Protokoll der Maschine', () => {
        const q = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'apps/dashboard/helpers/IPMServer.js'), 'utf8'));
        const block = q.slice(q.indexOf("eventRouter.register('reste', 'befund'"));
        assert.ok(block.length < q.length, 'kein Abonnement für reste.befund');
        const rumpf = block.slice(0, block.indexOf('\n        });'));
        assert.match(rumpf, /RootServer\.uebernimmReste\(context\.daemonId, payload\)/);
        assert.match(rumpf, /_logDaemonEvent\(context\.daemonId, 'reste_entfernt'/);
        assert.match(rumpf, /_logDaemonEvent\(context\.daemonId, 'reste_geblieben'/);
    });
    await pruefe('Migration legt reste_befund und reste_am an', () => {
        const m = fs.readFileSync(path.join(WURZEL, 'plugins/masterserver/migrations/20261108_210000_rootserver_reste.js'), 'utf8');
        assert.match(m, /ADD COLUMN IF NOT EXISTS reste_befund LONGTEXT/);
        assert.match(m, /ADD COLUMN IF NOT EXISTS reste_am DATETIME/);
    });

    console.log('\nVerdrahtung im Daemon');
    const go = (datei) => ohneKommentare(fs.readFileSync(path.join(DAEMON, datei), 'utf8'));
    await pruefe('beim Verbinden: ResteAufraeumen mit der Serverliste, Container dazu, Befund gesendet', () => {
        const c = go('internal/websocket/client.go');
        const f = c.slice(c.indexOf('func (c *Client) loadServerRegistry('));
        const rumpf = f.slice(0, f.indexOf('\n}\n'));
        assert.match(rumpf, /bestand := c\.serverManager\.ResteAufraeumen\(allowedServers\)/);
        assert.match(rumpf, /c\.serverManager\.ContainerWaisenAufraeumen\(allowedServers\)/);
        assert.match(rumpf, /go c\.meldeReste\(bestand\)/);
        assert.ok(!/DeleteServerVolume|ScanExistingServers/.test(rumpf), 'der alte Volume-Weg steht noch daneben');
        assert.match(c, /c\.SendEvent\(context\.Background\(\), protocol\.NSReste, "befund", daten\)/);
    });
    await pruefe('reste.go räumt Volumes, Laufzeitordner, Freigaben und Sicherungen — mit Schonfrist', () => {
        const r = go('internal/gameserver/reste.go');
        assert.match(r, /m\.laufWurzel\(\)/);
        assert.match(r, /oeffentlichOrdner/);
        assert.match(r, /m\.backupDir\("0"\)/);
        assert.match(r, /serverfiles/);
        assert.match(r, /alter < resteSchonfrist/);
        assert.match(r, /resteSchonfrist = time\.Hour/);
    });
    await pruefe('das Löschen eines Servers nimmt den Laufzeitordner mit', () => {
        const u = go('internal/gameserver/uninstall.go');
        assert.match(u, /auftrag\.Raeume\(m\.laufWurzel\(\), serverID\)/);
    });
    await pruefe('der systemd-Befehl gameserver.cleanup_orphaned ist weg — ein Aufräumweg, nicht zwei', () => {
        const alle = ['internal/websocket/client.go', 'internal/gameserver/manager.go'].map(go).join('\n');
        assert.ok(!/cleanup_orphaned|CleanupOrphanedServers|removeSystemdService/.test(alle));
        const plan = fs.readFileSync(path.join(WURZEL, 'packages/firebus/fahrplan.json'), 'utf8');
        assert.ok(!/gameserver\.cleanup_orphaned/.test(plan));
        assert.match(plan, /"name": "reste\.befund", "art": "ereignis", "von": "daemon"/);
    });

    console.log('\nMaschinen');
    let db = null;
    try {
        require(path.join(WURZEL, 'node_modules/dotenv')).config({ path: path.join(WURZEL, 'apps/dashboard/.env'), quiet: true });
        const mysql = require(path.join(WURZEL, 'node_modules/mysql2/promise'));
        db = await mysql.createConnection({
            host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT) || 3306,
            user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
            database: process.env.MYSQL_DATABASE, connectTimeout: 4000,
        });
    } catch (e) {
        fehler++;
        console.log(`  ✗ Datenbank nicht erreichbar: ${e.message.split('\n')[0]}`);
    }
    if (db) {
        try {
            const nur = { query: async (sql, w) => (await db.query(sql, w))[0] };
            const [[spalte]] = await db.query("SHOW COLUMNS FROM rootserver LIKE 'reste_befund'");
            if (!spalte) {
                fehler++;
                console.log('  ✗ rootserver.reste_befund fehlt — die Migration kommt mit dem Dashboard-Neustart');
            } else {
                const [maschinen] = await db.query('SELECT id FROM rootserver ORDER BY id');
                for (const { id } of maschinen) {
                    const s = await Reste.lade(nur, id);
                    const alter = s.rootserver.reste_am ? ` (Bestand vom ${new Date(s.rootserver.reste_am).toLocaleString('de-DE')})` : '';
                    await pruefe(`${id} „${s.rootserver.name}"${alter}`, () => {
                        assert.ok(s.befunde.length === 0, s.befunde.join('\n'));
                    });
                }
            }
        } finally {
            await db.end();
        }
    }

    console.log(`\nErgebnis: ${fehler ? fehler + ' Abweichung(en)' : 'alles grün'}`);
    process.exit(fehler ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
