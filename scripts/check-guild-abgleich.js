#!/usr/bin/env node
/**
 * Abgleich der Guilds mit Discord (K383) und der tote Beitrittsweg (K384),
 * 2026-11-14.
 *
 * K383: Wird der Bot hinausgeworfen, während er aus ist, kommt kein
 * `guildDelete`. Einmal am Tag fragt das Dashboard (`GuildAbgleich.js`,
 * Zeitplan `core:guild-abgleich`) den Bot (`apps/bot/ipc/GUILDS_ABGLEICH.js`),
 * der fragt Discord per REST und bestätigt jede fehlende Guild einzeln.
 * K384: `dashboard:GUILD_JOINED` ging nie hinaus und ist entfernt.
 *
 *   Quelltext    kein GUILD_JOINED mehr; Handler fragt REST, nicht den Cache;
 *                Abgleich im Zeitplan, nach VerlasseneGuilds gestartet
 *   Bot          Handler mit REST-Attrappe: Seiten, 10004, 50001, 5xx, zurück
 *   Dashboard    abgleichen() mit Attrappen: markiert, Schranken (fremde
 *                Anwendung, ohne CLIENT_ID, Kontroll-Guild fehlt, Discord
 *                leer, Bot antwortet nicht), höchstens drei je Lauf, trocken
 *   Echt         Discord per REST und die Datenbank, trocken: Das markiert
 *                der erste Lauf
 *   Gegenproben  abgewandelte Quellen müssen rot werden
 *
 *   node scripts/check-guild-abgleich.js
 *
 * Geschrieben wird nichts. Der echte Teil liest die Datenbank und fragt Discord
 * mit dem Token des Bots (nur GET).
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const WURZEL = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(WURZEL, 'apps/dashboard/.env'), quiet: true });
const { ohneKommentare } = require('./lib/quelltext');

const datei = (p) => path.join(WURZEL, p);
const lies = (p) => fs.readFileSync(datei(p), 'utf8');
const code = (p) => ohneKommentare(lies(p));

const KONTROLL = String(process.env.CONTROL_GUILD_ID || '');
const CLIENT = String(process.env.CLIENT_ID || '');

let fehler = 0;
async function pruefe(was, tun) {
    try { await tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').slice(0, 20).join('\n      ')}`); }
}

function mitschreiber() {
    const zeilen = [];
    const l = { zeilen };
    for (const s of ['info', 'warn', 'error', 'debug', 'success']) l[s] = (text) => zeilen.push(`${s}: ${text}`);
    return l;
}

function dbAttrappe(regeln) {
    const gesehen = [];
    return {
        gesehen,
        async query(sql, werte = []) {
            const s = sql.replace(/\s+/g, ' ').trim();
            gesehen.push({ s, werte });
            for (const [muster, antwort] of regeln) {
                if (muster.test(s)) return typeof antwort === 'function' ? antwort(werte) : antwort;
            }
            throw new Error(`Attrappe: unbekannte Abfrage „${s}“`);
        },
    };
}

/**
 * Eine Datei aus Quelltext laden (für Gegenproben), mit den echten Abhängigkeiten.
 * Die Gegenproben lesen die Quelle deshalb roh (`lies`, nicht `code`): Sie wird
 * an einer Stelle abgewandelt und ausgeführt, Kommentare stören dabei nicht.
 * Alle Quelltext-Prüfungen oben gehen über `code` (ohne Kommentare).
 */
function ladeAus(quelle, alsDatei) {
    const m = new Module(alsDatei, module);
    m.filename = alsDatei;
    m.paths = Module._nodeModulePaths(path.dirname(alsDatei));
    m._compile(quelle, alsDatei);
    return m.exports;
}

const discordFehler = (status, codeNr, message) => Object.assign(new Error(message), { status, code: codeNr });

/**
 * REST-Attrappe. `liste` sind die Guilds, in denen der Bot laut Discord ist,
 * `einzeln` die Antwort je Guild auf GET /guilds/{id} (Funktion wirft oder gibt).
 */
function restAttrappe({ botId = CLIENT, liste = [], einzeln = {}, listeWirft = null }) {
    const aufrufe = [];
    return {
        aufrufe,
        async get(route, opt = {}) {
            aufrufe.push(route + (opt.query ? `?${opt.query}` : ''));
            if (route === '/users/@me') return { id: botId };
            if (route === '/users/@me/guilds') {
                if (listeWirft) throw listeWirft;
                const limit = Number(opt.query.get('limit'));
                const nach = opt.query.get('after');
                const sortiert = [...liste].sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1));
                const ab = nach ? sortiert.filter(id => BigInt(id) > BigInt(nach)) : sortiert;
                return ab.slice(0, limit).map(id => ({ id }));
            }
            const m = /^\/guilds\/(\d+)$/.exec(route);
            if (m) {
                const f = einzeln[m[1]];
                if (!f) throw new Error(`Attrappe: GET ${route} unerwartet`);
                return f();
            }
            throw new Error(`Attrappe: unbekannte Route ${route}`);
        },
    };
}

