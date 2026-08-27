'use strict';

/**
 * Streaming - gemeinsame Helfer der Router.
 *
 * @module streaming/dashboard/routes/_shared
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
 * Ansicht ueber den ThemeManager zeichnen.
 *
 * @param {Object} res Express-Antwort
 * @param {string} viewPath Pfad der Ansicht
 * @param {Object} data Daten
 * @returns {Promise<*>} Ergebnis des ThemeManagers
 */
async function renderView(res, viewPath, data) {
    return await ServiceManager.get('themeManager').renderView(res, viewPath, data);
}

/**
 * Fehlerseite - mit Grund, nicht nur mit "Fehler".
 *
 * @param {Object} res Express-Antwort
 * @param {Error} error Fehler
 * @param {string} text Klartext fuer den Nutzer
 * @returns {*} Antwort
 */
function renderFehler(res, error, text) {
    ServiceManager.get('Logger').error(`[Streaming] ${text}:`, error);
    return res.status(500).render('error', {
        message: text,
        error: { status: 500, message: error.message }
    });
}

/**
 * Den Bot fragen - und die Antwort richtig auspacken.
 *
 * **Es gibt zwei Huellen**, je nachdem, wo der Handler liegt:
 *
 *   - Handler im Switch von `IPCClient.js` (z. B. `GET_GUILD_CHANNELS`)
 *     antworten flach: `{ success, channels }`
 *   - Handler als Datei unter `apps/bot/ipc/` (z. B.
 *     `GET_GUILD_CHANNELS_DETAILED`) werden vom Fallback-Zweig zusaetzlich
 *     verpackt: `{ success, data: { success, channels } }`
 *
 * Wer das verwechselt, bekommt `undefined` und daraus eine leere Liste - ohne
 * Fehler, ohne Log, ohne Hinweis. Genau daran lag die leere Kanalauswahl am
 * 2026-08-24.
 *
 * `antwort.data ?? antwort` traegt beide Faelle. Das Muster stammt aus
 * `plugins/discord/dashboard/routes/_shared.js` - dort steht es richtig.
 *
 * @param {string} ereignis IPC-Ereignis
 * @param {Object} nutzlast Nutzlast
 * @returns {Promise<Object|null>} ausgepackte Antwort
 */
async function fragBot(ereignis, nutzlast, fristMs = BOT_FRIST_MS) {
    const ipcServer = ServiceManager.get('ipcServer');
    if (!ipcServer) return null;

    try {
        const antworten = await ipcServer.broadcast(ereignis, nutzlast, true, { timeout: fristMs });
        const antwort = Array.isArray(antworten) && antworten.length ? antworten[0] : null;
        if (!antwort) return null;
        return antwort.data ?? antwort;
    } catch (err) {
        ServiceManager.get('Logger').warn(`[Streaming] IPC ${ereignis} fehlgeschlagen: ${err.message}`);
        return null;
    }
}

/**
 * Kanaele, in die eine Ankuendigung gepostet werden kann.
 *
 * **Nicht** `GET_GUILD_CHANNELS`: Der liefert ausdruecklich nur `GuildText`
 * (`GET_GUILD_CHANNELS.js`, Filter auf ChannelType.GuildText) - und damit
 * fehlten die **Ankuendigungskanaele**. Das ist nicht nur unbequem: Der
 * Auto-Crosspost (L-2) funktioniert ausschliesslich in Ankuendigungskanaelen.
 * Solange man keinen waehlen konnte, war die Funktion tot.
 *
 * Der ausfuehrliche Handler kennt beide Arten und liefert `type` als Text
 * ('text', 'announcement', 'voice', …).
 *
 * @param {string} guildId Discord-Guild-ID
 * @returns {Promise<Array>} Text- und Ankuendigungskanaele, Ankuendigung zuerst erkennbar
 */
async function getZielkanaele(guildId) {
    try {
        const antwort = await fragBot('dashboard:GET_GUILD_CHANNELS_DETAILED', { guildId });
        const kanaele = antwort?.channels || [];

        // 'news' ist der aeltere Name fuer Ankuendigungskanaele - je nach
        // Fassung der Bibliothek kann beides auftauchen.
        const erlaubt = new Set(['text', 'announcement', 'news']);
        const ziele = kanaele
            .filter(k => erlaubt.has(k.type))
            .map(k => ({ ...k, istAnkuendigung: k.type !== 'text' }));

        // Wenn hier nichts oder auffallend wenig ankommt, liegt es fast immer
        // an den Typnamen. Dann soll im Log stehen, WAS geliefert wurde -
        // sonst sucht man im Dunkeln.
        if (!ziele.length || !ziele.some(k => !k.istAnkuendigung)) {
            const verteilung = kanaele.reduce((m, k) => { m[k.type] = (m[k.type] || 0) + 1; return m; }, {});
            ServiceManager.get('Logger').warn(
                `[Streaming] Auffaellige Kanalauswahl fuer Guild ${guildId}: ` +
                `${ziele.length} Ziel(e) aus ${kanaele.length} Kanaelen. Typen: ${JSON.stringify(verteilung)}`);
        }

        return ziele;
    } catch (err) {
        ServiceManager.get('Logger').warn(`[Streaming] Zielkanaele nicht ladbar: ${err.message}`);
        return [];
    }
}

