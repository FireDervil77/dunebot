/**
 * News Helper Functions
 * Hilfsfunktionen für den Umgang mit multi-language News
 * 
 * @author FireDervil
 */

/**
 * Extrahiert lokalisierte News-Daten basierend auf der aktuellen Sprache
 * 
 * @param {Object} newsItem - News-Objekt aus der Datenbank (mit JSON-Feldern)
 * @param {string} locale - Gewünschte Sprache (z.B. "de-DE", "en-GB")
 * @param {string} fallbackLocale - Fallback-Sprache (Standard: "de-DE")
 * @returns {Object} - Lokalisiertes News-Objekt mit title, content, excerpt
 */
function getLocalizedNews(newsItem, locale = 'de-DE', fallbackLocale = 'de-DE') {
    if (!newsItem) return null;

    // Parse JSON-Felder falls sie Strings sind
    const titleTranslations = typeof newsItem.title_translations === 'string' 
        ? JSON.parse(newsItem.title_translations) 
        : newsItem.title_translations;
    
    const contentTranslations = typeof newsItem.content_translations === 'string'
        ? JSON.parse(newsItem.content_translations)
        : newsItem.content_translations;
    
    const excerptTranslations = typeof newsItem.excerpt_translations === 'string'
        ? JSON.parse(newsItem.excerpt_translations)
        : newsItem.excerpt_translations;

    // Hole lokalisierte Werte mit Fallback
    const title = titleTranslations?.[locale] || titleTranslations?.[fallbackLocale] || 'Untitled';
    const content = contentTranslations?.[locale] || contentTranslations?.[fallbackLocale] || '';
    const excerpt = excerptTranslations?.[locale] || excerptTranslations?.[fallbackLocale] || '';

    // Rückgabe-Objekt mit allen Original-Feldern + lokalisierte Felder
    return {
        ...newsItem,
        title,          // Lokalisierter Titel
        content,        // Lokalisierter Inhalt (statt news_text)
        excerpt,        // Lokalisiertes Excerpt
        // Original JSON-Felder bleiben erhalten für Admin-Panel
        title_translations: titleTranslations,
        content_translations: contentTranslations,
        excerpt_translations: excerptTranslations
    };
}

/**
 * Lokalisiert ein Array von News-Items
 * 
 * @param {Array} newsArray - Array von News-Objekten
 * @param {string} locale - Gewünschte Sprache
 * @returns {Array} - Array von lokalisierten News-Objekten
 */
function getLocalizedNewsList(newsArray, locale = 'de-DE') {
    if (!Array.isArray(newsArray)) return [];
    
    return newsArray.map(news => getLocalizedNews(news, locale));
}

/**
 * Prüft ob eine Übersetzung für eine Sprache existiert
 * 
 * @param {Object} newsItem - News-Objekt
 * @param {string} locale - Zu prüfende Sprache
 * @returns {boolean} - true wenn Übersetzung existiert
 */
function hasTranslation(newsItem, locale) {
    if (!newsItem) return false;
    
    const titleTranslations = typeof newsItem.title_translations === 'string'
        ? JSON.parse(newsItem.title_translations)
        : newsItem.title_translations;
    
    return titleTranslations && titleTranslations[locale] !== undefined;
}

/**
 * Gibt alle verfügbaren Sprachen für einen News-Eintrag zurück
 * 
 * @param {Object} newsItem - News-Objekt
 * @returns {Array} - Array von verfügbaren Locale-Codes
 */
function getAvailableLocales(newsItem) {
    if (!newsItem) return [];
    
    const titleTranslations = typeof newsItem.title_translations === 'string'
        ? JSON.parse(newsItem.title_translations)
        : newsItem.title_translations;
    
    return titleTranslations ? Object.keys(titleTranslations) : [];
}

/**
 * Erstellt ein News-Objekt für die Datenbank (für CREATE/UPDATE)
 * 
 * @param {Object} translations - Objekt mit Übersetzungen pro Sprache
 *                                { 'de-DE': { title, content, excerpt }, 'en-GB': {...} }
 * @param {Object} metadata - Zusätzliche Metadaten (author, slug, image_url, etc.)
 * @returns {Object} - Bereites Objekt für DB-Insert/Update
 */
function prepareNewsForDB(translations, metadata = {}) {
    const titleTranslations = {};
    const contentTranslations = {};
    const excerptTranslations = {};

    // Extrahiere Übersetzungen
    Object.keys(translations).forEach(locale => {
        const trans = translations[locale];
        titleTranslations[locale] = trans.title || '';
        contentTranslations[locale] = trans.content || '';
        excerptTranslations[locale] = trans.excerpt || '';
    });

    return {
        ...metadata,
        title_translations: JSON.stringify(titleTranslations),
        content_translations: JSON.stringify(contentTranslations),
        excerpt_translations: JSON.stringify(excerptTranslations)
    };
}

// NewsHelper Objekt für einfachen Import
const NewsHelper = {
    getLocalizedNews,
    getLocalizedNewsList,
    hasTranslation,
    getAvailableLocales,
    prepareNewsForDB
};

module.exports = NewsHelper;