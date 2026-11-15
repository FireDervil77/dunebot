'use strict';

/**
 * Leveling: Belohnungen je Stufe (LV-1e, G-07, 2026-11-15).
 *
 * Stufe 1 kennt Rollen: `level_belohnungen` mit `rolle_geben` und
 * `rolle_nehmen` je Stufe, dazu „vorherige Levelrollen entfernen“
 * (`level_einstellungen.vorherige_rollen_entfernen`). Abzeichen, XP und
 * Ereignis-Belohnungen kommen mit Stufe 3.
 *
 * **Soll statt Schritt.** Aus Stufe und Tabelle folgt, welche Rollen ein
 * Mitglied jetzt tragen soll (`sollRollen`). Abgeglichen wird gegen das, was
 * Leveling ihm selbst gegeben hat (Buch `rollen_vergaben`, Besitzer
 * `leveling:community`): Fehlendes geben, Überzähliges nehmen. Das gilt beim
 * Aufstieg, beim Abstieg (Storno) und bei `/levels sync` gleich, und eine
 * Belohnung, die die Verwaltung aus der Tabelle streicht, geht beim nächsten
 * Abgleich wieder weg.
 *
 * **Nur eigene Rollen.** Genommen wird über `Rollen.nimm`, also nur mit
 * eigenem Eintrag (Regel 1). Eine Rolle, die jemand von Hand oder ein anderes
 * System gab, nimmt Leveling nie, auch nicht mit `rolle_nehmen`; die heißt
 * hier „eine eigene Levelrolle ab dieser Stufe wieder abnehmen“. Trägt das
 * Mitglied eine Belohnungsrolle schon von Hand, bucht `vergib` nichts
 * (Regel 2), und Leveling nimmt sie später auch nicht.
 *
 * **Prestige** setzt die Stufe zurück. Belohnt wird dann wie auf der höchsten
 * Stufe, sonst gingen die Rollen beim Prestige verloren. Eigene
 * Prestige-Belohnungen kommen mit LV-3d.
 *
 * Läuft in Bot und Dashboard: `Rollen` geht im Dashboard über IPC zum Bot.
 *
 * @module leveling/shared/belohnungen
 */

const { ServiceManager } = require('dunebot-core');
const { Rollen, Ereignisse, Fortschritt } = require('dunebot-sdk');

const ROLLEN_ARTEN = Object.freeze(['rolle_geben', 'rolle_nehmen']);
const ID = /^\d{5,32}$/;

/**
 * Welche Rollen soll ein Mitglied auf dieser Stufe tragen?
 *
 * Je Rolle entscheidet die höchste Stufe ≤ Level, die sie nennt: `rolle_geben`
 * → ja, `rolle_nehmen` → nein. Nennt eine Stufe dieselbe Rolle mit beidem,
 * gilt nehmen. Mit `vorherigeEntfernen` bleiben nur die Rollen der höchsten
 * erreichten Stufe, die eine Rolle gibt.
 *
 * @param {Array<{stufe: number, art: string, wert: string}>} belohnungen
 * @param {number} level wirksame Stufe (bei Prestige die höchste)
 * @param {boolean} vorherigeEntfernen
 * @returns {Set<string>} Rollen-IDs
 */
function sollRollen(belohnungen, level, vorherigeEntfernen) {
    const stand = new Map();
    const reihe = (belohnungen || [])
        .filter((b) => ROLLEN_ARTEN.includes(b.art) && Number(b.stufe) <= level && ID.test(String(b.wert)))
        .sort((a, b) => Number(a.stufe) - Number(b.stufe) || (a.art === 'rolle_nehmen') - (b.art === 'rolle_nehmen'));
    for (const b of reihe) stand.set(String(b.wert), { traegt: b.art === 'rolle_geben', stufe: Number(b.stufe) });
    const ja = [...stand].filter(([, s]) => s.traegt);
    if (!vorherigeEntfernen || !ja.length) return new Set(ja.map(([r]) => r));
    const oben = Math.max(...ja.map(([, s]) => s.stufe));
    return new Set(ja.filter(([, s]) => s.stufe === oben).map(([r]) => r));
}

/**
 * Belohnungstabelle und Einstellung einer Guild.
 *
 * @param {string} guildId
 * @param {{query: Function}} [db]
 * @returns {Promise<{belohnungen: Array, vorherigeEntfernen: boolean}>}
 */
async function lade(guildId, db = ServiceManager.get('dbService')) {
    const belohnungen = await db.query(
        `SELECT stufe, art, wert FROM level_belohnungen WHERE guild_id = ? AND art IN (${ROLLEN_ARTEN.map(() => '?').join(', ')})`,
        [String(guildId), ...ROLLEN_ARTEN]);
    const [e] = await db.query('SELECT vorherige_rollen_entfernen FROM level_einstellungen WHERE guild_id = ?', [String(guildId)]);
    return {
        belohnungen: (belohnungen || []).map((b) => ({ stufe: Number(b.stufe), art: b.art, wert: String(b.wert) })),
        vorherigeEntfernen: Boolean(Number(e?.vorherige_rollen_entfernen || 0)),
    };
}

