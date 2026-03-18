const {
    ChannelType,
    ButtonBuilder,
    ActionRowBuilder,
    ComponentType,
    TextInputStyle,
    TextInputBuilder,
    ModalBuilder,
    ButtonStyle,
    ApplicationCommandOptionType,
} = require('discord.js');

// Sub Commands
const start = require('./sub/start');
const pause = require('./sub/pause');
const resume = require('./sub/resume');
const end = require('./sub/end');
const reroll = require('./sub/reroll');
const list = require('./sub/list');
const edit = require('./sub/edit');
const blacklist = require('./sub/blacklist');
const template = require('./sub/template');

/**
 * @type {import('dunebot-sdk').CommandType}
 */
module.exports = {
    name: 'giveaway',
    description: 'giveaways:DESCRIPTION',
    command: {
        enabled: true,
        minArgsCount: 1,
        subcommands: [
            { trigger: 'start <#channel>', description: 'giveaways:SUB_START_DESC' },
            { trigger: 'pause <messageId>', description: 'giveaways:SUB_PAUSE_DESC' },
            { trigger: 'resume <messageId>', description: 'giveaways:SUB_RESUME_DESC' },
            { trigger: 'end <messageId>', description: 'giveaways:SUB_END_DESC' },
            { trigger: 'reroll <messageId>', description: 'giveaways:SUB_REROLL_DESC' },
            { trigger: 'list', description: 'giveaways:SUB_LIST_DESC' },
            { trigger: 'edit <messageId>', description: 'giveaways:SUB_EDIT_DESC' },
        ],
    },
    slashCommand: {
        enabled: true,
        ephemeral: true,
        options: [
            {
                name: 'start',
                description: 'giveaways:SUB_START_DESC',
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    {
                        name: 'channel',
                        description: 'giveaways:SUB_START_CHANNEL_DESC',
                        type: ApplicationCommandOptionType.Channel,
                        channelTypes: [ChannelType.GuildText],
                        required: true,
                    },
                    {
                        name: 'duration',
                        description: 'giveaways:SUB_START_DURATION_DESC',
                        type: ApplicationCommandOptionType.String,
                        required: true,
                    },
                    {
                        name: 'prize',
                        description: 'giveaways:SUB_START_PRIZE_DESC',
                        type: ApplicationCommandOptionType.String,
                        required: true,
                    },
                    {
                        name: 'winners',
                        description: 'giveaways:SUB_START_WINNERS_DESC',
                        type: ApplicationCommandOptionType.Integer,
                        required: false,
                    },
                    {
                        name: 'roles',
                        description: 'giveaways:SUB_START_ROLES_DESC',
                        type: ApplicationCommandOptionType.String,
                        required: false,
                    },
                    {
                        name: 'host',
                        description: 'giveaways:SUB_START_HOST_DESC',
                        type: ApplicationCommandOptionType.User,
                        required: false,
                    },
                ],
            },
            {
                name: 'pause',
                description: 'giveaways:SUB_PAUSE_DESC',
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    {
                        name: 'message_id',
                        description: 'giveaways:SUB_PAUSE_MESSAGE_ID_DESC',
                        type: ApplicationCommandOptionType.String,
                        required: true,
                    },
                ],
            },
            {
                name: 'resume',
                description: 'giveaways:SUB_RESUME_DESC',
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    {
                        name: 'message_id',
                        description: 'giveaways:SUB_RESUME_MESSAGE_ID_DESC',
                        type: ApplicationCommandOptionType.String,
                        required: true,
                    },
                ],
            },
            {
                name: 'end',
                description: 'giveaways:SUB_END_DESC',
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    {
                        name: 'message_id',
                        description: 'giveaways:SUB_END_MESSAGE_ID_DESC',
                        type: ApplicationCommandOptionType.String,
                        required: true,
                    },
                ],
            },
            {
                name: 'reroll',
                description: 'giveaways:SUB_REROLL_DESC',
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    {
                        name: 'message_id',
                        description: 'giveaways:SUB_REROLL_MESSAGE_ID_DESC',
                        type: ApplicationCommandOptionType.String,
                        required: true,
                    },
                ],
            },
            {
                name: 'list',
                description: 'giveaways:SUB_LIST_DESC',
                type: ApplicationCommandOptionType.Subcommand,
            },
            {
                name: 'edit',
                description: 'giveaways:SUB_EDIT_DESC',
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    {
                        name: 'message_id',
                        description: 'giveaways:SUB_EDIT_MESSAGE_ID_DESC',
                        type: ApplicationCommandOptionType.String,
                        required: true,
                    },
                    {
                        name: 'add_duration',
                        description: 'giveaways:SUB_EDIT_DURATION_DESC',
                        type: ApplicationCommandOptionType.String,
                        required: false,
                    },
                    {
                        name: 'new_prize',
                        description: 'giveaways:SUB_EDIT_PRIZE_DESC',
                        type: ApplicationCommandOptionType.String,
                        required: false,
                    },
                    {
                        name: 'new_winners',
                        description: 'giveaways:SUB_EDIT_WINNERS_DESC',
                        type: ApplicationCommandOptionType.Integer,
                        required: false,
                    },
                ],
            },
            {
                name: 'blacklist',
                description: 'giveaways:SUB_BLACKLIST_DESC',
                type: ApplicationCommandOptionType.SubcommandGroup,
                options: [
                    {
                        name: 'add',
                        description: 'giveaways:SUB_BLACKLIST_ADD_DESC',
                        type: ApplicationCommandOptionType.Subcommand,
                        options: [
                            {
                                name: 'user',
                                description: 'giveaways:SUB_BLACKLIST_USER_DESC',
                                type: ApplicationCommandOptionType.User,
                                required: true,
                            },
                            {
                                name: 'reason',
                                description: 'giveaways:SUB_BLACKLIST_REASON_DESC',
                                type: ApplicationCommandOptionType.String,
                                required: false,
                            },
                        ],
                    },
                    {
                        name: 'remove',
                        description: 'giveaways:SUB_BLACKLIST_REMOVE_DESC',
                        type: ApplicationCommandOptionType.Subcommand,
                        options: [
                            {
                                name: 'user',
                                description: 'giveaways:SUB_BLACKLIST_USER_DESC',
                                type: ApplicationCommandOptionType.User,
                                required: true,
                            },
                        ],
                    },
                    {
                        name: 'list',
                        description: 'giveaways:SUB_BLACKLIST_LIST_DESC',
                        type: ApplicationCommandOptionType.Subcommand,
                    },
                ],
            },
            {
                name: 'template',
                description: 'giveaways:SUB_TEMPLATE_DESC',
                type: ApplicationCommandOptionType.SubcommandGroup,
                options: [
                    {
                        name: 'create',
                        description: 'giveaways:SUB_TEMPLATE_CREATE_DESC',
                        type: ApplicationCommandOptionType.Subcommand,
                        options: [
                            {
                                name: 'name',
                                description: 'giveaways:SUB_TEMPLATE_NAME_DESC',
                                type: ApplicationCommandOptionType.String,
                                required: true,
                            },
                            {
                                name: 'prize',
                                description: 'giveaways:SUB_START_PRIZE_DESC',
                                type: ApplicationCommandOptionType.String,
                                required: true,
                            },
                            {
                                name: 'duration',
                                description: 'giveaways:SUB_START_DURATION_DESC',
                                type: ApplicationCommandOptionType.String,
                                required: true,
                            },
                            {
                                name: 'winners',
                                description: 'giveaways:SUB_START_WINNERS_DESC',
                                type: ApplicationCommandOptionType.Integer,
                                required: false,
                            },
                        ],
                    },
                    {
                        name: 'use',
                        description: 'giveaways:SUB_TEMPLATE_USE_DESC',
                        type: ApplicationCommandOptionType.Subcommand,
                        options: [
                            {
                                name: 'name',
                                description: 'giveaways:SUB_TEMPLATE_NAME_DESC',
                                type: ApplicationCommandOptionType.String,
                                required: true,
                            },
                            {
                                name: 'channel',
                                description: 'giveaways:SUB_START_CHANNEL_DESC',
                                type: ApplicationCommandOptionType.Channel,
                                channelTypes: [ChannelType.GuildText],
                                required: true,
                            },
                        ],
                    },
                    {
                        name: 'list',
                        description: 'giveaways:SUB_TEMPLATE_LIST_DESC',
                        type: ApplicationCommandOptionType.Subcommand,
                    },
                    {
                        name: 'delete',
                        description: 'giveaways:SUB_TEMPLATE_DELETE_DESC',
                        type: ApplicationCommandOptionType.Subcommand,
                        options: [
                            {
                                name: 'name',
                                description: 'giveaways:SUB_TEMPLATE_NAME_DESC',
                                type: ApplicationCommandOptionType.String,
                                required: true,
                            },
                        ],
                    },
                ],
            },
        ],
    },

    async messageRun({ message, args }) {
        const sub = args[0]?.toLowerCase();
        let response;

        if (sub === 'start') {
            if (!args[1]) return message.replyT('giveaways:START_CHANNEL');
            const match = message.guild.findMatchingChannels(args[1]);
            if (!match.length) return message.replyT('NO_MATCH_CHANNEL', { query: args[1] });
            return await runModalSetup(message, match[0]);
        } else if (sub === 'pause') {
            response = await pause(message.member, args[1]);
        } else if (sub === 'resume') {
            response = await resume(message.member, args[1]);
        } else if (sub === 'end') {
            response = await end(message.member, args[1]);
        } else if (sub === 'reroll') {
            response = await reroll(message.member, args[1]);
        } else if (sub === 'list') {
            response = await list(message.member);
        } else if (sub === 'edit') {
            if (!args[1]) return message.replyT('giveaways:INVALID_MESSAGE_ID');
            return await runModalEdit(message, args[1]);
        } else if (sub === 'blacklist') {
            const action = args[1]?.toLowerCase();
            response = await blacklist(message.member, action, args[2], args.slice(3).join(' '));
        } else if (sub === 'template') {
            const action = args[1]?.toLowerCase();
            response = await template(message.member, action, args[2], {
                prize: args[3],
                duration: args[4],
                winnerCount: args[5],
                channel: message.guild.findMatchingChannels(args[3])?.[0],
            });
        } else {
            response = message.guild.getT('INVALID_SUBCOMMAND', { sub });
        }

        await message.reply(response);
    },

    async interactionRun({ interaction }) {
        const sub = interaction.options.getSubcommand();
        let response;

        if (sub === 'start') {
            response = await start(
                interaction.member,
                interaction.options.getChannel('channel'),
                interaction.options.getString('duration'),
                interaction.options.getString('prize'),
                interaction.options.getInteger('winners'),
                interaction.options.getUser('host')?.id,
                interaction.options.getString('roles'),
            );
        } else if (sub === 'pause') {
            response = await pause(interaction.member, interaction.options.getString('message_id'));
        } else if (sub === 'resume') {
            response = await resume(interaction.member, interaction.options.getString('message_id'));
        } else if (sub === 'end') {
            response = await end(interaction.member, interaction.options.getString('message_id'));
        } else if (sub === 'reroll') {
            response = await reroll(interaction.member, interaction.options.getString('message_id'));
        } else if (sub === 'list') {
            response = await list(interaction.member);
        } else if (sub === 'edit') {
            response = await edit(
                interaction.member,
                interaction.options.getString('message_id'),
                interaction.options.getString('add_duration'),
                interaction.options.getString('new_prize'),
                interaction.options.getInteger('new_winners'),
            );
        } else if (sub === 'add' || sub === 'remove' || sub === 'list') {
            const group = interaction.options.getSubcommandGroup();
            if (group === 'blacklist') {
                response = await blacklist(
                    interaction.member,
                    sub,
                    interaction.options.getUser('user')?.id,
                    interaction.options.getString('reason'),
                );
            } else if (group === 'template') {
                if (sub === 'create') {
                    response = await template(interaction.member, 'create', interaction.options.getString('name'), {
                        prize: interaction.options.getString('prize'),
                        duration: interaction.options.getString('duration'),
                        winnerCount: interaction.options.getInteger('winners'),
                    });
                } else if (sub === 'use') {
                    response = await template(interaction.member, 'use', interaction.options.getString('name'), {
                        channel: interaction.options.getChannel('channel'),
                    });
                } else if (sub === 'list') {
                    response = await template(interaction.member, 'list');
                } else if (sub === 'delete') {
                    response = await template(interaction.member, 'delete', interaction.options.getString('name'));
                }
            }
        } else if (sub === 'create' || sub === 'delete') {
            // SubcommandGroup sub-commands
            const group = interaction.options.getSubcommandGroup();
            if (group === 'template') {
                if (sub === 'create') {
                    response = await template(interaction.member, 'create', interaction.options.getString('name'), {
                        prize: interaction.options.getString('prize'),
                        duration: interaction.options.getString('duration'),
                        winnerCount: interaction.options.getInteger('winners'),
                    });
                } else if (sub === 'delete') {
                    response = await template(interaction.member, 'delete', interaction.options.getString('name'));
                }
            }
        } else {
            return interaction.followUpT('INVALID_SUBCOMMAND', { sub });
        }

        await interaction.followUp(response);
    },
};

