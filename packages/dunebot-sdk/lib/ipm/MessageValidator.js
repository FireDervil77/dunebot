/**
 * MessageValidator - Validierung von IPM-Messages (Sicherheit!)
 * 
 * @module ipm/MessageValidator
 * @author DuneBot Team
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
   * Validiert einen Namespace
   * 
   * @param {string} namespace - Zu prüfender Namespace
   * @returns {boolean} Valid?
   */
  static isValidNamespace(namespace) {
    const validNamespaces = [
      MessageTypes.NS_GAMESERVER,
      MessageTypes.NS_CONSOLE,
      MessageTypes.NS_LOGS,
      MessageTypes.NS_SFTP,
      MessageTypes.NS_SYSTEM,
      MessageTypes.NS_INSTALL,
    ];
    return validNamespaces.includes(namespace);
  }

  /**
   * Validiert eine Action für einen Namespace
   * 
   * @param {string} namespace - Namespace
   * @param {string} action - Action
   * @returns {boolean} Valid?
   */
  static isValidAction(namespace, action) {
    const actionMap = {
      [MessageTypes.NS_GAMESERVER]: [
        MessageTypes.GAMESERVER_START,
        MessageTypes.GAMESERVER_STOP,
        MessageTypes.GAMESERVER_RESTART,
        MessageTypes.GAMESERVER_STATUS_CHANGED,
        MessageTypes.GAMESERVER_RESOURCE_USAGE,
        MessageTypes.GAMESERVER_CRASHED,
      ],
      [MessageTypes.NS_CONSOLE]: [
        MessageTypes.CONSOLE_ATTACH,
        MessageTypes.CONSOLE_DETACH,
        MessageTypes.CONSOLE_OUTPUT,
        MessageTypes.CONSOLE_INPUT,
      ],
      [MessageTypes.NS_LOGS]: [
        MessageTypes.LOGS_FETCH,
        MessageTypes.LOGS_STREAM,
        MessageTypes.LOGS_SEARCH,
      ],
      [MessageTypes.NS_SFTP]: [
        MessageTypes.SFTP_LIST,
        MessageTypes.SFTP_UPLOAD,
        MessageTypes.SFTP_DOWNLOAD,
        MessageTypes.SFTP_DELETE,
        MessageTypes.SFTP_CREATE_DIR,
        MessageTypes.SFTP_CHMOD,
      ],
      [MessageTypes.NS_SYSTEM]: [
        MessageTypes.SYSTEM_STATS,
        MessageTypes.SYSTEM_DAEMON_STATUS,
        MessageTypes.SYSTEM_UPDATE_AVAILABLE,
      ],
      [MessageTypes.NS_INSTALL]: [
        MessageTypes.INSTALL_PROGRESS,
        MessageTypes.INSTALL_LOGS,
        MessageTypes.INSTALL_COMPLETED,
        MessageTypes.INSTALL_FAILED,
      ],
    };

    const validActions = actionMap[namespace];
    return validActions ? validActions.includes(action) : false;
  }

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
   * Quick-Validate (nur Pflichtfelder, für Performance)
   * 
   * @param {Object} message - Zu validierende Message
   * @returns {boolean} Valid?
   */
  static quickValidate(message) {
    if (!message || typeof message !== 'object') return false;
    if (!message.type || !message.timestamp) return false;
    
    const validTypes = [
      MessageTypes.TYPE_COMMAND,
      MessageTypes.TYPE_EVENT,
      MessageTypes.TYPE_RESPONSE
    ];
    
    return validTypes.includes(message.type);
  }
}

module.exports = MessageValidator;
