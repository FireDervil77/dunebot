/**
 * Musik - gemeinsame Helfer der Unterbefehle
 *
 * Seit dem 2026-08-07 liegen alle Musikbefehle unter `/music <unterbefehl>`.
 * Die Unterbefehle geben ihre Antwort **zurueck**, statt selbst zu antworten -
 * `music.js` schickt sie ab. Das haelt die Unterbefehle frei von der Frage,
 * ob der Aufruf per Schraegstrich oder als Nachricht kam.
 *
 * @module music/bot/utils
 */

const GuildPlayer = require('./managers/GuildPlayer');

/** Farbe der Antwort-Embeds. */
const FARBE = 0x1DB954;

/**
 * Eine einfache Antwort als Embed.
 *
 * @param {string} text Meldung
 * @param {string} [art] 'ok' | 'warnung' | 'fehler'
 * @returns {Object} Nachricht
 */
function antwort(text, art = 'ok') {
    const farben = { ok: FARBE, warnung: 0xF59F00, fehler: 0xD63939 };
    return { embeds: [{ color: farben[art] ?? FARBE, description: text }] };
}

/**
 * Die Vorpruefungen fuer einen Musikbefehl.
 *
 * @param {Object} mitglied Discord-GuildMember
 * @param {Object} optionen { brauchtSprachkanal, brauchtSteuerrecht, brauchtAbspieler }
 * @returns {Promise<{ok: boolean, fehler: string|null, manager: Object, abspieler: Object|null}>}
 */
async function pruefen(mitglied, optionen = {}) {
    const {
        brauchtSprachkanal = true,
        brauchtSteuerrecht = false,
        brauchtAbspieler = false
    } = optionen;

    const manager = mitglied?.client?.musicManager;
    if (!manager) {
        return { ok: false, fehler: 'Das Musik-System laeuft gerade nicht.', manager: null, abspieler: null };
    }

    if (brauchtSprachkanal && !mitglied.voice?.channel) {
        return { ok: false, fehler: 'Du musst dafuer in einem Sprachkanal sein.', manager, abspieler: null };
    }

    const abspieler = manager.vorhanden(mitglied.guild.id);

    if (brauchtAbspieler && (!abspieler || !abspieler.verbunden)) {
        return { ok: false, fehler: 'Es laeuft gerade nichts.', manager, abspieler: null };
    }

    // Wer im falschen Kanal steht, soll nicht mitsteuern
    if (abspieler?.verbunden && mitglied.voice?.channel && abspieler.sprachKanalId !== mitglied.voice.channel.id) {
        return { ok: false, fehler: 'Du bist in einem anderen Sprachkanal als der Bot.', manager, abspieler };
    }

    if (brauchtSteuerrecht && !(await manager.darfSteuern(mitglied))) {
        return { ok: false, fehler: 'Dafuer brauchst du die DJ-Rolle.', manager, abspieler };
    }

    return { ok: true, fehler: null, manager, abspieler };
}

/** Dauer lesbar machen. */
const dauerText = (sek) => GuildPlayer.dauerText(sek);

/**
 * Einen Titel als Zeile darstellen.
 *
 * @param {Object} t Titel
 * @param {number} [nummer] Laufende Nummer
 * @returns {string} Zeile
 */
function titelZeile(t, nummer = null) {
    const vorn = nummer !== null ? `**${nummer}.** ` : '';
    const adresse = t.herkunftUrl || t.url;
    const name = adresse ? `[${t.title}](${adresse})` : t.title;
    return `${vorn}${name} \`${dauerText(t.durationSec)}\``;
}

/** Sekunden als "1 Std. 4 Min." - fuer Restspielzeiten. */
function spielzeitText(sek) {
    if (!sek || sek <= 0) return '—';
    const stunden = Math.floor(sek / 3600);
    const minuten = Math.round((sek % 3600) / 60);
    return stunden > 0 ? `${stunden} Std. ${minuten} Min.` : `${minuten} Min.`;
}

/** Kurzer Hinweistext zu einem fehlgeschlagenen Aufloesen. */
const HINWEISE = {
    KEINE_EINGABE: 'Du hast nichts angegeben.',
    QUELLE_AUS: 'Diese Quelle ist auf dem Server abgeschaltet.',
    SPOTIFY_UNVERFUEGBAR: 'Spotify ist nicht eingerichtet. Es fehlen SPOTIFY_CLIENT_ID und SPOTIFY_CLIENT_SECRET in apps/bot/.env.',
    SOUNDCLOUD_UNVERFUEGBAR: 'SoundCloud ist gerade nicht erreichbar.',
    NICHTS_GEFUNDEN: 'Dazu habe ich nichts gefunden.',
    AUFLOESEN_FEHLGESCHLAGEN: 'Das konnte ich nicht aufloesen.'
};

/**
 * Hinweis in Text uebersetzen.
 *
 * @param {string} hinweis Kennung aus dem Aufloeser
 * @returns {string} Text
 */
function hinweisText(hinweis) {
    return HINWEISE[hinweis] || 'Das hat nicht geklappt.';
}

module.exports = { FARBE, antwort, pruefen, dauerText, titelZeile, spielzeitText, hinweisText };
