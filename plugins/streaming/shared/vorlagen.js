'use strict';

/**
 * Streaming - was in einer Vorlage stehen darf und welche gilt.
 *
 * Eigene Datei, weil diese Regeln an drei Stellen gebraucht werden: der Router
 * prueft damit die Eingabe, die Ausgabe waehlt damit die Vorlage, und das
 * Pruefskript spielt sie ohne Datenbank durch. Laege das im Router, koennte
 * man es nur mit einer laufenden Anlage pruefen - und genau solche Regeln
 * werden dann nie geprueft.
 *
 * **Keine Datenbank, kein Discord, kein Express.** Werte herein, Urteil heraus.
 *
 * @module streaming/shared/vorlagen
 */

/**
 * Die gueltigen Platzhalter.
 *
 * Das ist ein **Vertrag** mit `dashboard/ausgabe/nachricht.js`: Was hier steht,
 * muss dort gefuellt werden. Ein Platzhalter, den nur diese Liste kennt,
 * erscheint woertlich in der Ankuendigung - und das sieht man erst im Discord.
 */
const PLATZHALTER = [
    { name: '{streamer}',  bedeutung: 'Anzeigename des Kanals' },
    { name: '{titel}',     bedeutung: 'Titel der Sendung' },
    { name: '{kategorie}', bedeutung: 'Spiel oder Kategorie' },
    { name: '{url}',       bedeutung: 'Adresse des Streams' },
    { name: '{zuschauer}', bedeutung: 'Zuschauerzahl' },
    { name: '{rolle}',     bedeutung: 'Erwaehnung der eingestellten Rolle' },
    { name: '{plattform}', bedeutung: 'Twitch, Kick oder YouTube' },
    { name: '{dauer}',     bedeutung: 'nur in der Rueckschau nach dem Stream' }
];

/**
 * Was im Twitch-Chat stehen darf (Stufe 13c).
 *
 * **Eine eigene Liste, keine Teilmenge per Filter.** Zwei Platzhalter fehlen
 * hier, und jeder aus einem anderen Grund:
 *
 *   `{rolle}`  ist eine Discord-Erwaehnung. Im Twitch-Chat erschiene sie
 *              woertlich als `<@&123…>` - eine Zeichenkette, die niemanden
 *              anspricht und nach einem Fehler aussieht.
 *   `{dauer}`  gehoert der Rueckschau. Die Ansage kommt beim Start; eine
 *              Dauer gibt es zu diesem Zeitpunkt nicht.
 *
 * Ein Filter ueber `PLATZHALTER` wuerde dasselbe leisten und beim naechsten
 * neuen Platzhalter still das Falsche tun - er waere dann in beiden Listen.
 */
const PLATZHALTER_CHAT = [
    { name: '{streamer}',  bedeutung: 'Anzeigename des Kanals' },
    { name: '{titel}',     bedeutung: 'Titel der Sendung' },
    { name: '{kategorie}', bedeutung: 'Spiel oder Kategorie' },
    { name: '{url}',       bedeutung: 'Adresse des Streams' },
    { name: '{plattform}', bedeutung: 'Twitch, Kick oder YouTube' }
];

/** Discord nimmt 2000 Zeichen. Wir bleiben darunter, weil Platzhalter wachsen. */
const VORLAGE_MAX = 1000;

/**
 * Twitch nimmt 500 Zeichen je Chatnachricht - laengere weist es ab.
 *
 * Anders als bei Discord ist das **die** Grenze und nicht unsere Vorsicht:
 * Hier wird nicht gekuerzt, sondern abgelehnt, bevor gespeichert wird. Ein
 * Text, der jedes Mal scheitert, waere ein Schalter, der aussieht wie an.
 */
const CHAT_MAX = 500;

/** Was gilt, solange niemand etwas eingestellt hat. */
const VORGABE_LIVE       = '{rolle} {streamer} ist jetzt live!';
const VORGABE_RUECKSCHAU = '{streamer} war live — {dauer}.';

