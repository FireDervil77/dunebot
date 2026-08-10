'use strict';

const {
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    StringSelectMenuBuilder
} = require('discord.js');

/**
 * Aus einem Menü die Discord-Nachricht bauen.
 *
 * ## Die Grenzen, die Discord setzt
 *
 * Sie stehen hier als Konstanten und werden **eingehalten statt erhofft**. Wer
 * sie überschreitet, bekommt keinen Teilerfolg, sondern eine abgelehnte
 * Nachricht — das Menü erscheint gar nicht, und die Fehlermeldung nennt nicht
 * den Grund. Deshalb wird abgeschnitten, bevor gesendet wird.
 *
 * | Grenze | Wert |
 * |---|---|
 * | Knopfreihen je Nachricht | 5 |
 * | Knöpfe je Reihe | 5 |
 * | Einträge in einer Auswahlliste | 25 |
 * | Beschriftung | 80 Zeichen |
 * | Zweite Zeile in der Auswahlliste | 100 Zeichen |
 *
 * ## Die Kennung, die einen Neustart überlebt
 *
 * Knöpfe und Auswahllisten tragen ihre Bedeutung in der `customId` — sie ist
 * das Einzige, was Discord beim Klick zurückschickt. `discord:rm:<menü>:<eintrag>`
 * genügt, um nach jedem Neustart wieder zu wissen, worum es geht, ohne dass der
 * Bot sich irgendetwas merken müsste.
 *
 * @module discord/bot/rollenmenue/nachricht
 */

const MAX_KNOEPFE = 25;
const MAX_KNOEPFE_JE_REIHE = 5;
const MAX_AUSWAHL = 25;
const MAX_BESCHRIFTUNG = 80;
const MAX_ZWEITE_ZEILE = 100;

/** Präfix aller Kennungen dieses Plugins. */
const KENNUNG = 'discord:rm';

const STILE = {
    grau: ButtonStyle.Secondary,
    blau: ButtonStyle.Primary,
    gruen: ButtonStyle.Success,
    rot: ButtonStyle.Danger
};

/**
 * Ein Emoji aus der Datenbank in die Form bringen, die discord.js erwartet.
 *
 * Gespeichert wird entweder ein Unicode-Zeichen (`🎮`) oder die Discord-Form
 * eines eigenen Emojis (`<:name:123>` bzw. `<a:name:123>` für bewegte).
 *
 * @param {string|null} emoji
 * @returns {string|null} Für discord.js verwendbar, oder null
 */
function leseEmoji(emoji) {
    if (!emoji) return null;

    const eigenes = /^<(a?):([^:]+):(\d+)>$/.exec(emoji.trim());
    // discord.js nimmt die reine ID an und findet den Rest selbst.
    if (eigenes) return eigenes[3];

    return emoji.trim() || null;
}

/**
 * Text auf die von Discord erlaubte Länge bringen.
 *
 * @param {string|null} text
 * @param {number} max
 * @returns {string|null}
 */
function kuerze(text, max) {
    if (!text) return null;
    const sauber = String(text).trim();
    if (!sauber) return null;
    return sauber.length <= max ? sauber : sauber.slice(0, max - 1) + '…';
}

/**
 * Beschriftung eines Eintrags — mit Rückfall auf den Rollennamen.
 *
 * Ohne den Rückfall stünde auf einem Knopf ohne eigene Beschriftung nichts,
 * und Discord lehnt einen Knopf ohne Beschriftung **und** ohne Emoji ab.
 *
 * @param {Object} option
 * @param {import('discord.js').Guild} [guild]
 * @returns {string}
 */
function beschriftung(option, guild) {
    const eigene = kuerze(option.label, MAX_BESCHRIFTUNG);
    if (eigene) return eigene;

    const rolle = guild?.roles?.cache?.get(String(option.role_id));
    return kuerze(rolle?.name, MAX_BESCHRIFTUNG) || 'Rolle';
}

/**
 * Die Einbettung (Titel, Beschreibung, Farbe).
 *
 * Bei `darstellung = 'reaktion'` werden die Einträge zusätzlich als Liste in
 * die Beschreibung geschrieben — dort gibt es keine Beschriftung am Bauteil,
 * ein blosses Emoji unter der Nachricht sagt niemandem, wofür es steht.
 *
 * @param {Object} menu
 * @param {import('discord.js').Guild} [guild]
 * @returns {EmbedBuilder}
 */
function baueEinbettung(menu, guild) {
    const embed = new EmbedBuilder()
        .setTitle(kuerze(menu.title, 256) || 'Rollen')
        .setColor(menu.color || '#5865F2');

    const zeilen = [];
    if (menu.description) zeilen.push(menu.description);

    if (menu.darstellung === 'reaktion' && (menu.optionen || []).length > 0) {
        if (zeilen.length > 0) zeilen.push('');
        for (const option of menu.optionen) {
            const text = option.label || `<@&${option.role_id}>`;
            const zusatz = option.description ? ` — ${option.description}` : '';
            zeilen.push(`${option.emoji || '•'} ${text}${zusatz}`);
        }
    }

    if (zeilen.length > 0) embed.setDescription(kuerze(zeilen.join('\n'), 4096));

    return embed;
}

