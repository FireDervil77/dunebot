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
     * @returns {Promise<Array>} Liste der aktiven Benachrichtigungen
     */
    async getNotificationsForUser(user) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');

        try {
            // Benachrichtigungen abrufen die:
            // 1. Noch nicht abgelaufen sind (expiry > NOW oder expiry IS NULL)
            // 2. Noch nicht dismissed wurden
            // 3. Keine Rollen-Einschränkung haben ODER der Benutzer die Rolle hat
            const notifications = await dbService.query(`
                SELECT id, title, message, type, expiry, roles, dismissed, 
                    action_url, action_text, created_at, updated_at
                FROM notifications 
                WHERE (expiry IS NULL OR expiry > NOW())
                AND dismissed = 0
                AND (roles IS NULL OR JSON_CONTAINS(roles, ?))
                ORDER BY created_at DESC
            `, [JSON.stringify(user?.roles || [])]);

            return notifications.map(n => ({
                ...n,
                roles: n.roles ? JSON.parse(n.roles) : null
            }));
        } catch (error) {
            Logger.error('Fehler beim Abrufen der Benachrichtigungen:', error);
            return [];
        }
    }

    /**
     * Markiert Benachrichtigungen als gelesen
     * @param {number[]} notificationIds Array von Benachrichtigungs-IDs
     * @returns {Promise<boolean>} Erfolg der Operation
     */
    async dismissNotifications(notificationIds) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');

        if (!Array.isArray(notificationIds) || notificationIds.length === 0) {
            return false;
        }

        try {
            await dbService.query(`
                UPDATE notifications 
                SET dismissed = 1 
                WHERE _id = ?
            `, [notificationId]);
            
            return true;
        } catch (error) {
            Logger.error('Fehler beim Markieren der Benachrichtigung:', error);
            return false;
        }
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