'use strict';

/**
 * Der Befehlsbaukasten (Stufe 15).
 *
 * ## Was hier passiert — und was ausdruecklich nicht
 *
 * Der Auswerter bekommt eine Chatnachricht, sieht nach, ob sie mit einem
 * bekannten Wort beginnt, und schickt eine Antwort. **Er speichert nichts
 * davon.** Weder Text noch Absender verlassen diesen Aufruf; `streaming_commands`
 * hat fuer beides keine Spalte. Was bleibt, ist eine Summe ohne Person
 * (`benutzt_anzahl`) — sie beantwortet „lohnt der Befehl?", nicht „wer hat
 * gefragt?".
 *
 * Damit erledigt sich die Sperre, die auf der Entwurfsseite stand („erst die
 * Rechtsfrage"): Zwischen Twitch und dem Streamer besteht die Autorisierung
 * bereits, und die Frage, die die Sperre wirklich schuetzte — das Aufbewahren —
 * stellt sich hier nicht.
 *
 * ## Zwei Sorten, und die Grenze dazwischen ist scharf
 *
 * **Fertige Befehle** beantwortet die Anlage aus dem, was sie ohnehin weiss:
 * wie lange der Stream laeuft, was gespielt wird, welche Befehle es gibt. Sie
 * brauchen keine Eingabe.
 *
 * **Eigene Befehle** antworten mit dem Text des Streamers.
 *
 * `!discord` ist bewusst KEIN fertiger Befehl, obwohl er auf jeder Liste
 * steht: Die Anlage kennt die Einladungsadresse einer Guild nicht, und sie zu
 * erfinden waere schlimmer als sie wegzulassen. Er ist ein eigener Befehl mit
 * vorgeschlagenem Wort — der Streamer setzt seinen Link ein. „Alles andere
 * kommt vom Streamer."
 *
 * @module streaming/kern/befehle
 */

const { ServiceManager } = require('dunebot-core');

/** Genau ein Zeichen, und es steht hier statt in jeder Zeile. */
const PRAEFIX = '!';

/**
 * Die fertigen Befehle.
 *
 * Der Schluessel ist das Wort. Wer einen neuen will, schreibt ihn hier hin —
 * und `scripts/check-streaming-befehle.js` haelt Liste und Ansicht zusammen.
 *
 * ## Zwei Sorten, seit P9
 *
 *   `antwort(k)`   gibt einen Satz zurueck. Rein, schnell, ohne Aussenwelt —
 *                  alles, was die Anlage ohnehin weiss.
 *   `tun(k)`       darf **etwas bewirken** und ist deshalb asynchron: `!clip`
 *                  schneidet bei Twitch, `!umfrage` fragt dort nach.
 *
 * **Warum das nicht dasselbe Feld ist.** Eine Funktion, die manchmal ein
 * Versprechen zurueckgibt und manchmal einen Satz, laedt zum vergessenen
 * `await` ein — und der faellt nicht auf: Im Chat stuende dann
 * `[object Promise]`. Zwei Namen trennen „rechnet" von „wirkt", und der
 * Auswerter sieht am Feld, was er zu erwarten hat.
 *
 * ## Die drei Felder daneben
 *
 *   `zusage`         Welche Erlaubnis der Kanalinhaber erteilt haben muss.
 *                    Nur zur Anzeige — der Befehl prueft sie nicht vorab,
 *                    Twitch antwortet ohnehin mit 401, und eine zweite
 *                    Pruefung waere eine zweite Wahrheit.
 *   `wer`            Der **Anfangswert** von `streaming_commands.wer`, nicht
 *                    die Regel. Ein Befehl, der etwas bewirkt, faengt eng an;
 *                    aufmachen kann der Streamer ihn auf der Befehlsseite.
 *   `abkuehlung_s`   Ebenso ein Anfangswert. `!clip` schneidet einen echten
 *                    Clip - fuenf Sekunden Abstand waeren hier zu wenig.
 */
