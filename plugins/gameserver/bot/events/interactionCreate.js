/**
 * Button-Interaktionen der Gameserver-Status-Panels (E4)
 *
 * `custom_id` ist `gspanel:<aktion>:<serverId>` – die Server-ID steckt in der ID
 * selbst, damit die Buttons einen Bot-Neustart überleben.
 *
 * Rechteprüfung: Ein Panel steht in einem Kanal, den jeder sehen kann, während
 * `/server` über `userPermissions: ['ManageGuild']` gesperrt ist. Der Klick trägt
 * deshalb die Discord-User-ID als `actor_user_id` mit, und das **Dashboard** prüft
 * damit `GAMESERVER.START/.STOP/.VIEW` über denselben PermissionManager, der auch
 * das Web-UI absichert. Ein Rechtemodell, eine Stelle – der Bot entscheidet nicht
 * selbst, wer starten darf.
 */

const { MessageFlags } = require('discord.js');
const { ServiceManager } = require('dunebot-core');

/**
 * Cooldown je Nutzer und Panel-Aktion.
 * Ohne ihn wäre der Mindestabstand des Dashboards (60 s) durch Klicken umgehbar.
 * @type {Map<string, number>}
 */
const cooldowns = new Map();
const COOLDOWN_MS = 15_000;

/** Aufräumen, damit die Map nicht unbegrenzt wächst */
function pruneCooldowns(now) {
    for (const [key, until] of cooldowns) {
        if (until <= now) cooldowns.delete(key);
    }
}

/**
 * @param {import('discord.js').Interaction} interaction
 */
module.exports = async (interaction) => {
    if (!interaction.isButton()) return;
    if (!interaction.customId.startsWith('gspanel:')) return;

    const Logger = ServiceManager.get('Logger');
    const [, action, rawServerId] = interaction.customId.split(':');
    const serverId = Number(rawServerId);

    if (!['start', 'stop', 'refresh'].includes(action) || !Number.isFinite(serverId)) {
        return interaction.reply({ content: '❌ Unbekannter Button.', flags: MessageFlags.Ephemeral })
            .catch(() => {});
    }

    const now = Date.now();
    pruneCooldowns(now);
    const cooldownKey = `${interaction.user.id}:${serverId}:${action}`;
    const until = cooldowns.get(cooldownKey);
    if (until && until > now) {
        const seconds = Math.ceil((until - now) / 1000);
        return interaction.reply({
            content: `⏳ Bitte noch ${seconds} s warten.`,
            flags: MessageFlags.Ephemeral,
        }).catch(() => {});
    }
    cooldowns.set(cooldownKey, now + COOLDOWN_MS);

    const ipcClient = ServiceManager.get('ipcClient');
    if (!ipcClient) {
        return interaction.reply({
            content: '❌ Keine Verbindung zum Dashboard.',
            flags: MessageFlags.Ephemeral,
        }).catch(() => {});
    }

    // Start und Stop dauern länger als die 3-Sekunden-Frist von Discord.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});

    const EVENTS = {
        start:   'gameserver:SERVER_START',
        stop:    'gameserver:SERVER_STOP',
        refresh: 'gameserver:PANEL_REFRESH',
    };

    try {
        const res = await ipcClient.sendToDashboard(EVENTS[action], {
            guild_id:      interaction.guildId,
            server_id:     serverId,
            actor_user_id: interaction.user.id,
        }, 60_000);

        if (!res?.success) {
            // Bei Fehlschlag den Cooldown freigeben: Wer keine Rechte hat, soll
            // das sofort erfahren, und ein "Daemon offline" darf den nächsten
            // Versuch nicht 15 s blockieren.
            cooldowns.delete(cooldownKey);
            return interaction.editReply({ content: `❌ ${res?.error || 'Fehlgeschlagen.'}` });
        }

        const messages = {
            start:   '▶️ Server wird gestartet – das Panel aktualisiert sich von selbst.',
            stop:    '⏹️ Server wird gestoppt.',
            refresh: '🔄 Status neu abgefragt.',
        };
        return interaction.editReply({ content: messages[action] });

    } catch (err) {
        cooldowns.delete(cooldownKey);
        Logger?.error?.(`[Gameserver] Panel-Button ${action} für Server ${serverId} fehlgeschlagen:`, err);
        return interaction.editReply({ content: `❌ ${err.message}` }).catch(() => {});
    }
};
