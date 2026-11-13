#!/usr/bin/env node
/**
 * Mitglieds-Inhalte: Jede Spalte mit einer Discord-ID eines Mitglieds ist erklärt
 * (G-04a, K380, 2026-11-13).
 *
 * Ein Mitglied soll seine Daten löschen können, in einer Guild oder in allen
 * (F-G1, F-G2). Was dabei mit welcher Spalte geschieht, sagt der Besitzer der
 * Tabelle in seiner package.json:
 *
 *   "mitgliedInhalte": {
 *     "tabelle": {
 *       "user_id":    "loeschen",
 *       "created_by": "anonymisieren",
 *       "admin_id":   { "weg": "anonymisieren", "mit": ["admin_tag"] },
 *       "member_id":  { "weg": "frist", "grund": "…" },
 *       "target_id":  { "weg": "ausgenommen", "grund": "…" }
 *     }
 *   }
 *
 *   loeschen       die Zeilen, in denen die Spalte das Mitglied nennt, gehen
 *   anonymisieren  die Zeile bleibt, die ID wird durch einen Platzhalter ersetzt;
 *                  `mit` nennt Spalten derselben Zeile (Name, Tag), die geleert
 *                  werden
 *   frist          bleibt bis zum Ende ihrer Aufbewahrungsfrist (G-05), die
 *                  Auskunft nennt sie (F-G2 A: Moderations- und Sicherheitsfälle)
 *   ausgenommen    heißt wie eine Mitglieds-Spalte oder trägt solche Werte, ist
 *                  aber keine (Rolle, Kanal, die Guild selbst)
 *
 * Bei `frist` und `ausgenommen` ist `grund` Pflicht.
 *
 * Besitz wie bei den Fachereignissen (G-01): Eine Tabelle aus einem CREATE TABLE
 * unter plugins/<name>/ gehört diesem Plugin. Alle anderen gehören dem Kern, und
 * der erklärt sich in plugins/core/package.json.
 *
 * Geprüft wird:
 *
 *   Pflicht      jedes Plugin hat `mitgliedInhalte`, auch leer (`{}`)
 *   Form         nur die vier Wege, `grund` wo verlangt, `mit` nur beim
 *                Anonymisieren, keine fremden Schlüssel
 *   Besitz       eine erklärte Tabelle gehört dem erklärenden Plugin, Tabelle,
 *                Spalte und `mit`-Spalten gibt es
 *   Name         jede Spalte, deren Name eine Mitglieds-ID verspricht und deren
 *                Typ eine fassen kann, ist erklärt
 *   Werte        jede Spalte, in der Discord-IDs stehen und deren Name weder
 *                Mitglied noch Kanal/Rolle/Guild sagt, ist erklärt
 *   Platzhalter  anonymisierte Spalten sind Text (der Platzhalter muss passen)
 *
 * Spalten kommen aus der Datenbank und aus dem Code (CREATE TABLE und
 * ALTER TABLE … ADD COLUMN mit festem Namen). So wird eine neue Tabelle schon
 * vor dem Neustart geprüft, der sie anlegt. Spalten, deren Name erst zur
 * Laufzeit entsteht (`ADD COLUMN ${name}`), sieht der Wächter erst nach der
 * Migration. Sichten (VIEW) werden übersprungen, sie speichern nichts.
 *
 * Danach Gegenproben im Speicher: Jede eingebaute Verletzung muss rot werden.
 * Geschrieben wird nichts.
 *
 *   node scripts/check-mitglied-inhalte.js
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const WURZEL = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(WURZEL, 'apps/dashboard/.env'), quiet: true });
const { ohneKommentare, ohneKommentareSql } = require('./lib/quelltext');

const KERN = 'core';
const WEGE = ['loeschen', 'anonymisieren', 'frist', 'ausgenommen'];
const MIT_GRUND = ['frist', 'ausgenommen'];
const SCHLUESSEL = ['weg', 'mit', 'grund'];

/** Name verspricht eine Mitglieds-ID. */
const MITGLIED = /^(user_id|member_id|mitglied_id|owner_id|author_id|admin_id|moderator_id|discord_id|akteur|betroffen)$|_user_id$|_by$|_von$/;
/** Name sagt: kein Mitglied, sondern Guild, Kanal, Rolle, Nachricht … */
const KEIN_MITGLIED = /(^|_)(guild|channel|role|rolle|autorole|message|category|thread|webhook|emoji|sticker|application|interaction)(_?id)?$/i;
/** Typen, die eine Discord-ID (17–20 Ziffern) fassen können. */
const ID_TYP = /^(varchar|char|bigint)$/;
const TEXT_TYP = /^(varchar|char)$/;
const SCHNEEFLOCKE = '^[0-9]{17,20}$';

