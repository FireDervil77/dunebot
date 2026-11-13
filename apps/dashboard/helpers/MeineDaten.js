'use strict';
/**
 * Meine Daten: Auskunft und Rückmeldung für die Orte (G-04c, K380).
 *
 * `Datenauskunft` zählt und löscht, je Tabelle und Spalte. Die drei Orte
 * brauchen dasselbe in lesbarer Form, je Plugin zusammengezählt:
 *
 *   Befehl `/meinedaten`   (Bot fragt per IPC `core:MEINEDATEN_*`)
 *   Seite „Meine Daten“    (`/meinedaten`, nach der Anmeldung, ohne Guild-Zugang)
 *
 * Hier wird nichts entschieden und nichts gelöscht; das tut `Datenauskunft`.
 * Diese Stelle formt nur, damit Bot und Seite dieselben Zahlen zeigen und
 * keiner der beiden eine zweite Zählweise erfindet (zwei-wege-nie-dulden).
 *
 * **Warum je Guild eine eigene Abfrage:** Was über CASCADE mitgeht (Ticket →
 * Abschrift), zählt die Auskunft nur gesamt, nicht je Guild. Wer „hier
 * löschen“ anbietet, muss sagen, was hier mitgeht. Deshalb wird für jede Guild
 * gezählt, in der das Mitglied Daten hat. Das sind beim Betreiber 4. Was
 * übrig bleibt, ist der übergreifende Teil (`rest`).
 */
const { ServiceManager } = require('dunebot-core');
const Datenauskunft = require('./Datenauskunft');

function db() { return ServiceManager.get('dbService'); }

/**
 * Einträge einer Auskunft je Plugin zusammenzählen.
 *
 * @param {Array<{plugin, eintraege}>} plugins aus `Datenauskunft.auskunft`
 * @param {(e: Object) => boolean} [nur] nur diese Einträge
 * @returns {{plugins: Object[], summe: {loeschen, anonymisieren, mitgeloescht, bleibt, ausgenommen}}}
 */
function zusammenzaehlen(plugins, nur = () => true) {
    const summe = { loeschen: 0, anonymisieren: 0, mitgeloescht: 0, bleibt: 0, ausgenommen: 0 };
    const aus = [];
    for (const p of plugins || []) {
        const z = { plugin: p.plugin, loeschen: 0, anonymisieren: 0, mitgeloescht: 0, bleibt: [], ausgenommen: [] };
        for (const e of p.eintraege.filter(nur)) {
            if (e.weg === 'loeschen' || e.weg === 'anonymisieren' || e.weg === 'mitgeloescht') {
                z[e.weg] += e.zeilen;
                summe[e.weg] += e.zeilen;
            } else if (e.weg === 'frist' || e.weg === 'ausgenommen') {
                const liste = e.weg === 'frist' ? z.bleibt : z.ausgenommen;
                liste.push({ was: `${e.tabelle}.${e.spalte}`, zeilen: e.zeilen, grund: e.grund || '', tage: e.tage ?? null });
                summe[e.weg === 'frist' ? 'bleibt' : 'ausgenommen'] += e.zeilen;
            }
        }
        if (z.loeschen || z.anonymisieren || z.mitgeloescht || z.bleibt.length || z.ausgenommen.length) aus.push(z);
    }
    return { plugins: aus, summe };
}

/** Namen der Guilds aus `guilds` (nur die, in denen der Bot ist). */
async function guildNamen(ids) {
    if (!ids.length) return {};
    const zeilen = await db().query(
        `SELECT _id, guild_name FROM guilds WHERE _id IN (${ids.map(() => '?').join(',')})`, ids);
    return Object.fromEntries(zeilen.map(z => [String(z._id), z.guild_name]));
}

/**
 * Was nach Abzug aller Guilds übrig bleibt, je Plugin: das, was nur
 * „überall löschen“ erreicht.
 *
 * Das ist mehr als die Tabellen ohne Guild-Bezug (Konto, Bewertungen). Auch
 * Tabellen mit Guild-Spalte haben Zeilen, in denen sie leer ist. Gemessen
 * 2026-11-13 beim Betreiber: `addon_marketplace.author_user_id` 15
 * (öffentliche Pakete), `user_configs` 1, `guild_toast_logs` 2. Eine Abfrage
 * je Guild sieht sie nicht, die Auskunft über alles schon. Als Rest gerechnet
 * fehlt nichts, auch nicht, was über CASCADE an solchen Zeilen mitgeht.
 *
 * @param {{plugins, summe}} gesamt zusammengezählt über alles
 * @param {Array<{plugins}>} teile zusammengezählt je Guild
 * @returns {{plugins: Object[], summe: Object}}
 */
