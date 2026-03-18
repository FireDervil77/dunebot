'use strict';

const {
    ApplicationCommandOptionType, EmbedBuilder, MessageFlags,
    ModalBuilder, ActionRowBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const { ServiceManager } = require('dunebot-core');

/**
 * /server — Gameserver-Verwaltung via Bot
 *
 * Subcommands:
 *   list  [status] [rootserver] [search]   — Gameserver auflisten (Filter + Suche)
 *   status <id>                            — Detailstatus eines Gameservers (Autocomplete)
 *   create <rootserver> <addon> <name> ... — Neuen Gameserver erstellen
 *   start <id>                             — Gameserver starten (Autocomplete)
 *   stop <id>                              — Gameserver stoppen (Autocomplete)
 *   restart <id>                           — Gameserver neustarten (Autocomplete)
 *
 * @type {import('dunebot-sdk').CommandType}
 */
module.exports = {
    name: 'server',
    description: 'gameserver:SERVER.DESCRIPTION',
    userPermissions: ['ManageGuild'],

    command: { enabled: false },

    slashCommand: {
        enabled: true,
        ephemeral: true,
        options: [
            // ── list ──────────────────────────────────────────────────────────────────
            {
                name: 'list',
                type: ApplicationCommandOptionType.Subcommand,
                description: 'gameserver:SERVER.SUB_LIST',
                options: [
                    {
                        name: 'status',
                        type: ApplicationCommandOptionType.String,
                        description: 'gameserver:SERVER.OPT_FILTER_STATUS',
                        required: false,
                        choices: [
                            { name: '🟢 Online',      value: 'online' },
                            { name: '🔴 Offline',     value: 'offline' },
                            { name: '⚡ Starting',    value: 'starting' },
                            { name: '⏹ Stopping',    value: 'stopping' },
                            { name: '🔧 Installing',  value: 'installing' },
                            { name: '❌ Error',       value: 'error' },
                        ],
                    },
                    {
                        name: 'rootserver',
                        type: ApplicationCommandOptionType.Integer,
                        description: 'gameserver:SERVER.OPT_FILTER_ROOTSERVER',
                        required: false,
                        autocomplete: true,
                    },
                    {
                        name: 'search',
                        type: ApplicationCommandOptionType.String,
                        description: 'gameserver:SERVER.OPT_SEARCH',
                        required: false,
                        min_length: 2,
                        max_length: 50,
                    },
                ],
            },
            // ── status ────────────────────────────────────────────────────────────────
            {
                name: 'status',
                type: ApplicationCommandOptionType.Subcommand,
                description: 'gameserver:SERVER.SUB_STATUS',
                options: [
                    {
                        name: 'id',
                        type: ApplicationCommandOptionType.Integer,
                        description: 'gameserver:SERVER.OPT_ID',
                        required: true,
                        autocomplete: true,
                    },
                ],
            },
            // ── create ────────────────────────────────────────────────────────────────
            {
                name: 'create',
                type: ApplicationCommandOptionType.Subcommand,
                description: 'gameserver:SERVER.SUB_CREATE',
                options: [
                    {
                        name: 'rootserver',
                        type: ApplicationCommandOptionType.Integer,
                        description: 'gameserver:SERVER.OPT_ROOTSERVER',
                        required: true,
                        autocomplete: true,
                    },
                    {
                        name: 'addon',
                        type: ApplicationCommandOptionType.String,
                        description: 'gameserver:SERVER.OPT_ADDON',
                        required: true,
                        autocomplete: true,
                    },
                    {
                        name: 'name',
                        type: ApplicationCommandOptionType.String,
                        description: 'gameserver:SERVER.OPT_NAME',
                        required: true,
                        min_length: 3,
                        max_length: 64,
                    },
                ],
            },
            // ── start ─────────────────────────────────────────────────────────────────
            {
                name: 'start',
                type: ApplicationCommandOptionType.Subcommand,
                description: 'gameserver:SERVER.SUB_START',
                options: [
                    {
                        name: 'id',
                        type: ApplicationCommandOptionType.Integer,
                        description: 'gameserver:SERVER.OPT_ID',
                        required: true,
                        autocomplete: true,
                    },
                ],
            },
            // ── stop ──────────────────────────────────────────────────────────────────
            {
                name: 'stop',
                type: ApplicationCommandOptionType.Subcommand,
                description: 'gameserver:SERVER.SUB_STOP',
                options: [
                    {
                        name: 'id',
                        type: ApplicationCommandOptionType.Integer,
                        description: 'gameserver:SERVER.OPT_ID',
                        required: true,
                        autocomplete: true,
                    },
                ],
            },
            // ── restart ───────────────────────────────────────────────────────────────
            {
                name: 'restart',
                type: ApplicationCommandOptionType.Subcommand,
                description: 'gameserver:SERVER.SUB_RESTART',
                options: [
                    {
                        name: 'id',
                        type: ApplicationCommandOptionType.Integer,
                        description: 'gameserver:SERVER.OPT_ID',
                        required: true,
                        autocomplete: true,
                    },
                ],
            },
        ],
    },

    async interactionRun({ interaction }) {
        const Logger    = ServiceManager.get('Logger');
        const ipcClient = ServiceManager.get('ipcClient');
        const sub       = interaction.options.getSubcommand();
        const guildId   = interaction.guildId;

        if (!ipcClient) {
            return interaction.followUp({ embeds: [_errEmbed('IPC nicht verfügbar.')] });
        }

        try {
            switch (sub) {

                // ── /server list ──────────────────────────────────────────────────────
                case 'list': {
                    const statusFilter     = interaction.options.getString('status')      ?? null;
                    const rootserverFilter = interaction.options.getInteger('rootserver') ?? null;
                    const search           = interaction.options.getString('search')       ?? null;

                    const res = await ipcClient.sendToDashboard('gameserver:SERVER_LIST', {
                        guild_id:          guildId,
                        status_filter:     statusFilter,
                        rootserver_filter: rootserverFilter,
                        search,
                    });
                    if (!res?.success) return interaction.followUp({ embeds: [_errEmbed(res?.error)] });

                    const servers = res.data || [];
                    if (servers.length === 0) {
                        return interaction.followUp({
                            embeds: [_infoEmbed('Keine Gameserver gefunden', 'Erstelle einen mit `/server create`.')],
                        });
                    }

                    const embed = new EmbedBuilder()
                        .setTitle('🎮 Gameserver')
                        .setColor(0x5865F2)
                        .setFooter({ text: `${servers.length} Server${statusFilter ? ` · Filter: ${statusFilter}` : ''}` })
                        .setTimestamp();

                    for (const s of servers) {
                        const icon   = _statusIcon(s.status);
                        const players = (s.status === 'online' && s.max_players)
                            ? ` · ${s.current_players}/${s.max_players} Spieler`
                            : '';
                        embed.addFields({
                            name:  `${icon} #${s.id} — ${s.name}`,
                            value: [
                                `**Game:** ${s.game_name || s.game_slug || 'n/a'}`,
                                `**RootServer:** ${s.rootserver_name || 'n/a'}`,
                                `**Status:** ${s.status}${players}`,
                            ].join('\n'),
                            inline: false,
                        });
                    }

                    return interaction.followUp({ embeds: [embed] });
                }

                // ── /server status <id> ───────────────────────────────────────────────
                case 'status': {
                    const id  = interaction.options.getInteger('id');
                    const res = await ipcClient.sendToDashboard('gameserver:SERVER_STATUS', {
                        guild_id: guildId, server_id: id,
                    });
                    if (!res?.success) return interaction.followUp({ embeds: [_errEmbed(res?.error)] });

                    const d    = res.data;
                    const icon = _statusIcon(d.status);

                    const embed = new EmbedBuilder()
                        .setTitle(`${icon} ${d.name}`)
                        .setColor(_statusColor(d.status))
                        .addFields(
                            { name: 'Game',        value: d.game_name  || 'n/a',                inline: true },
                            { name: 'RootServer',  value: d.rootserver_name || 'n/a',            inline: true },
                            { name: 'Status',      value: d.status,                              inline: true },
                            { name: 'Version',     value: d.addon_version  || 'n/a',             inline: true },
                            { name: 'Daemon',      value: d.daemon_online ? '🟢 Online' : '🔴 Offline', inline: true },
                        );

                    if (d.status === 'online' && d.max_players) {
                        embed.addFields({
                            name: 'Spieler',
                            value: `${d.current_players ?? 0} / ${d.max_players}`,
                            inline: true,
                        });
                    }
                    if (d.allocated_ram_mb || d.allocated_cpu_percent || d.allocated_disk_gb) {
                        embed.addFields({
                            name: 'Ressourcen',
                            value: [
                                d.allocated_ram_mb      ? `RAM: ${d.allocated_ram_mb} MB`        : null,
                                d.allocated_cpu_percent ? `CPU: ${d.allocated_cpu_percent}%`     : null,
                                d.allocated_disk_gb     ? `Disk: ${d.allocated_disk_gb} GB`      : null,
                            ].filter(Boolean).join(' · '),
                            inline: false,
                        });
                    }
                    if (d.status === 'error' && d.error_message) {
                        embed.addFields({ name: '❌ Fehler', value: d.error_message, inline: false });
                    }
                    embed.setTimestamp();

                    return interaction.followUp({ embeds: [embed] });
                }

                // ── /server create ────────────────────────────────────────────────────
                // Wenn user_editable Variablen existieren, wurde bereits ein Modal gezeigt
                // (via preInteraction). Dieser Pfad läuft nur wenn KEINE Vars vorhanden sind.
                case 'create': {
                    const rootserverId = interaction.options.getInteger('rootserver');
                    const addonSlug    = interaction.options.getString('addon');
                    const name         = interaction.options.getString('name');

                    const res = await ipcClient.sendToDashboard('gameserver:SERVER_CREATE', {
                        guild_id:      guildId,
                        rootserver_id: rootserverId,
                        addon_slug:    addonSlug,
                        server_name:   name,
                        owner_user_id: interaction.user.id,
                    });
                    if (!res?.success) return interaction.followUp({ embeds: [_errEmbed(res?.error)] });

                    const d = res.data;
                    await interaction.editReply({ embeds: [
                        new EmbedBuilder()
                            .setTitle('✅ Gameserver wird installiert')
                            .setColor(0x57F287)
                            .addFields(
                                { name: 'ID',    value: String(d.id),   inline: true },
                                { name: 'Name',  value: d.name,         inline: true },
                                { name: 'Addon', value: d.addon,        inline: true },
                            )
                            .setDescription('⏳ Die Installation läuft...')
                            .setTimestamp(),
                    ]});

                    // Status-Polling (editiert dieselbe Nachricht)
                    _pollInstallStatus(interaction, guildId, d.id, d.name, ipcClient, Logger).catch(() => {});
                    break;
                }

                // ── /server start <id> ────────────────────────────────────────────────
                case 'start': {
                    const id  = interaction.options.getInteger('id');
                    const res = await ipcClient.sendToDashboard('gameserver:SERVER_START', {
                        guild_id: guildId, server_id: id,
                    });
                    if (!res?.success) return interaction.followUp({ embeds: [_errEmbed(res?.error)] });
                    return interaction.followUp({
                        embeds: [_infoEmbed('▶️ Server startet', `**${res.data?.name}** wird gestartet...`)],
                    });
                }

                // ── /server stop <id> ─────────────────────────────────────────────────
                case 'stop': {
                    const id  = interaction.options.getInteger('id');
                    const res = await ipcClient.sendToDashboard('gameserver:SERVER_STOP', {
                        guild_id: guildId, server_id: id,
                    });
                    if (!res?.success) return interaction.followUp({ embeds: [_errEmbed(res?.error)] });
                    return interaction.followUp({
                        embeds: [_infoEmbed('⏹ Server stoppt', `**${res.data?.name}** wird gestoppt...`)],
                    });
                }

                // ── /server restart <id> ──────────────────────────────────────────────
                case 'restart': {
                    const id  = interaction.options.getInteger('id');
                    const res = await ipcClient.sendToDashboard('gameserver:SERVER_RESTART', {
                        guild_id: guildId, server_id: id,
                    });
                    if (!res?.success) return interaction.followUp({ embeds: [_errEmbed(res?.error)] });
                    return interaction.followUp({
                        embeds: [_infoEmbed('🔄 Server neustart', `**${res.data?.name}** wurde neu gestartet.`)],
                    });
                }
            }
        } catch (err) {
            Logger.error('[Bot/server] Command-Fehler:', err);
            return interaction.followUp({ embeds: [_errEmbed('Interner Fehler: ' + err.message)] });
        }
    },

    /**
     * Läuft VOR deferReply. Wenn der create-Subcommand user_editable Variablen hat,
     * wird ein Discord-Modal zurückgegeben statt dem normalen Defer-Flow.
     */
    async preInteraction({ interaction }) {
        const sub = interaction.options?.getSubcommand(false);
        if (sub !== 'create') return null;

        const addonSlug = interaction.options.getString('addon');
        if (!addonSlug) return null;

        const ipcClient = ServiceManager.get('ipcClient');
        if (!ipcClient) return null;

        const varRes = await ipcClient.sendToDashboard(
            'gameserver:ADDON_VARIABLES', { guild_id: interaction.guildId, addon_slug: addonSlug }, 1500
        ).catch(() => null);
        const allVars    = varRes?.data || [];
        const totalVars  = varRes?.total ?? allVars.length;
        const editableVars = allVars.slice(0, 5); // Discord Modal: max. 5 Felder
        if (!editableVars.length) return null;

        const rootserverId = interaction.options.getInteger('rootserver');
        const name         = interaction.options.getString('name');

        const moreHint   = totalVars > 5 ? ` (${editableVars.length}/${totalVars})` : '';
        const modal = new ModalBuilder()
            .setCustomId(`server:${rootserverId}:${addonSlug}:${totalVars}:${encodeURIComponent(name)}`)
            .setTitle(`${addonSlug} konfigurieren${moreHint}`.slice(0, 45));

        for (const v of editableVars.slice(0, 5)) {
            const input = new TextInputBuilder()
                .setCustomId(v.env_variable)
                .setLabel(v.name.slice(0, 45))
                .setStyle(TextInputStyle.Short)
                // Pflichtfeld nur wenn rules explizit 'required' enthält und NICHT 'nullable'
                .setRequired(v.rules ? (v.rules.includes('required') && !v.rules.includes('nullable')) : false)
                .setPlaceholder((v.description || '').slice(0, 100));

            if (v.default_value !== null && v.default_value !== undefined && v.default_value !== '') {
                input.setValue(String(v.default_value).slice(0, 4000));
            }
            modal.addComponents(new ActionRowBuilder().addComponents(input));
        }
        return { modal };
    },

    /**
     * Verarbeitet das Modal-Submit von server:create.
     * Erstellt den Gameserver mit den vom User angegebenen Variablen.
     */
    async modalSubmit({ interaction }) {
        const Logger    = ServiceManager.get('Logger');
        const ipcClient = ServiceManager.get('ipcClient');

        // customId Format: server:<rootserverId>:<addonSlug>:<totalVars>:<encodedName>
        const parts = interaction.customId.split(':');
        if (parts.length < 4) return;
        const [, rootServerId, addonSlug, totalVarsStr, ...rest] = parts;
        const totalVars = parseInt(totalVarsStr, 10) || 0;
        const name      = decodeURIComponent(rest.join(':'));
        const guildId = interaction.guildId;

        // Benutzer-Werte aus Modal-Feldern extrahieren
        const envOverrides = {};
        for (const [key, field] of interaction.fields.fields) {
            envOverrides[key] = field.value;
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        if (!ipcClient) {
            return interaction.editReply({ embeds: [_errEmbed('IPC nicht verfügbar.')] });
        }

        const res = await ipcClient.sendToDashboard('gameserver:SERVER_CREATE', {
            guild_id:      guildId,
            rootserver_id: parseInt(rootServerId, 10),
            addon_slug:    addonSlug,
            server_name:   name,
            env_overrides: envOverrides,
            owner_user_id: interaction.user.id,
        });

        if (!res?.success) return interaction.editReply({ embeds: [_errEmbed(res?.error)] });

        const d = res.data;
        const installEmbed = new EmbedBuilder()
            .setTitle('✅ Gameserver wird installiert')
            .setColor(0x57F287)
            .addFields(
                { name: 'ID',    value: String(d.id),   inline: true },
                { name: 'Name',  value: d.name,         inline: true },
                { name: 'Addon', value: d.addon,        inline: true },
            )
            .setDescription('⏳ Die Installation läuft...')
            .setTimestamp();

        if (totalVars > 5) {
            installEmbed.setFooter({ text: `${totalVars - 5} weitere Variable(n) können im Dashboard angepasst werden.` });
        }

        await interaction.editReply({ embeds: [installEmbed] });

        // Status-Polling
        _pollInstallStatus(interaction, guildId, d.id, d.name, ipcClient, Logger).catch(() => {});
    },

    /**
     * Autocomplete-Handler
     * - rootserver-Option (in list + create):  RootServer der Guild
     * - addon-Option (in create):              genehmigte Addons
     * - id-Option (in status/start/stop/restart): Gameserver der Guild
     */
    async autocomplete({ interaction }) {
        const Logger    = ServiceManager.get('Logger');
        const ipcClient = ServiceManager.get('ipcClient');
        if (!ipcClient) {
            Logger.warn('[AC/server] ipcClient nicht verfügbar');
            return interaction.respond([]);
        }

        const focused  = interaction.options.getFocused(true);
        const guildId  = interaction.guildId;
        Logger.debug(`[AC/server] focused=${focused.name} guild=${guildId}`);

        try {
            // ── rootserver-Feld ───────────────────────────────────────────────────────
            if (focused.name === 'rootserver') {
                const res = await ipcClient.sendToDashboard(
                    'masterserver:DAEMON_LIST', { guild_id: guildId }, 2000
                );
                Logger.debug(`[AC/server] rootserver IPC-res: success=${res?.success} count=${res?.data?.length} err=${res?.error}`);
                const query = focused.value?.toLowerCase() ?? '';
                const choices = (res?.data || [])
                    .filter(s => !query || s.name.toLowerCase().includes(query) || String(s.id).startsWith(query))
                    .map(s => {
                        const ramInfo  = s.freeRamMB  != null ? ` • ${Math.round(s.freeRamMB / 1024 * 10) / 10}GB RAM frei` : '';
                        const diskInfo = s.freeDiskGB != null ? ` • ${s.freeDiskGB}GB Disk frei` : '';
                        return {
                            name:  `${s.isOnline ? '🟢' : '🔴'} ${s.name}${ramInfo}${diskInfo}`,
                            value: s.id,
                        };
                    }).slice(0, 25);
                return interaction.respond(choices);
            }

            // ── addon-Feld (Textsuche) ────────────────────────────────────────────────
            if (focused.name === 'addon') {
                const res = await ipcClient.sendToDashboard(
                    'gameserver:ADDON_LIST', { guild_id: guildId }, 2000
                );
                Logger.debug(`[AC/server] addon IPC-res: success=${res?.success} count=${res?.data?.length}`);
                const query = focused.value?.toLowerCase() ?? '';
                const choices = (res?.data || [])
                    .filter(a => !query || a.name.toLowerCase().includes(query) || a.slug.includes(query))
                    .map(a => ({ name: `${a.name} (${a.slug})`, value: a.slug }))
                    .slice(0, 25);
                return interaction.respond(choices);
            }

            // ── id-Feld (Gameserver) ──────────────────────────────────────────────────
            if (focused.name === 'id') {
                const sub = interaction.options.getSubcommand(false);
                const statusFilter = null;

                const res = await ipcClient.sendToDashboard('gameserver:SERVER_LIST', {
                    guild_id: guildId, status_filter: statusFilter,
                }, 2000);
                Logger.debug(`[AC/server] id IPC-res: success=${res?.success} count=${res?.data?.length}`);
                const query = focused.value?.toString() ?? '';
                const choices = (res?.data || [])
                    .filter(s => !query || s.name.toLowerCase().includes(query.toLowerCase()) || String(s.id).startsWith(query))
                    .map(s => ({
                        name:  `${_statusIcon(s.status)} ${s.name} (#${s.id}) — ${s.game_name || s.game_slug || 'n/a'}`,
                        value: s.id,
                    }))
                    .slice(0, 25);
                return interaction.respond(choices);
            }

        } catch (err) {
            Logger.error(`[AC/server] Fehler bei ${focused.name}:`, err);
            return interaction.respond([]);
        }
    },
};

// ── Hilfsfunktionen ──────────────────────────────────────────────────────────

function _statusIcon(status) {
    const icons = {
        online:     '🟢',
        offline:    '🔴',
        starting:   '⚡',
        stopping:   '⏹',
        installing: '🔧',
        installed:  '📦',
        updating:   '🔄',
        error:      '❌',
    };
    return icons[status] ?? '⚪';
}

function _statusColor(status) {
    const colors = {
        online:     0x57F287,
        offline:    0x99AAB5,
        error:      0xED4245,
        starting:   0xFEE75C,
        stopping:   0xFEE75C,
        installing: 0x5865F2,
    };
    return colors[status] ?? 0x5865F2;
}

function _errEmbed(msg) {
    return new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle('❌ Fehler')
        .setDescription(msg || 'Unbekannter Fehler')
        .setTimestamp();
}

function _infoEmbed(title, desc) {
    return new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(title)
        .setDescription(desc || '')
        .setTimestamp();
}

/**
 * Pollt den Installations-Status alle 5 Sekunden und bearbeitet die deferred Reply.
 * Bricht nach 3 Minuten oder bei terminalem Status ab.
 *
 * @param {import('discord.js').Interaction} interaction
 * @param {string} guildId
 * @param {number} serverId
 * @param {string} serverName
 * @param {object} ipcClient
 * @param {object} Logger
 */
async function _pollInstallStatus(interaction, guildId, serverId, serverName, ipcClient, Logger) {
    const STATUS_COLORS = { installed: 0x57F287, online: 0x57F287, error: 0xED4245, offline: 0x747F8D };
    const TERMINAL = new Set(['installed', 'online', 'error', 'offline']);

    // Discord-Interaction-Token gilt 15 Minuten → max. 14 Minuten pollen (168 × 5s)
    for (let i = 0; i < 168; i++) {
        await new Promise(r => setTimeout(r, 5000));
        try {
            const r = await ipcClient.sendToDashboard('gameserver:SERVER_STATUS',
                { guild_id: guildId, server_id: serverId }, 3000);
            const status = r?.data?.status ?? 'installing';

            let icon, statusText;
            switch (status) {
                case 'installing': icon = '🔄'; statusText = 'Installiert...'; break;
                case 'installed':  icon = '✅'; statusText = 'Fertig! Starte mit `/server start`.'; break;
                case 'online':     icon = '🟢'; statusText = 'Server läuft!'; break;
                case 'error':      icon = '❌'; statusText = `Fehler: ${r?.data?.error_message || 'Unbekannt'}`; break;
                default:           icon = '⏳'; statusText = status;
            }

            const embed = new EmbedBuilder()
                .setTitle(`${icon} Server "${serverName}"`)
                .setColor(STATUS_COLORS[status] ?? 0xFEE75C)
                .addFields(
                    { name: 'Server-ID', value: String(serverId), inline: true },
                    { name: 'Status',    value: statusText,       inline: true },
                )
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] }).catch(() => {});
            if (TERMINAL.has(status)) break;
        } catch (e) {
            Logger.warn(`[server/poll] Status-Check Fehler:`, e);
        }
    }
}
