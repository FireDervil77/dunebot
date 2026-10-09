#!/usr/bin/env node
/**
 * Werkbank: die Karte „Mods", Stufe 1 (2026-10-09).
 *
 * ── Was hier geprüft wird ───────────────────────────────────────────────────
 *
 * `content` war der letzte Teil, der bei geöffneten Paketen nur mitreiste. Mit
 * dem Betreiber am 2026-10-09 in zwei Stufen geteilt:
 *
 *   Stufe 1   der flache Teil — Mods ja/nein, Quellen mit Kennungen, Ablageort,
 *             vier Angaben zum Verhalten. Das ist diese Karte.
 *   Stufe 2   `loader` (Valheim) und `by_setting` + `variants` (Minecraft).
 *             Reisen bis dahin unverändert mit.
 *
 * Die Probe ist dieselbe wie bei jeder Karte: Jedes eingelieferte Paket,
 * UNVERÄNDERT durch das Formular gespeichert, ergibt dasselbe Paket mit
 * derselben Prüfsumme — auch Minecraft, dessen Quellen und Ablageort in den
 * Varianten stehen, und Astro Colony, das nur `supported: false` trägt.
 *
 * Dazu die Regeln, an denen im Betrieb etwas hängt:
 *
 *   - Ein Anbieter ohne Kennung hat im Panel keine Suche (Quellen.raumAus).
 *   - Ohne Ablageort weist der Reiter „Inhalte" jede Installation ab; ohne
 *     „game/" davor liegen die Mods neben dem Spiel (gemessen 2026-09-12).
 *   - Was die Karte „angebunden" nennt, ist das, was das Panel wirklich kann.
 *
 * Gelesen wird aus der Datenbank, geschrieben nichts.
 *
 *   node scripts/check-werkbank-mods.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const WURZEL = path.join(__dirname, '..');
const DAEMON = '/home/firedervil/firebot_daemon';
require('dotenv').config({ path: path.join(WURZEL, 'apps/dashboard/.env'), quiet: true });
const mysql = require('mysql2/promise');
const Ajv = require('ajv');
const { ServiceManager } = require('dunebot-core');
const { ohneKommentare, ohneKommentareEjs } = require('./lib/quelltext');

// Die Attrappe kennt genau: das Schreiben des Entwurfs (geht ins Leere) und die
// drei Fragen „läuft gerade etwas?". Alles andere ist ein Fehler.
let beschaeftigt = false;
ServiceManager.register('dbService', {
    query: async (sql) => {
        const t = sql.trim();
        if (/^UPDATE werkbank_sitzungen SET entwurf = \? WHERE id = \?$/.test(t)) return {};
        if (/FROM werkbank_pruefungen p JOIN werkbank_sitzungen s[\s\S]*p\.status = 'laeuft'/.test(t)) return beschaeftigt ? [{ pruefId: 1, guildId: 'g' }] : [];
        if (/^SELECT id FROM werkbank_schritte WHERE sitzung_id = \? AND status = 'laeuft' LIMIT 1$/.test(t)) return [];
        if (/FROM werkbank_laeufe l JOIN werkbank_sitzungen s[\s\S]*l\.status <> 'beendet'/.test(t)) return [];
        throw new Error(`Attrappe kennt die Abfrage nicht: ${t.slice(0, 90)}`);
    },
});
const still = () => {};
ServiceManager.register('Logger', { debug: still, info: still, warn: still, error: still, success: still });
const S = require('../plugins/werkbank/dashboard/helpers/Sitzungen');
const Quellen = require('../plugins/gameserver/dashboard/helpers/Quellen');

let fehler = 0;
async function pruefe(was, tun) {
    try { await tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').slice(0, 4).join('\n      ')}`); }
}
const j = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
const kopie = (v) => JSON.parse(JSON.stringify(v));
const sortiert = (v) => Array.isArray(v) ? v.map(sortiert)
    : (v && typeof v === 'object') ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sortiert(v[k])])) : v;
const gleich = (a, b, was) => assert.deepStrictEqual(sortiert(a), sortiert(b), was);
const wirft = (tun, muster) => assert.rejects(tun, (e) => { assert.match(e.message, muster); return true; });
const lies = (...teile) => fs.readFileSync(path.join(...teile), 'utf8');

/** Die Karte so im Formular, wie die Seite sie vorbelegt und ihr Skript sie schickt. */
const formular = (stand) => ({
    supported: stand.supported ? '1' : '',
    sources: stand.quellen.filter(q => q.an).map(q => q.kennung),
    source_ids: Object.fromEntries(stand.quellen.filter(q => q.kennung !== 'upload').map(q => [q.kennung, q.id])),
    path: stand.path, activation: stand.activation,
    needs_restart: stand.needs_restart ? '1' : '', client_side: stand.client_side ? '1' : '', order_matters: stand.order_matters ? '1' : '',
});
/** Ein gültiges Formular für ein Spiel mit Mods — einzelne Felder überschreibbar. */
const gut = (mehr = {}) => ({ supported: '1', sources: ['upload', 'thunderstore'], source_ids: { thunderstore: 'valheim' }, path: 'game/BepInEx/plugins',
    activation: '', needs_restart: '1', client_side: '', order_matters: '', ...mehr });

