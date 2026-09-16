'use strict';

const { EmbedBuilder, ChannelType, AuditLogEvent } = require("discord.js");
const { ServiceManager } = require("dunebot-core");

const { einladerAusProtokoll, kanalWaehlen, linksBauen } = require("./willkommenEntscheidung");

/**
 * Die Begruessung, wenn der Bot einer Guild beitritt.
 *
 * Sie geht an **zwei** Stellen, weil beide fuer sich ausfallen koennen:
 *   - als DM an den, der den Bot eingeladen hat (aus dem Audit-Log; DMs sind
 *     oft zu),
 *   - in den Systemkanal der Guild, ersatzweise in den obersten Kanal, in dem
 *     der Bot schreiben darf.
 *
 * Kein Teil bricht den anderen ab, und keiner bricht den Beitritt ab. Was
 * scheitert, steht im Log — nicht in einem verschluckten `catch`.
 *
 * Die Sprache steht zu diesem Zeitpunkt schon fest: `GuildManager`
 * uebernimmt sie aus der Discord-Einstellung der Guild und setzt `guild.locale`.
 *
 * @param {import('discord.js').Guild} guild
 * @returns {Promise<{dm: string, kanal: string}>} was mit beiden Wegen geschah
 */
async function willkommenSenden(guild) {
    const Logger = ServiceManager.get("Logger");
    const ergebnis = { dm: "nicht_versucht", kanal: "nicht_versucht" };

    const basis = process.env.DASHBOARD_BASE_URL || "";
    const links = linksBauen(basis, guild.id);
    if (!links) {
        Logger.error(
            `[Willkommen] DASHBOARD_BASE_URL fehlt in apps/bot/.env — die Begruessung ` +
            `fuer ${guild.name} (${guild.id}) geht ohne Links heraus.`
        );
    }

    const einbettung = begruessungBauen(guild, links);

    // 1. DM an den Einlader
    const einladerId = await einladerFinden(guild);
    if (!einladerId) {
        ergebnis.dm = "einlader_unbekannt";
    } else {
        try {
            const nutzer = await guild.client.users.fetch(einladerId);
            await nutzer.send({ embeds: [einbettung] });
            ergebnis.dm = "gesendet";
            Logger.success(`[Willkommen] DM an Einlader ${einladerId} fuer ${guild.name}`);
        } catch (err) {
            // Sehr haeufig: „Cannot send messages to this user" — DMs zu.
            ergebnis.dm = "abgelehnt";
            Logger.warn(`[Willkommen] DM an ${einladerId} nicht moeglich: ${err.message}`);
        }
    }

    // 2. Nachricht in einen Kanal
    const kanalId = kanalWaehlen({
        systemKanalId: guild.systemChannelId || null,
        kanaele: schreibbareKanaele(guild),
    });

    if (!kanalId) {
        ergebnis.kanal = "kein_kanal";
        Logger.warn(
            `[Willkommen] In ${guild.name} (${guild.id}) darf der Bot in keinen Kanal ` +
            `schreiben — es bleibt bei der DM.`
        );
    } else {
        try {
            const kanal = guild.channels.cache.get(kanalId);
            await kanal.send({ embeds: [einbettung] });
            ergebnis.kanal = "gesendet";
            Logger.success(`[Willkommen] Begruessung in #${kanal.name} (${guild.name})`);
        } catch (err) {
            ergebnis.kanal = "fehlgeschlagen";
            Logger.error(`[Willkommen] Kanalnachricht in ${guild.name} fehlgeschlagen:`, err);
        }
    }

    return ergebnis;
}

/**
 * Holt die Kanaele, in denen der Bot schreiben darf, in der Form, die
 * `kanalWaehlen()` erwartet.
 *
 * `guild.canSendEmbeds()` steckt in `apps/bot/extenders/Guild.js` und prueft
 * ViewChannel, SendMessages und EmbedLinks in einem.
 *
 * @param {import('discord.js').Guild} guild
 * @returns {Array<{id: string, position: number, darfSchreiben: boolean}>}
 */
function schreibbareKanaele(guild) {
    const TYPEN = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

    return guild.channels.cache
        .filter((kanal) => TYPEN.includes(kanal.type))
        .map((kanal) => ({
            id: kanal.id,
            position: kanal.rawPosition,
            darfSchreiben: Boolean(guild.canSendEmbeds(kanal)),
        }));
}

/**
 * Fragt das Audit-Log, wer den Bot hinzugefuegt hat.
 *
 * Braucht das Recht „Audit-Log ansehen". Es steckt im Einladungslink, kann der
 * Guild-Leitung danach aber entzogen worden sein — dann faellt die DM weg und
 * das steht im Log.
 *
 * @param {import('discord.js').Guild} guild
 * @returns {Promise<string|null>}
 */
async function einladerFinden(guild) {
    const Logger = ServiceManager.get("Logger");

    try {
        const protokoll = await guild.fetchAuditLogs({ type: AuditLogEvent.BotAdd, limit: 10 });

        const eintraege = [...protokoll.entries.values()].map((eintrag) => ({
            zielId: eintrag.targetId,
            ausfuehrenderId: eintrag.executorId || eintrag.executor?.id || null,
            erstelltMs: eintrag.createdTimestamp,
        }));

        const einladerId = einladerAusProtokoll(eintraege, guild.client.user.id, Date.now());
        if (!einladerId) {
            Logger.warn(
                `[Willkommen] Kein frischer BotAdd-Eintrag fuer ${guild.name} — ` +
                `${eintraege.length} Eintraege gelesen, keiner passt.`
            );
        }
        return einladerId;
    } catch (err) {
        Logger.warn(`[Willkommen] Audit-Log von ${guild.name} nicht lesbar: ${err.message}`);
        return null;
    }
}

/**
 * Baut die Einbettung in der Sprache der Guild.
 *
 * @param {import('discord.js').Guild} guild
 * @param {Object|null} links
 * @returns {EmbedBuilder}
 */
function begruessungBauen(guild, links) {
    const t = (schluessel, args) => guild.getT(`core:WILLKOMMEN.${schluessel}`, args);

    const einbettung = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(t("TITEL"))
        .setDescription(t("TEXT", { server: guild.name }))
        .setTimestamp();

    if (guild.client.user) {
        einbettung.setThumbnail(guild.client.user.displayAvatarURL());
    }

    if (links) {
        einbettung.addFields({
            name: t("SCHRITTE_TITEL"),
            value: [
                `**1.** [${t("SCHRITT_SPRACHE")}](${links.sprache})`,
                `**2.** [${t("SCHRITT_PLUGINS")}](${links.plugins})`,
                `**3.** [${t("SCHRITT_RECHTE")}](${links.rechte})`,
                `**4.** [${t("SCHRITT_HILFE")}](${links.hilfe})`,
            ].join("\n"),
        });
        einbettung.addFields({
            name: t("SEITE_TITEL"),
            value: `[${t("SEITE_LINK")}](${links.willkommen})`,
        });
    }

    einbettung.setFooter({ text: t("FUSS") });
    return einbettung;
}

module.exports = { willkommenSenden };
