/**
 * BaseService - Basis-Klasse für alle Services, Manager und Plugins
 * 
 * Bietet automatischen, sicheren Zugriff auf häufig verwendete Services:
 * - Logger (lazy-loaded, cached)
 * - dbService (lazy-loaded, cached)
 * - ServiceManager (für andere Services)
 * 
 * Features:
 * - Lazy-Loading via Getters (Performance-Optimierung)
 * - Circular-Dependency-Protection
 * - Automatic Initialization-Tracking
 * - Memory-Leak-Prevention via Cleanup
 * - Type-Safety via Validation
 * 
 * @example
 * class MyManager extends BaseService {
 *     async myMethod() {
 *         this.logger.info('Hello!');           // Auto-injected
 *         await this.db.query('SELECT ...');    // Auto-injected
 *     }
 * }
 * 
 * @author DuneBot Team
 * @version 1.0.0
 */

const { ServiceManager } = require('./ServiceManager');

class BaseService {
    /**
     * Constructor
     * Initialisiert private Properties für Lazy-Loading
     */
    constructor() {
        // Private Properties (werden lazy-geladen)
        Object.defineProperty(this, '_logger', {
            value: null,
            writable: true,
            enumerable: false,  // Nicht in JSON.stringify()
            configurable: false // Nicht löschbar
        });

        Object.defineProperty(this, '_dbService', {
            value: null,
            writable: true,
            enumerable: false,
            configurable: false
        });

        Object.defineProperty(this, '_initialized', {
            value: false,
            writable: true,
            enumerable: false,
            configurable: false
        });

        // Service-Cache für this.service() Calls
        Object.defineProperty(this, '_serviceCache', {
            value: new Map(),
            writable: false,
            enumerable: false,
            configurable: false
        });

        // Flag für Cleanup (verhindert Memory-Leaks)
        Object.defineProperty(this, '_destroyed', {
            value: false,
            writable: true,
            enumerable: false,
            configurable: false
        });

        // Circular-Dependency-Detection
        Object.defineProperty(this, '_dependencyChain', {
            value: new Set(),
            writable: false,
            enumerable: false,
            configurable: false
        });
    }

    /**
     * Logger-Getter (Lazy-Loading mit Caching)
     * 
     * @returns {object} Logger-Instanz
     * @throws {Error} Wenn Service destroyed wurde
     */
    get logger() {
        this._ensureNotDestroyed();

        if (!this._logger) {
            try {
                this._logger = ServiceManager.get('Logger');
                
                // Validation: Logger muss mindestens die Standard-Methoden haben
                if (!this._logger || 
                    typeof this._logger.info !== 'function' ||
                    typeof this._logger.error !== 'function') {
                    throw new Error('Invalid Logger service: Missing required methods');
                }
            } catch (error) {
                // Fallback: Console-Logger bei Fehler
                console.error('[BaseService] Failed to load Logger:', error.message);
                this._logger = this._createFallbackLogger();
            }
        }

        return this._logger;
    }

    /**
     * dbService-Getter (Lazy-Loading mit Caching)
     * 
     * @returns {object} dbService-Instanz
     * @throws {Error} Wenn Service destroyed wurde
     */
    get db() {
        this._ensureNotDestroyed();

        if (!this._dbService) {
            try {
                this._dbService = ServiceManager.get('dbService');
                
                // Validation: dbService muss query-Methode haben
                if (!this._dbService || typeof this._dbService.query !== 'function') {
                    throw new Error('Invalid dbService: Missing query method');
                }
            } catch (error) {
                this.logger.error('[BaseService] Failed to load dbService:', error);
                throw new Error(`${this.constructor.name}: Cannot load dbService - ${error.message}`);
            }
        }

        return this._dbService;
    }

    /**
     * Shortcut für ServiceManager.get() mit Caching und Circular-Dependency-Detection
     * 
     * @param {string} serviceName - Name des Services
     * @returns {object} Service-Instanz
     * @throws {Error} Bei Circular-Dependency oder ungültigem Service
     * 
     * @example
     * const permMgr = this.service('permissionManager');
     */
    service(serviceName) {
        this._ensureNotDestroyed();

        // Validation: serviceName muss String sein
        if (typeof serviceName !== 'string' || serviceName.trim() === '') {
            throw new TypeError(`${this.constructor.name}: serviceName must be a non-empty string`);
        }

        // Circular-Dependency-Detection
        if (this._dependencyChain.has(serviceName)) {
            throw new Error(
                `${this.constructor.name}: Circular dependency detected! ` +
                `Chain: ${Array.from(this._dependencyChain).join(' -> ')} -> ${serviceName}`
            );
        }

        // Cache-Check (Performance-Optimierung)
        if (this._serviceCache.has(serviceName)) {
            return this._serviceCache.get(serviceName);
        }

        try {
            // Dependency-Chain erweitern
            this._dependencyChain.add(serviceName);

            const service = ServiceManager.get(serviceName);

            if (!service) {
                throw new Error(`Service "${serviceName}" not found in ServiceManager`);
            }

            // In Cache speichern
            this._serviceCache.set(serviceName, service);

            // Dependency-Chain aufräumen
            this._dependencyChain.delete(serviceName);

            return service;

        } catch (error) {
            // Dependency-Chain aufräumen bei Fehler
            this._dependencyChain.delete(serviceName);
            
            this.logger.error(`[${this.constructor.name}] Failed to load service "${serviceName}":`, error);
            throw error;
        }
    }

