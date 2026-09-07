/**
 * Musik - gemeinsame Helfer der Router
 *
 * Alles, was mit dem laufenden Ton zu tun hat, lebt im Bot-Vorgang. Das
 * Dashboard kommt nur ueber IPC daran - deshalb steht die Bruecke hier
 * einmal und nicht in jeder Route.
 *
 * @module music/dashboard/routes/_shared
 */

const { ServiceManager } = require('dunebot-core');

/**
 * Uebersetzungsfunktion fuer eine Anfrage.
 *
 * @param {Object} req Express-Anfrage
 * @param {Object} res Express-Antwort
 * @returns {Function} tr(key, options)
 */
function makeTranslator(req, res) {
    return (key, options = {}) => {
        try {
            if (typeof req.translate === 'function') return req.translate(key, options);
            const i18n = ServiceManager.get('i18n');
            if (i18n && i18n.i18next) {
                return i18n.i18next.t(key, { ...options, lng: res.locals?.locale || 'de-DE' });
            }
            return key;
        } catch {
            return key;
        }
    };
}

/**
 * View ueber den ThemeManager rendern - und dabei das Seitenskript anmelden.
 *
 * **Das Anmelden steht hier und nicht in den Routern.** Es stand vorher in
 * `guild.router.js` als lokale Funktion, fuenfmal von Hand aufgerufen - und
 * `dateien.router.js` rief sie nie auf, weil es sie gar nicht kannte. Folge:
 * Auf der Dateien-Seite wurde `music-steuerung.js` nie geladen, der
 * Hochladen-Knopf hatte keinen Zuhoerer und tat beim Klicken **nichts** -
 * ohne Fehler, ohne Meldung, ohne Eintrag im Log. Genau die Bauform aus
 * `vorhanden-heisst-nicht-funktioniert`.
 *
 * Jede music-Seite braucht dasselbe eine Skript, und es ist tolerant gegen
 * fehlende Elemente (jeder Zugriff ist auf Vorhandensein geprueft). Also
 * gehoert es an die Stelle, die keine Seite umgehen kann.
 *
 * **Es gibt jetzt genau einen Anmeldeweg, nicht zwei.** Die fuenf Aufrufe in
 * `guild.router.js` sind entfernt - sich darauf zu verlassen, dass
 * `enqueueScript` eine Doppelanmeldung wegwirft, hiesse den zweiten Weg zu
 * dulden statt ihn abzuschaffen. Zwei Wege bedeuten frueher oder spaeter, dass
 * einer von beiden etwas anderes tut.
 *
 * **Der Rueckgabewert wird ausgewertet.** `enqueueScript` meldet ein nicht
 * registriertes Skript nur mit `warn` und `false` - der Aufrufer merkt nichts,
 * die Seite rendert ohne Bedienung, und niemand sieht warum. Das ist derselbe
 * stille Ausfall, der hier gerade behoben wurde; er darf nicht durch die
 * Hintertuer zurueckkommen.
 */
async function renderView(res, viewPath, data) {
    const assetManager = ServiceManager.get('assetManager');
    const Logger = ServiceManager.get('Logger');

    if (!assetManager) {
        Logger?.error('[Musik] Kein assetManager - die Seite rendert ohne Bedienung.');
    } else if (!assetManager.enqueueScript('music-steuerung')) {
        Logger?.error('[Musik] Seitenskript "music-steuerung" ist nicht registriert - '
                    + 'die Seite rendert, aber kein Knopf reagiert.');
    }

    return await ServiceManager.get('themeManager').renderView(res, viewPath, data);
}

/** Channels der Guild ueber IPC beim Bot erfragen. */
async function getGuildChannels(guildId) {
    const ipcServer = ServiceManager.get('ipcServer');
    if (!ipcServer) return [];
    try {
        const antworten = await ipcServer.broadcast('dashboard:GET_GUILD_CHANNELS', { guildId });
        return antworten?.[0]?.channels || [];
    } catch (err) {
        ServiceManager.get('Logger').warn(`[Musik] Channels nicht ladbar: ${err.message}`);
        return [];
    }
}

