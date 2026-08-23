'use strict';

/**
 * Registrierungsstelle fuer eingehende Webhooks.
 *
 * Bis 2026-08-23 gab es dafuer genau einen Weg: eine feste Zeile in
 * `apps/dashboard/app.js`, die den Stripe-Endpunkt vor `express.json()`
 * einhaengt. Fuer ein **Plugin** ist dieser Weg nicht gangbar - Plugin-Router
 * entstehen erst beim Laden der Plugins, lange nach den Middlewares.
 *
 * Diese Stelle dreht das um: Der Kern haengt **einen** Mount ein
 * (`/api/:name/webhook`), und wer einen Endpunkt braucht - Plugin oder Kern -
 * traegt sich hier ein. Der Mount liefert dabei immer den **unveraenderten**
 * Anfragekoerper mit (`req.rawBody`), weil jede ernstzunehmende
 * Signaturpruefung genau darauf rechnet.
 *
 * **Diese Stelle authentifiziert nichts.** Sie macht einen Pfad erreichbar;
 * die Pruefung der Signatur ist Sache des eingetragenen Handlers. Wer das
 * verwechselt, baut ein offenes Tor.
 *
 * Bewusst **kein** Feld `webhookRouter` auf `DashboardPlugin`: Genau so ist
 * `adminRouter` entstanden - ein Feld, das geprueft und nirgends gemountet
 * wird. Eintragen ist hier eine Handlung, kein Versprechen.
 *
 * @module dunebot-sdk/WebhookRegistry
 */

/** @type {Map<string, Function>} */
const eintraege = new Map();

/** Name: klein, Ziffern, Bindestrich - nichts, was einen Pfad verlassen kann. */
const NAME_MUSTER = /^[a-z0-9-]{2,32}$/;

/**
 * Einen Webhook-Handler eintragen.
 *
 * @param {string} name Name im Pfad, z. B. 'streaming' fuer /api/streaming/webhook
 * @param {Function} handler Express-Handler oder -Router
 * @returns {boolean} true, wenn eingetragen
 */
function register(name, handler) {
    if (!NAME_MUSTER.test(String(name || ''))) {
        throw new Error(`WebhookRegistry: unzulaessiger Name "${name}" (erlaubt: ${NAME_MUSTER})`);
    }
    if (typeof handler !== 'function') {
        throw new Error(`WebhookRegistry: Handler fuer "${name}" ist keine Funktion`);
    }
    eintraege.set(name, handler);
    return true;
}

/**
 * Eintrag entfernen - beim Abschalten eines Plugins.
 *
 * @param {string} name Name
 * @returns {boolean} true, wenn etwas entfernt wurde
 */
function unregister(name) {
    return eintraege.delete(name);
}

/**
 * @param {string} name Name
 * @returns {Function|null} Handler oder null
 */
function get(name) {
    return eintraege.get(name) || null;
}

/**
 * @returns {Array<string>} eingetragene Namen - fuer den Betriebszustand
 */
function list() {
    return [...eintraege.keys()];
}

module.exports = { register, unregister, get, list, NAME_MUSTER };
