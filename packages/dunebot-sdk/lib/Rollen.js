'use strict';

/**
 * Rollenvergabe mit Besitzer (G-07, F-G12, K382, 2026-11-14).
 *
 * Jede Rolle, die ein System des Bots einem Mitglied gibt, steht mit ihrem
 * Besitzer im Buch `rollen_vergaben` (ein Eintrag je Besitzer). Nur hier wird
 * in Discord eine Rolle gegeben oder genommen (Wächter check-rollenvergabe).
 *
 *     const { Rollen } = require('dunebot-sdk');
 *     await Rollen.vergib({ mitglied, rollen: ['123'], besitzer: 'greeting:autorolle' });
 *     await Rollen.nimm({ guildId, userId, rollen: '123', besitzer: 'streaming:live', grund: 'Stream beendet' });
 *
 * Im Dashboard gilt eine Frist von 15 s, `frist_ms` im Auftrag ändert sie.
 *     await Rollen.gibAb({ mitglied, rollen, besitzer: 'discord:rollenmenue' });
 *
 * # Regeln
 *
 *   Regel 1  `nimm` wirkt nur mit eigenem Eintrag. In Discord geht die Rolle
 *            nur weg, wenn kein anderer Besitzer sie noch hält.
 *   Regel 2  Hat das Mitglied die Rolle schon und hält sie kein Besitzer, wird
 *            nichts gebucht: Sie gehört dem, der sie gab (Hand, anderer Bot).
 *            Hält sie schon ein anderer Besitzer, bucht `vergib` den eigenen
 *            Eintrag dazu (behebt K391).
 *   gibAb    Was das Mitglied selbst bedient (Rollenmenü, Verifizierung):
 *            ohne Eintrag erlaubt, solange kein anderer Besitzer hält; sonst
 *            bleibt die Rolle und `gehalten` nennt die Besitzer (F-G12 Punkt 2).
 *
 * Das Buch folgt Discord (F-G12 Punkt 3): Kern-Ereignisse des Bots
 * (`guildMemberUpdate`, `guildMemberRemove`, `roleDelete`) und der tägliche
 * Abgleich `core:rollen-abgleich` löschen Einträge zu Rollen, die das Mitglied
 * nicht mehr trägt.
 *
 * # Ein Aufruf je Rolle, nacheinander je Mitglied
 *
 * `member.roles.add([…])` schickt in discord.js 14.28.1 die GANZE Rollenliste
 * (PATCH), berechnet aus dem Zwischenspeicher, und den macht erst das
 * Gateway-Ereignis aktuell. Zwei Listenaufrufe kurz nacheinander (Rollenmenü:
 * hinzufügen, dann entfernen) können so die eben gegebene Rolle wieder
 * wegnehmen. Hier geht jede Rolle als eigener PUT/DELETE (atomar bei Discord),
 * und Aufträge für dasselbe Mitglied laufen in diesem Prozess nacheinander.
 * Geändert wird nur, was sich ändern muss; bei einem Klick ist das fast immer
 * eine Rolle.
 *
 * # Wo es läuft
 *
 * Im Bot direkt (mit `mitglied`, oder `guild` + `userId`, oder `guildId` +
 * `userId`). Im Dashboard geht der Auftrag über IPC `dashboard:ROLLEN` an den
 * Bot, der die Guild hat (`apps/bot/ipc/ROLLEN.js`); geschrieben wird das Buch
 * also nur im Bot. Lesen (`vergebene`, `besitzerVon`) geht überall.
 *
 * # Ergebnis
 *
 *     { vergeben, entzogen, gebucht, blockiert, gehalten, unveraendert,
 *       kein_mitglied, fehler, code }
 *
 *   vergeben/entzogen  in Discord geändert (Rollen-IDs)
 *   gebucht            nur das Buch, Discord stimmte schon (anderer Besitzer)
 *   blockiert          [{ rolle, name, grund }], Gründe in GRUND
 *   gehalten           [{ rolle, name, von: [besitzer] }], bleibt wegen anderer
 *   unveraendert       [{ rolle, hinweis }], Hinweise in HINWEIS
 *   kein_mitglied      das Mitglied ist nicht (mehr) auf dem Server
 *   fehler/code        der ganze Auftrag ging nicht (Guild fehlt, IPC)
 *
 * Wächter: scripts/check-rollenvergabe.js
 *
 * @module dunebot-sdk/lib/Rollen
 */

