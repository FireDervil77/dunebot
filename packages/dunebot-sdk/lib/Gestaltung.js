'use strict';

/**
 * Gestaltung je Guild (G-09, K382, 2026-11-14): Farben, Logo und Banner der
 * Bot-Ausgaben.
 *
 *     const { Gestaltung } = require('dunebot-sdk');
 *     embed.setColor(await Gestaltung.farbe(guild.id, 'akzent', 'music'));
 *
 * # Woher eine Farbe kommt (Betreiber 2026-11-14: „Plugin-Vorgabe“)
 *
 * In dieser Reihenfolge, die erste gesetzte gilt:
 *
 *   1. Eigene Farben des Plugins in dieser Guild (Kern-Teil „Farben dieses
 *      Plugins“ auf der Seite des Plugins, Schalter „Farben der Guild nutzen“
 *      aus). Zeile `guild_gestaltung (guild_id, plugin)`.
 *   2. Die Palette der Guild (Einstellungen → Gestaltung). Zeile mit
 *      `plugin = ''`. Eine Rolle ohne Wert heißt dort „Vorgabe“.
 *   3. Die Vorgabe des Plugins, `farben.rollen` in seiner package.json: so sah
 *      das Plugin vor G-09 aus. Deshalb ändert sich beim Rollout nichts.
 *   4. Die Vorgabe des Kerns: die Farben des Dashboard-Themes als feste Werte.
 *
 * Feste Farben je Aktion oder Vorlage (Moderation „Ban“, Giveaway „pausiert“)
 * sind Ebene 3 im Konzept und gehen hier gar nicht durch.
 *
 * # Logo und Banner
 *
 * Nur für Bot-Ausgaben (F-G9 A). Das Dashboard zeigt weiter das Bild aus
 * Discord, und das Server-Bild in Discord bleibt unberührt. `bilder()` liefert
 * absolute Adressen unter `DASHBOARD_BASE_URL`, Discord lädt sie von dort.
 *
 * # Zwischenspeicher
 *
 * Eine Abfrage je Guild, 60 Sekunden gemerkt. Das Dashboard ruft nach dem
 * Speichern `vergiss(guildId)` und sagt es dem Bot über IPC
 * (`dashboard:GESTALTUNG_GEAENDERT`). Fällt die Nachricht aus, gilt die neue
 * Farbe spätestens nach einer Minute.
 *
 * Bot und Dashboard nutzen dieselbe Datei. Wächter `scripts/check-gestaltung.js`.
 *
 * @module dunebot-sdk/lib/Gestaltung
 */

const path = require('path');
const fs = require('fs');

/** Die fünf Farbrollen, in dieser Reihenfolge auf allen Seiten. */
const ROLLEN = ['akzent', 'erfolg', 'hinweis', 'warnung', 'gefahr'];

/**
 * Vorgabe des Kerns = Theme-Farben (`themes/default/assets/css/tokens.css`,
 * `--fb-primary`, `--fb-success`, `--fb-info`, `--fb-warning`, `--fb-danger`)
 * als feste Werte. Ändert jemand das Theme, bleiben die Bot-Farben, wie sie
 * sind: Das Theme ist die Gestaltung der Anlage, nicht der Discord-Ausgaben.
 */
const KERN_VORGABE = Object.freeze({
    akzent: '#3498db',
    erfolg: '#2fb344',
    hinweis: '#4299e1',
    warnung: '#f76707',
    gefahr: '#d63939',
});

const HEX = /^#[0-9a-f]{6}$/;
const MERKEN_MS = 60 * 1000;
const PLUGINS = path.join(__dirname, '..', '..', '..', 'plugins');
const PLUGIN_NAME = /^[a-z0-9_-]{1,32}$/;

/** guildId → { bis, zeilen: Map(plugin → Zeile), bilder } */
const merker = new Map();
/** plugin → { rollen, recht } | null (aus der package.json, einmal je Prozess) */
const erklaerungen = new Map();

function db() {
    const { ServiceManager } = require('dunebot-core');
    return ServiceManager.get('dbService');
}

/**
 * Wert in die eine Schreibweise bringen: `#rrggbb`, klein. Alles andere → null.
 * @param {*} wert
 * @returns {string|null}
 */
function hex(wert) {
    if (typeof wert !== 'string') return null;
    const w = wert.trim().toLowerCase();
    return HEX.test(w) ? w : null;
}

/** `#rrggbb` → Zahl für discord.js (`setColor` und rohe Embeds). */
function alsZahl(h) {
    return parseInt(h.slice(1), 16);
}

/**
 * Was ein Plugin unter `farben` in seiner package.json erklärt:
 * `{ "recht": "MUSIC.SETTINGS.EDIT", "rollen": { "akzent": "#1db954", … } }`.
 * `rollen` sind die Rollen, die das Plugin benutzt, mit seiner Vorgabe.
 *
 * @param {string} plugin
 * @returns {{rollen: Object<string,string>, recht: string|null}|null}
 */
function erklaerung(plugin) {
    if (!plugin) return null;
    if (erklaerungen.has(plugin)) return erklaerungen.get(plugin);
    let e = null;
    if (PLUGIN_NAME.test(plugin)) {
        try {
            const pkg = JSON.parse(fs.readFileSync(path.join(PLUGINS, plugin, 'package.json'), 'utf8'));
            if (pkg.farben && pkg.farben.rollen) {
                const rollen = {};
                for (const r of ROLLEN) {
                    const h = hex(pkg.farben.rollen[r]);
                    if (h) rollen[r] = h;
                }
                e = { rollen, recht: pkg.farben.recht || null };
            }
        } catch {
            e = null;
        }
    }
    erklaerungen.set(plugin, e);
    return e;
}

