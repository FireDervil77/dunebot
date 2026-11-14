#!/usr/bin/env node
/**
 * Wächter der Nachrichtenvorlagen (G-08, K382, 2026-11-14).
 *
 * Eine Vorlage, drei Formen (Text, Embed, Components V2), Ablage in
 * `guild_vorlagen`, Füllen in `packages/dunebot-sdk/lib/Vorlage.js`,
 * Kern-Teil `shared/vorlage` mit Vorschau über POST /guild/ID/vorlagen/vorschau.
 * Erster Nutzer: greeting (vier Anlässe).
 *
 * Erklärungen:
 *   1. `vorlagen` je package.json: Recht in der permissions.json, Anlässe und
 *      Platzhalter gültig und erklärt, Kern-Gruppen bekannt, Texte (Titel,
 *      Bedeutung) in beiden Sprachen des Plugins.
 *   2. Register des Kerns = Ersetzung in PlaceholderParser (beide
 *      Richtungen), Bedeutungen in beiden Sprachen.
 *   3. Jeder Anlass im Code eines Plugins (`'plugin:anlass'`) gehört dem Plugin
 *      selbst und ist erklärt.
 *   4. Keine Kopie der Ersetzung außerhalb von PlaceholderParser; die drei
 *      eigenen Platzhalter-Tabellen von 2026-11-14 als Liste (K389).
 *   5. Wer `vorlagen` erklärt, bindet `shared/vorlage` ein und speichert über
 *      `Vorlage.speichere`; wer einbindet, erklärt. Kern-Teil ohne
 *      `document.currentScript`; Texte des Teils in beiden Sprachen.
 * Verdrahtung:
 *   6. SDK gibt `Vorlage` aus; Vorschau-Route eingehängt, mit csrfProtection,
 *      Recht aus der Erklärung und Prüfung „Plugin an“. Kein anderer Ort
 *      schreibt `guild_vorlagen`.
 *   7. `guild_vorlagen` geht mit der Guild.
 *   8. greeting liest keine der alten Spalten mehr.
 * Läufe:
 *   9. pruefe: weist falsche Form, Farbe, Länge, Adresse ab.
 *  10. fuelle: V2 ohne content/embeds, mit Markierung, höchstens 4000 Zeichen,
 *      kein leerer Container, Anhang in der Galerie; Erwähnungen nur für
 *      `erwaehnen`; falsche Adresse fällt weg; ohne Farbe der Akzent.
 *  11. Gegenproben an Kopien von Vorlage.js → jeweils rot.
 * Läufe an TEMPORARY-Tabellen der echten Datenbank:
 *  12. Ablage: speichern, laden, ändern (Text wird Embed), leer löscht,
 *      fremder Anlass wirft.
 *  13. greeting-Migration mit den am 2026-11-14 gemessenen Zeilen und
 *      Grenzfällen; danach sendet greeting Feld für Feld dasselbe wie der
 *      alte `buildGreeting` (aus Commit 2043e388). Verlust bricht ab.
 *  14. Vorschau: drei Formen, unbekannte Platzhalter erkannt.
 * Datenbank (nach dem Neustart):
 *  15. Spalten weg, jede Zeile in `guild_vorlagen` gültig und erklärt.
 *
 *   node scripts/check-vorlagen.js
 */
'use strict';
const path = require('path');
const fs = require('fs');
const Module = require('module');
const assert = require('assert');
const { execFileSync } = require('child_process');
const WURZEL = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(WURZEL, 'apps/dashboard/.env'), quiet: true });
const mysql = require('mysql2/promise');
const { ServiceManager } = require('dunebot-core');
const { ohneKommentare, ohneKommentareEjs } = require('./lib/quelltext');

const SDK_DATEI = path.join(WURZEL, 'packages/dunebot-sdk/lib/Vorlage.js');
const PARSER_DATEI = path.join(WURZEL, 'packages/dunebot-core/lib/PlaceholderParser.js');
const ALT_COMMIT = '2043e388';
const ALTE_SPALTEN = ['welcome_content', 'welcome_embed', 'dm_welcome_content', 'dm_welcome_embed', 'farewell_content', 'farewell_embed', 'boost_content', 'boost_embed'];

let rot = 0;
async function pruefe(was, tun) {
    try {
        await tun();
        console.log(`  ✓ ${was}`);
    } catch (e) {
        rot++;
        console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').join('\n      ')}`);
    }
}
const lies = (p) => fs.readFileSync(path.join(WURZEL, p), 'utf8');
const code = (p) => ohneKommentare(lies(p));
const gleich = (ist, soll, was) => assert.deepStrictEqual(ist, soll, `${was}: ${JSON.stringify(ist)} statt ${JSON.stringify(soll)}`);

