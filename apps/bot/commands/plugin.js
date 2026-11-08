const {
    ApplicationCommandOptionType,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ChatInputCommandInteraction,
    ComponentType,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} = require("discord.js");
const { EmbedUtils } = require("dunebot-sdk/utils");
const { ServiceManager } = require("dunebot-core");

/**
 * @type {import('dunebot-sdk').CommandType}
 */
module.exports = {
    name: "plugin",
    description: "core:PLUGIN.DESCRIPTION",
    userPermissions: ["ManageGuild"],
    command: {
        enabled: true,
        minArgsCount: 1,
        subcommands: [
            {
                trigger: "list",
                description: "core:PLUGIN.SUB_LIST",
            },
            {
                trigger: "info <plugin>",
                description: "core:PLUGIN.SUB_INFO",
            },
            {
                trigger: "status",
                description: "core:PLUGIN.SUB_STATUS",
            },
        ],
    },
    slashCommand: {
        enabled: true,
        ephemeral: true,
        options: [
            {
                name: "list",
                type: ApplicationCommandOptionType.Subcommand,
                description: "core:PLUGIN.SUB_LIST",
            },
            {
                name: "info",
                description: "core:PLUGIN.SUB_INFO",
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    {
                        name: "name",
                        description: "core:PLUGIN.SUB_OPT_NAME",
                        type: ApplicationCommandOptionType.String,
                        required: true,
                    },
                ],
            },
            {
                name: "status",
                description: "core:PLUGIN.SUB_STATUS",
                type: ApplicationCommandOptionType.Subcommand,
            },
        ],
    },

    async messageRun({ message, args }) {
        const [sub, plugin] = args;
        let resp;

        switch (sub?.toLowerCase()) {
            case "list":
                resp = await listPlugins(message);
                break;

            case "info":
                resp = await pluginInfo(message, plugin);
                break;

            case "status":
                return await pluginStatus(message);

            default:
                resp = message.guild.getT("INVALID_SUBCOMMAND", { sub });
                break;
        }

        await message.reply(resp);
    },

    async interactionRun({ interaction }) {
        const sub = interaction.options.getSubcommand();
        const plugin = interaction.options.getString("name");

        let resp;
        switch (sub.toLowerCase()) {
            case "list":
                resp = await listPlugins(interaction);
                break;

            case "info":
                resp = await pluginInfo(interaction, plugin);
                break;

            case "status":
                return await pluginStatus(interaction);
        }

        await interaction.followUp(resp);
    },
};

/**
 * @param {import('discord.js').Message | import('discord.js').CommandInteraction} arg0
 */
async function listPlugins({ client, guild }) {
    const dbService = ServiceManager.get("dbService");
    const plugins = client.pluginManager.plugins.filter(p => !p.ownerOnly && client.pluginManager.istVerfuegbar(p.name, guild.id));
    
    // NEU: Aktivierte Plugins aus guild_plugins laden
    const enabled_plugins = await dbService.getEnabledPlugins(guild.id);

    const embed = EmbedUtils.embed()
        .setAuthor({ name: guild.getT("core:PLUGIN.LIST_EMBED_TITLE") })
        .addFields(
            plugins.map((p) => {
                const status = enabled_plugins.includes(p.name)
                    ? guild.getT("core:PLUGIN.ENABLED")
                    : guild.getT("core:PLUGIN.DISABLED");
                return {
                    name: p.name,
                    value: status,
                    inline: true,
                };
            }),
        )
        .setFooter({
            text: guild.getT("core:PLUGIN.LIST_EMBED_FOOTER", { count: plugins.length }),
        });

    return { embeds: [embed] };
}

/**
 * @param {import('discord.js').Message | import('discord.js').CommandInteraction} arg0
 * @param {string} plugin
 */
