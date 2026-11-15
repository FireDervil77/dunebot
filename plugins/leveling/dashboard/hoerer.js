'use strict';

/**
 * Leveling: Hörer der Fachereignisse im Dashboard (LV-1c, 2026-11-15).
 * Eingetragen in `dashboard/index.js` (`Ereignisse.hoere`), hier getrennt,
 * damit `scripts/check-leveling.js` sie ohne Dashboard prüft.
 *
 * @module leveling/dashboard/hoerer
 */

const { ServiceManager } = require('dunebot-core');
const { Fortschritt } = require('dunebot-sdk');
const Regeln = require('../shared/regeln');
const Belohnungen = require('../shared/belohnungen');

/**
 * automod hat eine Nachricht beanstandet → ihre XP zurück. Fand das Storno
 * keine Buchung (Taktung, zu kurz, Leveling erst später an), ist nichts zu
 * tun. Wirft es, wiederholt der Zusteller. Fällt dabei die Stufe, gehen
 * Belohnungsrollen der höheren Stufe wieder (LV-1e, über IPC im Bot);
 * scheitert das, bleibt das Storno, und `/levels sync` holt es nach.
 *
 * Grenze: Das Ereignis läuft über das Ereignisbuch und den Zusteller, die
 * Buchung im Bot direkt. Kommt das Ereignis vor der Buchung an, findet das
 * Storno nichts, und die XP bleiben. Die Buchung braucht eine Abfrage, das
 * Ereignis eine Meldung, einen Anstoß über IPC und einen Lauf des
 * Zustellers; gemessen ist die Reihenfolge nicht.
 *
 * @param {object} ereignis Umschlag aus dem Zusteller
 * @returns {Promise<{storniert: boolean, grund: string|null}>}
 */
async function automodVerstoss(ereignis) {
    const nachricht = String(ereignis.daten?.nachricht || '');
    if (!/^\d{5,32}$/.test(nachricht)) return { storniert: false, grund: 'keine_nachricht' };
    const r = await Regeln.lade(ereignis.guild_id, { frisch: true });
    if (!r) return { storniert: false, grund: 'nicht_eingerichtet' };
    if (!Number(r.einstellungen.storno_automod)) return { storniert: false, grund: 'aus' };
    const s = await Fortschritt.storniere({
        guildId: ereignis.guild_id, kennung: 'leveling:community', schluessel: `msg:${nachricht}`,
        grund: `automod: ${(ereignis.daten?.gruende || []).join(', ')}`.slice(0, 255),
    });
    if (s.wechsel) {
        try {
            await Belohnungen.gleicheAb({ guildId: ereignis.guild_id, mitglied: s.mitglied, level: s.level, prestige: s.prestige });
        } catch (error) {
            ServiceManager.get('Logger').error(`[Leveling] Belohnungen nach automod-Storno nicht angeglichen (${s.mitglied}):`, error);
        }
    }
    return { storniert: Boolean(s.gefunden && !s.schon), grund: s.gefunden ? null : 'keine_buchung' };
}

module.exports = { automodVerstoss };
