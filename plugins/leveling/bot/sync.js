'use strict';

/**
 * Leveling: alle Mitglieder einer Guild mit ihren Belohnungsrollen abgleichen
 * (`/levels sync`, LV-1e, 2026-11-15).
 *
 * Wer: jedes Mitglied mit Stand in `leveling:community` und jedes, dem
 * Leveling eine Rolle gegeben hat. Je Mitglied `Belohnungen.gleicheAb`,
 * nacheinander; `Rollen` setzt jede Rolle einzeln, Discords Ratenbremse
 * wartet still ab.
 *
 * Das Ergebnis ist ehrlich: vergeben, entfernt, fehlgeschlagen mit Grund je
 * Rolle (`Rollen.GRUND`), gehalten von einem anderen System, nicht mehr auf
 * dem Server, Auftrag gescheitert. Je Guild läuft höchstens ein Abgleich.
 *
 * @module leveling/bot/sync
 */

const { Fortschritt } = require('dunebot-sdk');
const Belohnungen = require('../shared/belohnungen');

const laufend = new Set();

/**
 * @param {object} a
 * @param {import('discord.js').Guild} a.guild
 * @param {(stand: {fertig: number, gesamt: number}) => any} [a.fortschritt] höchstens alle `abstandMs`
 * @param {number} [a.abstandMs]
 * @returns {Promise<{laeuftSchon?: true, ohneBelohnungen?: true, gesamt, vergeben, entzogen, fehlgeschlagen: Array<{mitglied, rolle, name, grund, fehler?}>, gehalten, fort, gescheitert: Array<{mitglied, fehler}>, meldungGescheitert?: string}>}
 */
async function sync({ guild, fortschritt = null, abstandMs = 3000 }) {
    const guildId = String(guild.id);
    if (laufend.has(guildId)) return { laeuftSchon: true };
    laufend.add(guildId);
    try {
        const t = await Belohnungen.lade(guildId);
        const liste = await Belohnungen.abzugleichen(guildId);
        const aus = { gesamt: liste.length, vergeben: 0, entzogen: 0, fehlgeschlagen: [], gehalten: 0, fort: 0, gescheitert: [] };
        if (!t.belohnungen.length && !liste.length) return { ...aus, ohneBelohnungen: true };
        if (!t.belohnungen.length) aus.ohneBelohnungen = true;
        t.hoechste = (await Fortschritt.stufen({ guildId, kennung: 'leveling:community' })).stufen.length;
        const start = Date.now();
        let gemeldet = 0;
        for (const [i, s] of liste.entries()) {
            let e;
            try {
                e = await Belohnungen.gleicheAb({
                    guildId, mitglied: s.mitglied, level: s.level, prestige: s.prestige, guild, vorgeladen: t,
                    schluessel: `leveling:belohnung:sync:${guildId}:${start}:${s.mitglied}`,
                });
            } catch (error) {
                aus.gescheitert.push({ mitglied: s.mitglied, fehler: error.message });
                continue;
            }
            aus.vergeben += e.vergeben.length;
            aus.entzogen += e.entzogen.length;
            aus.gehalten += e.gehalten.length;
            if (e.kein_mitglied) aus.fort++;
            for (const b of e.blockiert) aus.fehlgeschlagen.push({ mitglied: s.mitglied, rolle: b.rolle, name: b.name, grund: b.grund, fehler: b.fehler || null });
            if (e.fehler) aus.gescheitert.push({ mitglied: s.mitglied, fehler: e.fehler });
            if (fortschritt && Date.now() - gemeldet >= abstandMs) {
                gemeldet = Date.now();
                // Scheitert die Zwischenmeldung (Antwort nach 15 min nicht mehr
                // änderbar), läuft der Abgleich weiter; der Befehl sagt es am Ende.
                try { await fortschritt({ fertig: i + 1, gesamt: liste.length }); }
                catch (error) { aus.meldungGescheitert = error.message; }
            }
        }
        return aus;
    } finally {
        laufend.delete(guildId);
    }
}

module.exports = { sync, _laufend: laufend };