let fehler = 0;
async function pruefe(was, tun) {
    try { await tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').slice(0, 40).join('\n      ')}`); }
}

// ── Code lesen ───────────────────────────────────────────────────────────────

function quellen(ordner, liste = []) {
    if (!fs.existsSync(ordner)) return liste;
    for (const e of fs.readdirSync(ordner, { withFileTypes: true })) {
        if (['node_modules', 'assets', 'public', 'vendor'].includes(e.name) || e.name.startsWith('.')) continue;
        const p = path.join(ordner, e.name);
        if (e.isDirectory()) quellen(p, liste);
        else if (/\.(js|sql)$/.test(e.name)) liste.push(p);
    }
    return liste;
}

function ohneKommentareDatei(datei) {
    return datei.endsWith('.sql')
        ? ohneKommentareSql(fs.readFileSync(datei, 'utf8'))
        : ohneKommentare(fs.readFileSync(datei, 'utf8'));
}

/** Inhalt der Klammer ab `ab` (zeigt auf "("), bis zur passenden ")". */
function klammer(text, ab) {
    let tiefe = 0;
    for (let i = ab; i < text.length; i++) {
        if (text[i] === '(') tiefe++;
        else if (text[i] === ')' && --tiefe === 0) return text.slice(ab + 1, i);
    }
    return null;
}

/** An Kommas der obersten Ebene teilen. */
function teile(rumpf) {
    const aus = [];
    let tiefe = 0, start = 0;
    for (let i = 0; i < rumpf.length; i++) {
        const z = rumpf[i];
        if (z === '(') tiefe++;
        else if (z === ')') tiefe--;
        else if (z === ',' && tiefe === 0) { aus.push(rumpf.slice(start, i)); start = i + 1; }
    }
    aus.push(rumpf.slice(start));
    return aus.map(s => s.trim()).filter(Boolean);
}

const KEIN_SPALTENKOPF = /^(PRIMARY|KEY|UNIQUE|INDEX|CONSTRAINT|FOREIGN|FULLTEXT|SPATIAL|CHECK|PERIOD)\b/i;

/**
 * Aus dem Code einer Datei: welche Tabellen sie anlegt (`angelegt`) und welche
 * Spalten sie anlegt oder hinzufügt (`spalten`: `{ tabelle: { spalte: typ } }`).
 * Nur feste Namen; `${…}` wird übersprungen. Besitz kommt nur aus CREATE TABLE.
 */
function spaltenAusCode(text) {
    const aus = {}, angelegt = new Set();
    const setze = (t, s, typ) => { (aus[t] ||= {})[s] = typ.toLowerCase(); };
    for (const m of text.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([a-z][a-z0-9_]*)`?\s*\(/gi)) {
        const rumpf = klammer(text, m.index + m[0].length - 1);
        if (!rumpf) continue;
        angelegt.add(m[1]);
        aus[m[1]] ||= {};
        for (const stueck of teile(rumpf)) {
            if (KEIN_SPALTENKOPF.test(stueck)) continue;
            const k = stueck.match(/^`?([a-z_][a-z0-9_]*)`?\s+([a-z]+)/i);
            if (k) setze(m[1], k[1], k[2]);
        }
    }
    const abschnitte = text.split(/(?=\bALTER\s+TABLE\b)/i).slice(1);
    for (const a of abschnitte) {
        const kopf = a.match(/^ALTER\s+TABLE\s+`?([a-z][a-z0-9_]*)`?/i);
        if (!kopf) continue;
        const bis = a.search(/\b(await|CREATE\s+TABLE|db\.query|return)\b/);
        const rumpf = bis > 0 ? a.slice(0, bis) : a;
        for (const k of rumpf.matchAll(/ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([a-z_][a-z0-9_]*)`?\s+([a-z]+)/gi)) setze(kopf[1], k[1], k[2]);
    }
    return { angelegt, spalten: aus };
}

