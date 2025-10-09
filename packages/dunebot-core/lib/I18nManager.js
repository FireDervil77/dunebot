const { readdirSync, readFileSync, existsSync } = require("fs");
const { join, resolve } = require("path");
const i18next = require("i18next");
const deepmerge = require("deepmerge");
const flat = require("flat");

const ServiceManager = require("./ServiceManager");

/**
 * Verwaltet die Internationalisierung und Mehrsprachigkeit für Dunebot
 * Lädt, synchronisiert und verwaltet Übersetzungen zwischen Dateisystem und Datenbank
 * @author FireDervil
 */
class I18nManager {

    /**
     * Erstellt eine neue Instanz des I18nManagers
     * @param {string} app - Die Anwendung ("bot" oder "dashboard")
     * @param {Object} options - Konfigurationsoptionen
     * @param {string} [options.fallbackLng="de-DE"] - Fallback-Sprache
     * @param {string} options.baseDir - Basisverzeichnis für Übersetzungsdateien
     * @param {string} options.pluginsDir - Verzeichnis der Plugins
     * @param {boolean} [options.useDatabase=false] - Ob Datenbank für Übersetzungen verwendet werden soll
     * @param {Object} options.logger - Logger-Instanz
     */
    constructor(app, options = {}) {
        this.app = app;
        this.translations = new Map();
        this.i18next = i18next; // i18next-Instanz für dynamischen Sprachwechsel exportieren
        this.languagesMeta = require(join(__dirname, "../languages-meta.json"));
        this.availableLanguages = this.languagesMeta.map((lng) => lng.name);
        this.fallbackLng = options.fallbackLng || "de-DE";
        this.baseDir = options.baseDir;
        this.pluginsDir = resolve(options.pluginsDir);
        this.useDatabase = options.useDatabase || false;
        this.logger = null;
    }

    /**
     * Initialisiert den I18nManager und lädt alle Übersetzungen
     * @returns {Map<string, Function>} - Map mit Übersetzungsfunktionen für alle Sprachen
     * @throws {Error} Wenn die Initialisierung fehlschlägt
     * @author FireDervil
     */
    async initialize() {
        const dbService = ServiceManager.get("dbService");
        const Logger = ServiceManager.get("Logger");
        this.logger = Logger;
        
        try {
            this.logger.info(`[I18n] Initialisiere I18nManager für ${this.availableLanguages.length} Sprachen`);
            
            await i18next.init({
                debug: false, 
                fallbackLng: this.fallbackLng,
                initImmediate: false,
                interpolation: { escapeValue: false },
                load: "all",
                preload: this.availableLanguages,
            });

            // Für jede Sprache eine Übersetzungsfunktion registrieren
            for (const lng of this.availableLanguages) {
                const t = i18next.getFixedT(lng);
                if (typeof t !== 'function') {
                    this.logger.error(`[I18n] Fehler beim Abrufen der Übersetzungsfunktion für ${lng}`);
                    continue;
                }
                this.translations.set(lng, t);
                this.logger.debug(`[I18n] Übersetzungen für ${lng} registriert`);
            }

            // Datenbankmodell für Übersetzungen einrichten
           if (this.useDatabase) {
                if (!dbService) {
                    this.logger.error(`[I18n] Fehler: dbService ist nicht über den ServiceManager vorhanden`);
                    return this.translations;
                }
                
                this.logger.debug(`[I18n] DBService für Lokalisierungsdaten verfügbar`);
            }

            // Basis-Verzeichnis durchsuchen und Übersetzungen laden
            if (this.baseDir) {
                this.logger.debug(`[I18n] Durchsuche Basis-Verzeichnis: ${this.baseDir}`);
                this.walkBaseDirectory(this.baseDir);
                
                // Basis-Übersetzungen mit DB synchronisieren
                if (this.useDatabase) {
                    await this.loadAndSyncTranslations("translation");
                }
            }

            // Plugins-Verzeichnis durchsuchen und Übersetzungen laden
            if (this.pluginsDir && existsSync(this.pluginsDir)) {
                this.logger.debug(`[I18n] Durchsuche Plugins-Verzeichnis: ${this.pluginsDir}`);
                const plugins = readdirSync(this.pluginsDir, { withFileTypes: true })
                    .filter(dirent => dirent.isDirectory())
                    .map(dirent => dirent.name);
                    
                for (const plugin of plugins) {
                    this.loadPluginTranslations(plugin);
                    
                    // Plugin-Übersetzungen mit DB synchronisieren
                    if (this.useDatabase) {
                        await this.loadAndSyncTranslations(plugin);
                    }
                }
            }

            this.logger.success(`[I18n] I18nManager erfolgreich initialisiert`);
            return this.translations;
        } catch (error) {
            this.logger.error(`[I18n] Fehler bei der Initialisierung des I18nManager:`, error);
            throw error;
        }
    }