/** Gültige, sortierbare Guild-IDs. */
const gid = (n) => String(100000000000000000n + BigInt(n));

(async () => {
    const { ServiceManager } = require('dunebot-core');

    // ── Quelltext ───────────────────────────────────────────────────────────
    console.log('Quelltext');
    function quelltextBeitritt(gm) {
        assert(!/GUILD_JOINED/.test(gm), 'GuildManager sendet noch GUILD_JOINED');
        assert(!/_notifyDashboardJoined/.test(gm), '_notifyDashboardJoined ist noch da');
        assert(!/client\??\.ipcClient/.test(gm), 'GuildManager liest noch client.ipcClient');
    }
    function quelltextHandler(h) {
        assert(/Routes\.userGuilds\(\)/.test(h), 'Handler fragt nicht GET /users/@me/guilds');
        assert(/Routes\.guild\(/.test(h), 'Handler fragt fehlende Guilds nicht einzeln nach');
        assert(!/guilds\.cache/.test(h), 'Handler liest den Cache (unter Shards sieht jeder nur seine Guilds)');
        assert(!/\b(UPDATE|DELETE|INSERT)\b/.test(h), 'Handler schreibt in die Datenbank');
    }
    await pruefe('K384: GuildManager ohne GUILD_JOINED, niemand im Dashboard hört darauf', () => {
        quelltextBeitritt(code('packages/dunebot-core/lib/GuildManager.js'));
        const { execFileSync } = require('child_process');
        const treffer = execFileSync('git', ['grep', '-l', 'GUILD_JOINED', '--', 'apps', 'packages', 'plugins'],
            { cwd: WURZEL, encoding: 'utf8' }).trim().split('\n').filter(Boolean)
            .filter(f => f !== 'scripts/check-guild-abgleich.js')
            .filter(f => /GUILD_JOINED/.test(ohneKommentare(lies(f))));
        assert.deepStrictEqual(treffer, [], `GUILD_JOINED noch im Code: ${treffer.join(', ')}`);
    });
    await pruefe('Handler fragt Discord per REST, nicht den Cache, und schreibt nichts', () => {
        quelltextHandler(code('apps/bot/ipc/GUILDS_ABGLEICH.js'));
    });
    await pruefe('Abgleich im Zeitplan (core:guild-abgleich), gestartet nach VerlasseneGuilds', () => {
        const app = code('apps/dashboard/app.js');
        const v = app.indexOf("require('./helpers/VerlasseneGuilds').starten()");
        const a = app.indexOf("require('./helpers/GuildAbgleich').starten()");
        assert(v > 0 && a > v, 'GuildAbgleich.starten() fehlt oder kommt vor VerlasseneGuilds');
        assert(/Zeitplan\.eintragen\('core:guild-abgleich'/.test(code('apps/dashboard/helpers/GuildAbgleich.js')),
            'nicht im Zeitplan eingetragen');
    });

    // ── Bot: Handler mit REST-Attrappe ──────────────────────────────────────
    console.log('Bot');
    const handlerPfad = datei('apps/bot/ipc/GUILDS_ABGLEICH.js');
    const handler = require(handlerPfad);
    process.env.CONTROL_GUILD_ID = KONTROLL || gid(1);
    const K = process.env.CONTROL_GUILD_ID;

    async function botFall(h, rest, ids) { return h({ guildIds: ids }, { rest }); }

    await pruefe('Alle drin: nichts weg, keine Einzelabfrage', async () => {
        const rest = restAttrappe({ liste: [K, gid(2), gid(3)] });
        const r = await botFall(handler, rest, [K, gid(2), gid(3)]);
        assert.deepStrictEqual([r.weg, r.drin, r.unklar], [[], [], []]);
        assert.strictEqual(r.kontrollGuild, true);
        assert.strictEqual(r.discord, 3);
        assert(!rest.aufrufe.some(a => /^\/guilds\//.test(a)), 'unnötige Einzelabfrage');
    });
    await pruefe('Fehlt: 10004 und 50001 sind weg, 500 unklar, 200 wieder drin', async () => {
        const rest = restAttrappe({
            liste: [K],
            einzeln: {
                [gid(2)]: () => { throw discordFehler(404, 10004, 'Unknown Guild'); },
                [gid(3)]: () => { throw discordFehler(403, 50001, 'Missing Access'); },
                [gid(4)]: () => { throw discordFehler(500, 0, 'Internal Server Error'); },
                [gid(5)]: () => ({ id: gid(5) }),
                [gid(6)]: () => { throw new Error('socket hang up'); },
            },
        });
        const r = await botFall(handler, rest, [K, gid(2), gid(3), gid(4), gid(5), gid(6)]);
        assert.deepStrictEqual(r.weg, [gid(2), gid(3)]);
        assert.deepStrictEqual(r.drin, [gid(5)]);
        assert.deepStrictEqual(r.unklar.map(u => u.id), [gid(4), gid(6)]);
    });
    await pruefe('Mehr als 200 Guilds: zweite Seite mit after', async () => {
        const liste = [K, ...Array.from({ length: 250 }, (_, i) => gid(10 + i))];
        const rest = restAttrappe({ liste, einzeln: { [gid(5)]: () => { throw discordFehler(404, 10004, 'Unknown Guild'); } } });
        const r = await botFall(handler, rest, [gid(259), gid(5)]);
        assert.strictEqual(r.discord, 251);
        assert.deepStrictEqual(r.weg, [gid(5)], 'Guild auf Seite 2 wäre als weg gezählt');
        assert(rest.aufrufe.some(a => /after=/.test(a)), 'keine zweite Seite');
    });
    await pruefe('Liste scheitert oder Eingabe kaputt: wirft, nichts als weg gemeldet', async () => {
        await assert.rejects(botFall(handler, restAttrappe({ listeWirft: discordFehler(401, 0, '401: Unauthorized') }), [gid(2)]), /Unauthorized/);
        await assert.rejects(botFall(handler, restAttrappe({}), ['abc']), /guildIds/);
        await assert.rejects(handler({}, { rest: restAttrappe({}) }), /guildIds/);
    });
    await pruefe('Kontroll-Guild nicht in der Liste: kontrollGuild false', async () => {
        const r = await botFall(handler, restAttrappe({ liste: [gid(2)] }), [gid(2)]);
        assert.strictEqual(r.kontrollGuild, false);
    });

    // ── Dashboard: abgleichen() mit Attrappen ───────────────────────────────
    console.log('Dashboard');
    const abgleichPfad = datei('apps/dashboard/helpers/GuildAbgleich.js');
    const A = require(abgleichPfad);
    const V = require(datei('apps/dashboard/helpers/VerlasseneGuilds.js'));
    const weckenEcht = V.wecken;

    /**
     * @param {Object} o
     * @param {Object[]} o.offen Zeilen aus guilds ohne left_at (schon nach updated_at sortiert)
     * @param {Object} o.antwort Hülle des Bots
     */
    async function dashboardFall({ offen, antwort, clientId = CLIENT || gid(99), trocken = false, modul = A, ablauf = 'abgleichen' }) {
        const db = dbAttrappe([
            [/^SELECT _id, guild_name FROM guilds WHERE left_at IS NULL ORDER BY updated_at, _id$/, offen],
            [/^UPDATE guilds SET left_at = NOW\(\), updated_at = NOW\(\) WHERE _id = \? AND left_at IS NULL$/, { affectedRows: 1 }],
        ]);
        const gesendet = [];
        const ipc = { async broadcastOne(ev, data) { gesendet.push({ ev, data }); return typeof antwort === 'function' ? antwort(data) : antwort; } };
        const logger = mitschreiber();
        ServiceManager.register('dbService', db);
        ServiceManager.register('ipcServer', ipc);
        ServiceManager.register('Logger', logger);
        const altClient = process.env.CLIENT_ID;
        if (clientId === null) delete process.env.CLIENT_ID; else process.env.CLIENT_ID = clientId;
        let geweckt = 0;
        V.wecken = () => { geweckt++; };
        try {
            let ergebnis, wurf;
            try { ergebnis = ablauf === 'taeglich' ? await modul.taeglich() : await modul.abgleichen({ trocken }); }
            catch (e) { wurf = e; }
            const markiert = db.gesehen.filter(q => /^UPDATE/.test(q.s)).map(q => q.werte[0]);
            return { ergebnis, wurf, markiert, gesendet, geweckt, log: logger.zeilen };
        } finally {
            V.wecken = weckenEcht;
            if (altClient === undefined) delete process.env.CLIENT_ID; else process.env.CLIENT_ID = altClient;
        }
    }
    const zeile = (n, name = `G${n}`) => ({ _id: gid(n), guild_name: name });
    const bot = (o) => ({ success: true, data: { botId: CLIENT || gid(99), discord: 5, kontrollGuild: true, weg: [], drin: [], unklar: [], ...o } });

    await pruefe('Eine weg: markiert, geweckt, Log nennt sie', async () => {
        const r = await dashboardFall({ offen: [zeile(2, 'Alt'), zeile(3)], antwort: bot({ weg: [gid(2)] }), ablauf: 'taeglich' });
        assert(!r.wurf, r.wurf?.message);
        assert.deepStrictEqual(r.markiert, [gid(2)]);
        assert.strictEqual(r.geweckt, 1);
        assert.deepStrictEqual(r.gesendet[0].data.guildIds, [gid(2), gid(3)]);
        assert.strictEqual(r.gesendet[0].ev, 'dashboard:GUILDS_ABGLEICH');
        assert(r.log.some(z => /\[Abgleich\].*Alt/.test(z)), 'Log nennt die Guild nicht');
    });
    await pruefe('Keine weg: nichts markiert, nicht geweckt', async () => {
        const r = await dashboardFall({ offen: [zeile(2)], antwort: bot({ unklar: [{ id: gid(2), fehler: '500' }] }), ablauf: 'taeglich' });
        assert(!r.wurf, r.wurf?.message);
        assert.deepStrictEqual([r.markiert, r.geweckt], [[], 0]);
        assert(/unklar 1/.test(r.ergebnis), r.ergebnis);
    });
    for (const [was, o, muster] of [
        ['andere Anwendung', { antwort: bot({ weg: [gid(2)], botId: gid(77) }) }, /andere Anwendung/],
        ['CLIENT_ID fehlt', { antwort: bot({ weg: [gid(2)] }), clientId: null }, /CLIENT_ID fehlt/],
        ['Kontroll-Guild fehlt bei Discord', { antwort: bot({ weg: [gid(2)], kontrollGuild: false }) }, /Kontroll-Guild/],
        ['Discord meldet nichts', { antwort: bot({ weg: [gid(2)], discord: 0 }) }, /keine einzige/],
        ['Bot antwortet nicht', { antwort: { success: false, error: 'Kein Bot verbunden' } }, /nicht geantwortet/],
        ['Antwort unvollständig', { antwort: { success: true, data: { botId: CLIENT } } }, /unvollständig/],
    ]) {
        await pruefe(`Schranke: ${was} → wirft, nichts markiert`, async () => {
            const r = await dashboardFall({ offen: [zeile(2)], ...o, ablauf: 'taeglich' });
            assert(r.wurf, 'warf nicht');
            assert(muster.test(r.wurf.message), r.wurf.message);
            assert.deepStrictEqual([r.markiert, r.geweckt], [[], 0]);
        });
    }
    await pruefe('Kontroll-Guild als weg gemeldet: wird nie markiert', async () => {
        const r = await dashboardFall({ offen: [zeile(1), { _id: K, guild_name: 'Kontrolle' }], antwort: bot({ weg: [K] }) });
        assert(!r.wurf, r.wurf?.message);
        assert.deepStrictEqual(r.markiert, []);
    });
    await pruefe(`Fünf weg: höchstens ${A.HOECHSTENS} markiert, die ältesten zuerst, Lauf rot`, async () => {
        const offen = [zeile(5), zeile(4), zeile(3), zeile(2), zeile(6)];
        const r = await dashboardFall({ offen, antwort: bot({ weg: [gid(2), gid(3), gid(4), gid(5), gid(6)] }), ablauf: 'taeglich' });
        assert.deepStrictEqual(r.markiert, [gid(5), gid(4), gid(3)]);
        assert(r.wurf && /2 weitere warten/.test(r.wurf.message), r.wurf?.message);
        assert.strictEqual(r.geweckt, 1, 'Markierte nicht gelöscht');
        assert(r.log.some(z => /^error: \[Abgleich\].*G2.*G6/.test(z)), 'Wartende nicht im Log');
    });
    await pruefe('Trocken: nennt, was markiert würde, schreibt nichts', async () => {
        const r = await dashboardFall({ offen: [zeile(2)], antwort: bot({ weg: [gid(2)] }), trocken: true });
        assert(!r.wurf, r.wurf?.message);
        assert.deepStrictEqual(r.markiert, []);
        assert.deepStrictEqual(r.ergebnis.markiert.map(g => g._id), [gid(2)]);
    });

    // ── Echt: Discord und Datenbank, trocken ───────────────────────────────
    console.log('Echt');
    const { DBService } = require('dunebot-db-client');
    const echt = new DBService();
    await pruefe('Echt: Discord per REST, Datenbank lesend — das markiert der erste Lauf', async () => {
        const { REST } = require(require.resolve('discord.js', { paths: [datei('apps/bot')] }));
        const botEnv = require('dotenv').parse(fs.readFileSync(datei('apps/bot/.env')));
        assert(botEnv.BOT_TOKEN, 'BOT_TOKEN fehlt in apps/bot/.env');
        const rest = new REST({ version: '10' }).setToken(botEnv.BOT_TOKEN);
        process.env.CONTROL_GUILD_ID = KONTROLL;
        ServiceManager.register('dbService', echt);
        ServiceManager.register('Logger', mitschreiber());
        ServiceManager.register('ipcServer', {
            async broadcastOne(ev, data) {
                assert.strictEqual(ev, 'dashboard:GUILDS_ABGLEICH');
                return { success: true, data: await handler(data, { rest }) };
            },
        });
        const e = await A.abgleichen({ trocken: true });
        console.log(`      ${e.geprueft} Guild(s) ohne left_at, Discord kennt ${e.discord}, verlassen ${e.weg.length}, ` +
            `unklar ${e.unklar.length}, zurück ${e.drin.length}`);
        for (const g of e.markiert) console.log(`        markiert der erste Lauf: ${g._id} „${g.guild_name}“`);
        if (e.wartet) console.log(`        ${e.wartet} weitere warten`);
        assert.strictEqual(e.unklar.length, 0, `unklar: ${JSON.stringify(e.unklar)}`);
    });
    await echt.pool?.end?.().catch(() => {});

    // ── Gegenproben ─────────────────────────────────────────────────────────
    console.log('Gegenproben');
    await pruefe('Gegenproben Quelltext: alter GuildManager, Handler über den Cache', () => {
        assert.throws(() => quelltextBeitritt('_notifyDashboardJoined(g) { g.client?.ipcClient.send("dashboard:GUILD_JOINED") }'));
        assert.throws(() => quelltextHandler('Routes.userGuilds(); Routes.guild(id); client.guilds.cache.has(id)'));
        assert.throws(() => quelltextHandler("Routes.userGuilds(); db.query('UPDATE guilds SET left_at')"));
    });
    await pruefe('Gegenprobe Bot: jede Absage als weg gezählt wäre rot', async () => {
        const quelle = lies('apps/bot/ipc/GUILDS_ABGLEICH.js');
        const falsch = quelle.replace('if (ABSAGEN.has(e?.code)) weg.push(id);', 'if (true) weg.push(id);');
        assert.notStrictEqual(falsch, quelle, 'Ersetzung griff nicht');
        const h = ladeAus(falsch, handlerPfad + '.gegenprobe.js');
        const r = await botFall(h, restAttrappe({ liste: [K], einzeln: { [gid(4)]: () => { throw discordFehler(500, 0, 'x'); } } }), [gid(4)]);
        assert.deepStrictEqual(r.weg, [gid(4)], 'Gegenprobe zeigt den Fehler nicht');
    });
    await pruefe('Gegenproben Dashboard: ohne Schranke Kontroll-Guild, ohne Höchstzahl', async () => {
        const quelle = lies('apps/dashboard/helpers/GuildAbgleich.js');
        for (const [ersetze, durch, fall, erwartet] of [
            ["if (!a.kontrollGuild) throw", 'if (false) throw', { antwort: bot({ weg: [gid(2)], kontrollGuild: false }) }, [gid(2)]],
            ['weg.slice(0, HOECHSTENS)', 'weg.slice(0)', { antwort: bot({ weg: [gid(2), gid(3), gid(4), gid(5)] }) }, [gid(2), gid(3), gid(4), gid(5)]],
        ]) {
            const falsch = quelle.replace(ersetze, durch);
            assert.notStrictEqual(falsch, quelle, `Ersetzung „${ersetze}“ griff nicht`);
            const M = ladeAus(falsch, abgleichPfad + '.gegenprobe.js');
            const r = await dashboardFall({ offen: [zeile(2), zeile(3), zeile(4), zeile(5)], ...fall, modul: M });
            assert.deepStrictEqual(r.markiert, erwartet, `Gegenprobe „${ersetze}“ zeigt den Fehler nicht`);
        }
    });

    console.log(fehler ? `\n${fehler} Prüfung(en) rot\n` : '\nalles grün\n');
    process.exit(fehler ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