/**
 * Sprachkanaele der Guild.
 *
 * `dashboard:GET_GUILD_CHANNELS` liefert ausdruecklich **nur Textkanaele** -
 * es ist fuer Dropdowns gedacht, in die Nachrichten gehen. Fuer Musik brauchen
 * wir Sprach- und Buehnenkanaele, die nur der ausfuehrliche Handler kennt.
 * Dort ist `type` ein Text ('voice', 'stage'), keine Zahl.
 *
 * @param {string} guildId Discord-Guild-ID
 * @returns {Promise<Array>} Sprachkanaele oder []
 */
async function getSprachkanaele(guildId) {
    const ipcServer = ServiceManager.get('ipcServer');
    if (!ipcServer) return [];

    try {
        const antworten = await ipcServer.broadcast('dashboard:GET_GUILD_CHANNELS_DETAILED', { guildId });
        const kanaele = antworten?.[0]?.channels || [];
        return kanaele.filter(k => k.type === 'voice' || k.type === 'stage');
    } catch (err) {
        ServiceManager.get('Logger').warn(`[Musik] Sprachkanaele nicht ladbar: ${err.message}`);
        return [];
    }
}

/** Rollen der Guild ueber IPC beim Bot erfragen. */
async function getGuildRoles(guildId) {
    const ipcServer = ServiceManager.get('ipcServer');
    if (!ipcServer) return [];
    try {
        const antworten = await ipcServer.broadcast('dashboard:GET_GUILD_ROLES', { guildId, includeAll: true });
        return antworten?.[0]?.roles || [];
    } catch (err) {
        ServiceManager.get('Logger').warn(`[Musik] Rollen nicht ladbar: ${err.message}`);
        return [];
    }
}

/**
 * Die Antwort des Bots auf ein Plugin-Ereignis auspacken.
 *
 * **Zwei Umschlaege, nicht einer.** `IPCClient` legt das Ergebnis jedes
 * Plugin-Handlers in eine eigene Huelle:
 *
 * ```
 * { success: true, data: { success: true, zustand: {...} } }
 *  ^ hat der Bot geantwortet?      ^ hat der Handler seine Arbeit getan?
 * ```
 *
 * Wer nur die aeussere liest, bekommt **immer** `success: true`, sobald der Bot
 * ueberhaupt erreichbar ist - auch wenn drinnen ein Fehler steht - und findet
 * die Nutzdaten nie, weil sie eine Ebene tiefer liegen. Genau das war hier der
 * Fall: `antwort.zustand` war `undefined`, das Dashboard zeigte darum einen
 * Zustand ganz ohne Felder ("Nicht verbunden", nichts in der Liste), und die
 * Suche reichte `undefined` an `addTracks` weiter, das still nichts tat.
 *
 * Die Ereignisse im Namensraum `dashboard:` gehen einen anderen Weg im
 * `IPCClient` und antworten **ohne** diese zweite Huelle - fuer die gilt das
 * hier ausdruecklich nicht.
 *
 * @param {Array} antworten Rueckgabe von `ipcServer.broadcast`
 * @returns {Object} Was der Handler zurueckgab, oder ein Fehlerobjekt
 */
function auspacken(antworten) {
    const umschlag = antworten?.[0];
    if (!umschlag) return { success: false, error: 'Der Bot hat nicht geantwortet' };
    if (!umschlag.success) return { success: false, error: umschlag.error || 'Der Bot meldet einen Fehler' };
    return umschlag.data ?? { success: false, error: 'Der Bot hat nichts zurueckgegeben' };
}