const fs = require('fs');
const path = require('path');

const WURZEL = path.join(__dirname, '..', '..', '..');
const PLUGINS = path.join(WURZEL, 'plugins');
const DATEI = 'shared/rollen.js';

/** Warum eine Rolle nicht gesetzt werden konnte. */
const GRUND = Object.freeze({
    KEIN_RECHT: 'KEIN_RECHT',
    ZU_HOCH: 'ZU_HOCH',
    VERWALTET: 'VERWALTET',
    WEG: 'WEG',
    FEHLER: 'FEHLER'
});

/** Warum sich nichts geändert hat, obwohl alles stimmt. */
const HINWEIS = Object.freeze({
    HAT_SCHON: 'HAT_SCHON',          // trägt sie, kein Besitzer: nicht unsere (Regel 2)
    SCHON_GEBUCHT: 'SCHON_GEBUCHT',  // dieser Besitzer hat schon einen Eintrag
    HAT_NICHT: 'HAT_NICHT',          // abgeben/nehmen, trägt sie aber nicht
    KEIN_EINTRAG: 'KEIN_EINTRAG'     // nimm ohne eigenen Eintrag (Regel 1)
});

const BESITZER = /^[a-z0-9_-]{1,32}:[a-z0-9_-]{1,40}$/;
const ID = /^\d{5,32}$/;
const ARTEN = Object.freeze(['vergib', 'nimm', 'gibAb']);
/** So lange wartet das Dashboard auf den Bot. */
const FRIST_MS = 15_000;

function sm() {
    return require('dunebot-core').ServiceManager;
}
function db() {
    return sm().get('dbService');
}
function log() {
    return sm().has('Logger') ? sm().get('Logger') : console;
}
function imBot() {
    return sm().has('client');
}

function leer() {
    return { vergeben: [], entzogen: [], gebucht: [], blockiert: [], gehalten: [], unveraendert: [], kein_mitglied: false, fehler: null, code: null };
}

/** Rollen-IDs aus einer ID, einer Liste oder Rollen-Objekten, ohne Doppelte. */
function ids(rollen) {
    const liste = Array.isArray(rollen) ? rollen : (rollen == null ? [] : [rollen]);
    return [...new Set(liste.map((r) => String(r?.id ?? r ?? '').trim()).filter((r) => ID.test(r)))];
}

function pruefeBesitzer(besitzer) {
    if (!BESITZER.test(String(besitzer || ''))) {
        throw new Error(`Rollen: Besitzer "${besitzer}" ungültig (plugin:zweck, klein)`);
    }
}

/**
 * Darf der Bot diese Rolle anfassen? (aus discord/bot/rollenmenue/anwenden.js)
 *
 * Vier Wege, auf denen Discord Nein sagt, und alle scheitern von sich aus
 * stumm: Recht fehlt, Rolle steht über der höchsten des Bots (häufigste
 * Ursache, tritt oft erst später auf, wenn jemand die Bot-Rolle verschiebt),
 * Rolle wird von einer Integration verwaltet (Bot-, Booster-Rollen), Rolle
 * gibt es nicht mehr.
 *
 * @param {import('discord.js').Guild} guild
 * @param {string} rolleId
 * @returns {{rolle: import('discord.js').Role|null, grund: string|null}}
 */
function pruefe(guild, rolleId) {
    const ich = guild?.members?.me;
    const { PermissionFlagsBits } = require('discord.js');
    if (!ich?.permissions?.has(PermissionFlagsBits.ManageRoles)) return { rolle: guild?.roles?.cache?.get(rolleId) || null, grund: GRUND.KEIN_RECHT };
    const rolle = guild.roles.cache.get(rolleId);
    if (!rolle) return { rolle: null, grund: GRUND.WEG };
    if (rolle.managed) return { rolle, grund: GRUND.VERWALTET };
    // `comparePositionTo` statt `position`: bei gleicher Position entscheidet
    // das Alter der Rolle, ein roher Zahlenvergleich liegt dort falsch.
    if (ich.roles.highest.comparePositionTo(rolle) <= 0) return { rolle, grund: GRUND.ZU_HOCH };
    return { rolle, grund: null };
}

// ── Buch ────────────────────────────────────────────────────────────────

