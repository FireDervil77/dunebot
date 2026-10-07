#!/usr/bin/env node
/**
 * Prüft, dass die Live-Anzeige (Spieler, Map, Ping) aus dem PAKET kommt.
 *
 * Anlass (2026-09-25): Beim Umstieg von Eggs auf Spielpakete war die Anzeige
 * nicht mitgekommen. StatusService las nur `game_data.query` — das Egg.
 * `management.query` stand in jedem Paket, das Dashboard las es nirgends.
 * Minecraft zeigte nie Spieler, Valheim nur, weil sein Marktplatz-Eintrag das
 * Egg noch trug. Aufgefallen ist es erst beim Egg-Rückbau (Baustelle 166).
 * Dasselbe beim geplanten RCON-Befehl im CronWorker.
 *
 * Geprüft wird:
 *   1. jedes Paket mit `management.query` ergibt eine Abfrage, die GameDig
 *      kennt, auf einem Port, den das Paket bucht;
 *   2. jedes Paket HAT eine Live-Quelle — oder steht mit Grund und Bedingung
 *      in AUSNAHMEN (nie still übersprungen);
 *   3. der Status-Weg nimmt das Paket vor dem Egg (am echten Code, mit
 *      Attrappen-Datenbank, die unbekannte Abfragen meldet);
 *   4. CronWorker gibt das Paket an resolveRcon weiter.
 *
 *   node scripts/check-status-paket.js
 */

'use strict';

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

const WURZEL  = path.join(__dirname, '..');
const HELPERS = path.join(WURZEL, 'plugins/gameserver/dashboard/helpers');
const PAKETE  = path.join(WURZEL, 'packages/fbpkg/beispiele');

/**
 * Pakete ohne Live-Quelle — jede mit Grund und der Bedingung, unter der sie
 * hier wieder herausfällt. Eine Zeile ohne Bedingung wäre ein stilles continue.
 */
const AUSNAHMEN = {
    factorio: {
        grund: 'GameDigs Factorio-Abfrage läuft über die öffentliche Lobby von '
             + 'factorio.com — ein nicht gelisteter Server ist dort unsichtbar. '
             + 'Die Spielerliste gäbe es nur über RCON (/players online), und '
             + 'dafür hat das Paketformat noch kein Feld.',
        bis:   'management.rcon bekommt einen Spielerlisten-Befehl (Baustelle 167)',
    },
};

// ── Attrappen vor dem require ────────────────────────────────────────────────
const { ServiceManager } = require('dunebot-core');
const still = () => {};
if (!ServiceManager.has('Logger')) {
    ServiceManager.register('Logger', { debug: still, info: still, warn: still, error: still });
}
let dbAntworten = null;   // (sql, params) => rows — je Prüfung gesetzt
if (!ServiceManager.has('dbService')) {
    ServiceManager.register('dbService', {
        query: async (sql, params) => {
            const rows = dbAntworten?.(sql, params);
            if (rows === undefined) throw new Error(`Attrappe kennt diese Abfrage nicht: ${sql.replace(/\s+/g, ' ').slice(0, 90)}`);
            return rows;
        },
    });
}

const { statusDatenAusPaket, resolveStatusConfig } = require(path.join(HELPERS, 'StatusSchema'));
const StatusService = require(path.join(HELPERS, 'StatusService'));

let bestanden = 0;
async function check(name, fn) {
    try {
        await fn();
        console.log(`  ✓ ${name}`);
        bestanden++;
    } catch (err) {
        console.error(`  ✗ ${name}\n    ${err.message}`);
        process.exitCode = 1;
    }
}

