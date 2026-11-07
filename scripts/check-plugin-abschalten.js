#!/usr/bin/env node
/**
 * Plugin abschalten: Rückfrage und Kontroll-Guild (Betreiber 2026-10-29: F19, F30).
 *
 * Der Knopf „Deaktivieren" hatte keine Rückfrage. Ein Fehlklick bei Gameserver
 * stoppte und löschte alle Server der Guild samt Dateien, auch in der
 * Kontroll-Guild.
 *
 *   Dialog      das echte Inline-Skript: Der Klick löst nichts aus, der Knopf
 *               bleibt gesperrt, bis der Name GENAU dasteht, erst dann geht das
 *               Formular mit `bestaetigung` hinaus
 *   Controller  ohne den Namen 400, disableInGuild wird gar nicht gerufen
 *   Löschen     das echte disableInGuild: normale Guild löscht nach
 *               `guildInhalte` in package.json, Kontroll-Guild behält Inhalte
 *               und verliert nur Menü
 *   Abbruch     scheitert onGuildDisable oder das Löschen, bleibt das Plugin an
 *               und nichts weiter wird gelöscht (Betreiber 2026-11-07)
 *
 * Ob die Listen vollständig sind, prüft scripts/check-guild-inhalte.js.
 *
 *   node scripts/check-plugin-abschalten.js
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ejs = require('ejs');
const WURZEL = path.join(__dirname, '..');
const { ServiceManager } = require('dunebot-core');
const { ohneKommentare } = require('./lib/quelltext');

let fehler = 0;
async function pruefe(was, tun) {
    try { await tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').slice(0, 3).join('\n      ')}`); }
}
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), 'utf8');
const VORLAGE = 'apps/dashboard/themes/default/views/guild/plugins.ejs';

/** Das Inline-Skript der Seite mit einem kleinen Dokument. */
function dialog() {
    const quelle = lies(VORLAGE);
    const ab = quelle.indexOf('<script data-abschalten-skript>');
    const skript = quelle.slice(quelle.indexOf('>', ab) + 1, quelle.indexOf('</script>', ab));
    const el = (id) => ({ id, value: '', textContent: '', disabled: false, addEventListener() {} });
    const elemente = Object.fromEntries(['pluginAbschaltenModal', 'pluginAbschaltenEingabe', 'pluginAbschaltenKnopf',
        'pluginAbschaltenName', 'pluginAbschaltenSoll', 'pluginAbschaltenWeg'].map(id => [id, el(id)]));
    let lauscher = null, einfang = null, gezeigt = 0;
    const document = {
        addEventListener: (n, f, e) => { lauscher = f; einfang = e; },
        getElementById: (id) => elemente[id] || null,
    };
    const bootstrap = { Modal: { getOrCreateInstance: () => ({ show() { gezeigt++; }, hide() {} }) } };
    vm.runInNewContext(skript, { document, bootstrap });
    return { elemente, lauscher: () => lauscher, einfang: () => einfang, gezeigt: () => gezeigt };
}

/** Das Formular und ein submit-Ereignis, das mitzählt. */
function formular(name, d) {
    const f = {
        dataset: { abschalten: name, abschaltenWeg: 'Alle Gameserver' },
        elements: { bestaetigung: { value: '' } },
        abgeschickt: 0,
        requestSubmit() { f.abgeschickt++; },
    };
    f.ereignis = () => {
        const e = { target: f, verhindert: false, angehalten: false,
            preventDefault() { e.verhindert = true; }, stopImmediatePropagation() { e.angehalten = true; } };
        d.lauscher()(e);
        return e;
    };
    return f;
}

