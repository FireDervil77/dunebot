const fs = require("fs");
const fsPromises = require("fs").promises;
const os = require("os");
const crypto = require("crypto");
const fetch = require("node-fetch");

const path = require("path");
const simpleGit = require("simple-git");
const lockfile = require("proper-lockfile");
const execa = require("execa");
const semver = require("semver");

const ServiceManager = require("./ServiceManager");
const PluginHooks = require("./PluginHooks"); 




class BasePluginManager {
    #pluginMap = new Map();
    #repoCache = new Map();

    /**
     * Erstellt eine neue Instanz des BasePluginManager
     * @param {string} registryPath - Pfad oder URL zur Plugin-Registry
     * @param {string} pluginsDir - Verzeichnis der Plugins
     * @param {Object} logger - Logger-Instanz
     * @author FireDervil
     */
    constructor(registryPath, pluginsDir, logger) {
        this.logger = logger;

        this.registryPath = this.#isUrl(registryPath) ? registryPath : path.resolve(registryPath);
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
     * Initialisiert alle Plugins und deren Abhängigkeiten
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
                throw new Error("Core plugin not found in registry.");
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

            // Get enabled plugins from core config
            const corePluginInstance = this.getPlugin("core");

            const config = await corePluginInstance.getConfig();
            let enabled_plugins = config.ENABLED_PLUGINS || [];
            

            // "filter_enabled_plugins" Hook ausführen
            enabled_plugins = await this.hooks.applyFilter('filter_enabled_plugins', enabled_plugins);

            // Get all available plugins from registry except disabled ones
            const enableablePlugins = filteredPlugins.filter(
                (p) => p.name !== "core" && enabled_plugins.includes(p.name),
            );

            // "before_dependency_check" Hook ausführen
            await this.hooks.doAction('before_dependency_check', enableablePlugins);
            
            // Check dependencies and filter out plugins with missing dependencies
            const pluginsToDisable = [];
            const pluginsToSkip = [];

            for (const plugin of enableablePlugins) {
                // Check if all dependencies are available in the registry
                const missingDeps = (plugin.dependencies || []).filter(
                    (dep) => !filteredPlugins.some((p) => p.name === dep),
                );

                if (missingDeps.length > 0) {
                    this.logger.warn(
                        `Plugin ${plugin.name} has dependencies that are not in registry: ${missingDeps.join(", ")}. Skipping this plugin.`,
                    );
                    pluginsToSkip.push(plugin.name);
                    
                    // "plugin_skipped" Hook ausführen
                    await this.hooks.doAction('plugin_skipped', plugin.name, 'missing_dependencies', missingDeps);
                    continue;
                }

                // Check if all dependencies are in the enabled_plugins list
                const disabledDeps = (plugin.dependencies || []).filter(
                    (dep) => dep !== "core" && !enabled_plugins.includes(dep),
                );

                if (disabledDeps.length > 0) {
                    this.logger.warn(
                        `Plugin ${plugin.name} has dependencies that are not enabled: ${disabledDeps.join(", ")}. Adding to disabled plugins.`,
                    );
                    pluginsToDisable.push(plugin.name);
                    
                    // "plugin_disabled" Hook ausführen
                    await this.hooks.doAction('plugin_disabled', plugin.name, 'disabled_dependencies', disabledDeps);
                }
            }
            
            // "after_dependency_check" Hook ausführen
            await this.hooks.doAction('after_dependency_check', { pluginsToDisable, pluginsToSkip });

            // Update enabled plugins list if needed
            if (pluginsToDisable.length > 0) {
                // "before_update_enabled_plugins" Hook ausführen
                await this.hooks.doAction('before_update_enabled_plugins', enabled_plugins, pluginsToDisable);
                
                for (const pluginName of pluginsToDisable) {
                    const index = enabled_plugins.indexOf(pluginName);
                    if (index !== -1) {
                        enabled_plugins.splice(index, 1);
                    }
                }
                config.ENABLED_PLUGINS = enabled_plugins;
                
                // Korrekte Nutzung des Mysql aufrufs
               await dbService.query(`
                    INSERT INTO configs (plugin_name, config_key, config_value, context)
                    VALUES (?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE
                        config_value = VALUES(config_value)
                `, [
                    "core",
                    "ENABLED_PLUGINS",
                    JSON.stringify(enabled_plugins),
                    "shared"
                ]);
                
                // "after_update_enabled_plugins" Hook ausführen
                await this.hooks.doAction('after_update_enabled_plugins', enabled_plugins);
                
                this.logger.info(
                    `Removed ${pluginsToDisable.length} plugins with disabled dependencies from enabled list.`,
                );
            }

            // Filter plugins to enable (all plugins except core, disabled ones and ones with missing dependencies)
            let pluginsToEnable = filteredPlugins.filter(
                (p) =>
                    p.name !== "core" &&
                    enabled_plugins.includes(p.name) &&
                    !pluginsToSkip.includes(p.name),
            );
            
            // "filter_plugins_to_enable" Hook ausführen
            pluginsToEnable = await this.hooks.applyFilter('filter_plugins_to_enable', pluginsToEnable);

            // "before_determine_load_order" Hook ausführen
            await this.hooks.doAction('before_determine_load_order', pluginsToEnable);
            
            const loadOrder = this.#getTopologicalOrder(pluginsToEnable);
            
            // "filter_plugin_load_order" Hook ausführen
            const finalLoadOrder = await this.hooks.applyFilter('filter_plugin_load_order', loadOrder);

            // "before_plugins_enable" Hook ausführen
            await this.hooks.doAction('before_plugins_enable', finalLoadOrder);
            
            for (const pluginName of finalLoadOrder) {
                // "before_plugin_enable" Hook ausführen
                await this.hooks.doAction('before_plugin_enable', pluginName);
                
                const meta = filteredPlugins.find((p) => p.name === pluginName);
                if (!meta.installed) {
                    await this.installPlugin(pluginName);
                }
                console.log("BEVOR ENABLE PLUGIN");
                await this.enablePlugin(pluginName);
                
                // "after_plugin_enable" Hook ausführen
                await this.hooks.doAction('after_plugin_enable', pluginName, this.getPlugin(pluginName));
            }

            // "after_plugins_enable" Hook ausführen
            await this.hooks.doAction('after_plugins_enable', this.plugins);
            
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
    async getPluginsMeta() {
        try {
            let data;
            if (this.#isUrl(this.registryPath)) {
                // Fetch registry data from URL
                const response = await fetch(this.registryPath);
                if (!response.ok) {
                    throw new Error(
                        `Failed to fetch registry from ${this.registryPath}: ${response.status} ${response.statusText}`,
                    );
                }
                data = await response.text();
            } else {
                // Read registry data from local file
                data = await fsPromises.readFile(this.registryPath, "utf8");
            }

            const registry = JSON.parse(data);
            const installedPlugins = await fsPromises.readdir(this.pluginsDir).catch(() => []);

            const pluginsMeta = await Promise.all(
                registry.map(async (plugin) => {
                    let currentVersion;
                    const isInstalled = installedPlugins.includes(plugin.name);
                    if (isInstalled) {
                        currentVersion = this.#pluginMap.get(plugin.name)?.version;
                        if (!currentVersion) {
                            const packageJsonPath = path.join(
                                this.pluginsDir,
                                plugin.name,
                                "package.json",
                            );
                            const packageJsonData = await fsPromises.readFile(packageJsonPath, "utf8");
                            const packageJson = JSON.parse(packageJsonData);
                            currentVersion = packageJson.version;
                        }
                    } else {
                        currentVersion = plugin.version;
                    }

                    return {
                        ...plugin,
                        installed: installedPlugins.includes(plugin.name),
                        enabled: this.isPluginEnabled(plugin.name),
                        currentVersion,
                        hasUpdate: currentVersion && semver.lt(currentVersion, plugin.version),
                    };
                }),
            );
            return pluginsMeta;
        } catch (error) {
            this.logger.error("Failed to get plugins:", error);
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

            const data = await this.getPluginsMeta();
            const meta = data.find((p) => p.name === pluginName);
            if (!meta) {
                throw new Error("Plugin not found in registry.");
            }

            // Check dependencies
            const missingDeps = [];
            for (const dep of meta.dependencies || []) {
                if (!this.#pluginMap.has(dep)) {
                    missingDeps.push(dep);
                }
            }

            if (missingDeps.length > 0) {
                throw new Error(
                    `Missing dependencies for ${pluginName}: ${missingDeps.join(", ")}. Please install them first.`,
                );
            }

            // Clone and copy plugin files
            const repoDir = await this.#cloneOrUpdateRepo(meta.repository);
            const sourcePath = meta.repositoryPath
                ? path.join(repoDir, meta.repositoryPath)
                : repoDir;
            const targetPath = path.join(this.pluginsDir, meta.name);

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

    #findCycle(plugins) {
        const visited = new Set();
        const stack = new Set();
        const graph = new Map();

        // Build adjacency list
        plugins.forEach((plugin) => {
            graph.set(plugin.name, (plugin.dependencies || []).slice());
        });

        const cycle = [];

        const dfs = (node) => {
            visited.add(node);
            stack.add(node);

            for (const neighbor of graph.get(node) || []) {
                if (!visited.has(neighbor)) {
                    const foundCycle = dfs(neighbor);
                    if (foundCycle) {
                        cycle.unshift(node);
                        return true;
                    }
                } else if (stack.has(neighbor)) {
                    cycle.push(neighbor);
                    cycle.unshift(node);
                    return true;
                }
            }

            stack.delete(node);
            return false;
        };

        for (const plugin of plugins) {
            if (!visited.has(plugin.name) && dfs(plugin.name)) {
                // Trim the cycle to start from the first repeated element
                const startIndex = cycle.indexOf(cycle[cycle.length - 1]);
                return cycle.slice(startIndex);
            }
        }

        return null;
    }

    #getTopologicalOrder(plugins) {

        // Create adjacency list and in-degree count
        const graph = new Map();
        const inDegree = new Map();

        // Get all plugin names for easy lookup
        const pluginNames = new Set(plugins.map((p) => p.name));

        plugins.forEach((plugin) => {
            graph.set(plugin.name, []);
            inDegree.set(plugin.name, 0);
        });

        // Build the graph
        plugins.forEach((plugin) => {
            (plugin.dependencies || []).forEach((dep) => {
                if (dep === "core") return;
                // Only process dependencies that exist in our plugin list
                if (pluginNames.has(dep)) {
                    graph.get(dep).push(plugin.name);
                    inDegree.set(plugin.name, inDegree.get(plugin.name) + 1);
                }
            });
        });

        // Find all sources (nodes with in-degree 0)
        const queue = plugins
            .filter((plugin) => inDegree.get(plugin.name) === 0)
            .map((plugin) => plugin.name);

        const result = [];

        while (queue.length) {
            const pluginName = queue.shift();
            result.push(pluginName);

            for (const neighbor of graph.get(pluginName)) {
                inDegree.set(neighbor, inDegree.get(neighbor) - 1);
                if (inDegree.get(neighbor) === 0) {
                    queue.push(neighbor);
                }
            }
        }

        if (result.length !== plugins.length) {
            const cycle = this.#findCycle(plugins);
            throw new Error(
                `Circular dependency detected in plugins: ${cycle.join(" -> ")} -> ${cycle[0]}`,
            );
        }

        return result;
    }

    async #cloneOrUpdateRepo(repository, branch = "main") {
        const repoHash = this.#createRepoHash(repository);
        const repoDir = path.join(os.tmpdir(), "dunebot-plugins", repoHash);
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

    #isUrl(str) {
        try {
            const url = new URL(str);
            return url.protocol === "http:" || url.protocol === "https:";
        } catch {
            return false;
        }
    }
}

module.exports = BasePluginManager;
