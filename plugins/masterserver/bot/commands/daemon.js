'use strict';

const { ApplicationCommandOptionType, EmbedBuilder } = require('discord.js');
const { ServiceManager } = require('dunebot-core');

/**
 * /daemon — Rootserver / Daemon-Verwaltung via Bot
 *
 * Subcommands:
 *   list                       — alle RootServer der Guild auflisten
 *   status <id>                — Status + Hardware eines RootServers (Autocomplete)
 *   register <name> <ram> <disk> [host]
 *                              — neuen RootServer registrieren + daemon.yaml-Daten ausgeben
 *   delete <id>                — RootServer entfernen (Autocomplete)
 *
 * @type {import('dunebot-sdk').CommandType}
 */
module.exports = {
    name: 'daemon',
    description: 'masterserver:DAEMON.DESCRIPTION',
    userPermissions: ['ManageGuild'],

    command: { enabled: false },

    slashCommand: {
        enabled: true,
        ephemeral: true,
        options: [
            {
                name: 'list',
                type: ApplicationCommandOptionType.Subcommand,
                description: 'masterserver:DAEMON.SUB_LIST',
            },
            {
                name: 'status',
                type: ApplicationCommandOptionType.Subcommand,
                description: 'masterserver:DAEMON.SUB_STATUS',
                options: [
                    {
                        name: 'id',
                        type: ApplicationCommandOptionType.Integer,
                        description: 'masterserver:DAEMON.OPT_ID',
                        required: true,
                        autocomplete: true,
                    },
                ],
            },
            {
                name: 'register',
                type: ApplicationCommandOptionType.Subcommand,
                description: 'masterserver:DAEMON.SUB_REGISTER',
                options: [
                    {
                        name: 'name',
                        type: ApplicationCommandOptionType.String,
                        description: 'masterserver:DAEMON.OPT_NAME',
                        required: true,
                        min_length: 3,
                        max_length: 64,
                    },
                    {
                        name: 'ram_gb',
                        type: ApplicationCommandOptionType.Number,
                        description: 'masterserver:DAEMON.OPT_RAM',
                        required: true,
                        min_value: 1,
                    },
                    {
                        name: 'disk_gb',
                        type: ApplicationCommandOptionType.Number,
                        description: 'masterserver:DAEMON.OPT_DISK',
                        required: true,
                        min_value: 10,
                    },
                    {
                        name: 'host',
                        type: ApplicationCommandOptionType.String,
                        description: 'masterserver:DAEMON.OPT_HOST',
                        required: false,
                    },
                ],
            },
            {
                name: 'delete',
                type: ApplicationCommandOptionType.Subcommand,
                description: 'masterserver:DAEMON.SUB_DELETE',
                options: [
                    {
                        name: 'id',
                        type: ApplicationCommandOptionType.Integer,
                        description: 'masterserver:DAEMON.OPT_ID',
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
        const t         = (key) => interaction.guild.getT(key);

        if (!ipcClient) {
            return interaction.followUp({ embeds: [_errEmbed('IPC nicht verfügbar.')] });
        }

        try {
            switch (sub) {

                // ── /daemon list ──────────────────────────────────────────
                case 'list': {
                    const res = await ipcClient.sendToDashboard('masterserver:DAEMON_LIST', { guild_id: guildId });
                    if (!res?.success) return interaction.followUp({ embeds: [_errEmbed(res?.error)] });

                    const servers = res.data || [];
                    if (servers.length === 0) {
                        return interaction.followUp({
                            embeds: [_infoEmbed(
                                t('masterserver:DAEMON.LIST_EMPTY_TITLE'),
                                t('masterserver:DAEMON.LIST_EMPTY_DESC')
                            )]
                        });
                    }

                    const embed = new EmbedBuilder()
                        .setTitle(t('masterserver:DAEMON.LIST_TITLE'))
                        .setColor(0x5865F2)
                        .setTimestamp();

                    for (const s of servers) {
                        const statusIcon = s.isOnline ? '🟢' : '🔴';
                        embed.addFields({
                            name:   `${statusIcon} #${s.id} — ${s.name}`,
                            value:  [
                                `**Host:** \`${s.host || 'n/a'}\``,
                                `**Status:** ${s.status} | **Version:** ${s.version || 'n/a'}`,
                                `**Gameserver:** ${s.gameserver_count}`,
                            ].join('\n'),
                            inline: false,
                        });
                    }

                    return interaction.followUp({ embeds: [embed] });
                }

                // ── /daemon status <id> ───────────────────────────────────
                case 'status': {
                    const id = interaction.options.getInteger('id');
                    const res = await ipcClient.sendToDashboard('masterserver:DAEMON_STATUS', {
                        guild_id: guildId, rootserver_id: id
                    });
                    if (!res?.success) return interaction.followUp({ embeds: [_errEmbed(res?.error)] });

                    const d = res.data;
                    const statusIcon = d.isOnline ? '🟢' : '🔴';
                    const hw = d.hardware;

                    const embed = new EmbedBuilder()
                        .setTitle(`${statusIcon} ${d.name}`)
                        .setColor(d.isOnline ? 0x57F287 : 0xED4245)
                        .addFields(
                            { name: 'Host',        value: `\`${d.host || 'n/a'}\``,      inline: true },
                            { name: 'Status',      value: d.status,                       inline: true },
                            { name: 'Version',     value: d.version || 'n/a',             inline: true },
                            { name: 'Gameserver',  value: String(d.gameserver_count || 0), inline: true },
                        );

                    if (hw) {
                        embed.addFields(
                            { name: 'CPU',  value: `${hw.cpu_percent?.toFixed(1) ?? '?'}%`,                              inline: true },
                            { name: 'RAM',  value: `${hw.ram_used_gb?.toFixed(1) ?? '?'} / ${hw.ram_total_gb?.toFixed(1) ?? '?'} GB`, inline: true },
                            { name: 'Disk', value: `${hw.disk_used_gb?.toFixed(1) ?? '?'} / ${hw.disk_total_gb?.toFixed(1) ?? '?'} GB`, inline: true },
                        );
                    }
                    embed.setTimestamp();

                    return interaction.followUp({ embeds: [embed] });
                }

                // ── /daemon register ──────────────────────────────────────
                case 'register': {
                    const name       = interaction.options.getString('name');
                    const ram_gb     = interaction.options.getNumber('ram_gb');
                    const disk_gb    = interaction.options.getNumber('disk_gb');
                    const host       = interaction.options.getString('host')       ?? null;

                    const res = await ipcClient.sendToDashboard('masterserver:DAEMON_REGISTER', {
                        guild_id:     guildId,
                        owner_user_id: interaction.user.id,
                        name,
                        host,
                        ram_gb,
                        disk_gb,
                    });

                    if (!res?.success) return interaction.followUp({ embeds: [_errEmbed(res?.error)] });

                    const { id, daemon_id, api_key } = res.data;

                    // API-Key nur ephemeral senden (einmalig!)
                    const embed = new EmbedBuilder()
                        .setTitle('✅ RootServer registriert')
                        .setColor(0x57F287)
                        .setDescription(
                            '⚠️ **Kopiere die Verbindungsdaten jetzt** — der API-Key wird nur einmal angezeigt!'
                        )
                        .addFields(
                            { name: 'RootServer-ID', value: String(id),     inline: true },
                            { name: 'Daemon-ID',     value: `\`${daemon_id}\``, inline: false },
                            { name: 'API-Key',       value: `\`${api_key}\``,   inline: false },
                        )
                        .setFooter({ text: 'Trage diese Werte in daemon.yaml ein' })
                        .setTimestamp();

                    return interaction.followUp({ embeds: [embed], ephemeral: true });
                }

                // ── /daemon delete <id> ───────────────────────────────────
                case 'delete': {
                    const id = interaction.options.getInteger('id');
                    const res = await ipcClient.sendToDashboard('masterserver:DAEMON_DELETE', {
                        guild_id: guildId, rootserver_id: id
                    });
                    if (!res?.success) return interaction.followUp({ embeds: [_errEmbed(res?.error)] });

                    return interaction.followUp({
                        embeds: [_infoEmbed('RootServer gelöscht', `RootServer #${id} wurde erfolgreich entfernt.`)]
                    });
                }
            }
        } catch (err) {
            Logger.error('[Bot/daemon] Command-Fehler:', err);
            return interaction.followUp({ embeds: [_errEmbed('Interner Fehler: ' + err.message)] });
        }
    },

    /**
     * Autocomplete-Handler: liefert vorhandene RootServer der Guild als Vorschläge
     * Wird für /daemon status <id> und /daemon delete <id> verwendet
     */
    async autocomplete({ interaction }) {
        const ipcClient = ServiceManager.get('ipcClient');
        if (!ipcClient) return interaction.respond([]);

        try {
            const res = await ipcClient.sendToDashboard(
                'masterserver:DAEMON_LIST',
                { guild_id: interaction.guildId },
                2000
            );
            const servers = res?.data || [];
            const choices = servers.map(s => ({
                name: `${s.name} (#${s.id}) — ${s.isOnline ? '🟢 online' : '🔴 offline'}`,
                value: s.id,
            })).slice(0, 25);
            await interaction.respond(choices);
        } catch {
            await interaction.respond([]);
        }
    },
};

// ── Embed-Hilfsfunktionen ─────────────────────────────────────────────────────

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