    /**
     * Standard-Initialisierung
     * Kann von Subklassen überschrieben werden (aber super.initialize() aufrufen!)
     * 
     * @returns {Promise<void>}
     * @throws {Error} Bei Initialisierungsfehlern
     */
    async initialize() {
        if (this._initialized) {
            this.logger.debug(`[${this.constructor.name}] Already initialized, skipping`);
            return;
        }

        this._ensureNotDestroyed();

        try {
            // Services "wecken" (triggert Getter, validiert Services)
            const _ = this.logger;
            const __ = this.db;

            this._initialized = true;

            // Hook für Subklassen (Custom-Initialisierung)
            await this._onInitialize();

            this.logger.info(`[${this.constructor.name}] Initialized successfully`);

        } catch (error) {
            this._initialized = false;
            this.logger.error(`[${this.constructor.name}] Initialization failed:`, error);
            throw new Error(`${this.constructor.name}: Initialization failed - ${error.message}`);
        }
    }

    /**
     * Hook für Subklassen - wird von initialize() aufgerufen
     * Überschreibe diese Methode für Custom-Initialisierung
     * 
     * @protected
     * @abstract
     * @returns {Promise<void>}
     * 
     * @example
     * async _onInitialize() {
     *     await this._loadConfigFromDB();
     * }
     */
    async _onInitialize() {
        // Leer - Subklassen können überschreiben
    }

    /**
     * Prüft ob Service initialisiert wurde
     * 
     * @protected
     * @throws {Error} Wenn nicht initialisiert
     */
    _ensureInitialized() {
        if (!this._initialized) {
            throw new Error(
                `${this.constructor.name} not initialized. Call initialize() first.`
            );
        }

        this._ensureNotDestroyed();
    }

    /**
     * Prüft ob Service bereits destroyed wurde (Memory-Leak-Prevention)
     * 
     * @private
     * @throws {Error} Wenn destroyed
     */
    _ensureNotDestroyed() {
        if (this._destroyed) {
            throw new Error(
                `${this.constructor.name} has been destroyed and cannot be used anymore. ` +
                `Create a new instance if needed.`
            );
        }
    }

    /**
     * Cleanup-Methode (verhindert Memory-Leaks)
     * Sollte beim Shutdown oder Plugin-Disable aufgerufen werden
     * 
     * @returns {Promise<void>}
     * 
     * @example
     * await myService.destroy();
     */
    async destroy() {
        if (this._destroyed) {
            this.logger.warn(`[${this.constructor.name}] Already destroyed, skipping`);
            return;
        }

        try {
            this.logger.info(`[${this.constructor.name}] Destroying service...`);

            // Hook für Subklassen (Custom-Cleanup)
            await this._onDestroy();

            // Cache leeren
            this._serviceCache.clear();
            this._dependencyChain.clear();

            // References freigeben
            this._logger = null;
            this._dbService = null;
            this._initialized = false;
            this._destroyed = true;

            // Wichtig: Logger nach destroy nicht mehr verfügbar!
            // Deshalb letzter Log VORHER
            console.log(`[${this.constructor.name}] Destroyed successfully`);

        } catch (error) {
            console.error(`[${this.constructor.name}] Error during destroy:`, error);
            throw error;
        }
    }

    /**
     * Hook für Subklassen - wird von destroy() aufgerufen
     * Überschreibe diese Methode für Custom-Cleanup
     * 
     * @protected
     * @abstract
     * @returns {Promise<void>}
     * 
     * @example
     * async _onDestroy() {
     *     await this._closeConnections();
     * }
     */
    async _onDestroy() {
        // Leer - Subklassen können überschreiben
    }

    /**
     * Fallback-Logger bei Fehler (Console-basiert)
     * 
     * @private
     * @returns {object} Console-Logger
     */
    _createFallbackLogger() {
        return {
            info: (...args) => console.log(`[${this.constructor.name}] INFO:`, ...args),
            warn: (...args) => console.warn(`[${this.constructor.name}] WARN:`, ...args),
            error: (...args) => console.error(`[${this.constructor.name}] ERROR:`, ...args),
            debug: (...args) => console.debug(`[${this.constructor.name}] DEBUG:`, ...args),
            success: (...args) => console.log(`[${this.constructor.name}] SUCCESS:`, ...args)
        };
    }

    /**
     * Gibt Informationen über den Service-Status zurück (Debugging)
     * 
     * @returns {object} Status-Informationen
     */
    getStatus() {
        return {
            className: this.constructor.name,
            initialized: this._initialized,
            destroyed: this._destroyed,
            cachedServices: Array.from(this._serviceCache.keys()),
            hasLogger: this._logger !== null,
            hasDb: this._dbService !== null
        };
    }
}

module.exports = BaseService;