/**
 * Einträge lesen.
 *
 * @param {string} guildId
 * @param {{rolleId?: string, besitzer?: string|string[], mitgliedId?: string}} [filter]
 * @returns {Promise<Array<{mitglied_id: string, rolle_id: string, besitzer: string, bezug: string|null, seit: Date}>>}
 */
async function eintraege(guildId, { rolleId, besitzer, mitgliedId } = {}) {
    const wo = [];
    const werte = [];
    if (guildId != null) { wo.push('guild_id = ?'); werte.push(String(guildId)); }
    if (rolleId) { wo.push('rolle_id = ?'); werte.push(String(rolleId)); }
    if (mitgliedId) { wo.push('mitglied_id = ?'); werte.push(String(mitgliedId)); }
    if (besitzer) {
        const b = Array.isArray(besitzer) ? besitzer : [besitzer];
        if (!b.length) return [];
        wo.push(`besitzer IN (${b.map(() => '?').join(', ')})`);
        werte.push(...b.map(String));
    }
    if (!wo.length) throw new Error('Rollen.eintraege: ohne Filter wird nicht gelesen');
    const zeilen = await db().query(
        `SELECT guild_id, mitglied_id, rolle_id, besitzer, bezug, seit FROM rollen_vergaben WHERE ${wo.join(' AND ')}`, werte);
    return (zeilen || []).map((z) => ({ ...z, guild_id: String(z.guild_id), mitglied_id: String(z.mitglied_id), rolle_id: String(z.rolle_id) }));
}

/**
 * Wem hat dieser Besitzer diese Rolle gegeben? (Mitglieder-IDs)
 *
 * @param {string} guildId
 * @param {{rolleId?: string, besitzer: string|string[]}} filter
 * @returns {Promise<string[]>}
 */
async function vergebene(guildId, filter) {
    return [...new Set((await eintraege(guildId, filter)).map((z) => z.mitglied_id))];
}

async function buche(guildId, userId, rolleId, besitzer, bezug) {
    await db().query(
        `INSERT INTO rollen_vergaben (guild_id, mitglied_id, rolle_id, besitzer, bezug)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE bezug = VALUES(bezug)`,
        [guildId, userId, rolleId, besitzer, bezug == null ? null : String(bezug).slice(0, 64)]);
}

async function streiche(guildId, userId, rolleId, besitzer) {
    await db().query(
        'DELETE FROM rollen_vergaben WHERE guild_id = ? AND mitglied_id = ? AND rolle_id = ? AND besitzer = ?',
        [guildId, userId, rolleId, besitzer]);
}

/**
 * Das Buch folgt Discord: Einträge zu Rollen, die das Mitglied nicht trägt
 * (oder nicht mehr gibt, oder zu einem Mitglied, das gegangen ist), löschen.
 *
 * @param {string} guildId
 * @param {{mitgliedId?: string, rollen?: string[]}} was mindestens eins
 * @returns {Promise<number>} gelöschte Einträge
 */
async function vergiss(guildId, { mitgliedId, rollen } = {}) {
    const r = rollen == null ? null : ids(rollen);
    // Rollen genannt, aber keine gültige: nichts löschen. Sonst fiele der
    // Filter weg und alle Einträge des Mitglieds gingen.
    if (r && !r.length) return 0;
    if (!mitgliedId && !r) return 0;
    const wo = ['guild_id = ?'];
    const werte = [String(guildId)];
    if (mitgliedId) { wo.push('mitglied_id = ?'); werte.push(String(mitgliedId)); }
    if (r?.length) { wo.push(`rolle_id IN (${r.map(() => '?').join(', ')})`); werte.push(...r); }
    const erg = await db().query(`DELETE FROM rollen_vergaben WHERE ${wo.join(' AND ')}`, werte);
    return erg?.affectedRows || 0;
}

// ── Ausführung im Bot ───────────────────────────────────────────────────

const warteschlange = new Map();

/** Aufträge für dasselbe Mitglied nacheinander (siehe Kopf). */
function nacheinander(schluessel, arbeit) {
    const davor = warteschlange.get(schluessel) || Promise.resolve();
    const lauf = davor.catch(() => {}).then(arbeit);
    const ende = lauf.catch(() => {});
    warteschlange.set(schluessel, ende);
    ende.then(() => { if (warteschlange.get(schluessel) === ende) warteschlange.delete(schluessel); });
    return lauf;
}

