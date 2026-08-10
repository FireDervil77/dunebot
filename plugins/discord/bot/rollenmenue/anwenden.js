'use strict';

const { PermissionFlagsBits } = require('discord.js');
const { Logger } = require('dunebot-sdk/utils');

/**
 * Die berechnete Änderung tatsächlich auf ein Mitglied anwenden.
 *
 * ## Warum das eine eigene Schicht ist
 *
 * Zwischen „diese Rolle soll er bekommen" und „er hat sie" liegen vier Wege,
 * auf denen Discord Nein sagt — und **alle vier scheitern von sich aus stumm**.
 * Das ist die Stelle, an der Reaktionsrollen bei jedem Anbieter kaputtgehen:
 * Der Nutzer klickt, nichts passiert, und niemand sagt warum.
 *
 * 1. Dem Bot fehlt `Rollen verwalten`.
 * 2. Die Zielrolle steht **über** der höchsten Rolle des Bots. Discord lässt
 *    nur zu, was darunter liegt — das ist die häufigste Ursache, und sie tritt
 *    typischerweise erst später auf, wenn jemand die Bot-Rolle verschiebt.
 * 3. Die Rolle wird von einer Integration verwaltet (`role.managed`) — Bot- und
 *    Booster-Rollen lassen sich grundsätzlich nicht von Hand vergeben.
 * 4. Die Rolle gibt es nicht mehr. Im Menü steht sie noch.
 *
 * Deshalb liefert diese Funktion nicht nur zurück, was geklappt hat, sondern
 * auch was nicht — und **warum**. Die Aufrufer sagen es dem Nutzer.
 *
 * @module discord/bot/rollenmenue/anwenden
 */

/** Gründe, aus denen eine Rolle nicht gesetzt werden konnte. */
const GRUND = {
    KEIN_RECHT: 'KEIN_RECHT',
    ZU_HOCH: 'ZU_HOCH',
    VERWALTET: 'VERWALTET',
    WEG: 'WEG'
};

/**
 * @typedef {Object} Ergebnis
 * @property {string[]} vergeben  Rollen-IDs, die vergeben wurden
 * @property {string[]} entzogen  Rollen-IDs, die entzogen wurden
 * @property {Array<{rolle: string, name: string|null, grund: string}>} blockiert
 */

/**
 * Prüfen, ob der Bot diese eine Rolle anfassen darf.
 *
 * @param {import('discord.js').Guild} guild
 * @param {string} rollenId
 * @returns {{rolle: import('discord.js').Role|null, grund: string|null}}
 */
function pruefeRolle(guild, rollenId) {
    const ich = guild.members.me;

    if (!ich?.permissions?.has(PermissionFlagsBits.ManageRoles)) {
        return { rolle: null, grund: GRUND.KEIN_RECHT };
    }

    const rolle = guild.roles.cache.get(rollenId);
    if (!rolle) return { rolle: null, grund: GRUND.WEG };
    if (rolle.managed) return { rolle, grund: GRUND.VERWALTET };

    // `comparePositionTo` statt `position` direkt: bei gleicher Position
    // entscheidet in Discord das Alter der Rolle, und genau das bildet die
    // Methode ab. Ein roher Zahlenvergleich liegt dort falsch.
    if (ich.roles.highest.comparePositionTo(rolle) <= 0) {
        return { rolle, grund: GRUND.ZU_HOCH };
    }

    return { rolle, grund: null };
}

/**
 * Änderung anwenden.
 *
 * Hinzufügen und Entfernen laufen als **je ein** Discord-Aufruf, nicht als
 * einer pro Rolle. Bei `eindeutig` mit einem grossen Menü wären das sonst
 * schnell ein Dutzend Anfragen für einen einzigen Klick — und Discord bremst
 * dann den ganzen Bot aus, nicht nur dieses Menü.
 *
 * @param {import('discord.js').GuildMember} member
 * @param {{hinzufuegen: string[], entfernen: string[]}} aenderung
 * @param {string} [grundText] Erscheint im Discord-Audit-Log
 * @returns {Promise<Ergebnis>}
 */
async function wendeAn(member, aenderung, grundText = 'Rollenmenü') {
    const guild = member.guild;
    const ergebnis = { vergeben: [], entzogen: [], blockiert: [] };

    const erlaubt = { hinzufuegen: [], entfernen: [] };

    for (const [richtung, rollen] of [['hinzufuegen', aenderung.hinzufuegen],
                                      ['entfernen', aenderung.entfernen]]) {
        for (const rollenId of rollen || []) {
            const { rolle, grund } = pruefeRolle(guild, rollenId);
            if (grund) {
                ergebnis.blockiert.push({ rolle: rollenId, name: rolle?.name || null, grund });
                continue;
            }
            erlaubt[richtung].push(rollenId);
        }
    }

    try {
        if (erlaubt.hinzufuegen.length > 0) {
            await member.roles.add(erlaubt.hinzufuegen, grundText);
            ergebnis.vergeben = erlaubt.hinzufuegen;
        }
        if (erlaubt.entfernen.length > 0) {
            await member.roles.remove(erlaubt.entfernen, grundText);
            ergebnis.entzogen = erlaubt.entfernen;
        }
    } catch (err) {
        // Hierher kommt, was die Vorprüfung nicht sehen konnte: eine Rolle, die
        // zwischen Prüfung und Aufruf verschoben wurde, oder ein Aussetzer der
        // Discord-API. Als blockiert melden, damit der Nutzer eine Antwort
        // bekommt statt eines stummen Nichts.
        Logger.warn(`[Discord] Rollenmenü: Änderung für ${member.user?.tag} fehlgeschlagen: ${err.message}`);

        for (const rollenId of [...erlaubt.hinzufuegen, ...erlaubt.entfernen]) {
            if (ergebnis.vergeben.includes(rollenId) || ergebnis.entzogen.includes(rollenId)) continue;
            ergebnis.blockiert.push({
                rolle: rollenId,
                name: guild.roles.cache.get(rollenId)?.name || null,
                grund: GRUND.KEIN_RECHT
            });
        }
    }

    return ergebnis;
}

module.exports = { GRUND, pruefeRolle, wendeAn };
