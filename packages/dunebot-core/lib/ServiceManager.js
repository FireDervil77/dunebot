/**
 * Service Manager Pattern Implementation
 * Provides a central registry for application services
 */
class ServiceManager {
    static #services = new Map();

    /**
     * Register a service with the manager
     * @param {string} name - Name of the service
     * @param {any} service - The service instance
     */
    static register(name, service) {
        ServiceManager.#services.set(name, service);
    }

    /**
     * Retrieve a service from the locator
     * @param {string} name - Name of the service to retrieve
     * @returns {any} The requested service
     * @throws {Error} If service is not found
     */
    static get(name) {
        if (!ServiceManager.#services.has(name)) {
            throw new Error(`Service '${name}' not registered`);
        }
        return ServiceManager.#services.get(name);
    }

    /**
     * Check if a service exists in the locator
     * @param {string} name - Name of the service to check
     * @returns {boolean} True if the service exists
     */
    static has(name) {
        return ServiceManager.#services.has(name);
    }

    /**
     * Gibt eine Liste aller registrierten Services zurück
     * @returns {Object} Ein Objekt mit Service-Namen und deren Instanzen
     * @author FireDervil
     */
    static listServices() {
        const services = {};
        for (const [name, service] of this.#services) {
            services[name] = service;
        }
        return services;
    }

    /**
     * Gibt nur die Namen der registrierten Services zurück
     * @returns {Array<string>} Array mit Service-Namen
     * @author FireDervil
     */
    static getServiceNames() {
        return Array.from(this.#services.keys());
    }
}

module.exports = ServiceManager;