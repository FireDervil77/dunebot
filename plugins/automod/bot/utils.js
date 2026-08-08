/**
 * AutoMod - Hilfsmittel fuer den Nachrichten-Handler.
 *
 * ── Warum der Anti-Spam hier neu steht ──────────────────────────────────────
 *
 * Der alte Zwischenspeicher merkte sich je Nutzer **eine** Nachricht und
 * verglich sie mit der naechsten. Das hatte fuenf Fehler auf einmal: Er lief
 * nur bei Nachrichten mit Link, verlangte einen Kanalwechsel, wurde nach dem
 * ersten Eintrag nie wieder aufgefrischt (der Zeitstempel blieb fuer immer auf
 * der ersten Nachricht stehen), sein Aufraeumer wurde nirgends gestartet, und
 * er hing an `!anti_links`. Zusammen hiess das: nach der ersten Link-Nachricht
 * eines Nutzers war Anti-Spam fuer diesen Nutzer bis zum Bot-Neustart tot.
 *
 * Spam ist eine **Rate**, kein Linkfilter. Deshalb merkt sich der Verlauf jetzt
 * die letzten Nachrichten je Nutzer und Guild und beantwortet zwei getrennte
 * Fragen:
 *
 *   1. Zu viele Nachrichten in zu kurzer Zeit?  (`anti_spam_messages` / `anti_spam_seconds`)
 *   2. Zu oft dieselbe Nachricht hintereinander? (`anti_spam_duplicates`)
 *
 * Frage 2 zaehlt bewusst **kanaluebergreifend** - das Verteilen derselben
 * Nachricht auf viele Kanaele ist der haeufigere Fall und war das Einzige, was
 * der alte Code ueberhaupt gemeint hat.
 */

/**
 * Verlauf je Nutzer und Guild.
 *
 * Schluessel: `guildId|userId`
 * Wert:       Array von `{ inhalt, zeit }`, aeltester zuerst.
 *
 * @type {Map<string, Array<{inhalt: string, zeit: number}>>}
 */
const nachrichtenVerlauf = new Map();

/**
 * Wie lange ein Eintrag hoechstens aufgehoben wird.
 *
 * Deckt jedes sinnvolle `anti_spam_seconds` ab und begrenzt zugleich, wie weit
 * die Wiederholungspruefung zurueckschaut.
 */
const VERLAUF_MAX_MS = 60 * 1000;

/** Wie viele Eintraege je Nutzer hoechstens aufgehoben werden. */
const VERLAUF_MAX_EINTRAEGE = 25;

/** Aufraeum-Takt. */
const AUFRAEUM_TAKT_MS = 5 * 60 * 1000;

/** Handle des laufenden Aufraeumers - verhindert doppelte Intervalle. */
let aufraeumUhr = null;

/**
 * Startet den Aufraeumer.
 *
 * Der Vorgaenger wurde exportiert, aber **nie aufgerufen** - deshalb wuchs die
 * Map unbegrenzt und alte Eintraege blieben ewig stehen. Diese Fassung wird im
 * Bot-Plugin bei `onEnable` gestartet und ist gegen Mehrfachaufruf geschuetzt.
 *
 * @returns {void}
 */
function starteVerlaufAufraeumer() {
    if (aufraeumUhr) return;

    aufraeumUhr = setInterval(() => {
        const jetzt = Date.now();
        for (const [schluessel, eintraege] of nachrichtenVerlauf) {
            const frisch = eintraege.filter(e => jetzt - e.zeit < VERLAUF_MAX_MS);
            if (frisch.length === 0) {
                nachrichtenVerlauf.delete(schluessel);
            } else {
                nachrichtenVerlauf.set(schluessel, frisch);
            }
        }
    }, AUFRAEUM_TAKT_MS);

    // Der Aufraeumer darf den Prozess nicht am Beenden hindern.
    if (typeof aufraeumUhr.unref === 'function') aufraeumUhr.unref();
}

/**
 * Stoppt den Aufraeumer und leert den Verlauf (fuer `onDisable`).
 *
 * @returns {void}
 */
function stoppeVerlaufAufraeumer() {
    if (aufraeumUhr) {
        clearInterval(aufraeumUhr);
        aufraeumUhr = null;
    }
    nachrichtenVerlauf.clear();
}

/**
 * Traegt eine Nachricht in den Verlauf ein und prueft beide Spam-Muster.
 *
 * Anders als frueher wird der Eintrag **bei jeder** Nachricht geschrieben, nicht
 * nur beim ersten Mal - genau daran ist der alte Anti-Spam gescheitert.
 *
 * @param {import("discord.js").Message} message Die eingegangene Nachricht
 * @param {Object} settings Guild-Einstellungen aus `automod_settings`
 * @returns {{ getroffen: boolean, grund: 'RATE'|'WIEDERHOLUNG'|null, anzahl: number, grenze: number }}
 */
