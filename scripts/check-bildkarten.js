#!/usr/bin/env node
'use strict';

/**
 * Wächter Bildkarten (G-10, K382, 2026-11-14).
 *
 * Prüft den Kern-Renderer `packages/dunebot-sdk/lib/Bildkarte.js`, seine
 * Vorlagen und den ersten Nutzer (greeting, Willkommensbild):
 *
 *   1.  Jede Vorlage auf der Platte besteht `pruefe` (Kern und Plugins).
 *   2.  Jede Vorlage zeichnet mit ihren Beispielwerten: PNG, Maße wie erklärt,
 *       unter 1 MB, ab dem zweiten Lauf unter 300 ms.
 *   3.  Schriften: die drei Rollen aus den Theme-Paketen, dazu die
 *       Systemschriften (Noto Color Emoji, Noto Sans CJK, DejaVu Sans).
 *       Rot, solange ein Paket fehlt: Dann stehen in Namen Kästchen.
 *   4.  Zeichen kommen an: „Ł“ fett (latin-ext unter eigenem Namen), „火“,
 *       Emoji in Farbe. Verglichen wird mit einem Zeichen, das keine Schrift
 *       hat (Kästchen); gleiche Pixel = Kästchen.
 *   5.  `pruefe` lehnt ab: unbekannte Art, unbekanntes Feld, fehlende
 *       Pflicht, unerklärter Platzhalter, Liste ohne Wert, Text ohne en.
 *   6.  Werte: Kern-Platzhalter im Wert werden ersetzt („{member:nick}“ im
 *       Text der Guild), feste Wörter nach Sprache, Balken mit Unsinn meldet.
 *   7.  Bilder nur aus zwei Herkünften: Medienablage derselben Guild (von der
 *       Platte) und Discord. Eigenes Netz, fremde Seiten, fremde Guild und
 *       `..` werden nicht abgerufen. `fetch` ist hier eine Attrappe.
 *   8.  Über 1 MB geht die Karte als JPEG, mit passendem Dateinamen.
 *   9.  Ein Renderer: Canvas lädt außer Bildkarte.js niemand (Ausnahmen mit Grund).
 *   10. greeting: welcomeImage.js ist weg, Beitritt und `/welcome preview`
 *       nehmen dieselbe Stelle, die Hintergründe im Formular sind die im Code,
 *       die Vorschau-Route zeichnet über Bildkarte.
 *   11. /admin/bildkarten: Route, Seitenleiste, die Ansicht rendert (leer und voll).
 *   12. Bereich „Bildkarten“ je Guild (G-21, F-G11):
 *       a. Erklärungen `bildkarten` in den package.json ohne Fehler, jede Karte
 *          eines Plugins erklärt, Titel und Ort in beiden Sprachen übersetzt.
 *       b. Navigation neben Medien mit CORE.BILDKARTEN.VIEW, beide Rechte im
 *          Katalog, Migration gibt sie der Administrator-Gruppe und vermerkt sie.
 *       c. Router: beide Routen mit Recht, eingehängt unter /:guildId/bildkarten.
 *       d. Welche Karten eine Guild sieht: Kern immer, Plugin nur eingeschaltet,
 *          Nutzung nur von eingeschalteten Plugins.
 *       e. greeting `stand()`: an nur mit Nachricht und Bild, Werte wie der Bot.
 *       f. Die Seite rendert leer und voll, Texte in beiden Sprachen.
 *
 * Kein Netz, keine Datenbank: Die Palette kommt aus einer Attrappe ohne Zeilen
 * (also die Vorgabe des Kerns). Liest eine Datei aus der Medienablage der
 * Kontroll-Guild, schreibt nichts.
 *
 *     node scripts/check-bildkarten.js
 */

const path = require('path');
const fs = require('fs');
const assert = require('assert');

const WURZEL = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(WURZEL, 'apps/dashboard/.env'), quiet: true });
const { ServiceManager } = require('dunebot-core');
const { ohneKommentare, ohneKommentareEjs } = require('./lib/quelltext');

// Bleibt ein Promise für immer offen, endet Node still mit 0. Darum zuerst 1.
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

ServiceManager.register('Logger', { info() {}, warn() {}, error() {}, debug() {} });
ServiceManager.register('dbService', { async query() { return []; } });

const abrufe = [];
let abrufAntwort = null;
globalThis.fetch = async (adresse) => {
    abrufe.push(String(adresse));
    const puffer = abrufAntwort || Buffer.alloc(0);
    return { ok: true, status: 200, headers: { get: () => String(puffer.length) }, arrayBuffer: async () => puffer };
};

