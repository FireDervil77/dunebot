const fs = require('fs');
const path = require('path');
const { Logger } = require('dunebot-sdk/utils');

const KEYWORD_DIR = path.join(__dirname, 'data', 'keyword_lists');

// Cache: Map<string, { id, name, language, description, keywords[] }>
let keywordListsCache = null;

/**
 * Lädt alle Keyword-Listen aus dem data/keyword_lists Verzeichnis
 * Ergebnisse werden gecacht (einmaliges Laden beim Start)
 * 
 * @returns {Map<string, Object>} Map von list-id -> list-Objekt
 */
function loadKeywordLists() {
    if (keywordListsCache) return keywordListsCache;

    keywordListsCache = new Map();

    try {
        if (!fs.existsSync(KEYWORD_DIR)) {
            Logger.warn('[AutoMod] Keyword-Listen Verzeichnis nicht gefunden:', KEYWORD_DIR);
            return keywordListsCache;
        }

        const files = fs.readdirSync(KEYWORD_DIR).filter(f => f.endsWith('.json'));

        for (const file of files) {
            try {
                const filePath = path.join(KEYWORD_DIR, file);
                const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

                if (data.id && Array.isArray(data.keywords)) {
                    keywordListsCache.set(data.id, data);
                    Logger.debug(`[AutoMod] Keyword-Liste geladen: ${data.id} (${data.keywords.length} Einträge)`);
                }
            } catch (err) {
                Logger.warn(`[AutoMod] Fehler beim Laden der Keyword-Liste ${file}:`, err.message);
            }
        }

        Logger.info(`[AutoMod] ${keywordListsCache.size} Keyword-Listen geladen`);
    } catch (err) {
        Logger.error('[AutoMod] Fehler beim Laden der Keyword-Listen:', err);
    }

    return keywordListsCache;
}

/**
 * Gibt alle verfügbaren Keyword-Listen als Array zurück
 * Für Dashboard-Anzeige (ohne die eigentlichen Keywords)
 * 
 * @returns {Array<{ id, name, language, description, count }>}
 */
function getAvailableKeywordLists() {
    const lists = loadKeywordLists();
    return Array.from(lists.values()).map(list => ({
        id: list.id,
        name: list.name,
        language: list.language,
        description: list.description,
        count: list.keywords.length
    }));
}

/**
 * Cache invalidieren (z.B. nach Hot-Reload)
 */
function clearKeywordCache() {
    keywordListsCache = null;
}

module.exports = {
    loadKeywordLists,
    getAvailableKeywordLists,
    clearKeywordCache
};
