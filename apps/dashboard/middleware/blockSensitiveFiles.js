/**
 * Middleware zum Blockieren von sensiblen Files
 * 
 * Blockiert Zugriff auf:
 * - .env, .git, .vscode, .pm2 (Hidden Directories/Files)
 * - node_modules, logs (Development Folders)
 * - package.json, ecosystem.config.js (Config Files)
 * - *.sql (Database Scripts)
 * 
 * Returns: 403 Forbidden
 * 
 * @author FireDervil
 * @since 2025-11-09
 */

const Logger = require('dunebot-core').ServiceManager.get('Logger');

/**
 * Middleware-Funktion
 */
module.exports = (req, res, next) => {
    const blockedPatterns = [
        /^\/\.env/i,                    // .env Files
        /^\/\.git/i,                    // Git Repository
        /^\/\.vscode/i,                 // VS Code Config
        /^\/\.pm2/i,                    // PM2 Config
        /^\/node_modules/i,             // Dependencies
        /^\/logs/i,                     // Log Files
        /package\.json$/i,              // Package Manifest
        /ecosystem\.config\.js$/i,      // PM2 Ecosystem
        /\.sql$/i,                      // SQL Scripts
        /\.bak$/i,                      // Backup Files
        /\.swp$/i,                      // Vim Swap Files
        /\.key$/i,                      // Private Keys
        /\.pem$/i                       // SSL Certificates
    ];
    
    // Prüfe ob Request-Path ein blockiertes Pattern matcht
    const isSensitive = blockedPatterns.some(pattern => pattern.test(req.path));
    
    if (isSensitive) {
        Logger.warn(`[Security] Blocked access to sensitive file: ${req.path} from ${req.ip}`);
        return res.status(403).send('Forbidden');
    }
    
    // Alles ok, weiter zum nächsten Handler
    next();
};