/**
 * Die Vorgabe fuer den Twitch-Chat - **in der ersten Person**.
 *
 * Das ist kein Geschmack, sondern die Folge der Entscheidung vom 2026-08-29:
 * Der Bot schreibt unter dem Namen des Streamers. Ein "{streamer} ist jetzt
 * live!" stuende dann als Satz **ueber sich selbst** unter seinem eigenen
 * Namen - im Chat liest sich das, als spraeche jemand von sich in der dritten
 * Person. Wer es anders will, aendert es; die Vorgabe soll aber nicht schon
 * beim ersten Einschalten schief klingen.
 */
const VORGABE_CHAT = 'Wir sind live! {titel}';

/**
 * Eine Vorlage pruefen, bevor sie gespeichert wird.
 *
 * Zwei Faelle, die im Betrieb wehtun: ein Text, der die Grenze von Discord
 * sprengt (die Ankuendigung scheitert dann **jedes** Mal, nicht einmal), und
 * ein erfundener Platzhalter.
 *
 * Leer ist ausdruecklich in Ordnung - das heisst "nimm den Standard".
 *
 * @param {string} text Vorlage
 * @returns {string|null} 'zu_lang' | 'platzhalter' | null
 */
function pruefeVorlage(text) {
    const t = String(text || '');
    if (t.length > VORLAGE_MAX) return 'zu_lang';

    const bekannt = new Set(PLATZHALTER.map(p => p.name));
    const benutzt = t.match(/\{[a-z_]+\}/gi) || [];
    if (benutzt.some(b => !bekannt.has(b.toLowerCase()))) return 'platzhalter';

    return null;
}

/**
 * Eine Chat-Vorlage pruefen, bevor sie gespeichert wird (Stufe 13c).
 *
 * Dieselben zwei Faelle wie oben, nur mit anderen Grenzen - und einem dritten,
 * den es bei Discord nicht gibt:
 *
 *   `zu_lang`      ueber 500 Zeichen weist Twitch die Nachricht ab.
 *   `platzhalter`  ein erfundener Name stuende woertlich im Chat.
 *   `nur_discord`  `{rolle}` und `{dauer}` sind gueltige Platzhalter - aber
 *                  nicht hier. Sie als "unbekannt" zu melden waere die
 *                  schlechtere Auskunft: Der Streamer hat sie ja auf der
 *                  Ankuendigungsseite gesehen und haelt unsere Meldung fuer
 *                  einen Fehler.
 *
 * Leer ist ausdruecklich in Ordnung - das heisst "nimm den Standard".
 *
 * @param {string} text Vorlage
 * @returns {string|null} 'zu_lang' | 'platzhalter' | 'nur_discord' | null
 */
function pruefeChatVorlage(text) {
    const t = String(text || '');
    if (t.length > CHAT_MAX) return 'zu_lang';

    const erlaubt = new Set(PLATZHALTER_CHAT.map(p => p.name));
    const alle    = new Set(PLATZHALTER.map(p => p.name));
    const benutzt = t.match(/\{[a-z_]+\}/gi) || [];

    for (const b of benutzt) {
        const name = b.toLowerCase();
        if (erlaubt.has(name)) continue;
        return alle.has(name) ? 'nur_discord' : 'platzhalter';
    }

    return null;
}

/**
 * Welche Vorlage gilt: die des Ziels, sonst die der Guild, sonst die Vorgabe.
 *
 * Wichtig ist die Behandlung von Leerraum: Ein Feld, in dem nur ein Leerzeichen
 * steht, ist **keine** Vorlage. Ohne diese Pruefung entstuende eine leere
 * Ankuendigung - technisch erfolgreich, im Discord unsichtbar.
 *
 * @param {string|null} eigene Vorlage des Ziels
 * @param {string|null} derGuild Standard der Guild
 * @param {string} vorgabe Letzter Rueckfall
 * @returns {string} die geltende Vorlage
 */
function vorlageWaehlen(eigene, derGuild, vorgabe) {
    const brauchbar = (w) => typeof w === 'string' && w.trim().length > 0;
    if (brauchbar(eigene))   return eigene;
    if (brauchbar(derGuild)) return derGuild;
    return vorgabe;
}

module.exports = {
    PLATZHALTER,
    PLATZHALTER_CHAT,
    VORLAGE_MAX,
    CHAT_MAX,
    VORGABE_LIVE,
    VORGABE_RUECKSCHAU,
    VORGABE_CHAT,
    pruefeVorlage,
    pruefeChatVorlage,
    vorlageWaehlen
};
