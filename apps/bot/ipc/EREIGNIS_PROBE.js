'use strict';

const { Ereignisse } = require('dunebot-sdk');
const { ServiceManager } = require('dunebot-core');

/** Längste Verzögerung: genug für einen Dashboard-Neustart dazwischen. */
const HOECHSTENS_S = 300;

/**
 * Kern-IPC-Handler: EREIGNIS_PROBE (G-02, 2026-11-13)
 *
 * Probe des Zustellers von /admin/ereignisse aus. Der **Bot** meldet
 * `kern.ereignis.probe`, damit der Weg über zwei Prozesse geprüft wird: Zeile
 * aus dem Bot, Anstoß über IPC, Hörer im Dashboard.
 *
 * - `verzoegerung_s`: so lange wartet der Bot vor dem Melden. Startet das
 *   Dashboard in der Zeit neu, geht der Anstoß ins Leere, und der Zusteller
 *   muss die Zeile beim Start finden.
 * - `doppelt`: derselbe Schlüssel wird zweimal gemeldet. Erwartet: eine
 *   Zeile, `doppelt = 1`, ein Aufruf.
 *
 * @param {{guild_id: string, verzoegerung_s?: number, doppelt?: boolean}} payload
 * @returns {Promise<Object>} Schlüssel und, ohne Verzögerung, das Ergebnis
 */
module.exports = async (payload) => {
    const guildId = String(payload?.guild_id || '');
    const verzoegerung = Math.max(0, Math.min(HOECHSTENS_S, Math.round(Number(payload?.verzoegerung_s) || 0)));
    const doppelt = payload?.doppelt === true;
    const schluessel = `probe:${Date.now()}`;
    const angestossen = new Date();

    const melden = async () => {
        const ergebnisse = [];
        for (let i = 0; i < (doppelt ? 2 : 1); i++) {
            ergebnisse.push(await Ereignisse.melde('kern.ereignis.probe', {
                guild_id: guildId, schluessel, daten: { angestossen },
            }));
        }
        return ergebnisse;
    };

    if (!verzoegerung) return { schluessel, ergebnisse: await melden() };

    // Später melden: Die Antwort geht sofort zurück, sonst wartete die Seite.
    setTimeout(() => {
        melden()
            .then(e => ServiceManager.get('Logger').info(`[Ereignisse] Probe ${schluessel} gemeldet: ${JSON.stringify(e)}`))
            .catch(err => ServiceManager.get('Logger').error(`[Ereignisse] Probe ${schluessel} nicht gemeldet:`, err));
    }, verzoegerung * 1000);
    return { schluessel, verzoegerung_s: verzoegerung };
};
