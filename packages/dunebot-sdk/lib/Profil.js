'use strict';

/**
 * Profilabschnitte (G-12, K382, 2026-11-14): Plugins liefern je einen
 * Abschnitt zu einem Mitglied, der Kern zeigt sie an drei Orten.
 *
 *   - `/profile` in Discord (Kern-Bot): nur das eigene Profil (Betreiber
 *     2026-11-14), Bildkarte `kern:profil` plus die Abschnitte als Embed.
 *   - `/info user` (information): nur Abschnitte mit `sicht: "alle"`, für
 *     jedes Mitglied. Damit sammelt information nicht mehr selbst.
 *   - Seite „Mitglieder“ im Dashboard (`CORE.MITGLIEDER.VIEW`): jedes
 *     Mitglied, Abschnitte nach Sicht und Recht des Betrachters.
 *
 * # Erklärung im Plugin
 *
 *     "profil": {
 *       "giveaway": { "titel": "PROFIL.TITEL", "sicht": "team", "recht": "GIVEAWAY.VIEW", "reihe": 300 }
 *     }
 *
 * Der Schlüssel ist der Name des Abschnitts. Die Funktion gleichen Namens
 * exportiert `plugins/<p>/shared/profil.js`:
 *
 *     exports.giveaway = async ({ guildId, userId, mitglied, t, db }) =>
 *         ({ felder: [{ titel: t('PROFIL.GEWONNEN'), wert: 2 }], kachel: { titel: …, wert: 2 } });
 *
 * `null` heißt: nichts zu zeigen (keine Teilnahme). Ein Feld hat `titel` und
 * genau eins von `wert` (Text, Zahl), `zeit` (ms) oder `liste` (Texte).
 * `kachel` ist optional und füllt eine der drei Kacheln der Profilkarte.
 * Texte kommen aus der Sprachdatei des Bots (`plugins/<p>/bot/locales`), auch
 * im Dashboard: ein Text, eine Datei.
 *
 * # Sicht (wer sieht den Abschnitt)
 *
 *   - `alle`    öffentliche Discord-Angaben; überall, auch in `/info user`
 *   - `team`    Daten der Guild über das Mitglied; das Mitglied selbst in
 *               Discord und Dashboard, andere im Dashboard nur mit `recht`
 *   - `selbst`  nur das Mitglied selbst (verbundene Konten gelten für alle
 *               Guilds, die Guild hat sie nicht)
 *
 * `discord: false` hält einen Abschnitt aus Discord heraus, auch für das
 * Mitglied selbst. Dann braucht es im Dashboard immer das Recht (Moderation,
 * Automod: Betreiber 2026-11-14, „nie in Discord“).
 *
 * Abschnitte eines Plugins, das in der Guild aus ist, fehlen. Scheitert ein
 * Abschnitt, steht das unter `fehler` und der Ort sagt es (halbe Auskunft).
 *
 * Wächter: scripts/check-profil.js
 *
 * @module dunebot-sdk/lib/Profil
 */

const fs = require('fs');
const path = require('path');

const WURZEL = path.join(__dirname, '..', '..', '..');
const PLUGINS = path.join(WURZEL, 'plugins');
const DATEI = 'shared/profil.js';

const NAME = /^[a-z0-9_-]{1,32}$/;
const SCHLUESSEL = /^[A-Z0-9_]+(\.[A-Z0-9_]+)*$/;
const RECHT = /^[A-Z0-9_]+(\.[A-Z0-9_]+)+$/;
const SICHTEN = Object.freeze(['alle', 'team', 'selbst']);
const ORTE = Object.freeze(['discord', 'info', 'dashboard']);
const FELDER = new Set(['titel', 'sicht', 'recht', 'discord', 'reihe']);
const SPRACHEN = Object.freeze(['de-DE', 'en-GB']);

/** So lange darf ein Abschnitt rechnen. */
const FRIST_MS = 5000;
/** Höchstens so viele Einträge zeigt ein Feld `liste`. */
const LISTE_MAX = 25;
const TEXT_MAX = 300;

let erklaert = null;
const sprachdateien = new Map();

function db() {
    return require('dunebot-core').ServiceManager.get('dbService');
}

function istZahl(x) {
    return typeof x === 'number' && Number.isFinite(x);
}

/** `de`, `de-DE`, `en`, `en-US` … → eine der Sprachdateien. */
function sprache(s) {
    return String(s || '').toLowerCase().startsWith('en') ? 'en-GB' : 'de-DE';
}