    /**
     * Unified method to load and sync translations with database
     * Works for both base translations ("translation" namespace) and plugin translations
     * @param {string} namespace - "translation" for base or plugin name for plugins
     * @returns {Promise<boolean>} - Whether the operation was successful
     */
    async loadAndSyncTranslations(namespace) {
        try {
            if (!this.useDatabase) {
                return true;
            }
            const localTranslations = {};

            // Debug-Ausgabe zum Verfolgen der Methodenausführung
            this.logger.debug(`[I18n] Synchronisiere Übersetzungen für Namespace '${namespace}'`);

            for (const lang of this.availableLanguages) {
                const resources = i18next.getResourceBundle(lang, namespace);
                if (resources) {
                    if (!localTranslations[lang]) localTranslations[lang] = {};
                    localTranslations[lang][namespace] = resources;
                    this.logger.debug(`[I18n] Gefunden: ${Object.keys(resources).length} Schlüssel für ${lang} in ${namespace}`);
                } else {
                    this.logger.debug(`[I18n] Keine Übersetzungen für ${lang} in ${namespace} gefunden`);
                }
            }

            let dbLocalizations = [];
            try {
                const dbService = ServiceManager.get("dbService");
                dbLocalizations = await dbService.query(
                    "SELECT * FROM localizations WHERE app = ? AND plugin = ?", 
                    [this.app, namespace]
                );
                this.logger.debug(`[I18n] ${dbLocalizations.length} bestehende DB-Einträge für ${namespace} gefunden`);
            } catch (dbError) {
                this.logger.error(`[I18n] Fehler beim Abfragen von DB-Übersetzungen:`, dbError);
                return false;
            }

            const dbTranslationsMap = new Map(
                dbLocalizations.map((loc) => [`${loc.lang}:${loc.plugin}`, loc]),
            );

            const updates = [];
            const inserts = [];

            for (const [lang, namespaces] of Object.entries(localTranslations)) {
                const localData = namespaces[namespace];
                const key = `${lang}:${namespace}`;
                const dbEntry = dbTranslationsMap.get(key);

                if (!dbEntry) {
                    this.logger.debug(`[I18n] Neuer Eintrag für ${lang} in ${namespace}`);
                    // Eintrag existiert nicht in der DB, insert
                    inserts.push({
                        app: this.app,
                        plugin: namespace,
                        lang,
                        data: localData,
                        lastModified: new Date()
                    });
                } else {
                    // Überprüfen, ob sich die Daten geändert haben
                    const localDataStr = JSON.stringify(localData);
                    const dbDataStr = JSON.stringify(dbEntry.data);
                    
                    if (localDataStr !== dbDataStr) {
                        this.logger.debug(`[I18n] Update für ${lang} in ${namespace}`);
                        // Daten haben sich geändert, update     
                        updates.push({
                            id: dbEntry.id,
                            data: localData,
                            lastModified: new Date()
                        });
                    
                    }
                }
            }

            // Tatsächliche Inserts und Updates durchführen
            if (inserts.length > 0) {
                try {
                    const dbService = ServiceManager.get("dbService");
                    for (const insert of inserts) {
                        await dbService.query(`
                            INSERT INTO localizations (app, plugin, lang, data, lastModified)
                            VALUES (?, ?, ?, ?, ?)
                        `, [
                            insert.app,
                            insert.plugin,
                            insert.lang,
                            JSON.stringify(insert.data),
                            insert.lastModified
                        ]);
                    }
                    this.logger.info(`[I18n] ${inserts.length} neue Übersetzungseinträge für ${namespace} erstellt`);
                } catch (insertError) {
                    this.logger.error(`[I18n] Fehler beim Einfügen von Übersetzungen:`, insertError);
                }
            }

            for (const update of updates) {
                try {
                    const dbService = ServiceManager.get("dbService");
                    await dbService.query(`
                        UPDATE localizations 
                        SET data = ?, lastModified = ?
                        WHERE id = ?
                    `, [
                        JSON.stringify(update.data),
                        update.lastModified,
                        update.id
                    ]);
                } catch (updateError) {
                    this.logger.error(`[I18n] Fehler beim Aktualisieren von Übersetzungen:`, updateError);
                }
            }
            
            this.logger.info(`[I18n] ${updates.length} Übersetzungseinträge für ${namespace} aktualisiert`);

            return true;
        } catch (error) {
            this.logger.error(`[I18n] Fehler beim Laden/Synchronisieren von Übersetzungen für ${namespace}:`, error);
            return false;
        }
    }

