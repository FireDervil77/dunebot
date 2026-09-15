const fs = require("fs");
const fsPromises = require("fs").promises;
const os = require("os");
const crypto = require("crypto");

const path = require("path");
const simpleGit = require("simple-git");
const lockfile = require("proper-lockfile");
const execa = require("execa");

const ServiceManager = require("./ServiceManager");
const PluginHooks = require("./PluginHooks"); 




class BasePluginManager {
    #pluginMap = new Map();
    #repoCache = new Map();

    /**
     * Erstellt eine neue Instanz des BasePluginManager
     * @param {string} pluginsDir - Verzeichnis der Plugins
     * @param {Object} logger - Logger-Instanz
     * @author FireDervil
     */
    constructor(pluginsDir, logger) {
        this.logger = logger;

        this.pluginsDir = path.resolve(pluginsDir);
        this.pluginsLockDir = path.join(this.pluginsDir, ".locks");
        this.hooks = new PluginHooks(logger);
    }

    /**
     * Gibt die Plugin-Hooks zurück
     * @returns {PluginHooks} Die PluginHooks-Instanz
     * @author FireDervil
     */
    getHooks() {
        return this.hooks;
    }


    // ==============================
    // Public Plugin State Management
    // ==============================

    get plugins() {
        return Array.from(this.#pluginMap.values()).filter((p) => p !== undefined && p !== null);
    }

    get availablePlugins() {
        return Array.from(this.#pluginMap.keys());
    }

    isPluginEnabled(pluginName) {
        return this.#pluginMap.has(pluginName);
    }

    getPlugin(pluginName) {
        return this.#pluginMap.get(pluginName);
    }

    setPlugin(pluginName, plugin) {
        this.#pluginMap.set(pluginName, plugin);
    }

    removePlugin(pluginName) {
        this.#pluginMap.delete(pluginName);
    }

    // ==============================
    // Plugin Lifecycle Management
    // ==============================

    /**
     * Laedt den Kern (`core`). Die uebrigen Plugins schalten Dashboard und Bot selbst ein, aus `guild_plugins`.
     * @returns {Promise<Array>} Liste der geladenen Plugins
     * @throws {Error} Bei Fehlern während der Initialisierung
     * @author FireDervil
     */
    async init() {
        const dbService = ServiceManager.get("dbService");

        try {
            // "before_init" Hook ausführen
            await this.hooks.doAction('before_init');
            
            if (!dbService) {
                throw new Error("dbService not in ServiceManager. Call ServiceManager.get(SERVICE) first.");
            }

            // "before_plugin_discovery" Hook ausführen
            await this.hooks.doAction('before_plugin_discovery');
            
            const plugins = await this.getPluginsMeta();
            
            // Plugin-Liste durch Filter laufen lassen
            const filteredPlugins = await this.hooks.applyFilter('plugin_meta_list', plugins);
            
            const corePlugin = filteredPlugins.find((p) => p.name === "core");
            if (!corePlugin) {
                throw new Error("Core plugin not found in plugins directory.");
            }

            // "before_core_plugin_enable" Hook ausführen
            await this.hooks.doAction('before_core_plugin_enable');

            // Initialize core plugin first
            if (!corePlugin.installed) {
                await this.installPlugin("core");
            }

            await this.enablePlugin("core");
            
            // "after_core_plugin_enable" Hook ausführen
            await this.hooks.doAction('after_core_plugin_enable', this.getPlugin("core"));

            // Hier stand bis zum 2026-09-15 eine zweite Einschaltrunde: Sie las
            // `ENABLED_PLUGINS` aus `configs`, pruefte `pluginDependencies`,
            // nahm Plugins mit abgeschalteter Abhaengigkeit aus der Liste und
            // schrieb sie zurueck nach `configs`. Eingeschaltet wird seit dem
            // Umbau auf `guild_plugins` woanders (Dashboard: `loadPlugins` in
            // app.js, Bot: eigenes `init`). Die Liste gab es nicht mehr, die
            // Runde lief ueber null Plugins - und waere mit der ersten
            // `configs`-Zeile aufgewacht und haette Plugins in der Produktion
            // abgeschaltet. Beziehungen zwischen Plugins blockieren nicht
            // (Betreiber, 2026-09-15; docs/plugin-beziehungen.md).
            
            this.logger.success(`Loaded ${this.availablePlugins.length} plugins.`);
            
            // "after_init" Hook ausführen
            await this.hooks.doAction('after_init', this.plugins);
            
            return this.plugins;
        } catch (error) {
            // "init_failed" Hook ausführen
            await this.hooks.doAction('init_failed', error);
            throw error;
        }
    }


    /**
     * Registriert alle Tabellen für ein Plugin (explizit und aus Verzeichnissen)
     * @param {Object} plugin - Das Plugin-Objekt
     * @param {string} context - Kontext (dashboard/bot)
     * @returns {Promise<void>}
     * @author FireDervil
     */
    async registerPluginTables(plugin, context) {

        try {
            // 1. Explizit definierte Models im Plugin-Objekt
            if (plugin.models) {
                await this.registerExplicitModels(plugin, plugin.models);
            }
            
            const pluginBaseDir = path.join(this.pluginsDir, plugin.name);
            
            // 2. Kontext-spezifische Models
            const contextModelsDir = path.join(pluginBaseDir, context, 'models');
            if (fs.existsSync(contextModelsDir)) {
                await this.registerModelsFromDir(plugin, contextModelsDir, context);
            }
            
            // 3. Root-Models (gemeinsam genutzte Models)
            const rootModelsDir = path.join(pluginBaseDir, 'models');
            if (fs.existsSync(rootModelsDir)) {
                await this.registerModelsFromDir(plugin, rootModelsDir, 'shared');
            }
        } catch (error) {
            this.logger.error(`Failed to register Models for ${plugin.name}:`, error);
        }
    }


     /**
     * Registriert explizit definierte Models im Plugin-Objekt
     * @param {Object} plugin - Das Plugin-Objekt
     * @param {Object} models - Die Models-Definitionen
     * @returns {Promise<void>}
     * @author FireDervil
     */
    async registerExplicitModels(plugin, models) {
        const dbService = ServiceManager.get("dbService");
        const Logger = ServiceManager.get('Logger');

        for (const [modelName, modelFn] of Object.entries(models)) {
            try {
                // Da wir keine Sequelize mehr verwenden, wird nur eine Debug-Info ausgegeben
                // Sequelize-Modelle werden nicht mehr registriert
                Logger.debug(`Registriere Model ${modelName} für Plugin ${plugin.name} (SQL-Modus)`);
                
                // Optional: Wenn modelFn ein SQL-Schema enthält, könnte es hier ausgeführt werden
                if (typeof modelFn === 'string' && modelFn.trim().toLowerCase().startsWith('create table')) {
                    await dbService.query(modelFn);
                    Logger.debug(`SQL-Schema für ${modelName} erfolgreich ausgeführt`);
                }
            } catch (error) {
                Logger.error(`Fehler beim Registrieren des Models ${modelName} für ${plugin.name}:`, error);
            }
        }
    }

    /**
     * Lädt und registriert Models aus einem Verzeichnis
     * @param {Object} plugin - Das Plugin-Objekt
     * @param {string} dirPath - Pfad zum Models-Verzeichnis
     * @param {string} context - Kontext (dashboard/bot/shared)
     * @returns {Promise<void>}
     * @author FireDervil
     */
    async registerModelsFromDir(plugin, dirPath, context) {
        const dbService = ServiceManager.get("dbService");
        const Logger = ServiceManager.get('Logger');
        
        Logger.debug(`Suche nach ${context} Models in ${dirPath}`);

        try {
            // Nach JS-Dateien UND SQL-Dateien suchen
            const modelFiles = fs.readdirSync(dirPath)
                .filter(file => file.endsWith('.js') || file.endsWith('.sql'));
                
            for (const file of modelFiles) {
                const modelName = path.basename(file, path.extname(file));
                
                try {
                    if (file.endsWith('.sql')) {
                        // SQL-Datei direkt ausführen
                        const sqlContent = await fsPromises.readFile(path.join(dirPath, file), 'utf8');
                        await dbService.query(sqlContent);
                        Logger.debug(`SQL-Schema ${modelName} für Plugin ${plugin.name} (${context}) ausgeführt`);
                    } else {
                        // JS-Dateien könnten SQL-Strings oder Schema-Definitionen enthalten
                        const modelModule = require(path.join(dirPath, file));
                        
                        if (typeof modelModule === 'string' && modelModule.trim().toLowerCase().startsWith('create table')) {
                            // Wenn es ein SQL-String ist
                            await dbService.query(modelModule);
                            Logger.debug(`SQL-Schema ${modelName} aus JS-Modul für Plugin ${plugin.name} (${context}) ausgeführt`);
                        } else if (modelModule.schema && typeof modelModule.schema === 'string') {
                            // Falls das Schema in einem .schema Property definiert ist
                            await dbService.query(modelModule.schema);
                            Logger.debug(`SQL-Schema ${modelName} aus .schema Property für Plugin ${plugin.name} (${context}) ausgeführt`);
                            
                            // Trigger separat ausführen (falls vorhanden)
                            if (modelModule.trigger && typeof modelModule.trigger === 'string') {
                                try {
                                    // Trigger-SQL in einzelne Statements aufteilen (DROP und CREATE)
                                    const triggerStatements = modelModule.trigger
                                        .split(';')
                                        .map(s => s.trim())
                                        .filter(s => s.length > 0);
                                    
                                    for (const statement of triggerStatements) {
                                        await dbService.query(statement);
                                    }
                                    
                                    Logger.debug(`Trigger für ${modelName} (Plugin ${plugin.name}) erfolgreich erstellt`);
                                } catch (triggerError) {
                                    Logger.warn(`Trigger für ${modelName} konnte nicht erstellt werden:`, triggerError.message);
                                }
                            }
                        } else {
                            // Bei alten Formaten Warnung ausgeben
                            Logger.warn(`Model ${modelName} in ${plugin.name}/${context} hat kein gültiges SQL-Schema und wird übersprungen`);
                        }
                    }
                } catch (error) {
                    Logger.error(`Fehler beim Registrieren des Models ${modelName} aus ${dirPath}/${file}:`, error);
                }
            }
        } catch (error) {
            Logger.error(`Fehler beim Lesen des Verzeichnisses ${dirPath}:`, error);
        }
    }
    
    // ==============================
    // Abstract methods to be implemented by derived classes
    // ==============================
    /**
     * Aktiviert ein Plugin
     * @param {string} pluginName - Name des Plugins
     * @throws {Error} Muss von abgeleiteter Klasse implementiert werden
     * @author FireDervil
     */
    async enablePlugin(pluginName) {
        throw new Error("Not implemented");
    }

    /**
     * Deaktiviert ein Plugin
     * @param {string} pluginName - Name des Plugins
     * @throws {Error} Muss von abgeleiteter Klasse implementiert werden
     * @author FireDervil
     */
    async disablePlugin(pluginName) {
        throw new Error("Not implemented");
    }

    /**
     * Aktiviert ein Plugin in einer Guild
     * @param {string} pluginName - Name des Plugins
     * @param {string} guildId - Guild-ID
     * @throws {Error} Muss von abgeleiteter Klasse implementiert werden
     * @author FireDervil
     */
    async enableInGuild(pluginName, guildId) {
        throw new Error("Not implemented");
    }

    /**
     * Deaktiviert ein Plugin in einer Guild
     * @param {string} pluginName - Name des Plugins
     * @param {string} guildId - Guild-ID
     * @throws {Error} Muss von abgeleiteter Klasse implementiert werden
     * @author FireDervil
     */
    async disableInGuild(pluginName, guildId) {
        throw new Error("Not implemented");
    }

    // ==============================
    // Plugin Installation Management
    // ==============================

    /**
     * Lädt das Plugin-Modul aus dem Dateisystem
     * @param {string} pluginName - Name des Plugins
     * @returns {Promise<Object>} Das geladene Plugin-Modul
     * @throws {Error} Bei Fehlern beim Laden
     * @author FireDervil
     */
    async loadPluginModule(pluginName) {
        try {
            const pluginPath = path.join(this.pluginsDir, pluginName);
            const pluginModule = require(pluginPath);
            
            // Prüfe ob das Plugin für die aktuelle Kontext (bot/dashboard) eine Implementierung hat
            if (this.context === 'bot' && pluginModule.bot) {
            return pluginModule.bot;
            } else if (this.context === 'dashboard' && pluginModule.dashboard) {
            return pluginModule.dashboard;
            } else {
            // Wenn das Plugin als einzelne Klasse implementiert ist (alte Struktur)
            return pluginModule;
            }
        } catch (error) {
            this.logger.error(`Failed to load plugin module ${pluginName}:`, error);
            throw error;
        }
    }

    /**
     * Liest die Plugin-Metadaten aus Registry und Dateisystem
     * @returns {Promise<Array>} Liste der Plugin-Metadaten
     * @throws {Error} Bei Fehlern beim Lesen
     * @author FireDervil
     */
    /**
     * Scannt das plugins-Verzeichnis und liest Metadaten aus package.json.
     * Kein registry.json mehr — package.json ist Single Source of Truth.
     */
    async getPluginsMeta() {
        try {
            const entries = await fsPromises.readdir(this.pluginsDir, { withFileTypes: true });
            const pluginDirs = entries
                .filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
                .map(e => e.name);

            const pluginsMeta = await Promise.all(
                pluginDirs.map(async (dirName) => {
                    const packageJsonPath = path.join(this.pluginsDir, dirName, 'package.json');
                    let pkg = {};
                    try {
                        const data = await fsPromises.readFile(packageJsonPath, 'utf8');
                        pkg = JSON.parse(data);
                    } catch {
                        this.logger.warn(`[PluginManager] Kein package.json for plugin dir: ${dirName}`);
                    }

                    const name = pkg.name || dirName;
                    const version = pkg.version || '0.0.0';
                    const currentVersion = this.#pluginMap.get(name)?.version || version;

                    return {
                        name,
                        version,
                        currentVersion,
                        author: typeof pkg.author === 'string' ? pkg.author : (pkg.author?.name || 'Unknown'),
                        repository: pkg.repository || '',
                        // Plugin-zu-Plugin Abhängigkeiten über pluginDependencies in package.json
                        dependencies: pkg.pluginDependencies || [],
                        installed: true,
                        enabled: this.isPluginEnabled(name),
                        hasUpdate: false,
                    };
                }),
            );

            return pluginsMeta;
        } catch (error) {
            this.logger.error('Failed to get plugins:', error);
            throw error;
        }
    }

    /**
     * Installiert ein Plugin aus dem Repository
     * @param {string} pluginName - Name des Plugins
     * @returns {Promise<void>}
     * @throws {Error} Bei Fehlern während der Installation
     * @author FireDervil
     */
    async installPlugin(pluginName) {
        const pluginDir = path.join(this.pluginsDir, pluginName);
        const lockPath = pluginDir + ".lock";

        let release;
        try {
            release = await lockfile.lock(lockPath, {
                retries: {
                    retries: 60,
                    factor: 1,
                    minTimeout: 1000,
                    maxTimeout: 5000,
                },
                realpath: false,
            });

            if (await fsPromises.access(pluginDir).catch(() => false)) {
                Logger.debug(`Plugin ${pluginName} is already installed. Skipping installation.`);
                return;
            }

            // Plugin-Metadata aus package.json lesen (falls schon teilweise vorhanden)
            // oder aus repository klonen wenn package.json fehlt
            const allMeta = await this.getPluginsMeta();
            const meta = allMeta.find((p) => p.name === pluginName);

            if (!meta?.repository) {
                throw new Error(`Plugin "${pluginName}" hat keine repository URL in package.json.`);
            }

            // Check pluginDependencies
            const missingDeps = (meta.dependencies || []).filter(dep => !this.#pluginMap.has(dep));
            if (missingDeps.length > 0) {
                throw new Error(
                    `Missing dependencies for ${pluginName}: ${missingDeps.join(", ")}. Please install them first.`,
                );
            }

            // Repository klonen und Plugin-Verzeichnis kopieren
            const repoDir = await this.#cloneOrUpdateRepo(meta.repository);
            // repositoryPath kann in package.json als "repositoryPath" definiert sein
            const repoSubPath = meta.repositoryPath || '';
            const sourcePath = repoSubPath ? path.join(repoDir, repoSubPath) : repoDir;
            const targetPath = path.join(this.pluginsDir, pluginName);

            await fsPromises.rm(targetPath, { recursive: true, force: true }).catch(() => {});
            await fsPromises.cp(sourcePath, targetPath, { recursive: true });

            // Install npm dependencies
            try {
                const packageJson = require(path.join(targetPath, 'package.json'));
                const dependencies = Object.keys(packageJson.dependencies || {});
                
                if (dependencies.length > 0) {
                    await execa(
                        "npm",
                        ["install", "--save", ...dependencies],
                        {
                            cwd: targetPath,
                            stdio: "pipe"
                        }
                    );
                }
            } catch (error) {
                this.logger.error(`Failed to install dependencies for ${pluginName}:`, error);
                await fsPromises.rm(targetPath, { recursive: true, force: true }).catch(() => {});
                throw error;
            }
        } finally {
            if (release) await release();
        }

        this.logger.success(`Installed plugin: ${pluginName}`);
    }

    /**
     * Deinstalliert ein Plugin
     * @param {string} pluginName - Name des Plugins
     * @returns {Promise<void>}
     * @throws {Error} Bei Fehlern während der Deinstallation
     * @author FireDervil
     */
    async uninstallPlugin(pluginName) {
        const pluginDir = path.join(this.pluginsDir, pluginName);
        // Create an empty file for locking if it doesn't exist
        await fsPromises.writeFile(pluginDir + ".lock", "", { flag: "a" });

        let release;
        try {
            release = await lockfile.lock(pluginDir + ".lock", {
                retries: {
                    retries: 60,
                    factor: 1,
                    minTimeout: 1000,
                    maxTimeout: 5000,
                },
            });

            if (this.#pluginMap.has()) {
                throw new Error(`Plugin: ${pluginName} is enabled. Disable it first.`);
            }
            await fsPromises.rm(pluginDir, { recursive: true, force: true });
            await fsPromises.unlink(pluginDir + ".lock").catch(() => {});
        } finally {
            if (release) await release();
        }

        this.logger.success(`Uninstalled plugin: ${pluginName}`);
    }

    // ==============================
    // Private Utility Methods
    // ==============================

    async #cloneOrUpdateRepo(repository, branch = "main") {
        const repoHash = this.#createRepoHash(repository);
        const repoDir = path.join(os.tmpdir(), "firebot-plugins", repoHash);
        const lockPath = repoDir + ".lock";

        // Create an empty file for locking if it doesn't exist
        await fsPromises.mkdir(path.dirname(repoDir), { recursive: true });
        await fsPromises.writeFile(lockPath, "", { flag: "a" });

        let release;
        try {
            release = await lockfile.lock(lockPath, {
                retries: {
                    retries: 60,
                    factor: 1,
                    minTimeout: 1000,
                    maxTimeout: 5000,
                },
            });

            const git = simpleGit();

            if (this.#repoCache.has(repository)) {
                try {
                    await git.cwd(repoDir).pull("origin", branch);
                    return repoDir;
                } catch (error) {
                    this.logger.error(`Failed to update repo ${repository}:`, error);
                    this.#repoCache.delete(repository);
                }
            }

            await fsPromises.rm(repoDir, { recursive: true, force: true }).catch(() => {});
            await git.clone(repository, repoDir, ["--depth", "1", "--branch", branch]);
            this.#repoCache.set(repository, repoDir);
            return repoDir;
        } finally {
            if (release) await release();
        }
    }

    #createRepoHash(repository) {
        return crypto.createHash("md5").update(repository).digest("hex");
    }
}

module.exports = BasePluginManager;
