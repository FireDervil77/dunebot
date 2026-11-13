#!/usr/bin/env node
/**
 * Guild verlassen: sofort löschen, aber über die Erklärungen (G-04d, K381,
 * F-G3 C, 2026-11-13).
 *
 * Der Bot setzt beim `guildDelete` nur `guilds.left_at` und stößt das Dashboard
 * an (`GuildManager.removeGuild`). Gelöscht wird im Dashboard
 * (`apps/dashboard/helpers/VerlasseneGuilds.js`) über
 * `Datenauskunft.guildLoeschen`. Vorher löschte der Bot selbst über
 * `SHOW TABLES` aus jeder Tabelle mit `guild_id` (`_cleanupAllGuildData`),
 * Gameserver ohne Stoppen, Kontroll-Guild eingeschlossen.
 *
 *   Quelltext    im Bot-Kern löscht nichts mehr; der alte Weg ist weg;
 *                Anstoß, IPC-Fall und Start nach den Plugins sind da
 *   Bot          removeGuild mit Attrappen: Ausfall, schon gelöscht,
 *                Kontroll-Guild, Anstoß, Dashboard nicht erreichbar
 *   Dashboard    lauf() mit Attrappen: gelöscht, zurückgekehrt, gescheitert,
 *                Kontroll-Guild, Rückmeldung je Plugin im Log, Anstoß
 *                während eines Laufs
 *   Echt         Probelauf (Rollback) für jede Guild, die heute `left_at`
 *                trägt: Das löscht der erste Lauf nach dem Neustart
 *   Gegenproben  im Speicher
 *
 *   node scripts/check-verlassen.js
 *
 * Geschrieben wird nichts. Der Probelauf rollt zurück, das misst
 * `check-datenauskunft.js` nach.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const WURZEL = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(WURZEL, 'apps/dashboard/.env'), quiet: true });
const { ohneKommentare } = require('./lib/quelltext');

const datei = (p) => path.join(WURZEL, p);
const lies = (p) => fs.readFileSync(datei(p), 'utf8');

let fehler = 0;
async function pruefe(was, tun) {
    try { await tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').slice(0, 20).join('\n      ')}`); }
}

/** Logger, der mitschreibt. */
function mitschreiber() {
    const zeilen = [];
    const l = {};
    for (const s of ['info', 'warn', 'error', 'debug', 'success']) l[s] = (text) => zeilen.push(`${s}: ${text}`);
    l.zeilen = zeilen;
    return l;
}

/**
 * Datenbank-Attrappe: kennt nur die Abfragen, die erwartet sind. Alles andere
 * wirft, damit eine neue Abfrage nicht still eine leere Antwort bekommt.
 */
function dbAttrappe(regeln) {
    const gesehen = [];
    return {
        gesehen,
        async query(sql, werte = []) {
            const s = sql.replace(/\s+/g, ' ').trim();
            gesehen.push(s);
            for (const [muster, antwort] of regeln) {
                if (muster.test(s)) return typeof antwort === 'function' ? antwort(werte) : antwort;
            }
            throw new Error(`Attrappe: unbekannte Abfrage „${s}“`);
        },
    };
}

/** Quelltext ohne Kommentare, damit erklärender Text nicht zählt. */
function code(p) { return ohneKommentare(lies(p)); }

/** Bot-Seite: Quelltext-Prüfungen. */
function quelltextBot(gm) {
    assert(!/_cleanupAllGuildData/.test(gm), '_cleanupAllGuildData ist noch da (zwei Wege)');
    assert(!/SHOW\s+TABLES/i.test(gm), 'GuildManager fragt noch SHOW TABLES');
    assert(!/\bDELETE\s+FROM\b/i.test(gm), 'GuildManager löscht selbst (DELETE FROM)');
    assert(/core:VERLASSEN_ANSTOSS/.test(gm), 'removeGuild stößt das Dashboard nicht an');
    assert(/SET\s+left_at\s*=\s*NOW\(\)/i.test(gm), 'removeGuild setzt left_at nicht');
}