/** Migration einer Datei als `quelle:datei` (wie in `migrations`), sonst null. */
function migrationVon(datei) {
    const rel = path.relative(WURZEL, datei).split(path.sep);
    if (rel[0] === 'plugins' && rel[2] === 'migrations' && rel.length === 4) return `${rel[1]}:${rel[3]}`;
    if (rel[0] === 'migrations' && rel[1] === 'kern' && rel.length === 3) return `kern:${rel[2]}`;
    return null;
}

/**
 * Besitz und Spalten aus dem Code.
 *
 * `besitz` nennt nur Plugin-Tabellen; was dort fehlt, gehört dem Kern
 * (`?? KERN`). Spalten zählen nur, wo sie noch kommen werden: aus Migrationen,
 * die noch nicht gelaufen sind (`offen`), und aus einem CREATE TABLE außerhalb
 * der Migrationen für eine Tabelle, die es noch nicht gibt. Alte Migrationen
 * legen Tabellen und Spalten an, die spätere wieder entfernen; die Datenbank
 * weiß es besser.
 */
function leseCode(plugins, istOffen, gibtEs) {
    const besitz = {}, spalten = {}, wer = {};
    const nimm = (plugin, datei) => {
        const { angelegt, spalten: gefunden } = spaltenAusCode(ohneKommentareDatei(datei));
        if (plugin !== KERN) for (const t of angelegt) (wer[t] ||= new Set()).add(plugin);
        const mig = migrationVon(datei);
        for (const [t, sp] of Object.entries(gefunden)) {
            if (mig ? !istOffen(mig) : (gibtEs(t) || !angelegt.has(t))) continue;
            Object.assign(spalten[t] ||= {}, sp);
        }
    };
    for (const p of plugins) for (const d of quellen(path.join(WURZEL, 'plugins', p))) nimm(p, d);
    for (const ort of ['apps', 'packages', 'migrations']) for (const d of quellen(path.join(WURZEL, ort))) nimm(KERN, d);
    for (const [t, ps] of Object.entries(wer)) besitz[t] = [...ps].join(', ');
    return { besitz, spalten };
}

// ── Prüfungen (rein, damit die Gegenproben sie wiederverwenden) ─────────────

/** Normalform eines Eintrags: `{ weg, mit, grund }`. */
function form(wert) {
    return typeof wert === 'string' ? { weg: wert, mit: [], grund: '' }
        : { weg: wert?.weg, mit: wert?.mit ?? [], grund: wert?.grund ?? '' };
}

function pruefePflicht(meta) {
    return Object.entries(meta)
        .filter(([, m]) => !m.mitgliedInhalte || typeof m.mitgliedInhalte !== 'object' || Array.isArray(m.mitgliedInhalte))
        .map(([p]) => `${p}: mitgliedInhalte fehlt (auch ohne Tabellen als {} eintragen)`);
}

function pruefeForm(meta) {
    const aus = [];
    for (const [p, m] of Object.entries(meta)) {
        for (const [t, spalten] of Object.entries(m.mitgliedInhalte || {})) {
            if (!spalten || typeof spalten !== 'object' || Array.isArray(spalten) || !Object.keys(spalten).length) {
                aus.push(`${p}: ${t} braucht mindestens eine Spalte`);
                continue;
            }
            for (const [s, wert] of Object.entries(spalten)) {
                const ort = `${p}: ${t}.${s}`;
                if (typeof wert !== 'string' && (!wert || typeof wert !== 'object' || Array.isArray(wert))) { aus.push(`${ort} ist weder Weg noch Objekt`); continue; }
                if (typeof wert === 'object') for (const k of Object.keys(wert)) if (!SCHLUESSEL.includes(k)) aus.push(`${ort}: unbekannter Schlüssel ${k}`);
                const { weg, mit, grund } = form(wert);
                if (!WEGE.includes(weg)) { aus.push(`${ort}: Weg „${weg}“ gibt es nicht (${WEGE.join(', ')})`); continue; }
                if (MIT_GRUND.includes(weg) && !String(grund).trim()) aus.push(`${ort}: ${weg} ohne grund`);
                if (!Array.isArray(mit)) aus.push(`${ort}: mit ist keine Liste`);
                else if (mit.length && weg !== 'anonymisieren') aus.push(`${ort}: mit nur beim Anonymisieren`);
            }
        }
    }
    return aus;
}

