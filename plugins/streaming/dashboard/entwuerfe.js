'use strict';

/**
 * Die Seiten, die es noch nicht gibt — als Daten.
 *
 * ## Warum sie ueberhaupt schon da sind
 *
 * Der Schnitt aus dem Panel-Entwurf steht nur, wenn man ihn sieht. "Mein
 * Chatbot" mit einem einzigen Punkt ist keine Gliederung, sondern eine
 * Ankuendigung — genau die Bauform, gegen die das Wizebot-Papier schreibt.
 * Erst mit Befehlen, Schutz, Mitmachen und Statistik daneben laesst sich
 * beurteilen, ob der Zuschnitt taugt.
 *
 * ## Die Regel: keine Bedienelemente
 *
 * Kein Schalter, kein Eingabefeld, kein Speichern-Knopf. Ein Formular, das
 * nicht speichert, ist eine Attrappe — und Attrappen sehen fertig aus,
 * versagen beim ersten Einsatz lautlos, und niemand weiss hinterher, ob es je
 * funktioniert hat.
 *
 * Was hier steht, ist deshalb Prosa: was die Seite koennen soll, was dafuer
 * schon liegt (**mit der Stelle im Code**, nicht geschaetzt), und was ihr
 * fehlt.
 *
 * ## Warum die Texte hier stehen und nicht in den Sprachdateien
 *
 * Sie beschreiben einen **Bauzustand** und verschwinden mit ihm. Ein Eintrag
 * in `de-DE.json`, der in vier Wochen weg ist, hinterlaesst eine Leiche in
 * einer Datei, die niemand mehr durchsieht — die Sprachdateien tragen heute
 * schon `NAV.STREAMERS`, `NAV.TARGETS` und `NAV.TEMPLATES`, die seit dem
 * 2026-08-29 kein Menuepunkt mehr benutzt.
 *
 * Das Geruest (Ueberschriften, Marken) liegt dagegen unter `ENTWURF.*` in den
 * Sprachdateien: Es bleibt, solange es Entwurfsseiten gibt.
 *
 * @module streaming/dashboard/entwuerfe
 */

/**
 * Alle Entwurfsseiten.
 *
 * `zustand`: 'entwurf' (nichts davon steht) oder 'halb' (ein Teil laeuft
 * bereits woanders).
 *
 * `gebaut`: Ist es gebaut, steht hier das Datum — und der Eintrag wird **nicht
 * mehr gerendert**. Der Router ueberspringt ihn, die Seite hat eine eigene
 * Route.
 *
 * **Warum der Eintrag dann nicht geloescht wird.** Er ist der Bauplan, gegen
 * den geliefert wurde: was die Seite koennen sollte, was schon lag, was
 * fehlte. Ihn zu entfernen hiesse, den Massstab wegzuwerfen, sobald man ihn
 * erfuellt hat — und beim naechsten Zweifel („war das ueberhaupt gemeint?")
 * steht nichts mehr da. Streichen heisst vergessen; hier wird umetikettiert.
 *
 * Der Preis ist ehrlich zu nennen: Diese Eintraege liest niemand mehr. Sie
 * sind Text fuer Menschen, nicht Daten fuer den Router - und `namen()` gibt
 * sie weiterhin aus, damit der Router sie ueberspringen KANN statt sie nicht
 * zu kennen.
 *
 * **Kein `recht` hier.** Es stand kurz in dieser Tabelle und wurde wieder
 * entfernt: Ein Recht, das aus Daten kommt, ist am Router nicht mehr ablesbar
 * — `scripts/check-streaming-rechte.js` hat es prompt als fehlend gemeldet.
 * Es steht jetzt als Literal in `guild.router.js`, dort wo es wirkt.
 */
