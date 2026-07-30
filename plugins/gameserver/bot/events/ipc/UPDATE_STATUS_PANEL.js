/**
 * IPC-Handler: gameserver:UPDATE_STATUS_PANEL
 *
 * Schreibt ein Status-Panel in einen Discord-Kanal. Der Bot entscheidet hier
 * nichts über den Inhalt – Titel, Farbe und Felder kommen fertig aus dem
 * Dashboard (`PanelPresenter`), weil die Feldliste aus dem Addon stammt und nicht
 * zweimal ausgelegt werden soll.
 *
 * Rückgabe trägt immer die `message_id`, auch wenn eine neue Nachricht entstand:
 * Das Dashboard schreibt sie zurück, sonst würde bei jedem Push eine weitere
 * Nachricht im Kanal landen.
 *
 * **Rückgabe-Vertrag:** `IPCClient` verpackt den Rückgabewert eines
 * Plugin-Handlers in `{ success: true, data: <hier> }` – sein `success` sagt also
 * nur, dass der Handler nicht geworfen hat. Deshalb heißt das eigene Feld hier
 * `ok` und nicht `success`: Sonst läge im Ergebnis zweimal `success` mit
 * verschiedener Bedeutung, und der Aufrufer läse zuverlässig das falsche.
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { ServiceManager } = require('dunebot-core');

/** Discord-Fehlercodes, die sich nicht von selbst reparieren */
const ERR_UNKNOWN_MESSAGE = 10008;
const ERR_UNKNOWN_CHANNEL = 10003;
const ERR_MISSING_ACCESS  = 50001;
const ERR_MISSING_PERMS   = 50013;

/**
 * Baut das Embed aus der Dashboard-Nutzlast.
 * @param {object} spec
 * @returns {EmbedBuilder}
 */
function buildEmbed(spec) {
    const embed = new EmbedBuilder()
        .setTitle(spec.title)
        .setColor(spec.color);

    if (spec.description) embed.setDescription(spec.description);
    if (spec.fields?.length) embed.addFields(spec.fields);
    if (spec.footer) embed.setFooter({ text: spec.footer });
    if (spec.timestamp) embed.setTimestamp(new Date(spec.timestamp));

    return embed;
}

/**
 * Baut die Steuerungs-Buttons.
 *
 * Die Server-ID steckt in der `custom_id`, damit die Buttons einen Bot-Neustart
 * überleben – Zustand im Speicher wäre nach jedem Deploy verloren.
 *
 * @param {object|null} controls
 * @returns {Array<ActionRowBuilder>}
 */
function buildComponents(controls) {
    if (!controls) return [];

    const id = controls.server_id;
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`gspanel:start:${id}`)
            .setLabel('Starten')
            .setEmoji('▶️')
            .setStyle(ButtonStyle.Success)
            .setDisabled(!controls.can_start),
        new ButtonBuilder()
            .setCustomId(`gspanel:stop:${id}`)
            .setLabel('Stoppen')
            .setEmoji('⏹️')
            .setStyle(ButtonStyle.Danger)
            .setDisabled(!controls.can_stop),
        new ButtonBuilder()
            .setCustomId(`gspanel:refresh:${id}`)
            .setLabel('Neu laden')
            .setEmoji('🔄')
            .setStyle(ButtonStyle.Secondary)
    );

    return [row];
}

module.exports = async (data, discordClient) => {
    const Logger = ServiceManager.get('Logger');
    const { guild_id: guildId, channel_id: channelId, message_id: messageId, embed, controls } = data || {};

    if (!guildId || !channelId || !embed) {
        return { ok: false, error: 'guild_id, channel_id und embed erforderlich' };
    }

    try {
        const guild = discordClient.guilds.cache.get(guildId);
        if (!guild) return { ok: false, error: 'Guild nicht im Cache', disable: false };

        const channel = await guild.channels.fetch(channelId).catch(err => {
            if ([ERR_UNKNOWN_CHANNEL, ERR_MISSING_ACCESS].includes(err?.code)) return null;
            throw err;
        });
        if (!channel) {
            return { ok: false, error: 'Kanal nicht gefunden oder kein Zugriff', disable: true };
        }

        const payload = { embeds: [buildEmbed(embed)], components: buildComponents(controls) };

        // Vorhandene Nachricht editieren. Ist sie gelöscht, eine neue posten –
        // sonst wäre ein von Hand gelöschtes Panel für immer tot.
        if (messageId) {
            try {
                const message = await channel.messages.fetch(messageId);
                await message.edit(payload);
                return { ok: true, message_id: message.id };
            } catch (err) {
                if (err?.code !== ERR_UNKNOWN_MESSAGE) throw err;
                Logger?.debug?.(`[Gameserver] Panel-Nachricht ${messageId} weg – poste neu`);
            }
        }

        const sent = await channel.send(payload);
        return { ok: true, message_id: sent.id };

    } catch (err) {
        const fatal = [ERR_MISSING_PERMS, ERR_MISSING_ACCESS, ERR_UNKNOWN_CHANNEL].includes(err?.code);
        Logger?.warn?.(`[Gameserver] Panel-Update fehlgeschlagen (Kanal ${channelId}): ${err.message}`);
        return { ok: false, error: err.message, disable: fatal };
    }
};
