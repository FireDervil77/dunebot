#!/usr/bin/env node
/**
 * Das Lösen einer Kontoverknüpfung nimmt mit, was an ihr hing (Kassensturz
 * K129, Baustelle 99, 2026-11-07).
 *
 * Bis dahin löschte der Knopf eine Zeile in `user_connections`, und sonst
 * nichts: Abonnentenliste, Abo-Rollen, Heim-Guild mit Chatbot und die
 * Ereignis-Abos bei Twitch blieben — die Abos lieferten sogar weiter.
 * Betreiber am 2026-10-29: beim Lösen löschen, Haken `beimLoesen`, am Knopf
 * sagen, was wegfällt; F2: Einträge fremder Guilds bleiben; am 2026-11-07:
 * die Chatbot-Einrichtung geht mit.
 *
 * Gespielt an TEMPORÄREN Kopien der echten Tabellen (eine Verbindung, die
 * Kopien verdecken die echten) — so läuft das echte SQL, nichts Echtes wird
 * berührt. Twitch ist ersetzt: Abbestellen und Bestellen werden mitgeschrieben.
 *
 *   Registry     Haken nur ganz oder gar nicht; Vorschau fällt nie durch,
 *                Aufräumen wirft durch, ohne Anbieter null
 *   Vorschau     zählt auf, was beim Inhaber wegfällt und was bleibt
 *   Inhaber      löst: Liste, Rollen (Auftrag), Chatbot, Heim-Guild, Ansage,
 *                Ereignis-Abos mit Zusage weg; Pflicht und Raid bleiben;
 *                ein zweiter Lauf tut nichts
 *   Lücke        ein spätes Abo-Ereignis legt keine Liste neu an; abosSichern
 *                bestellt ohne Inhaber keine Abo-Ereignisse
 *   Zuschauer    löst: seine Abo-Rolle geht, der Kanal bleibt unberührt
 *   Verknüpft    ein Kanal mit Inhaber wird nicht angefasst
 *   Tageslauf    holt einen Kanal ohne Inhaber nach, lässt saubere stehen
 *   Route        falscher Name löst nichts; richtiger löst und ruft den Haken;
 *                scheitert der, steht „geloest_rest" in der Antwort
 *   Ansicht      roter Dialog mit Liste, Name eintippen, kein confirm()
 *
 *   node scripts/check-verbindung-loesen.js
 */
'use strict';
const assert = require('assert');
const path = require('path');
const WURZEL = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(WURZEL, 'apps/dashboard/.env'), quiet: true });
const ejs = require('ejs');
const mysql = require('mysql2/promise');
const { ServiceManager } = require('dunebot-core');

const protokoll = [];
const merk = (stufe) => (...a) => protokoll.push(`${stufe} ${a.map(x => x instanceof Error ? x.message : String(x)).join(' ')}`);
ServiceManager.register('Logger', { debug: merk('debug'), info: merk('info'), warn: merk('warn'), error: merk('error'), success: merk('info') });

const TABELLEN = ['user_connections', 'user_connection_grants', 'streaming_streamers', 'streaming_subscribers',
    'streaming_targets', 'streaming_role_grants', 'streaming_outbox', 'streaming_subscriptions',
    'streaming_commands', 'streaming_variables', 'streaming_announcements', 'streaming_lose', 'streaming_music_queue'];