function sprachdatei(plugin, s) {
    const schluessel = `${plugin}|${s}`;
    if (!sprachdateien.has(schluessel)) {
        let inhalt = {};
        try { inhalt = JSON.parse(fs.readFileSync(path.join(PLUGINS, plugin, 'bot', 'locales', `${s}.json`), 'utf8')); } catch { /* fehlt: Schlüssel bleibt stehen */ }
        sprachdateien.set(schluessel, inhalt);
    }
    return sprachdateien.get(schluessel);
}

function nachsehen(obj, schluessel) {
    let x = obj;
    for (const teil of String(schluessel).split('.')) {
        if (!x || typeof x !== 'object') return undefined;
        x = x[teil];
    }
    return typeof x === 'string' ? x : undefined;
}

/**
 * Übersetzer für ein Plugin, aus seiner Bot-Sprachdatei. Fehlt der Text in
 * der Sprache, gilt Deutsch, sonst der Schlüssel. `{{name}}` wird ersetzt.
 * @returns {(schluessel: string, werte?: Object) => string}
 */
function uebersetzer(plugin, s) {
    const sp = sprache(s);
    return (schluessel, werte = {}) => {
        const roh = nachsehen(sprachdatei(plugin, sp), schluessel) ?? nachsehen(sprachdatei(plugin, 'de-DE'), schluessel) ?? schluessel;
        return roh.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, n) => (n in werte ? String(werte[n]) : `{{${n}}}`));
    };
}

/** Gibt es den Schlüssel in beiden Sprachen? (Wächter) */
function textFehlt(plugin, schluessel) {
    return SPRACHEN.filter((s) => nachsehen(sprachdatei(plugin, s), schluessel) === undefined);
}

/** Rechte, die ein Plugin (oder der Kern) kennt. */
function rechteVon(plugin) {
    const datei = plugin === 'core'
        ? path.join(WURZEL, 'packages', 'dunebot-core', 'config', 'permissions.json')
        : path.join(PLUGINS, plugin, 'dashboard', 'permissions.json');
    try {
        const j = JSON.parse(fs.readFileSync(datei, 'utf8'));
        const liste = Array.isArray(j) ? j : (j.permissions || []);
        return new Set(liste.map((r) => r.key));
    } catch {
        return new Set();
    }
}

/**
 * Alle Erklärungen, sortiert nach `reihe`. Einmal je Prozess gelesen; Fehler
 * stehen in `fehler` (Wächter), die Orte zeigen den Rest.
 * @returns {{abschnitte: Array<{plugin: string, name: string, kennung: string, titel: string, sicht: string, recht: string|null, discord: boolean, reihe: number}>, fehler: string[]}}
 */
function erklaerungen() {
    if (erklaert) return erklaert;
    const abschnitte = [];
    const fehler = [];
    let plugins = [];
    try { plugins = fs.readdirSync(PLUGINS).sort(); } catch { /* ohne Plugins */ }
    for (const p of plugins) {
        let pkg;
        try { pkg = JSON.parse(fs.readFileSync(path.join(PLUGINS, p, 'package.json'), 'utf8')); } catch { continue; }
        const erkl = pkg.profil;
        if (erkl === undefined) continue;
        if (!erkl || typeof erkl !== 'object' || Array.isArray(erkl)) { fehler.push(`${p}: profil muss ein Objekt sein`); continue; }
        let modul = null;
        try {
            modul = require(path.join(PLUGINS, p, DATEI));
        } catch (err) {
            fehler.push(`${p}: ${DATEI} lässt sich nicht laden (${err.message})`);
            continue;
        }
        const rechte = rechteVon(p);
        for (const [name, e] of Object.entries(erkl)) {
            const ort = `${p} → profil.${name}`;
            if (!NAME.test(name)) { fehler.push(`${ort}: Name nur aus a-z, 0-9, _ und -`); continue; }
            if (!e || typeof e !== 'object' || Array.isArray(e)) { fehler.push(`${ort}: kein Objekt`); continue; }
            const fremd = Object.keys(e).filter((k) => !FELDER.has(k));
            if (fremd.length) { fehler.push(`${ort}: unbekannte Felder ${fremd.join(', ')}`); continue; }
            if (typeof modul[name] !== 'function') { fehler.push(`${ort}: ${DATEI} exportiert keine Funktion ${name}`); continue; }
            if (typeof e.titel !== 'string' || !SCHLUESSEL.test(e.titel)) { fehler.push(`${ort}: titel braucht einen Schlüssel der Bot-Sprachdatei`); continue; }
            const ohne = textFehlt(p, e.titel);
            if (ohne.length) { fehler.push(`${ort}: ${e.titel} fehlt in bot/locales ${ohne.join(', ')}`); continue; }
            if (!SICHTEN.includes(e.sicht)) { fehler.push(`${ort}: sicht ist ${SICHTEN.join(', ')}`); continue; }
            if (e.discord !== undefined && typeof e.discord !== 'boolean') { fehler.push(`${ort}: discord ist true oder false`); continue; }
            const discord = e.discord !== false;
            if (e.recht !== undefined && (typeof e.recht !== 'string' || !RECHT.test(e.recht))) { fehler.push(`${ort}: recht ist ein Schlüssel wie GIVEAWAY.VIEW`); continue; }
            if (e.sicht === 'team' && !e.recht) { fehler.push(`${ort}: sicht team braucht ein recht (wer außer dem Mitglied sieht ihn im Dashboard)`); continue; }
            if (e.sicht !== 'team' && e.recht) { fehler.push(`${ort}: recht gilt nur für sicht team`); continue; }
            if (e.recht && !rechte.has(e.recht)) { fehler.push(`${ort}: ${e.recht} steht nicht in den Rechten von ${p}`); continue; }
            if (e.sicht === 'alle' && !discord) { fehler.push(`${ort}: sicht alle und discord false widersprechen sich`); continue; }
            if (e.reihe !== undefined && !Number.isInteger(e.reihe)) { fehler.push(`${ort}: reihe ist eine ganze Zahl`); continue; }
            abschnitte.push({ plugin: p, name, kennung: `${p}:${name}`, titel: e.titel, sicht: e.sicht, recht: e.recht || null, discord, reihe: e.reihe ?? 1000, modul });
        }
    }
    abschnitte.sort((a, b) => a.reihe - b.reihe || a.kennung.localeCompare(b.kennung));
    erklaert = { abschnitte, fehler };
    return erklaert;
}

