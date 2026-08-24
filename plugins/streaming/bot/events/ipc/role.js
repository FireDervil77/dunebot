'use strict';

/**
 * IPC: Live-Rolle geben oder nehmen.
 *
 * Der Bot entscheidet auch hier nichts — er bekommt Mitglied, Rolle und
 * Richtung und setzt sie. Ob jemand live ist, weiss das Dashboard.
 *
 * **Drei Faelle, die wie Fehler aussehen und keine sind:**
 *
 *   - Das Mitglied hat den Server verlassen. Dann gibt es nichts zu tun, und
 *     ein Fehler wuerde den Auftrag fuenfmal wiederholen lassen.
 *   - Die Rolle wurde geloescht. Dasselbe.
 *   - Das Mitglied hat die Rolle schon (oder schon nicht). Discord antwortet
 *     dann mit Erfolg; wir melden es trotzdem als `unveraendert`, damit im
 *     Protokoll steht, was wirklich passiert ist.
 *
 * Ein **echter** Fehler ist nur: Der Bot darf die Rolle nicht vergeben. Der
 * gehoert gemeldet, denn er bleibt bestehen, bis jemand etwas aendert.
 *
 * @param {Object} payload { guildId, userId, roleId, aktion }
 * @param {Object} client Discord-Client
 * @returns {Promise<Object>} { success, geaendert } oder { success: false, error, code }
 */
module.exports = async (payload, client) => {
    const { guildId, userId, roleId, aktion } = payload;

    if (aktion !== 'geben' && aktion !== 'nehmen') {
        return { success: false, error: `Unbekannte Aktion "${aktion}"`, code: null };
    }

    try {
        const guild = client.guilds.cache.get(guildId);
        if (!guild) return { success: false, error: 'Guild nicht gefunden', code: 10004 };

        const rolle = guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
        if (!rolle) return { success: true, geaendert: false, hinweis: 'Rolle gibt es nicht mehr' };

        // Der Bot kann nur Rollen vergeben, die UNTER seiner hoechsten stehen.
        // Das ist die haeufigste Ursache, wenn eine Live-Rolle nie erscheint —
        // und man sieht es der Rolle nicht an. Deshalb eine eigene Meldung
        // statt eines nackten "Missing Permissions".
        const ich = guild.members.me;
        if (ich && rolle.position >= ich.roles.highest.position) {
            return {
                success: false,
                error: `Die Rolle "${rolle.name}" steht in der Rangliste ueber der Bot-Rolle — verschiebe sie darunter`,
                code: 50013
            };
        }

        const mitglied = await guild.members.fetch(userId).catch(() => null);
        if (!mitglied) return { success: true, geaendert: false, hinweis: 'Mitglied ist nicht mehr auf dem Server' };

        const hatSie = mitglied.roles.cache.has(roleId);
        if (aktion === 'geben' && hatSie)  return { success: true, geaendert: false, hinweis: 'hatte die Rolle schon' };
        if (aktion === 'nehmen' && !hatSie) return { success: true, geaendert: false, hinweis: 'hatte die Rolle nicht' };

        if (aktion === 'geben') await mitglied.roles.add(roleId, 'Streaming: ist live');
        else                    await mitglied.roles.remove(roleId, 'Streaming: Stream beendet');

        return { success: true, geaendert: true };
    } catch (error) {
        return { success: false, error: error.message, code: error.code ?? null };
    }
};
