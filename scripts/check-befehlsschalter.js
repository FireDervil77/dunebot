#!/usr/bin/env node
/**
 * Befehlsschalter je Guild: Slash-Befehle und Präfix-Befehle ganz aus (K365, 2026-11-11).
 *
 * Gedacht war (Betreiber 2026-11-11): Unter Einstellungen → Allgemein kann der
 * Betreiber einer Guild die Slash-Befehle und die Präfix-Befehle je ganz
 * abschalten. Gemessen am 2026-11-11 wirkte keiner von beiden:
 *
 *   - Die Werte kommen als Text ("1"/"0"); gelesen wurde mit `?? true`, und
 *     "0" ist wahr.
 *   - Die Befehle wurden bei Discord nur beim Start und beim Beitritt
 *     angemeldet, und bei „aus“ kehrte die Anmeldung vorzeitig zurück — der
 *     alte Satz blieb bei Discord stehen.
 *   - Für Präfix-Befehle gab es keinen Schalter auf der Seite.
 *
 * Geprüft wird am echten Code:
 *
 *   istAn         die eine Auslegung der Werte, im SDK
 *   Anmeldung     der echte CommandManager: „aus“ sendet einen leeren Satz,
 *                 „an“ Slash-Befehle UND Kontextmenüs (ein Schalter für beide),
 *                 unveränderter Satz sendet nichts
 *   Ausführen     das echte interactionCreate antwortet bei „aus“ mit
 *                 SLASH_DISABLED, das echte messageCreate schweigt bei „aus“
 *                 (auch auf eine Erwähnung)
 *   IPC           BEFEHLE_NEU_ANMELDEN meldet die Guild neu an, mit force
 *   Seite         die echte Route liest beide Schalter mit istAn, speichert
 *                 ein fehlendes Kästchen als 0, sagt dem Bot Bescheid und nennt
 *                 den Grund, wenn er nicht erreichbar ist; die Ansicht zeigt
 *                 beide Schalter
 *   Rückbau       DISABLED_PREFIX, DISABLED_SLASH, INTERACTIONS_CONTEXT und
 *                 CMD_DISABLED kommen im Code nicht mehr vor; coreConfig legt
 *                 die Schalter nicht ein drittes Mal aus
 *
 *   node scripts/check-befehlsschalter.js
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const WURZEL = path.join(__dirname, '..');
const { ServiceManager } = require('dunebot-core');
const { ohneKommentare, ohneKommentareEjs } = require('./lib/quelltext');

let fehler = 0;
async function pruefe(was, tun) {
    try { await tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').slice(0, 3).join('\n      ')}`); }
}
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), 'utf8');
const warte = (ms) => new Promise((r) => setTimeout(r, ms));

const still = { info() {}, debug() {}, warn() {}, error() {}, success() {} };
ServiceManager.register('Logger', still);
// Der CommandManager schreibt über den SDK-Logger; der braucht sonst `init()`.
const SdkLogger = require('dunebot-sdk/utils').Logger;
for (const k of Object.keys(still)) SdkLogger[k] = () => {};

// ── istAn ────────────────────────────────────────────────────────────────
async function teilIstAn() {
    console.log('istAn');
    const { istAn } = require('dunebot-sdk/utils');
    await pruefe('Text "0", "false", "off", 0, false → aus', () => {
        for (const w of ['0', 'false', 'off', ' 0 ', 0, false]) assert.strictEqual(istAn(w), false, JSON.stringify(w));
    });
    await pruefe('Text "1", "true", "on", 1, true → an', () => {
        for (const w of ['1', 'true', 'on', 'TRUE', 1, true]) assert.strictEqual(istAn(w), true, JSON.stringify(w));
    });
    await pruefe('fehlend oder unbekannt → Vorgabe', () => {
        assert.strictEqual(istAn(undefined), true);
        assert.strictEqual(istAn(null, false), false);
        assert.strictEqual(istAn('', false), false);
        assert.strictEqual(istAn('vielleicht', false), false);
    });
}

// ── Anmeldung bei Discord ────────────────────────────────────────────────
async function teilAnmeldung() {
    console.log('Anmeldung (CommandManager)');
    const CommandManager = require(path.join(WURZEL, 'apps/bot/helpers/CommandManager.js'));

    function aufbau(configs) {
        const gesendet = [];
        let gemerkt = null;
        const guild = {
            id: 'G1', name: 'Probe',
            commands: { set: async (satz) => { gesendet.push(satz); return new Map(satz.map((s) => [s.name, s])); } },
        };
        const client = {
            guilds: { cache: new Map([['G1', guild]]) },
            pluginManager: { isPluginEnabled: () => true },
            translate: (k) => k,
            i18n: { getAllTr: () => ({}) },
        };
        ServiceManager.register('client', client);
        ServiceManager.register('dbService', {
            getConfigs: async () => configs,
            query: async (sql, p) => {
                if (/FROM guild_plugins/.test(sql)) return [{ plugin_name: 'probe' }];
                if (/SELECT commands_hash/.test(sql)) return gemerkt ? [{ commands_hash: gemerkt }] : [];
                if (/INSERT INTO guild_command_state/.test(sql)) { gemerkt = p[1]; return []; }
                throw new Error('unbekannte Abfrage: ' + sql.trim().slice(0, 60));
            },
        });
        const cm = new CommandManager(client);
        cm.slashCommands.set('probe', { name: 'probe', description: 'probe:D', slashCommand: { options: [] }, plugin: { name: 'probe' } });
        cm.contextMenus.set('Avatar', { name: 'Avatar', type: 2, plugin: { name: 'probe' } });
        return { cm, gesendet, gemerkt: () => gemerkt };
    }

    await pruefe('„aus“ ("0") sendet einen leeren Satz', async () => {
        const { cm, gesendet } = aufbau({ INTERACTIONS_SLASH: '0' });
        await cm.registerInteractions('G1', true); await warte(100);
        assert.strictEqual(gesendet.length, 1, 'nichts gesendet — der alte Satz bliebe bei Discord');
        assert.deepStrictEqual(gesendet[0], []);
    });
    await pruefe('„an“ ("1") sendet Slash-Befehl und Kontextmenü', async () => {
        const { cm, gesendet } = aufbau({ INTERACTIONS_SLASH: '1' });
        await cm.registerInteractions('G1', true); await warte(100);
        assert.strictEqual(gesendet.length, 1);
        assert.deepStrictEqual(gesendet[0].map((s) => s.name).sort(), ['Avatar', 'probe']);
    });
    await pruefe('fehlender Schlüssel gilt als „an“', async () => {
        const { cm, gesendet } = aufbau({});
        await cm.registerInteractions('G1', true); await warte(100);
        assert.strictEqual(gesendet[0]?.length, 2);
    });
    await pruefe('unveränderter Satz wird nicht noch einmal gesendet', async () => {
        const { cm, gesendet } = aufbau({ INTERACTIONS_SLASH: '0' });
        await cm.registerInteractions('G1', true); await warte(100);
        await cm.registerInteractions('G1', true); await warte(100);
        assert.strictEqual(gesendet.length, 1);
    });
}

// ── Ausführen ────────────────────────────────────────────────────────────
async function teilAusfuehren() {
    console.log('Ausführen (interactionCreate, messageCreate)');
    let configs = {};
    ServiceManager.register('dbService', {
        getConfigs: async () => configs,
        getEnabledPlugins: async () => ['probe'],
        query: async (sql) => {
            if (/FROM guilds WHERE _id/.test(sql)) return [{ 1: 1 }];
            throw new Error('unbekannte Abfrage: ' + sql.trim().slice(0, 60));
        },
    });

    const interactionCreate = require(path.join(WURZEL, 'plugins/core/bot/events/interactionCreate.js'));
    function interaktion({ slash = true } = {}) {
        const antworten = [];
        const guild = { id: 'G1', name: 'Probe', getT: (k) => k };
        return {
            antworten,
            isAutocomplete: () => false, isModalSubmit: () => false,
            isChatInputCommand: () => slash, isContextMenuCommand: () => !slash,
            commandName: 'probe', guild,
            client: {
                guilds: { cache: new Map([['G1', guild]]) },
                commandManager: { findSlashCommand: () => null, findContextMenu: () => null },
            },
            reply: async (a) => { antworten.push(a.content); },
        };
    }
    await pruefe('Slash „aus“: Antwort SLASH_DISABLED statt Ausführung', async () => {
        configs = { INTERACTIONS_SLASH: '0' };
        const i = interaktion();
        await interactionCreate(i);
        assert.deepStrictEqual(i.antworten, ['core:HANDLER.SLASH_DISABLED']);
    });
    await pruefe('Slash „aus“ gilt auch für Kontextmenüs', async () => {
        configs = { INTERACTIONS_SLASH: '0' };
        const i = interaktion({ slash: false });
        await interactionCreate(i);
        assert.deepStrictEqual(i.antworten, ['core:HANDLER.SLASH_DISABLED']);
    });
    await pruefe('Slash „an“: geht weiter bis zur Befehlssuche', async () => {
        configs = { INTERACTIONS_SLASH: '1' };
        const i = interaktion();
        await interactionCreate(i);
        assert.deepStrictEqual(i.antworten, ['core:HANDLER.CMD_NOT_FOUND']);
    });

    const messageCreate = require(path.join(WURZEL, 'plugins/core/bot/events/messageCreate.js'));
    function nachricht() {
        const gesendet = [];
        const guild = { id: 'G1', name: 'Probe', client: { user: { id: 'BOT' }, commandManager: { findPrefixCommand: () => null } } };
        return {
            gesendet,
            guild, author: { bot: false }, content: 'hallo <@BOT>',
            client: { guilds: { cache: new Map([['G1', guild]]) } },
            channel: { send: async (t) => { gesendet.push(t); } },
        };
    }
    await pruefe('Präfix „aus“ ("0"): keine Antwort, auch nicht auf eine Erwähnung', async () => {
        configs = { PREFIX_COMMANDS_ENABLED: '0' };
        const n = nachricht();
        await messageCreate(n);
        assert.deepStrictEqual(n.gesendet, []);
    });
    await pruefe('Präfix „an“ ("1"): Erwähnung wird beantwortet', async () => {
        configs = { PREFIX_COMMANDS_ENABLED: '1', PREFIX_COMMANDS_PREFIX: '?' };
        const n = nachricht();
        await messageCreate(n);
        assert.strictEqual(n.gesendet.length, 1);
        assert.ok(n.gesendet[0].includes('`?`'), n.gesendet[0]);
    });
}

// ── IPC ──────────────────────────────────────────────────────────────────
async function teilIpc() {
    console.log('IPC BEFEHLE_NEU_ANMELDEN');
    // Erst in der Prüfung laden: Fehlt die Datei, ist das ein roter Punkt, kein Abbruch.
    const handler = (...a) => require(path.join(WURZEL, 'apps/bot/ipc/BEFEHLE_NEU_ANMELDEN.js'))(...a);
    await pruefe('meldet die Guild mit force neu an', async () => {
        const aufrufe = [];
        const client = { guilds: { cache: new Map([['G1', {}]]) }, commandManager: { registerInteractions: async (...a) => { aufrufe.push(a); } } };
        const antwort = await handler({ guildId: 'G1' }, client);
        assert.deepStrictEqual(antwort, { success: true });
        assert.deepStrictEqual(aufrufe, [['G1', true]]);
    });
    await pruefe('fremde Guild: kein Aufruf, Grund in der Antwort', async () => {
        const aufrufe = [];
        const client = { guilds: { cache: new Map() }, commandManager: { registerInteractions: async (...a) => { aufrufe.push(a); } } };
        const antwort = await handler({ guildId: 'G9' }, client);
        assert.strictEqual(antwort.success, false);
        assert.ok(antwort.error);
        assert.deepStrictEqual(aufrufe, []);
    });
}

// ── Seite ────────────────────────────────────────────────────────────────
async function teilSeite() {
    console.log('Seite (Route und Ansicht)');
    let gelesen = [];
    const geschrieben = {};
    let ipcAntwort = { success: true, data: { success: true } };
    const ipcAufrufe = [];
    let gerendert = null;
    ServiceManager.register('dbService', {
        query: async (sql, p) => {
            if (/SELECT config_key, config_value/.test(sql)) return gelesen;
            if (/INSERT INTO configs/.test(sql)) { geschrieben[p[0]] = p[1]; return []; }
            throw new Error('unbekannte Abfrage: ' + sql.trim().slice(0, 60));
        },
    });
    ServiceManager.register('ipcServer', {
        broadcastOne: async (ev, daten) => { ipcAufrufe.push([ev, daten]); return ipcAntwort; },
        broadcast: async () => ({ success: true }),
    });
    ServiceManager.register('themeManager', {
        renderView: async (res, view, daten) => { gerendert = daten; },
        getThemeForGuild: async () => 'default',
        getInstalledThemes: async () => [],
    });
    ServiceManager.register('i18n', { languagesMeta: [] });

    const router = require(path.join(WURZEL, 'apps/dashboard/routes/guild/settings.router.js'));
    const handler = (methode, pfad) => {
        const schicht = router.stack.find((s) => s.route?.path === pfad && s.route.methods[methode]);
        const stapel = schicht.route.stack;
        return stapel[stapel.length - 1].handle;
    };
    const res = () => { const r = { locals: { guildId: 'G1' }, gesendet: null }; r.json = (x) => { r.gesendet = x; return r; }; r.status = () => r; return r; };

    await pruefe('GET liest "0" als aus für beide Schalter', async () => {
        gelesen = [{ config_key: 'INTERACTIONS_SLASH', config_value: '0' }, { config_key: 'PREFIX_COMMANDS_ENABLED', config_value: '0' }];
        await handler('get', '/general')({ params: {}, session: {} }, res());
        assert.strictEqual(gerendert.settings.slashCommands, false);
        assert.strictEqual(gerendert.settings.praefixBefehle, false);
    });
    await pruefe('GET liest "1" als an', async () => {
        gelesen = [{ config_key: 'INTERACTIONS_SLASH', config_value: '1' }, { config_key: 'PREFIX_COMMANDS_ENABLED', config_value: '1' }];
        await handler('get', '/general')({ params: {}, session: {} }, res());
        assert.strictEqual(gerendert.settings.slashCommands, true);
        assert.strictEqual(gerendert.settings.praefixBefehle, true);
    });
    await pruefe('PUT ohne Kästchen speichert beide als 0 und sagt dem Bot Bescheid', async () => {
        ipcAufrufe.length = 0;
        const r = res();
        await handler('put', '/general')({ body: { prefix: '!', locale: '' }, session: {} }, r);
        assert.strictEqual(geschrieben.INTERACTIONS_SLASH, '0');
        assert.strictEqual(geschrieben.PREFIX_COMMANDS_ENABLED, '0');
        assert.deepStrictEqual(ipcAufrufe, [['dashboard:BEFEHLE_NEU_ANMELDEN', { guildId: 'G1' }]]);
        assert.strictEqual(r.gesendet.success, true);
        assert.ok(!/nicht neu angemeldet/.test(r.gesendet.message), r.gesendet.message);
    });
    await pruefe('PUT mit Kästchen speichert 1', async () => {
        await handler('put', '/general')({ body: { prefix: '!', slashCommands: 'on', praefixBefehle: 'on' }, session: {} }, res());
        assert.strictEqual(geschrieben.INTERACTIONS_SLASH, '1');
        assert.strictEqual(geschrieben.PREFIX_COMMANDS_ENABLED, '1');
    });
    await pruefe('Bot nicht erreichbar: gespeichert, Grund in der Meldung', async () => {
        ipcAntwort = { success: false, data: null, error: 'Kein Bot verbunden' };
        const r = res();
        await handler('put', '/general')({ body: { prefix: '!' }, session: {} }, r);
        assert.strictEqual(r.gesendet.success, true);
        assert.ok(r.gesendet.message.includes('Kein Bot verbunden'), r.gesendet.message);
    });

    const VORLAGE = path.join(WURZEL, 'apps/dashboard/themes/default/views/guild/settings/general.ejs');
    const zeige = (settings) => ejs.render(fs.readFileSync(VORLAGE, 'utf8'),
        { tr: (k) => k, settings, guildId: 'G1', languagesMeta: [], aktivesTheme: 'default' }, { filename: VORLAGE });
    await pruefe('Ansicht: beide Schalter, Zustand aus den Einstellungen', () => {
        const aus = zeige({ prefix: '!', slashCommands: false, praefixBefehle: false });
        const an = zeige({ prefix: '!', slashCommands: true, praefixBefehle: true });
        for (const name of ['slashCommands', 'praefixBefehle']) {
            const muster = new RegExp(`name="${name}"\\s*checked`);
            assert.ok(an.includes(`name="${name}"`), `${name} fehlt`);
            assert.ok(muster.test(an), `${name} bei „an“ nicht angehakt`);
            assert.ok(!muster.test(aus), `${name} bei „aus“ angehakt`);
        }
    });
    await pruefe('Sprachschlüssel in de-DE und en-GB vorhanden', () => {
        for (const l of ['de-DE', 'en-GB']) {
            const d = JSON.parse(lies(`plugins/core/dashboard/locales/${l}.json`)).SETTINGS;
            for (const k of ['PRAEFIX_SWITCH_LABEL', 'PRAEFIX_SWITCH_HELP', 'SLASH_LABEL', 'SLASH_HELP']) assert.ok(d.GENERAL[k], `${l} GENERAL.${k}`);
            assert.ok(d.STATUS.PRAEFIX_BEFEHLE, `${l} STATUS.PRAEFIX_BEFEHLE`);
            const b = JSON.parse(lies(`plugins/core/bot/locales/${l}.json`)).HANDLER;
            assert.ok(b.SLASH_DISABLED, `${l} HANDLER.SLASH_DISABLED`);
            assert.ok(!('CMD_DISABLED' in b), `${l} HANDLER.CMD_DISABLED noch da`);
        }
    });
}

// ── Rückbau ──────────────────────────────────────────────────────────────
async function teilRueckbau() {
    console.log('Rückbau');
    function dateien(ordner, out = []) {
        for (const e of fs.readdirSync(path.join(WURZEL, ordner), { withFileTypes: true })) {
            const rel = path.join(ordner, e.name);
            if (e.isDirectory()) { if (e.name !== 'node_modules') dateien(rel, out); }
            else if (/\.(js|ejs|json)$/.test(e.name)) out.push(rel);
        }
        return out;
    }
    await pruefe('DISABLED_PREFIX, DISABLED_SLASH, INTERACTIONS_CONTEXT, CMD_DISABLED kommen im Code nicht vor', () => {
        const treffer = [];
        for (const rel of [...dateien('apps'), ...dateien('plugins'), ...dateien('packages')]) {
            const roh = lies(rel);
            const code = rel.endsWith('.ejs') ? ohneKommentareEjs(roh) : rel.endsWith('.js') ? ohneKommentare(roh) : roh;
            if (/DISABLED_(PREFIX|SLASH)|disabled_(prefix|slash)|INTERACTIONS_CONTEXT|CMD_DISABLED/.test(code)) treffer.push(rel);
        }
        assert.deepStrictEqual(treffer, []);
    });
    await pruefe('coreConfig legt die Schalter nicht ein drittes Mal aus', () => {
        const code = ohneKommentare(lies('apps/bot/extenders/BotClient.js'));
        const ab = code.indexOf('async coreConfig()');
        const stueck = code.slice(ab, code.indexOf('get defaultLanguage', ab));
        assert.ok(!/INTERACTIONS|PREFIX_COMMANDS/.test(stueck), 'coreConfig nennt INTERACTIONS oder PREFIX_COMMANDS');
    });
    await pruefe('Vorgaben neuer Guilds: beide Schalter da, die drei alten Schlüssel nicht', () => {
        for (const rel of ['packages/dunebot-core/config/guild-defaults.json', 'plugins/core/dashboard/config.json']) {
            const d = JSON.parse(lies(rel));
            assert.strictEqual(d.INTERACTIONS_SLASH, true, rel);
            assert.strictEqual(d.PREFIX_COMMANDS_ENABLED, true, rel);
            for (const k of ['DISABLED_PREFIX', 'DISABLED_SLASH', 'INTERACTIONS_CONTEXT']) assert.ok(!(k in d), `${rel}: ${k}`);
        }
    });
}

(async () => {
    await teilIstAn();
    await teilAnmeldung();
    await teilAusfuehren();
    await teilIpc();
    await teilSeite();
    await teilRueckbau();
    console.log(fehler ? `\n${fehler} Prüfung(en) rot` : '\nalle grün');
    process.exit(fehler ? 1 : 0);
})();