const FERTIG = {
    uptime: {
        beschreibung: 'Wie lange der Stream schon läuft.',
        antwort: (k) => k.live
            ? `${k.streamer} ist seit ${dauerText(k.seitMs)} live.`
            : `${k.streamer} ist gerade nicht live.`
    },
    spiel: {
        beschreibung: 'Titel und Kategorie des laufenden Streams.',
        antwort: (k) => !k.live ? `${k.streamer} ist gerade nicht live.`
            : (k.kategorie ? `${k.kategorie} — ${k.titel || 'ohne Titel'}`
                           : (k.titel || 'Titel und Kategorie sind nicht gesetzt.'))
    },
    befehle: {
        beschreibung: 'Zählt auf, welche Befehle es hier gibt.',

        // **Getrennt mit ` · `, nicht mit einem Leerzeichen.** Bis zum
        // 2026-09-07 stand hier `join(' ')`, und die Antwort war eine
        // Wortkette: `!request !song !playlist !skip`. Im Chat, wo die Zeile
        // umbricht und andere Nachrichten daruntersacken, ist das nicht
        // lesbar. Echte Zeilen gibt es bei Twitch nicht - eine Nachricht ist
        // eine Zeile -, also ist das Trennzeichen alles, was geht. Dasselbe
        // benutzt `!umfrage` nebenan schon.
        //
        // **Und die Liste kann zu lang werden.** Twitch nimmt 500 Zeichen; was
        // darueber steht, kommt abgeschnitten oder gar nicht an. Bei zwoelf
        // Befehlen ist das weit weg, aber der Baukasten laesst eigene zu, und
        // die Grenze faellt erst auf, wenn die Antwort einmal verschwindet.
        // Deshalb wird hier gekuerzt und **gesagt, dass gekuerzt wurde** -
        // eine still abgeschnittene Liste sieht aus wie eine vollstaendige.
        antwort: (k) => {
            if (!k.woerter.length) return 'Hier sind noch keine Befehle eingerichtet.';

            const vorspann = 'Verfügbar: ';
            const teile = k.woerter.map(w => PRAEFIX + w);
            const ganz = vorspann + teile.join(' · ');
            if (ganz.length <= 480) return ganz;

            // Ruecken, bis der Hinweis mit hineinpasst.
            let passt = teile.length;
            let text = '';
            while (passt > 0) {
                const rest = teile.length - passt;
                text = vorspann + teile.slice(0, passt).join(' · ')
                     + ` … und ${rest} weitere`;
                if (text.length <= 480) break;
                passt--;
            }
            return text;
        }
    },

    // **Der erste Befehl, der etwas bewirkt** (P9, 2026-09-05). Bis hierher
    // haben alle nur erzaehlt, was die Anlage ohnehin wusste.
    clip: {
        beschreibung: 'Schneidet einen Clip aus den letzten Sekunden.',
        zusage: 'clip',
        wer: 'moderator',
        abkuehlung_s: 60,
        tun: async (k) => {
            // **Offline gibt es nichts zu schneiden**, und Twitch sagt das mit
            // einer 404. Die vorher abzufangen ist kein doppelter Boden,
            // sondern ein Satz, den ein Zuschauer versteht — die Antwort von
            // Twitch laese sich wie eine Stoerung.
            if (!k.live) return `${k.streamer} ist gerade nicht live — davon lässt sich kein Clip schneiden.`;

            const ergebnis = await require('./mitmachen').clipSchneiden(k.streamerZeile);
            if (ergebnis.ok) return `Clip: ${ergebnis.url}`;

            // **Der Grund geht ins Protokoll, nicht in den Chat.** Dort sitzen
            // Zuschauer; „Der Schluessel wird von Twitch abgelehnt" ist eine
            // Auskunft fuer den Streamer, und die steht auf seiner Seite.
            log().warn(`[Streaming] ${PRAEFIX}clip gescheitert: ${ergebnis.grund}`);
            return ergebnis.abgelehnt
                ? 'Clips sind für diesen Kanal nicht freigeschaltet.'
                : 'Der Clip hat gerade nicht geklappt.';
        }
    },

    umfrage: {
        beschreibung: 'Sagt, welche Umfrage gerade läuft und wie sie steht.',
        zusage: 'umfragen',
        wer: 'alle',
        abkuehlung_s: 30,
        tun: async (k) => {
            const stand = await require('./mitmachen').umfrageStand(k.streamerZeile);
            if (!stand.ok) {
                log().warn(`[Streaming] ${PRAEFIX}umfrage gescheitert: ${stand.grund}`);
                return 'Der Stand der Umfrage ist gerade nicht abrufbar.';
            }
            if (!stand.umfrage) return 'Gerade läuft keine Umfrage.';

            const u = stand.umfrage;
            const stimmen = u.antworten.map(a => `${a.titel}: ${a.stimmen}`).join(' · ');
            return `${u.frage} — ${stimmen} (${u.gesamt} Stimmen)`;
        }
    },

    // **Der erste Befehl, der ein anderes Plugin braucht** (2026-09-07).
    //
    // `abkuehlung_s: 0` ist hier kein Versehen. Die Abkuehlung gilt je
    // Befehlszeile und nicht je Zuschauer - fuenf Sekunden hiessen: ein
    // Zuschauer alle fuenf Sekunden kommt herein, alle anderen nicht, und
    // niemand merkt warum. Gebuendelt wird stattdessen die **Antwort**, in
    // `mitmachen.losZiehen`.
    //
    // Kein `zusage`: `!los` loest bei Twitch nichts aus, es schreibt nur in
    // den Chat - und das kann der Kanal ohnehin, sonst gaebe es hier gar
    // keine Befehle.
    los: {
        beschreibung: 'Beim laufenden Gewinnspiel mitmachen.',
        wer: 'alle',
        abkuehlung_s: 0,
        braucht: { plugin: 'giveaway', name: 'Verlosungen' },
        tun: (k) => require('./mitmachen').losZiehen(k)
    },

    // ================================================================
    // Musikwunsch (2026-09-07)
    //
    // **Englische Woerter, auf Entscheidung des Betreibers.** Die uebrigen
    // Befehle sind deutsch; das ist bewusst uneinheitlich und keine
    // Nachlaessigkeit - `!skip`, `!vote` und `!prev` sind in Twitch-Chats seit
    // Jahren dieselben Woerter, und ein Zuschauer tippt, was er kennt.
    //
    // **`!next` fehlt, obwohl es auf der Wunschliste stand.** Es waere
    // wortgleich mit `!skip`: beide gehen einen Schritt vor. Zwei Woerter fuer
    // dieselbe Wirkung sind zwei Wege, an denen spaeter einer etwas anderes
    // tut - genau der Einwand des Betreibers vom selben Tag. Wer `next`
    // lieber mag, legt ihn als eigenen Befehl an; dafuer ist der Baukasten da.
    // ================================================================

    request: {
        beschreibung: 'Wuenscht einen Titel aus der freigegebenen Ablage.',
        wer: 'alle',
        abkuehlung_s: 5,
        braucht: { plugin: 'music', name: 'Musik' },
        tun: async (k) => {
            const musik = require('../../shared/musikwunsch');
            const guildId = k.streamerZeile.heim_guild_id;

            const e = await musik.wuenschen(guildId, k.streamerZeile.id, k.rest, k.absender);
            if (e.ok) return `„${e.titel}" ist drin — ${e.offen} vor dir.`;

            // Jeder Grund bekommt seinen eigenen Satz. Ein gemeinsames
            // "hat nicht geklappt" liesse den Zuschauer raten, ob er sich
            // vertippt hat oder ob die Anlage streikt.
            if (e.grund === 'kein_begriff')  return `Sag dazu, was du hoeren willst: ${PRAEFIX}request <Titel>`;
            if (e.grund === 'nicht_gefunden') return 'Das habe ich hier nicht.';
            if (e.grund === 'keine_ablage') {
                log().warn(`[Streaming] ${PRAEFIX}request: keine Musikablage eingetragen`);
                return 'Musikwuensche sind gerade nicht moeglich.';
            }
            return 'Musikwuensche sind gerade nicht moeglich.';
        }
    },

    song: {
        beschreibung: 'Sagt, welcher Titel gerade laeuft.',
        wer: 'alle',
        abkuehlung_s: 10,
        braucht: { plugin: 'music', name: 'Musik' },
        tun: async (k) => {
            const musik = require('../../shared/musikwunsch');
            const zeile = await musik.aktueller(k.streamerZeile.heim_guild_id);

            if (!zeile) return 'Gerade laeuft nichts.';
            return zeile.gewuenscht_von
                ? `Laeuft: ${zeile.titel} — gewuenscht von ${zeile.gewuenscht_von}`
                : `Laeuft: ${zeile.titel}`;
        }
    },

    playlist: {
        beschreibung: 'Zeigt die naechsten Titel.',
        wer: 'alle',
        abkuehlung_s: 15,
        braucht: { plugin: 'music', name: 'Musik' },
        tun: async (k) => {
            const musik = require('../../shared/musikwunsch');
            const offen = await musik.warteschlange(k.streamerZeile.heim_guild_id,
                { nurOffene: true, grenze: 5 });

            if (!offen.length) return 'Danach ist die Liste leer.';
            return 'Als naechstes: ' + offen.map((z, i) => `${i + 1}. ${z.titel}`).join(' · ');
        }
    },

    skip: {
        beschreibung: 'Ueberspringt den laufenden Titel.',
        wer: 'moderator',
        abkuehlung_s: 0,
        braucht: { plugin: 'music', name: 'Musik' },
        tun: async (k) => {
            const musik = require('../../shared/musikwunsch');
            const e = await musik.springen(k.streamerZeile.heim_guild_id, +1);
            return e.ok ? `Weiter mit: ${e.titel}` : 'Danach kommt nichts mehr.';
        }
    },

    prev: {
        beschreibung: 'Geht einen Titel zurueck.',
        wer: 'moderator',
        abkuehlung_s: 0,
        braucht: { plugin: 'music', name: 'Musik' },
        tun: async (k) => {
            const musik = require('../../shared/musikwunsch');
            const e = await musik.springen(k.streamerZeile.heim_guild_id, -1);
            return e.ok ? `Zurueck zu: ${e.titel}` : 'Davor war nichts.';
        }
    },

    // **Kein `!start`.** Der Player nimmt sich den naechsten Titel von selbst,
    // sobald einer da ist - ein Startbefehl waere ein Knopf, den jemand
    // druecken muss, damit etwas passiert, das ohnehin passieren soll.
    // Gebraucht wird das Gegenteil: anhalten, wenn geredet wird.
    pause: {
        beschreibung: 'Haelt die Musik an.',
        wer: 'moderator',
        abkuehlung_s: 0,
        braucht: { plugin: 'music', name: 'Musik' },
        tun: async (k) => {
            const musik = require('../../shared/musikwunsch');
            await musik.abspielen(k.streamerZeile.heim_guild_id, false);
            return 'Musik angehalten.';
        }
    },

    play: {
        beschreibung: 'Laesst die Musik weiterlaufen.',
        wer: 'moderator',
        abkuehlung_s: 0,
        braucht: { plugin: 'music', name: 'Musik' },
        tun: async (k) => {
            const musik = require('../../shared/musikwunsch');
            const e = await musik.abspielen(k.streamerZeile.heim_guild_id, true);
            return e.titel ? `Weiter mit: ${e.titel}` : 'Musik laeuft — sobald etwas gewuenscht wird.';
        }
    },

    clear: {
        beschreibung: 'Leert die Warteschlange.',
        wer: 'moderator',
        abkuehlung_s: 0,
        braucht: { plugin: 'music', name: 'Musik' },
        tun: async (k) => {
            const musik = require('../../shared/musikwunsch');
            const weg = await musik.leeren(k.streamerZeile.heim_guild_id);
            return weg ? `Warteschlange geleert (${weg}).` : 'Die Warteschlange war schon leer.';
        }
    },

    vote: {
        beschreibung: 'Stimmt dafuer, den laufenden Titel zu ueberspringen.',
        wer: 'alle',
        abkuehlung_s: 0,
        braucht: { plugin: 'music', name: 'Musik' },
        tun: async (k) => {
            const musik = require('../../shared/musikwunsch');
            const guildId = k.streamerZeile.heim_guild_id;

            // Ohne laufenden Titel gibt es nichts zu ueberspringen - und eine
            // Stimme, die ins Leere gezaehlt wird, faellt beim naechsten Titel
            // als Geisterstimme auf.
            const laeuft = await musik.aktueller(guildId);
            if (!laeuft) return 'Gerade laeuft nichts.';

            // **Die Kennung, nicht der Name.** Ein Anzeigename ist aenderbar;
            // wer zweimal stimmen will, braeuchte nur einen Namenswechsel.
            const stand = musik.stimmeAbgeben(guildId, k.absenderId);
            if (stand.schon) return `Deine Stimme zaehlt schon (${stand.stimmen}/${stand.noetig}).`;

            if (!stand.reicht) {
                return `${stand.stimmen}/${stand.noetig} fuer Ueberspringen.`;
            }

            const e = await musik.springen(guildId, +1);
            return e.ok
                ? `Uebersprungen — weiter mit: ${e.titel}`
                : 'Genug Stimmen, aber danach kommt nichts mehr.';
        }
    }
};