(async () => {
    console.log('\nPlugin abschalten (F19, F30)');

    await pruefe('Dialog: Klick löst nichts aus, gesperrt bis zum genauen Namen', async () => {
        const d = dialog();
        assert.strictEqual(d.einfang(), true, 'muss vor dem Formular-Helfer greifen (Einfangphase)');
        const f = formular('gameserver', d);
        const e = f.ereignis();
        assert.ok(e.verhindert && e.angehalten, 'das Formular ging ohne Rückfrage hinaus');
        assert.strictEqual(d.gezeigt(), 1);
        const { pluginAbschaltenEingabe: ein, pluginAbschaltenKnopf: knopf, pluginAbschaltenWeg: weg } = d.elemente;
        assert.strictEqual(weg.textContent, 'Alle Gameserver');
        assert.strictEqual(knopf.disabled, true);
        for (const falsch of ['', 'gameserve', 'Gameserver', 'gameserver x']) {
            ein.value = falsch; ein.oninput();
            assert.strictEqual(knopf.disabled, true, `„${falsch}" schaltet den Knopf frei`);
            knopf.onclick();
            assert.strictEqual(f.abgeschickt, 0, `„${falsch}" schickt ab`);
        }
        ein.value = ' gameserver '; ein.oninput();
        assert.strictEqual(knopf.disabled, false);
        knopf.onclick();
        assert.strictEqual(f.abgeschickt, 1);
        assert.strictEqual(f.elements.bestaetigung.value, 'gameserver');
        const zweites = f.ereignis();
        assert.strictEqual(zweites.verhindert, false, 'das bestätigte Absenden wurde wieder abgefangen');
        assert.strictEqual(f.ereignis().verhindert, true, 'die Bestätigung gilt nur einmal');
    });

    await pruefe('Andere Formulare der Seite bleiben unberührt', async () => {
        const d = dialog();
        const e = { target: { dataset: {} }, preventDefault() { throw new Error('abgefangen'); } };
        d.lauscher()(e);
    });

    await pruefe('Vorlage: beide Knöpfe tragen Dialog und Feld, Texte in beiden Sprachen', async () => {
        const q = lies(VORLAGE);
        ejs.compile(q, { filename: path.join(WURZEL, VORLAGE) });
        assert.strictEqual((q.match(/name="action" value="disable"/g) || []).length, 2);
        assert.strictEqual((q.match(/data-abschalten="<%= p\.name %>"/g) || []).length, 2, 'ein Knopf ohne Dialog');
        assert.strictEqual((q.match(/name="bestaetigung"/g) || []).length, 2);
        const de = JSON.parse(lies('apps/dashboard/locales/de-DE.json')).ADMIN_PAGE;
        const en = JSON.parse(lies('apps/dashboard/locales/en-GB.json')).ADMIN_PAGE;
        assert.strictEqual(de.DISABLE_DIALOG_IRREVERSIBLE, 'Das lässt sich nicht zurücknehmen.');
        const namen = [...q.match(/MIT_INHALTEN = \[([^\]]+)\]/)[1].matchAll(/'([a-z]+)'/g)].map(t => t[1]);
        assert.ok(namen.length >= 8, `nur ${namen.length} Plugins im Dialog`);
        for (const n of namen) {
            assert.ok(de[`DISABLE_GOES_${n.toUpperCase()}`] && en[`DISABLE_GOES_${n.toUpperCase()}`], `Text für ${n} fehlt`);
            assert.match(lies(`plugins/${n}/dashboard/index.js`), /async onGuildDisable/);
        }
    });

    await pruefe('Controller: ohne den Namen kein Abschalten', async () => {
        const hier = lies('apps/dashboard/controllers/guild.controller.js');
        const ab = hier.indexOf("} else if (action === 'disable')");
        const zweig = hier.slice(ab, hier.indexOf('disableInGuild', ab));
        assert.match(zweig, /plugins\.some\(plugin => plugin !== bestaetigung\)/);
        assert.match(zweig, /return res\.status\(400\)/);
    });

    // ── Das echte disableInGuild ─────────────────────────────────────────
    const still = () => {};
    const Logger = { debug: still, info: still, warn: still, error: still, success: still };
    let abfragen = [];
    let menue = [];
    let abgeschaltet = 0;
    let zeilenFehler = null;
    ServiceManager.register('Logger', Logger);
    ServiceManager.register('dbService', {
        query: async (sql) => { abfragen.push(sql.trim()); return { affectedRows: 0 }; },
        loescheGuildZeilen: async (tabellen, g) => {
            if (zeilenFehler) throw zeilenFehler;
            for (const t of tabellen) abfragen.push(`DELETE FROM ${t} WHERE guild_id = ${g}`);
            return Object.fromEntries(tabellen.map(t => [t, 0]));
        },
        disablePluginForGuild: async () => { abgeschaltet++; },
    });
    ServiceManager.register('navigationManager', { removeNavigation: async (p, g) => { menue.push([p, g]); } });
    ServiceManager.register('permissionManager', { unregisterPluginPermissions: async () => {} });
    const PluginManager = require('../apps/dashboard/helpers/PluginManager');
    const Klasse = PluginManager.PluginManager || PluginManager;

    async function schalteAb(guildId, { aufraeumen = async () => {} } = {}) {
        abfragen = []; menue = []; abgeschaltet = 0;
        let geloescht = 0;
        const plugin = {
            name: 'probe',
            onGuildDisable: async () => { geloescht++; await aufraeumen(); },
        };
        const dies = Object.create(Klasse.prototype);
        dies.hooks = { doAction: async () => {} };
        dies.getPlugin = () => plugin;
        dies.loadPluginMeta = () => ({ guildInhalte: { loeschen: ['probe_kind', 'probe_tabelle'] } });
        dies._isPluginActiveInGuild = async () => false;
        await Klasse.prototype.disableInGuild.call(dies, 'probe', guildId);
        return { geloescht, abfragen, menue, abgeschaltet };
    }

    await pruefe('Normale Guild: onGuildDisable, Konfiguration und Tabellen werden geleert', async () => {
        process.env.CONTROL_GUILD_ID = '111';
        const r = await schalteAb('222');
        assert.strictEqual(r.geloescht, 1);
        assert.ok(r.abfragen.some(q => /^DELETE FROM configs/.test(q)), 'Konfiguration blieb');
        assert.ok(r.abfragen.some(q => /^DELETE FROM probe_tabelle/.test(q)), 'Tabelle blieb');
        assert.ok(r.abfragen.findIndex(q => /probe_kind/.test(q)) < r.abfragen.findIndex(q => /probe_tabelle/.test(q)),
            'Reihenfolge der Liste nicht gehalten');
        assert.strictEqual(r.abgeschaltet, 1);
    });

    await pruefe('Abbruch: scheitert onGuildDisable, bleibt das Plugin an und nichts wird gelöscht', async () => {
        process.env.CONTROL_GUILD_ID = '111';
        await assert.rejects(schalteAb('222', { aufraeumen: async () => { throw new Error('Server Bude kommt nicht herunter'); } }),
            /probe: Aufräumen gescheitert, das Plugin bleibt an\. Server Bude kommt nicht herunter/);
        assert.deepStrictEqual(abfragen.filter(q => /^DELETE/i.test(q)), [], 'nach dem Fehlschlag wurde gelöscht');
        assert.strictEqual(abgeschaltet, 0, 'das Plugin wurde trotzdem abgeschaltet');
        assert.deepStrictEqual(menue, [], 'das Menü ging trotzdem');
    });

    await pruefe('Abbruch: scheitert das Löschen der Zeilen, bleibt das Plugin an', async () => {
        process.env.CONTROL_GUILD_ID = '111';
        zeilenFehler = new Error('Cannot delete or update a parent row');
        try {
            await assert.rejects(schalteAb('222'), /probe: Löschen der Inhalte gescheitert, das Plugin bleibt an/);
            assert.strictEqual(abgeschaltet, 0);
            assert.ok(!abfragen.some(q => /^DELETE FROM configs/.test(q)), 'Konfiguration trotz Fehlschlag gelöscht');
        } finally { zeilenFehler = null; }
    });

    await pruefe('Kontroll-Guild: Inhalte bleiben, nur das Menü geht', async () => {
        process.env.CONTROL_GUILD_ID = '111';
        const r = await schalteAb('111');
        assert.strictEqual(r.geloescht, 0, 'onGuildDisable lief in der Kontroll-Guild');
        assert.deepStrictEqual(r.abfragen.filter(q => /^DELETE/i.test(q)), [], 'in der Kontroll-Guild wurde gelöscht');
        assert.deepStrictEqual(r.menue, [['probe', '111']]);
    });

    // ── Gameserver: jeder Server über Loeschung ──────────────────────────
    await pruefe('Gameserver: jeder Server über Loeschung, ein bleibender bricht ab, ein Umzug hält alles an', async () => {
        const Loeschung = require('../plugins/gameserver/dashboard/helpers/Loeschung');
        const GameserverPlugin = require('../plugins/gameserver/dashboard/index.js');
        const echt = { beginne: Loeschung.beginne, fuehreAus: Loeschung.fuehreAus };
        let server = [], gerufen = [], privat = 0;
        ServiceManager.register('dbService', {
            query: async (sql) => {
                if (/FROM gameservers gs/.test(sql)) return server;
                if (/^DELETE FROM addon_marketplace/.test(sql.trim())) { privat++; return { affectedRows: 0 }; }
                if (/COUNT\(\*\) AS anzahl/.test(sql)) return [{ anzahl: 0 }];
                throw new Error('unerwartete Abfrage: ' + sql.trim().slice(0, 60));
            },
        });
        const abbau = () => GameserverPlugin.prototype.onGuildDisable.call({ name: 'gameserver' }, '222');
        try {
            Loeschung.beginne = async (id) => { gerufen.push(['beginne', id]); return true; };
            Loeschung.fuehreAus = async ({ server: s, erzwingen }) => {
                gerufen.push(['loesche', s.id, erzwingen]);
                return s.id === 2 ? { ok: false, grund: 'kommt nicht herunter' } : { ok: true };
            };

            server = [{ id: 1, name: 'Bude', umzug_status: null }, { id: 2, name: 'Zelt', umzug_status: 'transferring' }];
            await assert.rejects(abbau(), /Im Umzug: Zelt/);
            assert.deepStrictEqual(gerufen, [], 'trotz Umzug wurde ein Server angefasst');

            server = [{ id: 1, name: 'Bude', umzug_status: null }, { id: 2, name: 'Zelt', umzug_status: null }];
            await assert.rejects(abbau(), /Nicht alle Gameserver gelöscht — Zelt: kommt nicht herunter/);
            assert.deepStrictEqual(gerufen, [['beginne', 1], ['loesche', 1, true], ['beginne', 2], ['loesche', 2, true]]);
            assert.strictEqual(privat, 0, 'private Pakete gelöscht, obwohl ein Server blieb');

            gerufen = []; server = [{ id: 1, name: 'Bude', umzug_status: null }];
            assert.strictEqual(await abbau(), true);
            assert.deepStrictEqual(gerufen, [['beginne', 1], ['loesche', 1, true]]);
            assert.strictEqual(privat, 1);
        } finally { Object.assign(Loeschung, echt); }
    });

    // ── Discord /plugin status (F4, Betreiber 2026-11-07) ────────────────
    // Das Dashboard schaltet, der Bot folgt den Erfolgen, Discord zeigt den
    // Ausgang. Abschalten nur mit den eingetippten Namen.
    const pluginBefehl = require('../apps/bot/commands/plugin.js');
    async function discord({ an = ['gameserver', 'music'], gewaehlt, getippt = null, dashboard }) {
        const spur = { fenster: 0, ipc: [], bot: [], texte: [] };
        const text = (k, w) => `${k}${w ? ' ' + JSON.stringify(w) : ''}`;
        const anzeige = { edit: async ({ content }) => { spur.texte.push(content); } };
        const fensterAntwort = getippt === null ? null : {
            customId: null, user: { id: 'u1' },
            fields: { getTextInputValue: () => getippt },
            update: async ({ content }) => { spur.texte.push(content); return anzeige; },
        };
        const waiter = {
            id: 'w1', values: gewaehlt, user: { id: 'u1' },
            update: async ({ content }) => { spur.texte.push(content); return anzeige; },
            showModal: async (m) => { spur.fenster++; if (fensterAntwort) fensterAntwort.customId = m.data.custom_id; },
            awaitModalSubmit: async ({ filter }) => {
                if (!fensterAntwort || !filter(fensterAntwort)) throw new Error('Zeitablauf');
                return fensterAntwort;
            },
        };
        const sentMsg = {
            channel: { awaitMessageComponent: async ({ filter }) => {
                assert.ok(filter({ customId: 'plugin-status-menu', user: { id: 'u1' } }));
                return waiter;
            } },
            edit: async ({ content }) => { spur.texte.push(content); },
        };
        const alle = ['core', 'gameserver', 'music', 'ticket'].map(name => ({ name }));
        const nachricht = {
            guild: { id: '222', getT: (k, w) => text(k.replace('core:PLUGIN.', ''), w) },
            member: { id: 'u1' },
            reply: async () => sentMsg,
            client: { pluginManager: {
                plugins: alle,
                istVerfuegbar: () => true,
                enableInGuild: async (n) => { spur.bot.push(['ein', n]); return true; },
                disableInGuild: async (n) => { spur.bot.push(['aus', n]); return true; },
            } },
        };
        ServiceManager.register('dbService', { getEnabledPlugins: async () => ['core', ...an] });
        ServiceManager.register('ipcClient', { sendToDashboard: async (ereignis, nutzlast, frist) => {
            spur.ipc.push({ ereignis, nutzlast, frist });
            return dashboard(nutzlast);
        } });
        await pluginBefehl.messageRun({ message: nachricht, args: ['status'] });
        return spur;
    }
    const ok = (n) => ({ success: true, data: { ergebnisse: [
        ...n.enabled.map(p => ({ plugin: p, aktion: 'ein', ok: true })),
        ...n.disabled.map(p => ({ plugin: p, aktion: 'aus', ok: true })),
    ] } });

    await pruefe('Discord: Abwählen fragt nach den Namen, falsche Namen ändern nichts', async () => {
        const r = await discord({ gewaehlt: ['core', 'music'], getippt: 'gameservr', dashboard: ok });
        assert.strictEqual(r.fenster, 1, 'kein Fenster zum Bestätigen');
        assert.deepStrictEqual(r.ipc, [], 'trotz falscher Namen ans Dashboard');
        assert.deepStrictEqual(r.bot, []);
        assert.match(r.texte.at(-1), /^STATUS_CONFIRM_MISMATCH.*gameserver/);
    });

    await pruefe('Discord: ohne Bestätigung nichts geändert', async () => {
        const r = await discord({ gewaehlt: ['core', 'music'], getippt: null, dashboard: ok });
        assert.deepStrictEqual(r.ipc, []);
        assert.match(r.texte.at(-1), /^STATUS_CONFIRM_TIMEOUT/);
    });

    await pruefe('Discord: richtige Namen — erst das Dashboard, dann der Bot, Ausgang in Discord', async () => {
        const r = await discord({ gewaehlt: ['core', 'music', 'ticket'], getippt: ' GameServer ', dashboard: ok });
        assert.strictEqual(r.ipc.length, 1);
        assert.strictEqual(r.ipc[0].ereignis, 'core:UPDATE_PLUGIN_STATUS');
        assert.deepStrictEqual(r.ipc[0].nutzlast, { guildId: '222', enabled: ['ticket'], disabled: ['gameserver'] });
        assert.ok(r.ipc[0].frist >= 10 * 60 * 1000, 'zu kurze Frist für das Abschalten von Gameservern');
        assert.deepStrictEqual(r.bot, [['ein', 'ticket'], ['aus', 'gameserver']]);
        assert.match(r.texte.at(-1), /STATUS_RESULT_ON \{"liste":"ticket"\}\nSTATUS_RESULT_OFF \{"liste":"gameserver"\}/);
    });

    await pruefe('Discord: bricht das Dashboard ab, folgt der Bot nicht und Discord nennt den Grund', async () => {
        const r = await discord({ gewaehlt: ['core', 'music'], getippt: 'gameserver', dashboard: () => ({ success: false, data: { ergebnisse: [
            { plugin: 'gameserver', aktion: 'aus', ok: false, grund: 'Zelt kommt nicht herunter' }] } }) });
        assert.deepStrictEqual(r.bot, [], 'der Bot schaltete trotz Abbruch ab');
        assert.match(r.texte.at(-1), /STATUS_RESULT_FAILED.*Zelt kommt nicht herunter/);
    });

    await pruefe('Discord: antwortet das Dashboard nicht, ändert der Bot nichts', async () => {
        const r = await discord({ gewaehlt: ['core', 'music'], getippt: 'gameserver', dashboard: () => ({ success: false, error: 'Zeitüberschreitung' }) });
        assert.deepStrictEqual(r.bot, []);
        assert.match(r.texte.at(-1), /^STATUS_NO_DASHBOARD.*Zeitüberschreitung/);
    });

    await pruefe('Discord: nur einschalten braucht kein Fenster, schon Abgeschaltetes wird nicht erneut abgeschaltet', async () => {
        const r = await discord({ an: ['music'], gewaehlt: ['core', 'music', 'ticket'], dashboard: ok });
        assert.strictEqual(r.fenster, 0);
        assert.deepStrictEqual(r.ipc[0].nutzlast, { guildId: '222', enabled: ['ticket'], disabled: [] });
        const nichts = await discord({ an: ['music'], gewaehlt: ['core', 'music'], dashboard: ok });
        assert.deepStrictEqual(nichts.ipc, []);
        assert.match(nichts.texte.at(-1), /^STATUS_NOTHING/);
    });

    await pruefe('Dashboard: UPDATE_PLUGIN_STATUS meldet je Plugin, ein Fehlschlag ist kein success', async () => {
        const IPCServer = require('../apps/dashboard/helpers/IPCServer');
        const Klasse = IPCServer.IPCServer || IPCServer;
        ServiceManager.register('pluginManager', {
            enableInGuild: async () => false,
            disableInGuild: async (n) => { if (n === 'gameserver') throw new Error('gameserver: Aufräumen gescheitert'); return true; },
        });
        let antwort = null;
        await Klasse.prototype._handleCoreEvent.call(Object.create(Klasse.prototype), 'UPDATE_PLUGIN_STATUS',
            { guildId: '222', enabled: ['ticket'], disabled: ['gameserver', 'music'] }, { reply: (a) => { antwort = a; } });
        assert.strictEqual(antwort.success, false);
        assert.deepStrictEqual(antwort.data.ergebnisse.map(e => [e.plugin, e.aktion, e.ok]),
            [['ticket', 'ein', false], ['gameserver', 'aus', false], ['music', 'aus', true]]);
        assert.match(antwort.data.ergebnisse[1].grund, /Aufräumen gescheitert/);
    });

    await pruefe('Dashboard-Knopf: der Bot hört nur von den gelungenen Plugins, false gilt als Fehlschlag', async () => {
        const c = ohneKommentare(lies('apps/dashboard/controllers/guild.controller.js'));
        assert.match(c, /for \(const plugin of results\.filter\(r => r\.success\)\.map\(r => r\.plugin\)\)[\s\S]{0,120}broadcastOne\("dashboard:UPDATE_PLUGIN"[\s\S]{0,200}plugins: \[plugin\]/);
        assert.match(c, /await pluginManager\.enableInGuild\(plugin, guildId, req\) !== true/);
        assert.match(c, /await pluginManager\.disableInGuild\(plugin, guildId, req\) !== true/);
    });

    console.log(fehler ? `\n✗ ${fehler} Prüfung(en) rot` : '\n✅ Abschalten nur mit Namen, die Kontroll-Guild behält ihre Inhalte');
    process.exit(fehler ? 1 : 0);
})();
