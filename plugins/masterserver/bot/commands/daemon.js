'use strict';

const { ApplicationCommandOptionType, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { ServiceManager } = require('dunebot-core');

/**
 * /daemon — Rootserver / Daemon-Verwaltung via Bot
 *
 * Subcommands:
 *   list                       — alle RootServer der Guild auflisten
 *   status <id>                — Status + Hardware eines RootServers (Autocomplete)
 *   register <name> <host> [domain] [beschreibung] [sftp] [datenbanken]
 *                              — neuen RootServer anlegen wie der Assistent im Dashboard
 *                                (helpers/RootServerAnlegen.js), daemon.yaml als Datei
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
                        name: 'host',
                        type: ApplicationCommandOptionType.String,
                        description: 'masterserver:DAEMON.OPT_HOST',
                        required: true,
                        max_length: 255,
                    },
                    // Hier standen bis zum 2026-11-06 `ram_gb` und `disk_gb` als
                    // Pflichtfelder. Der Assistent fragt sie seit M-6 nicht mehr:
                    // Der Daemon misst die Hardware beim ersten Verbinden.
                    {
                        name: 'domain',
                        type: ApplicationCommandOptionType.String,
                        description: 'masterserver:DAEMON.OPT_FQDN',
                        required: false,
                        max_length: 255,
                    },
                    {
                        name: 'beschreibung',
                        type: ApplicationCommandOptionType.String,
                        description: 'masterserver:DAEMON.OPT_DESCRIPTION',
                        required: false,
                        max_length: 255,
                    },
                    {
                        name: 'sftp',
                        type: ApplicationCommandOptionType.Boolean,
                        description: 'masterserver:DAEMON.OPT_SFTP',
                        required: false,
                    },
                    {
                        name: 'datenbanken',
                        type: ApplicationCommandOptionType.Integer,
                        description: 'masterserver:DAEMON.OPT_DB',
                        required: false,
                        min_value: 0,
                        max_value: 20,
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
        const t         = (key, werte) => interaction.guild.getT(key, werte);

        if (!ipcClient) {
            return interaction.followUp({ embeds: [_errEmbed('IPC nicht verfügbar.')] });
        }

        try {
            switch (sub) {

                // ── /daemon list ──────────────────────────────────────────
                case 'list': {
                    const res = await ipcClient.sendToDashboard('masterserver:DAEMON_LIST', { actor_user_id: interaction.user.id, guild_id: guildId });
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
                        guild_id: guildId, rootserver_id: id, actor_user_id: interaction.user.id
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
                    const name = interaction.options.getString('name');
                    const res = await ipcClient.sendToDashboard('masterserver:DAEMON_REGISTER', {
                        guild_id:      guildId,
                        owner_user_id: interaction.user.id,
                        actor_user_id: interaction.user.id,
                        name,
                        host:          interaction.options.getString('host'),
                        fqdn:          interaction.options.getString('domain') ?? null,
                        description:   interaction.options.getString('beschreibung') ?? null,
                        sftp:          interaction.options.getBoolean('sftp') ?? false,
                        db_je_server:  interaction.options.getInteger('datenbanken') ?? 0,
                    });

                    if (!res?.success) return interaction.followUp({ embeds: [_errEmbed(res?.error)] });

                    const d = res.data;
                    // Der Befehl antwortet nur dem Aufrufer (`ephemeral` oben), der
                    // API-Key steht also nie im Kanal.
                    const embed = new EmbedBuilder()
                        .setTitle(t('masterserver:DAEMON.REGISTER_TITLE', { name }))
                        .setColor(0x57F287)
                        .setDescription(t('masterserver:DAEMON.REGISTER_DESC'))
                        .addFields(
                            { name: t('masterserver:DAEMON.REGISTER_ID'),        value: String(d.id),             inline: true },
                            { name: t('masterserver:DAEMON.REGISTER_DAEMON_ID'), value: `\`${d.daemonId}\``,       inline: false },
                            { name: t('masterserver:DAEMON.REGISTER_API_KEY'),   value: `\`${d.apiKey}\``,         inline: false },
                            { name: t('masterserver:DAEMON.REGISTER_BUS'),       value: `\`${d.busAdresse}\``,     inline: false },
                            { name: t('masterserver:DAEMON.REGISTER_INSTALL'),   value: `\`\`\`\n${d.installBefehl}\n\`\`\``, inline: false },
                        )
                        .setFooter({ text: t('masterserver:DAEMON.REGISTER_FOOTER') })
                        .setTimestamp();

                    const yaml = new AttachmentBuilder(Buffer.from(d.daemonYaml, 'utf8'), { name: 'daemon.yaml' });
                    return interaction.followUp({ embeds: [embed], files: [yaml], ephemeral: true });
                }

                // ── /daemon delete <id> ───────────────────────────────────
                case 'delete': {
                    const id = interaction.options.getInteger('id');
                    const res = await ipcClient.sendToDashboard('masterserver:DAEMON_DELETE', {
                        guild_id: guildId, rootserver_id: id, actor_user_id: interaction.user.id
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
