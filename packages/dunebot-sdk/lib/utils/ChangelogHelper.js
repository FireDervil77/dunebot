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

/** Entities, die TinyMCE in die Beschreibung schreibt. */
const ENTITIES = {
    '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
    '&uuml;': 'ü', '&ouml;': 'ö', '&auml;': 'ä', '&Uuml;': 'Ü', '&Ouml;': 'Ö',
    '&Auml;': 'Ä', '&szlig;': 'ß', '&eacute;': 'é', '&ndash;': '–', '&mdash;': '—',
};

/**
 * Macht aus der HTML-Beschreibung einen einzeiligen Textauszug.
 *
 * Die Beschreibung ist bewusst HTML (dort läuft weiterhin ein WYSIWYG-Editor). Auf
 * der Detailseite wird sie deshalb unescaped ausgegeben. In der Kachel-Übersicht
 * geht das nicht: Ein <h1> oder ein Dutzend <br> sprengen die Karte. Escapen ist aber
 * auch falsch – dann liest der Besucher die Tags. Also: Auszeichnung entfernen,
 * Entities auflösen, kürzen.
 *
 * @param {string} html
 * @param {number} maxLaenge - 0 schaltet das Kürzen ab
 * @returns {string} Reintext ohne Auszeichnung
 */
function zuTextauszug(html, maxLaenge = 220) {
    if (!html) return '';

    let text = String(html)
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<\/(p|div|h[1-6]|li)>/gi, ' ')
        .replace(/<[^>]+>/g, '');

    // Zweimal, weil der Bestand doppelt kodierte Entities enthält (&amp;ouml;).
    for (let durchgang = 0; durchgang < 2; durchgang++) {
        for (const [entity, zeichen] of Object.entries(ENTITIES)) {
            text = text.split(entity).join(zeichen);
        }
    }

    text = text.replace(/\s+/g, ' ').trim();

    if (maxLaenge > 0 && text.length > maxLaenge) {
        // An der letzten Wortgrenze davor abschneiden, nicht mitten im Wort.
        const gekuerzt = text.slice(0, maxLaenge);
        const grenze = gekuerzt.lastIndexOf(' ');
        text = (grenze > maxLaenge * 0.6 ? gekuerzt.slice(0, grenze) : gekuerzt).trimEnd() + '…';
    }

    return text;
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
    
    // ⚡ SCHRITT 0.5: Multi-line <p>-Tags aufteilen
    // Nach <br>→\n kann ein <p> mehrere Zeilen enthalten → einzelne <p>-Tags daraus machen
    // Ohne dies scheitern alle folgenden <p>-Regexe (. matcht kein \n ohne s-Flag)
    processedText = processedText.replace(/<p([^>]*)>([\s\S]*?)<\/p>/gi, (match, attrs, content) => {
        if (!content.includes('\n')) return match; // Single-line: unverändert lassen
        return content.split('\n').filter(l => l.trim()).map(l => '<p>' + l.trim() + '</p>').join('\n');
    });
    
    // SCHRITT 1: Überschriften normalisieren (HTML → Plain-Text für Parsing)
    //
    // Ein WYSIWYG-Editor macht aus getipptem "# FireNetworks" ein
    // `<h1># FireNetworks</h1>` – Überschrift UND Marker. Deshalb wird der
    // Marker aus dem Inhalt entfernt, sonst hieße die Gruppe "# FireNetworks".
    const ohneMarker = (text) => String(text).replace(/^\s*#{1,3}\s*/, '').trim();

    // <h1> fehlte bisher ganz: TinyMCE erzeugt es fuer die oberste Ebene, und
    // ohne diese Zeile verschwand die komplette Hauptgruppe beim Parsen.
    processedText = processedText.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (match, content) => {
        return '\n# ' + ohneMarker(content) + '\n';
    });

    // <h2>Header</h2> → # Header
    processedText = processedText.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (match, content) => {
        return '\n# ' + ohneMarker(content) + '\n';
    });

    // <h3>Subheader</h3> → ## Subheader
    processedText = processedText.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (match, content) => {
        return '\n## ' + ohneMarker(content) + '\n';
    });
    
    // SCHRITT 1.5: Markdown-Header in <p>-Tags erkennen
    // Wenn Nutzer # oder ## direkt in TinyMCE tippt, landen sie in <p>-Tags statt <h2>/<h3>
    // WICHTIG: ## vor # prüfen, damit ## nicht als # mit # im Text gematcht wird
    processedText = processedText.replace(/<p[^>]*>##\s+(.*?)<\/p>/gi, (match, content) => {
        return '\n## ' + content.trim() + '\n';
    });
    processedText = processedText.replace(/<p[^>]*>#\s+(.*?)<\/p>/gi, (match, content) => {
        return '\n# ' + content.trim() + '\n';
    });
    
    // SCHRITT 2: Items mit Symbolen extrahieren (BEHALTE HTML im Text!)
    // <p>! Bugfix: <strong>Server crash</strong> fixed</p> → ! Bugfix: …
    //
    // Nach dem Marker ist ein Doppelpunkt ODER Leerzeichen erlaubt. Vorher
    // verlangte die Regel zwingend ein Leerzeichen, wodurch die verbreitete
    // Schreibweise `!: Text` stillschweigend verworfen wurde – in Changelog 11
    // blieben dadurch vier von fünf Gruppen leer, obwohl der Text dastand.
    // Irgendein Trennzeichen bleibt Pflicht, sonst würde "*wichtig*" als
    // Änderungseintrag gelesen.
    processedText = processedText.replace(/<p[^>]*>([!+\-*])[:\s]\s*(.*?)<\/p>/gi, (match, symbol, content) => {
        return '\n' + symbol + ' ' + content.trim() + '\n';
    });
    
    // Normalen Text (ohne Symbol) als DESCRIPTION-Marker
    // <p>Dies ist eine Beschreibung der Sektion</p> → DESC: Dies ist eine Beschreibung...
    processedText = processedText.replace(/<p[^>]*>((?![!+\-*]\s).*?)<\/p>/gi, (match, content) => {
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

    // Leerzeilen bleiben erhalten — sie tragen Bedeutung.
    //
    // Sie unterscheiden eine Fortsetzung von einem neuen Absatz: Steht eine
    // Zeile ohne Marker DIREKT unter einem Eintrag, gehoert sie zu ihm (ein
    // umgebrochener langer Satz). Steht eine Leerzeile dazwischen, ist es ein
    // freistehender Text, der wie bisher verworfen wird.
    //
    // Vorher wurden Leerzeilen hier weggefiltert. Damit ging diese
    // Unterscheidung verloren — und jede umgebrochene Zeile fiel still heraus,
    // der Eintrag erschien abgeschnitten.
    const lines = processedText.split('\n').map(line => line.trim());
    const result = [];
    let currentGroup = null;
    let currentSubgroup = null;
    // Der zuletzt angelegte Eintrag, an den eine Fortsetzungszeile anschliesst.
    let letzterEintrag = null;

    // Mapping für Item-Typen
    const itemTypeMap = {
        '!': { type: 'fix', icon: 'fa-bug', class: 'danger', category: 'Fixes' },
        '+': { type: 'feature', icon: 'fa-plus', class: 'success', category: 'Features' },
        '-': { type: 'removed', icon: 'fa-minus', class: 'warning', category: 'Removed' },
        '*': { type: 'change', icon: 'fa-edit', class: 'info', category: 'Changes' }
    };

    for (const line of lines) {
        // Leerzeile beendet den laufenden Eintrag: Was danach kommt, ist keine
        // Fortsetzung mehr.
        if (line.length === 0) {
            letzterEintrag = null;
            continue;
        }

        // # Header erkennen (Hauptgruppe)
        if (line.startsWith('# ')) {
            letzterEintrag = null;
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
            letzterEintrag = null;
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
            letzterEintrag = null;
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
                        // Erfunden, nicht vom Autor geschrieben: Eintraege muessen
                        // in einer Untergruppe liegen, also braucht es eine, wenn
                        // direkt unter "# Gruppe" schon Eintraege stehen. Die
                        // Anzeige laesst die Ueberschrift deshalb weg - sonst
                        // stuende ueberall ein "Allgemein", das niemand getippt hat.
                        synthetic: true,
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
            // Ein führender Doppelpunkt gehört zum Marker, nicht zum Text:
            // Wer `!: Fehler behoben` schreibt, meint nicht ": Fehler behoben".
            const text = line.substring(1).replace(/^\s*:\s*/, '').trim();

            const item = {
                type: itemMeta.type,
                icon: itemMeta.icon,
                class: itemMeta.class,
                category: itemMeta.category,
                text  // Text MIT HTML!
            };
            letzterEintrag = item;

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
                        // Erfunden, nicht vom Autor geschrieben: Eintraege muessen
                        // in einer Untergruppe liegen, also braucht es eine, wenn
                        // direkt unter "# Gruppe" schon Eintraege stehen. Die
                        // Anzeige laesst die Ueberschrift deshalb weg - sonst
                        // stuende ueberall ein "Allgemein", das niemand getippt hat.
                        synthetic: true,
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
                    synthetic: true,
                    level: 2,
                    items: []
                };
                currentGroup.children.push(currentSubgroup);
                result.push(currentGroup);
                currentSubgroup.items.push(item);
            }
        }
        // Zeile ohne erkannten Marker: Fortsetzung des Eintrags darueber.
        //
        // Der Text wird zeilenweise gelesen, ein Eintrag ist also eine Zeile.
        // Wer einen langen Satz umbricht — beim Schreiben naheliegend —, verlor
        // vorher alles nach dem Umbruch, ohne Hinweis. Jetzt wird angehaengt.
        //
        // Nur direkt unter einem Eintrag: Nach einer Leerzeile oder einer
        // Ueberschrift ist letzterEintrag null, und die Zeile wird wie bisher
        // verworfen. So bleiben freistehende Absaetze aus alten Changelogs
        // unveraendert draussen.
        else if (letzterEintrag) {
            letzterEintrag.text = (letzterEintrag.text + ' ' + line).trim();
        }
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
    hierarchicalChangelogToMarkdown,
    zuTextauszug
};

module.exports = ChangelogHelper;