function grundText(besitzer, grund) {
    return `[${besitzer}] ${grund || 'Rollenvergabe'}`.slice(0, 500);
}

/** Mitglied und Guild aus dem Auftrag, im Bot. */
async function aufloesen(auftrag) {
    if (auftrag.mitglied) return { guild: auftrag.mitglied.guild, mitglied: auftrag.mitglied, userId: String(auftrag.mitglied.id) };
    let guild = auftrag.guild || null;
    if (!guild && auftrag.guildId) guild = sm().get('client').guilds.cache.get(String(auftrag.guildId)) || null;
    if (!guild) return { guild: null };
    const userId = String(auftrag.userId || '');
    // Frisch holen: Der Auftrag kommt von außen (IPC, Abgleich), der
    // Zwischenspeicher kann eine eben gesetzte Rolle noch nicht kennen.
    const mitglied = ID.test(userId)
        ? await guild.members.fetch({ user: userId, force: true }).catch((e) => (e?.code === 10007 || e?.code === 10013 ? null : Promise.reject(e)))
        : null;
    return { guild, mitglied, userId };
}

/** Andere Besitzer, die diese Rollen bei diesem Mitglied halten. */
async function andereHalter(guildId, userId, rollen, besitzer) {
    if (!rollen.length) return new Map();
    const zeilen = await db().query(
        `SELECT rolle_id, besitzer FROM rollen_vergaben
          WHERE guild_id = ? AND mitglied_id = ? AND rolle_id IN (${rollen.map(() => '?').join(', ')})`,
        [guildId, userId, ...rollen]);
    const halter = new Map();
    for (const z of zeilen || []) {
        const r = String(z.rolle_id);
        if (!halter.has(r)) halter.set(r, new Set());
        halter.get(r).add(z.besitzer);
    }
    const eigene = new Map();
    for (const [r, set] of halter) eigene.set(r, { eigen: set.has(besitzer), andere: [...set].filter((b) => b !== besitzer) });
    return eigene;
}

async function fuehreAus(art, auftrag) {
    pruefeBesitzer(auftrag.besitzer);
    const besitzer = auftrag.besitzer;
    const rollen = ids(auftrag.rollen);
    const e = leer();
    if (!rollen.length) return e;

    const { guild, mitglied, userId } = await aufloesen(auftrag);
    if (!guild) return { ...e, fehler: 'Guild nicht gefunden', code: 10004 };
    const guildId = String(guild.id);

    return nacheinander(`${guildId}:${userId}`, async () => {
        const stand = await andereHalter(guildId, userId, rollen, besitzer);
        const halt = (r) => stand.get(r) || { eigen: false, andere: [] };
        const name = (r) => guild.roles.cache.get(r)?.name || null;

        if (!mitglied) {
            // Nicht (mehr) auf dem Server. Geben geht nicht; beim Nehmen ist
            // das eigene Gedächtnis zu leeren, die Rolle ist mit ihm gegangen.
            e.kein_mitglied = true;
            if (art !== 'vergib') for (const r of rollen) if (halt(r).eigen) await streiche(guildId, userId, r, besitzer);
            return e;
        }

        const traegt = (r) => mitglied.roles.cache.has(r);

        for (const r of rollen) {
            const h = halt(r);

            if (art === 'vergib') {
                if (traegt(r)) {
                    if (h.eigen) e.unveraendert.push({ rolle: r, hinweis: HINWEIS.SCHON_GEBUCHT });
                    else if (h.andere.length) { await buche(guildId, userId, r, besitzer, auftrag.bezug); e.gebucht.push(r); }
                    else e.unveraendert.push({ rolle: r, hinweis: HINWEIS.HAT_SCHON }); // Regel 2
                    continue;
                }
                const p = pruefe(guild, r);
                if (p.grund) { e.blockiert.push({ rolle: r, name: p.rolle?.name || null, grund: p.grund }); continue; }
                try {
                    await mitglied.roles.add(r, grundText(besitzer, auftrag.grund));
                } catch (err) {
                    e.blockiert.push({ rolle: r, name: name(r), grund: GRUND.FEHLER, fehler: err.message, code: err.code ?? null });
                    continue;
                }
                e.vergeben.push(r);
                try {
                    await buche(guildId, userId, r, besitzer, auftrag.bezug);
                } catch (err) {
                    // Die Rolle ist gesetzt, nur das Gedächtnis fehlt. Ohne Eintrag
                    // nimmt sie nie wieder jemand: gehört ins Log.
                    log().error(`[Rollen] ${besitzer}: Rolle ${r} an ${userId} in ${guildId} gegeben, aber nicht gebucht`, err);
                }
                continue;
            }

            // nimm / gibAb
            if (art === 'nimm' && !h.eigen) { e.unveraendert.push({ rolle: r, hinweis: HINWEIS.KEIN_EINTRAG }); continue; } // Regel 1
            if (h.andere.length) {
                if (h.eigen) await streiche(guildId, userId, r, besitzer);
                e.gehalten.push({ rolle: r, name: name(r), von: h.andere });
                continue;
            }
            if (!traegt(r)) {
                if (h.eigen) await streiche(guildId, userId, r, besitzer);
                e.unveraendert.push({ rolle: r, hinweis: HINWEIS.HAT_NICHT });
                continue;
            }
            const p = pruefe(guild, r);
            // Blockiert: Der Eintrag bleibt, damit ein späterer Versuch die
            // Rolle noch nehmen kann.
            if (p.grund) { e.blockiert.push({ rolle: r, name: p.rolle?.name || null, grund: p.grund }); continue; }
            try {
                await mitglied.roles.remove(r, grundText(besitzer, auftrag.grund));
            } catch (err) {
                e.blockiert.push({ rolle: r, name: name(r), grund: GRUND.FEHLER, fehler: err.message, code: err.code ?? null });
                continue;
            }
            e.entzogen.push(r);
            if (h.eigen) await streiche(guildId, userId, r, besitzer);
        }
        return e;
    });
}