function pakete() {
    const aus = {};
    for (const p of fs.readdirSync(path.join(WURZEL, 'plugins'))) {
        const d = path.join(WURZEL, 'plugins', p, 'package.json');
        if (fs.existsSync(d)) aus[p] = JSON.parse(fs.readFileSync(d, 'utf8'));
    }
    return aus;
}
function dateien(wurzel, endungen) {
    const aus = [];
    const gehe = (d) => {
        if (!fs.existsSync(d)) return;
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
            const p = path.join(d, e.name);
            if (e.isDirectory()) gehe(p);
            else if (endungen.some((x) => e.name.endsWith(x))) aus.push(p);
        }
    };
    gehe(wurzel);
    return aus;
}
function schluesselDa(obj, pfad) {
    return pfad.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj) !== undefined;
}
function sprachen(plugin) {
    const aus = {};
    for (const s of ['de-DE', 'en-GB']) aus[s] = JSON.parse(lies(`plugins/${plugin}/dashboard/locales/${s}.json`));
    return aus;
}
/** i18n-Schlüssel `ns:A.B` in beiden Sprachen des Namensraums. */
function textDa(schluessel, cache) {
    const [ns, pfad] = schluessel.split(':');
    if (!pfad) return false;
    cache[ns] = cache[ns] || sprachen(ns);
    return Object.values(cache[ns]).every((d) => schluesselDa(d, pfad));
}

/** Eine Kopie von Vorlage.js laden, mit festen Pfaden für ihre require-Aufrufe. */
function ladeSdk(text, name = 'Vorlage.js') {
    const datei = path.join(path.dirname(SDK_DATEI), name);
    const m = new Module(datei, module);
    m.filename = datei;
    m.paths = Module._nodeModulePaths(path.dirname(datei));
    m._compile(text, datei);
    return m.exports;
}

/** Ein Mitglied, das alter und neuer Code lesen können. */
function mitglied(V, guildId) {
    const { member } = V.beispielKontext({ id: '123456789012345678', username: 'anna', global_name: 'Anna' }, { id: guildId, name: 'Testserver' });
    member.user.bot = false;
    member.client = { users: { fetch: async () => ({ username: 'x', tag: 'x' }) }, logger: { error() {} } };
    return member;
}

/** Sortierte Schlüssel, ohne null: Reihenfolge und leere Felder ändern in Discord nichts. */
function kanonisch(x) {
    if (Array.isArray(x)) return x.map(kanonisch);
    if (x && typeof x === 'object') {
        const aus = {};
        for (const k of Object.keys(x).sort()) if (x[k] !== null && x[k] !== undefined) aus[k] = kanonisch(x[k]);
        return aus;
    }
    return x;
}

async function zaehleText(n) {
    let summe = 0;
    const gehe = (c) => { if (c.type === 10) summe += c.content.length; (c.components || []).forEach(gehe); };
    (n.components || []).forEach(gehe);
    return summe;
}

/** Läufe 10 an einer (vielleicht veränderten) Fassung von Vorlage.js. */
async function laeufeFuellen(V) {
    const m = mitglied(V, '');
    const k = { member: m, guild: m.guild };
    const voll = { form: 'v2', text: 'Hallo {member:mention}', titel: 'Willkommen {member:nick}', beschreibung: 'x'.repeat(3990), vorschaubild: '{member:avatar}', bild: 'https://example.org/b.png', fusszeile: 'Fuß', zeitstempel: true };
    const r = await V.fuelle(voll, k, { erwaehnen: [m.id], anhaenge: [{ name: 'welcome.png', attachment: Buffer.from('x') }] });
    const n = r.nachricht;
    assert(n, 'V2: keine Nachricht');
    gleich(n.flags, 32768, 'V2-Markierung');
    assert(!('content' in n) && !('embeds' in n), 'V2 mit content oder embeds (lehnt Discord ab)');
    assert((await zaehleText(n)) <= 4000, `V2: ${await zaehleText(n)} Zeichen Text`);
    assert(r.hinweise.some((h) => h.schluessel === 'GEKUERZT'), 'Kürzen ohne Hinweis');
    const container = n.components.find((c) => c.type === 17);
    assert(container && container.components.length > 0, 'kein Container');
    assert(JSON.stringify(container).includes('attachment://welcome.png'), 'Anhang nicht in der Galerie');
    gleich(n.allowedMentions, { parse: [], users: [m.id], repliedUser: false }, 'Erwähnungen V2');
    gleich(container.accent_color, 0x3498db, 'ohne Farbe der Akzent (Kern-Vorgabe ohne Guild)');

    const nurText = await V.fuelle({ form: 'v2', text: 'nur Text' }, k, {});
    assert(!nurText.nachricht.components.some((c) => c.type === 17), 'leerer Container (lehnt Discord ab)');
    gleich(nurText.nachricht.allowedMentions.users, [], 'ohne erwaehnen pingt niemand');

    const leer = await V.fuelle({ form: 'v2' }, k, {});
    gleich([leer.leer, leer.nachricht], [true, null], 'leere V2-Vorlage');

    const embed = await V.fuelle({ form: 'embed', text: 'a', titel: 't', farbe: '#00ff00', bild: '{member:id}' }, k, { erwaehnen: [m.id] });
    gleich(embed.nachricht.embeds[0].color, 0x00ff00, 'eigene Farbe');
    assert(!embed.nachricht.embeds[0].image, 'falsche Adresse blieb stehen');
    assert(embed.hinweise.some((h) => h.schluessel === 'ADRESSE_WEG'), 'falsche Adresse ohne Hinweis');
    gleich(embed.nachricht.allowedMentions.parse, [], 'Erwähnungen Embed');

    const text = await V.fuelle({ form: 'text', text: 'hi', titel: 'unsichtbar' }, k, {});
    gleich(Object.keys(text.nachricht).sort(), ['allowedMentions', 'content'], 'Text: nur content');
}

