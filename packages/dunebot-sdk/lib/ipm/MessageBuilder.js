/**
 * MessageBuilder - Helper-Klasse zum Erstellen standardisierter IPM-Messages
 * 
 * @module ipm/MessageBuilder
 * @author FireBot Team
 */

const { v4: uuidv4 } = require('uuid');
const MessageTypes = require('./MessageTypes');

/**
 * MessageBuilder - Fluent API zum Erstellen von IPM-Messages
 * 
 * @example
 * // Command erstellen
 * const cmd = MessageBuilder.command('gameserver', 'start', { server_id: '18' });
 * 
 * // Event erstellen
 * const evt = MessageBuilder.event('gameserver', 'status_changed', { server_id: '18', status: 'online' });
 * 
 * // Response erstellen
 * const resp = MessageBuilder.response('uuid-from-command', true, { task_id: 'abc' });
 */
class MessageBuilder {
  /**
   * Erstellt eine Command-Message (Dashboard → Daemon)
   * 
   * @param {string} namespace - Namespace (z.B. 'gameserver', 'console')
   * @param {string} action - Action (z.B. 'start', 'stop')
   * @param {Object} payload - Payload-Daten
   * @param {Object} [options] - Optionale Felder
   * @param {string} [options.id] - Custom Message-ID (sonst Auto-UUID)
   * @param {Object} [options.auth] - Auth-Informationen
   * @returns {Object} Standardisierte Message
   */
  static command(namespace, action, payload = {}, options = {}) {
    return {
      type: MessageTypes.TYPE_COMMAND,
      id: options.id || uuidv4(),
      timestamp: Date.now(),
      namespace,
      action,
      payload,
      auth: options.auth || null,
    };
  }

  /**
   * Erstellt eine Event-Message (Daemon → Dashboard)
   * 
   * @param {string} namespace - Namespace (z.B. 'gameserver', 'console')
   * @param {string} action - Action (z.B. 'status_changed', 'output')
   * @param {Object} payload - Payload-Daten
   * @param {Object} [options] - Optionale Felder
   * @param {string} [options.id] - Custom Message-ID (sonst Auto-UUID)
   * @returns {Object} Standardisierte Message
   */
  static event(namespace, action, payload = {}, options = {}) {
    return {
      type: MessageTypes.TYPE_EVENT,
      id: options.id || uuidv4(),
      timestamp: Date.now(),
      namespace,
      action,
      payload,
    };
  }

  /**
   * Validiert ob eine Message die Basis-Struktur hat
   * 
   * @param {Object} message - Zu validierende Message
   * @returns {boolean} Valid?
   */
  static isValid(message) {
    if (!message || typeof message !== 'object') return false;
    
    // Pflichtfelder
    if (!message.type || !message.timestamp) return false;
    
    // Type muss valider Enum sein
    const validTypes = [
      MessageTypes.TYPE_COMMAND,
      MessageTypes.TYPE_EVENT,
    ];
    if (!validTypes.includes(message.type)) return false;
    
    // Command/Event brauchen Namespace + Action
    if (message.type === MessageTypes.TYPE_COMMAND || message.type === MessageTypes.TYPE_EVENT) {
      if (!message.namespace || !message.action) return false;
    }
    
    return true;
  }

  /**
   * Erstellt eine Message aus Raw-Data (z.B. von WebSocket)
   * 
   * @param {string|Object} data - JSON-String oder Object
   * @returns {Object|null} Parsed Message oder null bei Fehler
   */
  static fromRaw(data) {
    try {
      const message = typeof data === 'string' ? JSON.parse(data) : data;
      return this.isValid(message) ? message : null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Konvertiert Message zu JSON-String (für WebSocket-Sending)
   * 
   * @param {Object} message - Message-Object
   * @returns {string} JSON-String
   */
  static toJSON(message) {
    return JSON.stringify(message);
  }

  /**
   * Clone eine Message (für Modifikation ohne Original zu ändern)
   * 
   * @param {Object} message - Original-Message
   * @returns {Object} Deep-Clone
   */
  static clone(message) {
    return JSON.parse(JSON.stringify(message));
  }
}

module.exports = MessageBuilder;