    /**
     * Durchsucht das Basisverzeichnis nach Übersetzungsdateien und lädt diese
     * @param {string} baseDir - Das Basisverzeichnis für Übersetzungen
     * @throws {Error} Wenn das Durchsuchen oder Laden fehlschlägt
     * @author FireDervil
     */
    walkBaseDirectory(baseDir) {
        try {
            const locales = readdirSync(baseDir).filter((file) => file.endsWith(".json"));

            locales.forEach((lngFile) => {
                const lng = lngFile.split(".")[0];

                if (!this.availableLanguages.includes(lng)) {
                    console.warn(`Invalid language file: ${lngFile}`);
                    return;
                }

                const translationFilePath = join(baseDir, lngFile);
                const translationData = JSON.parse(readFileSync(translationFilePath, "utf8"));
                i18next.addResourceBundle(lng, "translation", translationData);
            });
        } catch (error) {
            throw new Error(`Failed to walk base directory: ${error.message}`);
        }
    }

    /**
     * Lädt die Übersetzungen für ein Plugin
     * @param {string} pluginDirName - Name des Plugin-Verzeichnisses
     * @returns {Promise<boolean>} - true wenn erfolgreich, false wenn keine Übersetzungen vorhanden
     * @throws {Error} Wenn das Laden der Plugin-Übersetzungen fehlschlägt
     * @author FireDervil
     */
    async loadPluginTranslations(pluginDirName) {
        try {
            if (!this.pluginsDir) {
                throw new Error("No plugins directory configured");
            }

            const packageJsonPath = join(this.pluginsDir, pluginDirName, "package.json");
            const packageJson = require(packageJsonPath);
            const pluginName = packageJson.name;
            const entry = this.app === "bot" ? "bot" : "dashboard";

            const pluginDir = join(this.pluginsDir, pluginDirName, `${entry}/locales`);
            if (!existsSync(pluginDir)) {
                return false;
            }

            const locales = readdirSync(pluginDir);
            locales.forEach((lngFile) => {
                const lng = lngFile.split(".")[0];

                if (!this.availableLanguages.includes(lng)) {
                    console.warn(`Invalid language file: ${lngFile}`);
                    return;
                }

                const translationFilePath = join(pluginDir, lngFile);
                try {
                    const translationData = JSON.parse(readFileSync(translationFilePath, "utf8"));
                    i18next.addResourceBundle(lng, pluginName, translationData);
                } catch (jsonError) {
                    throw new Error(`JSON parse error in ${translationFilePath}: ${jsonError.message}`);
                }
            });

            await this.loadAndSyncTranslations(pluginName);
        } catch (error) {
            throw new Error(`Failed to load plugin translations: ${error.message}`);
        }
    }

    /**
     * Entfernt alle Übersetzungen eines Plugins
     * @param {string} pluginName - Name des Plugins
     * @returns {boolean} - true wenn erfolgreich
     * @throws {Error} Wenn das Entfernen fehlschlägt
     * @author FireDervil
     */
    removePluginTranslations(pluginName) {
        try {
            for (const lang of this.availableLanguages) {
                i18next.removeResourceBundle(lang, pluginName);
            }
            return true;
        } catch (error) {
            throw new Error(`Failed to remove plugin translations: ${error.message}`);
        }
    }