const { Bildkarte } = require('dunebot-sdk');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

/** Kleine Vorlage mit einem Text, für Zeichen- und Wertproben. */
function textVorlage({ texte, text } = {}) {
    return {
        breite: 240, hoehe: 80,
        werte: [{ name: 't', beispiel: '' }],
        ...(texte ? { texte } : {}),
        ebenen: [
            { art: 'flaeche', x: 0, y: 0, b: 240, h: 80, farbe: '#000000' },
            { art: 'text', x: 10, y: 60, text: text || '{t}', fett: true, groesse: 48, farbe: '#ffffff' },
        ],
    };
}
async function textBild(t, extra) {
    const v = textVorlage(extra);
    return (await Bildkarte.zeichne(v, { werte: { t } }, { guildId: '1' })).puffer;
}
async function hatFarbe(puffer) {
    const bild = await loadImage(puffer);
    const c = createCanvas(bild.width, bild.height);
    const ctx = c.getContext('2d');
    ctx.drawImage(bild, 0, 0);
    const d = ctx.getImageData(0, 0, bild.width, bild.height).data;
    for (let i = 0; i < d.length; i += 4) if (Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]) > 80) return true;
    return false;
}
function stubMember(nick = 'Anna') {
    const guild = { id: '1', name: 'Gilde', memberCount: 7, premiumSubscriptionCount: 0, premiumTier: 0, iconURL: () => '' };
    const user = { id: '2', username: 'anna', discriminator: '0', tag: 'anna', createdAt: new Date() };
    return { id: '2', user, guild, displayName: nick, joinedAt: new Date(), toString: () => '<@2>', displayAvatarURL: () => '' };
}

