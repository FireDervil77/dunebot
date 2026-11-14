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
 *       nehmen dieselbe Stelle (`zeichneNutzung`), Aussehen nur unter
 *       Bildkarten (G-22): kein Feld, keine Spalte, keine Vorschau-Route mehr
 *       in greeting, die Vorschläge der Vorlage sind die alten Hintergründe.
 *   11. /admin/bildkarten: Route, Seitenleiste, die Ansicht rendert (leer und voll).
 *   12. Bereich „Bildkarten“ je Guild (G-21, F-G11):
 *       a. Erklärungen `bildkarten` in den package.json ohne Fehler, jede Karte
 *          eines Plugins erklärt, Titel und Ort in beiden Sprachen übersetzt.
 *       b. Navigation neben Medien mit CORE.BILDKARTEN.VIEW, beide Rechte im
 *          Katalog, Migration gibt sie der Administrator-Gruppe und vermerkt sie.
 *       c. Router: beide Routen mit Recht, eingehängt unter /:guildId/bildkarten.
 *       d. Welche Karten eine Guild sieht: Kern immer, Plugin nur eingeschaltet,
 *          Nutzung nur von eingeschalteten Plugins.
 *       e. greeting `stand()`: an nur mit Nachricht und Bild, keine Laufzeitwerte.
 *       f. Die Seite rendert leer und voll, Texte in beiden Sprachen.
 *   13. Eigene Karten je Guild (G-22):
 *       a. `pruefe`: einstellbare Werte und Vorschläge, mit Ablehnungen.
 *       b. `schablonen` in der Erklärung: nur eigene oder Kern, keine fremden
 *          Laufzeitwerte, gleiche Art je Name.
 *       c. Gespeichertes lesen: Unpassendes fällt auf die Vorgabe mit Hinweis,
 *          Bild nur aus der Medienablage derselben Guild.
 *       d. Eingabe prüfen: nur Abweichendes bleibt, Fehler mit Titel.
 *       e. Speichern: nichts Abweichendes löscht die Zeile.
 *       f. Zeichnen: Einstellbares gibt die Guild, nicht das Plugin; ohne
 *          lesbare Einstellung die Vorgabe mit Hinweis.
 *       g. Router: Rechte, CSRF, Kontroll-Guild nur Besitzer, Nutzung unter
 *          der gewählten Schablone.
 *       h. Einstellseite und Übersicht rendern, beide Sprachen, escaped.
 *       i. Tabelle, Löschort, greeting-Migration (Abbildung und Lauf).
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

    await pruefe('10. greeting: eine Stelle, Aussehen nur unter Bildkarten', () => {
        assert(!fs.existsSync(path.join(WURZEL, 'plugins/greeting/bot/welcomeImage.js')), 'welcomeImage.js ist zurück');
        const beitritt = ohneKommentare(lies('plugins/greeting/bot/events/guildMemberAdd.js'));
        const befehl = ohneKommentare(lies('plugins/greeting/bot/vorlageBefehl.js'));
        assert(/Willkommensbild\.anhang\(member, logger\)/.test(beitritt), 'Beitritt nimmt nicht Willkommensbild.anhang');
        assert(/Willkommensbild\.anhang\(member, ServiceManager/.test(befehl), '/welcome preview nimmt nicht Willkommensbild.anhang');
        assert(/baueNachricht\(member, a\.anlass, \{ anhaenge \}\)/.test(befehl), '/welcome preview hängt das Bild nicht an');
        const W = require(path.join(WURZEL, 'plugins/greeting/shared/willkommensbild.js'));
        assert(typeof W.anhang === 'function' && typeof W.stand === 'function' && !W.werte && !W.HINTERGRUENDE, 'willkommensbild.js rechnet wieder selbst');
        assert(/Bildkarte\.zeichneNutzung\('greeting', ANLASS/.test(ohneKommentare(lies('plugins/greeting/shared/willkommensbild.js'))), 'anhang zeichnet nicht über zeichneNutzung');
        // Kein Feld, keine Spalte mehr in greeting (außer den Migrationen).
        const reste = [];
        const geh = (ordner) => {
            for (const d of fs.readdirSync(path.join(WURZEL, ordner), { withFileTypes: true })) {
                const rel = path.join(ordner, d.name);
                if (d.isDirectory()) { if (d.name !== 'migrations' && d.name !== 'node_modules') geh(rel); continue; }
                if (!/\.(js|ejs)$/.test(d.name)) continue;
                const q = d.name.endsWith('.ejs') ? ohneKommentareEjs(lies(rel)) : ohneKommentare(lies(rel));
                if (/welcome_image_(bg|text|color)|willkommensbild\?|data-greeting-bildvorschau/.test(q)) reste.push(rel);
            }
        };
        geh('plugins/greeting');
        assert(!reste.length, `Aussehen des Bildes noch in greeting: ${reste.join(', ')}`);
        assert(!/router\.get\('\/willkommensbild'/.test(ohneKommentare(lies('plugins/greeting/dashboard/routes/guild.router.js'))), 'Vorschau-Route in greeting ist zurück');
        const ejs = ohneKommentareEjs(lies('plugins/greeting/dashboard/views/guild/greeting-content.ejs'));
        assert(/\/bildkarten\/einstellen\/greeting\/<%= encodeURIComponent\('greeting:willkommen'\) %>/.test(ejs), 'greeting verweist nicht auf die Einstellseite');
        assert(/name="welcome_image_enabled"/.test(ejs), 'Schalter „Bild anhängen“ fehlt');
        // Die Vorschläge der Vorlage sind die Hintergründe, die die Migration kennt.
        const M = require(path.join(WURZEL, 'plugins/greeting/migrations/20261114_210000_willkommensbild_bildkarten.js'));
        const v = Bildkarte.vorlage('greeting:willkommen');
        const ausVorlage = v.vorschlaege.map((x) => [x.werte.hintergrund1, x.werte.hintergrund2, x.werte.hintergrund3].join()).sort();
        assert.deepStrictEqual(ausVorlage, Object.values(M.HINTERGRUENDE).map((x) => x.join()).sort(), 'Vorschläge ≠ alte Hintergründe');
        const vorgabe = Object.fromEntries(v.werte.map((w) => [w.name, w.beispiel]));
        assert.deepStrictEqual([vorgabe.hintergrund1, vorgabe.hintergrund2, vorgabe.hintergrund3], M.HINTERGRUENDE.default, 'Vorgabe ≠ alter Standard');
        assert(vorgabe.akzent === '#5865f2' && vorgabe.text === 'Welcome to the server!' && vorgabe.hintergrundbild === '', 'Vorgabe anders als bis G-22');
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
        karten.set('kern:rangkarte', [{ plugin: 'leveling', karte: 'kern:rangkarte', titel: null, wo: 'leveling:X', seite: null, stand: null, schablonen: ['kern:rangkarte'] }]);
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
    await pruefe('12e. greeting stand(): an nur mit Nachricht und Bild, keine Laufzeitwerte', async () => {
        const nutz = Bildkarte.nutzungen().karten.get('greeting:willkommen')[0];
        const zeile = { welcome_enabled: 1, welcome_image_enabled: 1 };
        mitPlugins(['greeting'], zeile);
        const s = await Bildkarte.nutzungStand(nutz, '1');
        assert.strictEqual(s.an, true, 'an');
        assert.deepStrictEqual(s.werte, {}, 'greeting gibt Werte, die die Guild einstellt');
        mitPlugins(['greeting'], { ...zeile, welcome_image_enabled: 0 });
        assert.strictEqual((await Bildkarte.nutzungStand(nutz, '1')).an, false, 'Bild aus, trotzdem an');
        mitPlugins(['greeting'], { ...zeile, welcome_enabled: 0 });
        assert.strictEqual((await Bildkarte.nutzungStand(nutz, '1')).an, false, 'Nachricht aus, trotzdem an');
        mitPlugins(['greeting'], null);
        assert.strictEqual((await Bildkarte.nutzungStand(nutz, '1')).an, false, 'ohne Zeile');
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
                        nutzungen: [{ plugin: 'greeting', karte: 'greeting:willkommen', pluginName: 'Greeting', wo: 'greeting:BILDKARTEN.WO_WILLKOMMEN', seite: 'nachrichten', an: false, fehler: '<x>', einstellbar: true }] },
                    { name: 'kern:profil', besitzer: 'kern', titel: null, fehler: 'kaputt', nutzungen: [] },
                ],
            });
            assert.deepStrictEqual(fehlt, [], `${loc}: ${fehlt.join(', ')}`);
            assert(voll.includes('/guild/1/bildkarten/bild/kern%3Arangkarte'), 'Bildadresse');
            assert(voll.includes('/guild/1/plugins/greeting/nachrichten'), 'Weg zum Plugin');
            assert(voll.includes('/guild/1/bildkarten/einstellen/greeting/greeting%3Awillkommen') && voll.includes(tr('core:BILDKARTEN.AUSSEHEN')), 'Knopf „Aussehen einstellen“ fehlt');
            assert(voll.includes(tr('core:BILDKARTEN.KEINE_NUTZUNG')) && voll.includes(tr('core:BILDKARTEN.AUS')) && voll.includes('kaputt'), 'Schablone, aus oder Fehler fehlt');
            assert(voll.includes('&lt;x&gt;') && !voll.includes('<x>'), 'nicht escaped');
        }
    });

    console.log('Eigene Karten je Guild (G-22)');
    const W_NUTZ = () => Bildkarte.nutzungen().karten.get('greeting:willkommen').find((n) => n.plugin === 'greeting');
    /** Datenbank-Attrappe: Medien nur in Guild 11111, gespeicherte Zeile wählbar, Abfragen mitgeschrieben. */
    const MEDIEN_GUILD = '11111';
    const dbMit = ({ zeile = null, kaputt = false } = {}) => {
        const sql = [];
        ServiceManager.register('dbService', {
            async query(q, p = []) {
                sql.push([q.replace(/\s+/g, ' ').trim(), p]);
                if (kaputt) throw new Error('Datenbank weg');
                if (/FROM guild_media WHERE guild_id = \? AND stored_name/.test(q)) return p[0] === MEDIEN_GUILD && p[1] === 'a.png' ? [{ id: 7 }] : [];
                if (/FROM guild_media/.test(q)) return p[0] === MEDIEN_GUILD ? p.slice(1).filter((id) => id === 7).map((id) => ({ id, stored_name: 'a.png' })) : [];
                if (/FROM guild_bildkarten WHERE guild_id = \? AND plugin/.test(q)) return zeile ? [zeile] : [];
                return [];
            },
        });
        return sql;
    };
    const WILLKOMMEN = JSON.parse(lies('plugins/greeting/bildkarten/willkommen.json'));
    const abgelehnt = (fn, muster) => {
        try { fn(); } catch (err) { if (muster.test(err.message)) return; throw new Error(`falscher Grund: ${err.message}`); }
        throw new Error(`nicht abgelehnt (${muster})`);
    };
    const abgelehntAsync = async (fn, muster) => {
        try { await fn(); } catch (err) {
            if (!(err instanceof Bildkarte.Eingabefehler)) throw new Error(`kein Eingabefehler: ${err.message}`);
            if (muster.test(err.message)) return;
            throw new Error(`falscher Grund: ${err.message}`);
        }
        throw new Error(`nicht abgelehnt (${muster})`);
    };

    await pruefe('13a. pruefe: einstellbare Werte und Vorschläge', () => {
        Bildkarte.pruefe(JSON.parse(JSON.stringify(WILLKOMMEN)));
        const mit = (fn) => { const v = JSON.parse(JSON.stringify(WILLKOMMEN)); fn(v); return () => Bildkarte.pruefe(v); };
        abgelehnt(mit((v) => { v.werte[0].einstellbar = 'zahl'; }), /einstellbar muss eines von/);
        abgelehnt(mit((v) => { delete v.werte[0].titel; }), /braucht titel mit de und en/);
        abgelehnt(mit((v) => { v.werte[0].titel = { de: 'x' }; }), /braucht titel mit de und en/);
        abgelehnt(mit((v) => { v.werte[0].beispiel = 'rot'; }), /Beispiel muss eine Farbe/);
        abgelehnt(mit((v) => { v.werte[3].beispiel = '/uploads/media/1/a.png'; }), /Beispiel muss leer sein/);
        abgelehnt(mit((v) => { v.werte[5].beispiel = 'x'.repeat(256); }), /länger als 255/);
        abgelehnt(mit((v) => { v.werte.push({ name: 'n', beispiel: '1', titel: { de: 'a', en: 'b' } }); }), /titel nur bei einstellbaren/);
        abgelehnt(mit((v) => { v.werte.push({ name: 'akzent', beispiel: '#000000' }); }), /doppelt/);
        abgelehnt(mit((v) => { v.werte[0].bedeutung = 'x'; }), /unbekanntes Feld „bedeutung“/);
        abgelehnt(mit((v) => { v.vorschlaege[0].werte.member = '#000000'; }), /kein einstellbarer Wert/);
        abgelehnt(mit((v) => { v.vorschlaege[0].werte.hintergrundbild = ''; }), /Bild, das geht nicht/);
        abgelehnt(mit((v) => { v.vorschlaege[0].werte.akzent = 'blau'; }), /muss eine Farbe/);
        abgelehnt(mit((v) => { v.vorschlaege[0].extra = 1; }), /nur titel und werte/);
        abgelehnt(mit((v) => { v.vorschlaege[0].werte = {}; }), /werte fehlt/);
    });

    await pruefe('13b. schablonen: eigene oder Kern, keine fremden Laufzeitwerte, gleiche Art', () => {
        const t = (werte) => Bildkarte.pruefe({ breite: 100, hoehe: 100, werte, ebenen: [{ art: 'flaeche', x: 0, y: 0, b: 1, h: 1 }] });
        const farbe = { name: 'akzent', beispiel: '#000000', einstellbar: 'farbe', titel: { de: 'A', en: 'A' } };
        const lager = {
            'p:a': t([{ name: 'level', beispiel: 1 }, farbe]),
            'p:b': t([{ name: 'level', beispiel: 1 }]),
            'kern:k': t([farbe]),
            'p:mehr': t([{ name: 'level', beispiel: 1 }, { name: 'xp', beispiel: 2 }]),
            'p:anders': t([{ name: 'akzent', beispiel: 'x', einstellbar: 'text', titel: { de: 'A', en: 'A' } }]),
            'p:laufzeit': t([{ name: 'akzent', beispiel: 'x' }]),
            'q:fremd': t([]),
        };
        const laden = (n) => { if (!lager[n]) throw new Error(`keine ${n}`); return lager[n]; };
        const vorhanden = new Set(Object.keys(lager));
        const f = (roh) => Bildkarte.schablonenFehler('p', 'p:a', roh, vorhanden, laden);
        assert.deepStrictEqual(f(undefined), ['p:a']);
        assert.deepStrictEqual(f(['p:b', 'kern:k']), ['p:a', 'p:b', 'kern:k']);
        for (const [roh, muster] of [
            [['q:fremd'], /weder eigene/], [['p:fehlt'], /keine Vorlage/], [['p:mehr'], /braucht xp/],
            [['p:anders'], /akzent ist in p:anders text, anderswo farbe/], [['p:laufzeit'], /p:laufzeit braucht akzent, das p:a nicht kennt/], [['p:a'], /doppelt/],
            [['p:b', 'p:b'], /doppelt/], [[], /1 bis 8/], ['p:b', /1 bis 8/],
        ]) {
            const r = f(roh);
            assert(typeof r === 'string' && muster.test(r), `${JSON.stringify(roh)}: ${JSON.stringify(r)}`);
        }
        assert.deepStrictEqual(W_NUTZ().schablonen, ['greeting:willkommen'], 'greeting bietet ungefragt Schablonen an');
    });

    await pruefe('13c. Gespeichertes lesen: Unpassendes → Vorgabe mit Hinweis, Bild nur aus derselben Guild', async () => {
        const n = W_NUTZ();
        const sql = dbMit({ zeile: { vorlage: 'kern:rangkarte', werte: JSON.stringify({ akzent: '#ff0000', hintergrund1: 'rot', text: 42, hintergrundbild: 7, fremd: 'x' }) } });
        const e = await Bildkarte.einstellung('greeting', 'greeting:willkommen', MEDIEN_GUILD);
        assert.strictEqual(e.vorlage, 'greeting:willkommen', 'nicht angebotene Schablone genommen');
        assert(e.hinweise.some((h) => /kern:rangkarte bietet greeting nicht mehr an/.test(h)), 'kein Hinweis zur Schablone');
        assert.strictEqual(e.werte.akzent, '#ff0000');
        assert.strictEqual(e.werte.hintergrund1, '#1a1a2e', 'falsche Farbe nicht auf Vorgabe');
        assert.strictEqual(e.werte.text, 'Welcome to the server!', 'Zahl als Text genommen');
        assert.strictEqual(e.werte.hintergrundbild, `/uploads/media/${MEDIEN_GUILD}/a.png`, 'Bild nicht aufgelöst');
        assert(!('fremd' in e.werte) && !('fremd' in e.gespeichert.werte), 'fremder Wert durchgereicht');
        const medien = sql.find(([q]) => /FROM guild_media/.test(q));
        assert(medien && /guild_id = \?/.test(medien[0]) && medien[1][0] === MEDIEN_GUILD, 'Bild ohne Guild-Bezug gelesen');
        dbMit({ zeile: { vorlage: null, werte: { hintergrundbild: 7 } } });
        const anders = await Bildkarte.einstellung('greeting', 'greeting:willkommen', '22222');
        assert.strictEqual(anders.werte.hintergrundbild, '', 'Bild einer fremden Guild genommen');
        assert(anders.hinweise.some((h) => /nicht mehr in der Medienablage/.test(h)), 'kein Hinweis zum fehlenden Bild');
        dbMit();
        const leer = await Bildkarte.einstellung('greeting', 'greeting:willkommen', MEDIEN_GUILD);
        assert(leer.vorlage === 'greeting:willkommen' && !leer.hinweise.length && leer.werte.akzent === '#5865f2', 'ohne Zeile nicht die Vorgabe');
        await abgelehntAsync(() => Bildkarte.einstellung('greeting', 'kern:rangkarte', MEDIEN_GUILD), /erklärt keine Bildkarte/);
    });

    await pruefe('13d. Eingabe prüfen: nur Abweichendes, Fehler mit Titel', async () => {
        const n = W_NUTZ();
        dbMit();
        const g = await Bildkarte.eingabePruefen(n, MEDIEN_GUILD, { werte: {
            akzent: '#5865F2', text: 'Welcome to the server!', hintergrund1: '#ABCDEF', hintergrund2: '', hintergrundbild: `/uploads/media/${MEDIEN_GUILD}/a.png`, member: 'x',
        } });
        assert.deepStrictEqual(g, { vorlage: null, werte: { hintergrund1: '#abcdef', hintergrundbild: 7 } });
        assert.deepStrictEqual(await Bildkarte.eingabePruefen(n, MEDIEN_GUILD, { vorlage: 'greeting:willkommen', werte: { text: '  ' } }), { vorlage: null, werte: {} });
        assert.deepStrictEqual((await Bildkarte.eingabePruefen(n, MEDIEN_GUILD, { werte: { text: 'Hi {member:nick} auf {guild:name}' } })).werte, { text: 'Hi {member:nick} auf {guild:name}' });
        await abgelehntAsync(() => Bildkarte.eingabePruefen(n, MEDIEN_GUILD, { werte: { akzent: 'rot' } }), /^Akzentfarbe: „rot“ ist kein Farbwert/);
        await abgelehntAsync(() => Bildkarte.eingabePruefen(n, MEDIEN_GUILD, { werte: { akzent: 'rot' } }, 'en'), /^Accent colour:/);
        await abgelehntAsync(() => Bildkarte.eingabePruefen(n, MEDIEN_GUILD, { werte: { text: 'Level {level}' } }), /Platzhalter \{level\} gibt es hier nicht/);
        await abgelehntAsync(() => Bildkarte.eingabePruefen(n, MEDIEN_GUILD, { werte: { text: 'x'.repeat(256) } }), /höchstens 255/);
        await abgelehntAsync(() => Bildkarte.eingabePruefen(n, MEDIEN_GUILD, { werte: { text: ['a'] } }), /kein Text/);
        await abgelehntAsync(() => Bildkarte.eingabePruefen(n, MEDIEN_GUILD, { werte: { hintergrundbild: '/uploads/media/22222/a.png' } }), /aus der Medienablage dieses Servers wählen/);
        await abgelehntAsync(() => Bildkarte.eingabePruefen(n, MEDIEN_GUILD, { werte: { hintergrundbild: `/uploads/media/${MEDIEN_GUILD}/b.png` } }), /liegt nicht in der Medienablage/);
        await abgelehntAsync(() => Bildkarte.eingabePruefen(n, MEDIEN_GUILD, { werte: { hintergrundbild: `/uploads/media/${MEDIEN_GUILD}/../x/a.png` } }), /wählen/);
        await abgelehntAsync(() => Bildkarte.eingabePruefen(n, MEDIEN_GUILD, { werte: { hintergrundbild: 'https://cdn.discordapp.com/x.png' } }), /wählen/);
        await abgelehntAsync(() => Bildkarte.eingabePruefen(n, MEDIEN_GUILD, { vorlage: 'kern:rangkarte' }), /gibt es für diese Karte nicht/);
    });

    await pruefe('13e. Speichern: nichts Abweichendes löscht die Zeile', async () => {
        let sql = dbMit();
        await Bildkarte.speichereEinstellung('greeting', 'greeting:willkommen', MEDIEN_GUILD, { werte: { akzent: '#5865f2' } });
        assert(sql.some(([q, p]) => /^DELETE FROM guild_bildkarten WHERE guild_id = \? AND plugin = \? AND karte = \?$/.test(q) && p.join() === `${MEDIEN_GUILD},greeting,greeting:willkommen`), 'Vorgabe nicht gelöscht');
        assert(!sql.some(([q]) => /INSERT INTO guild_bildkarten/.test(q)), 'Vorgabe gespeichert');
        sql = dbMit();
        await Bildkarte.speichereEinstellung('greeting', 'greeting:willkommen', MEDIEN_GUILD, { werte: { akzent: '#123456' } });
        const ein = sql.find(([q]) => /INSERT INTO guild_bildkarten/.test(q));
        assert(ein && ein[1][0] === MEDIEN_GUILD && ein[1][1] === 'greeting' && ein[1][3] === null && ein[1][4] === '{"akzent":"#123456"}', `gespeichert: ${JSON.stringify(ein)}`);
        sql = dbMit();
        await abgelehntAsync(() => Bildkarte.speichereEinstellung('greeting', 'greeting:willkommen', MEDIEN_GUILD, { werte: { akzent: 'x' } }), /Farbwert/);
        assert(!sql.some(([q]) => /INSERT|DELETE/.test(q)), 'trotz Fehler geschrieben');
    });

    await pruefe('13f. Zeichnen: Einstellbares gibt die Guild, nicht das Plugin', async () => {
        const n = W_NUTZ();
        dbMit();
        const e = (werte) => Bildkarte.einstellungAufloesen(n, MEDIEN_GUILD, { werte });
        const rot = await e({ akzent: '#ff0000', text: 'A' });
        const a = await Bildkarte.zeichneNutzung('greeting', 'greeting:willkommen', { member: stubMember(), werte: { akzent: '#00ff00', text: 'B' } }, { guildId: MEDIEN_GUILD, einstellung: rot });
        const b = await Bildkarte.zeichneNutzung('greeting', 'greeting:willkommen', { member: stubMember() }, { guildId: MEDIEN_GUILD, einstellung: rot });
        const c = await Bildkarte.zeichneNutzung('greeting', 'greeting:willkommen', { member: stubMember() }, { guildId: MEDIEN_GUILD, einstellung: await e({ akzent: '#00ff00', text: 'A' }) });
        assert(a.puffer.equals(b.puffer), 'Plugin-Werte überschreiben die Einstellung');
        assert(!b.puffer.equals(c.puffer), 'Einstellung wirkt nicht');
        dbMit({ kaputt: true });
        const d = await Bildkarte.zeichneNutzung('greeting', 'greeting:willkommen', { member: stubMember() }, { guildId: MEDIEN_GUILD });
        assert(d.hinweise.some((h) => /Einstellung nicht lesbar, nehme die Vorgabe: Datenbank weg/.test(h)), 'Fehler verschluckt');
        dbMit();
        const vorgabe = await Bildkarte.zeichneNutzung('greeting', 'greeting:willkommen', { member: stubMember() }, { guildId: MEDIEN_GUILD });
        assert(vorgabe.puffer.equals(d.puffer), 'ohne lesbare Einstellung nicht die Vorgabe');
    });

    await pruefe('13g. Router: Rechte, CSRF, Kontroll-Guild, Nutzung unter der gewählten Schablone', async () => {
        const r = ohneKommentare(lies('apps/dashboard/routes/guild/bildkarten.router.js'));
        assert(/router\.get\('\/einstellen\/:plugin\/:karte', requirePermission\('CORE\.BILDKARTEN\.VIEW'\)/.test(r), 'Einstellseite ohne Recht');
        assert(/router\.get\('\/einstellen\/:plugin\/:karte\/vorschau', requirePermission\('CORE\.BILDKARTEN\.VIEW'\)/.test(r), 'Vorschau ohne Recht');
        assert(/router\.put\('\/einstellen\/:plugin\/:karte', csrfProtection, requirePermission\('CORE\.BILDKARTEN\.EDIT'\), requireBesitzerInKontrollGuild\(\)/.test(r), 'Speichern ohne CSRF, Recht oder Kontroll-Guild-Schutz');
        assert(/istKontrollGuildGesperrt\(/.test(r) && /'CORE\.BILDKARTEN\.EDIT'\);/.test(r), 'Seite weiß nicht, ob nur lesen');
        assert(/Bildkarte\.speichereEinstellung\(/.test(r) && /Bildkarte\.eingabePruefen\(/.test(r) && /Bildkarte\.beispielNutzung\(/.test(r), 'Router rechnet selbst');
        assert(!/INSERT|UPDATE guild_bildkarten|DELETE/.test(r), 'Router schreibt selbst in die Tabelle');
        const nutzAn = /if \(!\(await eingeschaltet\(guildId\)\)\.has\(plugin\)\) return null;/.test(r);
        assert(nutzAn, 'Einstellen auch bei ausgeschaltetem Plugin');
        // Wahl einer Schablone: Nutzung wandert unter sie.
        const echt = Bildkarte.nutzungen;
        const karten = new Map(echt().karten);
        karten.set('kern:rangkarte', [{ plugin: 'leveling', karte: 'kern:rangkarte', titel: null, wo: 'leveling:X', seite: null, stand: null, schablonen: ['kern:rangkarte', 'kern:profil'] }]);
        Bildkarte.nutzungen = () => ({ karten, fehler: [] });
        try {
            ServiceManager.register('dbService', { async query(q) {
                if (/FROM guild_plugins/.test(q)) return [{ plugin_name: 'leveling' }];
                if (/FROM guild_bildkarten/.test(q)) return [{ plugin: 'leveling', karte: 'kern:rangkarte', vorlage: 'kern:profil' }];
                return [];
            } });
            const k = await kartenDerGuild('1');
            assert.strictEqual(k.find((x) => x.name === 'kern:rangkarte').nutzungen.length, 0, 'Nutzung bleibt unter der erklärten');
            const p = k.find((x) => x.name === 'kern:profil').nutzungen;
            assert(p.length === 1 && p[0].karte === 'kern:rangkarte' && p[0].einstellbar === true, 'Nutzung nicht unter der gewählten');
        } finally {
            Bildkarte.nutzungen = echt;
            ServiceManager.register('dbService', { async query() { return []; } });
        }
    });

    await pruefe('13h. Einstellseite und Übersicht rendern, beide Sprachen, escaped', () => {
        const ejs = require('ejs');
        const vorlage = lies('apps/dashboard/themes/default/views/guild/bildkarte-einstellen.ejs');
        const { seitenFelder } = require(path.join(WURZEL, 'apps/dashboard/routes/guild/bildkarten.router.js'));
        const n = W_NUTZ();
        for (const loc of ['de-DE', 'en-GB']) {
            const fehlt = [];
            const tr = (k, o = {}) => {
                const t = textVon(k, loc);
                if (typeof t !== 'string') { fehlt.push(k); return k; }
                return t.replace(/\{\{(\w+)\}\}/g, (_, x) => String(o[x] ?? ''));
            };
            const e = { vorlage: 'greeting:willkommen', werte: { hintergrund1: '#1a1a2e', hintergrund2: '#16213e', hintergrund3: '#0f3460', hintergrundbild: '/uploads/media/1/b%20c.png', akzent: '#ff0080', text: '<b>Hi</b>' }, gespeichert: { vorlage: null, werte: {} } };
            const felder = seitenFelder(n, e, loc.startsWith('de') ? 'de' : 'en');
            assert.deepStrictEqual(felder.felder.map((f) => f.art), ['farbe', 'farbe', 'farbe', 'bild', 'farbe', 'text'], 'Felder');
            assert.strictEqual(felder.vorschlaege.length, 7, 'Vorschläge');
            const html = (darf, gesperrt) => ejs.render(vorlage, {
                tr, guildId: '1', nutzung: { ...n, pluginName: 'Greeting', an: true }, gewaehlt: e.vorlage, hinweise: ['<i>h</i>'],
                ...felder, darf, gesperrt, locals: {},
            }, { views: [path.join(WURZEL, 'apps/dashboard/themes/default/views')], filename: path.join(WURZEL, 'apps/dashboard/themes/default/views/guild/bildkarte-einstellen.ejs') });
            const voll = html(true, false);
            assert.deepStrictEqual([...new Set(fehlt)], [], `${loc}: ${fehlt.join(', ')}`);
            assert(voll.includes('data-adresse="/guild/1/bildkarten/einstellen/greeting/greeting%3Awillkommen"'), 'Adresse');
            assert(voll.includes('id="medienwahlFenster"'), 'Medienwahl fehlt trotz Bildfeld');
            assert(voll.includes('&lt;b&gt;Hi&lt;/b&gt;') && !voll.includes('<b>Hi</b>') && voll.includes('&lt;i&gt;h&lt;/i&gt;'), 'nicht escaped');
            assert(voll.includes('b c.png'), 'Bildname');
            assert(!/<(input|select|button)[^>]*data-bk-speichern[^>]*disabled/.test(voll), 'mit Recht gesperrt');
            const lesend = html(false, false);
            assert(lesend.includes(tr('core:BILDKARTEN.NUR_LESEN')) && /data-bk-speichern disabled/.test(lesend), 'ohne Recht nicht gesperrt');
            const kontroll = html(false, true);
            assert(kontroll.includes(tr('core:BILDKARTEN.GESPERRT')), 'Kontroll-Guild ohne Hinweis');
        }
        const js = ohneKommentareEjs(vorlage);
        assert(!/document\.currentScript/.test(js), 'document.currentScript (Skripte stehen am Seitenende)');
        assert(/'X-CSRF-Token'/.test(js) && /method: 'PUT'/.test(js), 'Speichern ohne CSRF');
        assert(!/confirm\(/.test(js), 'confirm()');
    });

    await pruefe('13i. Tabelle, Löschort, greeting-Migration', async () => {
        const mig = ohneKommentare(lies('migrations/kern/20261114_210000_bildkarten_einstellungen.js'));
        assert(/CREATE TABLE IF NOT EXISTS guild_bildkarten/.test(mig) && /PRIMARY KEY \(guild_id, plugin, karte\)/.test(mig) && /json_valid\(werte\)/.test(mig), 'Tabelle');
        assert(!/user_id|member_id|frist/.test(mig), 'Mitgliederdaten oder Frist in der Tabelle');
        assert(JSON.parse(lies('plugins/core/package.json')).guildInhalte.loeschen.includes('guild_bildkarten'), 'guild_bildkarten geht nicht mit der Guild');
        const M = require(path.join(WURZEL, 'plugins/greeting/migrations/20261114_210000_willkommensbild_bildkarten.js'));
        assert.deepStrictEqual(M.alsWerte({ welcome_image_bg: 'default', welcome_image_text: null, welcome_image_color: '#5865f2' }), {});
        assert.deepStrictEqual(M.alsWerte({ welcome_image_bg: 'ocean', welcome_image_text: ' Willkommen auf dem Server ', welcome_image_color: '#FF0080' }),
            { hintergrund1: '#0a192f', hintergrund2: '#172a45', hintergrund3: '#1c4a6e', akzent: '#ff0080', text: 'Willkommen auf dem Server' });
        assert.deepStrictEqual(M.alsWerte({ welcome_image_bg: 'gibtsnicht', welcome_image_color: 'rot', welcome_image_text: '' }), {});
        // Was die Migration schreibt, liest der Kern ohne Hinweis zurück.
        dbMit({ zeile: { vorlage: null, werte: JSON.stringify(M.alsWerte({ welcome_image_bg: 'sunset', welcome_image_text: 'Willkommen {member:nick}!', welcome_image_color: '#d90de7' })) } });
        const zurueck = await Bildkarte.einstellung('greeting', 'greeting:willkommen', MEDIEN_GUILD);
        assert(!zurueck.hinweise.length && zurueck.werte.hintergrund3 === '#e94560' && zurueck.werte.text === 'Willkommen {member:nick}!', 'Migration und Kern verstehen sich nicht');
        // Lauf an einer Attrappe.
        const lauf = async (zeilen, spalten) => {
            const sql = [];
            await M.up({ async query(q, p) {
                sql.push([q.replace(/\s+/g, ' ').trim(), p]);
                if (/^SHOW COLUMNS/.test(q)) return spalten.map((Field) => ({ Field }));
                if (/^SELECT guild_id/.test(q)) return zeilen;
                return [];
            } });
            return sql;
        };
        const alle = ['guild_id', 'welcome_image_enabled', 'welcome_image_bg', 'welcome_image_text', 'welcome_image_color'];
        const sql = await lauf([
            { guild_id: '1', welcome_image_bg: 'default', welcome_image_text: null, welcome_image_color: '#5865f2' },
            { guild_id: '2', welcome_image_bg: 'ocean', welcome_image_text: 'Hallo', welcome_image_color: '#ff0080' },
        ], alle);
        const ein = sql.filter(([q]) => /^INSERT INTO guild_bildkarten/.test(q));
        assert(ein.length === 1 && ein[0][1][0] === '2' && /ON DUPLICATE KEY UPDATE karte = karte/.test(ein[0][0]), `Einträge: ${JSON.stringify(ein)}`);
        assert.deepStrictEqual(sql.filter(([q]) => /DROP COLUMN/.test(q)).map(([q]) => q.split(' ').pop()), ['welcome_image_bg', 'welcome_image_text', 'welcome_image_color']);
        assert.strictEqual((await lauf([], ['guild_id', 'welcome_image_enabled'])).length, 1, 'zweiter Lauf tut etwas');
        await assert.rejects(lauf([{ guild_id: '3', welcome_image_text: 'x'.repeat(256) }], alle), /länger als 255/);
        ServiceManager.register('dbService', { async query() { return []; } });
    });

    console.log(`\n${gruen} grün, ${rot} rot`);
    process.exitCode = rot ? 1 : 0;
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
