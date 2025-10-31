/**
 * IPMEventRouter - Zentraler Event-Router für IPM-Messages
 * 
 * Verantwortlich für:
 * - Handler-Registry (Namespace + Action → Handler-Funktion)
 * - Message-Routing mit Validation
 * - Event-Emission für SSE-Subscribers
 * - Error-Handling und Logging
 * 
 * @module helpers/IPMEventRouter
 * @author DuneBot Team
 */

const { MessageValidator, MessageTypes } = require('dunebot-sdk');
const {ServiceManager} = require('dunebot-core');
const EventEmitter = require('events');

/**
 * IPMEventRouter - Zentrale Event-Routing-Klasse
 * @extends EventEmitter
 */
class IPMEventRouter extends EventEmitter {
  constructor() {
    super();
    
    /**
     * Handler-Registry: Map<namespace:action, Array<HandlerFunction>>
     * @type {Map<string, Array<Function>>}
     */
    this.handlers = new Map();
    
    /**
     * Middleware-Stack (z.B. für Auth, Rate-Limiting)
     * @type {Array<Function>}
     */
    this.middlewares = [];
    
    /**
     * Statistiken
     * @type {Object}
     */
    this.stats = {
      messagesRouted: 0,
      messagesRejected: 0,
      handlerErrors: 0,
      lastError: null
    };
    
    this.Logger = ServiceManager.get('Logger');
  }

  /**
   * Registriert einen Handler für einen Namespace + Action
   * 
   * @param {string} namespace - Namespace (z.B. 'gameserver')
   * @param {string} action - Action (z.B. 'status_changed')
   * @param {Function} handler - Handler-Funktion (async (payload, message) => {...})
   * @param {Object} [options] - Optionen
   * @param {number} [options.priority=10] - Priorität (niedrigere Zahl = höher)
   * @returns {Function} Unregister-Funktion
   */
  register(namespace, action, handler, options = {}) {
    const key = this._makeKey(namespace, action);
    const priority = options.priority || 10;
    
    if (!this.handlers.has(key)) {
      this.handlers.set(key, []);
    }
    
    const handlerEntry = { handler, priority };
    this.handlers.get(key).push(handlerEntry);
    
    // Nach Priorität sortieren (niedrigere Zahl zuerst)
    this.handlers.get(key).sort((a, b) => a.priority - b.priority);
    
    this.Logger.debug(`[IPMEventRouter] Handler registriert: ${key} (Priorität: ${priority})`);
    
    // Unregister-Funktion zurückgeben
    return () => this.unregister(namespace, action, handler);
  }

  /**
   * Entfernt einen Handler
   * 
   * @param {string} namespace - Namespace
   * @param {string} action - Action
   * @param {Function} handler - Handler-Funktion
   */
  unregister(namespace, action, handler) {
    const key = this._makeKey(namespace, action);
    
    if (!this.handlers.has(key)) return;
    
    const handlers = this.handlers.get(key);
    const index = handlers.findIndex(h => h.handler === handler);
    
    if (index !== -1) {
      handlers.splice(index, 1);
      this.Logger.debug(`[IPMEventRouter] Handler entfernt: ${key}`);
    }
    
    // Wenn keine Handler mehr, Key löschen
    if (handlers.length === 0) {
      this.handlers.delete(key);
    }
  }

  /**
   * Registriert eine Middleware (wird vor jedem Handler ausgeführt)
   * 
   * @param {Function} middleware - Middleware-Funktion (async (message, next) => {...})
   */
  use(middleware) {
    this.middlewares.push(middleware);
    this.Logger.debug(`[IPMEventRouter] Middleware registriert (Total: ${this.middlewares.length})`);
  }

