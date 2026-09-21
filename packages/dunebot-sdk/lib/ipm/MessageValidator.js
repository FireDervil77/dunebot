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
 * @property {Object|null} message - Validierte/bereinigte Message
 */

/**
 * MessageValidator - Validiert und bereinigt eingehende Messages
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

    // Ergebnis
    return {
      valid: errors.length === 0,
      errors,
      message: errors.length === 0 ? this._sanitize(message) : null
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
   * Sanitize eine Message (XSS-Prevention, etc.)
   * 
   * @private
   * @param {Object} message - Original-Message
   * @returns {Object} Bereinigte Message
   */
  static _sanitize(message) {
    // Deep-Clone um Original nicht zu ändern
    const sanitized = JSON.parse(JSON.stringify(message));

    // String-Felder bereinigen (XSS-Prevention)
    if (sanitized.payload && typeof sanitized.payload === 'object') {
      sanitized.payload = this._sanitizeObject(sanitized.payload);
    }

    return sanitized;
  }

  /**
   * Sanitize ein Object rekursiv
   * 
   * @private
   * @param {Object} obj - Zu bereinigendes Object
   * @returns {Object} Bereinigtes Object
   */
  static _sanitizeObject(obj) {
    const sanitized = {};

    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        // Basis-Sanitization (HTML-Tags entfernen)
        sanitized[key] = value.replace(/<[^>]*>/g, '');
      } else if (Array.isArray(value)) {
        sanitized[key] = value.map(item => 
          typeof item === 'object' ? this._sanitizeObject(item) : item
        );
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = this._sanitizeObject(value);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

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
