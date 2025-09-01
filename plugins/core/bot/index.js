/**
 * Core-Plugin für DuneBot - Bot-Teil
 * Stellt Basisfunktionalitäten für den Bot bereit
 * 
 * @author DuneBot Team
 */
const path = require('path');
const fs = require('fs');
const { BotPlugin } = require('dunebot-sdk');
const { Logger } = require('dunebot-sdk/utils');

/**
 * Core-Plugin für den Bot-Teil von DuneBot
 * Implementiert grundlegende Bot-Funktionen und Konfigurationen
 * 
 * @extends {BotPlugin}
 * @author DuneBot Team
 */
class CoreBotPlugin extends BotPlugin {
    /**
     * Erstellt eine neue Instanz des Core-Bot-Plugins
     */
    constructor() {
        super({
            name: 'core',
            displayName: 'Kern-Plugin',
            description: 'Grundlegende Funktionen für den DuneBot',
            version: '1.0.0',
            author: 'DuneBot Team',
            icon: 'fa-solid fa-cog',
            baseDir: __dirname,
            ownerOnly: false
        });
        
        Logger.debug('Core-Bot-Plugin initialisiert');
    }
    
    /**
     * Wird aufgerufen, wenn das Plugin aktiviert wird
     * Initialisiert Standardkonfigurationen und Bot-Status
     * 
     * @param {import('discord.js').Client} client - Discord.js Client
     * @returns {Promise<void>}
     * @author DuneBot Team
     */
    async onEnable(client) {
        Logger.info('Core-Bot-Plugin wird aktiviert...');
        
        // Standardkonfiguration prüfen und initialisieren
        await this.#initializeDefaultConfig();
        
        // Bot-Status setzen
        if (client && client.user) {
            client.user.setActivity('!help | /help', { type: 'LISTENING' });
            Logger.debug('Bot-Status gesetzt: !help | /help');
        }
        
        Logger.success('Core-Bot-Plugin aktiviert');
    }
    
    /**
     * Wird aufgerufen, wenn das Plugin deaktiviert wird
     * 
     * @param {import('discord.js').Client} client - Discord.js Client
     * @returns {Promise<void>}
     * @author DuneBot Team
     */
    async onDisable(client) {
        Logger.info('Core-Bot-Plugin wird deaktiviert...');
        // Aufräumarbeiten hier durchführen
        
        Logger.success('Core-Bot-Plugin deaktiviert');
    }
    
    /**
     * Wird aufgerufen, wenn das Plugin für eine bestimmte Guild aktiviert wird
     * 
     * @param {string} guildId - ID der Discord-Guild
     * @returns {Promise<void>}
     * @author DuneBot Team
     */
    async onGuildEnable(guildId) {
        Logger.info(`Core-Plugin für Guild ${guildId} aktiviert`);
        
        // Guild-spezifische Initialisierungen
        try {
            // Standardkonfiguration für die Guild erstellen
            const guildConfig = await this.getConfig(guildId);
            
            // Wenn keine Konfiguration vorhanden ist, Standardwerte setzen
            if (!guildConfig || Object.keys(guildConfig).length === 0) {
                await this.saveMultipleConfig({
                    'PREFIX': '!',
                    'LANGUAGE': 'de-DE',
                    'WELCOME_CHANNEL': null,
                    'LEAVE_CHANNEL': null,
                    'ENABLED_FEATURES': ['help', 'ping', 'info']
                }, guildId);
                
                Logger.debug(`Standardkonfiguration für Guild ${guildId} erstellt`);
            }
        } catch (error) {
            Logger.error(`Fehler bei der Initialisierung der Guild ${guildId}:`, error);
        }
    }
    
    /**
     * Wird aufgerufen, wenn das Plugin für eine bestimmte Guild deaktiviert wird
     * 
     * @param {string} guildId - ID der Discord-Guild
     * @returns {Promise<void>}
     * @author DuneBot Team
     */
    async onGuildDisable(guildId) {
        Logger.info(`Core-Plugin für Guild ${guildId} deaktiviert`);
        // Guild-spezifische Aufräumarbeiten
    }
    