/**
 * Darf der Betrachter den Abschnitt an diesem Ort sehen? Ohne Plugin-Schalter
 * und ohne Rechteabfrage: `hatRecht` ist das Ergebnis für `a.recht`.
 */
function sichtbar(a, { ort, selbst, hatRecht }) {
    if (ort === 'info') return a.sicht === 'alle';
    if (ort === 'discord') return selbst && a.discord;
    if (a.sicht === 'alle') return true;
    if (a.sicht === 'selbst') return selbst;
    if (selbst && a.discord) return true;
    return Boolean(hatRecht);
}

/**
 * Discord-Mitglied in die Form, die Abschnitte bekommen (Bot und Dashboard
 * gleich, das Dashboard bekommt sie über IPC). Ohne `@everyone`, höchste
 * Rolle zuerst.
 * @param {import('discord.js').GuildMember} member
 */
function mitgliedAus(member) {
    if (!member) return null;
    const rollen = [...(member.roles?.cache?.values?.() || [])]
        .filter((r) => r.id !== member.guild?.id)
        .sort((a, b) => b.position - a.position)
        .map((r) => ({ id: r.id, name: r.name, farbe: r.hexColor && r.hexColor !== '#000000' ? r.hexColor : null }));
    return {
        id: String(member.id),
        name: String(member.user?.username ?? ''),
        anzeige: String(member.displayName ?? member.user?.username ?? ''),
        avatar: typeof member.displayAvatarURL === 'function' ? member.displayAvatarURL({ extension: 'png', size: 256 }) : null,
        bot: Boolean(member.user?.bot),
        beigetreten: member.joinedTimestamp ?? (member.joinedAt ? new Date(member.joinedAt).getTime() : null),
        erstellt: member.user?.createdTimestamp ?? null,
        rollen,
    };
}

/**
 * Ein Mitglied aus `mitgliedAus` als Mitglied für die Bildkarte (dieselben
 * Felder wie der Beispielkontext der Vorlagen, mit echten Werten).
 */
function kartenMitglied(m, guildDaten) {
    const guild = { id: String(guildDaten?.id || '0'), name: String(guildDaten?.name || ''), iconURL: () => null };
    const avatar = m.avatar || 'https://cdn.discordapp.com/embed/avatars/0.png';
    const user = { id: m.id, username: m.name, discriminator: '0', tag: m.name, bot: m.bot, createdAt: m.erstellt ? new Date(m.erstellt) : null, displayAvatarURL: () => avatar };
    return {
        id: m.id, user, guild, displayName: m.anzeige, nickname: m.anzeige !== m.name ? m.anzeige : null,
        joinedAt: m.beigetreten ? new Date(m.beigetreten) : null,
        toString: () => `<@${m.id}>`, displayAvatarURL: () => avatar,
    };
}

