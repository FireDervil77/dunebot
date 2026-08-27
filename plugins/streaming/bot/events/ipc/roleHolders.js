'use strict';

/**
 * IPC: Wer traegt diese Rolle gerade?
 *
 * Grundlage des Rollenabgleichs. Ohne diese Frage kann das Dashboard nicht
 * wissen, wem es eine Rolle zu Unrecht gelassen hat — und genau das passiert
 * bei jedem Neustart, der zwischen „live gegangen" und „Stream beendet" faellt.
 *
 * `guild.members.fetch()` ist noetig: Der Zwischenspeicher kennt nur, wer
 * gerade aktiv war. Abgemeldete Mitglieder fehlen dort — und behielten die
 * Rolle damit ausgerechnet dann, wenn sie am wenigsten hingucken.
 *
 * ## Zwei Fallen, beide am 2026-08-27 gemessen
 *
 * **Die Vorgabefrist ist 120 Sekunden.** `_fetchMany` in discord.js setzt
 * `time = 120e3` und lehnt danach ab. Am 2026-08-26 um 20:02:38, drei Minuten
 * nach einem Dashboard-Neustart, brauchte dieser Handler exakt 120 001 ms —
 * kalter Zwischenspeicher, die Antwort des Gateways blieb aus. Das ist der
 * Mechanismus hinter Baustelle 76: Der Aufrufer wartete mit.
 *
 * **Und der Fehlschlag war unsichtbar.** Hier stand `.catch(() => {})`. Die
 * angekommenen Bruchstuecke landen trotzdem im Zwischenspeicher, `rolle.members`
 * liefert sie aus, und der Aufrufer bekam eine **halbe Liste, die aussieht wie
 * eine ganze**. Fuer den Abgleich ist das die schlechteste aller Antworten: Wer
 * fehlt, gilt als „traegt die Rolle nicht" — und bekommt sie noch einmal
 * gegeben. Eine halbe Liste ist gefaehrlicher als gar keine, weil nur die
 * halbe wie eine Auskunft aussieht.
 *
 * Deshalb: kuerzere Frist, und ein Fehlschlag wird gemeldet. Der Aufrufer
 * (`dashboard/ausgabe/liverolle.js`) ueberspringt die Guild dann — dort steht
 * seit jeher „ueberspringen, nicht handeln", er konnte es nur nicht wissen.
 *
 * @param {Object} payload { guildId, roleId }
 * @param {Object} client Discord-Client
 * @returns {Promise<Object>} { success, traeger: string[] }
 */

/**
 * Kuerzer als die Frist des Aufrufers (30 s, `dashboard/ausgabe/drossel.js`).
 * Wer laenger braucht, soll eine **Antwort** bekommen statt eines Zeitablaufs:
 * Eine gemeldete Unvollstaendigkeit steht im Bericht, ein Zeitablauf nur im
 * Protokoll.
 */
const FRIST_MS = 20_000;

module.exports = async (payload, client) => {
    const { guildId, roleId } = payload;

    try {
        const guild = client.guilds.cache.get(guildId);
        if (!guild) return { success: false, error: 'Guild nicht gefunden', code: 10004 };

        const rolle = guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
        if (!rolle) return { success: true, traeger: [], hinweis: 'Rolle gibt es nicht mehr' };

        try {
            await guild.members.fetch({ time: FRIST_MS });
        } catch (err) {
            return {
                success: false,
                error: `Mitgliederliste unvollstaendig: ${err.message}`,
                code: err.code ?? null
            };
        }

        const traeger = rolle.members.map(m => m.id);
        return { success: true, traeger };
    } catch (error) {
        return { success: false, error: error.message, code: error.code ?? null };
    }
};