    /**
     * Initialisiert die Standardkonfiguration für das Core-Plugin
     * 
     * @private
     * @returns {Promise<void>}
     * @author DuneBot Team
     */
    async #initializeDefaultConfig() {
        try {
            // Aktuelle Konfiguration abrufen
            const config = await this.getConfig();
            
            // Standardwerte setzen, falls nicht vorhanden
            const defaultConfig = {
                'ENABLED_PLUGINS': ['core'],
                'LOCALE': { DEFAULT: 'de-DE' },
                'PREFIX_COMMANDS': { 
                    ENABLED: true, 
                    DEFAULT_PREFIX: '!' 
                },
                'INTERACTIONS': { 
                    SLASH: true, 
                    CONTEXT: false 
                },
                'THEME': {
                    ENABLED: true,
                    DEFAULT: 'default',
                    PATH: './themes'
                },
                'DASHBOARD': {
                    ENABLED: true,
                    ENCRYPT: true,
                    LOGO_NAME: 'DuneBot',
                    LOGO_URL: '/images/logo.png'
                }
            };
            
            // Fehlende Konfigurationseinträge hinzufügen
            const updates = {};
            let hasUpdates = false;
            
            for (const [key, value] of Object.entries(defaultConfig)) {
                if (!config || config[key] === undefined) {
                    updates[key] = value;
                    hasUpdates = true;
                    Logger.debug(`Standard-Konfiguration für "${key}" wird erstellt`);
                }
            }
            
            // Aktualisierungen speichern, falls vorhanden
            if (hasUpdates) {
                await this.saveMultipleConfig(updates);
                Logger.info('Standard-Konfiguration für Core-Plugin wurde erstellt/aktualisiert');
            } else {
                Logger.debug('Konfiguration bereits vorhanden, keine Aktualisierung notwendig');
            }
            
       } catch (error) {
            Logger.error('Fehler bei der Initialisierung der Standardkonfiguration:', error);
            
            // Notfallkonfiguration direkt in der Datenbank speichern
            try {
                // Prüfen ob Eintrag existiert
                const [existing] = await this.dbService.query(
                    "SELECT * FROM configs WHERE plugin_name = ? AND context = ? AND config_key = ? LIMIT 1",
                    ['core', 'shared', 'ENABLED_PLUGINS']
                );

                if (!existing) {
                    // Wenn nicht, neu anlegen
                    await this.dbService.query(
                        "INSERT INTO configs (plugin_name, context, config_key, config_value) VALUES (?, ?, ?, ?)",
                        ['core', 'shared', 'ENABLED_PLUGINS', JSON.stringify(['core'])]
                    );
                    Logger.info('Notfall-Konfiguration für aktivierte Plugins erstellt');
                }
            } catch (dbError) {
                Logger.error('Fehler bei der Erstellung der Notfall-Konfiguration:', dbError);
            }
        }
    }
    
    /**
     * Registriert hooks für das Core-Plugin
     * 
     * @param {import('dunebot-sdk').HookSystem} hooks - Das Hook-System
     * @returns {void}
     * @author DuneBot Team
     */
    registerHooks(hooks) {
        // Beispiel für einen Filter-Hook
        hooks.addFilter('modify_command_prefix', (prefix, guildId) => {
            // Hier könnte der Präfix für bestimmte Guilds geändert werden
            return prefix;
        });
        
        // Beispiel für einen Action-Hook
        hooks.addAction('after_command_execution', (commandContext) => {
            // Hier könnte Logging nach jeder Befehlsausführung durchgeführt werden
        });
        
        Logger.debug('Core-Plugin-Hooks registriert');
    }
}

// Instanz des Plugins exportieren
module.exports = new CoreBotPlugin();