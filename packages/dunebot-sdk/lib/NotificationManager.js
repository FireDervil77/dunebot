/**
 * Verwaltet globale Benachrichtigungen für das Dashboard
 * @author FireDervil
 */
const { ServiceManager } = require("dunebot-core");

/**
 * Verwaltet globale Benachrichtigungen für das Dashboard
 * @author FireDervil
 */
class NotificationManager {
    constructor() {
        const Logger = ServiceManager.get('Logger');
        Logger.debug('NotificationManager wird initialisiert');
    }

    /**
     * Fügt eine neue Benachrichtigung hinzu
     * @param {Object} notification Benachrichtigungs-Objekt
     * @returns {Promise<Object>} Die erstellte Benachrichtigung
     */
    async addNotification(notification) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');

        try {
            const result = await dbService.query(`
                INSERT INTO notifications 
                (_id, title, message, type, expiry, roles, action_url)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [
                notification._id || null,
                notification.title,
                notification.message,
                notification.type || 'info',
                notification.expiry || null,
                JSON.stringify(notification.roles || null),
                notification.action_url || null
            ]);

            return result;
        } catch (error) {
            Logger.error('Fehler beim Erstellen der Benachrichtigung:', error);
            throw error;
        }
    }

    /**
     * Prüft, ob eine Update-Benachrichtigung für eine bestimmte Version existiert
     * @param {string} version
     * @returns {Promise<boolean>}
     */
    async notificationExistsForVersion(version) {
        const dbService = ServiceManager.get('dbService');
        const result = await dbService.query(
            `SELECT COUNT(*) AS count FROM notifications 
            WHERE type = 'info' 
            AND title = 'Update verfügbar!' 
            AND message LIKE ? 
            AND (expiry IS NULL OR expiry > NOW())`,
            [`%${version}%`]
        );
        return result[0].count > 0;
    }

    /**
     * Ruft alle aktiven Benachrichtigungen für einen Benutzer ab
     * @param {Object} user Benutzer-Objekt
     * @param {string} locale Benutzer-Locale (z.B. 'de-DE', 'en-GB')
     * @returns {Promise<Array>} Liste der aktiven Benachrichtigungen
     */
    async getNotificationsForUser(user, locale = 'de-DE') {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');

        try {
            // Benachrichtigungen abrufen die:
            // 1. Noch nicht abgelaufen sind (expiry > NOW oder expiry IS NULL)
            // 2. Noch nicht dismissed wurden
            // 3. Keine Rollen-Einschränkung haben ODER der Benutzer die Rolle hat
            const notifications = await dbService.query(`
                SELECT id, title_translations, message_translations, type, expiry, roles, dismissed, 
                    action_url, action_text_translations, created_at, updated_at
                FROM notifications 
                WHERE (expiry IS NULL OR expiry > NOW())
                AND dismissed = 0
                AND (roles IS NULL OR JSON_CONTAINS(roles, ?))
                ORDER BY created_at DESC
            `, [JSON.stringify(user?.roles || [])]);

            // User-spezifische dismissed IDs laden (falls User eingeloggt)
            let dismissedIds = [];
            if (user?.id) {
                try {
                    const userDismissed = await dbService.getUserConfig(user.id, 'core', 'DISMISSED_NOTIFICATIONS');
                    if (Array.isArray(userDismissed)) {
                        dismissedIds = userDismissed;
                        Logger.debug(`[NotificationManager] User ${user.id} hat ${dismissedIds.length} dismissed Notifications`);
                    }
                } catch (err) {
                    Logger.warn('[NotificationManager] Fehler beim Laden dismissed IDs:', err);
                }
            }

            // JSON-Spalten parsen und lokalisieren
            return notifications
                .filter(n => !dismissedIds.includes(n.id)) // Filter dismissed Notifications raus
                .map(n => {
                const titleTrans = JSON.parse(n.title_translations);
                const messageTrans = JSON.parse(n.message_translations);
                const actionTextTrans = n.action_text_translations ? JSON.parse(n.action_text_translations) : null;
                
                return {
                    id: n.id,
                    title: titleTrans[locale] || titleTrans['de-DE'] || '',
                    message: messageTrans[locale] || messageTrans['de-DE'] || '',
                    type: n.type,
                    expiry: n.expiry,
                    roles: n.roles ? JSON.parse(n.roles) : null,
                    dismissed: n.dismissed,
                    action_url: n.action_url,
                    action_text: actionTextTrans?.[locale] || actionTextTrans?.['de-DE'] || '',
                    created_at: n.created_at,
                    updated_at: n.updated_at
                };
            });
        } catch (error) {
            Logger.error('Fehler beim Abrufen der Benachrichtigungen:', error);
            return [];
        }
    }

    /**
     * Markiert eine Benachrichtigung als dismissed für einen User
     * @param {number} notificationId ID der Benachrichtigung
     * @param {string} userId Discord User ID
     * @returns {Promise<boolean>} Erfolg der Operation
     */
    async dismissNotification(notificationId, userId) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');

        if (!notificationId || !userId) {
            Logger.warn('[NotificationManager] dismissNotification: Missing notificationId or userId');
            return false;
        }

        try {
            // Lade aktuelle dismissed IDs für diesen User
            let dismissedIds = [];
            try {
                const userDismissed = await dbService.getUserConfig(userId, 'core', 'DISMISSED_NOTIFICATIONS');
                if (Array.isArray(userDismissed)) {
                    dismissedIds = userDismissed;
                }
            } catch (err) {
                Logger.debug('[NotificationManager] Keine dismissed IDs gefunden, erstelle neue Liste');
            }

            // Füge neue ID hinzu (wenn noch nicht vorhanden)
            if (!dismissedIds.includes(notificationId)) {
                dismissedIds.push(notificationId);
            }

            // Speichere aktualisierte Liste
            await dbService.setUserConfig(userId, 'core', 'DISMISSED_NOTIFICATIONS', dismissedIds);
            
            Logger.debug(`[NotificationManager] Notification ${notificationId} für User ${userId} dismissed`);
            return true;
        } catch (error) {
            Logger.error('Fehler beim Markieren der Benachrichtigung als dismissed:', error);
            return false;
        }
    }

    /**
     * Markiert Benachrichtigungen als gelesen (DEPRECATED - use dismissNotification)
     * @param {number[]} notificationIds Array von Benachrichtigungs-IDs
     * @returns {Promise<boolean>} Erfolg der Operation
     */
    async dismissNotifications(notificationIds) {
        const Logger = ServiceManager.get('Logger');
        Logger.warn('[NotificationManager] dismissNotifications (plural) ist deprecated, nutze dismissNotification (singular)');
        return false;
    }

    /**
     * Löscht abgelaufene Benachrichtigungen
     * @returns {Promise<number>} Anzahl der gelöschten Benachrichtigungen
     */
    async cleanupExpiredNotifications() {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');

        try {
            const result = await dbService.query(`
                DELETE FROM notifications 
                WHERE expiry IS NOT NULL 
                AND expiry < NOW()
            `);

            return result.affectedRows;
        } catch (error) {
            Logger.error('Fehler beim Aufräumen abgelaufener Benachrichtigungen:', error);
            return 0;
        }
    }
}

module.exports = NotificationManager;