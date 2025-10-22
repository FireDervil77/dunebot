/**
 * WebSocket Command Payload Validator
 * 
 * Validiert alle eingehenden Commands von Daemons mit Joi-Schemas
 * Verhindert Injection-Angriffe und ungültige Payloads
 * 
 * @module middleware/security/websocket-validator
 * @author FireBot Team
 */

const Joi = require('joi');
const { ServiceManager } = require('dunebot-core');

/**
 * Command-Schemas für alle WebSocket-Commands
 * Jedes Command hat ein striktes Schema mit Validierungsregeln
 */
const COMMAND_SCHEMAS = {
    // Virtual Server Management
    'virtual.create': Joi.object({
        server_id: Joi.string()
            .uuid()
            .required()
            .description('Server-ID (UUID)'),
        server_name: Joi.string()
            .min(3)
            .max(100)
            .pattern(/^[a-zA-Z0-9\s\-_]+$/)
            .required()
            .description('Server-Name (alphanumerisch, Leerzeichen, Bindestriche, Unterstriche)'),
        ram_limit_gb: Joi.number()
            .min(0.5)
            .max(256)
            .required()
            .description('RAM-Limit in GB (min: 0.5GB, max: 256GB)'),
        disk_limit_gb: Joi.number()
            .min(1)
            .max(5000)
            .required()
            .description('Disk-Limit in GB (min: 1GB, max: 5TB)'),
        custom_path: Joi.string()
            .pattern(/^\/[a-zA-Z0-9\/_\-\.]+$/)
            .max(500)
            .allow(null)
            .optional()
            .description('Custom-Path (absoluter Unix-Pfad, optional, null erlaubt)')
    }),

    'virtual.delete': Joi.object({
        server_id: Joi.string()
            .uuid()
            .required()
            .description('Server-ID (UUID)'),
        custom_path: Joi.string()
            .pattern(/^\/[a-zA-Z0-9\/_\-\.]+$/)
            .max(500)
            .allow(null)
            .optional()
            .description('Custom-Path (absoluter Unix-Pfad, optional, null erlaubt)')
    }),

    // Gameserver Installation
    'gameserver.install': Joi.object({
        server_id: Joi.number()
            .integer()
            .unsigned()
            .required()
            .description('Gameserver-ID (numerisch aus DB)'),
        addon_slug: Joi.string()
            .pattern(/^[a-z0-9\-]+$/)
            .max(50)
            .required()
            .description('Addon-Slug (z.B. "cs2", "minecraft")'),
        addon_name: Joi.string()
            .max(100)
            .required()
            .description('Addon-Name (z.B. "Counter-Strike 2")'),
        template_name: Joi.string()
            .max(50)
            .allow(null)
            .optional()
            .description('Template-Name (z.B. "competitive")'),
        steam_app_id: Joi.alternatives().try(
            Joi.number().integer(),
            Joi.string().pattern(/^[0-9]+$/)
        ).allow(null)
            .optional()
            .description('Steam App ID (numerisch)'),
        ports: Joi.object()
            .unknown(true)
            .required()
            .description('Port-Konfiguration'),
        env_variables: Joi.object()
            .unknown(true)
            .required()
            .description('Environment-Variablen'),
        install_path: Joi.string()
            .pattern(/^\/[a-zA-Z0-9\/_\-]+$/)
            .max(255)
            .required()
            .description('Installations-Pfad (absolut)')
    }),

    // Gameserver Management
    'server.start': Joi.object({
        server_id: Joi.number()
            .integer()
            .unsigned()
            .required()
            .description('Gameserver-ID (numerisch aus DB)')
    }),

    'server.stop': Joi.object({
        server_id: Joi.number()
            .integer()
            .unsigned()
            .required()
            .description('Gameserver-ID (numerisch aus DB)')
    }),

    'server.restart': Joi.object({
        server_id: Joi.number()
            .integer()
            .unsigned()
            .required()
            .description('Gameserver-ID (numerisch aus DB)')
    }),

    'server.command': Joi.object({
        server_id: Joi.number()
            .integer()
            .unsigned()
            .required()
            .description('Gameserver-ID (numerisch aus DB)'),
        command: Joi.string()
            .min(1)
            .max(500)
            .required()
            .description('Server-Command (max 500 Zeichen)')
    }),

    // Daemon Management
    'daemon.update': Joi.object({
        // Daemon-Update braucht kein Payload
    }).unknown(false), // Keine unbekannten Keys erlauben

    'daemon.status': Joi.object({
        // Status-Request braucht kein Payload
    }).unknown(false)
};

