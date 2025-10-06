/**
 * Shared Constants für das Template-Plugin
 * Diese Konstanten können sowohl vom Bot als auch vom Dashboard verwendet werden
 * 
 * @author DuneBot Team
 */

/**
 * Plugin-Metadaten
 */
const PLUGIN_INFO = {
    NAME: 'template',
    DISPLAY_NAME: 'Template Plugin',
    VERSION: '1.0.0',
    AUTHOR: 'DuneBot Team',
    REPOSITORY: 'https://github.com/firedervil77/dunebot-plugins'
};

/**
 * Datenbank-Tabellen
 */
const TABLES = {
    DATA: 'template_data',
    STATS: 'template_stats',
    USER_PREFS: 'template_user_preferences'
};

/**
 * Konfigurations-Schlüssel
 */
const CONFIG_KEYS = {
    ENABLED: 'enabled',
    NOTIFICATION_CHANNEL: 'notificationChannel',
    LOG_LEVEL: 'logLevel',
    MAX_ENTRIES: 'maxEntries',
    AUTO_CLEANUP: 'autoCleanup'
};

/**
 * Log-Level
 */
const LOG_LEVELS = {
    DEBUG: 'debug',
    INFO: 'info',
    WARN: 'warn',
    ERROR: 'error'
};

/**
 * Datentypen
 */
const DATA_TYPES = {
    TEXT: 'text',
    NUMBER: 'number',
    BOOLEAN: 'boolean',
    JSON: 'json',
    TIMESTAMP: 'timestamp'
};

/**
 * Status-Codes
 */
const STATUS = {
    ACTIVE: 'active',
    INACTIVE: 'inactive',
    PENDING: 'pending',
    ERROR: 'error'
};

/**
 * Fehler-Codes
 */
const ERROR_CODES = {
    UNKNOWN: 'UNKNOWN_ERROR',
    DATABASE: 'DATABASE_ERROR',
    PERMISSION: 'PERMISSION_ERROR',
    VALIDATION: 'VALIDATION_ERROR',
    NOT_FOUND: 'NOT_FOUND',
    ALREADY_EXISTS: 'ALREADY_EXISTS'
};

/**
 * Standard-Einstellungen
 */
const DEFAULTS = {
    LOG_LEVEL: LOG_LEVELS.INFO,
    MAX_ENTRIES: 1000,
    AUTO_CLEANUP: true,
    CLEANUP_DAYS: 30
};

/**
 * Limits und Constraints
 */
const LIMITS = {
    MAX_TEXT_LENGTH: 2000,
    MAX_ENTRIES_PER_USER: 100,
    MAX_DAILY_ACTIONS: 50,
    CACHE_TTL: 300 // 5 Minuten in Sekunden
};

/**
 * IPC Event-Namen
 */
const IPC_EVENTS = {
    GET_STATS: 'template:GET_STATS',
    UPDATE_CONFIG: 'template:UPDATE_CONFIG',
    SYNC_DATA: 'template:SYNC_DATA'
};

module.exports = {
    PLUGIN_INFO,
    TABLES,
    CONFIG_KEYS,
    LOG_LEVELS,
    DATA_TYPES,
    STATUS,
    ERROR_CODES,
    DEFAULTS,
    LIMITS,
    IPC_EVENTS
};
