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

/**
 * Parst hierarchische Changelog-Struktur mit # Header und ## Sub-Header
 * 
 * Format:
 * # PLUGINS
 * ## DuneMap
 * ! Fix: Irgendwas
 * + Feature: Neues Ding
 * - Removed: Altes Zeug
 * * Change: Verbesserung
 * 
 * ## Core
 * ! Fix: Bug behoben
 * 
 * @param {string} changesText - Rohtext aus dem Changelog-Editor
 * @returns {Array} - Strukturiertes Array mit Gruppen und Items
 * 
 * Struktur:
 * [
 *   {
 *     type: 'group',
 *     title: 'PLUGINS',
 *     level: 1,
 *     children: [
 *       {
 *         type: 'subgroup',
 *         title: 'DuneMap',
 *         level: 2,
 *         items: [
 *           { type: 'fix', icon: 'fa-bug', text: 'Fix: Irgendwas', category: 'Fixes' },
 *           { type: 'feature', icon: 'fa-plus', text: 'Feature: Neues Ding', category: 'Features' },
 *           ...
 *         ]
 *       }
 *     ]
 *   }
 * ]
 */
function parseHierarchicalChangelog(changesText) {
    if (!changesText || typeof changesText !== 'string') {
        return [];
    }

    const lines = changesText.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    const result = [];
    let currentGroup = null;
    let currentSubgroup = null;

    // Mapping für Item-Typen
    const itemTypeMap = {
        '!': { type: 'fix', icon: 'fa-bug', class: 'danger', category: 'Fixes' },
        '+': { type: 'feature', icon: 'fa-plus', class: 'success', category: 'Features' },
        '-': { type: 'removed', icon: 'fa-minus', class: 'warning', category: 'Removed' },
        '*': { type: 'change', icon: 'fa-edit', class: 'info', category: 'Changes' }
    };

    for (const line of lines) {
        // # Header erkennen (Hauptgruppe)
        if (line.startsWith('# ')) {
            const title = line.substring(2).trim();
            currentGroup = {
                type: 'group',
                title,
                level: 1,
                children: []
            };
            result.push(currentGroup);
            currentSubgroup = null; // Reset subgroup
            continue;
        }

        // ## Sub-Header erkennen (Untergruppe)
        if (line.startsWith('## ')) {
            const title = line.substring(3).trim();
            currentSubgroup = {
                type: 'subgroup',
                title,
                level: 2,
                items: []
            };

            // Wenn keine Gruppe existiert, erstelle eine "Allgemein"-Gruppe
            if (!currentGroup) {
                currentGroup = {
                    type: 'group',
                    title: 'Änderungen',
                    level: 1,
                    children: []
                };
                result.push(currentGroup);
            }

            currentGroup.children.push(currentSubgroup);
            continue;
        }

        // Items erkennen (!, +, -, *)
        const firstChar = line.charAt(0);
        if (itemTypeMap[firstChar]) {
            const itemMeta = itemTypeMap[firstChar];
            const text = line.substring(1).trim();

            const item = {
                type: itemMeta.type,
                icon: itemMeta.icon,
                class: itemMeta.class,
                category: itemMeta.category,
                text
            };

            // Wenn Subgroup existiert, füge Item zur Subgroup hinzu
            if (currentSubgroup) {
                currentSubgroup.items.push(item);
            }
            // Wenn nur Group existiert (keine Subgroup), erstelle "Allgemein"-Subgroup
            else if (currentGroup) {
                // Prüfe ob "Allgemein"-Subgroup bereits existiert
                let generalSubgroup = currentGroup.children.find(sg => sg.title === 'Allgemein');
                if (!generalSubgroup) {
                    generalSubgroup = {
                        type: 'subgroup',
                        title: 'Allgemein',
                        level: 2,
                        items: []
                    };
                    currentGroup.children.push(generalSubgroup);
                }
                generalSubgroup.items.push(item);
                currentSubgroup = generalSubgroup; // Setze für weitere Items
            }
            // Wenn weder Group noch Subgroup existiert, erstelle beides
            else {
                currentGroup = {
                    type: 'group',
                    title: 'Änderungen',
                    level: 1,
                    children: []
                };
                currentSubgroup = {
                    type: 'subgroup',
                    title: 'Allgemein',
                    level: 2,
                    items: []
                };
                currentGroup.children.push(currentSubgroup);
                result.push(currentGroup);
                currentSubgroup.items.push(item);
            }
        }
        // Zeile ohne erkanntes Format wird ignoriert (kann erweitert werden für plain text)
    }

    return result;
}

/**
 * Konvertiert hierarchische Struktur zurück zu Markdown-Text
 * (Nützlich für Editor-Vorschau oder Export)
 * 
 * @param {Array} hierarchicalData - Strukturierte Daten von parseHierarchicalChangelog()
 * @returns {string} - Markdown-formatierter Text
 */
function hierarchicalChangelogToMarkdown(hierarchicalData) {
    if (!Array.isArray(hierarchicalData) || hierarchicalData.length === 0) {
        return '';
    }

    const lines = [];

    for (const group of hierarchicalData) {
        if (group.type === 'group') {
            lines.push(`# ${group.title}`);
            
            for (const subgroup of group.children || []) {
                if (subgroup.type === 'subgroup') {
                    lines.push(`## ${subgroup.title}`);
                    
                    for (const item of subgroup.items || []) {
                        const prefix = {
                            fix: '!',
                            feature: '+',
                            removed: '-',
                            change: '*'
                        }[item.type] || '*';
                        
                        lines.push(`${prefix} ${item.text}`);
                    }
                    lines.push(''); // Leerzeile nach Subgroup
                }
            }
            lines.push(''); // Leerzeile nach Group
        }
    }

    return lines.join('\n').trim();
}

module.exports = {
    getLocalizedChangelog,
    getLocalizedChangelogList,
    hasTranslation,
    getAvailableLocales,
    prepareChangelogForDB,
    getTypeBadge,
    getComponentBadge,
    parseHierarchicalChangelog,
    hierarchicalChangelogToMarkdown
};
