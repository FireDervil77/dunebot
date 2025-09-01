/**
 * Parst JSON-Werte aus Settings sicher
 * @param {string|array|null} value - Der zu parsende Wert
 * @param {array} defaultValue - Rückfallwert
 * @returns {array} Das geparste Array
 */
function parseJsonArray(value, defaultValue = []) {
    try {
        if (!value) {
            return defaultValue;
        } else if (typeof value === 'string') {
            if (value.startsWith('[')) {
                return JSON.parse(value);
            } else {
                return value.split(',').map(p => p.trim());
            }
        } else if (Array.isArray(value)) {
            return value;
        } else {
            return defaultValue;
        }
    } catch (err) {
        console.error(`Failed to parse JSON array:`, err);
        return defaultValue;
    }
}

// Direkt die Funktion exportieren, nicht als Objekt
module.exports = parseJsonArray;