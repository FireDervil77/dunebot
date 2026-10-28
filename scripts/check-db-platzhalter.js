#!/usr/bin/env node
/**
 * Stufe 11 S5 (2026-10-28): der Zugang zur Datenbank kommt über `{{db:…}}`
 * ins Spiel.
 *
 * Geprüft wird die Dashboard-Hälfte — der Daemon hat seine Tests
 * (pkgspec/datenbank_test.go, auftrag/datenbank_test.go):
 *
 *   - Die Liste der Schlüssel steht im Dashboard und im Daemon gleich.
 *   - Der Startbefehl trägt den Zugang (Kennwort entschlüsselt), und ohne
 *     Datenbank startet nur ein Paket nicht, das sie verlangt
 *     (Betreiber, 2026-10-28: der Start bricht wegen einer fehlenden nicht ab).
 *   - Schema und Werkbank kennen `db` und weisen einen falschen Schlüssel ab.
 *
 *   node scripts/check-db-platzhalter.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

process.env.TOKEN_ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY || 'waechter-schluessel-nur-fuer-die-pruefung';

const { ServiceManager } = require('dunebot-core');
const still = () => {};
if (!ServiceManager.has('Logger')) {
    ServiceManager.register('Logger', { debug: still, info: still, warn: still, error: still, success: still });
}

const WURZEL = path.join(__dirname, '..');
const DAEMON = process.env.DAEMON_REPO || path.join(WURZEL, '../firebot_daemon');
const HELFER = path.join(WURZEL, 'plugins/gameserver/dashboard/helpers');

const { encrypt } = require(path.join(WURZEL, 'apps/dashboard/helpers/utils'));
const Datenbanken = require(path.join(HELFER, 'Datenbanken'));

// ── Attrappe: nur die eine Abfrage, die der Start stellt ───────────────────
const db = {
    zeilen: [],
    async query(sql, params) {
        if (/FROM gameserver_datenbanken WHERE server_id = \? ORDER BY nr LIMIT 1/.test(sql)) {
            return this.zeilen.filter(z => z.server_id === Number(params[0])).sort((a, b) => a.nr - b.nr).slice(0, 1);
        }
        if (/FROM gameserver_content/.test(sql)) return [];
        throw new Error('Unerwartete Abfrage: ' + String(sql).trim().slice(0, 80));
    },
};
if (!ServiceManager.has('dbService')) ServiceManager.register('dbService', db);

const { buildStartPayload } = require(path.join(HELFER, 'StartPayload'));

let bestanden = 0;
async function pruefe(name, fn) {
    db.zeilen = [];
    try {
        await fn();
        console.log(`  ✓ ${name}`);
        bestanden++;
    } catch (fehler) {
        console.error(`  ✗ ${name}\n    ${fehler.message}`);
        process.exitCode = 1;
    }
}

function paket(datenbank) {
    return {
        format: 'FBPKG_v1',
        identity: { slug: 'probe', name: 'Probe', version: '1.0.0' },
        image: { ref: 'registry.firenetworks.de/fb/steamcmd', tag: '2026.10', digest: 'sha256:abc' },
        ports: [{ purpose: 'game', assign: 'pool', protocol: 'udp', required: true }],
        settings: [],
        env: { DB_HOST: '{{db:host}}', DB_PASSWORD: '{{db:password}}' },
        requirements: datenbank ? { database: datenbank } : {},
    };
}

function server(p) {
    return {
        id: 7, name: 'Probe', guild_id: 'g1', daemon_id: 'd1', rootserver_id: 55,
        paket_json: JSON.stringify(p), paket_slug: 'probe', paket_version: '1.0.0', paket_channel: 'test',
        paket_werte: '{}', install_path: '7-probe',
        ports: JSON.stringify({ game: { internal: 25000, external: 25000, protocol: 'udp' } }),
    };
}

(async () => {
    console.log('\nEine Liste, zwei Enden');

    await pruefe('DB_SCHLUESSEL im Dashboard = pkgspec.DbSchluessel im Daemon', async () => {
        const go = fs.readFileSync(path.join(DAEMON, 'internal/pkgspec/argv.go'), 'utf8');
        const m = go.match(/var DbSchluessel = \[\]string\{([^}]*)\}/);
        assert.ok(m, 'pkgspec.DbSchluessel nicht gefunden — Daemon-Repo unter ' + DAEMON + '?');
        const daemon = [...m[1].matchAll(/"([a-z]+)"/g)].map(x => x[1]);
        assert.deepStrictEqual(daemon, Datenbanken.DB_SCHLUESSEL);
    });

    await pruefe('Das Verweismuster des Daemons kennt db', async () => {
        const go = fs.readFileSync(path.join(DAEMON, 'internal/pkgspec/argv.go'), 'utf8');
        assert.match(go, /var verweis = regexp\.MustCompile\(`[^`]*\(setting\|port\|content\|env\|db\)/);
    });

    console.log('\nDer Startbefehl');

    await pruefe('Mit Datenbank: der Zugang geht mit, das Kennwort entschlüsselt', async () => {
        db.zeilen.push({ server_id: 7, nr: 2, name: 's7_2', kennwort_ver: encrypt('Zweite') },
                       { server_id: 7, nr: 1, name: 's7_1', kennwort_ver: encrypt('Geheim123') });
        const { payload, error } = await buildStartPayload(server(paket(null)), 'g1');
        assert.ok(!error, error);
        assert.deepStrictEqual(payload.datenbank, {
            host: 'fb-datenbank', port: 3306, name: 's7_1', user: 's7_1', password: 'Geheim123',
        }, 'die erste Datenbank gilt');
    });

    await pruefe('Ohne Datenbank, Paket kann sie nur: Start geht, ohne Feld', async () => {
        const { payload, error } = await buildStartPayload(server(paket(null)), 'g1');
        assert.ok(!error, error);
        assert.ok(payload && !('datenbank' in payload), 'ein leeres Feld sähe aus wie eine Datenbank');
    });

    await pruefe('Ohne Datenbank, Paket verlangt sie: kein Start, mit Weg', async () => {
        const { payload, error } = await buildStartPayload(server(paket('required')), 'g1');
        assert.strictEqual(payload, null);
        assert.match(error, /braucht eine Datenbank/);
        assert.match(error, /Server → Datenbanken/);
    });

    await pruefe('Kennwort nicht lesbar: verlangt → kein Start, sonst Start ohne', async () => {
        db.zeilen.push({ server_id: 7, nr: 1, name: 's7_1', kennwort_ver: 'kaputt' });
        let r = await buildStartPayload(server(paket('required')), 'g1');
        assert.strictEqual(r.payload, null);
        assert.match(r.error, /nicht lesbar/);
        r = await buildStartPayload(server(paket(null)), 'g1');
        assert.ok(r.payload && !('datenbank' in r.payload));
    });

    console.log('\nSchema und Werkbank');

    await pruefe('Schema: `from` nimmt db:<schlüssel>, aber keinen anderen', async () => {
        const schema = JSON.parse(fs.readFileSync(path.join(WURZEL, 'packages/fbpkg/schema/fbpkg-v1.schema.json'), 'utf8'));
        const muster = JSON.stringify(schema).match(/"pattern":"(\^\(fixed\|free[^"]*)"/);
        assert.ok(muster, 'Muster für `from` nicht gefunden');
        const re = new RegExp(JSON.parse(`"${muster[1]}"`));
        for (const k of Datenbanken.DB_SCHLUESSEL) assert.ok(re.test(`db:${k}`), `db:${k} abgewiesen`);
        assert.ok(!re.test('db:kennwort'), 'db:kennwort angenommen');
    });

    await pruefe('Werkbank-Startzeile: {{db:…}} als Text ja, ein falscher Schlüssel nein', async () => {
        const { argsAusZeilen } = require(path.join(WURZEL, 'plugins/werkbank/dashboard/helpers/Startzeile'));
        const args = argsAusZeilen([{ form: '-db={{db:host}}:{{db:port}}', quelle: 'text' }], []);
        assert.strictEqual(args[0].parts[0].text, '-db={{db:host}}:{{db:port}}');
        assert.throws(() => argsAusZeilen([{ form: '-db={{db:kennwort}}', quelle: 'text' }], []), /nur \{\{db:host\}\}/);
    });

    await pruefe('Werkbank-Festzeilen: dasselbe Muster wie der Daemon', async () => {
        const quelle = fs.readFileSync(path.join(WURZEL, 'plugins/werkbank/dashboard/helpers/Sitzungen.js'), 'utf8');
        assert.match(quelle, /const RE_FEST_VERWEIS = \/\^\\\{\\\{\(setting\|port\|content\|env\|db\)/);
        assert.match(quelle, /m\[1\] === 'db' && !DB_SCHLUESSEL\.includes\(m\[2\]\)/);
    });

    console.log(`\n${bestanden} Prüfung(en) bestanden.`);
})();