// ── Dashboard: über IPC ─────────────────────────────────────────────────

async function ueberIpc(art, auftrag) {
    pruefeBesitzer(auftrag.besitzer);
    const ipc = sm().has('ipcServer') ? sm().get('ipcServer') : null;
    if (!ipc) return { ...leer(), fehler: 'IPC nicht verfügbar', code: null };
    const nutzlast = {
        art,
        guildId: String(auftrag.guildId || ''),
        userId: String(auftrag.userId || ''),
        rollen: ids(auftrag.rollen),
        besitzer: auftrag.besitzer,
        bezug: auftrag.bezug ?? null,
        grund: auftrag.grund ?? null
    };
    // Wer in einer Schlange wartet (Ausgang von streaming), gibt seine Frist mit.
    const frist = Number.isFinite(auftrag.frist_ms) && auftrag.frist_ms > 0 ? auftrag.frist_ms : FRIST_MS;
    const antworten = await ipc.broadcast('dashboard:ROLLEN', nutzlast, true, { timeout: frist });
    // Kern-Handler antworten in der Hülle `{ success, data }` (data = Rückgabe des Handlers).
    const innen = (antworten || []).map((h) => h?.data ?? h);
    const gut = innen.find((a) => a?.success && a.ergebnis);
    if (gut) return gut.ergebnis;
    // Jeder Shard ohne die Guild sagt 10004. Nur wenn alle das sagen, ist sie weg.
    // `broadcast` lässt Sockets weg, die in der Frist nicht antworten: leer heißt
    // „kein Bot oder keiner antwortete“, nie „erledigt“.
    const fehler = innen.map((a) => a?.error).find(Boolean)
        || (antworten?.length ? 'keine brauchbare Antwort' : `Kein Bot verbunden oder keine Antwort in ${frist / 1000} s`);
    const alleOhne = innen.length > 0 && innen.every((a) => a?.code === 10004);
    return { ...leer(), fehler, code: alleOhne ? 10004 : null };
}

function auftragAus(art) {
    return async (auftrag) => {
        if (!auftrag || typeof auftrag !== 'object') throw new Error(`Rollen.${art}: Auftrag fehlt`);
        if (imBot() || auftrag.mitglied || auftrag.guild) return fuehreAus(art, auftrag);
        return ueberIpc(art, auftrag);
    };
}

// ── Erklärungen der Plugins ─────────────────────────────────────────────

let erklaert = null;

/**
 * Alle `rollen`-Erklärungen: package.json `rollen: [{ besitzer, titel, seite }]`,
 * die Einstellung liest `plugins/<p>/shared/rollen.js` (Funktion je Besitzer:
 * `async ({ guildId, db }) => [rollenIds]`).
 *
 * @param {{neu?: boolean}} [opt]
 * @returns {{liste: Array<{plugin: string, besitzer: string, titel: string, seite: string|null}>, fehler: string[]}}
 */
