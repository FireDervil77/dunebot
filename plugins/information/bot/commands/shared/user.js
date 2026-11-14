const { EmbedUtils } = require("dunebot-sdk/utils");
const { Profil } = require("dunebot-sdk");
const { ServiceManager } = require("dunebot-core");

/**
 * `/info user` und `userinfo`: Discord-Angaben zu einem Mitglied.
 *
 * Beitritt, Konto und Rollen sammelt information seit G-12 (2026-11-14) nicht
 * mehr selbst, sondern liest die Profilabschnitte mit `sicht: "alle"` (heute
 * der Abschnitt `core:discord`). Abschnitte, die nur das Mitglied selbst oder
 * das Team sehen darf, kommen hier nie vor, denn `/info user` geht für jedes
 * Mitglied. Das ganze Profil zeigt `/profile`.
 *
 * @param {import('discord.js').GuildMember} member
 * @returns {Promise<{embeds: import('discord.js').EmbedBuilder[]}>}
 */
module.exports = async (member) => {
    const { guild } = member;
    const Logger = ServiceManager.get("Logger");

    const { abschnitte, fehler } = await Profil.abschnitte({
        guildId: guild.id,
        userId: member.id,
        mitglied: Profil.mitgliedAus(member),
        ort: "info",
        sprache: guild.locale,
    });
    for (const f of fehler) Logger.warn(`[Info] Profilabschnitt ${f.kennung} in ${guild.id}: ${f.grund}`);

    const embed = EmbedUtils.embed();

    let color = member.displayHexColor;
    if (color !== "#000000") embed.setColor(color);

    embed
        .setAuthor({
            name: guild.getT("information:INFO.USER_EMBED_TITLE", { user: member.user.username }),
            iconURL: member.user.displayAvatarURL(),
        })
        .setThumbnail(member.user.displayAvatarURL())
        .addFields(
            {
                name: guild.getT("information:INFO.USER_NAME"),
                value: member.user.username,
                inline: true,
            },
            {
                name: guild.getT("information:INFO.USER_ID"),
                value: member.id,
                inline: true,
            },
            ...Profil.discordFelder(abschnitte, Profil.uebersetzer("core", guild.locale)).slice(0, 22),
            {
                name: guild.getT("information:INFO.USER_AVATAR"),
                value: member.user.displayAvatarURL({ extension: "png" }),
            },
        )
        .setFooter({ text: guild.getT("REQUESTED_BY", { user: member.user.username }) })
        .setTimestamp(Date.now());

    if (fehler.length) {
        embed.setDescription(fehler.map((f) => guild.getT("information:INFO.USER_ABSCHNITT_FEHLT", { titel: f.titel, grund: f.grund })).join("\n").slice(0, 4000));
    }

    return { embeds: [embed] };
};