/**
 * Validiert einen Command-Payload gegen sein Schema
 * 
 * @param {string} command - Command-Name (z.B. 'virtual.create')
 * @param {object} payload - Command-Payload
 * @returns {object} {valid: boolean, error?: string, sanitizedPayload?: object}
 */
function validateCommand(command, payload) {
    const Logger = ServiceManager.get('Logger');
    
    // Prüfen ob Schema existiert
    const schema = COMMAND_SCHEMAS[command];
    if (!schema) {
        Logger.warn(`[WebSocket Validator] Kein Schema für Command: ${command}`);
        return {
            valid: false,
            error: `Unbekannter Command: ${command}`
        };
    }

    // Validierung durchführen
    const { error, value } = schema.validate(payload, {
        abortEarly: false,      // Alle Fehler sammeln
        stripUnknown: true,     // Unbekannte Keys entfernen
        presence: 'required'    // Alle Keys required by default
    });

    if (error) {
        // Fehler-Details loggen
        const errorDetails = error.details.map(d => ({
            field: d.path.join('.'),
            message: d.message,
            type: d.type
        }));

        Logger.warn(`[WebSocket Validator] Validierung fehlgeschlagen für ${command}:`, errorDetails);

        return {
            valid: false,
            error: `Ungültige Payload-Daten: ${errorDetails.map(d => d.message).join(', ')}`,
            details: errorDetails
        };
    }

    // Validierung erfolgreich! Sanitized Payload zurückgeben
    return {
        valid: true,
        sanitizedPayload: value
    };
}

/**
 * Command-Größen-Limiter
 * Verhindert zu große Payloads (DoS-Schutz)
 */
const MAX_PAYLOAD_SIZE = 1024 * 50; // 50KB max

function validatePayloadSize(payload) {
    const payloadString = JSON.stringify(payload);
    const sizeBytes = Buffer.byteLength(payloadString, 'utf8');

    if (sizeBytes > MAX_PAYLOAD_SIZE) {
        return {
            valid: false,
            error: `Payload zu groß: ${sizeBytes} Bytes (max: ${MAX_PAYLOAD_SIZE} Bytes)`
        };
    }

    return { valid: true };
}

/**
 * Wrapper-Funktion für IPMServer
 * Validiert Command bevor es verarbeitet wird
 * 
 * @param {string} command - Command-Name
 * @param {object} payload - Command-Payload
 * @returns {object} {valid: boolean, error?: string, sanitizedPayload?: object}
 */
function validateWebSocketCommand(command, payload) {
    const Logger = ServiceManager.get('Logger');

    // 1. Größen-Check
    const sizeCheck = validatePayloadSize(payload);
    if (!sizeCheck.valid) {
        Logger.warn(`[WebSocket Validator] Payload zu groß für ${command}`);
        return sizeCheck;
    }

    // 2. Schema-Validierung
    const validation = validateCommand(command, payload);
    if (!validation.valid) {
        Logger.warn(`[WebSocket Validator] Schema-Validierung fehlgeschlagen für ${command}`);
        return validation;
    }

    Logger.debug(`[WebSocket Validator] ✅ Command validiert: ${command}`);
    return validation;
}

module.exports = {
    validateWebSocketCommand,
    validateCommand,
    validatePayloadSize,
    COMMAND_SCHEMAS
};

