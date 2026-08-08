/**
 * Musik - Mediensteuerung unter der laufenden Nachricht
 *
 * Baut die "Jetzt laeuft"-Nachricht samt Knoepfen. Beides gehoert zusammen:
 * die Knoepfe muessen zum Zustand passen, den die Nachricht anzeigt, sonst
 * steht auf dem Knopf "Pause", waehrend es laengst angehalten ist.
 *
 * Alles hier arbeitet auf `abspieler.zustand()`, nicht auf dem Abspieler
 * selbst. Das haelt die Darstellung frei von der Steuerlogik - und
 * vermeidet einen Ringschluss mit dem `GuildPlayer`, der diese Nachricht
 * ja selbst verschickt.
 *
 * @module music/bot/steuerung
 */

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { dauerText, fortschritt } = require('./format');

/** Farbe der Wiedergabe-Nachricht. */
const FARBE = 0x1DB954;

/** Vorsatz aller Knopf-Kennungen dieses Plugins. */
const VORSATZ = 'music_';

/** Was der Wiederholungsknopf anzeigt und was ein Druck daraus macht. */
const WIEDERHOLUNG = {
    aus: { text: 'Wiederholung', zeichen: '🔁', naechster: 'titel' },
    titel: { text: 'Titel', zeichen: '🔂', naechster: 'liste' },
    liste: { text: 'Liste', zeichen: '🔁', naechster: 'aus' }
};

/**
 * Die Knopfreihen zum Zustand.
 *
 * Zwei Reihen: oben die Wiedergabe, unten Lautstaerke und Rest. Discord
 * laesst fuenf Knoepfe je Reihe zu.
 *
 * @param {Object} z Zustand aus `abspieler.zustand()`
 * @returns {Array<Object>} Komponenten fuer die Nachricht
 */
function knoepfe(z) {
    const laeuft = Boolean(z.aktuell);
    const wiederholung = WIEDERHOLUNG[z.wiederholung] || WIEDERHOLUNG.aus;

    const knopf = (kennung, zeichen, text, stil, aus = false) =>
        new ButtonBuilder()
            .setCustomId(VORSATZ + kennung)
            .setEmoji(zeichen)
            .setLabel(text)
            .setStyle(stil)
            .setDisabled(aus);

    const reihe1 = new ActionRowBuilder().addComponents(
        // Ein Knopf, zwei Bedeutungen - was draufsteht, ist was passiert
        z.pausiert
            ? knopf('pause', '▶️', 'Weiter', ButtonStyle.Success, !laeuft)
            : knopf('pause', '⏸️', 'Pause', ButtonStyle.Primary, !laeuft),
        knopf('skip', '⏭️', 'Naechster', ButtonStyle.Secondary, !laeuft),
        knopf('stop', '⏹️', 'Stopp', ButtonStyle.Danger, !laeuft && z.warteschlangeLaenge === 0),
        knopf('loop', wiederholung.zeichen, wiederholung.text,
            z.wiederholung === 'aus' ? ButtonStyle.Secondary : ButtonStyle.Success),
        knopf('shuffle', '🔀', 'Mischen', ButtonStyle.Secondary, z.warteschlangeLaenge < 2)
    );

    const reihe2 = new ActionRowBuilder().addComponents(
        knopf('vol_down', '🔉', 'Leiser', ButtonStyle.Secondary, z.lautstaerke <= 0),
        knopf('vol_up', '🔊', 'Lauter', ButtonStyle.Secondary, z.lautstaerke >= 200),
        knopf('queue', '📜', `Warteschlange (${z.warteschlangeLaenge})`, ButtonStyle.Secondary),
        knopf('leave', '⏏️', 'Verlassen', ButtonStyle.Danger)
    );

    return [reihe1, reihe2];
}

/**
 * Das Embed zur laufenden Wiedergabe.
 *
 * @param {Object} z Zustand aus `abspieler.zustand()`
 * @returns {Object} Embed
 */
function embed(z) {
    const t = z.aktuell;

    if (!t) {
        return {
            color: FARBE,
            author: { name: 'Musik' },
            description: 'Gerade laeuft nichts. Mit `/music play` geht es los - ' +
                'ich bleibe so lange hier im Kanal.'
        };
    }

    const balken = fortschritt(t.positionSek || 0, t.durationSec);
    const zeit = t.durationSec
        ? `\`${dauerText(t.positionSek || 0)}\` ${balken} \`${dauerText(t.durationSec)}\``
        : '`live` — Internetradio laeuft ohne Ende';

    const felder = [
        { name: 'Quelle', value: String(t.source || '—'), inline: true },
        { name: 'Lautstaerke', value: `${z.lautstaerke} %`, inline: true },
        { name: 'Wiederholung', value: (WIEDERHOLUNG[z.wiederholung] || WIEDERHOLUNG.aus).text, inline: true }
    ];

    if (t.requestedBy) {
        felder.push({ name: 'Gewuenscht von', value: `<@${t.requestedBy}>`, inline: true });
    }
    if (z.warteschlangeLaenge > 0) {
        felder.push({ name: 'Danach', value: `${z.warteschlangeLaenge} in der Warteschlange`, inline: true });
    }
    if (z.filter && z.filter !== 'aus') {
        felder.push({ name: 'Klangfilter', value: z.filter, inline: true });
    }

    return {
        color: FARBE,
        author: { name: z.pausiert ? 'Angehalten' : 'Jetzt laeuft' },
        title: String(t.title || 'Unbekannter Titel').substring(0, 256),
        url: t.herkunftUrl || t.url || undefined,
        thumbnail: t.thumbnail ? { url: t.thumbnail } : undefined,
        description: zeit,
        fields: felder
    };
}

/**
 * Die komplette Nachricht - Embed und Knoepfe zusammen.
 *
 * @param {Object} z Zustand aus `abspieler.zustand()`
 * @returns {Object} Nachrichtenrumpf
 */
function nachricht(z) {
    return { embeds: [embed(z)], components: knoepfe(z) };
}

module.exports = { nachricht, VORSATZ, WIEDERHOLUNG };