(async () => {
    console.log('\nGuild verlassen (G-04d, K381)');
    const { ServiceManager } = require('dunebot-core');

    // ── Quelltext ───────────────────────────────────────────────────────────
    await pruefe('Bot-Kern löscht nicht mehr selbst, setzt left_at und stößt an', () => {
        quelltextBot(code('packages/dunebot-core/lib/GuildManager.js'));
        const ereignis = code('apps/bot/events/guildDelete.js');
        assert(/removeGuild\(guild\)/.test(ereignis), 'guildDelete ruft removeGuild nicht');
        assert(!/DELETE\s+FROM/i.test(ereignis), 'guildDelete löscht selbst');
    });
    await pruefe('Kein anderer Ort im Bot und in den Paketen löscht nach SHOW TABLES', () => {
        const funde = [];
        const gehe = (ordner) => {
            for (const e of fs.readdirSync(datei(ordner), { withFileTypes: true })) {
                if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
                const p = path.join(ordner, e.name);
                if (e.isDirectory()) gehe(p);
                else if (e.name.endsWith('.js') && /SHOW\s+TABLES/i.test(code(p)) && /DELETE\s+FROM\s+`?\$\{/i.test(code(p))) funde.push(p);
            }
        };
        for (const o of ['apps/bot', 'packages/dunebot-core', 'packages/dunebot-sdk']) gehe(o);
        assert.deepStrictEqual(funde, [], `löscht über SHOW TABLES: ${funde.join(', ')}`);
    });
    await pruefe('Dashboard: IPC-Fall VERLASSEN_ANSTOSS weckt den Aufräumer', () => {
        const ipc = code('apps/dashboard/helpers/IPCServer.js');
        const fall = ipc.slice(ipc.indexOf("case 'VERLASSEN_ANSTOSS'"));
        assert(ipc.includes("case 'VERLASSEN_ANSTOSS'"), 'Fall fehlt');
        assert(/verlasseneGuilds'\)\.wecken\(\)/.test(fall.slice(0, 600)), 'Fall weckt den Aufräumer nicht');
    });
    await pruefe('Dashboard: Aufräumer startet nach dem Laden der Plugins', () => {
        const app = code('apps/dashboard/app.js');
        const plugins = app.indexOf('await this.loadPlugins()');
        const start = app.indexOf("require('./helpers/VerlasseneGuilds').starten()");
        assert(plugins > 0, 'loadPlugins nicht gefunden');
        assert(start > plugins, 'VerlasseneGuilds startet nicht nach loadPlugins');
    });
    await pruefe('Aufräumer löscht nur über Datenauskunft.guildLoeschen', () => {
        const v = code('apps/dashboard/helpers/VerlasseneGuilds.js');
        assert(/Datenauskunft\.guildLoeschen\(/.test(v), 'ruft guildLoeschen nicht');
        assert(!/\b(DELETE|UPDATE|INSERT)\b/i.test(v), 'schreibt selbst in die Datenbank');
    });

    // ── Bot: removeGuild mit Attrappen ──────────────────────────────────────
    const GuildManager = require(datei('packages/dunebot-core/lib/GuildManager.js'));
    const KONTROLL = String(process.env.CONTROL_GUILD_ID || '565123525795643393');
    process.env.CONTROL_GUILD_ID = KONTROLL;

    async function botFall({ available = true, guildId = '111111111111111111', zeilen = 1, ipc = 'ok' }) {
        const logger = mitschreiber();
        const db = dbAttrappe([[/^UPDATE guilds SET left_at = NOW\(\), updated_at = NOW\(\) WHERE _id = \?$/, { affectedRows: zeilen }]]);
        const gesendet = [];
        const ipcClient = {
            async sendToDashboard(event, payload, frist) {
                gesendet.push({ event, payload, frist });
                if (ipc === 'ok') return { success: true };
                return { success: false, error: 'IPC nicht verbunden' };
            },
        };
        ServiceManager.register('Logger', logger);
        ServiceManager.register('dbService', db);
        ServiceManager.register('ipcClient', ipcClient);
        await new GuildManager().removeGuild({ id: guildId, name: 'Probe', available });
        return { logger, db, gesendet };
    }

    await pruefe('Ausfall bei Discord (available false): nichts', async () => {
        const r = await botFall({ available: false });
        assert.strictEqual(r.db.gesehen.length, 0);
        assert.strictEqual(r.gesendet.length, 0);
    });
    await pruefe('Normal: left_at gesetzt, Anstoß mit Frist, Hinweis aufs Dashboard-Log', async () => {
        const r = await botFall({});
        assert.strictEqual(r.db.gesehen.length, 1);
        assert.deepStrictEqual(r.gesendet.map(g => g.event), ['core:VERLASSEN_ANSTOSS']);
        assert(r.gesendet[0].frist > 0 && r.gesendet[0].frist <= 10000, `Frist ${r.gesendet[0].frist}`);
        assert(r.logger.zeilen.some(z => /^info: .*das Dashboard löscht jetzt/.test(z)), r.logger.zeilen.join('\n'));
    });
    await pruefe('Schon gelöscht (Server löschen, G-04c): kein Anstoß', async () => {
        const r = await botFall({ zeilen: 0 });
        assert.strictEqual(r.gesendet.length, 0);
        assert(r.logger.zeilen.some(z => /schon gelöscht/.test(z)));
    });
    await pruefe('Kontroll-Guild: left_at gesetzt, Fehler im Log, kein Anstoß', async () => {
        const r = await botFall({ guildId: KONTROLL });
        assert.strictEqual(r.gesendet.length, 0);
        assert(r.logger.zeilen.some(z => /^error: .*Kontroll-Guild/.test(z)));
    });
    await pruefe('Dashboard nicht erreichbar: Warnung, dass es nachholt', async () => {
        const r = await botFall({ ipc: 'aus' });
        assert(r.logger.zeilen.some(z => /^warn: .*nicht angestoßen.*nächsten Start/.test(z)), r.logger.zeilen.join('\n'));
    });

    // ── Dashboard: lauf() mit Attrappen ─────────────────────────────────────
    const D = require(datei('apps/dashboard/helpers/Datenauskunft.js'));
    const echtesGuildLoeschen = D.guildLoeschen;
    const V = require(datei('apps/dashboard/helpers/VerlasseneGuilds.js'));

    /**
     * Gilden: { id: { name, zurueck?, ergebnis } }. `ergebnis` ist, was
     * guildLoeschen liefert ('wirft' wirft).
     */
    async function dashboardFall(gilden, { waehrend } = {}) {
        const logger = mitschreiber();
        const aufrufe = [];
        const offen = () => Object.entries(gilden).filter(([, g]) => !g.weg).map(([id, g]) => ({ _id: id, guild_name: g.name }));
        const db = dbAttrappe([
            [/^SELECT _id, guild_name FROM guilds WHERE left_at IS NOT NULL ORDER BY left_at, _id$/, () => offen()],
            [/^SELECT left_at FROM guilds WHERE _id = \?$/, ([id]) => (gilden[id]?.zurueck ? [{ left_at: null }] : [{ left_at: new Date() }])],
        ]);
        ServiceManager.register('Logger', logger);
        ServiceManager.register('dbService', db);
        D.guildLoeschen = async (id, opt) => {
            aufrufe.push({ id, opt });
            const g = gilden[id];
            if (waehrend && aufrufe.length === 1) waehrend();
            if (g.ergebnis === 'wirft') throw new Error('PluginManager fehlt');
            if (g.ergebnis.ok) g.weg = true;
            return g.ergebnis;
        };
        try {
            const stand = await V.lauf();
            return { stand, logger, aufrufe };
        } finally {
            D.guildLoeschen = echtesGuildLoeschen;
        }
    }

    const ok = (geloescht) => ({ ok: true, fehler: null, abgeschaltet: [{ plugin: 'gameserver', ok: true }, { plugin: 'ticket', ok: true, hinweis: 'nicht geladen, nur die Zeilen gehen' }], geloescht });
    const gescheitert = { ok: false, fehler: 'gameserver: Aufräumen gescheitert, das Plugin bleibt an. Daemon weg', abgeschaltet: [{ plugin: 'gameserver', ok: false, fehler: 'Daemon weg' }], geloescht: {} };

    await pruefe('Lauf: gelöscht, zurückgekehrt, gescheitert, Kontroll-Guild', async () => {
        const r = await dashboardFall({
            '222222222222222222': { name: 'Weg', ergebnis: ok({ gameserver: { gameservers: 2 }, core: { guilds: 1, configs: 30 } }) },
            '333333333333333333': { name: 'Zurück', zurueck: true, ergebnis: ok({}) },
            '444444444444444444': { name: 'Klemmt', ergebnis: gescheitert },
            '555555555555555555': { name: 'Wirft', ergebnis: 'wirft' },
            [KONTROLL]: { name: 'Kontroll', ergebnis: ok({}) },
        });
        assert.deepStrictEqual(r.stand, { geloescht: 1, zurueck: 1, gescheitert: 2, kontrollGuild: true });
        assert.deepStrictEqual(r.aufrufe.map(a => a.id).sort(), ['222222222222222222', '444444444444444444', '555555555555555555']);
        assert(r.aufrufe.every(a => a.opt.anlass === V.ANLASS && !a.opt.trocken), 'Anlass oder Probelauf falsch');
        const log = r.logger.zeilen.join('\n');
        assert(/info: \[Verlassen\] Guild „Weg“.*gelöscht\. Abgeschaltet: gameserver, ticket \(nicht geladen, nur die Zeilen gehen\)\. Zeilen: gameserver: gameservers 2 · core: guilds 1, configs 30/.test(log), log);
        assert(/info: \[Verlassen\] Guild „Zurück“.*wieder dort/.test(log), log);
        assert(/error: \[Verlassen\] Guild „Klemmt“.*nicht gelöscht.*Grund: gameserver: Aufräumen gescheitert.*Abgeschaltet: gameserver GESCHEITERT: Daemon weg/.test(log), log);
        assert(/error: \[Verlassen\] Guild „Wirft“.*Löschen gescheitert/.test(log), log);
        assert(/error: \[Verlassen\] Der Bot ist nicht mehr in der Kontroll-Guild/.test(log), log);
        assert.strictEqual(V.letzter().geloescht, 1);
    });
    await pruefe('Anstoß während eines Laufs: ein zweiter Durchgang folgt, kein paralleler', async () => {
        const gilden = { '666666666666666666': { name: 'Erste', ergebnis: ok({ core: { guilds: 1 } }) } };
        let parallel;
        const r = await dashboardFall(gilden, {
            waehrend: () => {
                gilden['777777777777777777'] = { name: 'Neu', ergebnis: ok({ core: { guilds: 1 } }) };
                parallel = V.lauf();
            },
        });
        assert.strictEqual(await parallel, null, 'zweiter Lauf lief parallel');
        assert.deepStrictEqual(r.aufrufe.map(a => a.id), ['666666666666666666', '777777777777777777']);
        assert.strictEqual(r.stand.geloescht, 2);
    });
    await pruefe('Nichts offen: kein Löschaufruf', async () => {
        const r = await dashboardFall({});
        assert.strictEqual(r.aufrufe.length, 0);
        assert.deepStrictEqual(r.stand, { geloescht: 0, zurueck: 0, gescheitert: 0, kontrollGuild: false });
    });

    // ── Echt: Probelauf für die heute verlassenen Guilds ────────────────────
    const { DBService } = require('dunebot-db-client');
    const echt = new DBService();
    ServiceManager.register('dbService', echt);
    ServiceManager.register('Logger', mitschreiber());
    await pruefe('Echt: Probelauf je verlassener Guild (Rollback), Kontroll-Guild trägt kein left_at', async () => {
        const offen = await echt.query('SELECT _id, guild_name FROM guilds WHERE left_at IS NOT NULL ORDER BY left_at, _id');
        assert(!offen.some(g => String(g._id) === KONTROLL), 'Kontroll-Guild trägt left_at');
        const zeilen = [];
        for (const g of offen) {
            const p = await D.guildLoeschen(g._id, { trocken: true, anlass: 'check-verlassen' });
            assert(p.ok, `${g._id}: ${p.fehler}`);
            const plugins = await echt.getEnabledPlugins(g._id);
            const n = Object.values(p.geloescht).flatMap(t => Object.values(t)).reduce((a, b) => a + b, 0);
            zeilen.push(`${g._id} „${g.guild_name}“: ${n} Zeile(n), ${plugins.filter(x => x !== 'core').length} Plugin(s) an`);
        }
        console.log(`      ${offen.length} verlassene Guild(s), die der erste Lauf löscht:`);
        for (const z of zeilen) console.log(`        ${z}`);
    });

    // ── Gegenproben ─────────────────────────────────────────────────────────
    await pruefe('Gegenproben: der alte Weg wäre rot', () => {
        const alt = 'async _cleanupAllGuildData(g, db) { const t = await db.query("SHOW TABLES"); await db.query(`DELETE FROM \\`${t}\\` WHERE guild_id = ?`); }';
        for (const [name, quelle] of [
            ['alter Weg', alt],
            ['ohne Anstoß', 'await db.query("UPDATE guilds SET left_at = NOW() WHERE _id = ?")'],
            ['löscht selbst', 'core:VERLASSEN_ANSTOSS; SET left_at = NOW(); DELETE FROM guilds WHERE _id = ?'],
        ]) {
            assert.throws(() => quelltextBot(quelle), undefined, `${name} wäre grün`);
        }
    });

    await echt.pool?.end?.().catch(() => {});
    console.log(fehler ? `\n${fehler} Prüfung(en) rot\n` : '\nalles grün\n');
    process.exit(fehler ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