function pruefeSpam(message, settings) {
    const ohneBefund = { getroffen: false, grund: null, anzahl: 0, grenze: 0 };

    // Vorgaben, falls die Spalten fehlen (alte Datenbank ohne die Migration).
    const maxNachrichten = Number(settings.anti_spam_messages) || 5;
    const fensterSek     = Number(settings.anti_spam_seconds) || 5;
    const maxGleiche     = Number(settings.anti_spam_duplicates) || 3;

    const schluessel = `${message.guildId}|${message.author.id}`;
    const jetzt = Date.now();

    const eintraege = nachrichtenVerlauf.get(schluessel) || [];
    eintraege.push({ inhalt: message.content || '', zeit: jetzt });

    // Alte Eintraege wegwerfen und die Laenge deckeln, damit der Verlauf auch
    // ohne Aufraeumer nicht unbegrenzt waechst.
    const beschnitten = eintraege
        .filter(e => jetzt - e.zeit < VERLAUF_MAX_MS)
        .slice(-VERLAUF_MAX_EINTRAEGE);

    nachrichtenVerlauf.set(schluessel, beschnitten);

    // ── Muster 1: zu viele Nachrichten im Zeitfenster ────────────────────────
    const imFenster = beschnitten.filter(e => jetzt - e.zeit < fensterSek * 1000);
    if (imFenster.length >= maxNachrichten) {
        // Nach dem Treffer zuruecksetzen, sonst loest jede weitere Nachricht
        // desselben Schwalls erneut aus und der Nutzer sammelt Strikes im
        // Sekundentakt.
        nachrichtenVerlauf.delete(schluessel);
        return { getroffen: true, grund: 'RATE', anzahl: imFenster.length, grenze: maxNachrichten };
    }

    // ── Muster 2: dieselbe Nachricht mehrfach hintereinander ─────────────────
    // Leere Nachrichten (reine Anhaenge, Embeds) zaehlen hier nicht mit,
    // sonst gilt jedes Bilder-Album als Wiederholung.
    const inhalt = (message.content || '').trim();
    if (inhalt.length > 0) {
        let gleiche = 0;
        for (let i = beschnitten.length - 1; i >= 0; i--) {
            if ((beschnitten[i].inhalt || '').trim() !== inhalt) break;
            gleiche++;
        }

        if (gleiche >= maxGleiche) {
            nachrichtenVerlauf.delete(schluessel);
            return { getroffen: true, grund: 'WIEDERHOLUNG', anzahl: gleiche, grenze: maxGleiche };
        }
    }

    return ohneBefund;
}

/**
 * Praefix je Guild, kurz zwischengespeichert.
 *
 * `dbService.getConfigs` fragt jedes Mal die Datenbank - und das hier laeuft
 * bei **jeder** Nachricht. Fuenf Minuten Gedaechtnis reichen voellig; wer den
 * Praefix aendert, wartet notfalls einmal ab.
 *
 * @type {Map<string, {praefix: string, zeit: number}>}
 */
const praefixSpeicher = new Map();
const PRAEFIX_HALTBAR_MS = 5 * 60 * 1000;

/**
 * Ist das eine Praefix-Befehlsnachricht?
 *
 * Der Vorgaenger fragte `message.isCommand` ab - eine Eigenschaft, die es auf
 * `Message` nicht gibt (nur `Interaction.isCommand()`). Der Ausdruck war immer
 * `undefined`, Befehlsnachrichten liefen also voll durch die Moderation. Das
 * faellt erst mit dem neuen Anti-Spam auf: Wer fuenfmal `!music skip` tippt,
 * hat sonst einen Strike.
 *
 * Der Befehlsverteiler haengt an einem **eigenen** `messageCreate`-Listener und
 * laeuft parallel zu diesem Handler - er kann hier nichts abfangen.
 *
 * @param {import("discord.js").Message} message
 * @returns {Promise<boolean>}
 */
async function istBefehlsnachricht(message) {
    const inhalt = (message.content || '').trim();
    if (!inhalt || !message.guildId) return false;

    let eintrag = praefixSpeicher.get(message.guildId);
    if (!eintrag || Date.now() - eintrag.zeit > PRAEFIX_HALTBAR_MS) {
        let praefix = '!';
        try {
            const { ServiceManager } = require('dunebot-core');
            const dbService = ServiceManager.get('dbService');
            const configs = await dbService.getConfigs(message.guildId, 'core', 'shared');
            if (configs?.PREFIX_COMMANDS_PREFIX) praefix = String(configs.PREFIX_COMMANDS_PREFIX);
        } catch {
            // Bei einem Datenbankfehler bleibt es beim Standardpraefix - lieber
            // eine Befehlsnachricht zu viel verschonen als eine zu wenig.
        }
        eintrag = { praefix, zeit: Date.now() };
        praefixSpeicher.set(message.guildId, eintrag);
    }

    return inhalt.startsWith(eintrag.praefix);
}

/**
 * Darf diese Nachricht ueberhaupt moderiert werden?
 *
 * @param {import("discord.js").Message} message
 * @returns {boolean}
 */
function shouldModerate(message) {
    const { member, guild, channel } = message;

    // Ignore if bot cannot delete channel messages
    if (!channel.permissionsFor(guild.members.me)?.has("ManageMessages")) return false;

    // Ignore Possible Guild Moderators
    if (member.permissions.has(["KickMembers", "BanMembers", "ManageGuild"])) return false;

    // Ignore Possible Channel Moderators
    if (channel.permissionsFor(message.member).has("ManageMessages")) return false;
    return true;
}

module.exports = {
    nachrichtenVerlauf,
    pruefeSpam,
    istBefehlsnachricht,
    starteVerlaufAufraeumer,
    stoppeVerlaufAufraeumer,
    shouldModerate,
};