(async () => {
    console.log('Vorlagen');
    const namen = Bildkarte.liste();
    await pruefe(`1. alle ${namen.length} Vorlagen bestehen pruefe (${namen.join(', ')})`, () => {
        for (const p of ['kern:rangkarte', 'kern:profil', 'greeting:willkommen']) assert(namen.includes(p), `${p} fehlt`);
        for (const n of namen) Bildkarte.vorlage(n);
    });
    for (const n of namen) {
        await pruefe(`2. ${n} zeichnet mit Beispielwerten`, async () => {
            const v = Bildkarte.vorlage(n);
            await Bildkarte.beispiel(n, { guildId: '1', guildName: 'Gilde', nutzer: { id: '2', username: 'anna' } });
            const k = await Bildkarte.beispiel(n, { guildId: '1', guildName: 'Gilde', nutzer: { id: '2', username: 'anna' } });
            assert.strictEqual(k.puffer.subarray(1, 4).toString(), 'PNG', 'kein PNG');
            assert.strictEqual(k.puffer.readUInt32BE(16), v.breite, 'Breite');
            assert.strictEqual(k.puffer.readUInt32BE(20), v.hoehe, 'Höhe');
            assert(k.bytes < Bildkarte.PNG_MAX_BYTES, `${k.bytes} Bytes`);
            assert(k.ms < 300, `${k.ms} ms`);
        });
    }

    console.log('Schriften');
    const stand = Bildkarte.schriftStand();
    await pruefe('3a. Theme-Schriften für anzeige, text, mono', () => {
        assert.deepStrictEqual(stand.themeFehlt, [], `fehlt: ${stand.themeFehlt.join(', ')}`);
        for (const r of ['anzeige', 'text', 'mono']) assert(stand.theme[r].length === 2, `${r}: ${stand.theme[r].join(', ')}`);
    });
    await pruefe('3b. Systemschriften installiert', () => {
        const fehlt = stand.system.filter((s) => !s.da);
        assert(!fehlt.length, `fehlt: ${fehlt.map((s) => `${s.familie} (sudo apt install ${s.paket})`).join(', ')}`);
    });
    const kaestchen = await textBild('\u{10FFFD}');
    await pruefe('4a. „Ł“ fett kommt an (latin-ext)', async () => assert(!kaestchen.equals(await textBild('Ł')), 'Ł zeichnet als Kästchen'));
    await pruefe('4b. „火“ kommt an (CJK)', async () => assert(!kaestchen.equals(await textBild('火')), '火 zeichnet als Kästchen (fonts-noto-cjk?)'));
    await pruefe('4c. Emoji in Farbe', async () => assert(await hatFarbe(await textBild('😀')), '😀 ohne Farbe (fonts-noto-color-emoji?)'));
    await pruefe('4d. Gegenprobe: Text in Weiß hat keine Farbe', async () => assert(!(await hatFarbe(await textBild('Abc')))));

    console.log('Prüfung der Vorlage');
    const basis = () => JSON.parse(JSON.stringify(textVorlage()));
    const falsch = {
        'unbekannte Art': (v) => { v.ebenen[1].art = 'kreis'; },
        'unbekanntes Feld': (v) => { v.ebenen[1].schriftart = 'x'; },
        'fehlende Pflicht': (v) => { delete v.ebenen[1].groesse; },
        'unerklärter Platzhalter': (v) => { v.ebenen[1].text = '{levle}'; },
        'unbekannte Farbrolle': (v) => { v.ebenen[1].farbe = '{farbe:lila}'; },
        'Liste ohne Wert': (v) => { v.ebenen.push({ art: 'bildreihe', x: 0, y: 0, groesse: 10, liste: 'gibtsnicht' }); },
        'Text ohne en': (v) => { v.texte = { w: { de: 'Rang' } }; },
        'Lage als Text': (v) => { v.ebenen[1].x = '10'; },
        'zu groß': (v) => { v.breite = 4096; },
        'Wert ohne Beispiel': (v) => { delete v.werte[0].beispiel; },
    };
    await pruefe(`5. pruefe lehnt ab: ${Object.keys(falsch).join(', ')}`, () => {
        Bildkarte.pruefe(basis());
        for (const [was, aendere] of Object.entries(falsch)) {
            const v = basis();
            aendere(v);
            assert.throws(() => Bildkarte.pruefe(v), Bildkarte.Kartenfehler, `angenommen: ${was}`);
        }
    });

    console.log('Werte');
    await pruefe('6a. Kern-Platzhalter im Wert werden ersetzt', async () => {
        const v = textVorlage();
        const a = (await Bildkarte.zeichne(v, { member: stubMember('Anna'), werte: { t: '{member:nick}' } }, { guildId: '1' })).puffer;
        const b = (await Bildkarte.zeichne(v, { member: stubMember('Anna'), werte: { t: 'Anna' } }, { guildId: '1' })).puffer;
        const c = (await Bildkarte.zeichne(v, { member: stubMember('Anna'), werte: { t: 'Bert' } }, { guildId: '1' })).puffer;
        assert(a.equals(b), '{member:nick} nicht ersetzt');
        assert(!a.equals(c), 'Gegenprobe: andere Namen zeichnen gleich');
    });
    await pruefe('6b. feste Wörter nach Sprache, guild.locale zählt', async () => {
        const v = textVorlage({ texte: { w: { de: 'Rang', en: 'Rank' } }, text: '{text:w}' });
        const en = (await Bildkarte.zeichne(v, {}, { guildId: '1', sprache: 'en-GB' })).puffer;
        const de = (await Bildkarte.zeichne(v, {}, { guildId: '1' })).puffer;
        const lokal = (await Bildkarte.zeichne(v, { guild: { id: '1', name: 'G', locale: 'en-GB' } }, { guildId: '1' })).puffer;
        assert(en.equals(await textBild('Rank')), 'en ist nicht „Rank“');
        assert(de.equals(await textBild('Rang')), 'Vorgabe ist nicht Deutsch');
        assert(lokal.equals(en), 'guild.locale wird nicht gelesen');
    });
    await pruefe('6c. Balken mit Unsinn meldet, statt zu werfen', async () => {
        const v = { breite: 100, hoehe: 64, werte: [{ name: 'w', beispiel: 'x' }], ebenen: [{ art: 'balken', x: 0, y: 0, b: 100, h: 20, wert: '{w}', max: '10' }] };
        const k = await Bildkarte.zeichne(v, {}, { guildId: '1' });
        assert(k.hinweise.some((h) => h.startsWith('Balken')), JSON.stringify(k.hinweise));
    });

    console.log('Bilder');
    const kontroll = String(process.env.CONTROL_GUILD_ID || '');
    const bildVorlage = (quelle) => ({ breite: 64, hoehe: 64, werte: [{ name: 'q', beispiel: '' }], ebenen: [{ art: 'bild', x: 0, y: 0, b: 64, h: 64, quelle: '{q}' }] });
    const kleinesPng = (() => { const c = createCanvas(4, 4); const x = c.getContext('2d'); x.fillStyle = '#ff0000'; x.fillRect(0, 0, 4, 4); return c.toBuffer('image/png'); })();
    await pruefe('7a. Discord wird abgerufen, sonst nichts aus dem Netz', async () => {
        abrufAntwort = kleinesPng;
        abrufe.length = 0;
        const gut = await Bildkarte.zeichne(bildVorlage(), { werte: { q: 'https://cdn.discordapp.com/avatars/2/x.png' } }, { guildId: kontroll });
        assert.deepStrictEqual(gut.hinweise, []);
        assert.strictEqual(abrufe.length, 1, 'Discord nicht abgerufen');
        assert(await hatFarbe(gut.puffer), 'Bild nicht gezeichnet');
        abrufe.length = 0;
        for (const q of ['http://127.0.0.1:9000/x.png', 'https://example.com/x.png', 'http://cdn.discordapp.com/x.png', 'https://cdn.discordapp.com.evil.example/x.png', 'file:///etc/passwd']) {
            const k = await Bildkarte.zeichne(bildVorlage(), { werte: { q } }, { guildId: kontroll });
            assert(k.hinweise.length === 1, `${q}: kein Hinweis`);
        }
        assert.deepStrictEqual(abrufe, [], `abgerufen: ${abrufe.join(', ')}`);
    });
    await pruefe('7c. leere Antwort und Unsinn von Discord: Hinweis, kein Hängen', async () => {
        for (const antwort of [Buffer.alloc(0), Buffer.from('kein bild')]) {
            abrufAntwort = antwort;
            const k = await Bildkarte.zeichne(bildVorlage(), { werte: { q: 'https://cdn.discordapp.com/x.png' } }, { guildId: '1' });
            assert(k.hinweise.length === 1, JSON.stringify(k.hinweise));
        }
        abrufAntwort = kleinesPng;
    });
    const medien = path.join(WURZEL, 'apps/dashboard/uploads/media', kontroll);
    let eigene = null;
    try { eigene = fs.readdirSync(medien).find((d) => /\.png$/.test(d)); } catch { /* keine Ablage */ }
    await pruefe('7b. Medienablage: eigene Guild von der Platte, fremde Guild und „..“ nicht', async () => {
        const fremd = '900000000000000002';
        for (const q of [`/uploads/media/${fremd}/x.png`, `/uploads/media/${kontroll}/..%2F${fremd}%2Fx.png`, `/uploads/media/${kontroll}/../x.png`, `/uploads/media/${kontroll}/.env`]) {
            const k = await Bildkarte.zeichne(bildVorlage(), { werte: { q } }, { guildId: kontroll });
            assert(k.hinweise.length === 1 && /Medienablage|nicht|ENOENT/.test(k.hinweise[0]), `${q}: ${JSON.stringify(k.hinweise)}`);
        }
        if (!eigene) throw new Error(`übersprungen: keine PNG in ${path.relative(WURZEL, medien)}, der Weg „eigene Guild“ ist ungeprüft`);
        abrufe.length = 0;
        const basisUrl = String(process.env.DASHBOARD_BASE_URL || '').replace(/\/+$/, '');
        for (const q of [`/uploads/media/${kontroll}/${eigene}`, `${basisUrl}/uploads/media/${kontroll}/${eigene}`]) {
            const k = await Bildkarte.zeichne(bildVorlage(), { werte: { q } }, { guildId: kontroll });
            assert.deepStrictEqual(k.hinweise, [], q);
        }
        assert.deepStrictEqual(abrufe, [], 'die eigene Ablage ging übers Netz');
        const k = await Bildkarte.zeichne(bildVorlage(), { werte: { q: `/uploads/media/${kontroll}/${eigene}` } }, { guildId: '900000000000000003' });
        assert(k.hinweise.length === 1, 'Bild der Kontroll-Guild in einer anderen Guild gezeichnet');
    });

    await pruefe('8. über 1 MB als JPEG, Dateiname .jpg', async () => {
        const c = createCanvas(1100, 1100);
        const x = c.getContext('2d');
        const d = x.createImageData(1100, 1100);
        require('crypto').randomFillSync(d.data);
        for (let i = 3; i < d.data.length; i += 4) d.data[i] = 255;
        x.putImageData(d, 0, 0);
        abrufAntwort = c.toBuffer('image/png');
        const v = { breite: 1100, hoehe: 1100, ebenen: [{ art: 'bild', x: 0, y: 0, b: 1100, h: 1100, quelle: 'https://cdn.discordapp.com/x.png' }] };
        const k = await Bildkarte.zeichne(v, {}, { guildId: '1' });
        assert.strictEqual(k.typ, 'jpeg', `typ ${k.typ}, ${k.bytes} Bytes`);
        assert.strictEqual(k.dateiname('karte'), 'karte.jpg');
        assert.strictEqual(k.puffer[0], 0xff);
        const klein = await Bildkarte.zeichne(textVorlage(), { werte: { t: 'a' } }, { guildId: '1' });
        assert.strictEqual(klein.dateiname('karte'), 'karte.png');
    });

    console.log('Quelltext');
    await pruefe('9. Canvas lädt nur Bildkarte.js (Ausnahmen mit Grund)', () => {
        const AUSNAHMEN = {
            'packages/dunebot-sdk/lib/Bildkarte.js': 'der Renderer',
            'plugins/dunemap/dashboard/assets/js/MapGenerator.js': 'Kartenkacheln der Dune-Karte, keine Bildkarte (Paket canvas)',
        };
        const funde = [];
        const geh = (ordner) => {
            for (const e of fs.readdirSync(path.join(WURZEL, ordner), { withFileTypes: true })) {
                const rel = path.join(ordner, e.name);
                if (e.isDirectory()) { if (!['node_modules', '.git', 'uploads'].includes(e.name)) geh(rel); continue; }
                if (!rel.endsWith('.js')) continue;
                if (/require\(\s*['"](@napi-rs\/canvas|canvas)['"]\s*\)/.test(ohneKommentare(fs.readFileSync(path.join(WURZEL, rel), 'utf8')))) funde.push(rel);
            }
        };
        for (const o of ['apps', 'packages', 'plugins']) geh(o);
        const neu = funde.filter((f) => !AUSNAHMEN[f]);
        const weg = Object.keys(AUSNAHMEN).filter((f) => !funde.includes(f));
        assert(!neu.length, `Canvas außerhalb des Renderers: ${neu.join(', ')} (Bildkarte.zeichne nehmen)`);
        assert(!weg.length, `Ausnahme ohne Fund, Zeile löschen: ${weg.join(', ')}`);
    });

    await pruefe('10. greeting: eine Stelle, Formular = Code, Vorschau über Bildkarte', () => {
        assert(!fs.existsSync(path.join(WURZEL, 'plugins/greeting/bot/welcomeImage.js')), 'welcomeImage.js ist zurück');
        const beitritt = ohneKommentare(lies('plugins/greeting/bot/events/guildMemberAdd.js'));
        const befehl = ohneKommentare(lies('plugins/greeting/bot/vorlageBefehl.js'));
        assert(/Willkommensbild\.anhang\(member, settings/.test(beitritt), 'Beitritt nimmt nicht Willkommensbild.anhang');
        assert(/Willkommensbild\.anhang\(member, settings/.test(befehl), '/welcome preview nimmt nicht Willkommensbild.anhang');
        assert(/baueNachricht\(member, a\.anlass, \{ anhaenge \}\)/.test(befehl), '/welcome preview hängt das Bild nicht an');
        const W = require(path.join(WURZEL, 'plugins/greeting/shared/willkommensbild.js'));
        const ejs = ohneKommentareEjs(lies('plugins/greeting/dashboard/views/guild/greeting-content.ejs'));
        const auswahl = ejs.slice(ejs.indexOf('name="welcome_image_bg"'), ejs.indexOf('</select>', ejs.indexOf('name="welcome_image_bg"')));
        const optionen = [...auswahl.matchAll(/<option value="([a-z]+)"/g)].map((m) => m[1]).sort();
        assert.deepStrictEqual(optionen, Object.keys(W.HINTERGRUENDE).sort(), 'Hintergründe im Formular ≠ im Code');
        assert.deepStrictEqual(W.werte({ welcome_image_bg: 'gibtsnicht', welcome_image_color: 'rot' }).hintergrund1, W.HINTERGRUENDE.default[0]);
        assert.strictEqual(W.werte({ welcome_image_color: 'rot' }).akzent, W.VORGABE_FARBE);
        const router = ohneKommentare(lies('plugins/greeting/dashboard/routes/guild.router.js'));
        const route = router.slice(router.indexOf("router.get('/willkommensbild'"));
        assert(route.length > 30, 'Vorschau-Route fehlt');
        assert(/requirePermission\('GREETING\.VIEW'\)/.test(route.slice(0, 120)), 'Vorschau-Route ohne Recht');
        assert(/Bildkarte\.beispiel\(Willkommensbild\.ANLASS/.test(route.slice(0, 900)), 'Vorschau zeichnet nicht über Bildkarte');
        assert(/data-greeting-bildvorschau-bild/.test(ejs) && !/<% if[^%]*%>\s*<div class="mt-2 d-none" data-greeting-bildvorschau-rahmen/.test(ejs), 'Vorschaubild fehlt im HTML');
    });

    await pruefe('11. /admin/bildkarten: Route, Seitenleiste, Ansicht rendert', async () => {
        const router = ohneKommentare(lies('apps/dashboard/routes/admin.router.js'));
        assert(/router\.get\('\/bildkarten'/.test(router), 'Route fehlt');
        assert(/url: '\/admin\/bildkarten'/.test(ohneKommentare(ohneKommentareEjs(lies('apps/dashboard/themes/default/partials/guild/sidebar.ejs')))), 'Seitenleiste');
        const ejs = require('ejs');
        const vorlage = lies('apps/dashboard/themes/default/views/admin/bildkarten.ejs');
        const leer = ejs.render(vorlage, {});
        assert(/Keine Vorlage gefunden/.test(leer), 'leer');
        const k = await Bildkarte.beispiel('kern:rangkarte', { guildId: '1', guildName: 'G', nutzer: { id: '2', username: 'anna' } });
        const voll = ejs.render(vorlage, {
            karten: [{ name: 'kern:rangkarte', titel: 'R', breite: 934, hoehe: 282, ebenen: 3, werte: ['level'], ms: k.ms, bytes: k.bytes, typ: k.typ, hinweise: ['h1'], bild: 'data:image/png;base64,AA' }, { name: 'x:y', fehler: 'kaputt' }],
            schriften: Bildkarte.schriftStand(), testname: '<b>', sprache: 'en-GB', guildName: 'G', grenzeBytes: Bildkarte.PNG_MAX_BYTES,
        });
        assert(/kern:rangkarte/.test(voll) && /kaputt/.test(voll) && /h1/.test(voll), 'Karte, Fehler oder Hinweis fehlt');
        assert(!/<b>/.test(voll.replace(/<b>(?=[^<]*<\/b>)/g, '')) || /&lt;b&gt;/.test(voll), 'Testname nicht escaped');
    });

    console.log('Bereich je Guild (G-21)');
    const deKern = JSON.parse(lies('plugins/core/dashboard/locales/de-DE.json'));
    const enKern = JSON.parse(lies('plugins/core/dashboard/locales/en-GB.json'));
    const sprachen = {};
    const textVon = (schluessel, loc) => {
        const [ns, rest] = schluessel.includes(':') ? schluessel.split(':') : ['core', schluessel];
        const datei = ns === 'core' ? `plugins/core/dashboard/locales/${loc}.json` : `plugins/${ns}/dashboard/locales/${loc}.json`;
        sprachen[datei] = sprachen[datei] || JSON.parse(lies(datei));
        return rest.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), sprachen[datei]);
    };
    await pruefe('12a. Erklärungen „bildkarten“ ohne Fehler, übersetzt', () => {
        Bildkarte.vergiss();
        const { karten, fehler } = Bildkarte.nutzungen();
        assert.deepStrictEqual(fehler, [], fehler.join('\n'));
        const w = (karten.get('greeting:willkommen') || []).find((n) => n.plugin === 'greeting');
        assert(w && w.stand && w.seite, 'greeting:willkommen ohne Stand oder Seite');
        for (const nutz of karten.values()) {
            for (const n of nutz) {
                for (const k of [n.wo, n.titel].filter(Boolean)) {
                    for (const loc of ['de-DE', 'en-GB']) assert(typeof textVon(k, loc) === 'string', `${k} fehlt in ${loc}`);
                }
            }
        }
        for (const name of Bildkarte.liste().filter((n) => n.startsWith('kern:'))) {
            const k = `KARTE_${name.split(':')[1].toUpperCase()}`;
            assert(typeof deKern.BILDKARTEN?.[k] === 'string' && typeof enKern.BILDKARTEN?.[k] === 'string', `core:BILDKARTEN.${k} fehlt`);
        }
        assert.deepStrictEqual(Object.keys(deKern.BILDKARTEN).sort(), Object.keys(enKern.BILDKARTEN).sort(), 'core:BILDKARTEN de/en verschieden');
    });
    await pruefe('12b. Navigation, Rechte im Katalog, Migration verteilt an Administratoren', () => {
        const nav = ohneKommentare(lies('apps/dashboard/helpers/KernNavigation.js'));
        const eintrag = nav.slice(nav.indexOf("title: 'NAV.BILDKARTEN'"), nav.indexOf('},', nav.indexOf("title: 'NAV.BILDKARTEN'")));
        assert(eintrag.length > 20, 'Navigationseintrag fehlt');
        assert(/capability: 'CORE\.BILDKARTEN\.VIEW'/.test(eintrag) && /parent: null/.test(eintrag) && /\/bildkarten`/.test(eintrag), 'Eintrag: Recht, Hauptmenü oder Adresse');
        for (const loc of ['de-DE', 'en-GB']) assert(JSON.parse(lies(`apps/dashboard/locales/${loc}.json`)).NAV?.BILDKARTEN, `NAV.BILDKARTEN fehlt in ${loc}`);
        const katalog = JSON.parse(lies('packages/dunebot-core/config/permissions.json')).permissions;
        const ansehen = katalog.find((p) => p.key === 'CORE.BILDKARTEN.VIEW');
        const einstellen = katalog.find((p) => p.key === 'CORE.BILDKARTEN.EDIT');
        assert(ansehen && einstellen && einstellen.requires === 'CORE.BILDKARTEN.VIEW', 'Rechte im Kern-Katalog');
        for (const p of [ansehen, einstellen]) {
            for (const loc of ['de-DE', 'en-GB']) assert(typeof textVon(p.name, loc) === 'string' && typeof textVon(p.description, loc) === 'string', `${p.name} fehlt in ${loc}`);
        }
        const mig = fs.readdirSync(path.join(WURZEL, 'migrations/kern')).filter((d) => /bildkarten_rechte/.test(d));
        assert(mig.length === 1, 'Migration für die Rechte fehlt');
        const m = ohneKommentare(lies(`migrations/kern/${mig[0]}`));
        assert(/slug\) = 'administrator'/.test(m) && /INSERT IGNORE INTO guild_permission_seeds/.test(m) && /CORE\.BILDKARTEN\.VIEW/.test(m) && /CORE\.BILDKARTEN\.EDIT/.test(m), 'Migration: Administrator, Merkposten, beide Rechte');
    });
    await pruefe('12c. Router mit Recht, eingehängt', () => {
        const r = ohneKommentare(lies('apps/dashboard/routes/guild/bildkarten.router.js'));
        assert(/router\.get\('\/', requirePermission\('CORE\.BILDKARTEN\.VIEW'\)/.test(r), 'Übersicht ohne Recht');
        assert(/router\.get\('\/bild\/:name', requirePermission\('CORE\.BILDKARTEN\.VIEW'\)/.test(r), 'Bild ohne Recht');
        assert(/Bildkarte\.beispiel\(/.test(r) && !/createCanvas|@napi-rs/.test(r), 'Bild nicht über Bildkarte');
        const g = ohneKommentare(lies('apps/dashboard/routes/guild.router.js'));
        assert(/router\.use\("\/:guildId\/bildkarten", CheckAuth, CheckGuildAccess, bildkartenRouter\)/.test(g), 'nicht eingehängt');
    });
    const { kartenDerGuild } = require(path.join(WURZEL, 'apps/dashboard/routes/guild/bildkarten.router.js'));
    const mitPlugins = (plugins, greetingZeile) => ServiceManager.register('dbService', {
        async query(sql) {
            if (/FROM guild_plugins/.test(sql)) return plugins.map((p) => ({ plugin_name: p }));
            if (/FROM greeting_settings/.test(sql)) return greetingZeile ? [greetingZeile] : [];
            return [];
        },
    });
    await pruefe('12d. Kern immer, Plugin nur eingeschaltet', async () => {
        mitPlugins(['core']);
        const ohne = (await kartenDerGuild('1')).map((k) => k.name);
        assert(ohne.includes('kern:rangkarte') && ohne.includes('kern:profil'), `Kern fehlt: ${ohne}`);
        assert(!ohne.includes('greeting:willkommen'), 'greeting ist aus und trotzdem da');
        mitPlugins(['core', 'greeting']);
        const mit = await kartenDerGuild('1');
        const w = mit.find((k) => k.name === 'greeting:willkommen');
        assert(w && w.nutzungen.length === 1 && w.besitzerName === 'Greeting', 'greeting eingeschaltet, Karte oder Nutzung fehlt');
        assert(mit.filter((k) => k.besitzer === 'kern').every((k) => k.nutzungen.every((n) => n.plugin !== 'greeting')), 'fremde Nutzung');
        const echt = Bildkarte.nutzungen;
        const karten = new Map(echt().karten);
        karten.set('kern:rangkarte', [{ plugin: 'leveling', titel: null, wo: 'leveling:X', seite: null, stand: null }]);
        Bildkarte.nutzungen = () => ({ karten, fehler: [] });
        try {
            mitPlugins(['core', 'greeting']);
            assert.strictEqual((await kartenDerGuild('1')).find((k) => k.name === 'kern:rangkarte').nutzungen.length, 0, 'Nutzung eines ausgeschalteten Plugins sichtbar');
            mitPlugins(['core', 'leveling']);
            assert.strictEqual((await kartenDerGuild('1')).find((k) => k.name === 'kern:rangkarte').nutzungen.length, 1, 'Nutzung eines eingeschalteten Plugins fehlt');
        } finally {
            Bildkarte.nutzungen = echt;
        }
    });
    await pruefe('12e. greeting stand(): an nur mit Nachricht und Bild, Werte wie der Bot', async () => {
        const nutz = Bildkarte.nutzungen().karten.get('greeting:willkommen')[0];
        const Willkommensbild = require(path.join(WURZEL, 'plugins/greeting/shared/willkommensbild.js'));
        const zeile = { welcome_enabled: 1, welcome_image_enabled: 1, welcome_image_bg: 'ocean', welcome_image_text: 'Hallo {member:nick}', welcome_image_color: '#ff0000' };
        mitPlugins(['greeting'], zeile);
        const s = await Bildkarte.nutzungStand(nutz, '1');
        assert.strictEqual(s.an, true, 'an');
        assert.deepStrictEqual(s.werte, Willkommensbild.werte(zeile), 'Werte anders als im Bot');
        mitPlugins(['greeting'], { ...zeile, welcome_image_enabled: 0 });
        assert.strictEqual((await Bildkarte.nutzungStand(nutz, '1')).an, false, 'Bild aus, trotzdem an');
        mitPlugins(['greeting'], { ...zeile, welcome_enabled: 0 });
        assert.strictEqual((await Bildkarte.nutzungStand(nutz, '1')).an, false, 'Nachricht aus, trotzdem an');
        mitPlugins(['greeting'], null);
        const leer = await Bildkarte.nutzungStand(nutz, '1');
        assert(leer.an === false && leer.werte.text === Willkommensbild.VORGABE_TEXT, 'ohne Zeile');
        ServiceManager.register('dbService', { async query() { throw new Error('weg'); } });
        const kaputt = await Bildkarte.nutzungStand(nutz, '1');
        assert(kaputt.an === null && /weg/.test(kaputt.fehler), 'Fehler verschluckt');
        ServiceManager.register('dbService', { async query() { return []; } });
    });
    await pruefe('12f. Seite rendert leer und voll, beide Sprachen', () => {
        const ejs = require('ejs');
        const vorlage = lies('apps/dashboard/themes/default/views/guild/bildkarten.ejs');
        for (const loc of ['de-DE', 'en-GB']) {
            const fehlt = [];
            const tr = (k, o = {}) => {
                const t = textVon(k, loc);
                if (typeof t !== 'string') { fehlt.push(k); return k; }
                return t.replace(/\{\{(\w+)\}\}/g, (_, n) => String(o[n] ?? ''));
            };
            const leer = ejs.render(vorlage, { tr, guildId: '1', karten: [] });
            assert(leer.includes(tr('core:BILDKARTEN.LEER')), 'leer');
            const voll = ejs.render(vorlage, {
                tr, guildId: '1',
                karten: [
                    { name: 'kern:rangkarte', besitzer: 'kern', besitzerName: null, titel: null, breite: 934, hoehe: 282, nutzungen: [] },
                    { name: 'greeting:willkommen', besitzer: 'greeting', besitzerName: 'Greeting', titel: 'greeting:BILDKARTEN.TITEL_WILLKOMMEN', breite: 1024, hoehe: 450,
                        nutzungen: [{ plugin: 'greeting', pluginName: 'Greeting', wo: 'greeting:BILDKARTEN.WO_WILLKOMMEN', seite: 'nachrichten', an: false, fehler: '<x>' }] },
                    { name: 'kern:profil', besitzer: 'kern', titel: null, fehler: 'kaputt', nutzungen: [] },
                ],
            });
            assert.deepStrictEqual(fehlt, [], `${loc}: ${fehlt.join(', ')}`);
            assert(voll.includes('/guild/1/bildkarten/bild/kern%3Arangkarte'), 'Bildadresse');
            assert(voll.includes('/guild/1/plugins/greeting/nachrichten'), 'Weg zum Plugin');
            assert(voll.includes(tr('core:BILDKARTEN.KEINE_NUTZUNG')) && voll.includes(tr('core:BILDKARTEN.AUS')) && voll.includes('kaputt'), 'Schablone, aus oder Fehler fehlt');
            assert(voll.includes('&lt;x&gt;') && !voll.includes('<x>'), 'nicht escaped');
        }
    });

    console.log(`\n${gruen} grün, ${rot} rot`);
    process.exitCode = rot ? 1 : 0;
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