/**
 * Braucht dieser Befehl ein anderes Plugin, und ist es da?
 *
 * **Eine Funktion, zwei Aufrufer** - und das ist der ganze Zweck. Die
 * Befehlsseite fragt sie, um den Schalter auszugrauen; der Auswerter fragt sie,
 * bevor er den Befehl ausfuehrt. Ohne den zweiten Aufrufer gaebe es eine
 * Luecke, die niemand sieht: Wer `!los` einschaltet, waehrend das
 * Verlosungs-Plugin an ist, und es danach abschaltet, haette einen aktiven
 * Befehl, der in ein Plugin greift, das es nicht mehr gibt. `aktiv = 1` in
 * `streaming_commands` weiss davon nichts.
 *
 * Bewusst **kein** Haken im anderen Plugin, der hier aufraeumt: Das
 * Verlosungs-Plugin darf den Namen "streaming" nicht kennen. Nachsehen statt
 * benachrichtigen laesst die Abhaengigkeit in die richtige Richtung zeigen.
 *
 * @param {string} guildId Guild
 * @param {string} wort Befehlswort
 * @returns {Promise<{ok: boolean, grund: string|null, braucht: Object|null}>} Stand
 */
async function verfuegbar(guildId, wort) {
    const braucht = FERTIG[wort]?.braucht || null;
    if (!braucht) return { ok: true, grund: null, braucht: null };

    // **`has` und nicht `get`.** `ServiceManager.get` wirft bei einem
    // unbekannten Dienst (`ServiceManager.js:24`), es gibt kein `null` zurueck
    // - ein `if (!dienst)` dahinter waere toter Code, und der Wurf landete auf
    // der Befehlsseite als Fehlerseite. Genau so stand es hier im ersten
    // Entwurf.
    if (!ServiceManager.has('pluginManager')) {
        // Ohne Auskunft nicht raten. "Verfuegbar" waere die bequeme Annahme
        // und die falsche: Der Befehl liefe dann ins Leere.
        return { ok: false, grund: `${braucht.name} lassen sich gerade nicht pruefen.`, braucht };
    }
    const pluginManager = ServiceManager.get('pluginManager');

    const an = await pluginManager.isPluginEnabledForGuild(braucht.plugin, guildId);
    return an
        ? { ok: true, grund: null, braucht }
        : { ok: false, grund: `Dafür muss das Plugin „${braucht.name}" aktiv sein.`, braucht };
}

