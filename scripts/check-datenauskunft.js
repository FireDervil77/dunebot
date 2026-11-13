#!/usr/bin/env node
/**
 * Datenauskunft: zählen, exportieren, Mitglied löschen, Guild löschen
 * (G-04b, K380, 2026-11-13).
 *
 * `apps/dashboard/helpers/Datenauskunft.js` liest die Erklärungen der Plugins
 * (`mitgliedInhalte`, `guildInhalte`) und leitet aus dem Schema ab, in welcher
 * Guild eine Zeile liegt. Geprüft wird gegen die echte Datenbank, geschrieben
 * wird nichts: Gelöscht wird nur im Probelauf, dessen Transaktion am Ende
 * zurückrollt — und dass sie zurückrollt, wird nachgemessen.
 *
 *   Plan         jede erklärte Tabelle hat einen Bereich (guild, eltern,
 *                uebergreifend), nichts ist unableitbar
 *   Haken        wer abgeleitete Zähler oder Dinge außerhalb der Datenbank
 *                hat, hat seinen Haken (Liste unten, mit Grund)
 *   Auskunft     zählt für ein echtes Mitglied; der Export schwärzt fremde IDs
 *   Probelauf    „überall löschen“ für dasselbe Mitglied: die Zahlen passen
 *                zur Auskunft, danach ist alles wie vorher
 *   Guild        ein Probelauf in einer Guild fasst nichts Übergreifendes an
 *   Guild löschen  Kontroll-Guild abgewiesen, jede Liste läuft (Guild ohne
 *                Zeilen), ungültige IDs abgewiesen
 *   Gegenproben  im Speicher
 *
 *   node scripts/check-datenauskunft.js [mitglieds-id]
 *
 * Ohne ID nimmt der Wächter den Besitzer der Kontroll-Guild (der Betreiber,
 * er hat in fast jeder Tabelle Zeilen).
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const WURZEL = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(WURZEL, 'apps/dashboard/.env'), quiet: true });
const { ohneKommentare } = require('./lib/quelltext');

/** Wer einen Haken braucht, und warum (baustellen.md G-04a „Für G-04b mitnehmen“). */
const HAKEN = {
    streaming: { vor: 'streaming_role_grants ist das Buch der vergebenen Rollen: erst Rolle zurücknehmen, dann Zeile löschen' },
    core: { vor: 'Stimmen merken', nach: 'user_feedback.upvotes nachzählen' },
    gameserver: { vor: 'Bewertungen merken', nach: 'addon_marketplace.rating_avg/rating_count nachrechnen' },
};

