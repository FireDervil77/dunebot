const { AttachmentBuilder } = require("discord.js");
const { EmbedUtils } = require("dunebot-sdk/utils");
const { Profil, Bildkarte, Gestaltung } = require("dunebot-sdk");
const { ServiceManager } = require("dunebot-core");

/**
 * `/profile` — das eigene Profil auf diesem Server (G-12, K382).
 *
 * Nur das eigene (Betreiber 2026-11-14): keine Option für ein anderes
 * Mitglied. Wer andere sehen darf, sieht sie im Dashboard unter „Mitglieder“.
 * Die Antwort ist nur für den Fragenden sichtbar, denn sie enthält Daten, die
 * die Guild über ihn hat (Giveaways, Musik) und verbundene Konten.
 *
 * Oben die Bildkarte `kern:profil`, so eingestellt, wie die Guild sie im
 * Bereich „Bildkarten“ hat; die drei Kacheln füllen die ersten Abschnitte mit
 * Kachel. Darunter je Abschnitt ein Feld. Abschnitte mit `discord: false`
 * (Moderation, Automod) kommen hier nie vor. Was nicht lesbar war, steht da.
 *
 * Leveling bringt keinen eigenen `/profile`, sondern liefert seinen Abschnitt
 * (Betreiber 2026-11-14).
 *
 * @type {import('dunebot-sdk').CommandType}
 */
module.exports = {
    name: "profile",
    description: "core:PROFIL.DESCRIPTION",
    botPermissions: ["EmbedLinks", "AttachFiles"],
    command: {
        enabled: false,
    },
    slashCommand: {
        enabled: true,
        ephemeral: true,
        // Leer, aber da: `/help profile` (getSlashUsage) liest options.find.
        options: [],
    },

    async interactionRun({ interaction }) {
        const { guild, member } = interaction;
        const t = (schluessel, werte) => guild.getT(`core:PROFIL.${schluessel}`, werte);
        const tKern = Profil.uebersetzer("core", guild.locale);
        const Logger = ServiceManager.get("Logger");

        const mitglied = Profil.mitgliedAus(member);
        const { abschnitte, fehler } = await Profil.abschnitte({
            guildId: guild.id,
            userId: member.id,
            mitglied,
            ort: "discord",
            betrachterId: interaction.user.id,
            sprache: guild.locale,
        });
        for (const f of fehler) Logger.warn(`[Profil] ${f.kennung} in ${guild.id}: ${f.grund}`);

        const files = [];
        const unten = fehler.map((f) => t("FEHLER", { titel: f.titel, grund: f.grund }));
        const embed = EmbedUtils.embed()
            .setTitle(t("TITEL", { name: member.displayName }))
            .setColor(await Gestaltung.farbe(guild.id, "akzent"));

        try {
            const karte = await Bildkarte.zeichneNutzung("core", "kern:profil", { member, guild, werte: Profil.kacheln(abschnitte) }, { guildId: guild.id });
            const name = karte.dateiname("profil");
            files.push(new AttachmentBuilder(karte.puffer, { name }));
            embed.setImage(`attachment://${name}`);
            for (const h of karte.hinweise) Logger.debug(`[Profil] Karte in ${guild.id}: ${h}`);
        } catch (err) {
            Logger.warn(`[Profil] Karte in ${guild.id} nicht gezeichnet:`, err);
            unten.push(t("KARTE_FEHLT", { grund: err.message }));
        }

        const felder = Profil.discordFelder(abschnitte, tKern);
        if (felder.length) embed.addFields(felder);
        if (!abschnitte.length) unten.unshift(t("LEER"));
        if (unten.length) embed.setDescription(unten.join("\n").slice(0, 4000));
        embed.setFooter({ text: t("NUR_DU") });

        await interaction.editReply({ embeds: [embed], files });
    },
};
