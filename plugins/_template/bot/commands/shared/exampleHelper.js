/**
 * Beispiel Shared Helper
 * 
 * Shared Helper-Funktionen können von Commands und Events
 * gemeinsam genutzt werden.
 * 
 * @author DuneBot Team
 * @version 1.0.0
 */

/**
 * Beispiel: Text formatieren
 * 
 * @param {string} text - Text zum Formatieren
 * @param {Object} options - Formatierungs-Optionen
 * @returns {string} Formatierter Text
 */
function formatText(text, options = {}) {
    const {
        uppercase = false,
        lowercase = false,
        capitalize = false,
        maxLength = 200
    } = options;

    let result = text;

    if (uppercase) result = result.toUpperCase();
    if (lowercase) result = result.toLowerCase();
    if (capitalize) result = result.charAt(0).toUpperCase() + result.slice(1).toLowerCase();
    
    if (result.length > maxLength) {
        result = result.substring(0, maxLength - 3) + '...';
    }

    return result;
}

/**
 * Beispiel: Zahl formatieren
 * 
 * @param {number} num - Zahl zum Formatieren
 * @param {string} locale - Locale (z.B. 'de-DE', 'en-GB')
 * @returns {string} Formatierte Zahl
 */
function formatNumber(num, locale = 'de-DE') {
    return new Intl.NumberFormat(locale).format(num);
}

/**
 * Beispiel: Datum formatieren
 * 
 * @param {Date} date - Datum zum Formatieren
 * @param {string} locale - Locale
 * @returns {string} Formatiertes Datum
 */
function formatDate(date, locale = 'de-DE') {
    return new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    }).format(date);
}

/**
 * Beispiel: Async Delay
 * 
 * @param {number} ms - Millisekunden
 * @returns {Promise<void>}
 */
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Beispiel: Random Integer
 * 
 * @param {number} min - Minimum (inklusive)
 * @param {number} max - Maximum (inklusive)
 * @returns {number} Zufallszahl
 */
function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

module.exports = {
    formatText,
    formatNumber,
    formatDate,
    delay,
    randomInt
};