function rest(gesamt, teile) {
    const summe = { loeschen: 0, anonymisieren: 0, mitgeloescht: 0, bleibt: 0, ausgenommen: 0 };
    const plugins = [];
    for (const g of gesamt.plugins) {
        const imTeil = teile.map(t => t.plugins.find(p => p.plugin === g.plugin)).filter(Boolean);
        const z = { plugin: g.plugin, loeschen: 0, anonymisieren: 0, mitgeloescht: 0, bleibt: [], ausgenommen: [] };
        for (const k of ['loeschen', 'anonymisieren', 'mitgeloescht']) {
            z[k] = g[k] - imTeil.reduce((n, p) => n + p[k], 0);
            summe[k] += z[k];
        }
        for (const [k, s] of [['bleibt', 'bleibt'], ['ausgenommen', 'ausgenommen']]) {
            for (const e of g[k]) {
                const n = e.zeilen - imTeil.reduce((m, p) => m + (p[k].find(x => x.was === e.was)?.zeilen || 0), 0);
                if (n) { z[k].push({ ...e, zeilen: n }); summe[s] += n; }
            }
        }
        if (z.loeschen || z.anonymisieren || z.mitgeloescht || z.bleibt.length || z.ausgenommen.length) plugins.push(z);
    }
    return { plugins, summe };
}

/**
 * Alles über ein Mitglied, je Guild und übergreifend. Beide Orte nehmen
 * diese eine Zählung: die Seite ganz, der Befehl die Guild, in der er läuft.
 *
 * @param {string} userId Discord-ID
 * @returns {Promise<{guilds: Array<{guildId, name, plugins, summe}>, uebergreifend: {plugins, summe}, summe: Object, fehler: string[]}>}
 */
async function uebersicht(userId) {
    const gesamt = await Datenauskunft.auskunft(userId);
    const namen = await guildNamen(gesamt.guilds);
    const guilds = [];
    for (const guildId of gesamt.guilds) {
        const hier = await Datenauskunft.auskunft(userId, { guildId });
        guilds.push({ guildId, name: namen[guildId] || null, ...zusammenzaehlen(hier.plugins) });
    }
    guilds.sort((a, b) => String(a.name || a.guildId).localeCompare(String(b.name || b.guildId)));
    const alles = zusammenzaehlen(gesamt.plugins);
    return { guilds, uebergreifend: rest(alles, guilds), summe: alles.summe, fehler: gesamt.fehler };
}

/**
 * Was liegt über ein Mitglied in dieser Guild, und wie viel anderswo
 * (Befehl `/mydata`). Dieselbe Zählung wie die Seite.
 *
 * @param {string} userId Discord-ID
 * @param {string} guildId die Guild, in der gefragt wurde
 * @returns {Promise<{hier: {plugins, summe}, andereGuilds: number, uebergreifend: {plugins, summe}, fehler: string[]}>}
 */
async function fuerGuild(userId, guildId) {
    const u = await uebersicht(userId);
    const hier = u.guilds.find(g => g.guildId === String(guildId));
    return {
        hier: hier ? { plugins: hier.plugins, summe: hier.summe } : zusammenzaehlen([]),
        andereGuilds: u.guilds.filter(g => g.guildId !== String(guildId)).length,
        uebergreifend: u.uebergreifend,
        fehler: u.fehler,
    };
}

/**
 * Die Rückgabe von `mitgliedLoeschen` je Plugin zusammengezählt, für die
 * Rückmeldung in Discord und auf der Seite. Plugins, bei denen nichts war,
 * fehlen; gescheiterte stehen immer drin.
 *
 * @param {Object} ergebnis Rückgabe von `Datenauskunft.mitgliedLoeschen`
 * @returns {{ok: boolean, ueberall: boolean, plugins: Array<{plugin, ok, geloescht, mitgeloescht, anonymisiert, bleibt, nurUeberall, fehler}>}}
 */
function rueckmeldung(ergebnis) {
    const summe = (o) => Object.values(o || {}).reduce((a, b) => a + b, 0);
    const plugins = [];
    for (const r of ergebnis.plugins || []) {
        const z = {
            plugin: r.plugin,
            ok: r.ok,
            geloescht: summe(r.geloescht),
            mitgeloescht: summe(r.mitgeloescht),
            anonymisiert: summe(r.anonymisiert),
            bleibt: Object.entries(r.bleibt || {}).map(([was, b]) => ({ was, zeilen: b.zeilen, grund: b.grund || '', tage: b.tage ?? null })),
            nurUeberall: (r.nurUeberall || []).length,
            fehler: r.fehler || null,
        };
        if (!z.ok || z.geloescht || z.mitgeloescht || z.anonymisiert || z.bleibt.length || z.nurUeberall) plugins.push(z);
    }
    return { ok: ergebnis.ok, ueberall: ergebnis.guildId == null, plugins };
}

module.exports = { uebersicht, fuerGuild, rueckmeldung, zusammenzaehlen, rest, guildNamen };
