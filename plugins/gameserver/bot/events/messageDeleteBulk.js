/**
 * Gegenstück zu `messageDelete` für Sammellöschungen.
 *
 * Räumt jemand einen Kanal per Purge auf, schickt Discord **kein** einzelnes
 * `messageDelete` je Nachricht, sondern ein `messageDeleteBulk` mit der ganzen
 * Sammlung. Ohne diesen Handler überlebte ausgerechnet der häufigste Fall –
 * „ich mach hier mal sauber" – die Überwachung nicht, und die Panels wären bis
 * zum nächsten Edit-Versuch verwaist.
 *
 * @see messageDelete.js für die Begründung, warum der Bot nur meldet und das
 *      Dashboard entscheidet.
 */

const { ServiceManager } = require('dunebot-core');

module.exports = async (messages) => {
    const Logger = ServiceManager.get('Logger');

    try {
        const liste = [...(messages?.values?.() || [])];
        if (!liste.length) return;

        const ipcClient = ServiceManager.get('ipcClient');
        if (!ipcClient) return;

        for (const nachricht of liste) {
            const guildId   = nachricht?.guildId || nachricht?.guild?.id;
            const channelId = nachricht?.channelId || nachricht?.channel?.id;
            const messageId = nachricht?.id;

            if (!guildId || !channelId || !messageId) continue;
            if (!nachricht.partial && nachricht.author && !nachricht.author.bot) continue;

            await ipcClient.sendToDashboard('gameserver:PANEL_MESSAGE_GONE', {
                guild_id:   guildId,
                channel_id: channelId,
                message_id: messageId,
            }).catch(() => { /* einzelne Meldung darf den Rest nicht aufhalten */ });
        }

    } catch (err) {
        Logger?.debug?.(`[Gameserver] messageDeleteBulk konnte nicht gemeldet werden: ${err.message}`);
    }
};