// ─── Modal: Giveaway Start ─────────────────────────────────

async function runModalSetup({ member, channel, guild }, targetCh) {
    if (!targetCh) return channel.send(guild.getT('giveaways:START_INVALID_CHANNEL'));

    const buttonRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('giveaway_btnSetup')
            .setLabel(guild.getT('giveaways:START_BTN_LABEL'))
            .setStyle(ButtonStyle.Primary),
    );

    const sentMsg = await channel.send({
        content: guild.getT('giveaways:START_BTN_CONTENT'),
        components: [buttonRow],
    });
    if (!sentMsg) return;

    const btnInteraction = await channel
        .awaitMessageComponent({
            componentType: ComponentType.Button,
            filter: (i) => i.customId === 'giveaway_btnSetup' && i.member.id === member.id && i.message.id === sentMsg.id,
            time: 20000,
        })
        .catch(() => {});

    if (!btnInteraction)
        return sentMsg.edit({ content: guild.getT('giveaways:START_NO_RESPONSE'), components: [] });

    await btnInteraction.showModal(
        new ModalBuilder({
            customId: 'giveaway-modalSetup',
            title: guild.getT('giveaways:START_MODAL_TITLE'),
            components: [
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('duration').setLabel(guild.getT('giveaways:START_MODAL_DURATION')).setPlaceholder('1h / 1d / 1w').setStyle(TextInputStyle.Short).setRequired(true),
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('prize').setLabel(guild.getT('giveaways:START_MODAL_PRIZE')).setStyle(TextInputStyle.Short).setRequired(true),
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('winners').setLabel(guild.getT('giveaways:START_MODAL_WINNERS')).setStyle(TextInputStyle.Short).setRequired(true),
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('roles').setLabel(guild.getT('giveaways:START_MODAL_ROLES')).setStyle(TextInputStyle.Short).setRequired(false),
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('host').setLabel(guild.getT('giveaways:START_MODAL_HOST')).setStyle(TextInputStyle.Short).setRequired(false),
                ),
            ],
        }),
    );

    const modal = await btnInteraction
        .awaitModalSubmit({
            time: 60000,
            filter: (m) => m.customId === 'giveaway-modalSetup' && m.member.id === member.id && m.message.id === sentMsg.id,
        })
        .catch(() => {});

    if (!modal)
        return sentMsg.edit({ content: guild.getT('giveaways:START_NO_RESPONSE'), components: [] });

    sentMsg.delete().catch(() => {});
    await modal.reply(guild.getT('giveaways:START_CREATING'));

    const response = await start(
        member,
        targetCh,
        modal.fields.getTextInputValue('duration'),
        modal.fields.getTextInputValue('prize'),
        parseInt(modal.fields.getTextInputValue('winners')),
        modal.fields.getTextInputValue('host'),
        modal.fields.getTextInputValue('roles'),
    );

    await modal.editReply(response);
}