    /**
     * Übersetzt einen Schlüssel in die angegebene Sprache
     * @param {string} key - Der zu übersetzende Schlüssel
     * @param {Object|string} optionsOrLanguage - Übersetzungsoptionen oder Zielsprache
     * @param {string} [language] - Zielsprache (wenn optionsOrLanguage Optionen sind)
     * @returns {string} Die übersetzte Zeichenfolge
     * @throws {Error} Wenn die Sprache nicht verfügbar ist
     * @author FireDervil
     */
    tr(key, optionsOrLanguage, language) {
        const targetLanguage =
            typeof optionsOrLanguage === "string"
                ? optionsOrLanguage
                : language || this.fallbackLng;
        const options = typeof optionsOrLanguage === "object" ? optionsOrLanguage : undefined;
        const translationFn = this.translations.get(targetLanguage);

        if (!translationFn) {
            throw new Error(`Language ${targetLanguage} not found`);
        }

        return translationFn(key, options);
    }

    /**
     * Gibt Übersetzungen für einen Schlüssel in allen verfügbaren Sprachen zurück
     * @param {string} key - Der zu übersetzende Schlüssel
     * @returns {Object} Objekt mit Übersetzungen für alle Sprachen
     * @author FireDervil
     */
    getAllTr(key) {
        const localizations = {};
        for (const language of this.translations.keys()) {
            const dKey =
                this.languagesMeta.find(
                    (lng) => lng.name === language || lng.aliases.includes(language),
                )?.discord || language;
            localizations[dKey] = this.tr(key, language);
        }
        return localizations;
    }

    /**
     * Gibt das Ressourcenbündel für eine Sprache und ein Plugin zurück
     * @param {string} language - Die Sprache
     * @param {string} plugin - Der Plugin-Name
     * @param {boolean} [flatten=false] - Ob die Struktur flach sein soll
     * @returns {Object} Das Ressourcenbündel
     * @author FireDervil
     */
    getResourceBundle(language, plugin, flatten = false) {
        const bundle = i18next.getResourceBundle(language, plugin) || {};
        return flatten ? flat.flatten(bundle) : bundle;
    }

    /**
     * Aktualisiert ein Ressourcenbündel für ein Plugin in einer bestimmten Sprache
     * @param {string} plugin - Der Plugin-Name
     * @param {string} language - Die Sprache
     * @param {Object} data - Die neuen Übersetzungsdaten
     * @throws {Error} Wenn die Aktualisierung fehlschlägt
     * @author FireDervil
     */
    async updateResourceBundle(plugin, language, data) {
        try {
            const currentBundle = i18next.getResourceBundle(language, plugin) || {};
            const unflattenedData = flat.unflatten(data);

            if (JSON.stringify(currentBundle) !== JSON.stringify(unflattenedData)) {
                if (this.useDatabase) {
                    const dbService = ServiceManager.get("dbService");
                    // Prüfen, ob Eintrag existiert
                    const [existing] = await dbService.query(
                        "SELECT id FROM localizations WHERE app = ? AND plugin = ? AND lang = ?",
                        [this.app, plugin, language]
                    );
                    
                    if (existing) {
                        // Update
                        await dbService.query(`
                            UPDATE localizations 
                            SET data = ?, lastModified = NOW() 
                            WHERE id = ?
                        `, [
                            JSON.stringify(unflattenedData), 
                            existing.id
                        ]);
                    } else {
                        // Insert
                        await dbService.query(`
                            INSERT INTO localizations (app, plugin, lang, data, lastModified)
                            VALUES (?, ?, ?, ?, NOW())
                        `, [
                            this.app,
                            plugin,
                            language,
                            JSON.stringify(unflattenedData)
                        ]);
                    }
                }
                i18next.addResourceBundle(language, plugin, unflattenedData, true, true);
            }
        } catch (error) {
            throw new Error(`Failed to update resource bundle: ${error.message}`);
        }
    }
}

module.exports = I18nManager;