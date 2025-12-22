require("dotenv").config();

/**
 * PluginHooks - Ein Hook-System für DuneBot
 * Ermöglicht das Registrieren und Ausführen von Filtern und Actions
 * Wird sowohl im Dashboard als auch im Bot verwendet
 * 
 * @author FireBot Team
 */
class PluginHooks {

    /**
     * Erstellt eine neue Instanz des PluginHooks-Systems
     * @param {Object} logger - Logger-Instanz
     * @author FireBot Team
     */
    constructor(logger) {
        this.logger = logger;
        this.actions = {};
        this.filters = {};
        this.viewHooks = {};
        this.guildSections = {};
        this.debug = process.env.DEBUG_HOOKS === 'true';
    }
    

    /**
     * Registriert eine Action (Callback ohne Rückgabewert)
     * @param {string} name - Name der Action
     * @param {Function} callback - Callback-Funktion
     * @param {number} [priority=10] - Priorität der Action
     * @author FireBot Team
     */
    addAction(name, callback, priority = 10) {
        if (!this.actions[name]) this.actions[name] = [];
        this.actions[name].push({ callback, priority });
        this.actions[name].sort((a, b) => a.priority - b.priority);
        this.logger.debug(`Action registered: ${name} with priority ${priority}`);
    }

    /**
     * Führt alle registrierten Actions für einen Namen aus
     * @param {string} name - Name der Action
     * @param {...any} args - Argumente für die Callback-Funktionen
     * @returns {Promise<void>}
     * @author FireBot Team
     */
    async doAction(name, ...args) {
        if (!this.actions[name]) return;
        
        if (this.debug) {
            this.logger.debug(`Executing action: ${name} with ${this.actions[name].length} callbacks`);
        }
        
        for (const hook of this.actions[name]) {
            try {
                await hook.callback(...args);
            } catch (error) {
                this.logger.error(`Error in action ${name}:`, error);
            }
        }
    }
    
    /**
     * Registriert einen Filter (Callback mit Rückgabewert)
     * @param {string} name - Name des Filters
     * @param {Function} callback - Callback-Funktion
     * @param {number} [priority=10] - Priorität des Filters
     * @author FireBot Team
     */
    addFilter(name, callback, priority = 10) {
        if (!this.filters[name]) this.filters[name] = [];
        this.filters[name].push({ callback, priority });
        this.filters[name].sort((a, b) => a.priority - b.priority);
        this.logger.debug(`Filter registered: ${name} with priority ${priority}`);
    }

    /**
     * Wendet alle registrierten Filter auf einen Wert an
     * @param {string} name - Name des Filters
     * @param {any} value - Ursprungswert
     * @param {...any} args - Zusätzliche Argumente für die Filter
     * @returns {Promise<any>} - Gefilterter Wert
     * @author FireBot Team
     */
    async applyFilter(name, value, ...args) {
        if (!this.filters[name]) return value;
        
        if (this.debug) {
            this.logger.debug(`Applying filter: ${name} with ${this.filters[name].length} callbacks`);
        }
        
        let result = value;
        for (const hook of this.filters[name]) {
            try {
                result = await hook.callback(result, ...args);
            } catch (error) {
                this.logger.error(`Error in filter ${name}:`, error);
            }
        }
        
        return result;
    }

    /**
     * Alias für applyFilter (Kompatibilität mit Bot-Code)
     * @param {string} name - Name des Filters
     * @param {any} value - Ursprungswert
     * @param {...any} args - Zusätzliche Argumente
     * @returns {Promise<any>} - Gefilterter Wert
     * @author FireBot Team
     */
    async applyFilters(name, value, ...args) {
        return this.applyFilter(name, value, ...args);
    }


    /**
     * Registriert einen View-Hook für eine bestimmte Position
     * @param {string} location - Position im View
     * @param {any} component - Zu registrierender View-Komponent
     * @param {number} [priority=10] - Priorität des Hooks
     * @author FireBot Team
     */
    addViewHook(location, component, priority = 10) {

        if (!this.viewHooks[location]) this.viewHooks[location] = [];
        this.viewHooks[location].push({ component, priority });
        this.viewHooks[location].sort((a, b) => a.priority - b.priority);
        this.logger.debug(`View hook registered: ${location}`);
    }
    