/**
 * Was gerade laeuft.
 *
 * Antwortet der Bot nicht, liefern wir einen leeren Zustand statt eines
 * Fehlers - die Seite soll auch dann aufgehen, wenn der Bot gerade neu
 * startet.
 *
 * @param {string} guildId Discord-Guild-ID
 * @returns {Promise<Object>} Zustand
 */
async function zustandHolen(guildId) {
    const ipcServer = ServiceManager.get('ipcServer');

    const leer = {
        guildId, verbunden: false, sprachKanalId: null, aktuell: null,
        pausiert: false, lautstaerke: 50, wiederholung: 'aus', filter: 'aus',
        qualitaet: 2, dauerbetrieb: false, autoplay: false, stimmen: 0,
        warteschlange: [], warteschlangeLaenge: 0, titelGesamt: 0, restspielzeitSek: 0,
        botErreichbar: false
    };

    if (!ipcServer) return leer;

    try {
        const ergebnis = auspacken(await ipcServer.broadcast('music:getState', { guildId }));
        if (!ergebnis.success || !ergebnis.zustand) return leer;
        return { ...ergebnis.zustand, botErreichbar: true };
    } catch (err) {
        ServiceManager.get('Logger').warn(`[Musik] Zustand nicht abrufbar: ${err.message}`);
        return leer;
    }
}

/**
 * Einen Steuerbefehl an den Bot geben.
 *
 * @param {Object} res Express-Antwort
 * @param {string} guildId Discord-Guild-ID
 * @param {string} vorgang Was getan werden soll
 * @param {*} [wert] Beiwert
 */
async function steuern(res, guildId, vorgang, wert = null) {
    const ipcServer = ServiceManager.get('ipcServer');

    if (!ipcServer) {
        return res.status(503).json({ success: false, error: 'Der Bot ist nicht erreichbar' });
    }

    try {
        const ergebnis = auspacken(await ipcServer.broadcast('music:control', { guildId, vorgang, wert }));

        if (!ergebnis.success) {
            return res.status(400).json({ success: false, error: ergebnis.error || 'Die Aktion ist fehlgeschlagen' });
        }
        return res.json({ success: true, ...ergebnis });
    } catch (error) {
        ServiceManager.get('Logger').error(`[Musik] Steuerbefehl ${vorgang} fehlgeschlagen:`, error);
        return res.status(500).json({ success: false, error: 'Die Aktion ist fehlgeschlagen' });
    }
}

/** Wer die Anfrage stellt. */
function angemeldeterNutzer(req, res) {
    return req.session?.user?.info?.id || res.locals?.user?.id || null;
}

/** Fehlerseite statt eines nackten 500ers. */
function renderFehler(res, error, kontext) {
    const themeManager = ServiceManager.get('themeManager');
    ServiceManager.get('Logger').error(`[Musik] ${kontext}:`, error);

    res.locals.layout = themeManager?.getLayout('guild');
    return res.status(500).render('error', {
        status: 500,
        message: 'Musik',
        error: { status: 500, title: 'Seite konnte nicht geladen werden', message: kontext, details: error.message }
    });
}

/** Fehler einer JSON-Route einheitlich melden. */
function fehler(res, error, text, status = 500) {
    ServiceManager.get('Logger').error(`[Musik] ${text}:`, error);
    res.status(status).json({ success: false, error: text });
}

/**
 * Sekunden als "1 Std. 4 Min." - fuer Spielzeiten in den Views.
 *
 * @param {number} sek Sekunden
 * @returns {string} Text
 */
function spielzeitText(sek) {
    if (!sek || sek <= 0) return '—';
    const stunden = Math.floor(sek / 3600);
    const minuten = Math.round((sek % 3600) / 60);
    return stunden > 0 ? `${stunden} Std. ${minuten} Min.` : `${minuten} Min.`;
}

module.exports = {
    makeTranslator, renderView, getGuildChannels, getSprachkanaele, getGuildRoles,
    auspacken, zustandHolen, steuern, angemeldeterNutzer, renderFehler, fehler, spielzeitText
};