function frisch(mehr = {}) {
    return { id: 7, kennung: 'wbmo', guild_id: 'g1', rootserver_id: 1, image: { ref: 'registry.firenetworks.de/fb/steamcmd', tag: '2026.10' }, entwurf: {
        identity: { slug: 'probe', name: 'Probe', version: '1.0.0' },
        ports: [{ purpose: 'game', protocol: 'udp', assign: 'pool' }],
        start: { program: './Server', args: [], ready_when: { port: 'game' } },
        werkbank: { portnummern: { game: 27015 } },
        ...mehr,
    } };
}

(async () => {
    const c = await mysql.createConnection({
        host: process.env.MYSQL_HOST, port: process.env.MYSQL_PORT,
        user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE, dateStrings: true,
    });
    const [zeilen] = await c.query('SELECT v.fbpkg FROM package_versions v ORDER BY v.published_at, v.id');
    await c.end();
    const neueste = new Map();
    for (const z of zeilen) { const p = j(z.fbpkg); neueste.set(p.identity.slug, p); }
    assert.ok(neueste.size > 0, 'kein einziges Paket in der Datenbank — der Wächter mässe nichts');
    const schema = JSON.parse(lies(WURZEL, 'packages/fbpkg/schema/fbpkg-v1.schema.json'));
    // `variants` verweist auf `#/properties/content` zurück — das ganze Schema muss bekannt sein.
    const ajv = new Ajv({ allErrors: true });
    ajv.addSchema(schema, 'fbpkg');
    const giltContent = ajv.compile({ $ref: 'fbpkg#/properties/content' });

    // ── 1) Unverändert speichern ändert nichts ───────────────────────────────
    console.log('\nBestandspakete: unverändert durch die Karte');
    const gesehen = { pakete: 0, ohne_content: 0, nur_nein: 0, flach: 0, mit_lader: 0, mit_varianten: 0 };
    for (const [slug, paket] of neueste) {
        gesehen.pakete++;
        const k = paket.content;
        if (k === undefined) gesehen.ohne_content++;
        else if (k.variants) gesehen.mit_varianten++;
        else if (k.loader) gesehen.mit_lader++;
        else if (k.supported === false && Object.keys(k).length === 1) gesehen.nur_nein++;
        else gesehen.flach++;

        await pruefe(`${slug}: ${k === undefined ? 'ohne content' : Object.keys(k).join(', ').slice(0, 70)} — dasselbe Paket, derselbe Fingerabdruck`, async () => {
            const vorher = kopie(paket);
            const { entwurf, image, schritte } = S.entwurfAusPaket(paket);
            entwurf.werkbank = { portnummern: S.vorlaeufigePortnummern(entwurf.ports), geoeffnet: { slug, version: paket.identity.version, ziele: S.zieleAusPaket(paket) } };
            const sitzung = { id: 1, kennung: 'wbprobe', rootserver_id: 1, entwurf, image };
            const liste = schritte.map(schritt => ({ status: 'uebernommen', schritt }));
            gleich(paket, vorher, 'das Zerlegen hat das Paket verändert');

            // Der flache Teil liegt im Entwurf, Lader und Varianten reisen mit.
            const rest = entwurf.durchgereicht?.content || {};
            for (const f of S.MODS.felder) {
                assert.strictEqual(rest[f], undefined, `content.${f} steht noch im Durchgereichten`);
                gleich(entwurf.content?.[f], k?.[f], `der Entwurf trägt content.${f} des Pakets nicht`);
            }
            for (const f of ['loader', 'by_setting', 'variants']) gleich(rest[f], k?.[f], `content.${f} ist beim Zerlegen verloren gegangen`);

            const stand = S.modsStand(sitzung);
            assert.strictEqual(stand.vorhanden, k !== undefined);
            assert.strictEqual(stand.supported, k?.supported === true);
            gleich(stand.quellen.filter(q => q.an).map(q => q.kennung).sort(), [...(k?.sources || [])].sort());
            assert.strictEqual(stand.lader, k?.loader ? k.loader.key : null);
            gleich(stand.varianten, k?.variants ? Object.keys(k.variants) : []);

            const davor = kopie(S.entwurfAlsPaket(sitzung, liste));
            gleich(davor.content, paket.content, 'schon das Zusammensetzen ändert content');
            await S.modsSpeichern(sitzung, formular(stand));
            const danach = S.entwurfAlsPaket(sitzung, liste);
            gleich(danach, davor, 'unverändert gespeichert, und das Paket ist anders');
            // Die Reihenfolge der Quellen ist die des Pakets — der Reiter „Inhalte" zeigt sie so.
            assert.deepStrictEqual(danach.content?.sources, paket.content?.sources, 'die Reihenfolge der Quellen hat sich geändert');
            assert.strictEqual(S.fingerabdruck(danach), S.fingerabdruck(davor), 'der Fingerabdruck hat sich geändert — ein grüner Durchlauf gälte nicht mehr');
        });
    }
    await pruefe('gesehen wurden: kein content, nur „nein", ein Lader, Varianten', async () => {
        assert.ok(gesehen.ohne_content > 0, 'kein Paket ohne content — „nichts bleibt nichts" ist ungeprüft');
        assert.ok(gesehen.nur_nein > 0, 'kein Paket mit supported: false allein');
        assert.ok(gesehen.mit_lader > 0, 'kein Paket mit Lader — dass er mitreist, ist ungeprüft');
        assert.ok(gesehen.mit_varianten > 0, 'kein Paket mit Varianten — der Fall „Quellen stehen woanders" ist ungeprüft');
    });
    await pruefe('eine Sitzung aus der Zeit vor der Karte zieht beim Laden um — der flache Teil, sonst nichts', async () => {
        const einmal = S.ordne({ durchgereicht: { content: { supported: true, path: 'game/mods', sources: ['upload'], loader: { key: 'x' }, by_setting: 'loader', variants: { a: { supported: false } } } } });
        gleich(einmal.content, { supported: true, path: 'game/mods', sources: ['upload'] });
        gleich(einmal.durchgereicht, { content: { loader: { key: 'x' }, by_setting: 'loader', variants: { a: { supported: false } } } });
        gleich(S.ordne(kopie(einmal)), einmal, 'ordne ist nicht wiederholbar');
        // Und Stufe 2 hat noch keine Karte — sonst stimmt der Hinweis der Karte nicht mehr.
        for (const f of ['loader', 'by_setting', 'variants']) assert.ok(!S.EIGENE.content.includes(f), `content.${f} hat eine Karte bekommen — der Hinweis „bleibt unverändert" ist dann falsch`);
    });

    // ── 2) Die Regeln ────────────────────────────────────────────────────────
    console.log('\nRegeln');
    await pruefe('ein neues Spiel mit Mods: im Paket steht, was das Schema will — Vorgaben werden nicht hingeschrieben', async () => {
        const s = frisch();
        await S.modsSpeichern(s, gut());
        gleich(s.entwurf.content, { supported: true, sources: ['upload', 'thunderstore'], source_ids: { thunderstore: 'valheim' }, path: 'game/BepInEx/plugins' });
        assert.ok(giltContent(s.entwurf.content), JSON.stringify(giltContent.errors));
        // Abweichungen von der Vorgabe stehen da.
        await S.modsSpeichern(s, gut({ needs_restart: '', client_side: '1', order_matters: '1', activation: 'file_present', path: 'game/mods/' }));
        gleich(s.entwurf.content, { supported: true, sources: ['upload', 'thunderstore'], source_ids: { thunderstore: 'valheim' }, path: 'game/mods',
            activation: 'file_present', needs_restart: false, client_side: true, order_matters: true });
        assert.ok(giltContent(s.entwurf.content), JSON.stringify(giltContent.errors));
        // Zurück auf die Vorgabe: Was einmal dastand, wird umgestellt, nicht gelöscht.
        await S.modsSpeichern(s, gut());
        gleich(s.entwurf.content, { supported: true, sources: ['upload', 'thunderstore'], source_ids: { thunderstore: 'valheim' }, path: 'game/BepInEx/plugins',
            needs_restart: true, client_side: false, order_matters: false });
    });
    await pruefe('ein Spiel ohne Mods bekommt keinen Teil — und „nein" bleibt „nein", wo es stand', async () => {
        const s = frisch();
        await S.modsSpeichern(s, { supported: '', sources: [], source_ids: {}, path: '', activation: '', needs_restart: '1', client_side: '', order_matters: '' });
        assert.ok(!('content' in s.entwurf), 'ein leeres Formular hat einen Teil angelegt');
        const nein = frisch({ content: { supported: false } });
        await S.modsSpeichern(nein, formular(S.modsStand(nein)));
        gleich(nein.entwurf.content, { supported: false });
        // Ausschalten nimmt die Angaben nicht weg — wieder einschalten soll nichts kosten.
        const an = frisch();
        await S.modsSpeichern(an, gut());
        await S.modsSpeichern(an, gut({ supported: '' }));
        assert.strictEqual(an.entwurf.content.supported, false);
        assert.strictEqual(an.entwurf.content.path, 'game/BepInEx/plugins');
    });
    await pruefe('die Reihenfolge der Quellen bleibt, neue kommen hinten an, abgewählte gehen', async () => {
        const s = frisch({ content: { supported: true, sources: ['upload', 'thunderstore'], source_ids: { thunderstore: 'valheim' }, path: 'game/mods' } });
        await S.modsSpeichern(s, gut({ sources: ['modrinth', 'thunderstore', 'upload'], source_ids: { thunderstore: 'valheim', modrinth: 'fabric' }, path: 'game/mods' }));
        assert.deepStrictEqual(s.entwurf.content.sources, ['upload', 'thunderstore', 'modrinth']);
        await S.modsSpeichern(s, gut({ sources: ['modrinth', 'upload'], source_ids: { modrinth: 'fabric', thunderstore: '' }, path: 'game/mods' }));
        assert.deepStrictEqual(s.entwurf.content.sources, ['upload', 'modrinth']);
        gleich(s.entwurf.content.source_ids, { modrinth: 'fabric' });
    });
    await pruefe('abgewiesen: Anbieter ohne Kennung, Kennung ohne Anbieter, fremde Quelle', async () => {
        const s = frisch();
        const mit = (mehr) => S.modsSpeichern(s, gut(mehr));
        await wirft(() => mit({ source_ids: {} }), /„thunderstore" braucht ihre Kennung/);
        await wirft(() => mit({ sources: ['upload'], source_ids: { thunderstore: 'valheim' } }), /nicht eingeschaltet/);
        await wirft(() => mit({ sources: ['upload', 'nexus'] }), /gibt es nicht/);
        await wirft(() => mit({ source_ids: { thunderstore: 'valheim', upload: 'x' } }), /kennt keine Kennung/);
        await wirft(() => mit({ source_ids: { thunderstore: 'c/valheim' } }), /wie sie beim Anbieter in der Adresse steht/);
        await wirft(() => mit({ source_ids: { thunderstore: 'x'.repeat(S.MODS.max.kennung + 1) } }), /wie sie beim Anbieter/);
        await wirft(() => mit({ sources: ['steam-workshop'], source_ids: { 'steam-workshop': 'valheim' } }), /nur Ziffern/);
        assert.ok(!('content' in s.entwurf), 'ein abgewiesenes Formular hat trotzdem etwas gespeichert');
        // Ohne Kennung fände die Suche im Panel nichts — dieselbe Auskunft gibt Quellen.raumAus.
        assert.strictEqual(Quellen.raumAus({ sources: ['thunderstore'], source_ids: {} }, 'thunderstore'), null);
        assert.strictEqual(Quellen.raumAus({ sources: ['thunderstore'], source_ids: { thunderstore: 'valheim' } }, 'thunderstore'), 'valheim');
    });
    await pruefe('abgewiesen: Mods ohne Quelle, ohne Ablageort, mit einem Ort neben dem Spiel', async () => {
        const s = frisch();
        const mit = (mehr) => S.modsSpeichern(s, gut(mehr));
        await wirft(() => mit({ sources: [], source_ids: {} }), /keine Quelle/);
        await wirft(() => mit({ path: '' }), /ohne Ablageort/);
        await wirft(() => mit({ path: 'BepInEx/plugins' }), /mit „game\/" davor/);
        await wirft(() => mit({ path: 'game' }), /mit „game\/" davor/);
        await wirft(() => mit({ path: 'cache/mods' }), /mit „game\/" davor/);
        await wirft(() => mit({ path: '/game/mods' }), /ohne führenden Schrägstrich/);
        await wirft(() => mit({ path: 'game/../mods' }), /aus dem Volume/);
        await wirft(() => mit({ path: 'game/' + 'x'.repeat(S.MODS.max.pfad) }), /höchstens/);
        await wirft(() => mit({ activation: 'magie' }), /Aktivierung/);
        assert.ok(!('content' in s.entwurf));
        // data/ ist erlaubt: Ein Spiel darf seine Mods im bleibenden Bereich suchen.
        await mit({ path: 'data/mods' });
        assert.strictEqual(s.entwurf.content.path, 'data/mods');
    });
    await pruefe('mit Varianten dürfen Quellen und Ablageort fehlen — ohne nicht', async () => {
        const leer = { supported: '1', sources: [], source_ids: {}, path: '', activation: 'start', needs_restart: '1', client_side: '1', order_matters: '' };
        const mitVarianten = frisch({ content: { supported: true }, durchgereicht: { content: { by_setting: 'loader', variants: { fabric: { supported: true, path: 'game/mods' } } } } });
        await S.modsSpeichern(mitVarianten, leer);
        gleich(mitVarianten.entwurf.content, { supported: true, activation: 'start', client_side: true });
        await wirft(() => S.modsSpeichern(frisch(), leer), /keine Quelle/);
        // Ein Lader allein ist kein Ersatz: Der Ablageort steht dann trotzdem hier (Valheim).
        const mitLader = frisch({ content: { supported: true }, durchgereicht: { content: { loader: { key: 'bepinex' } } } });
        await wirft(() => S.modsSpeichern(mitLader, leer), /keine Quelle/);
    });
    await pruefe('läuft etwas, wird nicht gespeichert', async () => {
        const s = frisch();
        beschaeftigt = true;
        try { await wirft(() => S.modsSpeichern(s, gut()), /Prüfdurchlauf läuft/); }
        finally { beschaeftigt = false; }
        assert.ok(!('content' in s.entwurf));
    });

    // ── 3) Was die Karte behauptet, steht so im Code ─────────────────────────
    console.log('\nVertrag');
    await pruefe('die Quellen der Karte sind die des Schemas, die Aktivierungen auch', async () => {
        gleich([...S.MODS.quellen].sort(), [...schema.properties.content.properties.sources.items.enum].sort());
        gleich([...S.MODS.aktivierung].sort(), [...schema.properties.content.properties.activation.enum].sort());
        const mitKennung = Object.keys(schema.properties.content.properties.source_ids.properties).sort();
        gleich(S.MODS.quellen.filter(q => q !== 'upload').sort(), mitKennung, 'das Schema kennt andere Kennungen als die Karte');
        for (const f of S.MODS.felder) assert.ok(schema.properties.content.properties[f], `content.${f} kennt das Schema nicht`);
    });
    await pruefe('„angebunden" ist, was das Panel wirklich kann — Hochladen und die Anbieter aus Quellen.js', async () => {
        const stand = S.modsStand(frisch());
        const angebunden = stand.quellen.filter(q => q.angebunden).map(q => q.kennung).sort();
        gleich(angebunden, ['upload', ...Object.keys(Quellen.ANBIETER)].sort());
        assert.ok(stand.quellen.some(q => !q.angebunden), 'jede Quelle des Schemas ist angebunden — dann stimmt der Hilfetext der Karte nicht mehr');
        // Der Hilfetext nennt die drei beim Namen.
        const ansicht = ohneKommentareEjs(lies(WURZEL, 'plugins/werkbank/dashboard/views/guild/werkbank-sitzung.ejs'));
        if (angebunden.join(',') === 'modrinth,thunderstore,upload') assert.ok(ansicht.includes('Angebunden sind heute Hochladen, Thunderstore und Modrinth'));
        else assert.fail(`angebunden sind jetzt ${angebunden.join(', ')} — der Hilfetext der Karte nennt noch die alten drei`);
    });
    await pruefe('die Leser sind da: der Reiter „Inhalte" liest Ablageort, Neustart und Raum aus dem Paket', async () => {
        const inhalte = ohneKommentare(lies(WURZEL, 'plugins/gameserver/dashboard/routes/inhalte.js'));
        assert.match(inhalte, /content\?\.needs_restart !== false/);
        assert.match(ohneKommentare(lies(WURZEL, 'plugins/gameserver/dashboard/helpers/Quellen.js')), /inhalt\?\.source_ids\?\.\[/);
        assert.match(ohneKommentare(lies(WURZEL, 'plugins/gameserver/dashboard/helpers/InhalteHolen.js')), /Das Paket nennt keinen Ablageort/);
        // Der Daemon trägt dieselben Feldnamen.
        const go = ohneKommentare(lies(DAEMON, 'internal/pkgspec/paket.go'));
        for (const feld of ['supported', 'sources', 'path', 'activation', 'order_matters', 'needs_restart', 'client_side']) {
            assert.match(go, new RegExp('`json:"' + feld + '(,omitempty)?"`'), `der Daemon kennt content.${feld} nicht unter diesem Namen`);
        }
    });

    // ── 4) Route und Ansicht ─────────────────────────────────────────────────
    console.log('\nRoute und Ansicht');
    await pruefe('eine Route mit dem Recht zu bauen, und die Seite bekommt den Stand', async () => {
        const router = ohneKommentare(lies(WURZEL, 'plugins/werkbank/dashboard/routes/guild.router.js'));
        assert.match(router, /router\.post\('\/:kennung\/mods', requirePermission\('WERKBANK\.BAUEN'\)/);
        assert.match(router, /mods: Sitzungen\.modsStand\(sitzung\)/);
        assert.match(router, /MODS: Sitzungen\.MODS/);
    });
    await pruefe('die Karte steht im Reiter „Einstellungen", mit Schaltern, ohne rohes HTML — und nennt, was mitreist', async () => {
        const ansicht = ohneKommentareEjs(lies(WURZEL, 'plugins/werkbank/dashboard/views/guild/werkbank-sitzung.ejs'));
        const von = ansicht.indexOf('id="karteMods"'), bis = ansicht.indexOf('id="karteHinweise"');
        assert.ok(von > ansicht.indexOf('data-reiter="einstellungen"') && bis > von, 'die Karte steht nicht im Reiter „Einstellungen"');
        const karte = ansicht.slice(von, bis);
        for (const name of ['supported', 'quelle', 'kennung', 'path', 'activation', 'needs_restart', 'client_side', 'order_matters']) {
            assert.ok(karte.includes(`name="${name}"`), `dem Formular fehlt „${name}"`);
        }
        // An/Aus ist ein Schalter, kein Kästchen — auch je Quelle.
        const kaestchen = [...karte.matchAll(/<input class="form-check-input" type="checkbox" name="([a-z_]+)"/g)].map(m => m[1]);
        gleich(kaestchen.sort(), ['client_side', 'needs_restart', 'order_matters', 'quelle', 'supported']);
        assert.strictEqual((karte.match(/class="form-check form-switch/g) || []).length, 5, 'ein An/Aus-Feld ist kein Schalter');
        assert.ok(karte.includes("beschaeftigt ? 'disabled' : ''"), 'Speichern ist nicht gesperrt, wenn etwas läuft');
        const roh = [...karte.matchAll(/<%-\s*([\s\S]*?)%>/g)].map(m => m[1].trim());
        for (const r of roh) assert.ok(/^include\('werkbank-hilfe'/.test(r), `unescaped ausgegeben: ${r.slice(0, 50)}`);
        // Stufe 2 wird genannt, nicht verschwiegen.
        assert.ok(karte.includes('mo.lader') && karte.includes('mo.varianten'), 'die Karte nennt Lader und Varianten nicht');
        assert.ok(karte.includes('im Panel noch nicht angebunden'));
        // Das Skript schickt alle Felder.
        const sk = ansicht.slice(ansicht.indexOf("einfachesFormular('formMods', '/mods'"), ansicht.indexOf("var formH = document.getElementById('formHinweis');"));
        for (const feld of ['supported:', 'sources:', 'source_ids:', 'path:', 'activation:', 'needs_restart:', 'client_side:', 'order_matters:']) {
            assert.ok(sk.includes(feld), `das Skript schickt „${feld}" nicht`);
        }
    });

    console.log(`\n  · gesehen: ${Object.entries(gesehen).map(([k, n]) => `${n} ${k}`).join(', ')}`);
    console.log(fehler === 0 ? '\n✅ Mods (Stufe 1): bearbeitbar, und unverändert bleibt unverändert\n' : `\n❌ ${fehler} Abweichung(en)\n`);
    process.exit(fehler === 0 ? 0 : 1);
})().catch((e) => { console.error('FEHLER:', e.message); process.exit(1); });