async function main() {
    const meta = pakete();
    const V = require(SDK_DATEI);
    const P = require(PARSER_DATEI);
    const kernTexte = {};

    console.log('Erklärungen');
    await pruefe('1. vorlagen je package.json', () => {
        const f = [];
        const cache = {};
        const kernNamen = new Set([...P.PLATZHALTER, ...V.GESTALTUNG_PLATZHALTER].map((p) => p.name));
        for (const [plugin, pkg] of Object.entries(meta)) {
            const e = pkg.vorlagen;
            if (!e) continue;
            const rechte = JSON.parse(lies(`plugins/${plugin}/dashboard/permissions.json`));
            const liste = Array.isArray(rechte) ? rechte : (rechte.permissions || []);
            if (!liste.some((r) => r.key === e.recht)) f.push(`${plugin}: Recht ${e.recht} fehlt in permissions.json`);
            const eigene = new Set();
            for (const p of e.platzhalter || []) {
                if (!/^[A-Za-z][A-Za-z0-9_]*(?::[A-Za-z][A-Za-z0-9_]*)?$/.test(p.name || '')) f.push(`${plugin}: Platzhalter „${p.name}“ ungültig`);
                if (eigene.has(p.name) || kernNamen.has(p.name)) f.push(`${plugin}: Platzhalter „${p.name}“ doppelt`);
                eigene.add(p.name);
                if (!p.bedeutung || !textDa(p.bedeutung, cache)) f.push(`${plugin}: Bedeutung von ${p.name} fehlt (${p.bedeutung})`);
            }
            const anlaesse = Object.entries(e.anlaesse || {});
            if (!anlaesse.length) f.push(`${plugin}: keine Anlässe`);
            for (const [name, a] of anlaesse) {
                if (!/^[a-z0-9_-]{1,40}$/.test(name)) f.push(`${plugin}:${name} ungültiger Name`);
                if (!a.titel || !textDa(a.titel, cache)) f.push(`${plugin}:${name} Titel fehlt (${a.titel})`);
                for (const g of a.kern || []) if (!V.KERN_GRUPPEN.includes(g)) f.push(`${plugin}:${name} unbekannte Kern-Gruppe ${g}`);
                for (const n of a.platzhalter || []) if (!eigene.has(n)) f.push(`${plugin}:${name} nennt nicht erklärten Platzhalter ${n}`);
            }
        }
        assert(!f.length, f.join('\n'));
        assert(meta.greeting?.vorlagen, 'greeting erklärt keine Vorlagen');
    });
    await pruefe('2. Register des Kerns = Ersetzung in PlaceholderParser', () => {
        const quelle = code(path.relative(WURZEL, PARSER_DATEI));
        const ersetzt = new Set([...quelle.matchAll(/replaceAll\(\/\{([A-Za-z:]+)\}\/g/g)].map((m) => m[1]));
        const register = new Set(P.PLATZHALTER.map((p) => p.name));
        gleich([...ersetzt].filter((n) => !register.has(n)).sort(), [], 'ersetzt, aber nicht im Register');
        gleich([...register].filter((n) => !ersetzt.has(n)).sort(), [], 'im Register, aber nicht ersetzt');
        // Am Mitglied gegenprobieren: Nichts aus dem Register bleibt stehen.
        const m = mitglied(V, '1');
        const alles = P.PLATZHALTER.map((p) => `{${p.name}}`).join(' ');
        const rest = P.platzhalterIn(P.parsePlaceholders(alles, { member: m }));
        gleich(rest, [], 'nach dem Füllen übrig');
        for (const s of ['de-DE', 'en-GB']) {
            kernTexte[s] = JSON.parse(lies(`plugins/core/dashboard/locales/${s}.json`)).VORLAGEN;
            assert(kernTexte[s], `core:VORLAGEN fehlt in ${s}`);
            for (const p of [...P.PLATZHALTER, ...V.GESTALTUNG_PLATZHALTER]) assert(kernTexte[s].PH?.[p.schluessel], `${s}: core:VORLAGEN.PH.${p.schluessel} fehlt`);
        }
    });
    await pruefe('3. Anlässe im Code: eigenes Plugin, erklärt', () => {
        const mitVorlagen = Object.keys(meta).filter((p) => meta[p].vorlagen);
        const f = [];
        for (const plugin of Object.keys(meta)) {
            for (const d of dateien(path.join(WURZEL, 'plugins', plugin), ['.js', '.ejs'])) {
                if (d.includes(`${path.sep}migrations${path.sep}`)) continue;
                const t = ohneKommentare(fs.readFileSync(d, 'utf8'));
                for (const m of t.matchAll(/['"`]([a-z0-9_-]+):([a-z0-9_-]+)['"`]/g)) {
                    if (!mitVorlagen.includes(m[1])) continue;
                    if (m[1] !== plugin) f.push(`${path.relative(WURZEL, d)}: Anlass ${m[1]}:${m[2]} eines anderen Plugins`);
                    else if (!meta[plugin].vorlagen.anlaesse?.[m[2]]) f.push(`${path.relative(WURZEL, d)}: Anlass ${m[0]} nicht erklärt`);
                }
            }
        }
        assert(!f.length, f.join('\n'));
    });
    await pruefe('4. Keine Kopie der Ersetzung (bekannt: K389)', () => {
        // Eigene Tabellen mit Platzhaltern des Kerns, gemessen 2026-11-14.
        // Sie gehören auf G-08 umgestellt (K389); bis dahin genau diese, als
        // Liste von Namen: Eine neue Stelle wird rot, eine erledigte auch
        // (dann die Zeile hier löschen).
        const BEKANNT_K389 = [
            'plugins/greeting/bot/events/interactionCreate.js',
            'plugins/greeting/bot/events/messageReactionAdd.js',
            'plugins/ticket/bot/events/interactionCreate.js',
        ];
        const f = [];
        const tabellen = [];
        for (const w of ['apps', 'plugins', 'packages']) {
            for (const d of dateien(path.join(WURZEL, w), ['.js', '.ejs'])) {
                if (d === PARSER_DATEI) continue;
                const t = ohneKommentare(fs.readFileSync(d, 'utf8'));
                if (/\.replace(All)?\(\s*\/\\?\{(member|guild):/.test(t)) f.push(path.relative(WURZEL, d));
                // Schlüssel einer Objekt-Tabelle am Zeilenanfang (nicht `? '{member:avatar}' : ''`).
                if (d !== SDK_DATEI && /^\s*['"]\{?(member|guild):[A-Za-z]+\}?['"]\s*:/m.test(t)) tabellen.push(path.relative(WURZEL, d));
            }
        }
        assert(!f.length, `ersetzen selbst: ${f.join(', ')}`);
        gleich(tabellen.sort(), BEKANNT_K389, 'eigene Platzhalter-Tabellen');
    });
    await pruefe('5. Kern-Teil eingebunden, wo erklärt; gespeichert über Vorlage.speichere', () => {
        const f = [];
        for (const plugin of Object.keys(meta)) {
            const ejs = dateien(path.join(WURZEL, 'plugins', plugin), ['.ejs']).map((d) => ohneKommentareEjs(fs.readFileSync(d, 'utf8'))).join('\n');
            const js = dateien(path.join(WURZEL, 'plugins', plugin, 'dashboard'), ['.js']).map((d) => ohneKommentare(fs.readFileSync(d, 'utf8'))).join('\n');
            const bindet = /include\(\s*'shared\/vorlage'/.test(ejs);
            if (meta[plugin].vorlagen && !bindet) f.push(`${plugin}: erklärt vorlagen, bindet shared/vorlage nicht ein`);
            if (!meta[plugin].vorlagen && bindet) f.push(`${plugin}: bindet shared/vorlage ein, erklärt keine vorlagen`);
            if (meta[plugin].vorlagen && !/Vorlage\.speichere\(/.test(js)) f.push(`${plugin}: keine Route mit Vorlage.speichere`);
        }
        const teil = lies('apps/dashboard/themes/default/views/shared/vorlage.ejs');
        if (/document\.currentScript/.test(ohneKommentareEjs(teil))) f.push('shared/vorlage: document.currentScript (Skripte stehen am Seitenende)');
        const benutzt = new Set([...ohneKommentareEjs(teil).matchAll(/_t\('([A-Z_]+)'/g)].map((m) => m[1]));
        for (const s of ['de-DE', 'en-GB']) for (const k of benutzt) if (!(k in kernTexte[s])) f.push(`${s}: core:VORLAGEN.${k} fehlt`);
        gleich(Object.keys(kernTexte['en-GB']).sort(), Object.keys(kernTexte['de-DE']).sort(), 'Schlüssel de/en');
        for (const art of ['FEHLER', 'HINWEIS']) gleich(Object.keys(kernTexte['en-GB'][art]).sort(), Object.keys(kernTexte['de-DE'][art]).sort(), `${art} de/en`);
        for (const k of Object.keys(V.FELDER)) if (!kernTexte['de-DE'][`FELD_${k.toUpperCase()}`]) f.push(`core:VORLAGEN.FELD_${k.toUpperCase()} fehlt (Fehlertexte nennen das Feld)`);
        const sdk = ohneKommentare(fs.readFileSync(SDK_DATEI, 'utf8'));
        for (const s of new Set([...sdk.matchAll(/Eingabefehler\('([A-Z_0-9]+)'/g)].map((m) => m[1]))) if (!kernTexte['de-DE'].FEHLER[s]) f.push(`core:VORLAGEN.FEHLER.${s} fehlt`);
        for (const s of new Set([...sdk.matchAll(/schluessel: '([A-Z_]+)'/g)].map((m) => m[1]))) if (!kernTexte['de-DE'].HINWEIS[s] && !kernTexte['de-DE'].PH[s]) f.push(`core:VORLAGEN.HINWEIS.${s} fehlt`);
        assert(!f.length, f.join('\n'));
    });

    console.log('Verdrahtung');
    await pruefe('6. SDK, Vorschau-Route, ein Schreiber', () => {
        const idx = code('packages/dunebot-sdk/index.js');
        assert(/Vorlage\s*=\s*require\("\.\/lib\/Vorlage"\)/.test(idx) && /^\s*Vorlage,/m.test(idx), 'SDK gibt Vorlage nicht aus');
        assert(/router\.use\("\/:guildId\/vorlagen", CheckAuth, CheckGuildAccess, vorlagenRouter\)/.test(code('apps/dashboard/routes/guild.router.js')), 'Vorschau-Route nicht eingehängt');
        const r = code('apps/dashboard/routes/guild/vorlagen.router.js');
        const routen = [...r.matchAll(/router\.(get|put|post|delete|patch)\(\s*'([^']+)'/g)].map((m) => `${m[1]} ${m[2]}`);
        gleich(routen, ['post /vorschau'], 'Routen');
        assert(/router\.post\('\/vorschau', csrfProtection,/.test(r), 'Vorschau ohne csrfProtection');
        assert(/requirePermission\(a\.recht\)/.test(r), 'Vorschau ohne das Recht aus der Erklärung');
        assert(/isPluginEnabledForGuild\(guildId, a\.plugin\)/.test(r), 'Vorschau prüft nicht, ob das Plugin an ist');
        const schreiber = [];
        for (const w of ['apps', 'plugins', 'packages']) {
            for (const d of dateien(path.join(WURZEL, w), ['.js'])) {
                if (d.includes(`${path.sep}migrations${path.sep}`)) continue;
                if (/(INSERT INTO|UPDATE|DELETE FROM)\s+`?guild_vorlagen\b/.test(ohneKommentare(fs.readFileSync(d, 'utf8')))) schreiber.push(path.relative(WURZEL, d));
            }
        }
        gleich(schreiber, ['packages/dunebot-sdk/lib/Vorlage.js'], 'wer guild_vorlagen schreibt');
    });
    await pruefe('7. Geht mit der Guild', () => {
        assert(meta.core.guildInhalte.loeschen.includes('guild_vorlagen'), 'guild_vorlagen fehlt in core guildInhalte.loeschen');
        assert(fs.existsSync(path.join(WURZEL, 'migrations/kern/20261114_150000_vorlagen.js')), 'Kern-Migration fehlt');
    });
    await pruefe('8. greeting liest keine alte Spalte', () => {
        const f = [];
        for (const d of dateien(path.join(WURZEL, 'plugins/greeting'), ['.js', '.ejs'])) {
            if (d.includes(`${path.sep}migrations${path.sep}`)) continue;
            const t = d.endsWith('.ejs') ? ohneKommentareEjs(fs.readFileSync(d, 'utf8')) : ohneKommentare(fs.readFileSync(d, 'utf8'));
            for (const s of ALTE_SPALTEN.filter((x) => x !== 'welcome_content')) if (new RegExp(`\\b${s}\\b`).test(t)) f.push(`${path.relative(WURZEL, d)}: ${s}`);
            // welcome_content gibt es weiter, aber nur an der Einladung.
            for (const z of t.split('\n')) if (/\bwelcome_content\b/.test(z) && /greeting_settings|settings\.welcome_content/.test(z)) f.push(`${path.relative(WURZEL, d)}: ${z.trim()}`);
        }
        assert(!f.length, f.join('\n'));
        assert(!fs.existsSync(path.join(WURZEL, 'plugins/greeting/dashboard/views/partials/embed-builder.ejs')), 'embed-builder.ejs liegt noch da');
    });

    console.log('Läufe');
    await pruefe('9. pruefe weist ab', () => {
        const wirft = (roh, schluessel) => assert.throws(() => V.pruefe(roh), (e) => e instanceof V.Eingabefehler && e.schluessel === schluessel, `${JSON.stringify(roh).slice(0, 60)} → ${schluessel}`);
        wirft(null, 'KEINE_VORLAGE');
        wirft({ form: 'bild' }, 'FORM');
        wirft({ farbe: 'rot' }, 'FARBE');
        wirft({ titel: 'x'.repeat(257) }, 'ZU_LANG');
        wirft({ form: 'v2', text: 'x'.repeat(2000), beschreibung: 'x'.repeat(2001) }, 'V2_ZU_LANG');
        wirft({ bild: 'kein bild' }, 'ADRESSE');
        gleich(V.pruefe({ bild: '{gestaltung:banner}', vorschaubild: '{member:avatar}', farbe: '#ABCDEF', unbekannt: 1 }).farbe, '#abcdef', 'Platzhalter als Adresse, Farbe klein');
        assert(!('unbekannt' in V.pruefe({ unbekannt: 1 })), 'unbekanntes Feld blieb');
    });
    await pruefe('10. fuelle baut gültige Nachrichten', () => laeufeFuellen(V));
    await pruefe('11. Gegenproben an Kopien von Vorlage.js werden rot', async () => {
        // Rohtext gewollt: Die Kopie ist die ganze Datei, nur verändert
        // (check-waechter-prosa).
        const sdkRoh = fs.readFileSync(SDK_DATEI, 'utf8');
        const kaputt = {
            'unverändert (muss grün bleiben)': [],
            'ohne 4000-Grenze': [/const ueber = summe\(\) - V2_TEXT_MAX;/, 'const ueber = 0;'],
            'leerer Container': [/if \(innen\.length\) aussen\.push\(/, 'aussen.push('],
            'Erwähnungen offen': [/\{ parse: \[\], users:/, "{ parse: ['users', 'roles', 'everyone'], users:"],
            'Adresse ungeprüft': [/if \(w\[f\] && !ADRESSE\.test\(w\[f\]\)\)/, 'if (false)'],
            'V2 mit content': [/const nachricht = \{ flags: FLAG_V2, components: aussen, allowedMentions \};/, "const nachricht = { flags: FLAG_V2, components: aussen, allowedMentions, content: '' };"],
        };
        const gruen = [];
        for (const [name, ersetzungen] of Object.entries(kaputt)) {
            let text = sdkRoh;
            for (let i = 0; i < ersetzungen.length; i += 2) {
                const neu = text.replace(ersetzungen[i], ersetzungen[i + 1]);
                assert.notStrictEqual(neu, text, `Gegenprobe „${name}“ greift nicht mehr (Quelle geändert?)`);
                text = neu;
            }
            let fehler = null;
            try { await laeufeFuellen(ladeSdk(text, `.gegenprobe-${Object.keys(kaputt).indexOf(name)}.js`)); } catch (e) { fehler = e; }
            if (!ersetzungen.length) assert(!fehler, `unveränderte Kopie ist rot: ${fehler?.message}`);
            else if (!fehler) gruen.push(name);
        }
        assert(!gruen.length, `blieben grün: ${gruen.join(', ')}`);
    });

    console.log('Läufe (TEMPORARY)');
    const c = await mysql.createConnection({
        host: process.env.MYSQL_HOST, port: process.env.MYSQL_PORT, user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE,
    });
    const [[{ echt }]] = await c.query("SELECT COUNT(*) echt FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'guild_vorlagen'");
    const [[{ vorherZeilen }]] = echt ? await c.query('SELECT COUNT(*) vorherZeilen FROM guild_vorlagen') : [[{ vorherZeilen: null }]];
    try {
        // Dieselbe Kern-Migration, als TEMPORARY: verdeckt in dieser Verbindung die echte Tabelle.
        const kern = require(path.join(WURZEL, 'migrations/kern/20261114_150000_vorlagen.js'));
        await kern.up({ query: (sql) => c.query(sql.replace(/CREATE TABLE IF NOT EXISTS/g, 'CREATE TEMPORARY TABLE')) });
        ServiceManager.register('Logger', { info() {}, warn() {}, error() {}, debug() {} });
        ServiceManager.register('dbService', { async query(sql, params = []) { const [r] = await c.query(sql, params); return r; } });
        const A = '900000000000000011';

        await pruefe('12. Ablage', async () => {
            await assert.rejects(() => V.lade(A, 'greeting:gibtsnicht'), (e) => e.schluessel === 'ANLASS', 'unerklärter Anlass');
            await assert.rejects(() => V.speichere(A, 'music:willkommen'), (e) => e.schluessel === 'ANLASS', 'Anlass eines Plugins ohne Erklärung');
            gleich(await V.lade(A, 'greeting:boost'), null, 'nichts gespeichert');
            await V.speichere(A, 'greeting:boost', { form: 'text', text: 'Danke {member:name}' });
            gleich((await V.lade(A, 'greeting:boost')).text, 'Danke {member:name}', 'gespeichert');
            await V.aendere(A, 'greeting:boost', { beschreibung: 'mehr' });
            gleich((await V.lade(A, 'greeting:boost')).form, 'embed', 'Feld des Aufbaus macht aus Text ein Embed');
            await V.aendere(A, 'greeting:boost', { form: 'v2' });
            gleich((await V.lade(A, 'greeting:boost')).form, 'v2', 'Form umgeschaltet');
            await V.speichere(A, 'greeting:boost', { form: 'v2' });
            gleich((await c.query('SELECT COUNT(*) n FROM guild_vorlagen WHERE guild_id = ?', [A]))[0][0].n, 0, 'leer: Zeile weg');
        });

        await pruefe('13. greeting-Migration: alles umgezogen, Aussehen gleich, Verlust bricht ab', async () => {
            const embedLeer = '{"title":null,"description":null,"color":null,"thumbnail":null,"image":null,"fields":[],"author":{"name":null,"iconURL":null},"footer":{"text":null,"iconURL":null},"timestamp":false}';
            // Die drei Zeilen mit Inhalt, gemessen am 2026-11-14 (Guild-IDs ersetzt), und Grenzfälle.
            const ZEILEN = [
                ['900000000000000021', { welcome_content: 'WIllkommen {member:name} auf {guild:name} ! Du bist nun unser {guild:memberCount} Mitglied.', welcome_embed: embedLeer, farewell_content: 'Auf Wiedersehen {member:name}. Schade das Du {guild:name} verlassen hast. Wir sind nun auf {guild:memberCount} zurück geschrumpft.', farewell_embed: embedLeer }],
                ['900000000000000022', { welcome_content: '', welcome_embed: embedLeer, dm_welcome_content: '', dm_welcome_embed: embedLeer, farewell_content: '', farewell_embed: '{"title":"Dann geh doch zu Netto!","color":"#ff0000","timestamp":true}', boost_embed: embedLeer }],
                ['900000000000000023', { welcome_content: '', welcome_embed: '{"title":"Willkommen {member:nick}!","description":"Du bist nun Teil vom FireNetworks.","color":"#5865f2","footer":{"text":"Und Du bist nun das {guild:memberCount} Zündholz."},"timestamp":true}', dm_welcome_embed: embedLeer, farewell_embed: embedLeer, boost_content: '', boost_embed: '{"title":"Neuen Boost bekommen!","description":"{member:name} hat unseren {guild:name} geboostet!\\nVielen dank dafür :)","color":"#ed023d","footer":{"text":"Damit besitzen wir nun {guild:boostCount}!"},"thumbnail":true}' }],
                ['900000000000000024', { welcome_content: 'Zeile 1\\nZeile 2 {member:mention}', welcome_embed: '{"color":"#123456"}', farewell_content: 'Text', farewell_embed: '{"description":"und Embed","image":"{member:avatar}"}' }],
            ];
            const spalten = ALTE_SPALTEN.map((s) => `${s} ${s.endsWith('_embed') ? 'LONGTEXT' : 'TEXT'} DEFAULT NULL`).join(', ');
            await c.query(`CREATE TEMPORARY TABLE greeting_settings (guild_id VARCHAR(255) PRIMARY KEY, welcome_enabled TINYINT(1) DEFAULT 1, ${spalten})`);
            await c.query('CREATE TEMPORARY TABLE greeting_invite_mappings (id INT AUTO_INCREMENT PRIMARY KEY, guild_id VARCHAR(255), invite_code VARCHAR(50), welcome_content TEXT, welcome_embed LONGTEXT)');
            for (const [g, z] of ZEILEN) {
                const k = Object.keys(z);
                await c.query(`INSERT INTO greeting_settings (guild_id, ${k.join(', ')}) VALUES (?, ${k.map(() => '?').join(', ')})`, [g, ...k.map((x) => z[x])]);
            }
            await c.query("INSERT INTO greeting_invite_mappings (guild_id, invite_code, welcome_content) VALUES ('900000000000000023', 'abc', 'Willkommen über abc')");
            const migration = require(path.join(WURZEL, 'plugins/greeting/migrations/20261114_150000_vorlagen.js'));
            const db = { query: async (sql, p) => (await c.query(sql, p))[0] };

            // Verlust bricht ab, ohne etwas zu ändern.
            await c.query("INSERT INTO greeting_settings (guild_id, boost_embed) VALUES ('900000000000000029', '{\"title\":\"t\",\"author\":{\"name\":\"Autor\"}}')");
            await assert.rejects(() => migration.up(db), /900000000000000029\/boost/, 'Autor im Embed');
            gleich((await c.query('SELECT COUNT(*) n FROM guild_vorlagen'))[0][0].n, 0, 'nach Abbruch nichts eingetragen');
            await c.query("DELETE FROM greeting_settings WHERE guild_id = '900000000000000029'");

            // Was der alte Code gesendet hätte, vor der Migration.
            const altQuelle = execFileSync('git', ['-C', WURZEL, 'show', `${ALT_COMMIT}:plugins/greeting/bot/utils.js`], { encoding: 'utf8' });
            const altDatei = path.join(WURZEL, 'plugins/greeting/bot/.alt-utils.js');
            const alt = new Module(altDatei, module);
            alt.filename = altDatei;
            alt.paths = Module._nodeModulePaths(path.dirname(altDatei));
            alt._compile(altQuelle, altDatei);
            const TYP = { welcome: 'WELCOME', dm_welcome: 'WELCOME', farewell: 'FAREWELL', boost: 'BOOST' };
            const vorher = [];
            for (const [g, z] of ZEILEN) {
                for (const art of Object.keys(TYP)) {
                    const m = mitglied(V, g);
                    const embed = z[`${art}_embed`] ? JSON.parse(z[`${art}_embed`]) : {};
                    const r = await alt.exports.buildGreeting(m, TYP[art], { content: z[`${art}_content`], embed });
                    vorher.push([g, art, r]);
                }
            }

            await migration.up(db);
            const [rest] = await c.query('SHOW COLUMNS FROM greeting_settings');
            gleich(rest.map((r) => r.Field).filter((f) => ALTE_SPALTEN.includes(f)), [], 'alte Spalten');
            const [restE] = await c.query('SHOW COLUMNS FROM greeting_invite_mappings');
            assert(!restE.some((r) => r.Field === 'welcome_embed'), 'welcome_embed der Einladung blieb');
            const [vorlagen] = await c.query('SELECT guild_id, anlass, inhalt FROM guild_vorlagen ORDER BY guild_id, anlass');
            gleich(vorlagen.map((v) => `${v.guild_id.slice(-2)} ${v.anlass}`), ['21 greeting:abschied', '21 greeting:willkommen', '22 greeting:abschied', '23 greeting:boost', '23 greeting:willkommen', '24 greeting:abschied', '24 greeting:willkommen'], 'umgezogene Vorlagen');
            for (const v of vorlagen) V.pruefe(JSON.parse(v.inhalt));
            const formen = Object.fromEntries(vorlagen.map((v) => [`${v.guild_id.slice(-2)} ${v.anlass}`, JSON.parse(v.inhalt).form]));
            gleich([formen['21 greeting:willkommen'], formen['22 greeting:abschied'], formen['24 greeting:willkommen'], formen['24 greeting:abschied']], ['text', 'embed', 'text', 'embed'], 'Formen');
            gleich(JSON.parse(vorlagen.find((v) => v.guild_id.endsWith('24') && v.anlass === 'greeting:willkommen').inhalt).text, 'Zeile 1\nZeile 2 {member:mention}', '\\n als Zeichenfolge → Umbruch');

            // Danach sendet greeting dasselbe.
            const { baueNachricht, ANLAESSE } = require(path.join(WURZEL, 'plugins/greeting/bot/utils.js'));
            const abw = [];
            for (const [g, art, a] of vorher) {
                const n = await baueNachricht(mitglied(V, g), ANLAESSE[art]);
                const altEmbed = a.embeds ? a.embeds[0].toJSON() : null;
                const neuEmbed = n.embeds ? { ...n.embeds[0] } : null;
                if (altEmbed?.timestamp) altEmbed.timestamp = 'jetzt';
                // Gewollt anders (G-09 Ebene 3): Ein Embed ohne eigene Farbe
                // trägt jetzt den Akzent des Servers statt gar keiner Farbe.
                if (altEmbed && altEmbed.color === undefined && neuEmbed) {
                    if (neuEmbed.color !== 0x3498db) abw.push(`${g.slice(-2)} ${art}: ohne Farbe nicht der Akzent`);
                    delete neuEmbed.color;
                }
                if (neuEmbed?.timestamp) neuEmbed.timestamp = 'jetzt';
                // Zeilenumbruch: der alte Parser machte aus „\\n“ erst beim Senden einen.
                const ist = JSON.stringify(kanonisch({ content: n.content, embed: neuEmbed }));
                const soll = JSON.stringify(kanonisch({ content: a.content, embed: altEmbed }));
                if (ist !== soll) abw.push(`${g.slice(-2)} ${art}\n        alt ${soll}\n        neu ${ist}`);
            }
            assert(!abw.length, abw.join('\n      '));

            // Eine Einladung mit eigenem Text ersetzt nur den Nachrichtentext.
            const e = await baueNachricht(mitglied(V, '900000000000000023'), ANLAESSE.welcome, { textStatt: 'Willkommen über abc' });
            gleich([e.content, e.embeds?.[0]?.title], ['Willkommen über abc', 'Willkommen Anna!'], 'Einladung');

            // Ein zweiter Lauf ändert nichts (Spalten sind weg).
            await migration.up(db);
            gleich((await c.query('SELECT COUNT(*) n FROM guild_vorlagen'))[0][0].n, vorlagen.length, 'zweiter Lauf');
        });

        await pruefe('14. Vorschau', async () => {
            const v = await V.vorschau('greeting:willkommen', { form: 'v2', text: '{member:mention} {gibtsnicht} {invites}', titel: 'Hi' }, { guildId: '', guildName: 'Testserver', nutzer: { id: '42', username: 'anna' } });
            gleich(Object.keys(v.formen).sort(), ['embed', 'text', 'v2'], 'drei Formen');
            gleich(v.unbekannt, ['gibtsnicht'], 'unbekannte Platzhalter');
            assert(v.formen.v2.components[0].content.includes('5'), 'Beispielwert des Plugins fehlt');
            gleich(v.namen, { 42: 'anna' }, 'Namen für Erwähnungen');
            await assert.rejects(() => V.vorschau('greeting:willkommen', { farbe: 'x' }, {}), (e) => e.schluessel === 'FARBE', 'Vorschau prüft');
        });
    } finally {
        await c.query('DROP TEMPORARY TABLE IF EXISTS guild_vorlagen, greeting_settings, greeting_invite_mappings').catch(() => {});
    }

    console.log('Datenbank');
    await pruefe('15. Nach dem Neustart: Spalten weg, Vorlagen gültig', async () => {
        if (!echt) {
            console.log('      (guild_vorlagen gibt es noch nicht: Kern-Migration läuft beim Neustart)');
            const [alteDa] = await c.query(`SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'greeting_settings' AND COLUMN_NAME IN (?)`, [ALTE_SPALTEN]);
            assert(alteDa.length === ALTE_SPALTEN.length, `alte Spalten zum Teil weg ohne Kern-Tabelle: ${alteDa.length}`);
            return;
        }
        const [alteDa] = await c.query(`SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'greeting_settings' AND COLUMN_NAME IN (?)`, [ALTE_SPALTEN]);
        const [z] = await c.query('SELECT guild_id, anlass, inhalt FROM guild_vorlagen');
        gleich(z.length, vorherZeilen, 'Zeilen vorher/nachher (der Wächter schreibt nicht)');
        if (alteDa.length) console.log(`      (greeting-Migration offen: ${alteDa.length} alte Spalten, läuft beim Neustart)`);
        const f = [];
        for (const r of z) {
            try { V.anlass(r.anlass); V.pruefe(JSON.parse(r.inhalt)); } catch (e) { f.push(`${r.guild_id} ${r.anlass}: ${e.message}`); }
        }
        assert(!f.length, f.join('\n'));
    });
    await c.end();

    console.log(rot ? `\n${rot} rot` : '\nalles grün');
    process.exit(rot ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