/**
 * Sprachkanaele der Guild - fuer den On-Air-Kanal des Streamers.
 *
 * `GET_GUILD_CHANNELS` liefert ausdruecklich **nur Textkanaele**; es ist fuer
 * Auswahlfelder gedacht, in die Nachrichten gehen. Sprach- und Buehnenkanaele
 * kennt nur der ausfuehrliche Handler - dort ist `type` ein Text ('voice',
 * 'stage'), keine Zahl. Das Musik-Plugin loest dasselbe Problem genauso.
 *
 * @param {string} guildId Discord-Guild-ID
 * @returns {Promise<Array>} Sprach- und Buehnenkanaele
 */
async function getSprachkanaele(guildId) {
    try {
        const antwort = await fragBot('dashboard:GET_GUILD_CHANNELS_DETAILED', { guildId });
        const kanaele = antwort?.channels || [];
        return kanaele.filter(k => k.type === 'voice' || k.type === 'stage');
    } catch (err) {
        ServiceManager.get('Logger').warn(`[Streaming] Sprachkanaele nicht ladbar: ${err.message}`);
        return [];
    }
}

/**
 * Rollen der Guild - fuer die Erwaehnung.
 *
 * @param {string} guildId Discord-Guild-ID
 * @returns {Promise<Array>} Rollen
 */
async function getRollen(guildId) {
    try {
        const antwort = await fragBot('dashboard:GET_GUILD_ROLES', { guildId });
        return antwort?.roles || [];
    } catch (err) {
        ServiceManager.get('Logger').warn(`[Streaming] Rollen nicht ladbar: ${err.message}`);
        return [];
    }
}

/**
 * Mitglieder der Guild - fuer die Zuordnung Kanal -> Person (Live-Rolle).
 *
 * `dashboard:GET_ALL_GUILD_MEMBERS` steht im Switch von `IPCClient.js` und
 * wird vom Rechte-Router bereits benutzt - nicht neu gebaut, nachgesehen. Er
 * holt die Liste mit `force: true`, also **auch die abgemeldeten**; ohne das
 * fehlten genau die, die gerade nicht im Discord sind.
 *
 * Boter werden aussortiert: Ein Bot betreibt keinen Twitch-Kanal.
 *
 * @param {string} guildId Discord-Guild-ID
 * @returns {Promise<Array>} Mitglieder, nach Anzeigename sortiert
 */
/**
 * Frist fuer jede Frage an den Bot.
 *
 * **Der Aufrufer ist hier immer eine Seite**, auf die jemand wartet. Die Frist
 * liegt bewusst ueber der des Bots (15 s in `bot/helpers/Mitglieder.js`):
 * Antwortet er dort ehrlich mit "unvollstaendig", soll diese Antwort noch
 * ankommen, statt hier vorher abgeschnitten zu werden.
 *
 * Gemessen am 2026-08-27, vor der Frist: 120 003 ms fuer eine Liste mit 14
 * Eintraegen. Der Benutzer haelt so etwas fuer einen Netzfehler, nicht fuer
 * eine langsame Seite.
 */
const BOT_FRIST_MS = 20_000;

async function getMitglieder(guildId) {
    try {
        const antwort = await fragBot('dashboard:GET_ALL_GUILD_MEMBERS', { guildId });
        const alle = antwort?.members || [];
        return alle
            .filter(m => !m.user?.bot)
            // Die Rollen kommen mit und werden behalten: Damit laesst sich ohne
            // eine zweite Abfrage feststellen, wer eine bestimmte Rolle traegt -
            // und darauf beruht die Warnung vor einer Live-Rolle, die schon
            // etwas anderes bedeutet (Vorfall 2026-08-25).
            .map(m => ({
                id: m.user.id,
                name: m.displayName || m.user.username,
                tag: m.user.tag,
                rollen: (m.roles || []).map(r => String(r.id))
            }));
    } catch (err) {
        ServiceManager.get('Logger').warn(`[Streaming] Mitglieder nicht ladbar: ${err.message}`);
        return [];
    }
}

/**
 * "vor 40 Sekunden" statt eines Zeitstempels.
 *
 * Das ist die Zahl, die den Unterschied macht: Sie beantwortet die Frage, die
 * sonst niemand beantworten kann - ist es still, weil niemand sendet, oder
 * weil wir taub sind?
 *
 * @param {Date|string|null} zeitpunkt Zeitpunkt
 * @returns {string|null} Klartext oder null
 */
function vorWieLange(zeitpunkt) {
    if (!zeitpunkt) return null;
    const dann = new Date(zeitpunkt).getTime();
    if (Number.isNaN(dann)) return null;

    const sek = Math.max(0, Math.round((Date.now() - dann) / 1000));
    if (sek < 60)    return `vor ${sek} s`;
    if (sek < 3600)  return `vor ${Math.round(sek / 60)} min`;
    if (sek < 86400) return `vor ${Math.round(sek / 3600)} h`;
    return `vor ${Math.round(sek / 86400)} Tagen`;
}

module.exports = {
    fragBot,
    makeTranslator,
    renderView,
    renderFehler,
    getZielkanaele,
    getSprachkanaele,
    getRollen,
    getMitglieder,
    vorWieLange
};
