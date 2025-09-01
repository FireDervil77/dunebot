/**
 * Controller für Update-Benachrichtigungen
 * @author FireDervil
 */
const { ServiceManager } = require("dunebot-core");
const axios = require('axios');

// Einstellungen für Update-Checks
const UPDATE_CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24 Stunden
const UPDATE_SOURCE = process.env.UPDATE_CHECK_URL || 'https://api.github.com/repos/firedervil77/dunebot/releases/latest';

class UpdatesManager {
    constructor(app) {
        this.app = app;
        this.currentVersion = process.env.DASHBOARD_VERSION || '1.0.0';
        
        // Initialen Update-Check durchführen
        this.checkForUpdates();
        
        // Regelmäßige Update-Checks einrichten
        setInterval(() => this.checkForUpdates(), UPDATE_CHECK_INTERVAL);
    }
    
    /**
    * Prüft auf Updates für Bot und Dashboard
    * @returns {Promise<void>}
    * @author FireDervil
    */
    async checkForUpdates() {
        const Logger = ServiceManager.get('Logger');
        const notificationManager = ServiceManager.get('notificationManager');

        try {
            Logger.debug('Prüfe auf Updates...');
            
            let response;
            try {
                // API-Anfrage an GitHub
                response = await axios.get(UPDATE_SOURCE);
            } catch (apiError) {
                // Spezielle Behandlung für 404-Fehler (keine Releases gefunden)
                if (apiError.response && apiError.response.status === 404) {
                    Logger.debug('Keine Releases im Repository gefunden. Update-Check übersprungen.');
                    return; // Früher beenden, da keine Updates vorhanden sind
                }
                
                // Andere API-Fehler weiterreichen
                throw apiError;
            }
            
            // Wenn wir hier sind, war die API-Anfrage erfolgreich
            const latestVersion = response.data.tag_name.replace('v', '');
            
            if (this.isNewerVersion(latestVersion, this.currentVersion)) {
                Logger.info(`Update verfügbar: ${this.currentVersion} → ${latestVersion}`);
                
                try {
                    // Benachrichtigung in der Datenbank speichern
                    await notificationManager.addNotification({
                        title: 'Update verfügbar!',
                        message: `Eine neue Version von DuneBot (${latestVersion}) ist verfügbar. Aktuelle Version: ${this.currentVersion}.`,
                        type: 'info',
                        expiry: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 Tage gültig
                        roles: ['admin'] // Nur für Admins sichtbar
                    });
                    
                    Logger.debug('Update-Benachrichtigung erfolgreich erstellt');
                } catch (notificationError) {
                    Logger.warn('Fehler beim Erstellen der Update-Benachrichtigung:', notificationError);
                    // Kein Rethrow, da der Update-Check trotzdem als erfolgreich gilt
                }
            } else {
                Logger.debug('Keine Updates verfügbar.');
            }
        } catch (error) {
            // Nur noch für unerwartete Fehler, die nicht spezifisch behandelt wurden
            Logger.error('Fehler beim Prüfen auf Updates:', error);
        }
    }
    
    /**
     * Vergleicht Versionen (semver)
     * @param {string} newVersion - Neue Version
     * @param {string} currentVersion - Aktuelle Version
     * @returns {boolean} True, wenn newVersion neuer ist
     */
    isNewerVersion(newVersion, currentVersion) {
        const newParts = newVersion.split('.').map(Number);
        const currentParts = currentVersion.split('.').map(Number);
        
        for (let i = 0; i < newParts.length; i++) {
            if (newParts[i] > (currentParts[i] || 0)) {
                return true;
            } else if (newParts[i] < (currentParts[i] || 0)) {
                return false;
            }
        }
        
        return false;
    }
}

module.exports = UpdatesManager;