async function pluginInfo({ client, guild }, plugin) {
    const dbService = ServiceManager.get("dbService");
    if (!plugin) return guild.getT("core:PLUGIN.INFO_MISSING_PLUGIN");

    const p = client.pluginManager.plugins
        .filter(p => !p.ownerOnly && client.pluginManager.istVerfuegbar(p.name, guild.id))
        .find(p => p.name === plugin);
    if (!p) return guild.getT("core:PLUGIN.NOT_FOUND", { plugin });

    // NEU: Aktivierte Plugins aus guild_plugins laden
    const enabled_plugins = await dbService.getEnabledPlugins(guild.id);

    const embed = EmbedUtils.embed()
        .setAuthor({ name: guild.getT("core:PLUGIN.INFO_EMBED_TITLE", { plugin }) })
        .setDescription(
            guild.getT("core:PLUGIN.INFO_EMBED_DESC", {
                name: p.name,
                version: p.version,
                status: enabled_plugins.includes(p.name)
                    ? guild.getT("core:PLUGIN.ENABLED")
                    : guild.getT("core:PLUGIN.DISABLED"),
                prefixCmds: [...p.commands].filter((c) => c.command.enabled).length,
                slashCmds: [...p.commands].filter((c) => c.slashCommand.enabled).length,
            }),
        );

    return { embeds: [embed] };
}

/**
 * Wie lange auf das Dashboard gewartet wird. Abschalten stoppt und löscht jeden
 * Gameserver der Guild (höchstens etwa vier Minuten je Server); eine Antwort
 * an Discord bleibt 15 Minuten änderbar.
 */
const DASHBOARD_FRIST_MS = 13 * 60 * 1000;

/** Hat jemand genau die abzuschaltenden Plugins eingetippt? Reihenfolge und Großschreibung egal. */
function namenStimmen(eingabe, soll) {
    const getippt = new Set(String(eingabe ?? '').toLowerCase().split(/[\s,;]+/).filter(Boolean));
    return getippt.size === soll.length && soll.every(n => getippt.has(n.toLowerCase()));
}

/**
 * `/plugin status` — Plugins der Guild ein- und abschalten (F4, Betreiber 2026-11-07).
 *
 * Die Aufgaben sind geteilt: Das Dashboard schaltet ein und ab und löscht beim
 * Abschalten die Inhalte der Guild (PluginManager.disableInGuild, F30/K067).
 * Der Bot folgt nur, wo das Dashboard Erfolg meldet, und sagt in Discord, wie
 * es ausging, auch einen Abbruch mit Grund. Abschalten ist endgültig, deshalb
 * fragt ein Fenster nach den Namen, wie der rote Dialog im Dashboard.
 *
 * Bis 2026-11-07 schaltete der Bot jedes nicht gewählte Plugin selbst ab, ohne
 * Rückfrage, auch schon abgeschaltete, benachrichtigte das Dashboard danach mit
 * `.catch(() => {})` und meldete immer Erfolg.
 *
 * @param {import('discord.js').Message | import('discord.js').ChatInputCommandInteraction} arg0
 */