/**
 * Der Stand aller eingebauten Befehle, die etwas brauchen.
 *
 * @param {string} guildId Guild
 * @returns {Promise<Object>} Wort -> Stand
 */
async function verfuegbarkeiten(guildId) {
    const stand = {};
    for (const wort of Object.keys(FERTIG)) {
        stand[wort] = await verfuegbar(guildId, wort);
    }
    return stand;
}

/**
 * Die Abkuehlung, mit der ein fertiger Befehl in die Welt kommt.
 *
 * **`|| 5` verschluckt eine gewollte 0.** Genau so stand es hier bis zum
 * 2026-09-07: `Number(vorgabe.abkuehlung_s) || 5`. `!los` traegt `0`, weil die
 * Abkuehlung je Befehlszeile gilt und nicht je Zuschauer - fuenf Sekunden
 * hiessen, dass bei einem Gewinnspiel ein Zuschauer alle fuenf Sekunden
 * hereinkommt und alle anderen nicht. Der Anfangswert wird nur beim ersten
 * Anschalten geschrieben; er waere also nie wieder korrigiert worden.
 *
 * Gefunden hat das der Waechter, nicht ich: Der Befehl war richtig erklaert
 * und wurde falsch angelegt.
 *
 * @param {Object} vorgabe Eintrag aus FERTIG
 * @returns {number} Sekunden
 */
function anfangsAbkuehlung(vorgabe) {
    const roh = Number(vorgabe?.abkuehlung_s);
    const wert = Number.isFinite(roh) ? roh : 5;
    return Math.max(0, Math.min(3600, wert));
}

/**
 * Die Antwort eines fertigen Befehls holen.
 *
 * **Der Fangkorb sitzt hier und nicht im Aufrufer.** `tun` redet mit Twitch;
 * ein Netzfehler dort darf die Auswertung einer Chatnachricht nicht abbrechen
 * lassen — der naechste Befehl waere sonst mit betroffen.
 *
 * @param {string} wort Befehlswort
 * @param {Object} k Kontext
 * @returns {Promise<string|null>} Antworttext
 */
async function fertigAntwort(wort, k) {
    const eintrag = FERTIG[wort];
    if (!eintrag) return null;

    if (eintrag.braucht) {
        const stand = await verfuegbar(k.streamerZeile?.heim_guild_id, wort);
        if (!stand.ok) {
            // Der Zuschauer bekommt einen Satz, keine Stille: Ein Befehl, der
            // in der Liste steht und schweigt, sieht aus wie ein kaputter Bot.
            return `${eintrag.braucht.name} sind hier gerade nicht eingerichtet.`;
        }
    }

    if (!eintrag.tun) return eintrag.antwort(k);

    try {
        return await eintrag.tun(k);
    } catch (err) {
        log().error(`[Streaming] ${PRAEFIX}${wort} ist unerwartet gescheitert`, err);
        // Ein Satz, kein Schweigen: Wer getippt hat, soll nicht raten, ob der
        // Bot ihn ueberhaupt gehoert hat.
        return 'Das hat gerade nicht geklappt.';
    }
}

/**
 * Die Platzhalter, die eine eigene Antwort kennt.
 *
 * **Ein Vertrag, wie `shared/vorlagen.js` ihn fuer die Ankuendigung fuehrt** —
 * und aus demselben Grund: Die Seite rendert ihre Bausteine aus dieser Liste,
 * statt sie danebenzuschreiben. Eine handgepflegte Liste in der Vorlage waere
 * beim naechsten neuen Platzhalter still veraltet, und man saehe es erst im
 * Chat. Der Modulkopf hat das schon versprochen, bevor es stimmte.
 *
 * `nurLive` heisst: steht offline leer da. Das ist keine Panne, sondern die
 * Entscheidung vom 2026-09-05 (siehe `fuellen`) — leer statt vom letzten Mal.
 *
 * `{2}`..`{9}` fehlen mit Absicht: Sie funktionieren, aber neun Bausteine
 * nebeneinander sind eine Wand, keine Hilfe. Der Text an `{1}` nennt sie.
 */
const PLATZHALTER = [
    { name: '{streamer}', bedeutung: 'Dein Kanalname' },
    { name: '{absender}', bedeutung: 'Wer den Befehl getippt hat' },
    { name: '{spiel}',    bedeutung: 'Die laufende Kategorie',  nurLive: true },
    { name: '{titel}',    bedeutung: 'Der Streamtitel',         nurLive: true },
    { name: '{uptime}',   bedeutung: 'Wie lange der Stream laeuft', nurLive: true },
    { name: '{rest}',     bedeutung: 'Alles, was hinter dem Befehl steht' },
    { name: '{1}',        bedeutung: 'Das erste Wort dahinter — {2}, {3} … gehen auch' }
];

/** Wer einen Befehl benutzen darf — von eng nach weit. */
const RANG = { inhaber: 3, moderator: 2, abonnent: 1, alle: 0 };

/**
 * Abkuehlung im Arbeitsspeicher, je Befehlszeile.
 *
 * **Nicht in der Datenbank.** Eine Abkuehlung von fuenf Sekunden ist keine
 * Auskunft, die einen Neustart ueberleben muss — und ein Schreibvorgang je
 * Chatnachricht waere der teuerste Weg, den billigsten Wert zu merken.
 */
const zuletzt = new Map();

/** @returns {Object} Datenbankdienst */
function db() {
    return ServiceManager.get('dbService');
}

/** @returns {Object} Protokoll */
function log() {
    return ServiceManager.get('Logger');
}

/**
 * Eine Dauer als Satzteil.
 *
 * @param {number} ms Millisekunden
 * @returns {string} etwa "2 Stunden 14 Minuten"
 */
function dauerText(ms) {
    const min = Math.max(0, Math.floor(Number(ms) / 60000));
    const std = Math.floor(min / 60);
    const rest = min % 60;
    if (std && rest) return `${std} Stunde${std === 1 ? '' : 'n'} ${rest} Minute${rest === 1 ? '' : 'n'}`;
    if (std) return `${std} Stunde${std === 1 ? '' : 'n'}`;
    return `${rest} Minute${rest === 1 ? '' : 'n'}`;
}

/**
 * Das Wort aus einer Nachricht holen.
 *
 * Gibt `null` zurueck, wenn es keiner ist — der haeufigste Fall, und er muss
 * billig sein: Bei jeder Chatnachricht laeuft diese Funktion.
 *
 * @param {string} text Nachrichtentext
 * @returns {{wort: string, rest: string}|null} Wort ohne Praefix
 */