function pruefeBesitz(meta, schema) {
    const aus = [];
    for (const [p, m] of Object.entries(meta)) {
        for (const [t, spalten] of Object.entries(m.mitgliedInhalte || {})) {
            const sp = schema.spalten[t];
            if (!sp) { aus.push(`${p}: ${t} gibt es nicht`); continue; }
            const wem = schema.besitz[t] ?? KERN;
            if (wem !== p) aus.push(`${p}: ${t} gehört ${wem}`);
            for (const [s, wert] of Object.entries(spalten || {})) {
                if (!(s in sp)) aus.push(`${p}: ${t}.${s} gibt es nicht`);
                const { weg, mit } = form(wert);
                for (const n of Array.isArray(mit) ? mit : []) {
                    if (!(n in sp)) aus.push(`${p}: ${t}.${s} mit ${n}: Spalte gibt es nicht`);
                    if (n === s) aus.push(`${p}: ${t}.${s} nennt sich selbst in mit`);
                }
                if (weg === 'anonymisieren' && s in sp && !TEXT_TYP.test(sp[s])) aus.push(`${p}: ${t}.${s} ist ${sp[s]}, anonymisieren braucht Text`);
            }
        }
    }
    return aus;
}

/** `{ "tabelle.spalte": plugin }` aller Erklärungen. */
function erklaert(meta) {
    const aus = {};
    for (const [p, m] of Object.entries(meta)) for (const [t, sp] of Object.entries(m.mitgliedInhalte || {})) for (const s of Object.keys(sp || {})) aus[`${t}.${s}`] = p;
    return aus;
}

function pruefeName(meta, schema) {
    const da = erklaert(meta);
    const aus = [];
    for (const [t, sp] of Object.entries(schema.spalten)) {
        if (schema.sichten.has(t)) continue;
        for (const [s, typ] of Object.entries(sp)) {
            if (!MITGLIED.test(s) || !ID_TYP.test(typ)) continue;
            if (!da[`${t}.${s}`]) aus.push(`${t}.${s} (${typ}) fehlt in mitgliedInhalte von ${schema.besitz[t] ?? KERN}`);
        }
    }
    return aus;
}

function pruefeWerte(meta, schema, mitIds) {
    const da = erklaert(meta);
    return mitIds
        .filter(({ t, s }) => !MITGLIED.test(s) && !KEIN_MITGLIED.test(s) && !da[`${t}.${s}`])
        .map(({ t, s, n }) => `${t}.${s}: ${n} Zeile(n) mit Discord-IDs, Name sagt nichts → in mitgliedInhalte von ${schema.besitz[t] ?? KERN} erklären (notfalls ausgenommen mit Grund)`);
}

// ── Lauf ─────────────────────────────────────────────────────────────────────

