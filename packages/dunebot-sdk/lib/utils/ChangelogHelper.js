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

    // ✅ HYBRID-MODUS: Unterstütze SOWOHL Plain-Text ALS AUCH HTML-Format
    let processedText = changesText;
    
    // ⚡ SCHRITT 0: <br> Tags in Newlines umwandeln (KRITISCH!)
    // TinyMCE speichert mehrere Items in EINEM <p>-Tag mit <br>-Trennung!
    // <p>! Fix 1<br>! Fix 2<br>! Fix 3</p> → mehrere Zeilen
    processedText = processedText.replace(/<br\s*\/?>/gi, '\n');
    
    // SCHRITT 1: Überschriften normalisieren (HTML → Plain-Text für Parsing)
    // <h2>Header</h2> → # Header
    processedText = processedText.replace(/<h2[^>]*>(.*?)<\/h2>/gi, (match, content) => {
        // Behalte inneres HTML (für Bold, Links, etc.)
        return '\n# ' + content.trim() + '\n';
    });
    
    // <h3>Subheader</h3> → ## Subheader  
    processedText = processedText.replace(/<h3[^>]*>(.*?)<\/h3>/gi, (match, content) => {
        return '\n## ' + content.trim() + '\n';
    });
    
    // SCHRITT 2: Items mit Symbolen extrahieren (BEHALTE HTML im Text!)
    // <p>! Bugfix: <strong>Server crash</strong> fixed</p> → ! Bugfix: <strong>Server crash</strong> fixed
    // ⚡ WICHTIG: Durch <br>→\n sind jetzt mehrere Zeilen in separaten <p>-Tags!
    processedText = processedText.replace(/<p[^>]*>([!+\-*])\s+(.*?)<\/p>/gi, (match, symbol, content) => {
        // Symbol + Leerzeichen + ORIGINAL HTML-CONTENT
        return '\n' + symbol + ' ' + content.trim() + '\n';
    });
    
    // ✅ NEU: Normalen Text (ohne Symbol) als DESCRIPTION-Marker
    // <p>Dies ist eine Beschreibung der Sektion</p> → DESC: Dies ist eine Beschreibung...
    processedText = processedText.replace(/<p[^>]*>((?![!+\-*]\s).*?)<\/p>/gi, (match, content) => {
        // Nur wenn es KEIN Symbol am Anfang ist
        const trimmed = content.trim();
        if (trimmed.length > 0 && !/^[!+\-*]\s/.test(trimmed)) {
            return '\nDESC: ' + trimmed + '\n';
        }
        return '';
    });
    
    // SCHRITT 3: <ul>/<li> Listen → * Items (BEHALTE HTML im Text!)
    processedText = processedText.replace(/<li[^>]*>(.*?)<\/li>/gi, (match, content) => {
        // Wenn schon Symbol am Anfang, nicht nochmal * hinzufügen
        const trimmed = content.trim();
        if (/^[!+\-*]\s/.test(trimmed)) {
            return '\n' + trimmed + '\n';
        }
        return '\n* ' + trimmed + '\n';
    });
    processedText = processedText.replace(/<\/?ul[^>]*>/gi, '');
    processedText = processedText.replace(/<\/?ol[^>]*>/gi, '');
    
    // SCHRITT 4: Alle anderen <p> ohne Symbol UND ohne DESC schon entfernt (siehe oben)
    
    // SCHRITT 5: HTML-Entities dekodieren (für Text-Vergleiche)
    processedText = processedText.replace(/&nbsp;/g, ' ');
    processedText = processedText.replace(/&lt;/g, '<');
    processedText = processedText.replace(/&gt;/g, '>');
    processedText = processedText.replace(/&amp;/g, '&');
    processedText = processedText.replace(/&quot;/g, '"');
    // Deutsche Umlaute
    processedText = processedText.replace(/&uuml;/g, 'ü');
    processedText = processedText.replace(/&ouml;/g, 'ö');
    processedText = processedText.replace(/&auml;/g, 'ä');
    processedText = processedText.replace(/&Uuml;/g, 'Ü');
    processedText = processedText.replace(/&Ouml;/g, 'Ö');
    processedText = processedText.replace(/&Auml;/g, 'Ä');
    processedText = processedText.replace(/&szlig;/g, 'ß');

    const lines = processedText.split('\n').map(line => line.trim()).filter(line => line.length > 0);
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
                description: null,  // ✅ NEU: Beschreibung für Subgroup
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

        // ✅ NEU: Description-Zeilen erkennen (DESC: ...)
        if (line.startsWith('DESC: ')) {
            const descText = line.substring(6).trim();
            
            // Füge Description zur aktuellen Subgroup hinzu
            if (currentSubgroup) {
                // Wenn schon eine Description existiert, füge mit <br> hinzu
                if (currentSubgroup.description) {
                    currentSubgroup.description += '<br>' + descText;
                } else {
                    currentSubgroup.description = descText;
                }
            }
            // Wenn keine Subgroup, erstelle "Allgemein" und füge dort hinzu
            else if (currentGroup) {
                let generalSubgroup = currentGroup.children.find(sg => sg.title === 'Allgemein');
                if (!generalSubgroup) {
                    generalSubgroup = {
                        type: 'subgroup',
                        title: 'Allgemein',
                        level: 2,
                        description: descText,
                        items: []
                    };
                    currentGroup.children.push(generalSubgroup);
                    currentSubgroup = generalSubgroup;
                } else {
                    if (generalSubgroup.description) {
                        generalSubgroup.description += '<br>' + descText;
                    } else {
                        generalSubgroup.description = descText;
                    }
                }
            }
            continue;
        }

        // Items erkennen (!, +, -, *)
        const firstChar = line.charAt(0);
        if (itemTypeMap[firstChar]) {
            const itemMeta = itemTypeMap[firstChar];
            // ✅ WICHTIG: Text BEHÄLT HTML-Tags (strong, em, code, a, etc.)
            const text = line.substring(1).trim();

            const item = {
                type: itemMeta.type,
                icon: itemMeta.icon,
                class: itemMeta.class,
                category: itemMeta.category,
                text  // Text MIT HTML!
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

// ChangelogHelper Objekt für einfachen Import
const ChangelogHelper = {
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

module.exports = ChangelogHelper;
