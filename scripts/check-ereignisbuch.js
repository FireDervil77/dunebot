#!/usr/bin/env node
/**
 * Fachereignisse, G-02 (2026-11-13): Ereignisbuch, Quittungen, Zusteller.
 *
 * Läuft gegen die echte Datenbank, aber nur an TEMPORARY-Tabellen derselben
 * Verbindung. Die Kern-Migration legt sie an, umgeschrieben auf TEMPORARY;
 * echte Tabellen werden weder angelegt noch gelesen oder beschrieben. Den
 * Fremdschlüssel kennt MariaDB an temporären Tabellen nicht, er fällt hier
 * weg; das Löschen über ihn wird deshalb nicht geprüft.
 *
 * Geprüft wird der Weg, nicht nur die Teile:
 *   1. Melden: unbekannt, geplant, falsche Felder → Fehler; richtig → eine
 *      Zeile; derselbe Schlüssel noch einmal → dieselbe Zeile, `doppelt = 1`.
 *   2. Aus dem Bot (kein Zusteller im Prozess): Zeile steht `neu`, Anstoß geht
 *      als `core:EREIGNISSE_ANSTOSS` über IPC.
 *   3. Zusteller startet danach (wie nach einem Dashboard-Neustart): Die
 *      liegende Zeile wird verteilt und genau einmal zugestellt.
 *   4. Hörer wirft: Wiederholung mit wachsendem Abstand, nach zehn Versuchen
 *      `liegen_geblieben`; „erneut“ macht sie wieder offen, dann `erledigt`.
 *   5. Plugin in der Guild aus → `plugin_aus`, Hörer nicht gerufen.
 *   6. Personenbezogenes erreicht einen Hörer mit `*` nur, wenn er in
 *      `hoerer` steht. Hören im Bot wirft.
 *
 *   node scripts/check-ereignisbuch.js
 */
'use strict';
const path = require('path');
const WURZEL = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(WURZEL, 'apps/dashboard/.env'), quiet: true });
const mysql = require('mysql2/promise');
const { ServiceManager } = require('dunebot-core');

let rot = 0;
function pruefe(gut, text, zusatz = '') {
    if (!gut) rot++;
    console.log(`  ${gut ? '✓' : '✗'} ${text}${zusatz ? '  — ' + zusatz : ''}`);
}
async function wirft(tun, enthaelt) {
    try { await tun(); return `warf nicht`; } catch (e) { return e.message.includes(enthaelt) ? null : e.message; }
}

