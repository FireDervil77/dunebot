/**
 * Template Plugin für DuneBot - Bot-Teil
 * 
 * Dieses Plugin dient als Vorlage für neue Bot-Plugins.
 * Alle wichtigen Lifecycle-Methoden und Best Practices sind demonstriert.
 * 
 * @author DuneBot Team
 * @version 1.0.0
 */
const path = require('path');
const { BotPlugin } = require('dunebot-sdk');
const { ServiceManager } = require('dunebot-core');

/**
 * Template-Plugin für den Bot-Teil von DuneBot
 * 
 * WICHTIGE LIFECYCLE-METHODEN:
 * - onEnable(client): Wird beim globalen Aktivieren aufgerufen
 * - onDisable(client): Wird beim globalen Deaktivieren aufgerufen
 * - onGuildEnable(guildId): Wird beim Aktivieren für eine Guild aufgerufen
 * - onGuildDisable(guildId): Wird beim Deaktivieren für eine Guild aufgerufen
 * - registerHooks(hooks): Registriert Plugin-Hooks
 * 
 * @extends {BotPlugin}
 * @author DuneBot Team
 */
class TemplateBotPlugin extends BotPlugin {
    /**
     * Erstellt eine neue Instanz des Template-Bot-Plugins
     * 
     * HINWEIS: Passe die Metadaten für dein Plugin an!
     */
    constructor() {
        super({
            name: 'template',                           // Plugin-ID (lowercase, keine Leerzeichen)
            displayName: 'Template Plugin',             // Anzeigename
            description: 'Ein Template-Plugin als Vorlage für neue Plugins',
            version: '1.0.0',                           // Semantic Versioning
            author: 'DuneBot Team',                     // Dein Name
            icon: 'fa-solid fa-puzzle-piece',          // Font Awesome Icon
            baseDir: __dirname,                         // Basis-Verzeichnis (NICHT ändern!)
            ownerOnly: false                            // Nur für Bot-Owner?
        });
        
        const Logger = ServiceManager.get("Logger");
        Logger.debug('Template-Bot-Plugin initialisiert');
    }
    
    /**
     * Wird aufgerufen, wenn das Plugin GLOBAL aktiviert wird
     * 
     * Hier solltest du:
     * - Globale Ressourcen initialisieren
     * - Datenbank-Tabellen erstellen (automatisch via schemas/)
     * - Bot-weite Services starten
     * 
     * @param {import('discord.js').Client} client - Discord.js Client
     * @returns {Promise<void>}
     * @author DuneBot Team
     */
    async onEnable(client) {
        const Logger = ServiceManager.get("Logger");
        Logger.info('Template-Bot-Plugin wird aktiviert...');

        // Beispiel: Config-Werte setzen
        try {
            const defaultConfig = {
                feature_enabled: true,
                max_items: 100,
                cooldown_seconds: 60
            };
            
            // Config über dbService speichern (optional)
            // await this.dbService.setConfig('template', defaultConfig);
            
            Logger.debug('Template-Plugin Konfiguration geladen');
        } catch (error) {
            Logger.error('Fehler beim Laden der Template-Config:', error);
        }
        
        // Beispiel: Globale Daten initialisieren
        this.cache = new Map();
        this.stats = {
            commandsExecuted: 0,
            errors: 0,
            startTime: Date.now()
        };
        
        Logger.success('Template-Bot-Plugin aktiviert');
    }

    /**
     * Wird aufgerufen, wenn das Plugin GLOBAL deaktiviert wird
     * 
     * Hier solltest du:
     * - Ressourcen freigeben
     * - Timer/Intervals stoppen
     * - Verbindungen schließen
     * 
     * @param {import('discord.js').Client} client - Discord.js Client
     * @returns {Promise<void>}
     * @author DuneBot Team
     */
    async onDisable(client) {
        const Logger = ServiceManager.get("Logger");
        Logger.info('Template-Bot-Plugin wird deaktiviert...');
        
        // Beispiel: Cache leeren
        if (this.cache) {
            this.cache.clear();
        }
        
        // Beispiel: Stats loggen
        if (this.stats) {
            Logger.info(`Template-Plugin Stats: ${this.stats.commandsExecuted} Commands, ${this.stats.errors} Errors`);
        }
        
        Logger.success('Template-Bot-Plugin deaktiviert');
    }