/** Absolute Adresse einer Datei der Medienablage, oder null. */
function bildAdresse(guildId, gespeichert) {
    if (!gespeichert) return null;
    const basis = String(process.env.DASHBOARD_BASE_URL || '').replace(/\/+$/, '');
    if (!/^https:\/\//.test(basis)) return null;
    return `${basis}/uploads/media/${encodeURIComponent(String(guildId))}/${encodeURIComponent(gespeichert)}`;
}

/**
 * Alle Zeilen einer Guild, gemerkt.
 * @param {string} guildId
 */
async function stand(guildId) {
    const id = String(guildId || '');
    const jetzt = Date.now();
    const m = merker.get(id);
    if (m && m.bis > jetzt) return m;

    const zeilen = new Map();
    let bilder = { logo: null, banner: null };
    if (id) {
        // Die Bilder über die Medienablage derselben Guild: Ein gelöschtes Bild
        // ergibt null, und ein Bild einer fremden Guild ist nicht erreichbar.
        const rows = await db().query(`
            SELECT g.plugin, g.akzent, g.erfolg, g.hinweis, g.warnung, g.gefahr,
                   lm.stored_name AS logo, bm.stored_name AS banner
            FROM guild_gestaltung g
            LEFT JOIN guild_media lm ON lm.id = g.logo_media_id AND lm.guild_id = g.guild_id
            LEFT JOIN guild_media bm ON bm.id = g.banner_media_id AND bm.guild_id = g.guild_id
            WHERE g.guild_id = ?
        `, [id]);
        for (const z of rows || []) {
            zeilen.set(z.plugin, z);
            if (z.plugin === '') bilder = { logo: bildAdresse(id, z.logo), banner: bildAdresse(id, z.banner) };
        }
    }
    const neu = { bis: jetzt + MERKEN_MS, zeilen, bilder };
    merker.set(id, neu);
    return neu;
}

/**
 * Wirksame Farbe einer Rolle als `#rrggbb`, mit ihrer Herkunft.
 *
 * @param {string} guildId
 * @param {string} rolle eine aus ROLLEN
 * @param {string} [plugin] wer fragt; ohne Plugin zählen nur Guild und Kern
 * @returns {Promise<{hex: string, quelle: 'plugin'|'guild'|'plugin_vorgabe'|'kern'}>}
 */
async function aufloesen(guildId, rolle, plugin) {
    if (!ROLLEN.includes(rolle)) throw new Error(`Gestaltung: unbekannte Farbrolle „${rolle}“ (erlaubt: ${ROLLEN.join(', ')})`);
    const s = await stand(guildId);
    const eigen = plugin ? hex(s.zeilen.get(plugin)?.[rolle]) : null;
    if (eigen) return { hex: eigen, quelle: 'plugin' };
    const guild = hex(s.zeilen.get('')?.[rolle]);
    if (guild) return { hex: guild, quelle: 'guild' };
    const vorgabe = erklaerung(plugin)?.rollen[rolle];
    if (vorgabe) return { hex: vorgabe, quelle: 'plugin_vorgabe' };
    return { hex: KERN_VORGABE[rolle], quelle: 'kern' };
}

/**
 * Die Farbe für discord.js. Kann die Datenbank nicht antworten, gilt die
 * Vorgabe des Plugins (sonst des Kerns): Eine Nachricht scheitert nie an ihrer
 * Farbe. Der Fehler steht im Log.
 *
 * @param {string} guildId
 * @param {string} rolle
 * @param {string} [plugin]
 * @returns {Promise<number>}
 */
async function farbe(guildId, rolle, plugin) {
    try {
        return alsZahl((await aufloesen(guildId, rolle, plugin)).hex);
    } catch (err) {
        if (!ROLLEN.includes(rolle)) throw err;
        try { require('dunebot-core').ServiceManager.get('Logger').warn(`[Gestaltung] Farbe ${rolle} für ${guildId} nicht lesbar, nehme die Vorgabe: ${err.message}`); } catch { /* ohne Logger */ }
        return alsZahl(erklaerung(plugin)?.rollen[rolle] || KERN_VORGABE[rolle]);
    }
}

/**
 * Alle fünf Rollen mit Herkunft, für Seiten und Vorschau.
 * @param {string} guildId
 * @param {string} [plugin]
 * @returns {Promise<Object<string, {hex: string, quelle: string}>>}
 */
async function farben(guildId, plugin) {
    const aus = {};
    for (const r of ROLLEN) aus[r] = await aufloesen(guildId, r, plugin);
    return aus;
}

/**
 * Logo und Banner der Guild für Bot-Ausgaben, absolute Adressen oder null.
 * @param {string} guildId
 * @returns {Promise<{logo: string|null, banner: string|null}>}
 */
async function bilder(guildId) {
    try {
        return (await stand(guildId)).bilder;
    } catch (err) {
        try { require('dunebot-core').ServiceManager.get('Logger').warn(`[Gestaltung] Logo/Banner für ${guildId} nicht lesbar: ${err.message}`); } catch { /* ohne Logger */ }
        return { logo: null, banner: null };
    }
}

/** Gemerktes einer Guild verwerfen (nach dem Speichern, auch im Bot über IPC). */
function vergiss(guildId) {
    if (guildId === undefined) merker.clear();
    else merker.delete(String(guildId));
}

module.exports = { ROLLEN, KERN_VORGABE, hex, erklaerung, aufloesen, farbe, farben, bilder, vergiss };