/** Quelltext ohne Kommentare — sonst misst der Wächter die Prosa. */
function ohneKommentare(text) {
    return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

(async () => {
    const { games } = await import('gamedig');
    const protokolle = new Set(fs.readdirSync(path.join(WURZEL, 'node_modules/gamedig/protocols'))
        .map(n => n.replace(/\.js$/, '')));
    const kenntGameDig = typ => typ.startsWith('protocol-')
        ? protokolle.has(typ.slice('protocol-'.length))
        : Boolean(games[typ]);

    const pakete = fs.readdirSync(PAKETE).filter(n => n.endsWith('.json')).sort()
        .map(n => JSON.parse(fs.readFileSync(path.join(PAKETE, n), 'utf8')));

    console.log('\nLive-Quelle je Paket');
    for (const paket of pakete) {
        const slug = paket.identity.slug;
        const q = resolveStatusConfig(statusDatenAusPaket(paket)).query;
        if (!q) {
            const aus = AUSNAHMEN[slug];
            await check(`${slug}: keine Abfrage — ${aus ? 'Ausnahme' : 'FEHLT'}`, () => {
                assert.ok(aus, 'Das Paket nennt kein management.query; die Serverseite zeigt dann nie Spieler. '
                    + 'Abfrage ergänzen oder mit Grund und Bedingung in AUSNAHMEN.');
                console.log(`      Grund: ${aus.grund}\n      Bis:   ${aus.bis}`);
            });
            continue;
        }
        await check(`${slug}: ${q.gamedig_type} auf Port „${q.port_var}"`, () => {
            assert.ok(kenntGameDig(q.gamedig_type), `GameDig kennt "${q.gamedig_type}" nicht`);
            const zwecke = (paket.ports || []).map(p => p.purpose);
            assert.ok(zwecke.includes(q.port_var), `Port „${q.port_var}" bucht das Paket nicht (${zwecke.join(', ')})`);
        });
    }
    await check('Ausnahmen betreffen nur Pakete ohne Abfrage', () => {
        for (const slug of Object.keys(AUSNAHMEN)) {
            const p = pakete.find(x => x.identity.slug === slug);
            assert.ok(p, `Ausnahme für "${slug}", das Paket gibt es nicht mehr — Zeile löschen`);
            assert.ok(!p.management?.query, `"${slug}" hat inzwischen eine Abfrage — Ausnahme löschen`);
        }
    });
    await check('a2s wird zu GameDigs protocol-valve', () => {
        const q = statusDatenAusPaket({ management: { query: { protocol: 'a2s', port: 'query' } } }).query;
        assert.deepStrictEqual(q, { gamedig_type: 'protocol-valve', port_var: 'query' });
    });

    console.log('\nStatus-Weg nimmt das Paket vor dem Egg');
    const minecraft = pakete.find(p => p.identity.slug === 'minecraft');
    const egg = JSON.stringify({ query: { gamedig_type: 'valheim', port_var: 'game_plus_1' } });

    const antworte = ({ addonId, paket }) => (sql, params) => {
        if (/FROM gameservers WHERE id = \?/.test(sql)) {
            assert.deepStrictEqual(params, [7]);
            return [{ addon_marketplace_id: addonId, paket_werte: JSON.stringify({ max_players: '12' }) }];
        }
        // Das Paket des SERVERS — die Fassung seines Kanals (Baustelle 172). Bis zum
        // 2026-10-07 fragte der Code nach dem Addon; die Attrappe prüft deshalb mit,
        // dass der Kanal in der Abfrage steht und die Server-Kennung ankommt.
        if (/FROM gameservers gs\s+JOIN packages pk/.test(sql)) {
            assert.match(sql, /gs\.channel = 'test' OR v\.channel = 'stable'/, 'die Fassung hängt am Kanal des Servers');
            assert.deepStrictEqual(params, [7]);
            return paket ? [{ kanal: 'test', paket_json: JSON.stringify(paket) }] : [];
        }
        return undefined;
    };

    await check('Server mit Paket: Abfrage aus management.query, Egg wird übergangen', async () => {
        dbAntworten = antworte({ addonId: 1473, paket: minecraft });
        const q = await StatusService._statusQuelle({ id: 7, game_data: egg });
        assert.strictEqual(q.paket?.identity?.slug, 'minecraft');
        assert.strictEqual(resolveStatusConfig(q.gameData).query?.gamedig_type, 'minecraft');
        assert.strictEqual(StatusService._maxSpielerAusWerten(q.werte), 12);
    });
    await check('Server ohne Paket: Egg bleibt Rückfall', async () => {
        dbAntworten = antworte({ addonId: 99, paket: null });
        const q = await StatusService._statusQuelle({ id: 7, game_data: egg });
        assert.strictEqual(q.paket, null);
        assert.strictEqual(resolveStatusConfig(q.gameData).query?.gamedig_type, 'valheim');
    });

    const service = ohneKommentare(fs.readFileSync(path.join(HELPERS, 'StatusService.js'), 'utf8'));
    await check('_refreshNow holt die Quelle über _statusQuelle, nicht aus server.game_data', () => {
        const rumpf = service.slice(service.indexOf('static async _refreshNow('));
        const bis = rumpf.indexOf('\n    static ', 10);
        const refresh = bis > 0 ? rumpf.slice(0, bis) : rumpf;
        assert.ok(/_statusQuelle\(server\)/.test(refresh), '_statusQuelle wird nicht aufgerufen');
        assert.ok(!/server\.game_data/.test(refresh), 'liest server.game_data direkt — am Paket vorbei');
    });

    const cron = ohneKommentare(fs.readFileSync(path.join(HELPERS, 'CronWorker.js'), 'utf8'));
    await check('CronWorker: geplanter RCON-Befehl löst über das Paket auf', () => {
        assert.ok(/resolveRcon\(\{[\s\S]{0,120}paket[,\s]/.test(cron), 'resolveRcon bekommt kein paket');
        assert.ok(/rcon\.password\s*\|\|/.test(cron), 'Kennwort kommt nicht aus rcon.password');
    });

    console.log(`\n${bestanden} Prüfungen bestanden${process.exitCode ? ' — ES GIBT FEHLER' : ''}`);
})().catch(err => { console.error(err); process.exit(1); });