/** Was ein Abschnitt liefert, geprüft und gekürzt. Wirft bei falscher Form. */
function pruefeErgebnis(r) {
    if (r === null || r === undefined) return null;
    if (typeof r !== 'object' || !Array.isArray(r.felder)) throw new Error('liefert kein { felder: [] }');
    const felder = r.felder.map((f, i) => {
        if (!f || typeof f.titel !== 'string' || !f.titel) throw new Error(`Feld ${i + 1} ohne titel`);
        const arten = ['wert', 'zeit', 'liste'].filter((k) => f[k] !== undefined);
        if (arten.length !== 1) throw new Error(`Feld „${f.titel}“ braucht genau eins von wert, zeit, liste`);
        if (f.wert !== undefined && typeof f.wert !== 'string' && !istZahl(f.wert)) throw new Error(`Feld „${f.titel}“: wert ist Text oder Zahl`);
        if (f.zeit !== undefined && !istZahl(f.zeit)) throw new Error(`Feld „${f.titel}“: zeit ist eine Zahl (ms)`);
        if (f.liste !== undefined && !Array.isArray(f.liste)) throw new Error(`Feld „${f.titel}“: liste ist eine Liste`);
        const feld = { titel: f.titel.slice(0, 100) };
        if (f.wert !== undefined) feld.wert = String(f.wert).slice(0, TEXT_MAX);
        if (f.zeit !== undefined) feld.zeit = f.zeit;
        if (f.liste !== undefined) {
            feld.liste = f.liste.slice(0, LISTE_MAX).map((x) => String(x).slice(0, TEXT_MAX));
            feld.mehr = Math.max(0, f.liste.length - LISTE_MAX);
        }
        return feld;
    });
    let kachel = null;
    if (r.kachel) {
        if (typeof r.kachel.titel !== 'string' || (typeof r.kachel.wert !== 'string' && !istZahl(r.kachel.wert))) throw new Error('kachel braucht titel und wert');
        kachel = { titel: r.kachel.titel.slice(0, 40), wert: String(r.kachel.wert).slice(0, 24) };
    }
    if (!felder.length && !kachel) return null;
    return { felder, kachel };
}

function mitFrist(versprechen, ms) {
    let uhr;
    return Promise.race([
        versprechen,
        new Promise((_, nein) => { uhr = setTimeout(() => nein(new Error(`keine Antwort nach ${ms} ms`)), ms); }),
    ]).finally(() => clearTimeout(uhr));
}

async function eingeschaltet(guildId) {
    const zeilen = await db().query('SELECT plugin_name FROM guild_plugins WHERE guild_id = ? AND is_enabled = 1', [String(guildId)]);
    const an = new Set((zeilen || []).map((z) => z.plugin_name));
    an.add('core');
    return an;
}

/**
 * Die Abschnitte eines Mitglieds an einem Ort.
 *
 * @param {Object} k
 * @param {string} k.guildId
 * @param {string} k.userId wessen Profil
 * @param {Object|null} k.mitglied aus `mitgliedAus`, `null` wenn nicht (mehr) auf dem Server
 * @param {'discord'|'info'|'dashboard'} k.ort
 * @param {string} [k.betrachterId] wer schaut (Pflicht für discord und dashboard)
 * @param {(recht: string) => Promise<boolean>} [k.darf] Rechteabfrage für den Betrachter (dashboard)
 * @param {string} [k.sprache] `de-DE`/`en-GB`
 * @returns {Promise<{abschnitte: Array<{kennung: string, plugin: string, titel: string, sicht: string, discord: boolean, felder: Object[], kachel: Object|null}>, fehler: Array<{kennung: string, titel: string, grund: string}>}>}
 */
