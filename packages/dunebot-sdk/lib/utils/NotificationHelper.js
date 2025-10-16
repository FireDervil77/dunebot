/**
 * Notification Helper Functions
 * Hilfsfunktionen für den Umgang mit multi-language Notifications
 * 
 * @author FireDervil
 */

/**
 * Extrahiert lokalisierte Notification-Daten basierend auf der aktuellen Sprache
 * 
 * @param {Object} notificationItem - Notification-Objekt aus der Datenbank (mit JSON-Feldern)
 * @param {string} locale - Gewünschte Sprache (z.B. "de-DE", "en-GB")
 * @param {string} fallbackLocale - Fallback-Sprache (Standard: "de-DE")
 * @returns {Object} - Lokalisiertes Notification-Objekt mit title, message, action_text
 */
function getLocalizedNotification(notificationItem, locale = 'de-DE', fallbackLocale = 'de-DE') {
    if (!notificationItem) return null;

    // Parse JSON-Felder falls sie Strings sind
    const titleTranslations = typeof notificationItem.title_translations === 'string' 
        ? JSON.parse(notificationItem.title_translations) 
        : notificationItem.title_translations;
    
    const messageTranslations = typeof notificationItem.message_translations === 'string'
        ? JSON.parse(notificationItem.message_translations)
        : notificationItem.message_translations;
    
    const actionTextTranslations = typeof notificationItem.action_text_translations === 'string'
        ? JSON.parse(notificationItem.action_text_translations)
        : notificationItem.action_text_translations;

    // Hole lokalisierte Werte mit Fallback
    const title = titleTranslations?.[locale] || titleTranslations?.[fallbackLocale] || 'Notification';
    const message = messageTranslations?.[locale] || messageTranslations?.[fallbackLocale] || '';
    const action_text = actionTextTranslations?.[locale] || actionTextTranslations?.[fallbackLocale] || 'Learn more';

    // Rückgabe-Objekt mit allen Original-Feldern + lokalisierte Felder
    return {
        ...notificationItem,
        title,          // Lokalisierter Titel
        message,        // Lokalisierte Nachricht
        action_text,    // Lokalisierter Action-Text
        // Original JSON-Felder bleiben erhalten für Admin-Panel
        title_translations: titleTranslations,
        message_translations: messageTranslations,
        action_text_translations: actionTextTranslations
    };
}

/**
 * Lokalisiert ein Array von Notification-Items
 * 
 * @param {Array} notificationArray - Array von Notification-Objekten
 * @param {string} locale - Gewünschte Sprache
 * @returns {Array} - Array von lokalisierten Notification-Objekten
 */
function getLocalizedNotificationList(notificationArray, locale = 'de-DE') {
    if (!Array.isArray(notificationArray)) return [];
    
    return notificationArray.map(notification => getLocalizedNotification(notification, locale));
}

/**
 * Erstellt ein Notification-Objekt für die Datenbank (für CREATE/UPDATE)
 * 
 * @param {Object} translations - Objekt mit Übersetzungen
 *                                { title: {'de-DE': '...', 'en-GB': '...'}, message: {...}, action_text: {...} }
 * @param {Object} metadata - Zusätzliche Metadaten (type, action_url, expiry, roles, etc.)
 * @returns {Object} - Bereites Objekt für DB-Insert/Update
 */
function prepareNotificationForDB(translations, metadata = {}) {
    const titleTranslations = translations.title || {};
    const messageTranslations = translations.message || {};
    const actionTextTranslations = translations.action_text || {};

    return {
        ...metadata,
        title_translations: JSON.stringify(titleTranslations),
        message_translations: JSON.stringify(messageTranslations),
        action_text_translations: JSON.stringify(actionTextTranslations)
    };
}

/**
 * Prüft ob eine Übersetzung für eine Sprache existiert
 * 
 * @param {Object} notificationItem - Notification-Objekt
 * @param {string} locale - Zu prüfende Sprache
 * @returns {boolean} - true wenn Übersetzung existiert
 */
function hasTranslation(notificationItem, locale) {
    if (!notificationItem) return false;
    
    const titleTranslations = typeof notificationItem.title_translations === 'string'
        ? JSON.parse(notificationItem.title_translations)
        : notificationItem.title_translations;
    
    return titleTranslations && titleTranslations[locale] !== undefined;
}

/**
 * Gibt alle verfügbaren Sprachen für eine Notification zurück
 * 
 * @param {Object} notificationItem - Notification-Objekt
 * @returns {Array} - Array von verfügbaren Locale-Codes
 */
function getAvailableLocales(notificationItem) {
    if (!notificationItem) return [];
    
    const titleTranslations = typeof notificationItem.title_translations === 'string'
        ? JSON.parse(notificationItem.title_translations)
        : notificationItem.title_translations;
    
    return titleTranslations ? Object.keys(titleTranslations) : [];
}

// NotificationHelper Objekt für einfachen Import
const NotificationHelper = {
    getLocalizedNotification,
    getLocalizedNotificationList,
    hasTranslation,
    getAvailableLocales,
    prepareNotificationForDB
};

module.exports = NotificationHelper;