function zerlegen(text) {
    const roh = String(text || '').trim();
    if (!roh.startsWith(PRAEFIX) || roh.length < 2) return null;

    const ohne = roh.slice(PRAEFIX.length);
    const luecke = ohne.search(/\s/);
    const wort = (luecke === -1 ? ohne : ohne.slice(0, luecke)).toLowerCase();

    // Ein Wort aus Sonderzeichen ist keines. Ohne diese Pruefung wuerde "!!!"
    // zu einer Suche nach dem Befehl "!!".
    if (!/^[a-z0-9_-]{1,32}$/.test(wort)) return null;

    return { wort, rest: luecke === -1 ? '' : ohne.slice(luecke).trim() };
}

/**
 * Darf dieser Absender den Befehl benutzen?
 *
 * @param {string} wer Verlangter Rang
 * @param {Object} kanal Uebersetzte Chatnachricht
 * @returns {boolean} true, wenn erlaubt
 */
function darf(wer, kanal) {
    const verlangt = RANG[String(wer || 'alle')] ?? 0;
    if (verlangt === 0) return true;

    // Der Kanalinhaber darf immer alles — er ist der Rang darueber, nicht ein
    // Sonderfall daneben.
    const hat = kanal.istInhaber ? RANG.inhaber
        : kanal.istModerator ? RANG.moderator
        : kanal.istAbonnent ? RANG.abonnent
        : RANG.alle;
    return hat >= verlangt;
}

/**
 * Platzhalter in einer eigenen Antwort fuellen.
 *
 * Unbekannte Platzhalter bleiben **stehen**. Sie leer zu ersetzen saehe aus wie
 * ein Tippfehler des Streamers — so sieht er, dass er einen erfunden hat.
 *
 * ## Die Reihenfolge ist eine Sicherheitsfrage, kein Geschmack
 *
 * Die Argumente werden **zuletzt** eingesetzt, und das muss so bleiben. Sie
 * sind das einzige, was ein beliebiger Zuschauer bestimmt: Wer `!gruss {spiel}`
 * tippt, faende seinen Text sonst als Platzhalter wieder und liesse den Bot
 * Dinge sagen, die der Streamer nie eingestellt hat. Zuletzt eingesetzt bleibt
 * `{spiel}` aus fremder Hand schlicht `{spiel}` — sichtbar und harmlos.
 *
 * Der `{absender}` ist zwar auch fremd, aber Twitch laesst in Anzeigenamen nur
 * Buchstaben, Ziffern und Unterstriche zu; geschweifte Klammern kommen dort
 * nicht vor.
 *
 * @param {string} vorlage Text des Streamers
 * @param {Object} k Kontext
 * @returns {string} gefuellter Text
 */
function fuellen(vorlage, k) {
    // **Was nur waehrend des Streams gilt, verschwindet danach.** `{spiel}` und
    // `{titel}` kamen bis zum 2026-09-05 unbesehen aus `streaming_state` - und
    // die Tabelle behaelt den letzten Stand, sie leert ihn nicht. Wer offline
    // einen Befehl tippte, las die Kategorie von gestern als die von jetzt.
    //
    // Das ist die Sorte Auskunft, die schlimmer ist als keine: Sie sieht
    // richtig aus. Der fertige `!spiel` fragt `live` seit jeher ab, `{uptime}`
    // auch - nur diese beiden nicht. Zwei Wege, eine Frage, verschiedene
    // Antwort; dieselbe Naht wie zwischen `gewuenschteArten` und `zieleFuer`.
    //
    // Leer statt falsch: Ein `Ich spiele {spiel}` liest sich offline dann
    // unfertig. Das sieht der Streamer und kann es aendern - eine erfundene
    // Kategorie sieht niemand.
    const imStream = (wert) => (k.live ? (wert || '') : '');

    return eigeneEinsetzen(String(vorlage || ''), k.eigene)
        .replace(/\{streamer\}/g, k.streamer || '')
        .replace(/\{absender\}/g, k.absender || '')
        .replace(/\{spiel\}/g,    imStream(k.kategorie))
        .replace(/\{titel\}/g,    imStream(k.titel))
        .replace(/\{uptime\}/g,   imStream(dauerText(k.seitMs)))

        // --- ab hier fremde Eingabe, siehe Kopf -------------------------
        // `{rest}` ist alles hinter dem Wort, `{1}`..`{9}` die einzelnen
        // Woerter darin. Beides wurde von `zerlegen` schon immer getrennt und
        // bis zum 2026-09-05 weggeworfen.
        //
        // Fehlt ein Wort, wird der Platzhalter leer - nicht stehengelassen.
        // Er ist ja bekannt; stehen bleibt nur, was wir nicht kennen.
        .replace(/\{rest\}/g, k.rest || '')
        .replace(/\{([1-9])\}/g, (_, n) => woerter(k.rest)[Number(n) - 1] || '');
}

/**
 * Die Woerter hinter dem Befehl.
 *
 * @param {string} rest Text hinter dem Befehlswort
 * @returns {Array<string>} Woerter ohne Leerraum
 */
function woerter(rest) {
    return String(rest || '').split(/\s+/).filter(Boolean);
}

/**
 * Die eigenen Textbausteine des Streamers einsetzen.
 *
 * **Zuerst, und genau EINMAL.**
 *
 * *Zuerst*, damit ein Baustein eingebaute Platzhalter enthalten darf: Wer
 * `{gruss}` auf „Hallo {absender}!" setzt, bekommt den Absender - die
 * eingebauten laufen ja danach.
 *
 * *Einmal*, weil der Weg sonst im Kreis liefe. `{a}` mit dem Wert `"{a}"`
 * ersetzte sich endlos, und der Auswerter haenge an einer Chatnachricht fest,
 * die jemand aus Versehen so eingetragen hat. Ein Baustein, der einen anderen
 * nennt, bleibt deshalb woertlich stehen - sichtbar, statt still gefaehrlich.
 *
 * Die Maskierung ist von `dunebot-core/lib/PlaceholderParser` uebernommen:
 * Der Name landet als Muster in einem regulaeren Ausdruck, und ein `.` darin
 * duerfte nicht „irgendein Zeichen" heissen. Warum die Funktion selbst nicht
 * benutzt wird, steht im Kopf von `kern/bausteine`.
 *
 * @param {string} text Vorlage
 * @param {Map<string, string>|null} eigene Name auf Wert
 * @returns {string} Text mit eingesetzten Bausteinen
 */
