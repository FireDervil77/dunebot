'use strict';

const { ServiceManager } = require('dunebot-core');
const { baueVerifiziert } = require('../utils');

/**
 * Verifizierung per Reaktion.
 *
 * Wer auf die Verifizierungsnachricht reagiert, bekommt die Rolle für
 * bestätigte Mitglieder und verliert die für unbestätigte.
 *
 * ## Was hier bis zum 2026-08-10 zusätzlich stand
 *
 * Ein zweiter Abschnitt für **Rollenmenüs** (`greeting_reaction_panels`). Der
 * ist ins `discord`-Plugin umgezogen: `greeting` ist der Beitrittsweg, und ein
 * Menü, aus dem sich Mitglieder Monate später eine Farbe aussuchen, gehört
 * nicht zum Beitritt. Dort gibt es ihn jetzt in vier Modi statt einem, dazu
 * mit Knöpfen und Auswahllisten.
 *
 * Die Verifizierung bleibt hier — sie benutzt eigene Spalten in
 * `greeting_settings` und ist Teil des Beitritts.
 *
 * @param {import('discord.js').MessageReaction} reaction
 * @param {import('discord.js').User} user
 */
module.exports = async (reaction, user) => {
    if (user.bot) return;

    // Bei älteren Nachrichten schickt Discord nur ein Bruchstück — der Bot war
    // beim Versand nicht dabei. Ohne Nachladen wüsste er nicht, worauf reagiert
    // wurde.
    if (reaction.partial) {
        try { await reaction.fetch(); } catch { return; }
    }
    if (reaction.message.partial) {
        try { await reaction.message.fetch(); } catch { return; }
    }

    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const { guild } = reaction.message;
    if (!guild) return;

    try {
        const [settings] = await dbService.query(
            `SELECT * FROM greeting_settings
             WHERE guild_id = ?
               AND verification_enabled = 1
               AND verification_type = 'reaction'
               AND verification_message_id = ?`,
            [guild.id, reaction.message.id]
        ) || [];

        if (!settings) return;

        const erwartet = settings.verification_emoji || '✅';
        if (reaction.emoji.name !== erwartet && reaction.emoji.toString() !== erwartet) return;

        // Erst jetzt das Mitglied holen — vorher wäre es ein Discord-Aufruf für
        // jede Reaktion auf jede beliebige Nachricht des Servers.
        const member = await guild.members.fetch(user.id).catch(() => null);
        if (!member) return;

        const verifiziertId = settings.verification_role_id;
        const unverifiziertId = settings.verification_remove_role_id;

        // Schon verifiziert? Dann nichts tun — sonst käme die
        // Bestätigungsnachricht bei jedem erneuten Reagieren.
        if (verifiziertId && member.roles.cache.has(verifiziertId)) return;

        if (verifiziertId) {
            const rolle = guild.roles.cache.get(verifiziertId);
            if (rolle && guild.members.me.roles.highest.comparePositionTo(rolle) > 0) {
                await member.roles.add(rolle);
                Logger.info(`[Greeting] ${user.tag} per Reaktion verifiziert — Rolle ${rolle.name} vergeben`);
            }
        }

        if (unverifiziertId) {
            const rolle = guild.roles.cache.get(unverifiziertId);
            if (rolle && guild.members.me.roles.highest.comparePositionTo(rolle) > 0) {
                await member.roles.remove(rolle);
            }
        }

        await sendeBestaetigung(member, user, Logger);

    } catch (error) {
        Logger.error(`[Greeting] messageReactionAdd fehlgeschlagen für ${user.tag}`, error);
    }
};

/**
 * Die Bestätigung per DM.
 *
 * ## Der Fehler, der hier bis zum 2026-08-10 stand
 *
 * Zwei Zeilen lasen `settings.verification_success_message`, obwohl die
 * Variable in dieser Datei `verifySettings` hiess. Das ist ein ReferenceError
 * bei **jeder** Verifizierung per Reaktion. Er fiel nicht auf, weil er in einem
 * `try` steckte und die Rolle vorher schon vergeben war: Die Verifizierung
 * wirkte, nur die Bestätigung kam nie an, und im Protokoll stand eine Zeile,
 * die niemand mit dem Vorgang in Verbindung brachte.
 *
 * Eigene Funktion, damit der Fehlerfall die Verifizierung nicht mit sich reisst
 * — gesperrte DMs sind der Normalfall, nicht die Ausnahme.
 *
 * Seit K389 (2026-11-14) dieselbe Vorlage `greeting:verifiziert` wie nach
 * Knopf und Captcha. Bis dahin stand hier eine zweite Kopie der eigenen
 * Platzhalter-Tabelle ({user:name}, {user:tag}, {user:mention}).
 *
 * @param {import('discord.js').GuildMember} member
 * @param {import('discord.js').User} user
 * @param {Object} Logger
 */
async function sendeBestaetigung(member, user, Logger) {
    const nachricht = await baueVerifiziert(member);
    // DMs können gesperrt sein (Discord 50007). Das ist eine Einstellung des
    // Nutzers, kein Fehler — die Verifizierung selbst ist längst durch.
    await user.send(nachricht).catch((err) => {
        if (err?.code === 50007) return;
        Logger.warn(`[Greeting] Bestätigung an ${user.tag} nicht gesendet: ${err.message}`);
    });
}
