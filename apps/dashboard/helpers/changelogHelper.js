/**
 * Changelog Helper Functions
 * Hilfsfunktionen für den Umgang mit multi-language Changelogs
 * 
 * @author FireDervil
 */

/**
 * Extrahiert lokalisierte Changelog-Daten basierend auf der aktuellen Sprache
 * 
 * @param {Object} changelogItem - Changelog-Objekt aus der Datenbank (mit JSON-Feldern)
 * @param {string} locale - Gewünschte Sprache (z.B. "de-DE", "en-GB")
 * @param {string} fallbackLocale - Fallback-Sprache (Standard: "de-DE")
 * @returns {Object} - Lokalisiertes Changelog-Objekt mit title, description, changes
 */
function getLocalizedChangelog(changelogItem, locale = 'de-DE', fallbackLocale = 'de-DE') {
    if (!changelogItem) return null;

    // Parse JSON-Felder falls sie Strings sind
    const titleTranslations = typeof changelogItem.title_translations === 'string' 
        ? JSON.parse(changelogItem.title_translations) 
        : changelogItem.title_translations;
    
    const descriptionTranslations = typeof changelogItem.description_translations === 'string'
        ? JSON.parse(changelogItem.description_translations)
        : changelogItem.description_translations;
    
    const changesTranslations = typeof changelogItem.changes_translations === 'string'
        ? JSON.parse(changelogItem.changes_translations)
        : changelogItem.changes_translations;

    // Hole lokalisierte Werte mit Fallback
    const title = titleTranslations?.[locale] || titleTranslations?.[fallbackLocale] || 'Changelog';
    const description = descriptionTranslations?.[locale] || descriptionTranslations?.[fallbackLocale] || '';
    const changes = changesTranslations?.[locale] || changesTranslations?.[fallbackLocale] || '';

    // Rückgabe-Objekt mit allen Original-Feldern + lokalisierte Felder
    return {
        ...changelogItem,
        title,          // Lokalisierter Titel
        description,    // Lokalisierte Beschreibung
        changes,        // Lokalisierte Änderungen
        // Original JSON-Felder bleiben erhalten für Admin-Panel
        title_translations: titleTranslations,
        description_translations: descriptionTranslations,
        changes_translations: changesTranslations
    };
}

/**
 * Lokalisiert ein Array von Changelog-Items
 * 
 * @param {Array} changelogArray - Array von Changelog-Objekten
 * @param {string} locale - Gewünschte Sprache
 * @returns {Array} - Array von lokalisierten Changelog-Objekten
 */
function getLocalizedChangelogList(changelogArray, locale = 'de-DE') {
    if (!Array.isArray(changelogArray)) return [];
    
    return changelogArray.map(changelog => getLocalizedChangelog(changelog, locale));
}

/**
 * Erstellt ein Changelog-Objekt für die Datenbank (für CREATE/UPDATE)
 * 
 * @param {Object} translations - Objekt mit Übersetzungen
 *                                { title: {'de-DE': '...', 'en-GB': '...'}, description: {...}, changes: {...} }
 * @param {Object} metadata - Zusätzliche Metadaten (version, type, component, component_name, is_public, release_date, author_id)
 * @returns {Object} - Bereites Objekt für DB-Insert/Update
 */
function prepareChangelogForDB(translations, metadata = {}) {
    const titleTranslations = translations.title || {};
    const descriptionTranslations = translations.description || {};
    const changesTranslations = translations.changes || {};

    return {
        ...metadata,
        title_translations: JSON.stringify(titleTranslations),
        description_translations: JSON.stringify(descriptionTranslations),
        changes_translations: JSON.stringify(changesTranslations)
    };
}

/**
 * Prüft ob eine Übersetzung für eine Sprache existiert
 * 
 * @param {Object} changelogItem - Changelog-Objekt
 * @param {string} locale - Zu prüfende Sprache
 * @returns {boolean} - true wenn Übersetzung existiert
 */
function hasTranslation(changelogItem, locale) {
    if (!changelogItem) return false;
    
    const titleTranslations = typeof changelogItem.title_translations === 'string'
        ? JSON.parse(changelogItem.title_translations)
        : changelogItem.title_translations;
    
    return titleTranslations && titleTranslations[locale] !== undefined;
}

/**
 * Gibt alle verfügbaren Sprachen für einen Changelog zurück
 * 
 * @param {Object} changelogItem - Changelog-Objekt
 * @returns {Array} - Array von verfügbaren Locale-Codes
 */
function getAvailableLocales(changelogItem) {
    if (!changelogItem) return [];
    
    const titleTranslations = typeof changelogItem.title_translations === 'string'
        ? JSON.parse(changelogItem.title_translations)
        : changelogItem.title_translations;
    
    return titleTranslations ? Object.keys(titleTranslations) : [];
}

/**
 * Formatiert den Type-Badge für die Anzeige
 * 
 * @param {string} type - Changelog-Type (major, minor, patch, hotfix)
 * @returns {Object} - Badge-Info mit class und label
 */
function getTypeBadge(type) {
    const badges = {
        major: { class: 'danger', label: 'Major', icon: 'fa-solid fa-star' },
        minor: { class: 'info', label: 'Minor', icon: 'fa-solid fa-plus' },
        patch: { class: 'success', label: 'Patch', icon: 'fa-solid fa-wrench' },
        hotfix: { class: 'warning', label: 'Hotfix', icon: 'fa-solid fa-fire-extinguisher' }
    };
    
    return badges[type] || badges.patch;
}

/**
 * Formatiert den Component-Badge für die Anzeige
 * 
 * @param {string} component - Component (bot, dashboard, system, plugin)
 * @returns {Object} - Badge-Info mit class und label
 */
function getComponentBadge(component) {
    const badges = {
        bot: { class: 'primary', label: 'Bot', icon: 'fa-brands fa-discord' },
        dashboard: { class: 'info', label: 'Dashboard', icon: 'fa-solid fa-gauge' },
        system: { class: 'secondary', label: 'System', icon: 'fa-solid fa-server' },
        plugin: { class: 'success', label: 'Plugin', icon: 'fa-solid fa-puzzle-piece' }
    };
    
    return badges[component] || badges.system;
}

module.exports = {
    getLocalizedChangelog,
    getLocalizedChangelogList,
    hasTranslation,
    getAvailableLocales,
    prepareChangelogForDB,
    getTypeBadge,
    getComponentBadge
};