function eigeneEinsetzen(text, eigene) {
    if (!eigene || !eigene.size) return text;

    let ergebnis = text;
    for (const [name, wert] of eigene) {
        const maskiert = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        ergebnis = ergebnis.replace(new RegExp(`\\{${maskiert}\\}`, 'g'), String(wert ?? ''));
    }
    return ergebnis;
}

/**
 * Die Befehle eines Kanals holen.
 *
 * `streamer_id IS NULL` heisst „gilt fuer jeden Kanal dieser Guild" — die
 * Zeile mit Kanal gewinnt, wenn es beide gibt.
 *
 * @param {string} guildId Discord-Guild-ID
 * @param {number} streamerId Streamer
 * @returns {Promise<Array<Object>>} Zeilen
 */
async function befehleFuer(guildId, streamerId) {
    return await db().query(`
        SELECT id, wort, art, antwort, zaehler_name, wer, abkuehlung_s
          FROM streaming_commands
         WHERE guild_id = ? AND aktiv = 1 AND (streamer_id = ? OR streamer_id IS NULL)
         ORDER BY streamer_id IS NULL ASC
    `, [guildId, streamerId]);
}

/**
 * Eine Chatnachricht auswerten und, wenn es ein Befehl war, antworten.
 *
 * **Der Rueckgabewert ist eine Auskunft, kein Erfolg.** Wer hier `null`
 * bekommt, hat keine Nachricht verpasst — es war schlicht kein Befehl. Alles
 * andere ist ein Satz fuer das Protokoll.
 *
 * @param {Object} kanal Uebersetzte Chatnachricht aus `twitch.chatAus`
 * @returns {Promise<string|null>} Was geschah, oder null
 */
async function auswerten(kanal) {
    if (!kanal || !kanal.text) return null;

    const zerlegt = zerlegen(kanal.text);
    if (!zerlegt) return null;

    // Erst jetzt wird die Datenbank gefragt. Bei jeder Chatnachricht eine
    // Abfrage waere der Preis dafuer, dass jemand "hallo" schreibt.
    const streamer = (await db().query(
        // `s.plattform` sieht ueberfluessig aus - der Chat kommt schliesslich
        // von Twitch. Es ist aber der Parameter, mit dem `kanalInhaber` sucht,
        // und eine fehlende Spalte ist in JS kein Fehler, sondern `undefined`.
        // Am 2026-09-05 hat mysql2 daran den ersten echten `!uptime` zerlegt.
        `SELECT s.id, s.plattform, s.login, s.anzeigename, s.kanal_id, s.heim_guild_id,
                z.ist_live, z.titel, z.kategorie, z.begonnen_am
           FROM streaming_streamers s
           LEFT JOIN streaming_state z ON z.streamer_id = s.id
          WHERE s.kanal_id = ?`, [String(kanal.kanalId)]))[0];

    if (!streamer) return null;
    if (!streamer.heim_guild_id) {
        // Ohne Heim-Guild gibt es keinen Ort, an dem Befehle eingerichtet
        // waeren. Das ist kein Fehler, sondern ein Kanal, der das nicht nutzt.
        return null;
    }

    const zeilen = await befehleFuer(String(streamer.heim_guild_id), streamer.id);
    const zeile = zeilen.find(z => z.wort === zerlegt.wort);
    if (!zeile) return null;

    if (!darf(zeile.wer, kanal)) {
        // **Keine Antwort im Chat.** Wer nicht darf, bekommt keine Belehrung —
        // das ist die Bauform aller Chatbots, und sie verhindert, dass ein
        // Fremder den Chat mit Absagen fluten kann.
        return `${PRAEFIX}${zeile.wort}: nicht erlaubt fuer diesen Absender`;
    }

    const jetzt = Date.now();
    const letzte = zuletzt.get(zeile.id) || 0;
    const kuehl = Math.max(0, Number(zeile.abkuehlung_s) || 0) * 1000;
    if (jetzt - letzte < kuehl) return `${PRAEFIX}${zeile.wort}: noch in der Abkuehlung`;

    const bausteine = require('./bausteine');

    // **Erst hochzaehlen, dann lesen.** Sonst nennt die Antwort den Stand von
    // vorher - `!tode` sagte "3", nachdem er auf 4 gestellt hat, und der
    // Streamer haelt den Zaehler fuer kaputt.
    //
    // Es steht NACH der Abkuehlung und nach der Rechtepruefung: Wer nicht darf
    // oder zu schnell tippt, zaehlt auch nicht hoch.
    if (zeile.zaehler_name) {
        await bausteine.hochzaehlen(
            streamer.heim_guild_id, streamer.id, zeile.zaehler_name);
    }

    // **Die Abfrage nur, wenn der Text sie braucht.** Fast jede Antwort kommt
    // mit den eingebauten Platzhaltern aus; eine dritte Abfrage je Befehl waere
    // der Preis dafuer, dass jemand `!regeln` tippt.
    //
    // Der Zaehlername kommt immer mit, auch wenn er nicht im Text steht: Ein
    // Befehl darf hochzaehlen, ohne die Zahl zu nennen.
    const fremde = zeile.art === 'fertig' ? [] : bausteine.fremdeNamenIn(zeile.antwort);
    if (zeile.zaehler_name && !fremde.includes(zeile.zaehler_name)) {
        fremde.push(zeile.zaehler_name);
    }
    const eigene = fremde.length
        ? await bausteine.werteFuer(streamer.heim_guild_id, streamer.id, fremde)
        : null;

    const kontext = {
        eigene,

        // **Die ganze Zeile, nicht nur der Name.** `tun` braucht `kanal_id`
        // und `plattform`, um bei Twitch etwas auszuloesen. Sie heisst
        // ausdruecklich nicht `kanal`: So heisst in dieser Datei die
        // uebersetzte Chatnachricht (`darf(wer, kanal)`), und zwei Dinge mit
        // einem Namen sind der Anfang eines langen Nachmittags.
        streamerZeile: streamer,

        streamer: streamer.anzeigename || streamer.login,
        absender: kanal.absender,

        // **Die Kennung, nicht nur der Name.** Ein Anzeigename bei Twitch ist
        // aenderbar; wer sein Los daran haengt, verliert es beim naechsten
        // Namenswechsel. `istAbonnent` kommt aus den Abzeichen der Nachricht
        // selbst - dafuer braucht es keine Abfrage.
        absenderId: kanal.absenderId,
        istAbonnent: Boolean(kanal.istAbonnent),

        live: Boolean(streamer.ist_live),
        titel: streamer.titel,
        kategorie: streamer.kategorie,
        seitMs: streamer.begonnen_am ? jetzt - new Date(streamer.begonnen_am).getTime() : 0,
        woerter: zeilen.map(z => z.wort),
        rest: zerlegt.rest
    };

    const roh = zeile.art === 'fertig'
        ? await fertigAntwort(zeile.wort, kontext)
        : fuellen(zeile.antwort, kontext);

    // **Derselbe Aufraeumer wie bei der Live-Ansage, und aus zwei Gruenden.**
    //
    // Der erste ist das Eingabefeld: Es ist ein `<textarea>` und laedt zu
    // mehreren Zeilen ein — der Twitch-Chat kennt aber keine. Am 2026-09-05
    // ging der erste echte `!regeln` mit vier `\r\n` hinaus, und was Twitch
    // damit macht, ist nirgends zugesagt. Sich darauf zu verlassen waere eine
    // Wette.
    //
    // Der zweite sind die Loecher, die leere Platzhalter hinterlassen:
    // `{spiel} ({titel})` wird offline zu `spielt  ()`. Genau dafuer gibt es
    // `saubern` seit der Live-Ansage — ein zweiter Aufraeumer daneben waere
    // dieselbe Naht noch einmal.
    const text = require('../ausgabe/chatansage').saubern(roh || '');

    // Ein leerer Satz ist kein Satz — dieselbe Regel wie bei der Live-Ansage.
    // Twitch wiese ihn ab, und der Fehlertext waere kryptisch.
    if (!text) {
        return `${PRAEFIX}${zeile.wort}: die Antwort ist leer`;
    }

    // Die Abkuehlung greift ab dem Versuch, nicht ab dem Erfolg. Sonst
    // koennte ein dauerhaft fehlschlagender Befehl beliebig oft anlaufen.
    zuletzt.set(zeile.id, jetzt);

    const gesendet = await senden(streamer, text.slice(0, 500));

    // Summe ohne Person. Sie steht bewusst NACH dem Senden: Ein Befehl, der
    // nicht hinausging, wurde nicht benutzt.
    if (gesendet.ok) {
        await db().query(
            `UPDATE streaming_commands
                SET benutzt_anzahl = benutzt_anzahl + 1, benutzt_am = NOW(3)
              WHERE id = ?`, [zeile.id]);
    }

    return `${PRAEFIX}${zeile.wort}: ${gesendet.ok ? 'beantwortet' : gesendet.grund}`;
}