async function pluginStatus(arg0) {
    const dbService = ServiceManager.get("dbService");
    const { client, guild } = arg0;
    const t = (schluessel, werte) => guild.getT(`core:PLUGIN.${schluessel}`, werte);

    const enabled_plugins = await dbService.getEnabledPlugins(guild.id);
    const waehlbar = client.pluginManager.plugins.filter((p) => !p.ownerOnly && client.pluginManager.istVerfuegbar(p.name, guild.id));

    const options = [];
    for (const p of waehlbar) {
        const isEnabled = enabled_plugins.includes(p.name);
        options.push({
            label: `${isEnabled ? "✅" : "🔴"} ${p.name}`,
            value: p.name,
            description: isEnabled ? t("ENABLED") : t("DISABLED"),
            default: isEnabled,
        });
    }

    const menuRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId("plugin-status-menu")
            .setPlaceholder(t("STATUS_SELECT_PLACEHOLDER"))
            .addOptions(options)
            .setMinValues(0)
            .setMaxValues(options.length),
    );

    // In der Kontroll-Guild bleiben die Inhalte (F19/F30) — die Warnung sagt das.
    const kontrollGuild = String(guild.id) === String(process.env.CONTROL_GUILD_ID);
    const reply = {
        content: `${t("STATUS_SELECT_PROMPT")}\n${t(kontrollGuild ? "STATUS_SELECT_CONTROL" : "STATUS_SELECT_WARNING")}`,
        components: [menuRow],
    };
    const sentMsg =
        arg0 instanceof ChatInputCommandInteraction
            ? await arg0.followUp(reply)
            : await arg0.reply(reply);

    const zeigeOhneAuswahl = (content) => (arg0 instanceof ChatInputCommandInteraction
        ? arg0.editReply({ content, components: [] })
        : sentMsg.edit({ content, components: [] }));

    // Ein Zeitablauf wirft; er heißt „keine Auswahl" und wird so gemeldet.
    const waiter = await sentMsg.channel
        .awaitMessageComponent({
            filter: (i) => i.customId === "plugin-status-menu" && i.user.id === arg0.member.id,
            componentType: ComponentType.StringSelect,
            time: 60000,
            dispose: true,
        })
        .catch(() => null);
    if (!waiter) return zeigeOhneAuswahl(t("STATUS_SELECT_TIMEOUT"));

    const gewaehlt = new Set(waiter.values);
    const kandidaten = waehlbar.filter((p) => p.name !== "core").map((p) => p.name);
    const einschalten = kandidaten.filter((n) => gewaehlt.has(n) && !enabled_plugins.includes(n));
    const abschalten = kandidaten.filter((n) => !gewaehlt.has(n) && enabled_plugins.includes(n));

    if (!einschalten.length && !abschalten.length) {
        return waiter.update({ content: t("STATUS_NOTHING"), components: [] });
    }

    let anzeige;
    if (abschalten.length) {
        const fensterId = `plugin-abschalten-${waiter.id}`;
        await waiter.showModal(new ModalBuilder({
            customId: fensterId,
            title: t("STATUS_CONFIRM_TITLE"),
            components: [
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId("namen")
                        .setLabel(t("STATUS_CONFIRM_LABEL"))
                        .setPlaceholder(abschalten.join(", ").slice(0, 100))
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true),
                ),
            ],
        }));
        // Ein Zeitablauf wirft; er heißt „nicht bestätigt".
        const bestaetigung = await waiter
            .awaitModalSubmit({ time: 120000, filter: (m) => m.customId === fensterId && m.user.id === waiter.user.id })
            .catch(() => null);
        if (!bestaetigung) return zeigeOhneAuswahl(t("STATUS_CONFIRM_TIMEOUT"));
        if (!namenStimmen(bestaetigung.fields.getTextInputValue("namen"), abschalten)) {
            return bestaetigung.update({ content: t("STATUS_CONFIRM_MISMATCH", { soll: abschalten.join(", ") }), components: [] });
        }
        anzeige = await bestaetigung.update({ content: t("STATUS_SELECT_PROCESSING"), components: [] });
    } else {
        anzeige = await waiter.update({ content: t("STATUS_SELECT_PROCESSING"), components: [] });
    }

    // Erst das Dashboard: Es schaltet und löscht, der Bot folgt den Erfolgen.
    const ipcClient = ServiceManager.get("ipcClient");
    const antwort = ipcClient
        ? await ipcClient.sendToDashboard("core:UPDATE_PLUGIN_STATUS",
            { guildId: guild.id, enabled: einschalten, disabled: abschalten, userId: waiter.user.id }, DASHBOARD_FRIST_MS)
        : { success: false, error: "keine Verbindung zum Dashboard" };
    const ergebnisse = antwort?.data?.ergebnisse;
    if (!Array.isArray(ergebnisse)) {
        return anzeige.edit({ content: t("STATUS_NO_DASHBOARD", { grund: antwort?.error || "keine Antwort" }), components: [] });
    }

    const an = [], aus = [], zeilen = [];
    for (const e of ergebnisse) {
        if (!e.ok) {
            zeilen.push(t("STATUS_RESULT_FAILED", { plugin: e.plugin, grund: e.grund }));
            continue;
        }
        const imBot = e.aktion === "ein"
            ? await client.pluginManager.enableInGuild(e.plugin, guild.id).catch((err) => err)
            : await client.pluginManager.disableInGuild(e.plugin, guild.id).catch((err) => err);
        if (imBot === true) {
            (e.aktion === "ein" ? an : aus).push(e.plugin);
        } else {
            zeilen.push(t("STATUS_BOT_FAILED", { plugin: e.plugin, grund: imBot?.message || t("STATUS_SEE_LOG") }));
        }
    }
    if (aus.length) zeilen.unshift(t("STATUS_RESULT_OFF", { liste: aus.join(", ") }));
    if (an.length) zeilen.unshift(t("STATUS_RESULT_ON", { liste: an.join(", ") }));

    await anzeige.edit({ content: zeilen.join("\n").slice(0, 2000), components: [] });
}
