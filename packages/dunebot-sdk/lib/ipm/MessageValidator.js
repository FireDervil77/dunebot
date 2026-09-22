/**
 * MessageValidator - Validierung von IPM-Messages (Sicherheit!)
 * 
 * @module ipm/MessageValidator
 * @author FireBot Team
 */

const MessageTypes = require('./MessageTypes');

/**
 * ValidationResult - Ergebnis der Validierung
 * @typedef {Object} ValidationResult
 * @property {boolean} valid - Message ist valide?
 * @property {Array<string>} errors - Liste der Validierungs-Fehler
 * @property {Object|null} message - dieselbe Nachricht, unveraendert (null, wenn ungueltig)
 */

/**
 * MessageValidator - prueft eingehende Messages auf Wohlgeformtheit.
 *
 * Er VERAENDERT sie nicht. Bereinigen gehoert an die Anzeige, nicht in den
 * Transport — die Begruendung steht unten beim Grabstein von `_sanitize`.
 */
class MessageValidator {
  /**
   * Validiert eine Message vollständig
   * 
   * @param {Object} message - Zu validierende Message
   * @param {Object} [options] - Validierungs-Optionen
   * @param {boolean} [options.strict=true] - Streng validieren?
   * @param {Array<string>} [options.allowedNamespaces] - Erlaubte Namespaces (wenn gesetzt)
   * @returns {ValidationResult} Validierungs-Ergebnis
   */
  static validate(message, options = {}) {
    const errors = [];
    const strict = options.strict !== false;

    // 1. Basis-Struktur-Check
    if (!message || typeof message !== 'object') {
      return { valid: false, errors: ['Message muss ein Object sein'], message: null };
    }

    // 2. Pflichtfelder
    if (!message.type) errors.push('Feld "type" fehlt');
    if (!message.timestamp) errors.push('Feld "timestamp" fehlt');

    // 3. Type-Validierung
    const validTypes = [
      MessageTypes.TYPE_COMMAND,
      MessageTypes.TYPE_EVENT,
      MessageTypes.TYPE_RESPONSE
    ];
    if (message.type && !validTypes.includes(message.type)) {
      errors.push(`Ungültiger Type: "${message.type}". Erlaubt: ${validTypes.join(', ')}`);
    }

    // 4. Type-spezifische Validierung
    if (message.type === MessageTypes.TYPE_COMMAND || message.type === MessageTypes.TYPE_EVENT) {
      // Command/Event brauchen Namespace + Action
      if (!message.namespace) errors.push('Feld "namespace" fehlt');
      if (!message.action) errors.push('Feld "action" fehlt');

      // Namespace whitelisting (optional)
      if (options.allowedNamespaces && message.namespace) {
        if (!options.allowedNamespaces.includes(message.namespace)) {
          errors.push(`Namespace "${message.namespace}" nicht erlaubt. Erlaubt: ${options.allowedNamespaces.join(', ')}`);
        }
      }

      // Payload sollte Object sein
      if (message.payload !== undefined && typeof message.payload !== 'object') {
        errors.push('Feld "payload" muss ein Object sein');
      }
    }

    if (message.type === MessageTypes.TYPE_RESPONSE) {
      // Response braucht success-Flag und request-ID
      if (!message.id) errors.push('Feld "id" fehlt (Response-ID)');
      if (typeof message.success !== 'boolean') errors.push('Feld "success" muss boolean sein');
    }

    // 5. Timestamp-Validierung
    if (message.timestamp) {
      const timestamp = Number(message.timestamp);
      if (isNaN(timestamp) || timestamp < 0) {
        errors.push('Ungültiger Timestamp');
      }
      
      // Zukunfts-Check (darf nicht > 1min in Zukunft sein)
      if (strict && timestamp > Date.now() + 60000) {
        errors.push('Timestamp liegt zu weit in der Zukunft');
      }
    }

    // 6. Payload-Größen-Check (Anti-DoS)
    if (strict && message.payload) {
      const payloadSize = JSON.stringify(message.payload).length;
      if (payloadSize > 1024 * 1024) { // 1MB Limit
        errors.push('Payload zu groß (max. 1MB)');
      }
    }

    // Ergebnis. Die Nachricht kommt UNVERAENDERT zurueck — siehe den Block
    // „Hier stand `_sanitize`" weiter unten.
    return {
      valid: errors.length === 0,
      errors,
      message: errors.length === 0 ? message : null
    };
  }

