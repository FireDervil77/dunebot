/**
 * Shared Utility Functions für das Template-Plugin
 * Diese Funktionen können sowohl vom Bot als auch vom Dashboard verwendet werden
 * 
 * @author DuneBot Team
 */

const { LIMITS, STATUS, DATA_TYPES } = require('./constants');

/**
 * Validiert einen Text auf Länge und Inhalt
 * 
 * @param {string} text - Zu validierender Text
 * @param {number} maxLength - Maximale Länge
 * @returns {Object} { valid: boolean, error?: string }
 */
function validateText(text, maxLength = LIMITS.MAX_TEXT_LENGTH) {
    if (!text || typeof text !== 'string') {
        return { valid: false, error: 'Text ist erforderlich' };
    }
    
    if (text.length > maxLength) {
        return { valid: false, error: `Text ist zu lang (max. ${maxLength} Zeichen)` };
    }
    
    if (text.trim().length === 0) {
        return { valid: false, error: 'Text darf nicht leer sein' };
    }
    
    return { valid: true };
}

/**
 * Validiert eine Discord ID
 * 
 * @param {string} id - Discord ID
 * @returns {boolean} True wenn gültig
 */
function isValidDiscordId(id) {
    return /^\d{17,19}$/.test(id);
}

/**
 * Formatiert einen Timestamp in ein lesbares Datum
 * 
 * @param {Date|string|number} timestamp - Timestamp
 * @param {string} locale - Locale (default: 'de-DE')
 * @returns {string} Formatiertes Datum
 */
function formatTimestamp(timestamp, locale = 'de-DE') {
    const date = new Date(timestamp);
    return date.toLocaleString(locale, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

/**
 * Berechnet die Differenz zwischen zwei Timestamps in Tagen
 * 
 * @param {Date|string|number} date1 - Erstes Datum
 * @param {Date|string|number} date2 - Zweites Datum
 * @returns {number} Differenz in Tagen
 */
function daysBetween(date1, date2) {
    const d1 = new Date(date1);
    const d2 = new Date(date2);
    const diffTime = Math.abs(d2 - d1);
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * Erstellt einen sicheren JSON-Parse mit Fallback
 * 
 * @param {string} json - JSON String
 * @param {*} fallback - Fallback-Wert bei Fehler
 * @returns {*} Geparster Wert oder Fallback
 */
function safeJsonParse(json, fallback = null) {
    try {
        return JSON.parse(json);
    } catch (error) {
        return fallback;
    }
}

/**
 * Erstellt einen sicheren JSON-Stringify
 * 
 * @param {*} value - Zu stringifizierender Wert
 * @param {string} fallback - Fallback bei Fehler
 * @returns {string} JSON String
 */
function safeJsonStringify(value, fallback = '{}') {
    try {
        return JSON.stringify(value);
    } catch (error) {
        return fallback;
    }
}

/**
 * Prüft ob ein Wert leer ist
 * 
 * @param {*} value - Zu prüfender Wert
 * @returns {boolean} True wenn leer
 */
function isEmpty(value) {
    if (value === null || value === undefined) return true;
    if (typeof value === 'string') return value.trim().length === 0;
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === 'object') return Object.keys(value).length === 0;
    return false;
}

/**
 * Chunked Array - Teilt ein Array in kleinere Arrays
 * 
 * @param {Array} array - Zu teilendes Array
 * @param {number} size - Größe der Chunks
 * @returns {Array<Array>} Array von Chunks
 */
function chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
}

/**
 * Escape HTML-Zeichen
 * 
 * @param {string} text - Zu escapender Text
 * @returns {string} Escapeter Text
 */
function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}

/**
 * Generiert eine Zufalls-ID
 * 
 * @param {number} length - Länge der ID
 * @returns {string} Zufalls-ID
 */
function generateId(length = 16) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

/**
 * Debounce-Funktion
 * 
 * @param {Function} func - Zu debounce-ende Funktion
 * @param {number} wait - Wartezeit in ms
 * @returns {Function} Debounced Function
 */
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Sleep-Funktion (Promise-basiert)
 * 
 * @param {number} ms - Millisekunden
 * @returns {Promise<void>}
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Konvertiert einen Wert basierend auf Datentyp
 * 
 * @param {*} value - Wert
 * @param {string} type - Datentyp aus DATA_TYPES
 * @returns {*} Konvertierter Wert
 */
function convertType(value, type) {
    switch (type) {
        case DATA_TYPES.NUMBER:
            return Number(value);
        case DATA_TYPES.BOOLEAN:
            return Boolean(value);
        case DATA_TYPES.JSON:
            return typeof value === 'string' ? safeJsonParse(value) : value;
        case DATA_TYPES.TEXT:
            return String(value);
        default:
            return value;
    }
}

module.exports = {
    validateText,
    isValidDiscordId,
    formatTimestamp,
    daysBetween,
    safeJsonParse,
    safeJsonStringify,
    isEmpty,
    chunkArray,
    escapeHtml,
    generateId,
    debounce,
    sleep,
    convertType
};
