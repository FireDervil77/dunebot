#!/usr/bin/env node
'use strict';

/**
 * Wächter Profilabschnitte (G-12, K382, 2026-11-14).
 *
 * Prüft das Register `packages/dunebot-sdk/lib/Profil.js`, seine Lieferanten
 * und die drei Orte (`/profile`, `/info user`, Seite „Mitglieder“):
 *
 *   1.  Erklärungen `profil` aller Plugins ohne Fehler; erwartet sind core
 *       (discord, konten), giveaway, music, moderation (faelle, notizen),
 *       automod. Moderation und Automod nie in Discord, mit Recht.
 *   2.  Jeder Text, den ein Abschnitt nimmt (`t('PROFIL.…')`), steht in
 *       beiden Bot-Sprachdateien des Plugins, auch die Arten der Moderation.
 *   3.  Sicht: `info` nur `alle`; `discord` nur das eigene Profil und nie
 *       `discord: false`; Dashboard `team` nur mit Recht oder bei sich selbst
 *       (dann nicht Moderation/Automod), `selbst` nur bei sich selbst.
 *   4.  `abschnitte`: Discord für ein fremdes Mitglied wirft; Plugin aus →
 *       Abschnitt fehlt; ein Abschnitt, der wirft oder hängt, steht unter
 *       `fehler` und die anderen kommen trotzdem; falsche Form wird Fehler.
 *   5.  Kacheln: nur Abschnitte, die in Discord stehen dürfen, höchstens drei.
 *   6.  Echte Datenbank, nur lesend: jeder Abschnitt liefert für Mitglieder
 *       mit Daten die richtige Form (Moderation mit Fällen, Musik, Giveaway).
 *   7.  Discord-Felder: Markdown und @ entschärft, Zeit als <t:…:D>, ≤ 1024.
 *   8.  Quelltext: `/profile` ohne Option für ein Mitglied, nur für den
 *       Fragenden sichtbar, Ort discord; `/info user` sammelt nicht mehr
 *       selbst (kein joinedAt, kein roles.cache), Ort info, wartet auf die
 *       Antwort; kein zweiter Befehl `profile` in einem Plugin.
 *   9.  Dashboard: Router mit CORE.MITGLIEDER.VIEW an jeder Route, eingehängt,
 *       Navigation, Recht im Katalog, Migration verteilt an Administratoren,
 *       IPC-Handler da.
 *   10. Ansichten rendern leer und voll, beide Sprachen, escaped.
 *   11. Profilkarte: core erklärt `kern:profil`, sie zeichnet mit
 *       `kartenMitglied` ohne Hinweise.
 *
 * Aufruf: node scripts/check-profil.js   (Exit 0 = grün)
 */

const path = require('path');
const fs = require('fs');
const assert = require('assert');

const WURZEL = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(WURZEL, 'apps/dashboard/.env'), quiet: true });
const { ServiceManager } = require('dunebot-core');
const { ohneKommentare } = require('./lib/quelltext');

process.exitCode = 1;

let rot = 0;
let gruen = 0;
async function pruefe(titel, fn) {
    try {
        await fn();
        gruen++;
        console.log(`  ✓ ${titel}`);
    } catch (err) {
        rot++;
        console.log(`  ✗ ${titel}\n      ${String(err.message).split('\n').join('\n      ')}`);
    }
}
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), 'utf8');
const json = (rel) => JSON.parse(lies(rel));

function nachsehen(obj, schluessel) {
    let x = obj;
    for (const teil of schluessel.split('.')) x = x && typeof x === 'object' ? x[teil] : undefined;
    return x;
}

ServiceManager.register('Logger', { info() {}, warn() {}, error() {}, debug() {} });
ServiceManager.register('dbService', { async query() { return []; } });

const Profil = require('dunebot-sdk/lib/Profil');

/** Datenbank-Attrappe: diese Plugins an. */
function dbMitPlugins(an) {
    ServiceManager.register('dbService', {
        async query(q) {
            if (/FROM guild_plugins/.test(q)) return an.map((plugin_name) => ({ plugin_name }));
            if (/FROM user_connections/.test(q)) return [{ plattform: 'twitch', konto_name: 'x', konto_id: '1' }];
            if (/COUNT\(\*\)/.test(q)) return [{ n: 1, zuletzt: new Date('2026-01-02') }];
            if (/FROM automod_strikes/.test(q)) return [{ strikes: 1 }];
            if (/FROM moderation_logs/.test(q) && /GROUP BY type/.test(q)) return [{ type: 'WARN', n: 1 }];
            if (/FROM moderation_logs/.test(q)) return [{ case_number: 3, type: 'WARN', created_at: new Date('2026-01-02') }];
            if (/FROM giveaway_winners/.test(q)) return [{ prize: 'P', won_at: new Date() }];
            if (/FROM music_history/.test(q)) return [{ title: 'T' }];
            return [];
        },
    });
}