/**
 * Die Antwort unter dem Namen des Streamers in seinen Chat schreiben.
 *
 * Derselbe Weg wie die Live-Ansage: Der Schluessel gehoert dem Kanalinhaber,
 * `mitZugang` entschluesselt, erneuert bei 401 und vermerkt einen Widerruf.
 *
 * @param {Object} streamer Zeile aus `streaming_streamers`
 * @param {string} text Antwort
 * @returns {Promise<{ok: boolean, grund: string|null}>} Ergebnis
 */
async function senden(streamer, text) {
    const twitch = require('../plattformen/twitch');
    const abonnenten = require('./abonnenten');
    const Verbindungsspeicher = require('../../../../apps/dashboard/helpers/Verbindungsspeicher');

    const inhaber = await abonnenten.kanalInhaber(streamer);
    if (!inhaber) return { ok: false, grund: 'kein verknuepfter Kanalinhaber' };

    const ergebnis = await Verbindungsspeicher.mitZugang(
        { userId: inhaber, plattform: 'twitch' },
        (zugang) => twitch.chatSenden(streamer.kanal_id, text, zugang));

    // `null` heisst: gar keine Zusage mehr. Das ist ein Widerruf und liest sich
    // als Entscheidung des Streamers, nicht als Stoerung.
    if (!ergebnis) return { ok: false, grund: 'Schreiben unter dem eigenen Namen ist nicht (mehr) erlaubt' };
    if (!ergebnis.ok) return { ok: false, grund: ergebnis.grund || 'Twitch hat abgelehnt' };
    return { ok: true, grund: null };
}

// =====================================================
// Verwaltung — was die Seite braucht
// =====================================================
//
// **Die Guild-Kennung steht in JEDER Abfrage**, auch bei `id`-Zugriffen. Eine
// Kennung aus der Adresse ist eine Behauptung des Aufrufers; ohne das `AND
// guild_id = ?` koennte eine Guild die Befehle einer anderen aendern, und die
// Rechtepruefung am Router saehe trotzdem richtig aus.

/**
 * Alle Befehle einer Guild — auch die abgeschalteten.
 *
 * @param {string} guildId Discord-Guild-ID
 * @returns {Promise<Array<Object>>} Zeilen
 */
async function alleFuerGuild(guildId) {
    return await db().query(
        `SELECT id, streamer_id, wort, art, antwort, wer, abkuehlung_s, aktiv,
                benutzt_anzahl, benutzt_am
           FROM streaming_commands
          WHERE guild_id = ?
          ORDER BY art DESC, wort ASC`, [guildId]);
}

/**
 * Einen eigenen Befehl anlegen.
 *
 * @param {string} guildId Discord-Guild-ID
 * @param {number|null} streamerId Kanal, oder null fuer alle der Guild
 * @param {Object} f Felder
 * @param {string} userId Wer ihn anlegt
 * @returns {Promise<{ok: boolean, grund: string|null}>} Ergebnis
 */
async function anlegen(guildId, streamerId, f, userId) {
    const wort = String(f.wort || '').trim().replace(/^!+/, '').toLowerCase();
    if (!/^[a-z0-9_-]{1,32}$/.test(wort)) {
        return { ok: false, grund: 'wort' };
    }
    if (FERTIG[wort]) {
        // Ein eigener Befehl darf nicht heissen wie ein fertiger — sonst
        // entschiede die Sortierung, welcher antwortet.
        return { ok: false, grund: 'belegt' };
    }
    if (!String(f.antwort || '').trim()) return { ok: false, grund: 'antwort' };

    try {
        await db().query(
            `INSERT INTO streaming_commands
               (guild_id, streamer_id, wort, art, antwort, zaehler_name, wer, abkuehlung_s, angelegt_von)
             VALUES (?, ?, ?, 'eigen', ?, ?, ?, ?, ?)`,
            [guildId, streamerId, wort, String(f.antwort).slice(0, 500),
             zaehlerName(f.zaehler_name),
             RANG[f.wer] === undefined ? 'alle' : f.wer,
             Math.max(0, Math.min(3600, Number(f.abkuehlung_s) || 0)), userId || null]);
        return { ok: true, grund: null };
    } catch (err) {
        // Der eindeutige Schluessel ist die Wahrheit, nicht eine Vorabfrage:
        // Zwischen "gibt es schon?" und `INSERT` passt ein zweiter Aufruf.
        if (String(err?.code) === 'ER_DUP_ENTRY') return { ok: false, grund: 'doppelt' };
        throw err;
    }
}

