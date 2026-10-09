#!/usr/bin/env node
/**
 * Werkbank: die drei Karten zu Mods (2026-10-09) — der Teil `content`.
 *
 * ── Was hier geprüft wird ───────────────────────────────────────────────────
 *
 * `content` war der letzte Teil, der bei geöffneten Paketen nur mitreiste. Mit
 * dem Betreiber am 2026-10-09 in zwei Stufen gebaut:
 *
 *   „Mods"                 der flache Teil — Mods ja/nein, Quellen mit
 *                          Kennungen, Ablageort, Angaben zum Verhalten
 *   „Mod-Lader"            `loader` (Valheim: BepInEx samt `adds.env`)
 *   „Mods je Einstellung"  `by_setting` + `variants` (Minecraft: fünf Lader)
 *
 * Die Probe ist dieselbe wie bei jeder Karte: Jedes eingelieferte Paket,
 * UNVERÄNDERT durch alle drei Formulare gespeichert, ergibt dasselbe Paket mit
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
const formularLader = (stand) => ({
    an: stand.vorhanden ? '1' : '', key: stand.key, path: stand.path, log: stand.log,
    packages: Object.fromEntries(stand.pakete.map(p => [p.kennung, p.name])),
    env: stand.env.map(z => ({ name: z.name, wert: z.wert })),
    installable_as_content: stand.alsInhalt ? '1' : '',
});
const formularVarianten = (stand) => ({
    by_setting: stand.jeEinstellung,
    variants: Object.fromEntries(stand.varianten.map(v => [v.wert, {
        supported: v.supported ? '1' : '', path: v.path, entfernen: '',
        sources: v.quellen.filter(q => q.an).map(q => q.kennung),
        source_ids: Object.fromEntries(v.quellen.filter(q => q.kennung !== 'upload').map(q => [q.kennung, q.id])),
    }])),
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

            // Der ganze Teil liegt im Entwurf — nichts davon reist mehr mit.
            assert.strictEqual(entwurf.durchgereicht?.content, undefined, 'von content steht noch etwas im Durchgereichten');
            gleich(entwurf.content, k, 'der Entwurf trägt nicht, was das Paket trug');
            assert.ok(!S.durchgereichteTeile(paket).some(x => /^content\b/.test(x)), '„Unverändert übernommen" nennt content noch');

            const stand = S.modsStand(sitzung);
            assert.strictEqual(stand.vorhanden, k !== undefined);
            assert.strictEqual(stand.supported, k?.supported === true);
            gleich(stand.quellen.filter(q => q.an).map(q => q.kennung).sort(), [...(k?.sources || [])].sort());
            assert.strictEqual(stand.lader, k?.loader ? k.loader.key : null);
            gleich(stand.varianten, k?.variants ? Object.keys(k.variants) : []);

            const davor = kopie(S.entwurfAlsPaket(sitzung, liste));
            gleich(davor.content, paket.content, 'schon das Zusammensetzen ändert content');
            await S.modsSpeichern(sitzung, formular(stand));
            // … und durch die beiden Nachbarkarten.
            const standL = S.laderStand(sitzung), standV = S.variantenStand(sitzung);
            assert.strictEqual(standL.vorhanden, k?.loader !== undefined);
            gleich(standL.env.map(z => z.name).sort(), Object.keys(k?.loader?.adds?.env || {}).sort());
            assert.strictEqual(standV.jeEinstellung, k?.by_setting || '');
            assert.strictEqual(standV.einstellungFehlt, false, 'die Einstellung der Varianten gilt als fehlend');
            for (const w of Object.keys(k?.variants || {})) assert.ok(standV.varianten.some(v => v.wert === w && v.vorhanden && !v.verwaist), `die Variante „${w}" fehlt oder gilt als verwaist`);
            await S.laderSpeichern(sitzung, formularLader(standL));
            await S.variantenSpeichern(sitzung, formularVarianten(standV));
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
    await pruefe('eine Sitzung aus der Zeit vor den Karten zieht beim Laden um — und ein Feld, das niemand kennt, reist weiter mit', async () => {
        const einmal = S.ordne({ durchgereicht: { content: { supported: true, path: 'game/mods', sources: ['upload'], loader: { key: 'x' }, by_setting: 'loader', variants: { a: { supported: false } }, zukunft: 1 } } });
        gleich(einmal.content, { supported: true, path: 'game/mods', sources: ['upload'], loader: { key: 'x' }, by_setting: 'loader', variants: { a: { supported: false } } });
        gleich(einmal.durchgereicht, { content: { zukunft: 1 } }, 'ein unbekanntes Feld ist verschwunden oder in eine Karte gerutscht');
        gleich(S.ordne(kopie(einmal)), einmal, 'ordne ist nicht wiederholbar');
        // Jedes Stück, das die Karten bearbeiten, steht in EIGENE — und nur diese.
        gleich([...S.EIGENE.content].sort(), [...S.MODS.felder, 'loader', 'by_setting', 'variants'].sort());
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
        const mitVarianten = frisch({ content: { supported: true, by_setting: 'loader', variants: { fabric: { supported: true, path: 'game/mods' } } } });
        await S.modsSpeichern(mitVarianten, leer);
        gleich(mitVarianten.entwurf.content, { supported: true, activation: 'start', client_side: true, by_setting: 'loader', variants: { fabric: { supported: true, path: 'game/mods' } } });
        await wirft(() => S.modsSpeichern(frisch(), leer), /keine Quelle/);
        // Ein Lader allein ist kein Ersatz: Der Ablageort steht dann trotzdem hier (Valheim).
        const mitLader = frisch({ content: { supported: true, loader: { key: 'bepinex' } } });
        await wirft(() => S.modsSpeichern(mitLader, leer), /keine Quelle/);
    });
    await pruefe('läuft etwas, wird nicht gespeichert', async () => {
        const s = frisch();
        beschaeftigt = true;
        try { await wirft(() => S.modsSpeichern(s, gut()), /Prüfdurchlauf läuft/); }
        finally { beschaeftigt = false; }
        assert.ok(!('content' in s.entwurf));
    });

    // ── 2b) Mod-Lader ────────────────────────────────────────────────────────
    console.log('\nMod-Lader');
    const LADER_GUT = (mehr = {}) => ({ an: '1', key: 'bepinex', path: 'game', log: 'game/BepInEx/LogOutput.log',
        packages: { thunderstore: 'denikson-BepInExPack_Valheim', modrinth: '', curseforge: '' },
        env: [{ name: 'DOORSTOP_ENABLED', wert: '1' }, { name: 'LD_LIBRARY_PATH', wert: './doorstop_libs:{{env:LD_LIBRARY_PATH}}' }, { name: '', wert: '' }],
        installable_as_content: '1', ...mehr });
    const mitMods = () => frisch({ content: { supported: true, sources: ['upload'], path: 'game/BepInEx/plugins' } });
    await pruefe('ein neuer Lader landet im Paket, wie das Schema ihn will — Vorgaben werden nicht hingeschrieben', async () => {
        const s = mitMods();
        await S.laderSpeichern(s, LADER_GUT());
        gleich(s.entwurf.content.loader, { key: 'bepinex', path: 'game', log: 'game/BepInEx/LogOutput.log',
            packages: { thunderstore: 'denikson-BepInExPack_Valheim' },
            adds: { env: { DOORSTOP_ENABLED: '1', LD_LIBRARY_PATH: './doorstop_libs:{{env:LD_LIBRARY_PATH}}' } } });
        assert.ok(giltContent(s.entwurf.content), JSON.stringify(giltContent.errors));
        // Der flache Teil daneben ist unberührt.
        assert.strictEqual(s.entwurf.content.path, 'game/BepInEx/plugins');
        await S.laderSpeichern(s, LADER_GUT({ installable_as_content: '', path: '', log: '', env: [] }));
        gleich(s.entwurf.content.loader, { key: 'bepinex', installable_as_content: false, packages: { thunderstore: 'denikson-BepInExPack_Valheim' }, adds: { env: {} } },
            'geleert wird, was dastand; die Liste der Variablen stand da und bleibt als leere');
        assert.ok(giltContent(s.entwurf.content), JSON.stringify(giltContent.errors));
    });
    await pruefe('was die Karte nicht kennt, bleibt stehen: Startzusätze und ein Wert, der keine Zeichenkette ist', async () => {
        const s = frisch({ content: { supported: true, sources: ['upload'], path: 'game/mods',
            loader: { key: 'x', adds: { env: { A: 1, B: true, C: 'c' }, args: [{ key: 'z', form: '--mods', from: 'fixed' }] }, zukunft: 'bleibt' } } });
        const stand = S.laderStand(s);
        gleich(stand.env, [{ name: 'A', wert: '1' }, { name: 'B', wert: 'true' }, { name: 'C', wert: 'c' }]);
        gleich(stand.args, [{ key: 'z', form: '--mods', from: 'fixed' }]);
        gleich(stand.sonstiges, ['zukunft']);
        const vorher = kopie(s.entwurf.content.loader);
        await S.laderSpeichern(s, formularLader(stand));
        assert.deepStrictEqual(s.entwurf.content.loader, vorher, 'aus der Zahl 1 ist „1" geworden, oder ein fremdes Feld ging verloren');
        // Geändert wird ein Wert zur Zeichenkette — das ist, was der Daemon liest (map[string]string).
        await S.laderSpeichern(s, { ...formularLader(stand), env: [{ name: 'A', wert: '2' }] });
        gleich(s.entwurf.content.loader.adds, { env: { A: '2' }, args: [{ key: 'z', form: '--mods', from: 'fixed' }] });
    });
    await pruefe('Schalter aus entfernt den Lader — und nur ihn', async () => {
        const s = mitMods();
        await S.laderSpeichern(s, LADER_GUT());
        await S.laderSpeichern(s, LADER_GUT({ an: '' }));
        gleich(s.entwurf.content, { supported: true, sources: ['upload'], path: 'game/BepInEx/plugins' });
        // Aus bleibt aus: In einem Spiel ohne Mods entsteht nichts.
        const ohne = frisch();
        await S.laderSpeichern(ohne, { an: '' });
        assert.ok(!('content' in ohne.entwurf));
    });
    await pruefe('abgewiesen: Lader ohne Mods, ohne Namen, mit einem Ort außerhalb, mit kaputten Variablen', async () => {
        await wirft(() => S.laderSpeichern(frisch(), LADER_GUT()), /erst in der Karte „Mods" einschalten/);
        await wirft(() => S.laderSpeichern(frisch({ content: { supported: false } }), LADER_GUT()), /erst in der Karte „Mods" einschalten/);
        const s = mitMods();
        const mit = (mehr) => S.laderSpeichern(s, LADER_GUT(mehr));
        await wirft(() => mit({ key: '' }), /braucht einen Namen/);
        await wirft(() => mit({ key: 'bep inex' }), /der Name aus Buchstaben/);
        await wirft(() => mit({ packages: { thunderstore: 'denikson/BepInExPack' } }), /ohne Fassung und ohne Schrägstrich/);
        await wirft(() => mit({ packages: { 'steam-workshop': 'x' } }), /keine Laderpakete/);
        await wirft(() => mit({ path: 'BepInEx' }), /ab der Wurzel des Volumes/);
        await wirft(() => mit({ path: '../game' }), /aus dem Volume/);
        await wirft(() => mit({ log: 'BepInEx/LogOutput.log' }), /ab der Wurzel des Volumes/);
        await wirft(() => mit({ log: 'game' }), /ab der Wurzel des Volumes/);
        await wirft(() => mit({ env: [{ name: '1X', wert: 'a' }] }), /nicht mit einer Ziffer/);
        await wirft(() => mit({ env: [{ name: 'LD PRELOAD', wert: 'a' }] }), /der Name aus Buchstaben/);
        await wirft(() => mit({ env: [{ name: 'A', wert: '1' }, { name: 'A', wert: '2' }] }), /steht schon da/);
        await wirft(() => mit({ env: [{ name: 'A', wert: 'a\nb' }] }), /in einer Zeile/);
        await wirft(() => mit({ env: Array.from({ length: S.LADER.max.variablen + 1 }, (_, n) => ({ name: `V${n}`, wert: 'x' })) }), /höchstens/);
        assert.ok(!('loader' in s.entwurf.content), 'ein abgewiesenes Formular hat trotzdem einen Lader angelegt');
        // Die Namensregel ist die des Schemas — klein geschriebene Namen gehen (E-23).
        assert.strictEqual(schema.definitions.envKey.pattern, '^[A-Za-z_][A-Za-z0-9_]*$');
        await mit({ env: [{ name: 'servername', wert: 'x' }, { name: '_X', wert: '' }] });
        gleich(s.entwurf.content.loader.adds.env, { servername: 'x', _X: '' });
    });

    // ── 2c) Mods je Einstellung ──────────────────────────────────────────────
    console.log('\nMods je Einstellung');
    const AUSWAHL = { key: 'loader', type: 'choice', name: { de: 'Lader' }, choices: [{ value: 'vanilla', name: { de: 'Vanilla' } }, { value: 'paper', name: { de: 'Paper' } }, 'fabric'] };
    const mitAuswahl = (content = { supported: true }) => frisch({ content, settings: [AUSWAHL, { key: 'name', type: 'text' }] });
    const V = (mehr = {}) => ({ supported: '1', path: 'game/mods', sources: ['upload', 'modrinth'], source_ids: { modrinth: 'fabric' }, entfernen: '', ...mehr });
    const LEER = { supported: '', path: '', sources: [], source_ids: {}, entfernen: '' };
    await pruefe('Varianten landen im Paket, wie das Schema sie will — ein leerer Wert bekommt keinen Eintrag', async () => {
        const s = mitAuswahl();
        const stand = S.variantenStand(s);
        gleich(stand.auswahlen, [{ key: 'loader', name: 'Lader' }], 'angeboten wird nur, was eine Auswahl ist');
        gleich(stand.varianten, [], 'ohne gewählte Einstellung gibt es keine Werte');
        await S.variantenSpeichern(s, { by_setting: 'loader', variants: { vanilla: LEER, paper: V({ path: 'game/plugins', source_ids: { modrinth: 'paper' } }), fabric: V() } });
        gleich(s.entwurf.content, { supported: true, by_setting: 'loader', variants: {
            paper: { supported: true, sources: ['upload', 'modrinth'], source_ids: { modrinth: 'paper' }, path: 'game/plugins' },
            fabric: { supported: true, sources: ['upload', 'modrinth'], source_ids: { modrinth: 'fabric' }, path: 'game/mods' } } });
        assert.ok(giltContent(s.entwurf.content), JSON.stringify(giltContent.errors));
        const danach = S.variantenStand(s);
        gleich(danach.varianten.map(v => [v.wert, v.vorhanden, v.supported, v.verwaist]), [['vanilla', false, false, false], ['paper', true, true, false], ['fabric', true, true, false]]);
        // So, wie das Panel es auflöst: vanilla bekommt keine Mods, fabric seinen Ordner.
        const { loeseInhaltAuf } = require('../plugins/gameserver/dashboard/helpers/InhaltJeLader');
        const paket = { content: s.entwurf.content };
        assert.strictEqual(loeseInhaltAuf(paket, { loader: 'vanilla' }).content.supported, false);
        assert.strictEqual(loeseInhaltAuf(paket, { loader: 'fabric' }).content.path, 'game/mods');
        assert.strictEqual(loeseInhaltAuf(paket, { loader: 'paper' }).content.source_ids.modrinth, 'paper');
    });
    await pruefe('ein ausdrückliches „nein" bleibt stehen, ein fremdes Feld in der Variante auch', async () => {
        const s = mitAuswahl({ supported: true, by_setting: 'loader', variants: { vanilla: { supported: false }, fabric: { supported: true, sources: ['upload'], path: 'game/mods', needs_restart: false } } });
        const stand = S.variantenStand(s);
        gleich(stand.varianten.find(v => v.wert === 'fabric').sonstiges, ['needs_restart']);
        const vorher = kopie(s.entwurf.content);
        await S.variantenSpeichern(s, formularVarianten(stand));
        gleich(s.entwurf.content, vorher);
    });
    await pruefe('abgewiesen: fremde Einstellung, keine Auswahl, fremder Wert, Variante mit Mods ohne Ort', async () => {
        const s = mitAuswahl();
        const mit = (by_setting, variants) => S.variantenSpeichern(s, { by_setting, variants });
        await wirft(() => mit('gibtsnicht', { a: V() }), /gibt es im Entwurf nicht/);
        await wirft(() => mit('name', { a: V() }), /ist keine Auswahl/);
        await wirft(() => mit('loader', { forge: V() }), /kein Wert der Einstellung/);
        await wirft(() => mit('loader', { fabric: V({ path: '' }) }), /Variante „fabric": .*ohne Ablageort/);
        await wirft(() => mit('loader', { fabric: V({ sources: [], source_ids: {} }) }), /Variante „fabric": .*keine Quelle/);
        await wirft(() => mit('loader', { fabric: V({ source_ids: {} }) }), /Variante „fabric": .*braucht ihre Kennung/);
        await wirft(() => mit('loader', { fabric: V({ path: 'mods' }) }), /Variante „fabric": .*mit „game\/" davor/);
        await wirft(() => mit('loader', { vanilla: LEER, fabric: LEER }), /Keine Variante trägt etwas/);
        gleich(s.entwurf.content, { supported: true }, 'ein abgewiesenes Formular hat trotzdem etwas gespeichert');
        await wirft(() => S.variantenSpeichern(mitAuswahl({ supported: false }), { by_setting: 'loader', variants: { fabric: V() } }), /erst in der Karte „Mods" einschalten/);
    });
    await pruefe('ein Wert, den die Einstellung nicht mehr kennt, wird gezeigt und lässt sich entfernen — sonst bleibt er', async () => {
        const s = mitAuswahl({ supported: true, by_setting: 'loader', variants: { fabric: { supported: true, sources: ['upload'], path: 'game/mods' }, forge: { supported: true, sources: ['upload'], path: 'game/mods' } } });
        const stand = S.variantenStand(s);
        gleich(stand.varianten.filter(v => v.verwaist).map(v => v.wert), ['forge']);
        await S.variantenSpeichern(s, formularVarianten(stand));
        assert.ok(s.entwurf.content.variants.forge, 'unverändert gespeichert, und der verwaiste Eintrag ist weg');
        const f = formularVarianten(S.variantenStand(s));
        f.variants.forge.entfernen = '1';
        await S.variantenSpeichern(s, f);
        gleich(Object.keys(s.entwurf.content.variants), ['fabric']);
        // Was das Formular gar nicht schickt, fasst es nicht an.
        await S.variantenSpeichern(s, { by_setting: 'loader', variants: {} });
        gleich(Object.keys(s.entwurf.content.variants), ['fabric']);
    });
    await pruefe('hängen die Varianten an einer Einstellung, die es nicht mehr gibt, sagt die Karte das', async () => {
        const s = frisch({ content: { supported: true, by_setting: 'loader', variants: { fabric: { supported: true, sources: ['upload'], path: 'game/mods' } } }, settings: [] });
        const stand = S.variantenStand(s);
        assert.strictEqual(stand.einstellungFehlt, true);
        gleich(stand.varianten.map(v => [v.wert, v.verwaist]), [['fabric', true]]);
    });
    await pruefe('abschalten nimmt beide Felder — aber nur, wenn die Karte „Mods" dann selbst trägt', async () => {
        const s = mitAuswahl({ supported: true, by_setting: 'loader', variants: { fabric: { supported: true, sources: ['upload'], path: 'game/mods' } } });
        await wirft(() => S.variantenSpeichern(s, { by_setting: '', variants: {} }), /braucht die Karte „Mods" selbst Quellen und Ablageort/);
        assert.ok(s.entwurf.content.variants, 'trotz Abweisung sind die Varianten weg');
        s.entwurf.content.sources = ['upload'];
        s.entwurf.content.path = 'game/mods';
        await S.variantenSpeichern(s, { by_setting: '', variants: {} });
        gleich(s.entwurf.content, { supported: true, sources: ['upload'], path: 'game/mods' });
        // Nichts gewählt, nichts da: nichts entsteht.
        const ohne = frisch();
        await S.variantenSpeichern(ohne, { by_setting: '', variants: {} });
        assert.ok(!('content' in ohne.entwurf));
    });
    await pruefe('läuft etwas, speichern auch diese beiden Karten nicht', async () => {
        const s = mitAuswahl({ supported: true, sources: ['upload'], path: 'game/mods' });
        beschaeftigt = true;
        try {
            await wirft(() => S.laderSpeichern(s, LADER_GUT()), /Prüfdurchlauf läuft/);
            await wirft(() => S.variantenSpeichern(s, { by_setting: 'loader', variants: { fabric: V() } }), /Prüfdurchlauf läuft/);
        } finally { beschaeftigt = false; }
        gleich(s.entwurf.content, { supported: true, sources: ['upload'], path: 'game/mods' });
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

    await pruefe('Lader und Varianten: die Leser sind da, und der Daemon trägt dieselben Feldnamen', async () => {
        const go = ohneKommentare(lies(DAEMON, 'internal/pkgspec/paket.go'));
        const lader = /type Loader struct \{([\s\S]*?)\n\}/.exec(go), adds = /type LoaderAdds struct \{([\s\S]*?)\n\}/.exec(go);
        assert.ok(lader && adds, 'pkgspec.Loader oder LoaderAdds nicht gefunden');
        for (const feld of ['key', 'installable_as_content', 'adds']) assert.match(lader[1], new RegExp('`json:"' + feld + ',omitempty"`'), `der Daemon kennt loader.${feld} nicht`);
        // Die Variablen liest der Daemon als Zeichenketten — die Karte schreibt neue Werte als solche.
        assert.match(adds[1], /Env\s+map\[string\]string\s+`json:"env,omitempty"`/);
        assert.match(adds[1], /`json:"args,omitempty"`/);
        // Das Panel liest Paketname, Ordner, Logdatei und Namen des Laders.
        assert.match(ohneKommentare(lies(WURZEL, 'plugins/gameserver/dashboard/helpers/InhalteHolen.js')), /inhalt\?\.loader\?\.packages\?\.\[quelle\]/);
        assert.match(ohneKommentare(lies(WURZEL, 'plugins/gameserver/dashboard/helpers/InhalteHolen.js')), /inhalt\.loader\?\.path/);
        const inhalte = ohneKommentare(lies(WURZEL, 'plugins/gameserver/dashboard/routes/inhalte.js'));
        assert.match(inhalte, /lader\?\.log/);
        assert.match(inhalte, /inhalt\?\.loader\?\.key/);
        // `installable_as_content` wertet niemand aus — so sagt es die Karte.
        const aufrufer = [];
        const such = (ordner) => { for (const n of fs.readdirSync(ordner, { withFileTypes: true })) {
            const p = path.join(ordner, n.name);
            if (n.isDirectory()) such(p);
            else if (n.name.endsWith('.go') && !n.name.endsWith('_test.go') && /\.LaderNachruestbar\(\)/.test(ohneKommentare(lies(p)))) aufrufer.push(n.name);
        } };
        such(path.join(DAEMON, 'internal')); such(path.join(DAEMON, 'cmd'));
        assert.deepStrictEqual(aufrufer, [], 'der Daemon wertet installable_as_content jetzt aus — der Hilfetext des Schalters stimmt dann nicht mehr');
        // Die Varianten löst das Panel auf, an genau diesen beiden Feldern.
        const jeLader = ohneKommentare(lies(WURZEL, 'plugins/gameserver/dashboard/helpers/InhaltJeLader.js'));
        assert.match(jeLader, /inhalt\.by_setting/);
        assert.match(jeLader, /inhalt\.variants\[wert\]/);
        // Die Quellen, bei denen ein Lader ein Paket sein kann, sind die des Schemas.
        gleich([...S.LADER.quellen].sort(), Object.keys(schema.properties.content.properties.loader.properties.packages.properties).sort());
        for (const f of S.LADER.felder) assert.ok(schema.properties.content.properties.loader.properties[f], `loader.${f} kennt das Schema nicht`);
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
        const von = ansicht.indexOf('id="karteMods"'), bis = ansicht.indexOf('id="karteModLader"');
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
        // Lader und Varianten werden genannt, mit dem Weg zu ihren Karten.
        assert.ok(karte.includes('mo.lader') && karte.includes('mo.varianten'), 'die Karte nennt Lader und Varianten nicht');
        assert.ok(karte.includes('„Mod-Lader" und „Mods je Einstellung"'), 'die Karte sagt nicht, wo Lader und Varianten stehen');
        assert.ok(!karte.includes('Unverändert übernommen'), 'die Karte schickt noch zu „Unverändert übernommen" — dort steht davon nichts mehr');
        assert.ok(karte.includes('im Panel noch nicht angebunden'));
        // Das Skript schickt alle Felder.
        const sk = ansicht.slice(ansicht.indexOf("einfachesFormular('formMods', '/mods'"), ansicht.indexOf("var laderZeilen = document.getElementById('laderVariablen');"));
        assert.ok(sk.length > 100, 'das Skript der Karte „Mods" ist nicht zu finden');
        for (const feld of ['supported:', 'sources:', 'source_ids:', 'path:', 'activation:', 'needs_restart:', 'client_side:', 'order_matters:']) {
            assert.ok(sk.includes(feld), `das Skript schickt „${feld}" nicht`);
        }
    });

    await pruefe('Mod-Lader und Mods je Einstellung: Routen, Reiter, Schalter, kein rohes HTML', async () => {
        const router = ohneKommentare(lies(WURZEL, 'plugins/werkbank/dashboard/routes/guild.router.js'));
        assert.match(router, /router\.post\('\/:kennung\/modlader', requirePermission\('WERKBANK\.BAUEN'\)/);
        assert.match(router, /router\.post\('\/:kennung\/modvarianten', requirePermission\('WERKBANK\.BAUEN'\)/);
        for (const k of ['lader: Sitzungen.laderStand(sitzung)', 'LADER: Sitzungen.LADER', 'varianten: Sitzungen.variantenStand(sitzung)']) assert.ok(router.includes(k), `die Ansicht bekommt „${k.split(':')[0]}" nicht`);
        const ansicht = ohneKommentareEjs(lies(WURZEL, 'plugins/werkbank/dashboard/views/guild/werkbank-sitzung.ejs'));
        const a = ansicht.indexOf('id="karteModLader"'), b = ansicht.indexOf('id="karteModVarianten"'), c2 = ansicht.indexOf('id="karteHinweise"');
        assert.ok(a > ansicht.indexOf('id="karteMods"') && b > a && c2 > b, 'die drei Karten stehen nicht in dieser Folge im Reiter „Einstellungen"');
        const lader = ansicht.slice(a, b), varianten = ansicht.slice(b, c2);
        for (const name of ['an', 'key', 'path', 'log', 'paket', 'name', 'wert', 'installable_as_content']) assert.ok(lader.includes(`name="${name}"`), `dem Lader-Formular fehlt „${name}"`);
        for (const name of ['by_setting', 'supported', 'path', 'quelle', 'kennung', 'entfernen']) assert.ok(varianten.includes(`name="${name}"`), `dem Varianten-Formular fehlt „${name}"`);
        for (const [karte, wie] of [[lader, 'Mod-Lader'], [varianten, 'Mods je Einstellung']]) {
            assert.ok(karte.includes("beschaeftigt ? 'disabled' : ''"), `${wie}: Speichern ist nicht gesperrt, wenn etwas läuft`);
            const roh = [...karte.matchAll(/<%-\s*([\s\S]*?)%>/g)].map(m => m[1].trim());
            for (const r of roh) assert.ok(/^include\('werkbank-hilfe'/.test(r), `${wie}: unescaped ausgegeben: ${r.slice(0, 50)}`);
            // An/Aus ist ein Schalter, kein Kästchen.
            const kaestchen = (karte.match(/<input class="form-check-input" type="checkbox"/g) || []).length;
            assert.strictEqual((karte.match(/class="form-check form-switch/g) || []).length, kaestchen, `${wie}: ein An/Aus-Feld ist kein Schalter`);
        }
        // Was die Karten sagen müssen.
        assert.ok(lader.includes('la.args.length') && lader.includes('bleibt unverändert'), 'der Lader zeigt seine Startzusätze nicht');
        assert.ok(lader.includes('werten sie heute nicht aus'), 'der Schalter „nachinstallieren" verschweigt, dass ihn niemand auswertet');
        assert.ok(varianten.includes('va.einstellungFehlt') && varianten.includes('Kein Server bekäme damit Mods'), 'die Karte warnt nicht, wenn die Einstellung der Varianten fehlt');
        assert.ok(varianten.includes('kein Eintrag — keine Mods'), 'ein Wert ohne Eintrag fällt nicht auf');
        // Die Skripte schicken alle Felder und bauen Zeilen als Elemente.
        const von = ansicht.indexOf("var laderZeilen = document.getElementById('laderVariablen');"), bis = ansicht.indexOf("var formH = document.getElementById('formHinweis');");
        assert.ok(von > 0 && bis > von, 'das Skript der beiden Karten ist nicht zu finden');
        const sk = ansicht.slice(von, bis);
        assert.ok(sk.includes("einfachesFormular('formModLader', '/modlader'") && sk.includes("einfachesFormular('formModVarianten', '/modvarianten'"));
        for (const feld of ['an:', 'key:', 'path:', 'log:', 'packages:', 'env:', 'installable_as_content:', 'by_setting:', 'variants:', 'supported:', 'sources:', 'source_ids:', 'entfernen:']) {
            assert.ok(sk.includes(feld), `das Skript schickt „${feld}" nicht`);
        }
        assert.ok(!/innerHTML|insertAdjacentHTML/.test(sk), 'eine Zeile entsteht aus HTML-Text');
    });

    console.log(`\n  · gesehen: ${Object.entries(gesehen).map(([k, n]) => `${n} ${k}`).join(', ')}`);
    console.log(fehler === 0 ? '\n✅ Mods, Mod-Lader, Mods je Einstellung: bearbeitbar, und unverändert bleibt unverändert\n' : `\n❌ ${fehler} Abweichung(en)\n`);
    process.exit(fehler === 0 ? 0 : 1);
})().catch((e) => { console.error('FEHLER:', e.message); process.exit(1); });
