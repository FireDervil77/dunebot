/**
 * Template Plugin - Konstanten
 * 
 * Gemeinsame Konstanten die vom Bot und Dashboard genutzt werden.
 * 
 * @author DuneBot Team
 */

module.exports = {
    // Plugin-Metadaten
    PLUGIN_NAME: 'template',
    PLUGIN_VERSION: '1.0.0',
    
    // Limits
    MAX_ITEMS_DEFAULT: 100,
    MAX_ITEMS_LIMIT: 1000,
    MIN_ITEMS_LIMIT: 1,
    
    // Cooldowns
    DEFAULT_COOLDOWN: 60,
    MIN_COOLDOWN: 0,
    MAX_COOLDOWN: 3600,
    
    // Feature Flags
    FEATURES: {
        EXAMPLE_FEATURE: 'example_feature',
        ADVANCED_STATS: 'advanced_stats',
        AUTO_CLEANUP: 'auto_cleanup'
    },
    
    // Event-Namen
    EVENTS: {
        COMMAND_EXECUTED: 'template:command_executed',
        SETTINGS_CHANGED: 'template:settings_changed',
        USER_REGISTERED: 'template:user_registered'
    },
    
    // IPC-Events
    IPC: {
        GET_STATS: 'template:GET_STATS',
        UPDATE_SETTINGS: 'template:UPDATE_SETTINGS',
        CLEAR_CACHE: 'template:CLEAR_CACHE'
    },
    
    // Cache-Keys
    CACHE_KEYS: {
        GUILD_SETTINGS: 'guild:settings',
        USER_DATA: 'user:data',
        STATS: 'stats'
    },
    
    // Farben (für Embeds)
    COLORS: {
        PRIMARY: 0x5865F2,
        SUCCESS: 0x57F287,
        WARNING: 0xFEE75C,
        DANGER: 0xED4245,
        INFO: 0x00D9FF
    }
};
