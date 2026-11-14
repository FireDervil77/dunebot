'use strict';

const { Rollen } = require('dunebot-sdk');
const { autorollen } = require('../shared/rollen');

/**
 * Ein Mitglied verifizieren: Rolle „verifiziert“ geben, Rolle „unverifiziert“
 * abgeben (G-07, 2026-11-14). Ein Weg für Knopf, Captcha und Reaktion; bis
 * dahin stand dasselbe zweimal, mit zwei verschiedenen Rangprüfungen.
 *
 * - „verifiziert“ gibt `Rollen.vergib` mit Besitzer `greeting:verifiziert`.
 * - „unverifiziert“ nimmt `Rollen.gibAb` (das Mitglied bedient es selbst,
 *   F-G12 Punkt 2): auch ohne Eintrag, also auch bei allen, die vor G-07
 *   beigetreten sind. Hält ein anderes System sie, bleibt sie.
 * - Ist die Rolle „unverifiziert“ zugleich eine Autorolle (gemessen
 *   2026-11-14 in einer Guild), hält greeting sie zweimal. Mit dem
 *   Verifizieren endet auch der Halt der Autorolle, sonst bliebe jeder
 *   unverifiziert.
 *
 * @param {import('discord.js').GuildMember} member
 * @param {Object} settings Zeile aus greeting_settings
 * @param {Object} Logger
 * @returns {Promise<{vergeben: Object, abgegeben: Object|null}>}
 */
async function verifiziere(member, settings, Logger) {
    const verifiziert = settings.verification_role_id ? String(settings.verification_role_id) : null;
    const unverifiziert = settings.verification_remove_role_id ? String(settings.verification_remove_role_id) : null;

    const vergeben = await Rollen.vergib({ mitglied: member, rollen: verifiziert, besitzer: 'greeting:verifiziert', grund: 'verifiziert' });
    let abgegeben = null;
    if (unverifiziert) {
        if (autorollen(settings).includes(unverifiziert)) {
            await Rollen.nimm({ mitglied: member, rollen: unverifiziert, besitzer: 'greeting:autorolle', grund: 'verifiziert' });
        }
        abgegeben = await Rollen.gibAb({ mitglied: member, rollen: unverifiziert, besitzer: 'greeting:unverifiziert', grund: 'verifiziert' });
    }

    for (const b of [...vergeben.blockiert, ...(abgegeben?.blockiert || [])]) {
        Logger.warn(`[Greeting] Verifizierung ${member.user?.tag}: Rolle ${b.name || b.rolle} nicht gesetzt (${b.grund}${b.fehler ? `: ${b.fehler}` : ''})`);
    }
    for (const g of abgegeben?.gehalten || []) {
        Logger.info(`[Greeting] Verifizierung ${member.user?.tag}: „unverifiziert“ bleibt, hält noch ${g.von.join(', ')}`);
    }
    if (vergeben.vergeben.length) Logger.info(`[Greeting] ${member.user?.tag} verifiziert, Rolle ${verifiziert} vergeben`);
    return { vergeben, abgegeben };
}

module.exports = { verifiziere };