/** Wirksame Stufe: nach Prestige die höchste der Tabelle. */
async function wirksameStufe(guildId, level, prestige, hoechste = null) {
    if (!(Number(prestige) > 0)) return Number(level) || 0;
    const h = hoechste ?? (await Fortschritt.stufen({ guildId, kennung: 'leveling:community' })).stufen.length;
    return Math.max(Number(level) || 0, h);
}

/**
 * Rollen eines Mitglieds an seine Stufe angleichen.
 *
 * @param {object} a
 * @param {string} a.guildId
 * @param {string} a.mitglied Discord-ID
 * @param {number} a.level
 * @param {number} [a.prestige]
 * @param {import('discord.js').Guild} [a.guild] im Bot: direkt, sonst über IPC
 * @param {number} [a.hoechste] Zahl der Stufen, wenn bekannt (nur für Prestige)
 * @param {{belohnungen, vorherigeEntfernen, hoechste?}} [a.vorgeladen] für `/levels sync`
 * @param {string} [a.schluessel] für `leveling.belohnung.vergeben`
 * @returns {Promise<{vergeben: string[], entzogen: string[], blockiert: Array, gehalten: Array, kein_mitglied: boolean, fehler: string|null, soll: string[]}>}
 */
async function gleicheAb({ guildId, mitglied, level, prestige = 0, guild = null, hoechste = null, vorgeladen = null, schluessel = null }) {
    const g = String(guildId);
    const m = String(mitglied);
    const aus = { vergeben: [], entzogen: [], blockiert: [], gehalten: [], kein_mitglied: false, fehler: null, soll: [] };
    const t = vorgeladen || await lade(g);
    const eigene = new Set((await Rollen.eintraege(g, { besitzer: 'leveling:community', mitgliedId: m })).map((z) => z.rolle_id));
    if (!t.belohnungen.length && !eigene.size) return aus;

    const stufe = await wirksameStufe(g, level, prestige, hoechste ?? t.hoechste ?? null);
    const soll = sollRollen(t.belohnungen, stufe, t.vorherigeEntfernen);
    aus.soll = [...soll];
    const geben = [...soll].filter((r) => !eigene.has(r));
    const nehmen = [...eigene].filter((r) => !soll.has(r));
    const ziel = guild ? { guild, userId: m } : { guildId: g, userId: m };

    const merke = (e) => {
        aus.blockiert.push(...(e.blockiert || []));
        aus.gehalten.push(...(e.gehalten || []));
        if (e.kein_mitglied) aus.kein_mitglied = true;
        if (e.fehler && !aus.fehler) aus.fehler = e.fehler;
    };
    if (geben.length) {
        const e = await Rollen.vergib({ ...ziel, rollen: geben, besitzer: 'leveling:community', bezug: `stufe:${stufe}`, grund: `Leveling: Stufe ${stufe}` });
        aus.vergeben.push(...(e.vergeben || []));
        merke(e);
    }
    if (nehmen.length) {
        // Ist das Mitglied fort, leert `nimm` nur das eigene Buch.
        const e = await Rollen.nimm({ ...ziel, rollen: nehmen, besitzer: 'leveling:community', grund: `Leveling: Stufe ${stufe}` });
        aus.entzogen.push(...(e.entzogen || []));
        merke(e);
    }

    if (aus.vergeben.length) {
        try {
            await Ereignisse.melde('leveling.belohnung.vergeben', {
                guild_id: g,
                schluessel: schluessel || `leveling:belohnung:${g}:${m}:${stufe}:${Date.now()}`,
                akteur: 'system',
                betroffen: m,
                daten: { stufe, art: 'rolle', rollen: aus.vergeben },
            });
        } catch (error) {
            ServiceManager.get('Logger').error('[Leveling] leveling.belohnung.vergeben nicht gemeldet:', error);
        }
    }
    return aus;
}

/**
 * Wem muss `/levels sync` nachsehen? Jedes Mitglied mit Stand und jedes,
 * dem Leveling eine Rolle gegeben hat (Stand vielleicht zurückgesetzt).
 *
 * @returns {Promise<Array<{mitglied: string, level: number, prestige: number}>>}
 */
async function abzugleichen(guildId, db = ServiceManager.get('dbService')) {
    const g = String(guildId);
    const staende = await db.query(
        "SELECT mitglied_id, level, prestige FROM fortschritt_stand WHERE guild_id = ? AND kennung = 'leveling:community'", [g]);
    const aus = new Map((staende || []).map((s) => [String(s.mitglied_id), { mitglied: String(s.mitglied_id), level: Number(s.level), prestige: Number(s.prestige) }]));
    for (const z of await Rollen.eintraege(g, { besitzer: 'leveling:community' })) {
        if (!aus.has(z.mitglied_id)) aus.set(z.mitglied_id, { mitglied: z.mitglied_id, level: 0, prestige: 0 });
    }
    return [...aus.values()];
}

module.exports = { ROLLEN_ARTEN, sollRollen, lade, wirksameStufe, gleicheAb, abzugleichen };