function erklaerungen({ neu = false } = {}) {
    if (erklaert && !neu) return erklaert;
    const liste = [];
    const fehler = [];
    for (const p of fs.readdirSync(PLUGINS).sort()) {
        const pj = path.join(PLUGINS, p, 'package.json');
        if (!fs.existsSync(pj)) continue;
        let paket;
        try { paket = JSON.parse(fs.readFileSync(pj, 'utf8')); } catch (err) { fehler.push(`${p}: package.json unlesbar (${err.message})`); continue; }
        if (paket.rollen === undefined) continue;
        if (!Array.isArray(paket.rollen)) { fehler.push(`${p}: rollen ist keine Liste`); continue; }
        const praefix = p === 'core' ? 'kern' : p;
        let funktionen = null;
        const datei = path.join(PLUGINS, p, DATEI);
        if (paket.rollen.length) {
            try { funktionen = require(datei); } catch (err) { fehler.push(`${p}: ${DATEI} fehlt oder wirft (${err.message})`); }
        }
        for (const [i, r] of paket.rollen.entries()) {
            const ort = `${p}: rollen[${i}]`;
            if (!r || typeof r !== 'object') { fehler.push(`${ort} ist kein Objekt`); continue; }
            const fremd = Object.keys(r).filter((k) => !['besitzer', 'titel', 'seite'].includes(k));
            if (fremd.length) fehler.push(`${ort}: unbekannt ${fremd.join(', ')}`);
            if (!BESITZER.test(String(r.besitzer || ''))) { fehler.push(`${ort}: besitzer "${r.besitzer}" ungültig`); continue; }
            if (r.besitzer.split(':')[0] !== praefix) fehler.push(`${ort}: besitzer ${r.besitzer} beginnt nicht mit ${praefix}:`);
            if (typeof r.titel !== 'string' || !/^[a-z0-9_-]+:[A-Z0-9_.]+$/.test(r.titel)) fehler.push(`${ort}: titel braucht einen Sprachschlüssel plugin:SCHLUESSEL`);
            if (r.seite !== undefined && (typeof r.seite !== 'string' || !r.seite.startsWith('/'))) fehler.push(`${ort}: seite beginnt mit /`);
            if (funktionen && typeof funktionen[r.besitzer] !== 'function') fehler.push(`${ort}: ${DATEI} exportiert keine Funktion "${r.besitzer}" (die Einstellung)`);
            if (liste.some((x) => x.besitzer === r.besitzer)) fehler.push(`${ort}: besitzer ${r.besitzer} doppelt`);
            liste.push({ plugin: p, besitzer: r.besitzer, titel: r.titel, seite: r.seite || null });
        }
    }
    erklaert = { liste, fehler };
    return erklaert;
}

/**
 * Welche Rollen hat jeder erklärte Besitzer in dieser Guild eingestellt?
 * Plugins, die in der Guild aus sind, fehlen (core ist immer an).
 *
 * @param {string} guildId
 * @returns {Promise<Array<{plugin: string, besitzer: string, titel: string, seite: string|null, rollen: string[], fehler: string|null}>>}
 */
async function eingestellt(guildId) {
    const { liste } = erklaerungen();
    const an = new Set(((await db().query('SELECT plugin_name FROM guild_plugins WHERE guild_id = ? AND is_enabled = 1', [guildId])) || [])
        .map((z) => z.plugin_name));
    const aus = [];
    for (const e of liste) {
        if (e.plugin !== 'core' && !an.has(e.plugin)) continue;
        let rollen = [];
        let fehler = null;
        try {
            rollen = ids(await require(path.join(PLUGINS, e.plugin, DATEI))[e.besitzer]({ guildId: String(guildId), db: db() }));
        } catch (err) {
            fehler = err.message;
        }
        aus.push({ ...e, rollen, fehler });
    }
    return aus;
}

module.exports = {
    GRUND,
    HINWEIS,
    ARTEN,
    BESITZER,
    pruefe,
    vergib: auftragAus('vergib'),
    nimm: auftragAus('nimm'),
    gibAb: auftragAus('gibAb'),
    eintraege,
    vergebene,
    vergiss,
    erklaerungen,
    eingestellt,
    _fuehreAus: fuehreAus
};
