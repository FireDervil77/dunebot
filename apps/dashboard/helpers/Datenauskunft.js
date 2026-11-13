'use strict';
/**
 * Datenauskunft: Was liegt über ein Mitglied, und wie geht es weg (G-04b, K380).
 *
 * Eine Stelle für drei Handlungen (konzept.md G-04):
 *
 *   auskunft(userId, { guildId, mitZeilen })   zählen je Plugin, auf Wunsch die
 *                                              Zeilen als Export
 *   mitgliedLoeschen(userId, { guildId, … })   in einer Guild oder überall
 *   guildLoeschen(guildId, { … })              alle Plugins abschalten, dann
 *                                              alle `guildInhalte`, zuletzt der Kern
 *
 * Die Orte (Befehl `/meinedaten`, Seite „Meine Daten“, „Guild löschen“) baut
 * G-04c; der Bot fragt dann per IPC hier an und meldet zurück
 * (discord-funktionen-abbilden). Hier entscheidet nichts über Rechte: Wer
 * aufruft, hat geprüft, dass es um sich selbst bzw. die eigene Guild geht.
 *
 * **Was wohin gehört, steht nicht hier**, sondern in den Erklärungen der
 * Plugins (`package.json`): `mitgliedInhalte` (G-04a, Wächter
 * `check-mitglied-inhalte.js`) und `guildInhalte` (K067, Wächter
 * `check-guild-inhalte.js`). Der Kern erklärt seine Tabellen in
 * `plugins/core/package.json`; dessen `guildInhalte.loeschen` gilt nur hier,
 * denn core lässt sich nicht abschalten.
 *
 * **Wege je Spalte** (F-G2 A):
 *   loeschen       Zeilen, die das Mitglied nennen, gehen
 *   anonymisieren  die ID wird `'0'` (steht schon als „kein Besitzer“ in
 *                  `gameservers.user_id`), `mit`-Spalten werden NULL bzw. ''
 *   frist          bleibt bis zum Ende der Aufbewahrung (G-05), die Auskunft
 *                  nennt es mit Grund
 *   ausgenommen    keine Mitglieds-Spalte; gezählt wird trotzdem, damit die
 *                  Auskunft z. B. „Besitzer von Guild X“ nicht verschweigt
 *
 * **In welcher Guild liegt eine Zeile?** Aus dem Schema abgeleitet, nicht
 * erklärt:
 *   guild      die Tabelle hat `guild_id` (bzw. `guildId`, `guilds._id`)
 *   eltern     sonst über einen Fremdschlüssel mit CASCADE auf eine Tabelle
 *              mit Guild-Spalte, die selbst mit der Guild geht (steht in
 *              einem `guildInhalte.loeschen`). Beispiel: `giveaway_entries`
 *              über `giveaways`. Mehrere solche Eltern müssen alle passen.
 *   uebergreifend  sonst. Solche Zeilen (Konto, Bewertungen öffentlicher
 *              Pakete …) gehen nur beim Löschen „überall“.
 * Warum „geht mit der Guild“ als Bedingung: `addon_marketplace.guild_id` ist
 * die Guild, die ein Paket eingestellt hat, öffentliche Pakete gehören allen
 * (steht dort unter `bleiben`). Eine Bewertung darin ist kein Inhalt jener Guild.
 *
 * **Was mitgeht.** Löscht eine Zeile, nimmt die Datenbank Kind-Zeilen über
 * `ON DELETE CASCADE` mit (Ticket → Abschrift und Bewertung, Zugang →
 * Gruppen, Kommentar → Antworten). Die Auskunft nennt sie (`mitgeloescht`),
 * der Export enthält sie (außer Antworten anderer), die Rückmeldung zählt sie.
 * Gezählt wird vor dem Löschen in derselben Transaktion.
 *
 * **Haken der Plugins** (Dashboard-Instanz, beide freiwillig):
 *   async vorMitgliedLoeschen(ctx)              vor der Transaktion, für Dinge
 *       außerhalb der Datenbank (Rolle zurücknehmen, solange das Buch noch
 *       steht). Wirft er, bleibt dieses Plugin unangetastet und die
 *       Rückmeldung nennt den Grund; die anderen laufen weiter.
 *   async nachMitgliedLoeschen(ctx, verbindung) in der Transaktion, nach dem
 *       Löschen: abgeleitete Zähler nachrechnen. Wirft er, rollt das Plugin
 *       zurück.
 *   ctx = { userId, guildId (null = überall), merk: {} }; `merk` trägt vom
 *   ersten zum zweiten Haken.
 *
 * **Probelauf** (`trocken: true`): Dieselben Anweisungen in einer Transaktion,
 * die am Ende zurückgerollt wird. Die Zahlen sind gemessen, nicht geschätzt.
 * Haken laufen dabei nicht, abschalten auch nicht.
 */
