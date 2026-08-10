'use strict';

const { EmbedBuilder } = require('discord.js');
const { ServiceManager } = require('dunebot-core');

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

        await sendeBestaetigung(settings, guild, user);

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
 * @param {Object} settings
 * @param {import('discord.js').Guild} guild
 * @param {import('discord.js').User} user
 */
async function sendeBestaetigung(settings, guild, user) {
    let text = `Du wurdest auf **${guild.name}** verifiziert und hast jetzt vollen Zugang!`;

    if (settings.verification_success_message) {
        const platzhalter = {
            '{guild:name}': guild.name,
            '{server}': guild.name,
            '{user:name}': user.username,
            '{user:tag}': user.tag,
            '{user:mention}': `<@${user.id}>`,
            '{member:name}': user.username,
            '{member:mention}': `<@${user.id}>`,
            '{guild:memberCount}': String(guild.memberCount),
            '{count}': String(guild.memberCount)
        };

        text = settings.verification_success_message;
        for (const [schluessel, wert] of Object.entries(platzhalter)) {
            text = text.replaceAll(schluessel, wert);
        }
    }

    const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle('✅ Erfolgreich verifiziert!')
        .setDescription(text)
        .setThumbnail(guild.iconURL({ size: 128 }))
        .setTimestamp();

    // DMs können gesperrt sein. Das ist kein Fehler, sondern eine Einstellung
    // des Nutzers — die Verifizierung selbst ist längst durch.
    await user.send({ embeds: [embed] }).catch(() => {});
}