/**
 * Einen Befehl aendern.
 *
 * Das Wort bleibt, wie es ist — es umzubenennen waere ein anderer Befehl, und
 * die Zuschauer haetten den alten im Kopf. Wer ihn anders nennen will, legt
 * einen neuen an.
 *
 * @param {number} id Befehl
 * @param {string} guildId Discord-Guild-ID
 * @param {Object} f Felder
 * @returns {Promise<boolean>} true, wenn eine Zeile getroffen wurde
 */
async function aendern(id, guildId, f) {
    const ergebnis = await db().query(
        `UPDATE streaming_commands
            SET antwort = ?, zaehler_name = ?, wer = ?, abkuehlung_s = ?, aktiv = ?
          WHERE id = ? AND guild_id = ?`,
        [f.antwort === undefined ? null : String(f.antwort).slice(0, 500),
         zaehlerName(f.zaehler_name),
         RANG[f.wer] === undefined ? 'alle' : f.wer,
         Math.max(0, Math.min(3600, Number(f.abkuehlung_s) || 0)),
         f.aktiv ? 1 : 0, Number(id), guildId]);
    return Boolean(ergebnis?.affectedRows);
}

/**
 * Den Zaehlernamen herrichten, den ein Befehl hochzaehlt.
 *
 * **Leer heisst `null`, nicht `''`.** Eine leere Zeichenkette waere ein Name,
 * den `hochzaehlen` suchen wuerde - jede Benutzung eine Abfrage ins Leere. Und
 * die Bedingung `if (zeile.zaehler_name)` traefe auf `''` nicht zu, auf ein
 * einzelnes Leerzeichen aber schon.
 *
 * @param {string|undefined} roh Eingabe aus dem Formular
 * @returns {string|null} Name ohne Klammern, klein - oder null
 */
function zaehlerName(roh) {
    const name = String(roh || '').trim().replace(/^\{|\}$/g, '').toLowerCase();
    return /^[a-z0-9_-]{1,32}$/.test(name) ? name : null;
}

/**
 * Einen Befehl entfernen.
 *
 * @param {number} id Befehl
 * @param {string} guildId Discord-Guild-ID
 * @returns {Promise<boolean>} true, wenn eine Zeile getroffen wurde
 */
async function entfernen(id, guildId) {
    const ergebnis = await db().query(
        'DELETE FROM streaming_commands WHERE id = ? AND guild_id = ?', [Number(id), guildId]);
    return Boolean(ergebnis?.affectedRows);
}

/**
 * Die fertigen Befehle einer Guild auf eine Auswahl bringen.
 *
 * **Abwaehlen schaltet ab, es loescht nicht.** Ein fertiger Befehl traegt keine
 * Eingabe des Streamers, aber seine Benutzungszahl — und die ist eine Auskunft,
 * die beim Wiedereinschalten nicht bei null anfangen soll.
 *
 * ## `wer` kommt mit, `abkuehlung_s` nicht
 *
 * Seit P9 bewirkt ein fertiger Befehl etwas (`!clip`), und damit wird „wer darf
 * das" zu einer echten Frage — sie gehoert dem Streamer, nicht uns. Sie steht
 * deshalb im Formular.
 *
 * Die **Abkuehlung** steht dort bewusst nicht: Sie haengt nicht am Geschmack,
 * sondern daran, was der Befehl ausloest. Die 60 Sekunden von `!clip` sind
 * Twitchs Takt, keine Vorliebe.
 *
 * @param {string} guildId Discord-Guild-ID
 * @param {number|null} streamerId Kanal
 * @param {Array<string>} gewaehlt Worte
 * @param {Object<string, string>} [wer] Je Wort der verlangte Rang
 * @returns {Promise<void>}
 */
async function fertigSetzen(guildId, streamerId, gewaehlt, wer = {}) {
    // **Was nicht da ist, laesst sich nicht einschalten.** Der Schalter ist auf
    // der Seite schon ausgegraut; das hier ist die Stelle, die es auch dann
    // haelt, wenn jemand das Formular selbst zusammensetzt.
    const erlaubt = [];
    for (const wort of gewaehlt || []) {
        const stand = await verfuegbar(guildId, wort);
        if (stand.ok) erlaubt.push(wort);
    }
    gewaehlt = erlaubt;

    const will = new Set((gewaehlt || []).filter(w => FERTIG[w]));

    for (const wort of Object.keys(FERTIG)) {
        const an = will.has(wort) ? 1 : 0;

        // **`wer` und `abkuehlung_s` stehen im INSERT, nicht im UPDATE.** Sie
        // sind Anfangswerte: Beim ersten Anschalten gelten die aus `FERTIG`,
        // danach gehoert die Zeile dem Streamer. Sie bei jedem Speichern
        // mitzuschreiben hiesse, seine Einstellung stillschweigend
        // zurueckzudrehen — und zwar genau dann, wenn er einen ganz anderen
        // Befehl umschaltet.
        const vorgabe = FERTIG[wort];

        // **Das Formular gewinnt, wenn es etwas sagt — sonst gilt die Vorgabe.**
        // Ein unbekannter Rang wird nicht auf 'alle' gebogen, sondern ignoriert:
        // Aus einem verpfuschten Formularfeld darf kein aufgemachter Befehl
        // werden, und `!clip` steht sonst plotzlich jedem offen.
        const gewuenscht = wer && RANG[wer[wort]] !== undefined ? wer[wort] : null;

        await db().query(
            `INSERT INTO streaming_commands (guild_id, streamer_id, wort, art, aktiv, wer, abkuehlung_s)
             VALUES (?, ?, ?, 'fertig', ?, ?, ?)
             ON DUPLICATE KEY UPDATE aktiv = VALUES(aktiv), art = 'fertig'${gewuenscht ? ', wer = VALUES(wer)' : ''}`,
            [guildId, streamerId, wort, an,
             gewuenscht || (RANG[vorgabe.wer] === undefined ? 'alle' : vorgabe.wer),
             anfangsAbkuehlung(vorgabe)]);
    }
}

module.exports = {
    PRAEFIX, FERTIG, RANG, PLATZHALTER,
    alleFuerGuild, anlegen, aendern, entfernen, fertigSetzen,
    zerlegen, darf, fuellen, dauerText, fertigAntwort,
    befehleFuer, auswerten, verfuegbar, verfuegbarkeiten
};
