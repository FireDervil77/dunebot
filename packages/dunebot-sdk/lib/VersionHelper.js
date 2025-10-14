const fs = require('fs');
const path = require('path');

/**
 * Hilfsfunktionen für automatisches Plugin-Versions-Management
 * Lädt Versionen automatisch aus package.json statt hardcoded
 * 
 * @author firedervil
 */
class VersionHelper {
    
    /**
     * Lädt die Version eines Plugins aus dessen package.json
     * @param {string} pluginPath - Pfad zum Plugin-Verzeichnis
     * @param {string} fallbackVersion - Fallback wenn package.json nicht gefunden wird
     * @returns {string} Plugin-Version
     */
    static getPluginVersion(pluginPath, fallbackVersion = '1.0.0') {
        try {
            // Absoluten Pfad erstellen falls relativer Pfad übergeben wird
            const absolutePath = path.isAbsolute(pluginPath) ? pluginPath : path.resolve(pluginPath);
            
            // Suche package.json im Plugin-Root
            const packageJsonPath = path.join(absolutePath, 'package.json');
            
            if (fs.existsSync(packageJsonPath)) {
                // Cache für require() leeren um aktuellste Version zu laden
                delete require.cache[require.resolve(packageJsonPath)];
                const packageJson = require(packageJsonPath);
                return packageJson.version || fallbackVersion;
            }
            
            // Fallback: Suche eine Ebene höher (falls wir in bot/ oder dashboard/ sind)
            const parentPackageJsonPath = path.join(absolutePath, '..', 'package.json');
            
            if (fs.existsSync(parentPackageJsonPath)) {
                delete require.cache[require.resolve(parentPackageJsonPath)];
                const packageJson = require(parentPackageJsonPath);
                return packageJson.version || fallbackVersion;
            }
            
            return fallbackVersion;
            
        } catch (error) {
            console.warn(`[VersionHelper] Fehler beim Laden der Plugin-Version aus ${pluginPath}:`, error.message);
            return fallbackVersion;
        }
    }
    
    /**
     * Lädt automatisch die Version für den aktuellen Plugin-Kontext
     * Nutzt __dirname um das Plugin-Verzeichnis zu ermitteln
     * @param {string} currentFileDirname - __dirname des aufrufenden Plugin-Files
     * @param {string} fallbackVersion - Fallback-Version
     * @returns {string} Plugin-Version
     */
    static getVersionFromContext(currentFileDirname, fallbackVersion = '1.0.0') {
        // Gehe von bot/index.js oder dashboard/index.js zum Plugin-Root
        // z.B: /plugins/core/bot -> /plugins/core
        const pluginRoot = path.resolve(currentFileDirname, '..');
        return this.getPluginVersion(pluginRoot, fallbackVersion);
    }
    
    /**
     * Erstellt eine Versions-Statistik für alle Plugins
     * @param {string} pluginsDir - Verzeichnis mit allen Plugins
     * @returns {Object} Versions-Übersicht
     */
    static getAllPluginVersions(pluginsDir) {
        const versions = {};
        
        try {
            const pluginDirs = fs.readdirSync(pluginsDir, { withFileTypes: true })
                .filter(dirent => dirent.isDirectory())
                .map(dirent => dirent.name);
            
            for (const pluginName of pluginDirs) {
                const pluginPath = path.join(pluginsDir, pluginName);
                versions[pluginName] = this.getPluginVersion(pluginPath);
            }
            
        } catch (error) {
            console.warn('[VersionHelper] Fehler beim Laden aller Plugin-Versionen:', error.message);
        }
        
        return versions;
    }
}

module.exports = VersionHelper;