(async () => {
    console.log('\nMitglieds-Inhalte (G-04a, K380)');
    const plugins = fs.readdirSync(path.join(WURZEL, 'plugins'))
        .filter(p => fs.existsSync(path.join(WURZEL, 'plugins', p, 'package.json')));
    const meta = Object.fromEntries(plugins.map(p => [p, JSON.parse(fs.readFileSync(path.join(WURZEL, 'plugins', p, 'package.json'), 'utf8'))]));

    const { ServiceManager } = require('dunebot-core');
    const { DBService } = require('dunebot-db-client');
    const db = new DBService();
    ServiceManager.register('dbService', db);
    try {
        const tabellen = await db.query('SELECT TABLE_NAME AS t, TABLE_TYPE AS art FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()');
        const sichten = new Set(tabellen.filter(r => r.art === 'VIEW').map(r => r.t));
        const spaltenDb = await db.query('SELECT TABLE_NAME AS t, COLUMN_NAME AS s, DATA_TYPE AS typ FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()');
        const gelaufen = new Set((await db.query('SELECT source, filename FROM migrations WHERE success = 1')).map(r => `${r.source}:${r.filename}`));
        const inDb = new Set(tabellen.map(r => r.t));
        const code = leseCode(plugins, (mig) => !gelaufen.has(mig), (t) => inDb.has(t));

        // Datenbank zuerst, Code ergänzt, was noch nicht migriert ist.
        const spalten = {};
        for (const { t, s, typ } of spaltenDb) (spalten[t] ||= {})[s] = String(typ).toLowerCase();
        const nurImCode = [];
        for (const [t, sp] of Object.entries(code.spalten)) {
            if (sichten.has(t)) continue;
            for (const [s, typ] of Object.entries(sp)) {
                if (spalten[t]?.[s]) continue;
                (spalten[t] ||= {})[s] = typ;
                nurImCode.push(`${t}.${s}`);
            }
        }
        const schema = { spalten, besitz: code.besitz, sichten };

        // Werte: jede ID-fähige Spalte einer echten Tabelle, die Discord-IDs trägt.
        const mitIds = [];
        for (const { t, s, typ } of spaltenDb) {
            if (sichten.has(t) || !ID_TYP.test(String(typ).toLowerCase())) continue;
            const [{ n }] = await db.query(`SELECT COUNT(*) AS n FROM \`${t}\` WHERE CAST(\`${s}\` AS CHAR) REGEXP ?`, [SCHNEEFLOCKE]);
            if (Number(n)) mitIds.push({ t, s, n: Number(n) });
        }

        console.log(`  ${Object.keys(spalten).length - sichten.size} Tabellen, ${nurImCode.length} Spalte(n) nur im Code, ${mitIds.length} Spalten mit Discord-IDs`);

        await pruefe('Pflicht: jedes Plugin hat mitgliedInhalte', async () => assert.deepStrictEqual(pruefePflicht(meta), []));
        await pruefe('Form: vier Wege, Grund bei frist/ausgenommen, mit nur beim Anonymisieren', async () => assert.deepStrictEqual(pruefeForm(meta), []));
        await pruefe('Besitz: Tabelle gehört dem Erklärenden, Spalten gibt es, anonymisierte Spalten sind Text', async () => {
            const mehrfach = Object.entries(code.besitz).filter(([t, w]) => w.includes(',') && spalten[t]).map(([t, w]) => `${t}: ${w}`);
            assert.deepStrictEqual(mehrfach, [], 'zwei Plugins legen dieselbe Tabelle an');
            assert.deepStrictEqual(pruefeBesitz(meta, schema), []);
        });
        await pruefe('Name: jede Spalte, die nach Mitglieds-ID heißt, ist erklärt', async () => assert.deepStrictEqual(pruefeName(meta, schema), []));
        await pruefe('Werte: jede Spalte mit Discord-IDs ohne sprechenden Namen ist erklärt', async () => assert.deepStrictEqual(pruefeWerte(meta, schema, mitIds), []));

        // ── Gegenproben ──────────────────────────────────────────────────────
        const kopie = () => JSON.parse(JSON.stringify(meta));
        const rot = (liste, was) => assert.ok(liste.length > 0, `Gegenprobe blieb grün: ${was}`);
        await pruefe('Gegenproben: jede eingebaute Verletzung wird rot', async () => {
            let m = kopie(); delete m.information.mitgliedInhalte; rot(pruefePflicht(m), 'Erklärung fehlt');
            m = kopie(); m.giveaway.mitgliedInhalte.giveaway_entries.user_id = 'vergessen'; rot(pruefeForm(m), 'erfundener Weg');
            m = kopie(); m.moderation.mitgliedInhalte.moderation_logs.member_id = { weg: 'frist' }; rot(pruefeForm(m), 'frist ohne Grund');
            m = kopie(); m.giveaway.mitgliedInhalte.giveaway_entries.user_id = { weg: 'loeschen', mit: ['entry_count'] }; rot(pruefeForm(m), 'mit beim Löschen');
            m = kopie(); m.giveaway.mitgliedInhalte.giveaway_entries.user_id = { weg: 'loeschen', warum: 'x' }; rot(pruefeForm(m), 'fremder Schlüssel');
            m = kopie(); m.music.mitgliedInhalte.tickets = { created_by: 'loeschen' }; rot(pruefeBesitz(m, schema), 'fremde Tabelle');
            m = kopie(); m.music.mitgliedInhalte.music_history.wer_war_es = 'loeschen'; rot(pruefeBesitz(m, schema), 'erfundene Spalte');
            m = kopie(); m.moderation.mitgliedInhalte.moderation_logs.admin_id.mit = ['admin_name']; rot(pruefeBesitz(m, schema), 'erfundene mit-Spalte');
            m = kopie(); m.ticket.mitgliedInhalte.tickets.created_by = 'anonymisieren';
            rot(pruefeBesitz(m, { ...schema, spalten: { ...schema.spalten, tickets: { ...schema.spalten.tickets, created_by: 'bigint' } } }), 'anonymisieren auf Zahl');
            m = kopie(); delete m.ticket.mitgliedInhalte.ticket_feedback; rot(pruefeName(m, schema), 'erklärte Spalte entfernt');
            const neu = { ...schema, spalten: { ...schema.spalten, leveling_xp: { guild_id: 'varchar', user_id: 'varchar' } }, besitz: { ...schema.besitz, leveling_xp: 'leveling' } };
            rot(pruefeName(meta, neu), 'neue Tabelle mit user_id, nur im Code');
            rot(pruefeWerte(meta, schema, [{ t: 'music_history', s: 'zuhoerer', n: 3 }]), 'IDs in einer Spalte ohne sprechenden Namen');
            assert.deepStrictEqual(pruefeWerte(meta, schema, [{ t: 'music_history', s: 'voice_channel', n: 3 }]), [], 'Kanal-Spalte fälschlich rot');
            const ausCode = spaltenAusCode("CREATE TABLE IF NOT EXISTS `probe_x` (\n id INT, `user_id` VARCHAR(20) NOT NULL, wert DECIMAL(10,2), PRIMARY KEY (id), KEY k (user_id, wert)\n);\nALTER TABLE probe_x ADD COLUMN IF NOT EXISTS hosted_by VARCHAR(20), ADD INDEX i (hosted_by)");
            assert.deepStrictEqual(ausCode.spalten, { probe_x: { id: 'int', user_id: 'varchar', wert: 'decimal', hosted_by: 'varchar' } }, 'Code-Leser: ' + JSON.stringify(ausCode.spalten));
            assert.deepStrictEqual([...spaltenAusCode('ALTER TABLE guilds ADD COLUMN x_by VARCHAR(20)').angelegt], [], 'ALTER TABLE darf keinen Besitz begründen');
            assert.strictEqual(migrationVon(path.join(WURZEL, 'plugins/leveling/migrations/20261114_000000_xp.js')), 'leveling:20261114_000000_xp.js');
            assert.strictEqual(migrationVon(path.join(WURZEL, 'migrations/kern/20261113_200000_ereignisbuch.js')), 'kern:20261113_200000_ereignisbuch.js');
            assert.strictEqual(migrationVon(path.join(WURZEL, 'plugins/leveling/dashboard/index.js')), null);
            // Gelaufene Migrationen zählen nicht, offene schon: alles offen → die
            // 2026-08-02 entfernte Tabelle daemon_tokens taucht auf; nichts offen
            // → ereignisbuch (noch nicht migriert) fehlt.
            const alles = leseCode(plugins, () => true, (t) => inDb.has(t));
            assert.ok(alles.spalten.daemon_tokens?.created_by, 'Code-Leser findet alte Migrationen nicht');
            rot(pruefeName(meta, { ...schema, spalten: { ...schema.spalten, ...alles.spalten } }), 'Spalte aus einer offenen Migration');
            const nichts = leseCode(plugins, () => false, (t) => inDb.has(t));
            assert.ok(!nichts.spalten.daemon_tokens && (inDb.has('ereignisbuch') || !nichts.spalten.ereignisbuch), 'gelaufene oder fremde Migration mitgezählt');
        });
    } finally {
        await db.pool.end();
    }

    console.log(fehler ? `\n✗ ${fehler} Prüfung(en) rot` : '\n✅ Jede Mitglieds-Spalte ist erklärt');
    process.exit(fehler ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
