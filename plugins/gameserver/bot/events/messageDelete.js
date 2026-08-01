/**
 * Wacht über die Discord-Nachrichten der Status-Panels (E4, Konzept 18.3).
 *
 * Bisher merkte das Dashboard das Verschwinden einer Panel-Nachricht erst beim
 * nächsten Edit-Versuch – Discord antwortet dann mit Fehlercode 10008 und es
 * wird neu gepostet. Das reicht nur, solange überhaupt editiert wird. Zwei
 * Bremsen verhindern genau das: der Mindestabstand und der Hash über die
 * angezeigten Felder. Auf einem leeren Server nachts ändert sich nichts, also
 * gibt es keinen Edit, also fällt nichts auf. Ein um 23 Uhr gelöschtes Panel
 * wäre bis zum ersten Spieler am nächsten Tag weg gewesen.
 *
 * Discord sagt es uns aber sofort. `Partials.Message` ist im BotClient aktiv,
 * deshalb kommt `messageDelete` auch für Nachrichten an, die nicht im Cache
 * liegen – und eine Panel-Nachricht von vorgestern liegt garantiert nicht im
 * Cache. Bei einer Teilnachricht sind `id` und `channelId` gesetzt; mehr
 * braucht es hier nicht.
 *
 * Der Bot entscheidet nichts selbst: Er meldet „diese Nachricht gibt es nicht
 * mehr", das Dashboard prüft, ob sie zu einem Panel gehörte, und setzt
 * `message_id` auf NULL. Der nächste Push des Pollers postet dann neu.
 */

const { ServiceManager } = require('dunebot-core');

module.exports = async (message) => {
    const Logger = ServiceManager.get('Logger');

    try {
        // Nur Nachrichten in Guilds sind Panels; Direktnachrichten scheiden aus.
        const guildId = message?.guildId || message?.guild?.id;
        const channelId = message?.channelId || message?.channel?.id;
        const messageId = message?.id;

        if (!guildId || !channelId || !messageId) return;

        // Bei einer vollständigen Nachricht lässt sich vorab aussortieren: Was
        // nicht vom Bot stammt, war nie ein Panel. Teilnachrichten kennen ihren
        // Autor nicht – die gehen weiter ans Dashboard, das ohnehin nach der
        // message_id sucht und bei einem Fehlschlag einfach nichts ändert.
        if (!message.partial && message.author && !message.author.bot) return;

        const ipcClient = ServiceManager.get('ipcClient');
        if (!ipcClient) return;

        await ipcClient.sendToDashboard('gameserver:PANEL_MESSAGE_GONE', {
            guild_id:   guildId,
            channel_id: channelId,
            message_id: messageId,
        });

    } catch (err) {
        // Eine verlorene Meldung darf den Ereignisstrom des Bots nicht stören.
        // Der alte Weg über Fehlercode 10008 greift weiterhin als Auffangnetz.
        Logger?.debug?.(`[Gameserver] messageDelete konnte nicht gemeldet werden: ${err.message}`);
    }
};