const fs = require('fs');
const path = require('path');
const { ServiceManager } = require('dunebot-core');

const PLUGINS = path.join(__dirname, '..', '..', '..', 'plugins');
const KERN = 'core';
const PLATZHALTER = '0';
const FREMD = '(anderes Mitglied)';
const SCHNEEFLOCKE = /^\d{17,20}$/;
const HOECHSTENS_ZEILEN = 5000;
const WEGE = ['loeschen', 'anonymisieren', 'frist', 'ausgenommen'];

/** Rollback am Ende eines Probelaufs, kein Fehler. */
class Probelauf extends Error {
    constructor(ergebnis) { super('Probelauf'); this.ergebnis = ergebnis; }
}

function db() { return ServiceManager.get('dbService'); }
function log() { return ServiceManager.get('Logger'); }

function pruefeId(id, was) {
    if (!SCHNEEFLOCKE.test(String(id ?? ''))) throw new Error(`Datenauskunft: ungültige ${was} „${id}“`);
    return String(id);
}

/** Normalform eines Eintrags aus `mitgliedInhalte`. */
function form(wert) {
    return typeof wert === 'string' ? { weg: wert, mit: [], grund: '' }
        : { weg: wert?.weg, mit: wert?.mit ?? [], grund: wert?.grund ?? '' };
}

/** package.json aller Plugins, frisch gelesen (ein neues Plugin zählt sofort). */
function erklaerungen() {
    const aus = {};
    for (const p of fs.readdirSync(PLUGINS)) {
        const datei = path.join(PLUGINS, p, 'package.json');
        if (fs.existsSync(datei)) aus[p] = JSON.parse(fs.readFileSync(datei, 'utf8'));
    }
    return aus;
}

const q = (name) => `\`${name}\``;

/**
 * Hat das Plugin einen Haken? Aus dem Quelltext, nicht aus der Instanz: Ein
 * Plugin, das in keiner Guild an ist, ist nicht geladen. Hat es trotzdem
 * Zeilen und einen Haken, darf sein Teil nicht ohne ihn laufen.
 */