const SEITEN = {

    befehle: {
        gebaut: '2026-09-05',   // Stufe 15 — eigene Route, eigene Ansicht
        icon: 'fa-solid fa-terminal',
        titel: 'Meine Befehle',
        untertitel: 'Was der Bot antwortet, wenn jemand etwas in deinen Chat tippt',
        zustand: 'entwurf',
        nurHeim: true,

        wofuer: {
            titel: 'Zwei Sorten Befehle',
            saetze: [
                '<b>Fertige Befehle</b> holen sich etwas aus dem System — wie lange du schon live bist, '
                + 'welches Spiel läuft, welcher Discord dazugehört. Anschalten reicht.',
                '<b>Eigene Befehle</b> antworten mit einem Text, den du selbst schreibst. Du gibst das '
                + 'Wort vor — etwa <code>!regeln</code> — und die Antwort dazu.'
            ]
        },

        merkmale: [
            { zustand: 'entwurf', icon: 'fa-brands fa-discord', titel: '!discord',
              text: 'Verweist auf deine Heim-Guild. Den Link kennt der Bot von selbst.' },
            { zustand: 'entwurf', icon: 'fa-solid fa-clock', titel: '!uptime',
              text: 'Wie lange der Stream schon läuft.' },
            { zustand: 'entwurf', icon: 'fa-solid fa-gamepad', titel: '!spiel',
              text: 'Titel und Kategorie des laufenden Streams.' },
            { zustand: 'entwurf', icon: 'fa-solid fa-pen', titel: 'Eigene Befehle',
              text: 'Ein Wort, eine Antwort, und wer ihn benutzen darf.' }
        ],

        vorhanden: [
            { was: 'Der Auswerter (seit Stufe 15)', wo: 'kern/befehle.auswerten()' },
            { was: 'Die Tabelle für eigene Befehle', wo: 'streaming_commands' },
            { was: 'Fertige Befehle', wo: '!uptime, !spiel, !befehle' },
            { was: 'Der Bot kann senden (seit 13c)', wo: 'twitch.chatSenden()' }
        ],

        fehlt: [
            { was: 'Diese Seite',
              warum: 'Die Maschine läuft, der Ort zum Einrichten fehlt noch — Liste, Formular, '
                   + 'Rechte. Bis dahin steht kein Befehl in der Tabelle, und der Auswerter '
                   + 'antwortet auf nichts.' }
        ],

        // **Die Sperre ist aufgelöst** (2026-09-05, Entscheidung des Betreibers).
        //
        // Hier stand „Erst die Rechtsfrage, dann der Baukasten — ein
        // Befehlsauswerter liest Nachrichten fremder Menschen". Der Einwand des
        // Betreibers trifft: Zwischen Twitch und dem Streamer besteht die
        // Autorisierung bereits; wir bauen die nutzbare Plattform darauf, wie
        // Wizebot und Nightbot es auch tun.
        //
        // Und was die Sperre wirklich schützte, war das SPEICHERN. Das passiert
        // nicht: Der Auswerter sieht den Text im Arbeitsspeicher, antwortet und
        // vergisst ihn. `streaming_commands` hat für Text und Absender keine
        // Spalte, und `scripts/check-streaming-befehle.js` prüft beides — an
        // Werten, die sonst nirgends vorkommen.
        hinweis: {
            titel: 'Was gespeichert wird — und was nicht',
            text: 'In die Tabelle kommt nur, was <b>du</b> schreibst: dein Wort und deine Antwort. '
                + 'Vom Chat wird nichts aufbewahrt — kein Text, kein Absender. Gezählt wird eine '
                + 'Summe ohne Person: <i>wie oft</i> ein Befehl benutzt wurde, nicht von wem.'
        },

        verweise: [{ text: 'Mein Kanal', url: 'chatbot' }]
    },

    ansagen: {
        gebaut: '2026-09-05',   // P6 — Timer-Ansagen, eigene Route, eigene Ansicht
        icon: 'fa-solid fa-clock',
        titel: 'Meine Ansagen',
        untertitel: 'Was der Bot von sich aus in deinen Chat schreibt — unter deinem Namen',
        zustand: 'halb',
        nurHeim: true,

        wofuer: {
            titel: 'Die Live-Ansage gibt es schon',
            saetze: [
                'Sie steht bei <b>Mein Kanal</b> und ist dort einzustellen — eine Zeile zum Streamstart, '
                + 'in der ersten Person, weil dein Name darunter steht.',
                'Was hier fehlt, sind <b>Timer-Ansagen</b>: was der Bot wiederholt, während du sendest. '
                + 'Dein Discord, dein YouTube, deine Regeln — was du willst.'
            ]
        },

        merkmale: [
            { zustand: 'steht', icon: 'fa-solid fa-tower-broadcast', titel: 'Wenn ich live gehe',
              text: 'Gebaut und einstellbar unter „Mein Kanal“.' },
            { zustand: 'entwurf', icon: 'fa-brands fa-discord', titel: 'Werbung für den eigenen Discord',
              text: '„Komm auf den Server“ — alle 25 Minuten.' },
            { zustand: 'entwurf', icon: 'fa-brands fa-youtube', titel: 'Verweis auf YouTube',
              text: 'Wo die Aufzeichnungen liegen.' },
            { zustand: 'entwurf', icon: 'fa-solid fa-pen', titel: 'Freier Text',
              text: 'Regeln, Spendenlink, Mitspieler, laufendes Projekt.' }
        ],

        vorhanden: [
            { was: 'Der Zeitplan', wo: 'kern/takt.js' },
            { was: 'Der Sendeweg', wo: 'twitch.chatSenden()' },
            { was: 'Die Zählung für „nur wenn was los ist“', wo: 'conduit.chatGezaehlt()' }
        ],

        fehlt: [
            { was: 'Die Verbindung dazwischen',
              warum: 'Alle drei Teile liegen. Es fehlt die Stelle, die im Takt nachsieht, ob genug '
                   + 'Nachrichten seit der letzten Ansage kamen, und dann sendet.' },
            { was: 'Ein Feld für die eigene YouTube-Adresse',
              warum: '<code>{discord}</code> kennt der Bot selbst — die Heim-Guild und ihre Einladung. '
                   + '<code>{youtube}</code> müsste einmal eingetragen werden.' }
        ],

        verweise: [{ text: 'Mein Kanal', url: 'chatbot' }]
    },

    schutz: {
        icon: 'fa-solid fa-shield',
        titel: 'Chat-Schutz',
        untertitel: 'Deine Discord-Regeln, angewandt auf den Twitch-Chat',
        zustand: 'entwurf',
        nurHeim: true,

        wofuer: {
            titel: 'Eine Regelmenge, alle Chats',
            saetze: [
                'Was du im Discord gegen Großschreibung, Links und verbotene Wörter eingestellt hast, '
                + 'soll hier auch gelten — dieselben Regeln, dieselben Ausnahmen, dieselbe Eskalation. '
                + 'Du pflegst sie an einer Stelle.',
                'Das kann Wizebot nicht: Dort sind es zwei getrennte Systeme, weil es kein Discord gibt.'
            ]
        },

        merkmale: [
            { zustand: 'entwurf', icon: 'fa-solid fa-font', titel: 'Großschreibung',
              text: 'Die Caps-Regel aus dem Automod, auch für Twitch.' },
            { zustand: 'entwurf', icon: 'fa-solid fa-link', titel: 'Links',
              text: 'Wer Links schicken darf und wer nicht.' },
            { zustand: 'entwurf', icon: 'fa-solid fa-ban', titel: 'Verbotene Wörter',
              text: 'Dieselbe Stichwortliste wie im Discord.' },
            { zustand: 'entwurf', icon: 'fa-solid fa-globe', titel: 'Später auch YouTube und Kick',
              text: 'Dieselbe Regelmenge, ein weiterer Ausgang — kein drittes Regelwerk.' }
        ],

        vorhanden: [
            { was: 'Der reine Mustervergleich', wo: 'automod/shared/stichwortTreffer.js' },
            { was: 'Regeln, Stichwörter, Ausnahmen, Eskalation', wo: 'Plugin automod' },
            { was: 'Nachsehen, ob ein Plugin läuft', wo: 'pluginManager.isPluginEnabledForGuild()' }
        ],

        fehlt: [
            { was: 'Eine Prüfschicht, die nur Text sieht',
              warum: '<code>automod/bot/events/messageCreate.js</code> sind <b>472 Zeilen in einer '
                   + 'einzigen Funktion</b> über dem Discord-Nachrichtenobjekt, mit 20 Zugriffen darauf. '
                   + 'Es gibt keine Stelle, an der man „prüfe diesen Text für diese Guild“ aufrufen '
                   + 'könnte.' },
            { was: 'Ein Ausgang für Twitch',
              warum: 'Löschen und Auszeiten laufen über andere Aufrufe als im Discord — und über andere '
                   + 'Zusagen, die noch niemand erteilt hat.' }
        ],

        sperre: {
            titel: 'Der teuerste Posten der Liste',
            text: 'Diese Seite sah wie der billige Hebel aus. Sie ist es nicht: Sie kostet zuerst, die '
                + 'Prüfschicht aus 472 Zeilen herauszulösen — <b>und das Discord-Verhalten dabei '
                + 'unverändert zu lassen</b>. Das ist eine eigene Stufe, kein Anbau.'
        },

        verweise: [{ text: 'Automod öffnen', url: 'PLUGIN:automod' }]
    },

    mitmachen: {
        // **Gebaut am 2026-09-06 — aber nur zur Haelfte, und das steht auf der
        // Seite selbst.** Clip, Umfrage und seit dem 2026-09-07 auch die
        // Verlosung sind fertig. Der urspruengliche Text dazu lautete: Verlosung und
        // Musikwunsch wurden gemessen und zurueckgestellt: `addEntry` sieht nach
        // reinen Kennungen aus, aber `checkRequirements` ruft in Zeile 2
        // `guild.members.fetch(userId)` und gibt sonst `member_not_found`. Ein
        // Twitch-Zuschauer ohne Discord-Konto scheitert dort nicht an einer
        // Regel, sondern an der Verrohrung.
        //
        // Der Eintrag bleibt trotzdem stehen: Er ist der Bauplan, gegen den
        // geliefert wurde — und die zwei fehlenden Punkte sind daran ablesbar.
        gebaut: '2026-09-06',
        icon: 'fa-solid fa-hand-sparkles',
        titel: 'Mitmachen',
        untertitel: 'Was deine Zuschauer aus dem Chat heraus auslösen können',

        // `halb`, nicht `entwurf`: Drei von vier Merkmalen laufen. Die Marke
        // oben soll dasselbe sagen wie die Symbole darunter - sonst liest der
        // Betreiber "Entwurf" und sieht drei gruene Punkte.
        zustand: 'halb',
        nurHeim: true,

        wofuer: {
            titel: 'Das meiste steht schon — für Discord',
            saetze: [
                'Verlosungen liegen im <b>Verlosungs-Plugin</b>, Musikwünsche im <b>Musik-Plugin</b>. '
                + 'Es fehlt nicht die Funktion, sondern der Chat als <b>zweiter Ein- und Ausgang</b> zu '
                + 'derselben Funktion.',
                'Diese Seite soll deshalb nichts Neues anlegen. Sie schaltet zu, was es gibt — eine '
                + 'Verlosung, zwei Wege hinein.'
            ]
        },

        merkmale: [
            { zustand: 'steht', icon: 'fa-solid fa-gift', titel: 'Verlosung',
              text: 'Mitmachen per <code>!los</code>. Angelegt wird weiter im Verlosungs-Plugin — '
                  + 'dort stellst du bei der Verlosung ein, ob im Discord, im Stream oder in beidem '
                  + 'mitgemacht wird.' },
            { zustand: 'entwurf', icon: 'fa-solid fa-music', titel: 'Musikwunsch',
              text: 'Wünschen per <code>!wunsch</code>. Warteschlange und Rechte aus dem Musik-Plugin.' },
            { zustand: 'steht', icon: 'fa-solid fa-square-poll-vertical', titel: 'Umfrage',
              text: 'Twitch-eigene Umfragen: <code>!umfrage</code> sagt den Stand.' },
            { zustand: 'steht', icon: 'fa-solid fa-scissors', titel: 'Clip',
              text: '<code>!clip</code> schneidet die letzten Sekunden. Am 2026-09-06 im Stream gelaufen.' }
        ],

        vorhanden: [
            { was: 'Verlosungen samt Vorlagen und Sperrliste', wo: 'Plugin giveaway' },
            { was: 'Musikwünsche, Warteschlange, Verlauf', wo: 'Plugin music' },
            { was: 'Der Weg vom Chat herein', wo: 'conduit.chatGezaehlt()' }
        ],

        fehlt: [
            { was: 'Musikwunsch aus dem Chat',
              warum: '<code>!wunsch</code> gibt es noch nicht. Die Verrohrung wäre dieselbe wie bei '
                   + 'der Verlosung; offen ist etwas anderes — <b>was im Stream überhaupt laufen '
                   + 'darf</b>.' },
            { was: 'Streamsichere Musik',
              warum: 'Der einzige Punkt, der wirklich neu wäre. Ein Musikwunsch im Discord landet in '
                   + 'einem privaten Sprachkanal; derselbe Wunsch im Stream geht an ein Publikum. '
                   + '<b>Ungeprüft ist bisher alles daran</b> — ob das Musik-Plugin zwischen Quellen '
                   + 'unterscheiden kann, wie eine Positivliste gepflegt würde, ob es brauchbare '
                   + 'Quellen gibt.' }
        ],

        verweise: [
            { text: 'Meine Befehle', url: 'befehle' },
            { text: 'Verlosungen', url: 'PLUGIN:giveaway' },
            { text: 'Musik', url: 'PLUGIN:music' }
        ]
    },

    statistik: {
        gebaut: '2026-09-05',   // P7 — eigene Route, eigene Ansicht
        icon: 'fa-solid fa-chart-line',
        titel: 'Statistik',
        untertitel: 'Wie der Stream lief — aus Twitchs eigenen Listen',
        zustand: 'entwurf',
        nurHeim: true,

        wofuer: {
            titel: 'Die Linie verläuft nach Herkunft, nicht nach Namen',
            saetze: [
                '<b>Was Twitch führt und dir ohnehin zeigt</b> — Follower, Abonnenten, Bits-Rangliste, '
                + 'Raids — darf diese Seite anzeigen. Twitch hat dafür den Zweck und die Beziehung zum '
                + 'Zuschauer; wir sind das Fenster, nicht die Quelle.',
                '<b>Was erst durch unser Mitschreiben entstünde</b> — wie oft jemand da war, wer wie viel '
                + 'geschrieben hat — führt Twitch nicht. Das legten wir an, und nur dort steht die Frage.'
            ]
        },

        merkmale: [
            { zustand: 'entwurf', icon: 'fa-solid fa-stopwatch', titel: 'Bilanz je Stream',
              text: 'Dauer, Zuschauer in der Spitze und im Schnitt, wie viel im Chat los war.' },
            { zustand: 'entwurf', icon: 'fa-solid fa-user-plus', titel: 'Neue Follower und Abos',
              text: 'Aus Twitchs Listen — dieselben, die dein Twitch-Dashboard zeigt.' },
            { zustand: 'entwurf', icon: 'fa-solid fa-ranking-star', titel: 'Bits-Rangliste',
              text: 'Kommt fertig von Twitch, mit Rang und Punktzahl. Wir rechnen nichts aus.' },
            { zustand: 'entwurf', icon: 'fa-solid fa-people-arrows', titel: 'Raids',
              text: 'Wer geraidet hat und wie viele Zuschauer mitkamen.' }
        ],

        vorhanden: [
            { was: 'Bits-Rangliste (Rang und Punktzahl)', wo: 'Scope bits:read' },
            { was: 'Follower-Liste', wo: 'Scope moderator:read:followers' },
            { was: 'Abonnentenliste', wo: 'Scope channel:read:subscriptions' },
            { was: 'Raid- und Ereignisempfang', wo: 'eingang/conduit.js' }
        ],

        fehlt: [
            { was: 'Die Abrufe und ihre Ansicht',
              warum: 'Alle drei Zusagen trägt dein Schlüssel schon. <b>Entschieden: per Request</b> — '
                   + 'geholt, wenn die Seite geöffnet wird, nicht als Kopie bei uns.' },
            { was: 'Eine Bilanz je Stream',
              warum: 'Dauer und Spitzenzuschauer stehen nicht in einem einzelnen Ereignis; sie entstehen '
                   + 'erst, wenn man Start und Ende zusammenrechnet.' }
        ],

        sperre: {
            titel: 'Was hier nicht stehen wird',
            text: '„Wer hat am meisten geschrieben“, Stammgäste, Watch Streaks. Dafür gibt es keinen '
                + 'Twitch-Endpunkt — diese Listen entstünden erst dadurch, dass wir jede Chatnachricht '
                + 'einer Person zuordnen und über Wochen mitzählen. Dort steht dieselbe offene Frage wie '
                + 'beim Befehlsbaukasten.'
        }
    }
};

/**
 * Eine Entwurfsseite holen.
 *
 * @param {string} name Schluessel aus SEITEN
 * @returns {Object|null} Seite oder null
 */
function seite(name) {
    return SEITEN[name] || null;
}

/** @returns {Array<string>} alle Seitennamen */
function namen() {
    return Object.keys(SEITEN);
}

module.exports = { seite, namen, SEITEN };