    /**
     * Wird aufgerufen, wenn das Plugin für eine BESTIMMTE GUILD aktiviert wird
     * 
     * Hier solltest du:
     * - Guild-spezifische Einstellungen laden
     * - Guild-spezifische Ressourcen initialisieren
     * - Commands für die Guild registrieren (automatisch)
     * 
     * @param {string} guildId - ID der Discord-Guild
     * @returns {Promise<void>}
     * @author DuneBot Team
     */
    async onGuildEnable(guildId) {
        const Logger = ServiceManager.get("Logger");
        Logger.info(`Template-Plugin für Guild ${guildId} aktiviert`);
        
        try {
            // Beispiel: Guild-spezifische Einstellungen laden
            const guildSettings = {
                prefix: '!',
                language: 'de-DE',
                features: {
                    example_feature: true
                }
            };
            
            // In Cache speichern
            if (this.cache) {
                this.cache.set(`guild:${guildId}`, guildSettings);
            }
            
            // Beispiel: Datenbank-Eintrag für Guild erstellen
            // const dbService = ServiceManager.get('dbService');
            // await dbService.query(
            //     'INSERT IGNORE INTO template_guilds (guild_id, settings) VALUES (?, ?)',
            //     [guildId, JSON.stringify(guildSettings)]
            // );
            
            Logger.success(`Template-Plugin für Guild ${guildId} erfolgreich initialisiert`);
        } catch (error) {
            Logger.error(`Fehler bei der Initialisierung der Guild ${guildId}:`, error);
            throw error; // Fehler weitergeben, damit die Aktivierung fehlschlägt
        }
    }

    /**
     * Wird aufgerufen, wenn das Plugin für eine BESTIMMTE GUILD deaktiviert wird
     * 
     * Hier solltest du:
     * - Guild-spezifische Ressourcen freigeben
     * - Guild-spezifische Timer stoppen
     * - (Optional) Guild-Daten löschen oder archivieren
     * 
     * @param {string} guildId - ID der Discord-Guild
     * @returns {Promise<void>}
     * @author DuneBot Team
     */
    async onGuildDisable(guildId) {
        const Logger = ServiceManager.get("Logger");
        Logger.info(`Template-Plugin für Guild ${guildId} deaktiviert`);
        
        try {
            // Beispiel: Cache-Eintrag entfernen
            if (this.cache) {
                this.cache.delete(`guild:${guildId}`);
            }
            
            // Beispiel: Guild-Daten archivieren statt löschen
            // const dbService = ServiceManager.get('dbService');
            // await dbService.query(
            //     'UPDATE template_guilds SET active = 0, disabled_at = NOW() WHERE guild_id = ?',
            //     [guildId]
            // );
            
            Logger.success(`Template-Plugin für Guild ${guildId} erfolgreich deaktiviert`);
        } catch (error) {
            Logger.error(`Fehler bei der Deaktivierung für Guild ${guildId}:`, error);
        }
    }

    /**
     * Registriert Plugin-Hooks für das Hook-System
     * 
     * HOOK-TYPEN:
     * - Action-Hooks: hooks.addAction('hook_name', callback)
     * - Filter-Hooks: hooks.addFilter('hook_name', callback)
     * 
     * VERFÜGBARE HOOKS siehe: .github/copilot-instructions.md
     * 
     * @param {import('dunebot-core').PluginHooks} hooks - Das Hook-System
     * @returns {void}
     * @author DuneBot Team
     */
    registerHooks(hooks) {
        const Logger = ServiceManager.get("Logger");
        
        // Beispiel: Action-Hook nach Command-Ausführung
        hooks.addAction('after_command_execution', (commandContext) => {
            if (this.stats) {
                this.stats.commandsExecuted++;
            }
            Logger.debug(`Command ausgeführt: ${commandContext.command?.name}`);
        });
        
        // Beispiel: Filter-Hook zum Modifizieren von Commands
        hooks.addFilter('modify_command_prefix', (prefix, guildId) => {
            // Prüfe, ob Guild eigenen Prefix hat
            const guildSettings = this.cache?.get(`guild:${guildId}`);
            if (guildSettings?.prefix) {
                return guildSettings.prefix;
            }
            return prefix; // Original-Prefix zurückgeben
        });
        
        // Beispiel: Action-Hook bei Fehlern
        hooks.addAction('command_error', (error, commandContext) => {
            if (this.stats) {
                this.stats.errors++;
            }
            Logger.error(`Command-Fehler in Template-Plugin:`, error);
        });
        
        Logger.debug('Template-Plugin-Hooks registriert');
    }

    /**
     * Beispiel: Eigene Hilfsmethode
     * 
     * Du kannst eigene Methoden hinzufügen, die von Commands
     * oder Events genutzt werden können.
     * 
     * @param {string} guildId - Guild-ID
     * @returns {Object|null} Guild-Einstellungen
     */
    getGuildSettings(guildId) {
        if (!this.cache) return null;
        return this.cache.get(`guild:${guildId}`) || null;
    }

    /**
     * Beispiel: Stats abrufen
     * 
     * @returns {Object} Plugin-Statistiken
     */
    getStats() {
        return {
            ...this.stats,
            uptime: Date.now() - (this.stats?.startTime || Date.now()),
            cacheSize: this.cache?.size || 0
        };
    }
}

module.exports = new TemplateBotPlugin();