    /**
     * Gibt alle View-Hooks für eine bestimmte Position zurück
     * @param {string} location - Position im View
     * @returns {Array} - Liste der View-Hooks
     * @author FireBot Team
     */
    getViewHooks(location) {
        return this.viewHooks[location] || [];
    }
    
    /**
     * Registriert eine Guild-Sektion
     * @param {string} id - ID der Sektion
     * @param {string} title - Titel der Sektion
     * @param {any} component - Komponente der Sektion
     * @param {number} [priority=10] - Priorität der Sektion
     * @author FireBot Team
     */
    registerGuildSection(id, title, component, priority = 10) {
        if (!this.guildSections[id]) {
            this.guildSections[id] = {
                title,
                component,
                priority
            };
            this.logger.debug(`Guild section registered: ${id}`);
        }
    }
    
    /**
     * Gibt alle registrierten Guild-Sektionen zurück
     * @returns {Array<Object>} - Liste der Guild-Sektionen
     * @author FireBot Team
     */
    getGuildSections() {
        return Object.entries(this.guildSections)
            .map(([id, section]) => ({ id, ...section }))
            .sort((a, b) => a.priority - b.priority);
    }

    /**
     * Entfernt eine Action
     * @param {string} name - Name der Action
     * @param {Function} [callback] - Spezifische Callback-Funktion (optional)
     * @returns {boolean} - true, wenn Actions entfernt wurden
     * @author FireBot Team
     */
    removeAction(name, callback) {
        if (!this.actions[name]) {
            return false;
        }
        
        if (!callback) {
            // Alle Actions mit diesem Namen entfernen
            delete this.actions[name];
            return true;
        }
        
        // Nur die spezifische Callback entfernen
        const initialLength = this.actions[name].length;
        this.actions[name] = this.actions[name].filter(hook => hook.callback !== callback);
        
        return this.actions[name].length < initialLength;
    }

    /**
     * Entfernt einen Filter
     * @param {string} name - Name des Filters
     * @param {Function} [callback] - Spezifische Callback-Funktion (optional)
     * @returns {boolean} - true, wenn Filter entfernt wurden
     * @author FireBot Team
     */
    removeFilter(name, callback) {
        if (!this.filters[name]) {
            return false;
        }
        
        if (!callback) {
            // Alle Filter mit diesem Namen entfernen
            delete this.filters[name];
            return true;
        }
        
        // Nur die spezifische Callback entfernen
        const initialLength = this.filters[name].length;
        this.filters[name] = this.filters[name].filter(hook => hook.callback !== callback);
        
        return this.filters[name].length < initialLength;
    }

    /**
     * Prüft, ob eine Action registriert ist
     * @param {string} name - Name der Action
     * @returns {boolean} - true, wenn die Action existiert
     * @author FireBot Team
     */
    hasAction(name) {
        return this.actions[name] && this.actions[name].length > 0;
    }

    /**
     * Prüft, ob ein Filter registriert ist
     * @param {string} name - Name des Filters
     * @returns {boolean} - true, wenn der Filter existiert
     * @author FireBot Team
     */
    hasFilter(name) {
        return this.filters[name] && this.filters[name].length > 0;
    }

    /**
     * Gibt die Anzahl der registrierten Handler für eine Action zurück
     * @param {string} name - Name der Action
     * @returns {number} - Anzahl der Handler
     * @author FireBot Team
     */
    getActionCount(name) {
        return this.actions[name] ? this.actions[name].length : 0;
    }

    /**
     * Gibt die Anzahl der registrierten Handler für einen Filter zurück
     * @param {string} name - Name des Filters
     * @returns {number} - Anzahl der Handler
     * @author FireBot Team
     */
    getFilterCount(name) {
        return this.filters[name] ? this.filters[name].length : 0;
    }
}

module.exports = PluginHooks;