// ─── Modal: Giveaway Edit ──────────────────────────────────

async function runModalEdit({ member, channel, guild }, messageId) {
    const giveaway = await member.client.giveawayManager.getGiveawayByMessage(messageId, guild.id);
    if (!giveaway) return channel.send(guild.getT('giveaways:NOT_FOUND', { messageId }));

    const buttonRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('giveaway_btnEdit')
            .setLabel(guild.getT('giveaways:EDIT_BTN_LABEL'))
            .setStyle(ButtonStyle.Primary),
    );

    const sentMsg = await channel.send({
        content: guild.getT('giveaways:EDIT_BTN_CONTENT', { prize: giveaway.prize }),
        components: [buttonRow],
    });
    if (!sentMsg) return;

    const btnInteraction = await channel
        .awaitMessageComponent({
            componentType: ComponentType.Button,
            filter: (i) => i.customId === 'giveaway_btnEdit' && i.member.id === member.id && i.message.id === sentMsg.id,
            time: 20000,
        })
        .catch(() => {});

    if (!btnInteraction)
        return sentMsg.edit({ content: guild.getT('giveaways:START_NO_RESPONSE'), components: [] });

    await btnInteraction.showModal(
        new ModalBuilder({
            customId: 'giveaway-modalEdit',
            title: guild.getT('giveaways:EDIT_MODAL_TITLE'),
            components: [
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('add_duration').setLabel(guild.getT('giveaways:EDIT_MODAL_DURATION')).setPlaceholder('1h / 1d').setStyle(TextInputStyle.Short).setRequired(false),
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('new_prize').setLabel(guild.getT('giveaways:EDIT_MODAL_PRIZE')).setPlaceholder(giveaway.prize).setStyle(TextInputStyle.Short).setRequired(false),
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('new_winners').setLabel(guild.getT('giveaways:EDIT_MODAL_WINNERS')).setPlaceholder(String(giveaway.winner_count)).setStyle(TextInputStyle.Short).setRequired(false),
                ),
            ],
        }),
    );

    const modal = await btnInteraction
        .awaitModalSubmit({
            time: 60000,
            filter: (m) => m.customId === 'giveaway-modalEdit' && m.member.id === member.id && m.message.id === sentMsg.id,
        })
        .catch(() => {});

    if (!modal)
        return sentMsg.edit({ content: guild.getT('giveaways:START_NO_RESPONSE'), components: [] });

    sentMsg.delete().catch(() => {});

    const addDur = modal.fields.getTextInputValue('add_duration') || null;
    const newPrize = modal.fields.getTextInputValue('new_prize') || null;
    const newWinners = modal.fields.getTextInputValue('new_winners') || null;

    const response = await edit(
        member,
        messageId,
        addDur,
        newPrize,
        newWinners ? parseInt(newWinners) : null,
    );

    await modal.reply(response);
}

