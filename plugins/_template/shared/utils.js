/**
 * Template Plugin - Shared Utilities
 * 
 * Gemeinsame Utilities die sowohl vom Bot als auch vom Dashboard
 * genutzt werden können.
 * 
 * @author DuneBot Team
 */

/**
 * Validiert Einstellungen
 * 
 * @param {Object} settings - Einstellungen zum Validieren
 * @returns {Object} { valid: boolean, errors: string[] }
 */
function validateSettings(settings) {
    const errors = [];
    
    if (settings.max_items !== undefined) {
        if (typeof settings.max_items !== 'number') {
            errors.push('max_items must be a number');
        } else if (settings.max_items < 1 || settings.max_items > 1000) {
            errors.push('max_items must be between 1 and 1000');
        }
    }
    
    if (settings.cooldown_seconds !== undefined) {
        if (typeof settings.cooldown_seconds !== 'number') {
            errors.push('cooldown_seconds must be a number');
        } else if (settings.cooldown_seconds < 0 || settings.cooldown_seconds > 3600) {
            errors.push('cooldown_seconds must be between 0 and 3600');
        }
    }
    
    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Sanitize User-Input
 * 
 * @param {string} input - User-Input
 * @returns {string} Sanitized Input
 */
function sanitizeInput(input) {
    if (typeof input !== 'string') return '';
    
    return input
        .trim()
        .replace(/[<>]/g, '') // Entferne < und >
        .substring(0, 500);   // Max 500 Zeichen
}

/**
 * Generiert eine eindeutige ID
 * 
 * @returns {string} Unique ID
 */
function generateId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

module.exports = {
    validateSettings,
    sanitizeInput,
    generateId
};