  /**
   * ── Hier standen `isValidNamespace` und `isValidAction` ────────────────────
   *
   * Zwei Erlaubnislisten (Namensräume, und je Namensraum die Aktionen). Beide
   * ohne einen einzigen Aufrufer — am 2026-09-21 in `apps`, `plugins` und
   * `packages` gesucht, der einzige Treffer war die Definition selbst.
   *
   * **Entfernt, weil eine tote Erlaubnisliste eine Falle ist, kein Schutz.**
   * Sie war unvollständig, und zwar nachweislich: `GAMESERVER_READINESS` stand
   * nicht darin und kommt seit dem 2026-09-08 an (die Bereitschaftsstufe füllt
   * `bereitschaft_stufe`). Wäre die Prüfung verdrahtet gewesen, hätte sie
   * genau diese Meldung verworfen — still, denn eine abgewiesene Aktion sieht
   * aus wie eine, die nie geschickt wurde.
   *
   * Wer sie wieder einführt, tut zwei Dinge in dieser Reihenfolge: erst die
   * Listen aus den heute WIRKLICH ankommenden Ereignissen füllen (messen, nicht
   * aus `MessageTypes` ableiten — dort steht auch, was niemand schickt), dann
   * verdrahten. Umgekehrt fällt beim ersten Rollout Post aus, die niemand
   * vermisst, bis etwas Wichtiges fehlt.
   *
   * `validate()` darüber prüft weiterhin, DASS `namespace` und `action` da sind.
   * Das ist die Prüfung, die einen Aufrufer hat (`IPMEventRouter`).
   */

  /**
   * ── Hier standen `_sanitize` und `_sanitizeObject` ────────────────────────
   *
   * Sie taten genau eines: In jeder Zeichenkette der Nutzlast
   *
   *     value.replace(/<[^>]*>/g, '')
   *
   * und `validate()` gab den Aufrufern diese bereinigte Fassung. Damit verlor
   * **jede eingehende Daemon-Nachricht alles in spitzen Klammern.** Gemessen am
   * 2026-09-22 mit echten Nachrichten (Baustelle 148):
   *
   *   `[Server thread/INFO]: <Fire> hallo`  →  `[Server thread/INFO]:  hallo`
   *   "`tune2fs -O project,quota <geraet>`" →  "`tune2fs -O project,quota `"
   *
   * **Minecraft schreibt Chat als `<Name> Text`.** In der Konsole fiel damit
   * der Absender jeder Chatzeile weg. Und in `gameservers.disk_quota_note`
   * stand seither ein Befehl, den der Betreiber abschreiben kann und der dann
   * fehlschlaegt, weil ihm das Geraet fehlt. Eine Anleitung, die aussieht wie
   * eine Anleitung.
   *
   * ── Warum das kein Schutz war ────────────────────────────────────────────
   *
   * Es sollte HTML entschaerfen. Nur wird an keiner Stelle HTML daraus:
   *
   *   * **Konsole:** xterm.js, `terminal.write(...)` — Text in Zellen, kein
   *     HTML-Parser.
   *   * **Live-Anzeige:** `el.textContent = …`. Die einzige Stelle mit
   *     `innerHTML` (die Zelle „Last") escapet selbst, Zeichen fuer Zeichen.
   *   * **Vorlagen:** `<%= %>`, und das escapet. `<%-` steht in den
   *     Gameserver-Ansichten nur vor `include`.
   *
   * Und er war nicht einmal in sich schluessig — zwei Beweise, beide gemessen:
   *
   *   1. Eine Zeichenkette **in einem Array** blieb unberuehrt (der Zweig
   *      pruefte `typeof item === 'object'`). Die Konsolen-Vorgeschichte kommt
   *      als `lines: [...]` — dort stand `<Fire>` also noch, waehrend dieselbe
   *      Zeile live gekuerzt ankam. Im selben Fenster, zwei Wahrheiten.
   *   2. Der alte `switch`-Pfad in `IPMServer` arbeitet mit der **originalen**
   *      Nachricht weiter. Nur der Weg ueber den Ereignis-Verteiler war
   *      bereinigt. Zwei Wege, ein Gegenstand.
   *
   * ── Der Grundsatz ────────────────────────────────────────────────────────
   *
   * **Beim Anzeigen escapen, nicht beim Transport verstuemmeln.** Escapen ist
   * umkehrbar und steht dort, wo man sieht, wohin der Text geht. Wegschneiden
   * ist endgueltig, trifft jeden Leser — auch die, die kein HTML rendern — und
   * passiert drei Schichten vor der Anzeige, lautlos.
   *
   * Wer hier wieder bereinigen will, tut es NICHT hier: `validate()` prueft,
   * ob eine Nachricht wohlgeformt ist, und gibt sie unveraendert zurueck. Wer
   * Text in HTML einsetzt, escapet an dieser Stelle.
   *
   * Festgehalten von `scripts/check-nutzlast-unverstuemmelt.js` — samt der
   * Frage, ob die Anzeigestellen noch escapen.
   */

  /**
   * ── Hier stand `quickValidate` ────────────────────────────────────────────
   *
   * "Nur Pflichtfelder, für Performance" — und ohne Aufrufer, wie die beiden
   * Listen darüber. Entfernt aus demselben Grund: Ein zweiter, schnellerer Weg
   * zu derselben Frage driftet vom ersten weg, sobald einer von beiden
   * angefasst wird. `validate()` ist der eine Weg.
   */
}

module.exports = MessageValidator;