function hatHaken(plugin) {
    const datei = path.join(PLUGINS, plugin, 'dashboard', 'index.js');
    if (!fs.existsSync(datei)) return false;
    return /\basync\s+(vor|nach)MitgliedLoeschen\s*\(/.test(fs.readFileSync(datei, 'utf8'));
}

/**
 * Der Plan: je Plugin seine Tabellen mit Spalten, Wegen und Bereich.
 * `fehler` nennt, was sich nicht ableiten lässt (prüft der Wächter).
 *
 * @returns {Promise<{plugins: Array, fehler: string[]}>}
 */
async function plan() {
    const meta = erklaerungen();
    const mitDerGuild = new Set();
    for (const m of Object.values(meta)) for (const t of m.guildInhalte?.loeschen || []) mitDerGuild.add(t);

    const spaltenDb = await db().query(
        'SELECT TABLE_NAME AS t, COLUMN_NAME AS s, IS_NULLABLE AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()');
    const spalten = {};
    for (const { t, s, n } of spaltenDb) (spalten[t] ||= {})[s] = { nullbar: n === 'YES' };
    const fk = await db().query(`
        SELECT k.TABLE_NAME AS kind, k.COLUMN_NAME AS spalte, k.REFERENCED_TABLE_NAME AS eltern,
               k.REFERENCED_COLUMN_NAME AS elternSpalte, k.CONSTRAINT_NAME AS name, r.DELETE_RULE AS regel
          FROM information_schema.KEY_COLUMN_USAGE k
          JOIN information_schema.REFERENTIAL_CONSTRAINTS r
               ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
         WHERE k.TABLE_SCHEMA = DATABASE() AND k.REFERENCED_TABLE_NAME IS NOT NULL`);
    const guildSpalte = await db().guildSpalten(Object.keys(spalten));

    const fehler = [];
    const bereichVon = (t) => {
        if (guildSpalte[t]) return { art: 'guild', spalte: guildSpalte[t] };
        const kandidaten = fk.filter(f => f.kind === t && f.regel === 'CASCADE' && f.eltern !== t
            && guildSpalte[f.eltern] && mitDerGuild.has(f.eltern));
        const mehrspaltig = kandidaten.filter(f => fk.filter(g => g.kind === t && g.name === f.name).length > 1);
        if (mehrspaltig.length) fehler.push(`${t}: Fremdschlüssel ${mehrspaltig[0].name} hat mehrere Spalten, Bereich nicht ableitbar`);
        if (kandidaten.length) {
            return { art: 'eltern', ueber: kandidaten.map(f => ({
                spalte: f.spalte, eltern: f.eltern, elternSpalte: f.elternSpalte, guildSpalte: guildSpalte[f.eltern],
            })) };
        }
        return { art: 'uebergreifend' };
    };

    // Kind-Tabellen mit CASCADE, bis zu drei Ebenen; Selbstbezug (Antworten) eigens.
    const selbstVon = (t) => {
        const f = fk.find(x => x.kind === t && x.eltern === t && x.regel === 'CASCADE');
        return f ? { spalte: f.spalte, elternSpalte: f.elternSpalte } : null;
    };
    const kinderVon = (t, tiefe = 0, gesehen = new Set([t])) => fk
        .filter(f => f.eltern === t && f.kind !== t && f.regel === 'CASCADE' && !gesehen.has(f.kind))
        .map(f => ({
            tabelle: f.kind, spalte: f.spalte, elternSpalte: f.elternSpalte,
            kinder: tiefe < 2 ? kinderVon(f.kind, tiefe + 1, new Set([...gesehen, f.kind])) : [],
        }));

    const plugins = [];
    for (const [plugin, m] of Object.entries(meta)) {
        const tabellen = [];
        for (const [t, erklaert] of Object.entries(m.mitgliedInhalte || {})) {
            if (!spalten[t]) { fehler.push(`${plugin}: ${t} gibt es nicht (Migration offen?)`); continue; }
            const eintraege = [];
            for (const [s, wert] of Object.entries(erklaert)) {
                const f = form(wert);
                if (!WEGE.includes(f.weg)) { fehler.push(`${plugin}: ${t}.${s} Weg „${f.weg}“`); continue; }
                if (!spalten[t][s]) { fehler.push(`${plugin}: ${t}.${s} gibt es nicht`); continue; }
                eintraege.push({
                    spalte: s, weg: f.weg, grund: f.grund,
                    mit: f.mit.map(n => ({ spalte: n, leer: spalten[t][n]?.nullbar ? null : '' })),
                });
            }
            tabellen.push({ tabelle: t, spalten: eintraege, bereich: bereichVon(t), kinder: kinderVon(t), selbst: selbstVon(t) });
        }
        plugins.push({ plugin, tabellen });
    }
    // Der Kern zuletzt: Er löscht das Konto (`users`) und beendet Sitzungen.
    plugins.sort((a, b) => (a.plugin === KERN) - (b.plugin === KERN) || a.plugin.localeCompare(b.plugin));
    return { plugins, fehler };
}

/**
 * WHERE-Teil „Spalte nennt das Mitglied, Zeile liegt in der Guild“.
 * `null`, wenn die Tabelle übergreifend ist und eine Guild verlangt wird.
 */
function bedingung(tab, spalte, userId, guildId, alias = '') {
    const a = alias ? `${alias}.` : '';
    const teile = [`${a}${q(spalte)} = ?`];
    const werte = [userId];
    if (guildId) {
        const b = tab.bereich;
        if (b.art === 'uebergreifend') return null;
        if (b.art === 'guild') { teile.push(`${a}${q(b.spalte)} = ?`); werte.push(guildId); }
        else for (const e of b.ueber) {
            teile.push(`${a}${q(e.spalte)} IN (SELECT ${q(e.elternSpalte)} FROM ${q(e.eltern)} WHERE ${q(e.guildSpalte)} = ?)`);
            werte.push(guildId);
        }
    }
    return { sql: teile.join(' AND '), werte };
}

/** Ausdruck für die Guild einer Zeile (Alias `z`), für „in welchen Guilds“. */
function guildAusdruck(tab) {
    const b = tab.bereich;
    if (b.art === 'guild') return `z.${q(b.spalte)}`;
    if (b.art === 'eltern') {
        const e = b.ueber[0];
        return `(SELECT p.${q(e.guildSpalte)} FROM ${q(e.eltern)} p WHERE p.${q(e.elternSpalte)} = z.${q(e.spalte)} LIMIT 1)`;
    }
    return 'NULL';
}

/**
 * Was beim Löschen der Zeilen `wo` über CASCADE mitgeht.
 * `frage(sql, werte)` liefert Zeilen (Pool oder Verbindung der Transaktion).
 *
 * @returns {Promise<Array<{tabelle, ueber, zeilen, wo, werte, antworten?}>>}
 */
async function mitgehend(frage, tab, wo) {
    const aus = [];
    if (tab.selbst) {
        const { spalte, elternSpalte } = tab.selbst;
        const [{ n }] = await frage(`
            WITH RECURSIVE baum AS (
                SELECT ${q(elternSpalte)} AS k FROM ${q(tab.tabelle)} WHERE ${wo.sql}
                UNION
                SELECT c.${q(elternSpalte)} FROM ${q(tab.tabelle)} c JOIN baum b ON c.${q(spalte)} = b.k
            )
            SELECT COUNT(*) AS n FROM baum WHERE k NOT IN (SELECT ${q(elternSpalte)} FROM ${q(tab.tabelle)} WHERE ${wo.sql})`,
        [...wo.werte, ...wo.werte]);
        if (Number(n)) aus.push({ tabelle: tab.tabelle, ueber: tab.tabelle, zeilen: Number(n), antworten: true });
    }
    const geh = async (kinder, eltern, elternWo) => {
        for (const k of kinder) {
            const sql = `${q(k.spalte)} IN (SELECT ${q(k.elternSpalte)} FROM ${q(eltern)} WHERE ${elternWo})`;
            const [{ n }] = await frage(`SELECT COUNT(*) AS n FROM ${q(k.tabelle)} WHERE ${sql}`, wo.werte);
            if (!Number(n)) continue;
            aus.push({ tabelle: k.tabelle, ueber: eltern, zeilen: Number(n), wo: sql, werte: wo.werte });
            await geh(k.kinder, k.tabelle, sql);
        }
    };
    await geh(tab.kinder, tab.tabelle, wo.sql);
    return aus;
}

/** Zeile für den Export: fremde Mitglieder und ihre Namen geschwärzt, Binäres als Größe. */
function schwaerzen(zeile, tab, userId) {
    const aus = {};
    for (const [k, v] of Object.entries(zeile)) aus[k] = Buffer.isBuffer(v) ? `(${v.length} Bytes binär)` : v;
    for (const e of tab.spalten) {
        if (e.weg === 'ausgenommen') continue;
        const wert = zeile[e.spalte];
        if (wert == null || String(wert) === userId || String(wert) === PLATZHALTER) continue;
        aus[e.spalte] = FREMD;
        for (const m of e.mit) if (aus[m.spalte] != null) aus[m.spalte] = FREMD;
    }
    return aus;
}

/**
 * Auskunft: Was liegt über das Mitglied?
 *
 * @param {string} userId Discord-ID
 * @param {Object} [optionen]
 * @param {string|null} [optionen.guildId] nur diese Guild; ohne: alle, mit Aufteilung je Guild
 * @param {boolean} [optionen.mitZeilen] die Zeilen selbst (Export), fremde Mitglieder geschwärzt
 * @returns {Promise<Object>} `{ userId, guildId, plugins: [{ plugin, eintraege: [...] , zeilen? }], guilds, summe, fehler }`
 */
async function auskunft(userId, { guildId = null, mitZeilen = false } = {}) {
    userId = pruefeId(userId, 'Mitglieds-ID');
    if (guildId != null) guildId = pruefeId(guildId, 'Guild-ID');
    const { plugins, fehler } = await plan();
    const summe = { ...Object.fromEntries(WEGE.map(w => [w, 0])), mitgeloescht: 0 };
    const tabVon = new Map(plugins.flatMap(p => p.tabellen.map(t => [t.tabelle, t])));
    const guilds = new Set();
    const aus = [];

    for (const p of plugins) {
        const eintraege = [];
        const zeilen = {};
        for (const tab of p.tabellen) {
            for (const e of tab.spalten) {
                const wo = bedingung(tab, e.spalte, userId, guildId);
                if (!wo) continue;
                const jeGuild = await db().query(
                    `SELECT ${guildAusdruck(tab)} AS g, COUNT(*) AS n FROM ${q(tab.tabelle)} z WHERE ${wo.sql} GROUP BY g`, wo.werte);
                const n = jeGuild.reduce((s, r) => s + Number(r.n), 0);
                if (!n) continue;
                const verteilt = {};
                for (const r of jeGuild) {
                    const g = r.g == null ? 'uebergreifend' : String(r.g);
                    verteilt[g] = Number(r.n);
                    if (g !== 'uebergreifend') guilds.add(g);
                }
                eintraege.push({
                    tabelle: tab.tabelle, spalte: e.spalte, weg: e.weg, grund: e.grund || undefined,
                    bereich: tab.bereich.art, zeilen: n, jeGuild: verteilt,
                });
                summe[e.weg] += n;
                if (e.weg !== 'loeschen') continue;
                for (const m of await mitgehend((sql, w) => db().query(sql, w), tab, wo)) {
                    eintraege.push({
                        tabelle: m.tabelle, spalte: null, weg: 'mitgeloescht', ueber: `${tab.tabelle}.${e.spalte}`,
                        antworten: m.antworten || undefined, bereich: tab.bereich.art, zeilen: m.zeilen,
                    });
                    summe.mitgeloescht += m.zeilen;
                    if (!mitZeilen || m.antworten) continue;
                    const rows = await db().query(`SELECT * FROM ${q(m.tabelle)} WHERE ${m.wo} LIMIT ${HOECHSTENS_ZEILEN + 1}`, m.werte);
                    const kindTab = tabVon.get(m.tabelle) || { spalten: [] };
                    zeilen[`${m.tabelle} (über ${tab.tabelle})`] = {
                        gekuerzt: rows.length > HOECHSTENS_ZEILEN,
                        zeilen: rows.slice(0, HOECHSTENS_ZEILEN).map(r => schwaerzen(r, kindTab, userId)),
                    };
                }
            }
            if (mitZeilen) {
                const teile = tab.spalten.map(e => bedingung(tab, e.spalte, userId, guildId)).filter(Boolean);
                if (!teile.length) continue;
                const rows = await db().query(
                    `SELECT * FROM ${q(tab.tabelle)} WHERE ${teile.map(t => `(${t.sql})`).join(' OR ')} LIMIT ${HOECHSTENS_ZEILEN + 1}`,
                    teile.flatMap(t => t.werte));
                if (!rows.length) continue;
                zeilen[tab.tabelle] = {
                    gekuerzt: rows.length > HOECHSTENS_ZEILEN,
                    zeilen: rows.slice(0, HOECHSTENS_ZEILEN).map(r => schwaerzen(r, tab, userId)),
                };
            }
        }
        if (eintraege.length || Object.keys(zeilen).length) aus.push({ plugin: p.plugin, eintraege, ...(mitZeilen ? { zeilen } : {}) });
    }
    return { userId, guildId, erstellt: new Date().toISOString(), plugins: aus, guilds: [...guilds], summe, fehler };
}

/** Transaktion; bei `trocken` am Ende zurückgerollt, das Ergebnis kommt trotzdem. */
async function inTransaktion(trocken, tun) {
    try {
        return await db().transaction(async (v) => {
            const ergebnis = await tun(v);
            if (trocken) throw new Probelauf(ergebnis);
            return ergebnis;
        });
    } catch (e) {
        if (e instanceof Probelauf) return e.ergebnis;
        throw e;
    }
}

/**
 * Ein Mitglied löschen, in einer Guild oder überall.
 *
 * Je Plugin eine Transaktion und eine Rückmeldung: `{ plugin, ok, geloescht:
 * {tabelle: n}, mitgeloescht: {tabelle: n} (CASCADE), anonymisiert: {'tabelle.spalte': n}, bleibt: {'tabelle.spalte':
 * {zeilen, grund}}, nurUeberall: [...], fehler }`. Scheitert ein Plugin,
 * laufen die anderen weiter; die Rückmeldung sagt, welches.
 *
 * @param {string} userId Discord-ID
 * @param {Object} [optionen]
 * @param {string|null} [optionen.guildId] nur in dieser Guild; null = überall (dann auch Konto und Sitzungen)
 * @param {boolean} [optionen.trocken] Probelauf mit Rollback, ohne Haken
 * @param {string} [optionen.anlass] für das Log (z. B. „/meinedaten“)
 * @returns {Promise<{userId, guildId, trocken, ok, plugins: Object[]}>}
 */
async function mitgliedLoeschen(userId, { guildId = null, trocken = false, anlass = 'unbekannt' } = {}) {
    userId = pruefeId(userId, 'Mitglieds-ID');
    if (guildId != null) guildId = pruefeId(guildId, 'Guild-ID');
    const pm = ServiceManager.has('pluginManager') ? ServiceManager.get('pluginManager') : null;
    if (!trocken && !pm) throw new Error('Datenauskunft: PluginManager fehlt, die Haken der Plugins wären übergangen');
    const { plugins } = await plan();
    const ergebnisse = [];

    for (const p of plugins) {
        const r = { plugin: p.plugin, ok: true, geloescht: {}, mitgeloescht: {}, anonymisiert: {}, bleibt: {}, nurUeberall: [], fehler: null };
        ergebnisse.push(r);

        // Was gibt es zu tun? Ohne Zeilen keine Haken (kein IPC für nichts).
        let zuTun = 0;
        for (const tab of p.tabellen) {
            for (const e of tab.spalten) {
                if (e.weg === 'ausgenommen') continue;
                const wo = bedingung(tab, e.spalte, userId, guildId);
                if (!wo) {
                    const [{ n }] = await db().query(`SELECT COUNT(*) AS n FROM ${q(tab.tabelle)} WHERE ${q(e.spalte)} = ?`, [userId]);
                    if (Number(n)) r.nurUeberall.push(`${tab.tabelle}.${e.spalte}`);
                    continue;
                }
                // Zeilen mit leerer Guild-Spalte (öffentliche Pakete, eigene
                // Einstellungen) erreicht nur „überall“; die Rückmeldung nennt sie.
                if (guildId != null) {
                    const [{ n: ohne }] = await db().query(
                        `SELECT COUNT(*) AS n FROM ${q(tab.tabelle)} z WHERE z.${q(e.spalte)} = ? AND ${guildAusdruck(tab)} IS NULL`, [userId]);
                    if (Number(ohne)) r.nurUeberall.push(`${tab.tabelle}.${e.spalte}`);
                }
                const [{ n }] = await db().query(`SELECT COUNT(*) AS n FROM ${q(tab.tabelle)} WHERE ${wo.sql}`, wo.werte);
                if (!Number(n)) continue;
                if (e.weg === 'frist') r.bleibt[`${tab.tabelle}.${e.spalte}`] = { zeilen: Number(n), grund: e.grund };
                else zuTun += Number(n);
            }
        }
        const sitzungen = p.plugin === KERN && guildId == null;
        if (!zuTun && !sitzungen) continue;

        const inst = pm?.getPlugin(p.plugin);
        if (!trocken && !inst && hatHaken(p.plugin)) {
            r.ok = false;
            r.fehler = 'Plugin nicht geladen, sein Haken wäre übergangen';
            continue;
        }
        const ctx = { userId, guildId, merk: {} };
        if (!trocken && typeof inst?.vorMitgliedLoeschen === 'function') {
            try { await inst.vorMitgliedLoeschen(ctx); }
            catch (e) { r.ok = false; r.fehler = `vorher: ${e.message}`; continue; }
        }

        try {
            await inTransaktion(trocken, async (v) => {
                for (const tab of p.tabellen) {
                    // Erst löschen, dann anonymisieren: Eine Zeile, die geht,
                    // braucht keinen Platzhalter mehr.
                    for (const e of tab.spalten.filter(x => x.weg === 'loeschen')) {
                        const wo = bedingung(tab, e.spalte, userId, guildId);
                        if (!wo) continue;
                        for (const m of await mitgehend(async (sql, w) => (await v.query(sql, w))[0], tab, wo)) {
                            r.mitgeloescht[m.tabelle] = (r.mitgeloescht[m.tabelle] || 0) + m.zeilen;
                        }
                        const [erg] = await v.query(`DELETE FROM ${q(tab.tabelle)} WHERE ${wo.sql}`, wo.werte);
                        if (erg.affectedRows) r.geloescht[tab.tabelle] = (r.geloescht[tab.tabelle] || 0) + erg.affectedRows;
                    }
                    for (const e of tab.spalten.filter(x => x.weg === 'anonymisieren')) {
                        const wo = bedingung(tab, e.spalte, userId, guildId);
                        if (!wo) continue;
                        const setze = [`${q(e.spalte)} = ?`, ...e.mit.map(m => `${q(m.spalte)} = ?`)];
                        const [erg] = await v.query(`UPDATE ${q(tab.tabelle)} SET ${setze.join(', ')} WHERE ${wo.sql}`,
                            [PLATZHALTER, ...e.mit.map(m => m.leer), ...wo.werte]);
                        if (erg.affectedRows) r.anonymisiert[`${tab.tabelle}.${e.spalte}`] = erg.affectedRows;
                    }
                }
                // Sitzungen haben keine Mitglieds-Spalte, die ID steckt im JSON
                // (`sessions.data`, 14 Tage). Nur „überall“: Dann geht auch das Konto.
                if (sitzungen) {
                    const [erg] = await v.query(
                        "DELETE FROM sessions WHERE JSON_VALUE(data, '$.user.info.id') = ?", [userId]);
                    if (erg.affectedRows) r.geloescht.sessions = erg.affectedRows;
                }
                if (!trocken && typeof inst?.nachMitgliedLoeschen === 'function') await inst.nachMitgliedLoeschen(ctx, v);
            });
        } catch (e) {
            r.ok = false;
            r.fehler = e.message;
            r.geloescht = {};
            r.mitgeloescht = {};
            r.anonymisiert = {};
        }
    }

    const ok = ergebnisse.every(r => r.ok);
    if (!trocken) {
        const kurz = ergebnisse.filter(r => !r.ok || Object.keys(r.geloescht).length || Object.keys(r.anonymisiert).length)
            .map(r => r.ok
                ? `${r.plugin} (${Object.values(r.geloescht).reduce((a, b) => a + b, 0)} gelöscht, ${Object.values(r.anonymisiert).reduce((a, b) => a + b, 0)} anonymisiert)`
                : `${r.plugin} GESCHEITERT: ${r.fehler}`).join(', ');
        log()[ok ? 'info' : 'error'](`[Datenauskunft] Mitglied ${userId} ${guildId ? `in Guild ${guildId}` : 'überall'} gelöscht (${anlass}): ${kurz || 'nichts gespeichert'}`);
    }
    return { userId, guildId, trocken, ok, plugins: ergebnisse };
}

/**
 * Eine Guild löschen: alle eingeschalteten Plugins über ihren eigenen Weg
 * abschalten (`disableInGuild`: `onGuildDisable` stoppt etwa Gameserver,
 * dann die Zeilen, Rechte, Navigation), danach die `guildInhalte` aller
 * Plugins (auch abgeschalteter, falls Reste da sind) und zuletzt die des Kerns
 * samt der Zeile in `guilds`.
 *
 * Scheitert das Abschalten eines Plugins, wird abgebrochen und nichts weiter
 * gelöscht: Sonst nähme der Kern über `guilds` (CASCADE) etwa die
 * Gameserver-Zeilen mit, deren Container noch laufen (K381).
 *
 * Die Kontroll-Guild wird abgewiesen: Ihr gehören die Rootserver
 * (gemessen 2026-11-13: beide) und die Inhalte bleiben dort beim Abschalten.
 *
 * Der Bot verlässt die Guild hier nicht. Wer das hier aufruft, sorgt dafür
 * (G-04c „Guild löschen“, G-04d Verlassen). Bleibt der Bot, legt der nächste
 * Start die Guild neu an, leer.
 *
 * @param {string} guildId Discord-Guild-ID
 * @param {Object} [optionen]
 * @param {boolean} [optionen.trocken] Probelauf: nicht abschalten, Zeilen zählen mit Rollback
 * @param {{userId?: string, userName?: string}} [optionen.wer] wer es ausgelöst hat
 * @param {string} [optionen.anlass] für das Log
 * @returns {Promise<{guildId, trocken, ok, abgeschaltet: Object[], geloescht: Object, fehler: string|null}>}
 */
async function guildLoeschen(guildId, { trocken = false, wer = {}, anlass = 'unbekannt' } = {}) {
    if (!/^\d+$/.test(String(guildId ?? ''))) throw new Error(`Datenauskunft: ungültige Guild-ID „${guildId}“`);
    guildId = String(guildId);
    if (guildId === String(process.env.CONTROL_GUILD_ID)) throw new Error('Datenauskunft: Die Kontroll-Guild wird nicht gelöscht');
    const pm = ServiceManager.has('pluginManager') ? ServiceManager.get('pluginManager') : null;
    if (!trocken && !pm) throw new Error('Datenauskunft: PluginManager fehlt, Plugins ließen sich nicht abschalten');
    const meta = erklaerungen();
    const aus = { guildId, trocken, ok: true, abgeschaltet: [], geloescht: {}, fehler: null };

    if (!trocken) {
        // masterserver lässt sich nicht abschalten, solange gameserver an ist
        // (PluginManager.disableInGuild) — also zuletzt.
        const an = (await db().getEnabledPlugins(guildId)).filter(p => p !== KERN)
            .sort((a, b) => (a === 'masterserver') - (b === 'masterserver'));
        for (const p of an) {
            try {
                const erg = await pm.disableInGuild(p, guildId, { userId: wer.userId || null, userName: wer.userName || null });
                aus.abgeschaltet.push({ plugin: p, ok: true, hinweis: erg === true ? undefined : 'nicht geladen, nur die Zeilen gehen' });
            } catch (e) {
                aus.abgeschaltet.push({ plugin: p, ok: false, fehler: e.message });
                aus.ok = false;
                aus.fehler = `${p}: ${e.message}`;
                log().error(`[Datenauskunft] Guild ${guildId} löschen abgebrochen (${anlass}): ${p} ließ sich nicht abschalten`, e);
                return aus;
            }
        }
    }

    const reihe = [...Object.keys(meta).filter(p => p !== KERN).sort(), KERN];
    try {
        aus.geloescht = await inTransaktion(trocken, async (v) => {
            const geloescht = {};
            for (const p of reihe) {
                const tabellen = meta[p].guildInhalte?.loeschen || [];
                if (!tabellen.length) continue;
                const n = await db().loescheGuildZeilen(tabellen, guildId, { verbindung: v });
                const mit = Object.fromEntries(Object.entries(n).filter(([, z]) => z > 0));
                if (Object.keys(mit).length) geloescht[p] = mit;
            }
            return geloescht;
        });
    } catch (e) {
        aus.ok = false;
        aus.fehler = e.message;
        if (!trocken) log().error(`[Datenauskunft] Guild ${guildId}: Zeilen löschen gescheitert (${anlass}), nichts gelöscht`, e);
        return aus;
    }
    if (!trocken) {
        const kurz = Object.entries(aus.geloescht).map(([p, t]) => `${p} ${Object.values(t).reduce((a, b) => a + b, 0)}`).join(', ');
        log().info(`[Datenauskunft] Guild ${guildId} gelöscht (${anlass}): ${aus.abgeschaltet.length} Plugin(s) abgeschaltet, Zeilen: ${kurz || 'keine'}`);
    }
    return aus;
}

module.exports = { plan, auskunft, mitgliedLoeschen, guildLoeschen, PLATZHALTER, FREMD, _intern: { bedingung, schwaerzen, form, hatHaken, mitgehend } };