/**
 * Die Bedienelemente unter der Nachricht.
 *
 * @param {Object} menu
 * @param {import('discord.js').Guild} [guild]
 * @returns {ActionRowBuilder[]}
 */
function baueBauteile(menu, guild) {
    const optionen = menu.optionen || [];
    if (optionen.length === 0) return [];

    if (menu.darstellung === 'knopf') {
        const reihen = [];
        for (const option of optionen.slice(0, MAX_KNOEPFE)) {
            if (reihen.length === 0 || reihen.at(-1).components.length >= MAX_KNOEPFE_JE_REIHE) {
                reihen.push(new ActionRowBuilder());
            }

            const knopf = new ButtonBuilder()
                .setCustomId(`${KENNUNG}:${menu.id}:${option.id}`)
                .setLabel(beschriftung(option, guild))
                .setStyle(STILE[option.stil] || ButtonStyle.Secondary);

            const emoji = leseEmoji(option.emoji);
            if (emoji) knopf.setEmoji(emoji);

            reihen.at(-1).addComponents(knopf);
        }
        return reihen;
    }

    if (menu.darstellung === 'auswahl') {
        const sichtbar = optionen.slice(0, MAX_AUSWAHL);

        const liste = new StringSelectMenuBuilder()
            .setCustomId(`${KENNUNG}:${menu.id}`)
            .setPlaceholder(kuerze(menu.title, 150) || 'Rollen auswählen')
            .addOptions(sichtbar.map(option => {
                const eintrag = {
                    label: beschriftung(option, guild),
                    value: String(option.id)
                };
                const zweite = kuerze(option.description, MAX_ZWEITE_ZEILE);
                if (zweite) eintrag.description = zweite;
                const emoji = leseEmoji(option.emoji);
                if (emoji) eintrag.emoji = emoji;
                return eintrag;
            }));

        // Bei `eindeutig` erzwingt schon Discord die Einzelauswahl — das ist
        // deutlich freundlicher, als hinterher zu erklären, warum von drei
        // angeklickten Rollen nur eine kam.
        const hoechstens = menu.modus === 'eindeutig'
            ? 1
            : Math.min(Math.max(Number(menu.max_auswahl) || sichtbar.length, 1), sichtbar.length);

        liste.setMinValues(Math.min(Math.max(Number(menu.min_auswahl) || 0, 0), hoechstens));
        liste.setMaxValues(hoechstens);

        return [new ActionRowBuilder().addComponents(liste)];
    }

    // 'reaktion' — die Bedienung sind die Reaktionen an der Nachricht selbst.
    return [];
}

/**
 * Die ganze Nachricht.
 *
 * @param {Object} menu Menü samt `optionen`
 * @param {import('discord.js').Guild} [guild]
 * @returns {{embeds: EmbedBuilder[], components: ActionRowBuilder[]}}
 */
function baueNachricht(menu, guild) {
    return {
        embeds: [baueEinbettung(menu, guild)],
        components: baueBauteile(menu, guild)
    };
}

/**
 * Die Emojis, die als Reaktion unter die Nachricht gehören.
 *
 * **Ohne Wiederholung.** Discord trägt dieselbe Reaktion nur einmal; stünde
 * ein Emoji bei zwei Einträgen, wäre der zweite über die Nachricht nicht mehr
 * erreichbar und das Setzen der Reaktion würde beim zweiten Mal fehlschlagen.
 * Die Oberfläche verhindert das bereits beim Anlegen — hier steht der Riegel
 * für alles, was auf anderem Weg in die Datenbank gelangt ist.
 *
 * @param {Object} menu
 * @returns {string[]}
 */
function reaktionsEmojis(menu) {
    if (menu.darstellung !== 'reaktion') return [];

    return [...new Set(
        (menu.optionen || []).map(o => o.emoji).filter(Boolean)
    )];
}

/**
 * Eine Kennung wieder auseinandernehmen.
 *
 * @param {string} customId
 * @returns {{menuId: number, optionId: number|null}|null}
 */
function leseKennung(customId) {
    if (!customId?.startsWith(`${KENNUNG}:`)) return null;

    const teile = customId.split(':');
    // discord : rm : menü [ : eintrag ]
    const menuId = Number(teile[2]);
    if (!Number.isInteger(menuId)) return null;

    const optionId = teile.length > 3 ? Number(teile[3]) : null;
    if (teile.length > 3 && !Number.isInteger(optionId)) return null;

    return { menuId, optionId };
}

module.exports = {
    KENNUNG, MAX_KNOEPFE, MAX_AUSWAHL,
    baueNachricht, baueEinbettung, baueBauteile,
    reaktionsEmojis, leseKennung, leseEmoji, kuerze
};