async function abschnitte({ guildId, userId, mitglied = null, ort, betrachterId = null, darf = null, sprache: s = 'de-DE' } = {}) {
    if (!ORTE.includes(ort)) throw new Error(`Profil: unbekannter Ort ${ort}`);
    const selbst = Boolean(betrachterId) && String(betrachterId) === String(userId);
    if (ort === 'discord' && !selbst) throw new Error('Profil: in Discord nur das eigene Profil');
    if (ort === 'dashboard' && !betrachterId) throw new Error('Profil: im Dashboard braucht es den Betrachter');

    const an = await eingeschaltet(guildId);
    const ergebnis = { abschnitte: [], fehler: [] };
    const rechte = new Map();
    const kandidaten = [];
    for (const a of erklaerungen().abschnitte) {
        if (!an.has(a.plugin)) continue;
        let hatRecht = false;
        if (ort === 'dashboard' && a.recht && !(selbst && a.discord && a.sicht === 'team')) {
            if (!rechte.has(a.recht)) rechte.set(a.recht, typeof darf === 'function' ? Boolean(await darf(a.recht)) : false);
            hatRecht = rechte.get(a.recht);
        }
        if (sichtbar(a, { ort, selbst, hatRecht })) kandidaten.push(a);
    }

    const gelaufen = await Promise.all(kandidaten.map(async (a) => {
        const t = uebersetzer(a.plugin, s);
        try {
            const r = await mitFrist(Promise.resolve(a.modul[a.name]({ guildId: String(guildId), userId: String(userId), mitglied, t, sprache: sprache(s), db: db() })), FRIST_MS);
            return { a, t, r: pruefeErgebnis(r) };
        } catch (err) {
            return { a, t, fehler: err.message };
        }
    }));
    for (const { a, t, r, fehler } of gelaufen) {
        if (fehler) { ergebnis.fehler.push({ kennung: a.kennung, titel: t(a.titel), grund: fehler }); continue; }
        if (!r) continue;
        ergebnis.abschnitte.push({ kennung: a.kennung, plugin: a.plugin, titel: t(a.titel), sicht: a.sicht, discord: a.discord, felder: r.felder, kachel: r.kachel });
    }
    return ergebnis;
}

/**
 * Werte der drei Kacheln von `kern:profil`: die ersten drei Abschnitte mit
 * Kachel, die auch in Discord stehen dürfen. Die Karte sieht dann überall
 * gleich aus; Moderation und Automod kommen nie aufs Bild.
 */
function kacheln(liste) {
    const k = liste.filter((a) => a.kachel && a.discord).slice(0, 3).map((a) => a.kachel);
    const werte = {};
    for (let i = 0; i < 3; i++) {
        werte[`titel${i + 1}`] = k[i]?.titel ?? '';
        werte[`wert${i + 1}`] = k[i]?.wert ?? '–';
    }
    werte.abzeichen = [];
    return werte;
}

/**
 * Ein Feld als Text. `discord`: Zeit als `<t:…:D>`; sonst als Datum in der
 * Sprache. Die Liste mit Komma, „+ N weitere“ am Ende.
 */
function feldText(f, ort, s = 'de-DE', t = null) {
    if (f.zeit !== undefined) {
        if (ort === 'discord') return `<t:${Math.floor(f.zeit / 1000)}:D>`;
        return new Date(f.zeit).toLocaleDateString(sprache(s), { year: 'numeric', month: '2-digit', day: '2-digit' });
    }
    if (f.liste !== undefined) {
        const mehr = f.mehr ? (t ? t('PROFIL.MEHR', { n: f.mehr }) : `+${f.mehr}`) : '';
        return [f.liste.join(', ') || '–', mehr].filter(Boolean).join(' ');
    }
    return f.wert;
}

/** Markdown von Discord entschärfen (Preise, Songtitel und Rollennamen sind Eingaben). */
function ohneMarkdown(s) {
    return String(s).replace(/([\\*_~`|>#\-[\]()])/g, '\\$1').replace(/@/g, '@\u200b');
}

/**
 * Abschnitte als Embed-Felder für Discord (`/profile`, `/info user`): ein
 * Feld je Abschnitt, Zeilen „**Titel**: Wert“, höchstens 1024 Zeichen.
 * @param {Array} liste aus `abschnitte`
 * @param {(s: string, w?: Object) => string} tKern Übersetzer des Kerns (für „und N weitere“)
 * @returns {Array<{name: string, value: string}>}
 */
function discordFelder(liste, tKern) {
    return liste.slice(0, 25).map((a) => {
        const zeilen = a.felder.map((f) => {
            const text = f.zeit !== undefined ? feldText(f, 'discord') : ohneMarkdown(feldText(f, 'discord', 'de-DE', tKern));
            return `**${ohneMarkdown(f.titel)}**: ${text}`;
        });
        let value = zeilen.join('\n');
        if (value.length > 1024) value = `${value.slice(0, 1020)} …`;
        return { name: a.titel.slice(0, 256), value: value || '–' };
    });
}

/** Gelesene Erklärungen und Sprachdateien vergessen (Wächter). */
function vergiss() {
    erklaert = null;
    sprachdateien.clear();
}

module.exports = {
    SICHTEN, ORTE, FRIST_MS, LISTE_MAX, DATEI,
    erklaerungen, abschnitte, sichtbar, kacheln, feldText, discordFelder, ohneMarkdown, mitgliedAus, kartenMitglied, uebersetzer, textFehlt, pruefeErgebnis, vergiss,
};