let fehler = 0;
async function pruefe(was, tun) {
    try { await tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').slice(0, 8).join('\n      ')}`); }
}

(async () => {
    console.log('\nLösen einer Kontoverknüpfung räumt auf (K129)');
    const c = await mysql.createConnection({ host: process.env.MYSQL_HOST, port: process.env.MYSQL_PORT,
        user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE });
    try {
        // Die temporären Tabellen verdecken in DIESER Verbindung die echten (DDL nur an TEMPORARY).
        for (const t of TABELLEN) {
            await c.query(`CREATE TEMPORARY TABLE fb_probe_${t} LIKE ${t}`);
            await c.query(`CREATE TEMPORARY TABLE ${t} LIKE fb_probe_${t}`);
        }
        const q = async (sql, p) => (await c.query(sql, p))[0];
        ServiceManager.register('dbService', { query: q, getConfig: async () => null });

        const abos = require(path.join(WURZEL, 'plugins/streaming/dashboard/kern/abos'));
        const abonnenten = require(path.join(WURZEL, 'plugins/streaming/dashboard/kern/abonnenten'));
        const loesen = require(path.join(WURZEL, 'plugins/streaming/dashboard/kern/loesen'));
        require(path.join(WURZEL, 'plugins/streaming/dashboard/kern/chatabos')).abgleichen = async () => ({ abgebrochen: 'Probe' });
        const abbestellt = [];
        const bestellt = [];
        abos.ADAPTER.twitch.abbestellen = async (id) => { abbestellt.push(id); return true; };
        abos.ADAPTER.twitch.abonnieren = async (kanal, [b]) => { bestellt.push(b.typ); return [{ ok: true, anbieter_abo_id: `neu-${b.typ}`, kosten: 0 }]; };
        const { VerbindungsRegistry } = require('dunebot-sdk');

        // Inhaber U1 (Kanal 1, K1), Zuschauer U2 (Twitch V2), Inhaber U3 (Kanal 2, K3).
        // Kanal 3 (K9): niemand verknüpft, aber Reste — der Fall für den Tageslauf.
        // Kanal 4 (K8): niemand verknüpft, keine Reste.
        await q(`INSERT INTO user_connections (id, user_id, plattform, konto_id, konto_name) VALUES
            (1, 'U1', 'twitch', 'K1', 'Kanalfrau'), (2, 'U2', 'twitch', 'V2', 'Zuschauer'), (3, 'U3', 'twitch', 'K3', 'Andere')`);
        await q(`INSERT INTO streaming_streamers (id, plattform, kanal_id, login, heim_guild_id, chat_ansage_an, chat_ansage_text) VALUES
            (1, 'twitch', 'K1', 'kanalfrau', 'G1', 1, 'Hallo'), (2, 'twitch', 'K3', 'andere', 'G3', 0, NULL),
            (3, 'twitch', 'K9', 'rest', 'G9', 0, NULL), (4, 'twitch', 'K8', 'sauber', NULL, 0, NULL)`);
        await q(`INSERT INTO streaming_targets (id, guild_id, streamer_id, channel_id, abo_rolle_id, melder_arten, aktiv) VALUES
            (11, 'G1', 1, 'C1', 'R1', 'bits,raid', 1), (12, 'G2', 1, 'C2', NULL, NULL, 1),
            (21, 'G3', 2, 'C3', 'R3', NULL, 1), (31, 'G9', 3, 'C9', 'R9', NULL, 1), (41, 'G8', 4, 'C8', NULL, NULL, 1)`);
        await q(`INSERT INTO streaming_subscribers (streamer_id, konto_id, konto_name, stufe, geschenkt) VALUES
            (1, 'V2', 'Zuschauer', '1000', 0), (1, 'X', 'Fremd', '1000', 0), (2, 'V2', 'Zuschauer', '1000', 0)`);
        await q(`INSERT INTO streaming_role_grants (guild_id, mitglied_id, rolle_id) VALUES ('G1', 'U2', 'R1'), ('G3', 'U2', 'R3')`);
        await q(`INSERT INTO streaming_subscriptions (streamer_id, ereignis, anbieter_abo_id, geheimnis, zustand) VALUES
            (1, 'stream.online', 'a-on', 'g', 'bestaetigt'), (1, 'channel.subscribe', 'a-sub', 'g', 'bestaetigt'),
            (1, 'channel.subscription.end', 'a-end', 'g', 'bestaetigt'), (1, 'channel.cheer', 'a-bits', 'g', 'bestaetigt'),
            (1, 'channel.raid', 'a-raid', 'g', 'bestaetigt'), (2, 'channel.subscribe', 'b-sub', 'g', 'bestaetigt')`);
        await q(`INSERT INTO streaming_commands (guild_id, streamer_id, wort, art) VALUES ('G1', 1, 'game', 'fertig'), ('G1', 1, 'hallo', 'eigen'), ('G9', 3, 'x', 'eigen'), ('G3', 2, 'y', 'eigen')`);
        await q(`INSERT INTO streaming_variables (guild_id, streamer_id, name, art) VALUES ('G1', 1, 'tode', 'zaehler')`);
        await q(`INSERT INTO streaming_announcements (guild_id, streamer_id, text) VALUES ('G1', 1, 'Folgt mir')`);

        const zahl = async (sql, p) => Number((await q(sql, p))[0].n);
        const auftraege = async () => (await q("SELECT guild_id, aktion, nutzlast FROM streaming_outbox ORDER BY id"))
            .map(z => `${z.guild_id}:${z.aktion}:${JSON.parse(z.nutzlast).mitglied_id}`);

        await pruefe('Registry: Haken nur ganz; Vorschau fällt nie durch; Aufräumen wirft durch, ohne Anbieter null', async () => {
            const grund = { autorisierUrl: async () => '', identitaet: async () => null };
            assert.throws(() => VerbindungsRegistry.register('probe-halb', { ...grund, loesen: { wasWegfaellt: async () => ({}) } }), /kein aufraeumen/);
            VerbindungsRegistry.register('probe-wirft', { ...grund, loesen: {
                wasWegfaellt: async () => { throw new Error('klemmt'); }, aufraeumen: async () => { throw new Error('kaputt'); } } });
            const v = await VerbindungsRegistry.loesenVorschau('probe-wirft', {});
            assert.deepStrictEqual(v, { weg: [], bleibt: [], grund: 'klemmt' });
            await assert.rejects(VerbindungsRegistry.loesenAufraeumen('probe-wirft', {}), /kaputt/);
            assert.strictEqual(await VerbindungsRegistry.loesenAufraeumen('gibt-es-nicht', {}), null);
            VerbindungsRegistry.unregister('probe-wirft');
        });

        await pruefe('Vorschau: zählt beim Inhaber auf, was wegfällt und was bleibt', async () => {
            const v = await loesen.wasWegfaellt('twitch', { userId: 'U1', kontoId: 'K1' });
            const text = v.weg.join('\n');
            assert.match(text, /Abonnentenliste von kanalfrau \(2 Einträge\)/);
            assert.match(text, /Abo-Rollen deiner Abonnenten/);
            assert.match(text, /Heim-Guild/);
            assert.match(text, /Chat-Ansage/);
            assert.match(text, /Chatbot-Einrichtung: 2 Befehle, 1 Variablen, 1 Ansagen/);
            assert.match(text, /Ereignis-Abos bei Twitch, die deine Erlaubnis brauchen \(3\)/);
            assert.match(v.bleibt.join('\n'), /Ankündigungen von kanalfrau/);
            const zuschauer = await loesen.wasWegfaellt('twitch', { userId: 'U2', kontoId: 'V2' });
            assert.deepStrictEqual(zuschauer.weg, ['Deine Abo-Rolle bei kanalfrau, andere']);
        });

        await pruefe('Inhaber löst: Liste, Rollen, Chatbot, Heim-Guild, Ansage und Ereignis-Abos mit Zusage gehen; Pflicht und Raid bleiben', async () => {
            await q("DELETE FROM user_connections WHERE user_id = 'U1'");
            const bericht = await loesen.nachDemLoesen('twitch', { userId: 'U1', kontoId: 'K1' });
            assert.strictEqual(bericht.kanaele.length, 1);
            assert.strictEqual(await zahl('SELECT COUNT(*) n FROM streaming_subscribers WHERE streamer_id = 1'), 0);
            assert.deepStrictEqual(await auftraege(), ['G1:rolle_nehmen:U2'], 'die Abo-Rolle in G1 geht zurück, sonst nichts');
            for (const t of loesen.CHATBOT.map(([x]) => x)) {
                assert.strictEqual(await zahl(`SELECT COUNT(*) n FROM ${t} WHERE streamer_id = 1`), 0, `${t} blieb`);
            }
            const [s] = await q('SELECT heim_guild_id, chat_ansage_an, chat_ansage_text FROM streaming_streamers WHERE id = 1');
            assert.deepStrictEqual({ ...s }, { heim_guild_id: null, chat_ansage_an: 0, chat_ansage_text: null });
            const bleiben = (await q('SELECT ereignis FROM streaming_subscriptions WHERE streamer_id = 1 ORDER BY ereignis')).map(z => z.ereignis);
            assert.deepStrictEqual(bleiben, ['channel.raid', 'stream.online']);
            assert.deepStrictEqual(abbestellt.sort(), ['a-bits', 'a-end', 'a-sub']);
            assert.strictEqual(await zahl('SELECT COUNT(*) n FROM streaming_targets WHERE streamer_id = 1'), 2, 'F2: die Ziele der Guilds bleiben');
            assert.strictEqual(await zahl('SELECT COUNT(*) n FROM streaming_commands WHERE streamer_id <> 1'), 2, 'fremde Kanäle angefasst');
            const zweiter = await loesen.nachDemLoesen('twitch', { userId: 'U1', kontoId: 'K1' });
            assert.strictEqual(zweiter.kanaele[0].rollen + zweiter.kanaele[0].abbestellt + zweiter.kanaele[0].chatbot, 0);
            assert.strictEqual((await auftraege()).length, 1, 'der zweite Lauf schrieb Aufträge');
        });

        await pruefe('Lücke: ein spätes Abo-Ereignis legt keine Liste an; abosSichern bestellt ohne Inhaber keine Abo-Ereignisse, auch mit Heim-Guild', async () => {
            const [s] = await q('SELECT * FROM streaming_streamers WHERE id = 1');
            await abonnenten.aufnehmen(s, { kontoId: 'Y', kontoName: 'Spät', stufe: '1000' });
            assert.strictEqual(await zahl('SELECT COUNT(*) n FROM streaming_subscribers WHERE streamer_id = 1'), 0);
            // Kanal 3: Heim-Guild steht noch, eine Guild will die Abo-Rolle, niemand ist
            // verknüpft — so steht es, wenn der Tageslauf abosSichern ruft, bevor er nachholt.
            assert.strictEqual(await abos.aboRollenGewuenscht(3), true, 'Aufbau: Kanal 3 will eine Abo-Rolle');
            await abos.abosSichern(3, 'twitch', 'K9');
            assert.ok(bestellt.includes('stream.online'), `Aufbau: nichts bestellt (${bestellt.join(', ')})`);
            assert.ok(!bestellt.some(t => /subscri|cheer/.test(t)), `ohne Inhaber bestellt: ${bestellt.join(', ')}`);
        });

        await pruefe('Zuschauer löst: seine Abo-Rolle geht, der fremde Kanal bleibt unberührt', async () => {
            await q("DELETE FROM user_connections WHERE user_id = 'U2'");
            const vorher = (await auftraege()).length;
            const bericht = await loesen.nachDemLoesen('twitch', { userId: 'U2', kontoId: 'V2' });
            assert.strictEqual(bericht.kanaele.length, 0);
            assert.deepStrictEqual((await auftraege()).slice(vorher), ['G3:rolle_nehmen:U2']);
            assert.strictEqual(await zahl('SELECT COUNT(*) n FROM streaming_subscribers WHERE streamer_id = 2'), 1, 'die Liste gehört dem Kanal');
            const [s] = await q('SELECT heim_guild_id FROM streaming_streamers WHERE id = 2');
            assert.strictEqual(s.heim_guild_id, 'G3');
        });

        await pruefe('Verknüpft: ein Kanal mit Inhaber wird nicht angefasst', async () => {
            const [s] = await q('SELECT * FROM streaming_streamers WHERE id = 2');
            assert.strictEqual(await loesen.ohneNachweis(s), null);
            assert.strictEqual(await zahl('SELECT COUNT(*) n FROM streaming_commands WHERE streamer_id = 2'), 1);
        });

        await pruefe('Tageslauf: holt den Kanal ohne Inhaber nach, lässt die sauberen stehen', async () => {
            const n = await loesen.nachholen();
            assert.strictEqual(n, 1);
            const [s] = await q('SELECT heim_guild_id FROM streaming_streamers WHERE id = 3');
            assert.strictEqual(s.heim_guild_id, null);
            assert.strictEqual(await zahl('SELECT COUNT(*) n FROM streaming_commands WHERE streamer_id = 3'), 0);
            assert.strictEqual(await loesen.nachholen(), 0, 'zweiter Lauf fand noch etwas');
            assert.strictEqual(await zahl('SELECT COUNT(*) n FROM streaming_commands WHERE streamer_id = 2'), 1);
        });

        await pruefe('Route: falscher Name löst nichts; richtiger löst und ruft den Haken; scheitert der, sagt die Antwort es', async () => {
            const router = require(path.join(WURZEL, 'apps/dashboard/routes/verbindungen.router.js'));
            const schicht = router.stack.find(l => l.route && l.route.path === '/:plattform/loesen');
            const handler = schicht.route.stack[schicht.route.stack.length - 1].handle;
            const rufe = async (body) => {
                let ziel = null;
                await handler({ params: { plattform: 'probe-route' }, body: { zurueck: '/guild/1/profile/verbindungen', ...body },
                    session: { user: { info: { id: 'U3' } } } }, { redirect: (z) => { ziel = z; } });
                return ziel;
            };
            await q("INSERT INTO user_connections (id, user_id, plattform, konto_id, konto_name) VALUES (9, 'U3', 'probe-route', 'P3', 'Probename')");
            const gerufen = [];
            let wirft = false;
            VerbindungsRegistry.register('probe-route', { autorisierUrl: async () => '', identitaet: async () => null, loesen: {
                wasWegfaellt: async () => ({ weg: [] }),
                aufraeumen: async (ctx) => { gerufen.push(ctx); if (wirft) throw new Error('kaputt'); return {}; } } });
            assert.match(await rufe({ bestaetigung: 'probename' }), /fehler=bestaetigung$/);
            assert.strictEqual(await zahl("SELECT COUNT(*) n FROM user_connections WHERE plattform = 'probe-route'"), 1, 'falscher Name hat gelöst');
            assert.strictEqual(gerufen.length, 0);
            assert.match(await rufe({ bestaetigung: ' Probename ' }), /ok=geloest$/);
            assert.strictEqual(await zahl("SELECT COUNT(*) n FROM user_connections WHERE plattform = 'probe-route'"), 0);
            assert.deepStrictEqual(gerufen, [{ userId: 'U3', kontoId: 'P3', kontoName: 'Probename' }]);
            await q("INSERT INTO user_connections (id, user_id, plattform, konto_id, konto_name) VALUES (9, 'U3', 'probe-route', 'P3', 'Probename')");
            wirft = true;
            assert.match(await rufe({ bestaetigung: 'Probename' }), /ok=geloest_rest$/);
            assert.strictEqual(await zahl("SELECT COUNT(*) n FROM user_connections WHERE plattform = 'probe-route'"), 0, 'der Nachweis geht auch dann');
            assert.match(await rufe({ bestaetigung: 'Probename' }), /fehler=nicht_verbunden$/);
            VerbindungsRegistry.unregister('probe-route');
        });

        await pruefe('Ansicht: roter Dialog mit Liste und Namensfeld, Knopf gesperrt, kein confirm() am Lösen', async () => {
            const html = await ejs.renderFile(path.join(WURZEL, 'apps/dashboard/themes/default/views/guild/profile-verbindungen.ejs'), {
                guildId: '1', rueckrufe: [], meldung: null, fehler: null, grund: null, locals: { csrfToken: 't' },
                anbieter: [{ name: 'twitch', label: 'Twitch', symbol: 'fa-brands fa-twitch', farbe: null, hinweis: null,
                    verbunden: true, kontoName: 'Kanalfrau', seit: new Date(), scopes: ['bits:read'], zusageFehler: null, zusagen: [],
                    einstellungen: null, loesenName: 'Kanalfrau',
                    loesen: { weg: ['Die Chat-Ansage beim Streamstart'], bleibt: ['Ankündigungen von x'], grund: null } }]
            });
            assert.match(html, /id="loesenModal-twitch"/);
            assert.match(html, /ENDGÜLTIG lösen/);
            assert.match(html, /Das lässt sich nicht zurücknehmen\./);
            assert.match(html, /<li>Die Chat-Ansage beim Streamstart<\/li>/);
            assert.match(html, /<li>Die Berechtigungen, die du erteilt hast<\/li>/);
            assert.match(html, /name="bestaetigung"[^>]*data-soll="Kanalfrau"/);
            assert.match(html, /<button type="submit" class="btn btn-danger fw-bold" disabled>/);
            assert.doesNotMatch(html, /confirm\('Verknüpfung/);
        });
    } finally { await c.end(); }

    console.log(fehler ? `\n✗ ${fehler} Prüfung(en) rot` : '\n✅ Lösen nimmt mit, was an der Verknüpfung hing');
    process.exit(fehler ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