let fehler = 0;
async function pruefe(was, tun) {
    try { await tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').slice(0, 30).join('\n      ')}`); }
}

(async () => {
    console.log('\nDatenauskunft (G-04b, K380)');
    const { ServiceManager } = require('dunebot-core');
    const { DBService } = require('dunebot-db-client');
    const db = new DBService();
    ServiceManager.register('dbService', db);
    const stumm = { info() {}, warn() {}, error() {}, debug() {}, success() {} };
    ServiceManager.register('Logger', stumm);
    const D = require(path.join(WURZEL, 'apps/dashboard/helpers/Datenauskunft.js'));
    const kontroll = String(process.env.CONTROL_GUILD_ID || '');

    try {
        const [besitzer] = await db.query('SELECT owner_id FROM guilds WHERE _id = ?', [kontroll]);
        const userId = process.argv[2] || besitzer?.owner_id;
        assert.ok(/^\d{17,20}$/.test(String(userId || '')), 'kein Mitglied für die Probe (CONTROL_GUILD_ID gesetzt?)');

        let plan;
        await pruefe('Plan: jede erklärte Tabelle hat einen Bereich', async () => {
            plan = await D.plan();
            assert.deepStrictEqual(plan.fehler, []);
            const arten = {};
            for (const p of plan.plugins) for (const t of p.tabellen) (arten[t.bereich.art] ||= []).push(t.tabelle);
            console.log(`      guild ${arten.guild?.length || 0}, eltern ${arten.eltern?.length || 0} (${(arten.eltern || []).join(', ')}),`);
            console.log(`      übergreifend ${arten.uebergreifend?.length || 0} (${(arten.uebergreifend || []).join(', ')})`);
        });

        await pruefe('Haken: wer sie braucht, hat sie (im Code, nicht im Kommentar)', async () => {
            const meldungen = [];
            for (const [p, soll] of Object.entries(HAKEN)) {
                const datei = path.join(WURZEL, 'plugins', p, 'dashboard', 'index.js');
                const text = ohneKommentare(fs.readFileSync(datei, 'utf8'));
                if (soll.vor && !/\basync\s+vorMitgliedLoeschen\s*\(/.test(text)) meldungen.push(`${p}: vorMitgliedLoeschen fehlt (${soll.vor})`);
                if (soll.nach && !/\basync\s+nachMitgliedLoeschen\s*\(/.test(text)) meldungen.push(`${p}: nachMitgliedLoeschen fehlt (${soll.nach})`);
                if (!D._intern.hatHaken(p)) meldungen.push(`${p}: Datenauskunft erkennt den Haken nicht`);
            }
            // Wer sonst einen Haken hat, steht in der Liste (sonst weiß niemand, warum).
            for (const p of fs.readdirSync(path.join(WURZEL, 'plugins'))) {
                if (D._intern.hatHaken(p) && !HAKEN[p]) meldungen.push(`${p}: hat einen Haken, steht aber nicht in HAKEN`);
            }
            assert.deepStrictEqual(meldungen, []);
        });

        let vorher;
        await pruefe(`Auskunft: zählt für ${userId}, Export schwärzt fremde Mitglieder`, async () => {
            vorher = await D.auskunft(userId, { mitZeilen: true });
            assert.deepStrictEqual(vorher.fehler, []);
            assert.ok(vorher.summe.loeschen + vorher.summe.anonymisieren > 0, 'Probe-Mitglied hat keine Zeilen, die Probe sagt nichts');
            const export_ = JSON.stringify(vorher);
            const fremde = [...export_.matchAll(/"(\d{17,20})"/g)].map(m => m[1]).filter(id => id !== userId);
            // Erlaubt sind IDs, die keine Mitglieder sind (Guild, Kanal, Rolle …):
            // geschwärzt wird nur, was in mitgliedInhalte als Mitglied erklärt ist.
            const mitglieder = new Set();
            for (const p of plan.plugins) for (const t of p.tabellen) for (const e of t.spalten) if (e.weg !== 'ausgenommen') mitglieder.add(`${t.tabelle}.${e.spalte}`);
            const offen = [];
            for (const p of vorher.plugins) for (const [t, { zeilen }] of Object.entries(p.zeilen || {})) {
                for (const z of zeilen) for (const [s, w] of Object.entries(z)) {
                    if (mitglieder.has(`${t}.${s}`) && w != null && /^\d{17,20}$/.test(String(w)) && String(w) !== userId) offen.push(`${t}.${s}`);
                }
            }
            assert.deepStrictEqual([...new Set(offen)], [], 'fremde Mitglieds-ID im Export');
            console.log(`      ${vorher.summe.loeschen} löschen (+${vorher.summe.mitgeloescht} mit), ${vorher.summe.anonymisieren} anonymisieren, ${vorher.summe.frist} Frist, ${vorher.summe.ausgenommen} ausgenommen; ${vorher.guilds.length} Guild(s); ${fremde.length} andere IDs (Guild/Kanal/Rolle, Freitext)`);
            const mit = vorher.plugins.flatMap(p => p.eintraege.filter(e => e.weg === 'mitgeloescht').map(e => `${e.tabelle} ${e.zeilen} über ${e.ueber}`));
            if (mit.length) console.log(`      mit: ${mit.join(', ')}`);
        });

        await pruefe('Probelauf überall: Zahlen passen zur Auskunft, danach ist alles wie vorher', async () => {
            const [{ n: sitzungenVorher }] = await db.query("SELECT COUNT(*) AS n FROM sessions WHERE JSON_VALUE(data, '$.user.info.id') = ?", [userId]);
            const t = await D.mitgliedLoeschen(userId, { trocken: true });
            assert.ok(t.ok, 'Probelauf gescheitert: ' + JSON.stringify(t.plugins.filter(r => !r.ok)));
            const meldungen = [];
            for (const p of vorher.plugins) {
                const r = t.plugins.find(x => x.plugin === p.plugin);
                const tabMitLoeschen = new Set(p.eintraege.filter(e => e.weg === 'loeschen').map(e => e.tabelle));
                for (const e of p.eintraege) {
                    if (e.weg === 'loeschen') {
                        if ((r.geloescht[e.tabelle] || 0) !== e.zeilen) meldungen.push(`${e.tabelle}: Auskunft ${e.zeilen}, gelöscht ${r.geloescht[e.tabelle] || 0}`);
                    } else if (e.weg === 'anonymisieren' && !tabMitLoeschen.has(e.tabelle)) {
                        const n = r.anonymisiert[`${e.tabelle}.${e.spalte}`] || 0;
                        if (n !== e.zeilen) meldungen.push(`${e.tabelle}.${e.spalte}: Auskunft ${e.zeilen}, anonymisiert ${n}`);
                    } else if (e.weg === 'frist') {
                        if (r.bleibt[`${e.tabelle}.${e.spalte}`]?.zeilen !== e.zeilen) meldungen.push(`${e.tabelle}.${e.spalte}: Frist nicht gemeldet`);
                    }
                }
            }
            // Was über CASCADE mitgeht: dieselben Zahlen wie in der Auskunft.
            for (const p of vorher.plugins) {
                const soll = {};
                for (const e of p.eintraege.filter(x => x.weg === 'mitgeloescht')) soll[e.tabelle] = (soll[e.tabelle] || 0) + e.zeilen;
                const ist = t.plugins.find(x => x.plugin === p.plugin)?.mitgeloescht || {};
                if (JSON.stringify(Object.entries(soll).sort()) !== JSON.stringify(Object.entries(ist).sort())) meldungen.push(`${p.plugin} mitgelöscht: Auskunft ${JSON.stringify(soll)}, Probelauf ${JSON.stringify(ist)}`);
            }
            const kern = t.plugins.find(x => x.plugin === 'core');
            if ((kern.geloescht.sessions || 0) !== Number(sitzungenVorher)) meldungen.push(`sessions: ${sitzungenVorher} offen, ${kern.geloescht.sessions || 0} beendet`);
            assert.deepStrictEqual(meldungen, []);

            const nachher = await D.auskunft(userId);
            assert.deepStrictEqual(nachher.summe, vorher.summe, 'nach dem Probelauf stehen andere Zahlen — Rollback?');
            const [{ n: sitzungenNachher }] = await db.query("SELECT COUNT(*) AS n FROM sessions WHERE JSON_VALUE(data, '$.user.info.id') = ?", [userId]);
            assert.strictEqual(Number(sitzungenNachher), Number(sitzungenVorher), 'Sitzungen nach dem Probelauf weg');
        });

        await pruefe('Probelauf in einer Guild: nichts Übergreifendes, keine Sitzung, Rest gemeldet', async () => {
            const g = vorher.guilds.includes(kontroll) ? kontroll : vorher.guilds[0];
            const t = await D.mitgliedLoeschen(userId, { guildId: g, trocken: true });
            assert.ok(t.ok, JSON.stringify(t.plugins.filter(r => !r.ok)));
            const uebergreifend = new Set();
            for (const p of plan.plugins) for (const tab of p.tabellen) if (tab.bereich.art === 'uebergreifend') uebergreifend.add(tab.tabelle);
            const angefasst = t.plugins.flatMap(r => [...Object.keys(r.geloescht), ...Object.keys(r.anonymisiert).map(k => k.split('.')[0])]);
            assert.deepStrictEqual(angefasst.filter(x => uebergreifend.has(x) || x === 'sessions'), []);
            const gemeldet = t.plugins.flatMap(r => r.nurUeberall);
            assert.ok(gemeldet.includes('users._id'), 'Konto nicht als „nur überall“ gemeldet: ' + gemeldet.join(', '));
            // Pro Guild: jede gelöschte Zahl entspricht der Aufteilung der Auskunft.
            for (const p of vorher.plugins) for (const e of p.eintraege.filter(x => x.weg === 'loeschen' && x.bereich !== 'uebergreifend')) {
                const r = t.plugins.find(x => x.plugin === p.plugin);
                assert.strictEqual(r.geloescht[e.tabelle] || 0, e.jeGuild[g] || 0, `${e.tabelle} in Guild ${g}`);
            }
        });

        await pruefe('Guild löschen: Kontroll-Guild abgewiesen, jede Liste läuft, falsche IDs abgewiesen', async () => {
            await assert.rejects(D.guildLoeschen(kontroll, { trocken: true }), /Kontroll-Guild/);
            for (const t of ['configs', 'guilds', 'guild_nav_items']) {
                const spalte = (await db.guildSpalten([t]))[t];
                const [{ n }] = await db.query(`SELECT COUNT(*) AS n FROM \`${t}\` WHERE \`${spalte}\` = '0'`);
                assert.strictEqual(Number(n), 0, `${t} hat Zeilen der Guild 0 — die Probe würde sie zählen`);
            }
            const t = await D.guildLoeschen('0', { trocken: true });
            assert.ok(t.ok, t.fehler);
            assert.deepStrictEqual(t.geloescht, {});
            for (const falsch of ['', null, 'abc', '1 OR 1=1']) await assert.rejects(D.guildLoeschen(falsch, { trocken: true }), /ungültige Guild-ID/);
            for (const falsch of ['', '123', "1' OR '1'='1"]) await assert.rejects(D.mitgliedLoeschen(falsch, { trocken: true }), /ungültige/);
            await assert.rejects(D.mitgliedLoeschen(userId), /PluginManager fehlt/, 'ohne PluginManager darf nicht echt gelöscht werden');
            await assert.rejects(D.guildLoeschen('1', {}), /PluginManager fehlt/);
        });

        await pruefe('Gegenproben: Bereich, Schwärzen, Haken-Erkennung', async () => {
            const { bedingung, schwaerzen } = D._intern;
            const ueber = { bereich: { art: 'uebergreifend' }, spalten: [] };
            assert.strictEqual(bedingung(ueber, 'user_id', '1', '2'), null, 'übergreifend in einer Guild angefasst');
            assert.ok(bedingung(ueber, 'user_id', '1', null), 'übergreifend überall nicht angefasst');
            const eltern = { bereich: { art: 'eltern', ueber: [{ spalte: 'giveaway_id', eltern: 'giveaways', elternSpalte: 'id', guildSpalte: 'guild_id' }] } };
            const b = bedingung(eltern, 'user_id', 'U', 'G');
            assert.match(b.sql, /`giveaway_id` IN \(SELECT `id` FROM `giveaways` WHERE `guild_id` = \?\)/);
            assert.deepStrictEqual(b.werte, ['U', 'G']);
            const tab = { spalten: [
                { spalte: 'admin_id', weg: 'anonymisieren', mit: [{ spalte: 'admin_tag' }] },
                { spalte: 'member_id', weg: 'frist', mit: [] },
                { spalte: 'target_id', weg: 'ausgenommen', mit: [] }] };
            const z = schwaerzen({ admin_id: '111111111111111111', admin_tag: 'mod#1', member_id: '222222222222222222', target_id: '333333333333333333', bild: Buffer.from('ab') }, tab, '222222222222222222');
            assert.deepStrictEqual(z, { admin_id: D.FREMD, admin_tag: D.FREMD, member_id: '222222222222222222', target_id: '333333333333333333', bild: '(2 Bytes binär)' });
            assert.strictEqual(D._intern.hatHaken('music'), false);
            // Antworten (Selbstbezug) und Kinder: die Abfragen laufen gegen die
            // echte Datenbank, auch wenn es heute keine Kommentare gibt.
            const kommentare = plan.plugins.flatMap(p => p.tabellen).find(t => t.tabelle === 'addon_comments');
            assert.ok(kommentare?.selbst, 'addon_comments: Selbstbezug (Antworten) nicht erkannt');
            const tickets = plan.plugins.flatMap(p => p.tabellen).find(t => t.tabelle === 'tickets');
            assert.deepStrictEqual(tickets.kinder.map(k => k.tabelle).sort(), ['ticket_feedback', 'ticket_transcripts']);
            const frage = (sql, w) => db.query(sql, w);
            assert.deepStrictEqual(await D._intern.mitgehend(frage, kommentare, D._intern.bedingung(kommentare, 'user_id', '1', null)), []);
            assert.deepStrictEqual(await D._intern.mitgehend(frage, tickets, D._intern.bedingung(tickets, 'created_by', '1', '2')), []);
        });
    } finally {
        await db.pool.end();
    }

    console.log(fehler ? `\n✗ ${fehler} Prüfung(en) rot` : '\n✅ Datenauskunft zählt, schwärzt und löscht nach den Erklärungen');
    process.exit(fehler ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
