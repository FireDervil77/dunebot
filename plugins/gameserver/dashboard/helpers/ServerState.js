/**
 * ServerState – welche Aktion ist in welchem Zustand erlaubt?
 *
 * Der Anlass: Wer im Discord-Panel auf „Stoppen" drückt, bekam sofort einen
 * einsatzbereiten „Starten"-Knopf. Der Server war zu dem Zeitpunkt aber noch gar
 * nicht unten – `gameservers.status` stand auf `stopping`, während der Container
 * herunterfuhr. Ein Klick darauf lief in einen Fehler des Daemons.
 *
 * Zwei getrennte Lücken steckten dahinter, und beide brauchen eine Antwort:
 *
 *  1. **Das Panel kannte die Übergangszustände nicht.** Es leitete „online" allein
 *     aus dem Status-Schnappschuss ab und übersah `stopping` und `starting`.
 *  2. **Die Prüfung im Dashboard war zu grob.** `SERVER_START` wies nur `online`
 *     ab – aus `stopping` heraus ließ sie einen Start durch.
 *
 * Punkt 2 ist der wichtigere, und deshalb liegt die Wahrheit hier und nicht in
 * der Anzeige: **Ein Discord-Knopf ist ein Abbild der Vergangenheit.** Die
 * Nachricht steht im Kanal, bis jemand sie editiert; sie lässt sich auch eine
 * Stunde später noch anklicken, und niemand hindert jemanden daran, den Knopf im
 * ungünstigsten Moment zu treffen. Ein Panel, das die Knöpfe korrekt ausgraut,
 * ist Bequemlichkeit – die Absicherung ist es nicht.
 *
 * @module helpers/ServerState
 */

'use strict';

/** Zustände, in denen gerade etwas läuft und nichts dazwischenfunken darf. */
const UEBERGANG = new Set(['starting', 'stopping', 'installing', 'updating']);

/** Klartext für Meldungen – der Zustand soll in der Antwort stehen. */
const BESCHRIFTUNG = {
    installing: 'wird gerade installiert',
    installed:  'ist installiert, aber noch nie gestartet worden',
    starting:   'startet gerade',
    online:     'läuft bereits',
    stopping:   'wird gerade gestoppt',
    offline:    'ist offline',
    error:      'steht auf Fehler',
    updating:   'wird gerade aktualisiert',
};

/**
 * Aus welchen Zuständen heraus ist eine Aktion erlaubt?
 *
 * `error` erlaubt Start und Stopp bewusst: Nach einem gescheiterten Versuch muss
 * man wieder herauskommen, ohne in der Datenbank zu schrauben. `starting` erlaubt
 * Stopp, weil ein hängender Start sonst nicht abzubrechen wäre.
 */
const ERLAUBT_AUS = {
    start:   new Set(['offline', 'installed', 'error']),
    stop:    new Set(['online', 'starting', 'error']),
    restart: new Set(['online']),
};

/**
 * Ab wann gilt ein Übergang als hängengeblieben?
 *
 * **Das Ventil ist der wichtigste Teil dieser Datei.** Ein Zustandsautomat ohne
 * Ausweg ist eine Falle: Stürzt der Daemon mitten im Stoppen ab, bleibt
 * `stopping` für immer stehen – und ohne diese Grenze wären Start und Stopp
 * dauerhaft gesperrt, mit der freundlichen Auskunft „bitte einen Moment warten".
 * Der Server wäre nur noch über die Datenbank wieder einzufangen.
 *
 * Fünf Minuten sind reichlich: Der Stopp-Befehl an den Daemon läuft mit 30 s
 * Zeitgrenze, und selbst ein Spiel, das sich beim Speichern Zeit lässt, ist
 * lange vorher durch.
 */
const UEBERGANG_VERFAELLT_MS = 5 * 60 * 1000;

/**
 * Darf die Aktion im gegebenen Zustand ausgeführt werden?
 *
 * @param {'start'|'stop'|'restart'} aktion
 * @param {string} status - aktueller Wert aus gameservers.status
 * @param {Date|string|number|null} [seit] - Zeitpunkt des letzten Zustandswechsels
 *        (`gameservers.last_status_update`). Fehlt er, gilt ein Übergang als
 *        hängengeblieben – lieber eine Aktion zu viel erlauben als einen Server
 *        unbedienbar machen.
 * @returns {{erlaubt: boolean, grund: string|null, verfallen?: boolean}}
 */
function pruefeAktion(aktion, status, seit = null) {
    const zustand = String(status || '').toLowerCase();
    const erlaubteQuellen = ERLAUBT_AUS[aktion];

    if (!erlaubteQuellen) {
        return { erlaubt: false, grund: `Unbekannte Aktion "${aktion}"` };
    }
    if (erlaubteQuellen.has(zustand)) {
        return { erlaubt: true, grund: null };
    }

    const was = BESCHRIFTUNG[zustand] || `steht auf "${zustand}"`;

    if (UEBERGANG.has(zustand)) {
        if (uebergangVerfallen(seit)) {
            return { erlaubt: true, grund: null, verfallen: true };
        }
        // Bei einem laufenden Übergang ist Warten die richtige Auskunft,
        // nicht "geht nicht".
        return { erlaubt: false, grund: `Der Server ${was} – bitte einen Moment warten.` };
    }
    return { erlaubt: false, grund: `Der Server ${was}.` };
}

/**
 * Steht der Übergang länger, als er dürfte?
 *
 * @param {Date|string|number|null} seit
 * @returns {boolean}
 */
function uebergangVerfallen(seit) {
    if (!seit) return true;                     // kein Zeitstempel → nicht aussperren
    const ms = new Date(seit).getTime();
    if (!Number.isFinite(ms)) return true;      // unlesbar → ebenso
    return (Date.now() - ms) > UEBERGANG_VERFAELLT_MS;
}

/**
 * Ist der Server in einem Übergang, in dem keine Schalter angeboten werden sollen?
 *
 * @param {string} status
 * @returns {boolean}
 */
function istUebergang(status) {
    return UEBERGANG.has(String(status || '').toLowerCase());
}

/**
 * Kurzer Text für die Panel-Überschrift während eines Übergangs.
 *
 * @param {string} status
 * @returns {string|null} null, wenn es kein Übergang ist
 */
function uebergangsText(status) {
    switch (String(status || '').toLowerCase()) {
        case 'starting':   return '🟡 Startet …';
        case 'stopping':   return '🟡 Wird gestoppt …';
        case 'installing': return '🟡 Wird installiert …';
        case 'updating':   return '🟡 Wird aktualisiert …';
        default:           return null;
    }
}

module.exports = {
    pruefeAktion,
    uebergangVerfallen,
    istUebergang,
    uebergangsText,
    UEBERGANG,
    ERLAUBT_AUS,
    UEBERGANG_VERFAELLT_MS,
};
