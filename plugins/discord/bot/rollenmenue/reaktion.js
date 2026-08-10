'use strict';

const { Logger } = require('dunebot-sdk/utils');
const { DiscordRoleMenus } = require('../../shared/models');
const { fuerEinenEintrag } = require('./entscheidung');
const { wendeAn } = require('./anwenden');

/**
 * Reaktion gesetzt oder weggenommen — für beide Richtungen dasselbe.
 *
 * Setzen und Zurücknehmen unterscheiden sich nur in einem Wort, das an
 * `fuerEinenEintrag` durchgereicht wird. Zwei getrennte Ereignisdateien mit
 * identischem Rumpf wären zwei Stellen, an denen später eine Änderung vergessen
 * werden kann — genau so ist es in `greeting` passiert, wo `messageReactionAdd`
 * und `messageReactionRemove` denselben Abschnitt doppelt tragen.
 *
 * ## Die Teilstücke
 *
 * Discord schickt bei alten Nachrichten nur ein Bruchstück
 * (`reaction.partial`) — der Bot war beim Versand nicht dabei und hat den
 * Inhalt nicht im Speicher. Genau das ist bei Rollenmenüs der Normalfall: Die
 * Nachricht steht seit Wochen im Kanal. Ohne das Nachladen würde ein
 * Rollenmenü nach jedem Bot-Neustart aufhören zu wirken.
 *
 * ## Warum es keine Rückmeldung gibt
 *
 * Auf eine Reaktion lässt sich nicht antworten — es gibt keinen Antwortkanal,
 * nur eine DM, und die kommt bei vielen gar nicht an. Wer seinen Mitgliedern
 * sagen können will, warum eine Rolle nicht kam, nimmt Knöpfe.
 *
 * @module discord/bot/rollenmenue/reaktion
 */

/**
 * @param {import('discord.js').MessageReaction} reaction
 * @param {import('discord.js').User} user
 * @param {string} aktion Eine der `AKTION`-Konstanten
 */
async function behandleReaktion(reaction, user, aktion) {
    if (user.bot) return;

    if (reaction.partial) {
        try { await reaction.fetch(); } catch { return; }
    }
    if (reaction.message.partial) {
        try { await reaction.message.fetch(); } catch { return; }
    }

    const guild = reaction.message.guild;
    if (!guild) return;

    try {
        const menu = await DiscordRoleMenus.getMenuByMessage(guild.id, reaction.message.id);
        if (!menu || menu.darstellung !== 'reaktion') return;

        // Erst jetzt das Mitglied holen. Vorher wäre es ein Discord-Aufruf für
        // jede Reaktion auf jede beliebige Nachricht des Servers.
        const member = await guild.members.fetch(user.id).catch(() => null);
        if (!member) return;

        const emoji = reaction.emoji.id
            ? `<${reaction.emoji.animated ? 'a' : ''}:${reaction.emoji.name}:${reaction.emoji.id}>`
            : reaction.emoji.name;

        // Der Vergleich muss den Variationsselektor U+FE0F wegräumen.
        //
        // Viele Zeichen gibt es in zwei Schreibweisen: `⚔` (U+2694) und `⚔️`
        // (U+2694 U+FE0F). Was im Dashboard gespeichert wird, hängt davon ab,
        // woher der Nutzer es kopiert hat; was Discord in `reaction.emoji.name`
        // liefert, ist nicht immer dieselbe Form. Ein byte-genauer Vergleich
        // trifft dann nicht — und weil es auf eine Reaktion keine Rückmeldung
        // gibt, passiert kommentarlos gar nichts. Genau so gemeldet.
        //
        // Eigene Server-Emojis sind davon nicht betroffen, die hängen an der ID.
        const schluessel = (wert) => String(wert || '').replace(/\uFE0F/g, '');

        const eintrag = menu.optionen.find(o => schluessel(o.emoji) === schluessel(emoji));
        if (!eintrag) return;

        const alleRollen = menu.optionen.map(o => String(o.role_id));
        const hatRollen = new Set(member.roles.cache.map(r => r.id));

        const aenderung = fuerEinenEintrag(menu, eintrag, alleRollen, hatRollen, aktion);
        const ergebnis = await wendeAn(member, aenderung, `Rollenmenü „${menu.title}" (#${menu.id})`);

        if (ergebnis.blockiert.length > 0) {
            // Nur ins Protokoll: Der Nutzer sieht davon nichts, und das ist der
            // Preis der Reaktionen. Im Protokoll muss es stehen, sonst sucht
            // die Serverleitung im Dunkeln.
            const gruende = ergebnis.blockiert.map(b => `${b.name || b.rolle}=${b.grund}`).join(', ');
            Logger.warn(`[Discord] Rollenmenü #${menu.id}: nicht gesetzt für ${user.tag} (${gruende})`);
        }

    } catch (error) {
        Logger.error(`[Discord] Rollenmenü-Reaktion fehlgeschlagen für ${user.tag}`, error);
    }
}

module.exports = { behandleReaktion };