(async () => {
    const c = await mysql.createConnection({
        host: process.env.MYSQL_HOST, port: process.env.MYSQL_PORT,
        user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE,
    });
    const echteVorher = (await c.query("SHOW TABLES LIKE 'ereignis%'"))[0].length;

    // Migration an TEMPORARY-Tabellen.
    const migration = require(path.join(WURZEL, 'migrations/kern/20261113_200000_ereignisbuch.js'));
    await migration.up({
        query: (sql) => c.query(sql
            .replace(/CREATE TABLE IF NOT EXISTS/g, 'CREATE TEMPORARY TABLE')
            .replace(/,\s*CONSTRAINT[\s\S]*?ON DELETE CASCADE/, '')),
    });

    // Dienste wie im Prozess.
    const protokoll = [];
    ServiceManager.register('Logger', {
        info: (t) => protokoll.push(['info', t]), debug: () => {}, warn: (t) => protokoll.push(['warn', t]),
        error: (t) => protokoll.push(['error', t]), success: () => {},
    });
    ServiceManager.register('dbService', {
        async query(sql, params = []) { const [r] = await c.query(sql, params); return r; },
    });
    const AUS = new Set();
    ServiceManager.register('pluginManager', {
        async isPluginEnabledForGuild(plugin, guildId) { return !AUS.has(`${plugin}@${guildId}`); },
    });

    const { Ereignisse } = require('dunebot-sdk');
    const G = '565123525795643393';
    const zeile = async (id) => (await c.query('SELECT * FROM ereignisbuch WHERE id = ?', [id]))[0][0];
    const quittungen = async (id) => (await c.query('SELECT abnehmer, zustand, versuche, fehlertext FROM ereignis_quittungen WHERE ereignis_id = ? ORDER BY abnehmer', [id]))[0];

    console.log('\n1. Melden prüft gegen die Liste');
    pruefe(!(await wirft(() => Ereignisse.melde('kern.erfunden', { guild_id: G, schluessel: 'x' }), 'steht nicht in der Liste')), 'unbekannter Name wirft');
    pruefe(!(await wirft(() => Ereignisse.melde('ticket.geschlossen', { guild_id: G, schluessel: 'x' }), 'steht auf geplant')), 'geplantes Ereignis wirft');
    pruefe(!(await wirft(() => Ereignisse.melde('kern.ereignis.probe', { guild_id: G, schluessel: 'x', daten: { angestossen: 'gestern' } }), 'passt nicht zur Art zeit')), 'falsche Feldart wirft');
    pruefe(!(await wirft(() => Ereignisse.melde('kern.ereignis.probe', { guild_id: G, schluessel: 'x', daten: {} }), 'Feld angestossen fehlt')), 'fehlendes Pflichtfeld wirft');
    pruefe(!(await wirft(() => Ereignisse.melde('kern.ereignis.probe', { guild_id: G, schluessel: 'x', daten: { angestossen: new Date(), mehr: 1 } }), 'Feld mehr steht nicht im Eintrag')), 'fremdes Feld wirft');
    pruefe(!(await wirft(() => Ereignisse.melde('kern.ereignis.probe', { guild_id: G, schluessel: 'x', akteur: '123456789012345678', daten: { angestossen: new Date() } }), 'akteur muss `system` sein')), 'Mensch als Akteur eines Systemereignisses wirft');
    pruefe(!(await wirft(() => Ereignisse.melde('kern.ereignis.probe', { guild_id: 'abc', schluessel: '', daten: { angestossen: new Date() } }), 'guild_id fehlt')), 'ohne Guild und Schlüssel wirft');
    pruefe((await c.query('SELECT COUNT(*) n FROM ereignisbuch'))[0][0].n === 0, 'nichts davon steht im Buch');

    console.log('\n2. Aus dem Bot: Zeile steht, Anstoß über IPC');
    const angestossen = [];
    ServiceManager.register('ipcClient', {
        async sendToDashboard(event, payload, frist) { angestossen.push([event, frist]); return { success: false, error: 'IPC nicht verbunden' }; },
    });
    pruefe(!(await wirft(async () => Ereignisse.hoere('kern.ereignis.probe', 'core', async () => {}), 'nur im Dashboard')), 'Hören im Bot wirft');
    const a = await Ereignisse.melde('kern.ereignis.probe', { guild_id: G, schluessel: 'probe:a', daten: { angestossen: new Date() } });
    const a2 = await Ereignisse.melde('kern.ereignis.probe', { guild_id: G, schluessel: 'probe:a', daten: { angestossen: new Date() } });
    pruefe(a.neu === true && a2.neu === false && a.id === a2.id, 'doppelt gemeldet: dieselbe Zeile', JSON.stringify([a, a2]));
    const za = await zeile(a.id);
    pruefe(za.zustand === 'neu' && za.doppelt === 1 && za.quelle === 'kern' && za.schutz === 'allgemein', 'Zeile neu, doppelt 1, Quelle kern', `${za.zustand}/${za.doppelt}/${za.quelle}/${za.schutz}`);
    pruefe((await c.query('SELECT COUNT(*) n FROM ereignisbuch'))[0][0].n === 1, 'genau eine Zeile im Buch');
    await new Promise(r => setImmediate(r));
    pruefe(angestossen.length === 1 && angestossen[0][0] === 'core:EREIGNISSE_ANSTOSS', 'ein Anstoß, nur für die neue Zeile', JSON.stringify(angestossen));

    console.log('\n3. Zusteller startet danach (Dashboard-Neustart) und holt nach');
    ServiceManager.register('ipcServer', {});
    const gerufen = [];
    let loggingWirft = 0;
    // logging hört alles, darf aber nur Allgemeines und Freigegebenes bekommen.
    Ereignisse.hoere('*', 'logging', async (e) => {
        gerufen.push(['logging', e.id]);
        if (loggingWirft > 0) { loggingWirft--; throw new Error('Probe: logging wirft'); }
    });
    pruefe(!(await wirft(async () => Ereignisse.hoere('kern.*', 'logging', async () => {}), 'schon über')), 'zweites überlappendes Muster desselben Plugins wirft');
    pruefe(!(await wirft(async () => Ereignisse.hoere('kern.erfunden', 'clan', async () => {}), 'trifft keinen Namen')), 'Muster ohne Treffer wirft');

    const Zusteller = require(path.join(WURZEL, 'apps/dashboard/helpers/EreignisZusteller'));
    const probeVorher = protokoll.filter(p => String(p[1]).includes('Probe #')).length;
    Zusteller.starten();
    await Zusteller.lauf();
    pruefe((await zeile(a.id)).zustand === 'verteilt', 'liegende Zeile verteilt');
    const qa = await quittungen(a.id);
    pruefe(qa.length === 2 && qa.every(q => q.zustand === 'erledigt'), 'zwei Quittungen (core, logging), beide erledigt', JSON.stringify(qa));
    const probeAn = protokoll.filter(p => String(p[1]).includes(`Probe #${a.id} `));
    pruefe(probeAn.length - probeVorher === 1 && /1\. Aufruf/.test(probeAn[0]?.[1]), 'Probe-Hörer genau einmal gerufen', probeAn.map(p => p[1]).join(' | '));
    await Zusteller.lauf();
    pruefe(protokoll.filter(p => String(p[1]).includes(`Probe #${a.id} `)).length === 1 && gerufen.filter(g => g[1] === a.id).length === 1,
        'ein zweiter Lauf ruft niemanden noch einmal');

    console.log('\n4. Hörer wirft: Wiederholung, liegen geblieben, erneut');
    loggingWirft = 99;
    const b = await Ereignisse.melde('kern.ereignis.probe', { guild_id: G, schluessel: 'probe:b', daten: { angestossen: Date.now() } });
    await Zusteller.lauf();
    let qb = (await quittungen(b.id)).find(q => q.abnehmer === 'logging');
    pruefe(qb.zustand === 'offen' && qb.versuche === 1 && qb.fehlertext === 'Probe: logging wirft', 'erster Fehlversuch: offen, Versuch 1, Grund steht', JSON.stringify(qb));
    const [[fb]] = await c.query("SELECT TIMESTAMPDIFF(SECOND, NOW(3), faellig_ab) s FROM ereignis_quittungen WHERE ereignis_id = ? AND abnehmer = 'logging'", [b.id]);
    pruefe(fb.s >= 1 && fb.s <= 2, 'nächster Versuch in 2 s', `${fb.s} s`);
    await Zusteller.lauf();
    pruefe((await quittungen(b.id)).find(q => q.abnehmer === 'logging').versuche === 1, 'vor der Fälligkeit kein neuer Versuch');
    for (let i = 0; i < 12; i++) {
        await c.query("UPDATE ereignis_quittungen SET faellig_ab = NOW(3) WHERE ereignis_id = ? AND zustand = 'offen'", [b.id]);
        await Zusteller.lauf();
    }
    qb = (await quittungen(b.id)).find(q => q.abnehmer === 'logging');
    pruefe(qb.zustand === 'liegen_geblieben' && qb.versuche === Zusteller.HOECHSTVERSUCHE, `nach ${Zusteller.HOECHSTVERSUCHE} Versuchen liegen geblieben`, JSON.stringify(qb));
    pruefe((await quittungen(b.id)).find(q => q.abnehmer === 'core').zustand === 'erledigt', 'der andere Abnehmer ist davon unberührt erledigt');
    pruefe(protokoll.some(p => p[0] === 'error' && String(p[1]).includes('liegen geblieben')), 'im Log als Fehler');
    const st = await Zusteller.stand();
    pruefe(st.liegen.length === 1 && st.liegen[0].ereignis_id == b.id && st.quittungen.liegen_geblieben === 1, '/admin-Stand zeigt es', JSON.stringify(st.quittungen));
    loggingWirft = 0;
    pruefe(await Zusteller.erneut([st.liegen[0].id]) === 1, 'erneut: eine Quittung wieder offen');
    await Zusteller.lauf();
    qb = (await quittungen(b.id)).find(q => q.abnehmer === 'logging');
    pruefe(qb.zustand === 'erledigt' && qb.fehlertext === null, 'danach erledigt', JSON.stringify(qb));
    pruefe(await Zusteller.erneut([]) === 0 && await Zusteller.erneut(null) === 0, 'erneut ohne Liegengebliebenes: 0');

    console.log('\n5. Plugin in der Guild aus');
    AUS.add(`logging@${G}`);
    const vorC = gerufen.length;
    const d = await Ereignisse.melde('kern.ereignis.probe', { guild_id: G, schluessel: 'probe:d', daten: { angestossen: new Date() } });
    await Zusteller.lauf();
    const qd = await quittungen(d.id);
    pruefe(qd.find(q => q.abnehmer === 'logging').zustand === 'plugin_aus' && gerufen.length === vorC, 'logging aus: plugin_aus, Hörer nicht gerufen', JSON.stringify(qd));
    pruefe(qd.find(q => q.abnehmer === 'core').zustand === 'erledigt', 'core erledigt');

    console.log('\n6. Personenbezogenes nur mit Freigabe in `hoerer`');
    {
        // clan hört alles. Freigegeben ist es nur für einen Teil der Einträge.
        Ereignisse.hoere('*', 'clan', async () => {});
        const ohne = Ereignisse.liste.ereignisse.find(e => e.schutz !== 'allgemein' && !(e.hoerer || []).includes('clan'));
        const mit = Ereignisse.liste.ereignisse.find(e => e.schutz !== 'allgemein' && (e.hoerer || []).includes('clan'));
        pruefe(Boolean(ohne && mit), 'die Liste hat beide Fälle', `${ohne?.name} / ${mit?.name}`);
        pruefe(!Ereignisse.abnehmerFuer(ohne.name).includes('clan') && Ereignisse.hoererFuer('clan', ohne.name) === null,
            `${ohne.name} (${ohne.schutz}): clan kein Abnehmer, kein Hörer`);
        pruefe(Ereignisse.abnehmerFuer(mit.name).includes('clan') && typeof Ereignisse.hoererFuer('clan', mit.name) === 'function',
            `${mit.name}: clan freigegeben, Abnehmer`);
        pruefe(Ereignisse.abnehmerFuer('kern.ereignis.probe').includes('clan'), 'Allgemeines bekommt jeder mit passendem Hörer');
    }

    console.log('\n7. Echte Tabellen unberührt');
    pruefe((await c.query("SHOW TABLES LIKE 'ereignis%'"))[0].length === echteVorher, `SHOW TABLES zeigt ${echteVorher} echte Tabelle(n) wie vorher`);

    await c.end();
    console.log(rot ? `\n❌ ${rot} Prüfung(en) fehlgeschlagen` : '\n✅ Ereignisbuch, Quittungen und Zusteller verhalten sich wie beschrieben');
    process.exit(rot ? 1 : 0);
})().catch((e) => { console.error('\nAbbruch:', e); process.exit(1); });
