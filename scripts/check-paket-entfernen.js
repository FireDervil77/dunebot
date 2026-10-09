#!/usr/bin/env node
/**
 * Ein Spielpaket ganz entfernen (Baustelle 178, 2026-10-09).
 *
 * ── Was hier geprüft wird ───────────────────────────────────────────────────
 *
 * Im Adminbereich lässt sich ein Paket samt Fassungen, Anker, Tags und seinen
 * Werkbank-Sitzungen entfernen. Das ist die einzige Stelle im Dashboard, die
 * ein Paket vernichtet — und sie tut es endgültig. Geprüft wird deshalb vor
 * allem, wann sie es NICHT tut:
 *
 *   - ohne den Namen des Pakets als Gegenprobe
 *   - solange ein Server mit dem Paket läuft
 *   - wenn eine seiner Sitzungen gerade arbeitet oder ihr Daemon nicht
 *     erreichbar ist (das Volume bliebe liegen)
 *
 * …und dass in jedem dieser Fälle NICHTS fehlt. Dann der Erfolg: alles weg, was
 * zum Paket gehört — und nichts, was einem anderen gehört.
 *
 * ── Woran geprüft wird ──────────────────────────────────────────────────────
 *
 * An Kopien der echten Tabellen. Jede beteiligte Tabelle wird in DIESER
 * Verbindung als TEMPORARY TABLE mit ihrem ganzen Inhalt nachgebildet (LIKE —
 * mit den Spalten, wie sie wirklich sind) und verdeckt dort das Original.
 * Hinein kommt ein eigenes Paket samt drei Sitzungen, abgeformt von
 * vorhandenen Zeilen. Gelöscht wird nur dort.
 *
 * LIKE übernimmt keine Fremdschlüssel. Das ist hier ein Vorzug: Was nach dem
 * Entfernen weg ist, hat der Code ausdrücklich gelöscht, nicht ein CASCADE.
 *
 * Am Ende zählt eine ZWEITE Verbindung den echten Bestand nach — er muss sein
 * wie vorher.
 *
 *   node scripts/check-paket-entfernen.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const WURZEL = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(WURZEL, 'apps/dashboard/.env'), quiet: true });
const mysql = require('mysql2/promise');
const { ServiceManager } = require('dunebot-core');
const { ohneKommentare, ohneKommentareEjs } = require('./lib/quelltext');

const TABELLEN = ['packages', 'package_versions', 'addon_marketplace', 'tags', 'tag_links',
    'addon_ratings', 'addon_comments', 'addon_favorites', 'addon_versions', 'gameservers',
    'werkbank_sitzungen', 'werkbank_schritte', 'werkbank_laeufe', 'werkbank_pruefungen'];
const PID = 990001, SLUG = 'waechter-entfernen';
const SITZ = { offen: 990001, verworfen: 990002, zweite: 990003 };
const KENN = { offen: 'wbwaechter01', verworfen: 'wbwaechter02', zweite: 'wbwaechter03' };

let fehler = 0;
async function pruefe(was, tun) {
    try { await tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').slice(0, 5).join('\n      ')}`); }
}
const wirft = (tun, muster) => assert.rejects(tun, (e) => { assert.match(e.message, muster); return true; });
const zugang = () => ({
    host: process.env.MYSQL_HOST, port: process.env.MYSQL_PORT, user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE, dateStrings: true,
});

(async () => {
    const c = await mysql.createConnection(zugang());
    const aussen = await mysql.createConnection(zugang());
    const echt = async () => {
        const aus = {};
        for (const t of TABELLEN) aus[t] = Number((await aussen.query(`SELECT COUNT(*) n FROM \`${t}\``))[0][0].n);
        return aus;
    };
    const echtVorher = await echt();

    // ── Die Kopien ───────────────────────────────────────────────────────────
    for (const t of TABELLEN) {
        await c.query(`CREATE TEMPORARY TABLE fb_k LIKE \`${t}\``);
        await c.query(`INSERT INTO fb_k SELECT * FROM \`${t}\``);
        await c.query(`CREATE TEMPORARY TABLE \`${t}\` LIKE fb_k`);
        await c.query(`INSERT INTO \`${t}\` SELECT * FROM fb_k`);
        await c.query('DROP TEMPORARY TABLE fb_k');
        const [[bau]] = await c.query(`SHOW CREATE TABLE \`${t}\``);
        if (!/^CREATE TEMPORARY TABLE/.test(bau['Create Table'])) throw new Error(`${t} ist in dieser Verbindung keine Kopie — abgebrochen, bevor etwas gelöscht wird`);
    }

    // Die Attrappe schreibt nur in die Kopien. Jede andere Schreibabfrage ist ein Fehler.
    const nurKopien = (sql) => {
        const t = sql.trim();
        if (/^SELECT\b/i.test(t)) return;
        const m = /^(?:DELETE FROM|UPDATE|INSERT(?: IGNORE)? INTO)\s+`?([a-z_]+)`?/i.exec(t);
        if (!m || !TABELLEN.includes(m[1])) throw new Error(`Attrappe: Schreiben ausserhalb der Kopien: ${t.slice(0, 80)}`);
    };
    let stolper = null;   // Abfrage, an der eine Transaktion scheitern soll
    const db = {
        query: async (sql, werte) => { nurKopien(sql); return (await c.query(sql, werte))[0]; },
        transaction: async (tun) => {
            await c.beginTransaction();
            try {
                const ergebnis = await tun({ query: async (sql, werte) => {
                    nurKopien(sql);
                    if (stolper && stolper.test(sql)) throw new Error('Attrappe: die Datenbank fällt hier aus');
                    return c.query(sql, werte);
                } });
                await c.commit();
                return ergebnis;
            } catch (e) { await c.rollback(); throw e; }
        },
    };
    ServiceManager.register('dbService', db);
    const still = () => {};
    ServiceManager.register('Logger', { debug: still, info: still, warn: still, error: still, success: still });
    // Der Daemon: `weist` nennt Kennungen, deren Volume er nicht löschen will.
    const daemon = { online: true, weist: new Set(), befehle: [] };
    ServiceManager.register('ipmServer', {
        isDaemonOnline: () => daemon.online,
        sendCommand: async (id, befehl, nutzlast) => {
            daemon.befehle.push({ befehl, sitzung: nutzlast.sitzung_id });
            if (daemon.weist.has(nutzlast.sitzung_id)) return { success: false, error: 'Attrappe: das Volume ist belegt' };
            return { success: true };
        },
    });
    const E = require('../plugins/gameserver/dashboard/helpers/PaketEntfernen');
    const P = require('../plugins/gameserver/dashboard/helpers/Paketfassung');
    const W = require('../plugins/werkbank/dashboard/helpers/Sitzungen');

    // ── Die eigene Welt: ein Paket, zwei Fassungen, zwei Tags, drei Sitzungen ─
    const klone = async (tabelle, wo, aendern) => {
        await c.query(`CREATE TEMPORARY TABLE fb_z AS SELECT * FROM \`${tabelle}\` WHERE ${wo}`);
        const [[n]] = await c.query('SELECT COUNT(*) n FROM fb_z');
        if (Number(n.n)) { await c.query(`UPDATE fb_z SET ${aendern}`); await c.query(`INSERT INTO \`${tabelle}\` SELECT * FROM fb_z`); }
        await c.query('DROP TEMPORARY TABLE fb_z');
        return Number(n.n);
    };
    const [[quelle]] = await c.query('SELECT pk.id FROM packages pk JOIN addon_marketplace m ON m.id = pk.id WHERE (SELECT COUNT(*) FROM package_versions v WHERE v.package_id = pk.id) >= 1 ORDER BY pk.id LIMIT 1');
    assert.ok(quelle, 'kein Paket mit Anker und Fassung als Vorlage — der Wächter mässe nichts');
    await klone('packages', `id = ${quelle.id}`, `id = ${PID}, slug = '${SLUG}', name = 'Wächterprobe'`);
    await klone('addon_marketplace', `id = ${quelle.id}`, `id = ${PID}, slug = '${SLUG}', name = 'Wächterprobe'`);
    const [[fv]] = await c.query('SELECT id FROM package_versions WHERE package_id = ? ORDER BY id LIMIT 1', [quelle.id]);
    await klone('package_versions', `id = ${fv.id}`, `id = 990001, package_id = ${PID}, version = '1.0.0', channel = 'test'`);
    await klone('package_versions', `id = ${fv.id}`, `id = 990002, package_id = ${PID}, version = '1.0.1', channel = 'stable'`);
    const [zweiTags] = await c.query('SELECT id FROM tags ORDER BY id LIMIT 2');
    assert.strictEqual(zweiTags.length, 2, 'keine zwei Tags in der Bibliothek als Vorlage');
    for (const t of zweiTags) await c.query("INSERT INTO tag_links (tag_id, entity_type, entity_id) VALUES (?, 'spiel', ?)", [t.id, PID]);

    const [[qs]] = await c.query('SELECT s.id, s.guild_id FROM werkbank_sitzungen s WHERE (SELECT COUNT(*) FROM werkbank_schritte x WHERE x.sitzung_id = s.id) >= 1 ORDER BY s.id LIMIT 1');
    assert.ok(qs, 'keine Sitzung mit Schritten als Vorlage');
    // Drei Sitzungen, jede über eine ANDERE der drei Spuren mit dem Paket verbunden.
    await klone('werkbank_sitzungen', `id = ${qs.id}`, `id = ${SITZ.offen}, kennung = '${KENN.offen}', name = 'Probe A', status = 'offen', entwurf = JSON_OBJECT('identity', JSON_OBJECT('slug', '${SLUG}'))`);
    await klone('werkbank_sitzungen', `id = ${qs.id}`, `id = ${SITZ.verworfen}, kennung = '${KENN.verworfen}', name = 'Probe B', status = 'verworfen', entwurf = JSON_OBJECT('werkbank', JSON_OBJECT('geoeffnet', JSON_OBJECT('paket_id', ${PID}, 'version', '1.0.0')))`);
    await klone('werkbank_sitzungen', `id = ${qs.id}`, `id = ${SITZ.zweite}, kennung = '${KENN.zweite}', name = 'Probe C', status = 'offen', entwurf = JSON_OBJECT('identity', JSON_OBJECT('slug', 'etwas-anderes'), 'werkbank', JSON_OBJECT('veroeffentlicht', JSON_ARRAY(JSON_OBJECT('slug', '${SLUG}', 'version', '1.0.0'))))`);
    const kinder = {
        werkbank_schritte: await klone('werkbank_schritte', `sitzung_id = ${qs.id}`, `id = id + 900000, sitzung_id = ${SITZ.offen}, status = 'ok'`),
        werkbank_laeufe: await klone('werkbank_laeufe', `id = (SELECT MIN(id) FROM (SELECT id FROM werkbank_laeufe) q)`, `id = 990001, sitzung_id = ${SITZ.offen}, status = 'beendet'`),
        werkbank_pruefungen: await klone('werkbank_pruefungen', `id = (SELECT MIN(id) FROM (SELECT id FROM werkbank_pruefungen) q)`, `id = 990001, sitzung_id = ${SITZ.zweite}, status = 'gruen'`),
    };

    /** Was zum Probe-Paket gehört — und was nicht. */
    const stand = async () => {
        const n = async (sql, w = []) => Number((await c.query(sql, w))[0][0].n);
        const ids = Object.values(SITZ).join(',');
        return {
            paket: await n('SELECT COUNT(*) n FROM packages WHERE id = ?', [PID]),
            anker: await n('SELECT COUNT(*) n FROM addon_marketplace WHERE id = ?', [PID]),
            fassungen: await n('SELECT COUNT(*) n FROM package_versions WHERE package_id = ?', [PID]),
            tags: await n("SELECT COUNT(*) n FROM tag_links WHERE entity_type = 'spiel' AND entity_id = ?", [PID]),
            sitzungen: await n(`SELECT COUNT(*) n FROM werkbank_sitzungen WHERE id IN (${ids})`),
            schritte: await n(`SELECT COUNT(*) n FROM werkbank_schritte WHERE sitzung_id IN (${ids})`),
            laeufe: await n(`SELECT COUNT(*) n FROM werkbank_laeufe WHERE sitzung_id IN (${ids})`),
            pruefungen: await n(`SELECT COUNT(*) n FROM werkbank_pruefungen WHERE sitzung_id IN (${ids})`),
        };
    };
    /** Alles, was NICHT zum Probe-Paket gehört — je Tabelle gezählt. */
    const fremd = async () => {
        const n = async (sql) => Number((await c.query(sql))[0][0].n);
        const ids = Object.values(SITZ).join(',');
        return {
            packages: await n(`SELECT COUNT(*) n FROM packages WHERE id <> ${PID}`),
            addon_marketplace: await n(`SELECT COUNT(*) n FROM addon_marketplace WHERE id <> ${PID}`),
            package_versions: await n(`SELECT COUNT(*) n FROM package_versions WHERE package_id <> ${PID}`),
            tag_links: await n(`SELECT COUNT(*) n FROM tag_links WHERE NOT (entity_type = 'spiel' AND entity_id = ${PID})`),
            tags: await n('SELECT COUNT(*) n FROM tags'),
            gameservers: await n('SELECT COUNT(*) n FROM gameservers'),
            werkbank_sitzungen: await n(`SELECT COUNT(*) n FROM werkbank_sitzungen WHERE id NOT IN (${ids})`),
            werkbank_schritte: await n(`SELECT COUNT(*) n FROM werkbank_schritte WHERE sitzung_id NOT IN (${ids})`),
            werkbank_laeufe: await n(`SELECT COUNT(*) n FROM werkbank_laeufe WHERE sitzung_id NOT IN (${ids})`),
            werkbank_pruefungen: await n(`SELECT COUNT(*) n FROM werkbank_pruefungen WHERE sitzung_id NOT IN (${ids})`),
        };
    };
    const voll = await stand(), fremdVorher = await fremd();
    const unveraendert = async (was) => assert.deepStrictEqual(await stand(), voll, was);

    try {
        // ── 1) Die Vorschau ──────────────────────────────────────────────────
        console.log('\nVorschau');
        await pruefe('die Probe steht: Paket, Anker, zwei Fassungen, zwei Tags, drei Sitzungen mit Schritten, Lauf und Durchlauf', async () => {
            assert.deepStrictEqual({ ...voll, schritte: voll.schritte > 0, laeufe: voll.laeufe, pruefungen: voll.pruefungen },
                { paket: 1, anker: 1, fassungen: 2, tags: 2, sitzungen: 3, schritte: true, laeufe: kinder.werkbank_laeufe, pruefungen: kinder.werkbank_pruefungen });
            assert.ok(kinder.werkbank_laeufe === 1 && kinder.werkbank_pruefungen === 1, 'kein Lauf oder kein Durchlauf als Vorlage — ihr Löschen bliebe ungeprüft');
        });
        await pruefe('sie nennt Fassungen, Freigabe, Tags, Server — und jede Sitzung mit ihrer Spur', async () => {
            const v = await E.vorschau(db, PID);
            assert.strictEqual(v.paket.slug, SLUG);
            assert.deepStrictEqual(v.fassungen.map(f => `${f.version}/${f.channel}`).sort(), ['1.0.0/test', '1.0.1/stable']);
            assert.deepStrictEqual(v.freigegeben, ['1.0.1']);
            assert.strictEqual(v.tags.length, 2);
            assert.strictEqual(v.server, 0);
            const spur = Object.fromEntries(v.sitzungen.map(z => [z.kennung, z.gruende.join('; ')]));
            assert.deepStrictEqual(Object.keys(spur).sort(), Object.values(KENN).sort(), 'nicht genau die drei Sitzungen des Pakets');
            assert.match(spur[KENN.offen], /Entwurf trägt den Slug/);
            assert.match(spur[KENN.verworfen], /geöffnet aus 1\.0\.0/);
            assert.match(spur[KENN.zweite], /hat dorthin veröffentlicht/);
            assert.deepStrictEqual(await E.vorschau(db, 990999), { paket: null }, 'ein Spiel ohne Paket hat eine Vorschau');
            await unveraendert('die Vorschau hat etwas verändert');
        });

        // ── 2) Wann NICHT ────────────────────────────────────────────────────
        console.log('\nAbgewiesen — und nichts fehlt');
        await pruefe('ohne den Namen des Pakets', async () => {
            for (const falsch of [undefined, '', 'waechter', quelleSlug(await c.query('SELECT slug FROM packages WHERE id = ?', [quelle.id]))]) {
                await wirft(() => E.entfernen(db, { paketId: PID, slug: falsch }), /Zur Bestätigung gehört der Name.*Nichts entfernt/);
            }
            // Auch die Regel selbst fragt nach — nicht nur, wer sie ruft.
            await wirft(() => P.entfernen(db, { paketId: PID, slug: 'falsch' }), /Zur Bestätigung gehört der Name/);
            await unveraendert('mit falschem Namen fehlt etwas');
            assert.strictEqual(daemon.befehle.length, 0, 'der Daemon wurde gefragt, bevor der Name stimmte');
        });
        await pruefe('solange ein Server mit dem Paket läuft', async () => {
            const [[gs]] = await c.query('SELECT id FROM gameservers ORDER BY id LIMIT 1');
            assert.ok(gs, 'kein Server als Vorlage');
            await klone('gameservers', `id = ${gs.id}`, `id = 990001, addon_marketplace_id = ${PID}, public_status_token = 'waechter-entfernen-probe'`);
            try {
                await wirft(() => E.entfernen(db, { paketId: PID, slug: SLUG }), /1 Server läuft mit „waechter-entfernen".*Nichts entfernt/);
                await wirft(() => P.entfernen(db, { paketId: PID, slug: SLUG }), /1 Server läuft/);
                await unveraendert('mit einem Server fehlt etwas');
                assert.strictEqual(daemon.befehle.length, 0);
            } finally { await c.query('DELETE FROM gameservers WHERE id = 990001'); }
        });
        await pruefe('der Daemon einer offenen Sitzung ist nicht erreichbar — ihr Volume bliebe liegen', async () => {
            daemon.online = false;
            try { await wirft(() => E.entfernen(db, { paketId: PID, slug: SLUG }), /nicht erreichbar.*Volume der Sitzung „Probe A" bliebe liegen.*Nichts entfernt/); }
            finally { daemon.online = true; }
            await unveraendert('ohne Daemon fehlt etwas');
        });
        await pruefe('in einer seiner Sitzungen läuft gerade etwas — gefragt wird ALLES, bevor die erste angefasst wird', async () => {
            // Es läuft in der DRITTEN Sitzung. Die erste dürfte — und bleibt trotzdem stehen.
            await c.query(`UPDATE werkbank_pruefungen SET status = 'laeuft' WHERE id = 990001`);
            try { await wirft(() => E.entfernen(db, { paketId: PID, slug: SLUG }), /Sitzung „Probe C".*Prüfdurchlauf läuft.*Nichts entfernt/); }
            finally { await c.query(`UPDATE werkbank_pruefungen SET status = 'gruen' WHERE id = 990001`); }
            await unveraendert('eine gesperrte Sitzung hat die anderen nicht geschützt');
            assert.strictEqual(daemon.befehle.length, 0, 'ein Volume wurde gelöscht, obwohl eine Sitzung gesperrt war');
        });

        // ── 3) Mittendrin gescheitert ────────────────────────────────────────
        console.log('\nMittendrin gescheitert — die Meldung sagt, was weg ist');
        await pruefe('der Daemon löscht das Volume der zweiten offenen Sitzung nicht: das Paket steht, die Meldung nennt die entfernten', async () => {
            daemon.weist.add(KENN.zweite);
            let gefangen = null;
            try { await E.entfernen(db, { paketId: PID, slug: SLUG }); } catch (e) { gefangen = e; }
            daemon.weist.clear();
            assert.ok(gefangen, 'trotz verweigertem Volume gilt das Paket als entfernt');
            assert.match(gefangen.message, /Volume ist belegt/);
            assert.match(gefangen.message, /Schon entfernt: die Werkbank-Sitzungen Probe A \(wbwaechter01\), Probe B \(wbwaechter02\)/);
            assert.match(gefangen.message, /Das Paket „waechter-entfernen" steht noch/);
            assert.deepStrictEqual(gefangen.sitzungen.length, 2);
            const s = await stand();
            assert.deepStrictEqual({ paket: s.paket, anker: s.anker, fassungen: s.fassungen, tags: s.tags }, { paket: 1, anker: 1, fassungen: 2, tags: 2 }, 'das Paket ist angefasst, obwohl eine Sitzung blieb');
            assert.strictEqual(s.sitzungen, 1, 'es sollte genau die verweigerte Sitzung stehen');
            assert.strictEqual(s.schritte, 0, 'die Schritte der entfernten Sitzung liegen noch da');
            assert.strictEqual(s.laeufe, 0, 'der Lauf der entfernten Sitzung liegt noch da');
            // Nur die OFFENE Sitzung hat ein Volume beim Daemon — die verworfene nicht.
            assert.deepStrictEqual(daemon.befehle, [{ befehl: 'werkbank.verwerfen', sitzung: KENN.offen }, { befehl: 'werkbank.verwerfen', sitzung: KENN.zweite }]);
        });
        await pruefe('die Datenbank fällt mitten in der Transaktion aus: vom Paket fehlt nichts', async () => {
            // Die verbliebene Sitzung geht jetzt weg, dann scheitert das Löschen des Ankers.
            stolper = /^DELETE FROM addon_marketplace/;
            let gefangen = null;
            try { await E.entfernen(db, { paketId: PID, slug: SLUG }); } catch (e) { gefangen = e; }
            stolper = null;
            assert.ok(gefangen);
            assert.match(gefangen.message, /Datenbank fällt hier aus.*Schon entfernt: die Werkbank-Sitzung Probe C.*steht noch/);
            const s = await stand();
            assert.deepStrictEqual({ paket: s.paket, anker: s.anker, fassungen: s.fassungen, tags: s.tags }, { paket: 1, anker: 1, fassungen: 2, tags: 2 },
                'die Transaktion hat halb gelöscht — Fassungen oder Tags fehlen, der Anker steht');
            assert.strictEqual(s.sitzungen, 0);
            assert.strictEqual(s.pruefungen, 0, 'der Durchlauf der entfernten Sitzung liegt noch da');
        });

        // ── 4) Der Erfolg ────────────────────────────────────────────────────
        console.log('\nEntfernt');
        await pruefe('zweiter Anlauf: alles weg, was zum Paket gehört — je Tabelle gezählt', async () => {
            const e = await E.entfernen(db, { paketId: PID, slug: SLUG });
            assert.strictEqual(e.slug, SLUG);
            assert.deepStrictEqual({ fassungen: e.weg.fassungen, tags: e.weg.tags, paket: e.weg.paket, anker: e.weg.anker }, { fassungen: 2, tags: 2, paket: 1, anker: 1 });
            assert.deepStrictEqual(e.sitzungen, [], 'es war keine Sitzung mehr übrig');
            assert.deepStrictEqual(await stand(), { paket: 0, anker: 0, fassungen: 0, tags: 0, sitzungen: 0, schritte: 0, laeufe: 0, pruefungen: 0 });
            assert.deepStrictEqual(await E.vorschau(db, PID), { paket: null });
            await wirft(() => E.entfernen(db, { paketId: PID, slug: SLUG }), /kein Spielpaket/);
        });
        await pruefe('und NICHTS, was einem anderen gehört: jedes andere Paket, jede andere Sitzung, die Tag-Bibliothek', async () => {
            assert.deepStrictEqual(await fremd(), fremdVorher);
        });
    } finally {
        await c.end();
    }

    await pruefe('der echte Bestand ist, wie er war — gezählt über eine zweite Verbindung', async () => {
        assert.deepStrictEqual(await echt(), echtVorher);
    });
    await aussen.end();

    // ── 5) Seite und Routen ──────────────────────────────────────────────────
    console.log('\nSeite und Routen');
    await pruefe('zwei Adressen im Adminbereich; der alte Weg weist den Anker eines Pakets weiter ab', async () => {
        const router = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'apps/dashboard/routes/admin/addons.router.js'), 'utf8'));
        assert.match(router, /router\.get\('\/:id\/entfernen'[\s\S]{0,300}PaketEntfernen\.vorschau\(dbService, req\.params\.id\)/);
        assert.match(router, /router\.post\('\/:id\/entfernen'[\s\S]{0,300}PaketEntfernen\.entfernen\(dbService, \{ paketId: req\.params\.id, slug: req\.body\?\.slug \}\)/);
        const loeschen = /router\.delete\('\/:id'[\s\S]*?\n\}\);/.exec(router)[0];
        assert.match(loeschen, /SELECT slug FROM packages WHERE id = \?[\s\S]*?return res\.status\(400\)/, 'DELETE /:id löscht jetzt auch Anker von Paketen');
        // Der Adminbereich steht hinter CheckAuth und CheckAdmin — an der Stelle, an der er eingehängt wird.
        const app = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'apps/dashboard/app.js'), 'utf8'));
        assert.match(app, /this\.app\.use\('\/admin', CheckAuth, CheckAdmin, adminRouter\)/);
    });
    await pruefe('die Seite zeigt erst, was mitgeht, verlangt den Namen in einem roten Dialog und meldet per Toast', async () => {
        const ansicht = ohneKommentareEjs(fs.readFileSync(path.join(WURZEL, 'apps/dashboard/themes/default/views/admin/addons/index.ejs'), 'utf8'));
        const von = ansicht.indexOf('fetch(`/admin/addons/${addonId}/entfernen`'), bis = ansicht.indexOf("if (!confirm(`Addon");
        assert.ok(von > 0 && bis > von, 'die Vorschau kommt nicht VOR dem alten Löschweg');
        const block = ansicht.slice(von, bis);
        for (const s of ['vorschau.fassungen', 'vorschau.tags', 'vorschau.sitzungen', 'vorschau.server > 0']) assert.ok(block.includes(s), `die Rückfrage nennt „${s}" nicht`);
        // Der Name wird in einem eigenen Dialog verlangt — nicht in der
        // Eingabezeile des Browsers: Die lässt sich nicht färben (Betreiber,
        // 2026-10-09: „roter und fett. ist ja wichtig!!!").
        assert.ok(!/\b(prompt|confirm|alert)\(/.test(block), 'das Entfernen eines Pakets fragt über einen Browser-Dialog');
        assert.match(block, /knopf\.disabled = true;[\s\S]{0,260}eingabe\.oninput = \(\) => \{ knopf\.disabled = eingabe\.value\.trim\(\) !== slug; \};/, 'der Knopf ist nicht gesperrt, bis der Name dasteht');
        assert.match(block, /knopf\.onclick = async \(\) => \{\s*if \(eingabe\.value\.trim\(\) !== slug\) return;/, 'ein falscher Name geht durch');
        assert.match(block, /method: 'POST'[\s\S]{0,120}JSON\.stringify\(\{ slug \}\)/);
        assert.ok(!/innerHTML/.test(block), 'Namen aus Paketen werden als HTML gesetzt');
        // Der Dialog selbst: rot, fett, Knopf von Anfang an gesperrt.
        const dialog = /<div class="modal[^"]*" id="paketEntfernenModal"[\s\S]*?\n<\/div>\n/.exec(ansicht);
        assert.ok(dialog, 'den Dialog gibt es nicht');
        assert.match(dialog[0], /class="modal-status bg-danger"/);
        assert.match(dialog[0], /class="modal-title text-danger fw-bold"/);
        assert.match(dialog[0], /class="text-danger fw-bold[^"]*"[^>]*>\s*„<span id="paketEntfernenName">/, 'der Name des Pakets steht nicht rot und fett da');
        assert.match(dialog[0], /Das lässt sich nicht zurücknehmen\./);
        assert.match(dialog[0], /<button type="button" class="btn btn-danger fw-bold" id="paketEntfernenKnopf" disabled>/, 'der Knopf ist beim Öffnen nicht gesperrt');
        for (const id of ['paketEntfernenListe', 'paketEntfernenSoll', 'paketEntfernenEingabe']) assert.ok(dialog[0].includes(`id="${id}"`), `dem Dialog fehlt „${id}"`);
    });

    console.log(fehler === 0 ? '\n✅ Paket entfernen: alles oder nichts, nie mit Server, nie ohne Namen — und nichts Fremdes\n' : `\n❌ ${fehler} Abweichung(en)\n`);
    process.exit(fehler === 0 ? 0 : 1);

    function quelleSlug(ergebnis) { return ergebnis[0][0].slug; }
})().catch((e) => { console.error('FEHLER:', e.message); process.exit(1); });