  /**
   * Routet eine Message an die registrierten Handler
   * 
   * @param {Object} message - IPM-Message (Command/Event/Response)
   * @param {Object} [context] - Zusätzlicher Kontext (z.B. daemonId)
   * @returns {Promise<void>}
   */
  async route(message, context = {}) {
    try {
      // 1. Validierung
      const validation = MessageValidator.validate(message);
      if (!validation.valid) {
        this.stats.messagesRejected++;
        this.Logger.error('[IPMEventRouter] Ungültige Message:', validation.errors);
        return;
      }

      const validatedMessage = validation.message;

      // 2. Nur Commands und Events routen (Responses werden direkt behandelt)
      if (validatedMessage.type === MessageTypes.TYPE_RESPONSE) {
        this.Logger.debug('[IPMEventRouter] Response-Message → überspringe Routing');
        return;
      }

      // 3. Middleware-Stack durchlaufen
      for (const middleware of this.middlewares) {
        try {
          await middleware(validatedMessage, context);
        } catch (error) {
          this.Logger.error('[IPMEventRouter] Middleware-Fehler:', error);
          // Middleware-Fehler blockieren nicht das Routing
        }
      }

      // 4. Handler finden
      const key = this._makeKey(validatedMessage.namespace, validatedMessage.action);
      const handlers = this.handlers.get(key);

      if (!handlers || handlers.length === 0) {
        this.Logger.warn(`[IPMEventRouter] Kein Handler für: ${key}`);
        this.stats.messagesRouted++;
        return;
      }

      // 5. Handler ausführen (parallel)
      this.Logger.debug(`[IPMEventRouter] Route Message: ${key} (${handlers.length} Handler)`);
      
      const handlerPromises = handlers.map(({ handler }) => 
        this._executeHandler(handler, validatedMessage, context)
      );
      
      await Promise.allSettled(handlerPromises);
      
      this.stats.messagesRouted++;

      // 6. Event emittieren für externe Subscriber (z.B. SSE)
      this.emit('message', {
        namespace: validatedMessage.namespace,
        action: validatedMessage.action,
        payload: validatedMessage.payload,
        timestamp: validatedMessage.timestamp,
        context
      });

    } catch (error) {
      this.stats.messagesRejected++;
      this.stats.lastError = error.message;
      this.Logger.error('[IPMEventRouter] Routing-Fehler:', error);
    }
  }

  /**
   * Führt einen Handler aus (mit Error-Handling)
   * 
   * @private
   * @param {Function} handler - Handler-Funktion
   * @param {Object} message - Validierte Message
   * @param {Object} context - Kontext
   * @returns {Promise<void>}
   */
  async _executeHandler(handler, message, context) {
    try {
      await handler(message.payload, message, context);
    } catch (error) {
      this.stats.handlerErrors++;
      this.stats.lastError = error.message;
      this.Logger.error(
        `[IPMEventRouter] Handler-Fehler (${message.namespace}:${message.action}):`,
        error
      );
    }
  }

  /**
   * Erstellt einen Handler-Key aus Namespace + Action
   * 
   * @private
   * @param {string} namespace - Namespace
   * @param {string} action - Action
   * @returns {string} Key (z.B. "gameserver:status_changed")
   */
  _makeKey(namespace, action) {
    return `${namespace}:${action}`;
  }

  /**
   * Gibt die Anzahl registrierter Handler zurück
   * 
   * @returns {number} Anzahl Handler
   */
  getHandlerCount() {
    let count = 0;
    for (const handlers of this.handlers.values()) {
      count += handlers.length;
    }
    return count;
  }

  /**
   * Gibt Statistiken zurück
   * 
   * @returns {Object} Statistiken
   */
  getStats() {
    return {
      ...this.stats,
      registeredHandlers: this.getHandlerCount(),
      registeredKeys: this.handlers.size,
      middlewares: this.middlewares.length
    };
  }

  /**
   * Gibt registrierte Handler-Keys zurück (für Debugging)
   * 
   * @returns {Array<string>} Handler-Keys
   */
  getRegisteredKeys() {
    return Array.from(this.handlers.keys());
  }

  /**
   * Setzt Statistiken zurück
   */
  resetStats() {
    this.stats = {
      messagesRouted: 0,
      messagesRejected: 0,
      handlerErrors: 0,
      lastError: null
    };
  }
}

// Singleton-Instanz
let instance = null;

/**
 * Gibt die Singleton-Instanz zurück
 * 
 * @returns {IPMEventRouter} Router-Instanz
 */
function getInstance() {
  if (!instance) {
    instance = new IPMEventRouter();
  }
  return instance;
}

module.exports = getInstance();
module.exports.IPMEventRouter = IPMEventRouter; // Für Tests