const MITGLIED = { id: '100000000000000001', name: 'anna', anzeige: 'Anna', avatar: null, bot: false, beigetreten: Date.UTC(2025, 0, 1), erstellt: Date.UTC(2020, 0, 1), rollen: [{ id: '2', name: 'Rolle', farbe: null }] };
const ALLE_PLUGINS = ['giveaway', 'music', 'moderation', 'automod'];

(async () => {
    console.log('Register');
    await pruefe('1. Erklärungen ohne Fehler, erwartete Abschnitte, Moderation/Automod nie in Discord', () => {
        const { abschnitte, fehler } = Profil.erklaerungen();
        assert.deepStrictEqual(fehler, [], fehler.join('\n'));
        const da = abschnitte.map((a) => a.kennung);
        for (const k of ['core:discord', 'core:konten', 'giveaway:giveaway', 'music:music', 'moderation:faelle', 'moderation:notizen', 'automod:automod']) {
            assert(da.includes(k), `${k} fehlt`);
        }
        for (const a of abschnitte.filter((x) => x.plugin === 'moderation' || x.plugin === 'automod')) {
            assert(a.discord === false && a.sicht === 'team' && a.recht, `${a.kennung}: discord ${a.discord}, sicht ${a.sicht}, recht ${a.recht}`);
        }
        assert.strictEqual(abschnitte.find((a) => a.kennung === 'core:konten').sicht, 'selbst', 'Konten gelten für alle Guilds: nur selbst');
        assert.deepStrictEqual(abschnitte.filter((a) => a.sicht === 'alle').map((a) => a.kennung), ['core:discord'], 'öffentlich nur Discord-Angaben');
    });

    await pruefe('2. Texte der Abschnitte in beiden Sprachen', () => {
        const fehlt = [];
        for (const p of new Set(Profil.erklaerungen().abschnitte.map((a) => a.plugin))) {
            const quelle = ohneKommentare(lies(`plugins/${p}/shared/profil.js`));
            const schluessel = new Set([...quelle.matchAll(/\bt\('([A-Z0-9_.]+)'/g)].map((m) => m[1]));
            if (/t\(`PROFIL\.ART\.\$\{/.test(quelle)) {
                for (const art of require(path.join(WURZEL, 'plugins', p, 'shared', 'profil.js')).ARTEN.concat('PURGE')) schluessel.add(`PROFIL.ART.${art}`);
            }
            assert(schluessel.size, `${p}: keine Texte gefunden`);
            for (const s of schluessel) for (const l of ['de-DE', 'en-GB']) {
                if (typeof nachsehen(json(`plugins/${p}/bot/locales/${l}.json`), s) !== 'string') fehlt.push(`${p} ${l} ${s}`);
            }
        }
        for (const l of ['de-DE', 'en-GB']) if (typeof nachsehen(json(`plugins/core/bot/locales/${l}.json`), 'PROFIL.MEHR') !== 'string') fehlt.push(`core ${l} PROFIL.MEHR`);
        assert.deepStrictEqual(fehlt, []);
    });

    await pruefe('3. Sicht je Ort', () => {
        const a = (sicht, discord = true) => ({ sicht, discord });
        const s = (x, ort, selbst, hatRecht = false) => Profil.sichtbar(x, { ort, selbst, hatRecht });
        // info: nur alle, egal wer
        assert(s(a('alle'), 'info', false) && !s(a('team'), 'info', true, true) && !s(a('selbst'), 'info', true), 'info');
        // discord: nur selbst, nie discord false
        assert(s(a('alle'), 'discord', true) && s(a('team'), 'discord', true) && s(a('selbst'), 'discord', true), 'discord selbst');
        assert(!s(a('alle'), 'discord', false) && !s(a('team', false), 'discord', true, true), 'discord fremd oder discord:false');
        // dashboard
        assert(s(a('alle'), 'dashboard', false), 'alle');
        assert(!s(a('team'), 'dashboard', false) && s(a('team'), 'dashboard', false, true), 'team fremd nur mit Recht');
        assert(s(a('team'), 'dashboard', true) && !s(a('team', false), 'dashboard', true) && s(a('team', false), 'dashboard', true, true), 'team selbst: Discord-fähige ja, Moderation nur mit Recht');
        assert(!s(a('selbst'), 'dashboard', false, true) && s(a('selbst'), 'dashboard', true), 'selbst nur selbst, auch mit Recht nicht fremd');
    });

    await pruefe('4. abschnitte: Schranken, Plugin aus, Fehler und Frist', async () => {
        dbMitPlugins(ALLE_PLUGINS);
        const g = { guildId: '1', userId: MITGLIED.id, mitglied: MITGLIED, sprache: 'de-DE' };
        await assert.rejects(Profil.abschnitte({ ...g, ort: 'discord', betrachterId: '200000000000000002' }), /nur das eigene/);
        await assert.rejects(Profil.abschnitte({ ...g, ort: 'dashboard' }), /Betrachter/);
        await assert.rejects(Profil.abschnitte({ ...g, ort: 'irgendwo' }), /unbekannter Ort/);

        const rechte = [];
        const voll = await Profil.abschnitte({ ...g, ort: 'dashboard', betrachterId: '200000000000000002', darf: async (r) => { rechte.push(r); return true; } });
        assert.deepStrictEqual(voll.fehler, []);
        assert.deepStrictEqual(voll.abschnitte.map((x) => x.kennung), ['core:discord', 'giveaway:giveaway', 'music:music', 'moderation:faelle', 'moderation:notizen', 'automod:automod'], 'fremd mit allen Rechten: alles außer Konten');
        assert.strictEqual(new Set(rechte).size, rechte.length, 'Recht doppelt gefragt');

        const ohne = await Profil.abschnitte({ ...g, ort: 'dashboard', betrachterId: '200000000000000002', darf: async () => false });
        assert.deepStrictEqual(ohne.abschnitte.map((x) => x.kennung), ['core:discord'], 'fremd ohne Rechte');

        const selbst = await Profil.abschnitte({ ...g, ort: 'dashboard', betrachterId: MITGLIED.id, darf: async () => false });
        assert.deepStrictEqual(selbst.abschnitte.map((x) => x.kennung), ['core:discord', 'giveaway:giveaway', 'music:music', 'core:konten'], 'selbst ohne Rechte');

        const discord = await Profil.abschnitte({ ...g, ort: 'discord', betrachterId: MITGLIED.id });
        assert.deepStrictEqual(discord.abschnitte.map((x) => x.kennung), ['core:discord', 'giveaway:giveaway', 'music:music', 'core:konten'], 'discord selbst');

        dbMitPlugins(['music']);
        const aus = await Profil.abschnitte({ ...g, ort: 'discord', betrachterId: MITGLIED.id });
        assert.deepStrictEqual(aus.abschnitte.map((x) => x.kennung), ['core:discord', 'music:music', 'core:konten'], 'Plugin aus');

        dbMitPlugins(ALLE_PLUGINS);
        const gw = Profil.erklaerungen().abschnitte.find((x) => x.kennung === 'giveaway:giveaway');
        const mu = Profil.erklaerungen().abschnitte.find((x) => x.kennung === 'music:music');
        const echtG = gw.modul.giveaway;
        const echtM = mu.modul.music;
        try {
            gw.modul.giveaway = async () => { throw new Error('kaputt'); };
            mu.modul.music = async () => ({ felder: [{ titel: 'x', wert: 1, zeit: 2 }] });
            const r = await Profil.abschnitte({ ...g, ort: 'discord', betrachterId: MITGLIED.id });
            assert.deepStrictEqual(r.abschnitte.map((x) => x.kennung), ['core:discord', 'core:konten'], 'die anderen fehlen');
            assert.deepStrictEqual(r.fehler.map((f) => f.kennung), ['giveaway:giveaway', 'music:music']);
            assert(/kaputt/.test(r.fehler[0].grund) && /genau eins/.test(r.fehler[1].grund), JSON.stringify(r.fehler));
            assert.strictEqual(r.fehler[0].titel, 'Giveaways', 'Titel übersetzt');

            gw.modul.giveaway = () => new Promise(() => {});
            const t0 = Date.now();
            const h = await Profil.abschnitte({ ...g, ort: 'discord', betrachterId: MITGLIED.id });
            assert(h.fehler.some((f) => f.kennung === 'giveaway:giveaway' && /keine Antwort/.test(f.grund)), 'hängt ohne Fehler');
            assert(Date.now() - t0 < Profil.FRIST_MS + 1500, 'Frist nicht eingehalten');
        } finally {
            gw.modul.giveaway = echtG;
            mu.modul.music = echtM;
        }
        assert.strictEqual(Profil.pruefeErgebnis(null), null);
        assert.strictEqual(Profil.pruefeErgebnis({ felder: [] }), null, 'leer = nichts');
        assert.throws(() => Profil.pruefeErgebnis({ felder: [{ titel: 'a', zeit: '1' }] }), /zeit/);
        assert.throws(() => Profil.pruefeErgebnis({ felder: [], kachel: { titel: 'a' } }), /kachel/);
        const lang = Profil.pruefeErgebnis({ felder: [{ titel: 'l', liste: Array.from({ length: 30 }, (_, i) => String(i)) }] });
        assert(lang.felder[0].liste.length === Profil.LISTE_MAX && lang.felder[0].mehr === 5, 'Liste gekürzt mit Rest');
    });

    await pruefe('5. Kacheln: nur Discord-fähige, höchstens drei', () => {
        const ab = (k, discord, kachel) => ({ kennung: k, discord, kachel });
        const w = Profil.kacheln([ab('a', true, { titel: 'A', wert: '1' }), ab('m', false, { titel: 'M', wert: '9' }), ab('b', true, null), ab('c', true, { titel: 'C', wert: '3' }), ab('d', true, { titel: 'D', wert: '4' }), ab('e', true, { titel: 'E', wert: '5' })]);
        assert.deepStrictEqual(w, { titel1: 'A', wert1: '1', titel2: 'C', wert2: '3', titel3: 'D', wert3: '4', abzeichen: [] });
        const leer = Profil.kacheln([]);
        assert(leer.titel1 === '' && leer.wert3 === '–', JSON.stringify(leer));
        const v = require('dunebot-sdk/lib/Bildkarte').vorlage('kern:profil');
        const laufzeit = new Set((v.werte || []).filter((x) => !x.einstellbar).map((x) => x.name));
        for (const k of Object.keys(w)) assert(laufzeit.has(k), `kern:profil kennt ${k} nicht`);
    });

    await pruefe('6. Echte Datenbank (nur lesend): Form der Abschnitte', async () => {
        if (!process.env.MYSQL_HOST) throw new Error('keine Datenbank (.env)');
        const mysql = require('mysql2/promise');
        const pool = mysql.createPool({ host: process.env.MYSQL_HOST, port: process.env.MYSQL_PORT, user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE, connectionLimit: 3 });
        const geschrieben = [];
        ServiceManager.register('dbService', {
            async query(q, p) {
                if (!/^\s*SELECT/i.test(q)) { geschrieben.push(q); throw new Error('nur lesend'); }
                const [r] = await pool.query(q, p);
                return r;
            },
        });
        try {
            const [fall] = await pool.query("SELECT guild_id, member_id FROM moderation_logs WHERE deleted = 0 AND type <> 'PURGE' LIMIT 1");
            const [musik] = await pool.query('SELECT guild_id, requested_by AS u FROM music_history GROUP BY guild_id, requested_by ORDER BY COUNT(*) DESC LIMIT 1');
            const [gewinn] = await pool.query("SELECT g.guild_id, w.user_id AS u FROM giveaway_winners w JOIN giveaways g ON g.id = w.giveaway_id WHERE w.quelle = 'discord' LIMIT 1");
            const proben = [
                fall[0] && { g: fall[0].guild_id, u: fall[0].member_id, soll: 'moderation:faelle' },
                musik[0] && { g: musik[0].guild_id, u: musik[0].u, soll: 'music:music' },
                gewinn[0] && { g: gewinn[0].guild_id, u: gewinn[0].u, soll: 'giveaway:giveaway' },
            ].filter(Boolean);
            assert(proben.length, 'keine Daten zum Proben');
            const gesehen = [];
            for (const pr of proben) {
                for (const sprache of ['de-DE', 'en-GB']) {
                    const r = await Profil.abschnitte({ guildId: pr.g, userId: pr.u, mitglied: { ...MITGLIED, id: pr.u }, ort: 'dashboard', betrachterId: '200000000000000002', darf: async () => true, sprache });
                    assert.deepStrictEqual(r.fehler, [], JSON.stringify(r.fehler));
                    const a = r.abschnitte.find((x) => x.kennung === pr.soll);
                    const an = (await pool.query('SELECT 1 FROM guild_plugins WHERE guild_id = ? AND plugin_name = ? AND is_enabled = 1', [pr.g, pr.soll.split(':')[0]]))[0].length;
                    if (!an) continue;
                    assert(a, `${pr.soll} fehlt für ${pr.u} in ${pr.g}`);
                    for (const f of a.felder) assert(!/PROFIL\./.test(f.titel) && !/\{\{/.test(f.titel), `${sprache}: unübersetzt ${f.titel}`);
                    gesehen.push(pr.soll);
                }
            }
            assert(gesehen.length, 'kein Plugin der Proben eingeschaltet');
            assert.deepStrictEqual(geschrieben, []);
        } finally {
            await pool.end();
            ServiceManager.register('dbService', { async query() { return []; } });
        }
    });

    await pruefe('7. Discord-Felder: entschärft, Zeit, Länge', () => {
        const tKern = Profil.uebersetzer('core', 'de-DE');
        const [f] = Profil.discordFelder([{ titel: 'G', felder: [
            { titel: '**fett**', wert: '@everyone _x_ `c`' },
            { titel: 'Zeit', zeit: Date.UTC(2026, 0, 2) },
            { titel: 'Liste', liste: ['a'.repeat(300), 'b'.repeat(300), 'c'.repeat(300), 'd'.repeat(300)], mehr: 2 },
        ] }], tKern);
        assert(f.value.includes('\\*\\*fett\\*\\*') && f.value.includes('@​everyone') && f.value.includes('\\_x\\_') && f.value.includes('\\`c\\`'), f.value.slice(0, 200));
        assert(f.value.includes(`<t:${Date.UTC(2026, 0, 2) / 1000}:D>`), 'Zeit');
        assert(f.value.length <= 1024, `${f.value.length} Zeichen`);
        const [g] = Profil.discordFelder([{ titel: 'G', felder: [{ titel: 'L', liste: ['a'], mehr: 3 }] }], tKern);
        assert(g.value.includes('und 3 weitere'), g.value);
        assert.strictEqual(Profil.feldText({ zeit: Date.UTC(2026, 0, 2, 12) }, 'dashboard', 'de-DE'), '02.01.2026');
    });

    console.log('Orte');
    await pruefe('8. /profile nur selbst, /info user liest mit, kein zweiter Befehl', () => {
        const profil = ohneKommentare(lies('apps/bot/commands/profile.js'));
        const befehl = require(path.join(WURZEL, 'apps/bot/commands/profile.js'));
        assert.strictEqual(befehl.name, 'profile');
        assert.deepStrictEqual(befehl.slashCommand.options, [], 'Option für ein anderes Mitglied');
        assert(befehl.slashCommand.ephemeral === true && befehl.command.enabled === false, 'nicht nur für den Fragenden / Prefix an');
        assert(/ort: "discord"/.test(profil) && /betrachterId: interaction\.user\.id/.test(profil) && /userId: member\.id/.test(profil), 'Ort oder Betrachter');
        assert(/zeichneNutzung\("core", "kern:profil"/.test(profil), 'Karte nicht über die Nutzung des Kerns');

        const info = ohneKommentare(lies('plugins/information/bot/commands/shared/user.js'));
        assert(/ort: "info"/.test(info) && /Profil\.abschnitte/.test(info), 'liest keine Abschnitte');
        assert(!/joinedAt|createdAt|roles\.cache|ServiceLocator/.test(info), 'sammelt wieder selbst');
        assert(/await user\(target\)/.test(lies('plugins/information/bot/commands/slash/info.js')), '/info user wartet nicht');
        assert(/await userInfo\(target\)/.test(lies('plugins/information/bot/commands/message/userinfo.js')), 'userinfo wartet nicht');

        const doppelt = [];
        for (const p of fs.readdirSync(path.join(WURZEL, 'plugins'))) {
            const ordner = path.join(WURZEL, 'plugins', p, 'bot', 'commands');
            if (!fs.existsSync(ordner)) continue;
            const dateien = fs.readdirSync(ordner, { recursive: true }).filter((d) => String(d).endsWith('.js'));
            for (const d of dateien) if (/name:\s*["']profile["']/.test(fs.readFileSync(path.join(ordner, String(d)), 'utf8'))) doppelt.push(`${p}/${d}`);
        }
        assert.deepStrictEqual(doppelt, [], 'zweiter /profile (Leveling liefert einen Abschnitt)');
    });

    await pruefe('9. Dashboard: Recht an jeder Route, eingehängt, Navigation, Katalog, Migration, IPC', () => {
        const router = ohneKommentare(lies('apps/dashboard/routes/guild/mitglieder.router.js'));
        const routen = [...router.matchAll(/router\.(get|post|put|delete)\(([^\n]*)/g)];
        assert(routen.length === 3, `${routen.length} Routen`);
        for (const r of routen) assert(/requirePermission\('CORE\.MITGLIEDER\.VIEW'\)/.test(r[2]), `ohne Recht: ${r[2].slice(0, 60)}`);
        assert(/ort: 'dashboard'/.test(router) && /hasPermission\(betrachterId, guildId, recht\)/.test(router), 'Sicht nicht über Profil mit Rechten');
        assert(/router\.use\("\/:guildId\/mitglieder", CheckAuth, CheckGuildAccess, mitgliederRouter\)/.test(lies('apps/dashboard/routes/guild.router.js')), 'nicht eingehängt');
        assert(/NAV\.MITGLIEDER[\s\S]{0,300}capability: 'CORE\.MITGLIEDER\.VIEW'/.test(lies('apps/dashboard/helpers/KernNavigation.js')), 'Navigation');
        for (const l of ['de-DE', 'en-GB']) assert(json(`apps/dashboard/locales/${l}.json`).NAV.MITGLIEDER, `NAV.MITGLIEDER ${l}`);
        const katalog = json('packages/dunebot-core/config/permissions.json');
        const liste = Array.isArray(katalog) ? katalog : katalog.permissions;
        const recht = liste.find((r) => r.key === 'CORE.MITGLIEDER.VIEW');
        assert(recht, 'Recht fehlt im Katalog');
        for (const l of ['de-DE', 'en-GB']) {
            const t = json(`plugins/core/dashboard/locales/${l}.json`);
            assert(t.CORE.PERM_MITGLIEDER_VIEW && t.CORE.PERM_MITGLIEDER_VIEW_DESC && t.PERM_MITGLIEDER_VIEW, `Rechtname ${l}`);
        }
        const mig = lies('migrations/kern/20261114_220000_mitglieder_rechte.js');
        assert(/'CORE\.MITGLIEDER\.VIEW'/.test(mig) && /slug\) = 'administrator'/.test(mig) && /guild_permission_seeds/.test(mig), 'Migration');
        for (const h of ['MITGLIEDER_LISTE', 'MITGLIED_PROFIL']) assert(fs.existsSync(path.join(WURZEL, 'apps/bot/ipc', `${h}.js`)), `IPC ${h}`);
        assert(/Mitglieder\.holen/.test(lies('apps/bot/ipc/MITGLIEDER_LISTE.js')), 'Liste ohne Frist');
        assert(/Profil\.mitgliedAus/.test(lies('apps/bot/ipc/MITGLIED_PROFIL.js')), 'Profil-Form nicht aus dem SDK');
    });

    await pruefe('10. Ansichten rendern leer und voll, beide Sprachen, escaped', () => {
        const ejs = require('ejs');
        const liste = lies('apps/dashboard/themes/default/views/guild/mitglieder.ejs');
        const einzel = lies('apps/dashboard/themes/default/views/guild/mitglied.ejs');
        for (const loc of ['de-DE', 'en-GB']) {
            const fehlt = [];
            const texte = json(`plugins/core/dashboard/locales/${loc}.json`);
            const tr = (k, o = {}) => {
                const t = nachsehen(texte, k.replace(/^core:/, ''));
                if (typeof t !== 'string') { fehlt.push(k); return k; }
                return t.replace(/\{\{(\w+)\}\}/g, (_, n) => String(o[n] ?? ''));
            };
            const leer = ejs.render(liste, { tr, guildId: '1', q: '', mitglieder: [], treffer: 0, seite: 1, seiten: 1 });
            assert(leer.includes(tr('core:MITGLIEDER.LEER')), 'Liste leer');
            const voll = ejs.render(liste, {
                tr, locale: loc, guildId: '1', q: '<b>', nurId: null, fehler: null, vollstaendig: false, grund: '<g>', anzahl: 3, treffer: 120, seite: 2, seiten: 3,
                mitglieder: [{ id: '100000000000000001', name: '<n>', anzeige: '<a>', avatar: 'https://cdn.discordapp.com/x.png', bot: true, beigetreten: Date.UTC(2025, 0, 1) }],
            });
            assert(voll.includes('/guild/1/mitglieder/100000000000000001') && voll.includes('q=%3Cb%3E&amp;seite=3'), 'Verweise');
            assert(voll.includes('&lt;a&gt;') && voll.includes('&lt;g&gt;') && !voll.includes('<a>') && !voll.includes('<b>'), 'nicht escaped');
            const nurId = ejs.render(liste, { tr, guildId: '1', q: '100000000000000009', nurId: '100000000000000009', mitglieder: [], treffer: 0, seite: 1, seiten: 1, fehler: 'weg' });
            assert(nurId.includes('/guild/1/mitglieder/100000000000000009') && nurId.includes(tr('core:MITGLIEDER.BOT_FEHLT', { grund: 'weg' })), 'ID ohne Mitglied / Bot weg');

            const ohne = ejs.render(einzel, { tr, guildId: '1', userId: '100000000000000009', mitglied: null, abschnitte: [], fehler: [] });
            assert(ohne.includes(tr('core:MITGLIEDER.NICHTS')) && ohne.includes(tr('core:MITGLIEDER.NICHT_DA', { id: '100000000000000009' })) && !ohne.includes('/karte'), 'ohne Mitglied');
            const mit = ejs.render(einzel, {
                tr, guildId: '1', userId: MITGLIED.id, mitglied: { ...MITGLIED, anzeige: '<x>' }, botFehler: null, selbst: true,
                abschnitte: [
                    { kennung: 'moderation:faelle', titel: '<t>', sicht: 'team', discord: false, felder: [{ titel: '<f>', text: '<w>' }] },
                    { kennung: 'core:konten', titel: 'K', sicht: 'selbst', discord: true, felder: [{ titel: 'a', text: 'b' }] },
                ],
                fehler: [{ kennung: 'music:music', titel: 'Musik', grund: '<kaputt>' }],
            });
            assert(mit.includes(`/guild/1/mitglieder/${MITGLIED.id}/karte`) && mit.includes('fa-lock') && mit.includes(tr('core:MITGLIEDER.NUR_SELBST')) && mit.includes(tr('core:MITGLIEDER.DU_SELBST')), 'Karte, Schloss, nur du');
            assert(mit.includes('&lt;w&gt;') && mit.includes('&lt;kaputt&gt;') && !/<(t|f|w|x)>/.test(mit), 'nicht escaped');
            assert.deepStrictEqual([...new Set(fehlt)], [], `${loc}: ${[...new Set(fehlt)].join(', ')}`);
        }
        for (const l of ['de-DE', 'en-GB']) assert(json(`plugins/core/dashboard/locales/${l}.json`).BILDKARTEN.WO_PROFIL, `WO_PROFIL ${l}`);
    });

    await pruefe('11. Profilkarte: core erklärt kern:profil, zeichnet mit echtem Mitglied', async () => {
        const Bildkarte = require('dunebot-sdk/lib/Bildkarte');
        const n = (Bildkarte.nutzungen().karten.get('kern:profil') || []).find((x) => x.plugin === 'core');
        assert(n && n.wo === 'core:BILDKARTEN.WO_PROFIL', 'core erklärt kern:profil nicht');
        assert.deepStrictEqual(Bildkarte.nutzungen().fehler, []);
        ServiceManager.register('dbService', { async query() { return []; } });
        const member = Profil.kartenMitglied({ ...MITGLIED, avatar: null }, { id: '1', name: 'Server' });
        const bild = await Bildkarte.zeichneNutzung('core', 'kern:profil', { member, guild: member.guild, werte: Profil.kacheln([{ discord: true, kachel: { titel: 'Rollen', wert: '1' } }]) }, { guildId: '1', sprache: 'de-DE' });
        assert(bild.breite === 934 && bild.hoehe === 360 && bild.bytes > 1000, `${bild.breite}×${bild.hoehe}, ${bild.bytes} B`);
        const echt = bild.hinweise.filter((h) => !/logo|banner/i.test(h));
        assert.deepStrictEqual(echt, [], echt.join('\n'));
    });

    console.log(`\n${gruen} grün, ${rot} rot`);
    process.exitCode = rot ? 1 : 0;
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
