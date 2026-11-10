/**
 * Verwaltet globale Benachrichtigungen für das Dashboard
 * @author FireDervil
 */
const { ServiceManager } = require("dunebot-core");

/**
 * Verwaltet globale Benachrichtigungen für das Dashboard
 * @author FireDervil
 */
/**
 * Kennung einer Meldung, wie sie in DISMISSED_NOTIFICATIONS steht.
 *
 * Zahlen für Zeilen aus `notifications`, Text für Meldungen, die ein Plugin
 * zur Laufzeit beisteuert (Filter `guild_notices`, etwa
 * `daemon-update-54-1.0.103`). Bis zum 2026-09-26 wurde jede Kennung mit
 * Number() gespeichert — aus einer Textkennung wurde NaN, und das Wegklicken
 * hielt nicht.
 *
 * @returns {number|string|null} null, wenn die Kennung keine ist
 */
function normalisiereKennung(id) {
    const text = String(id ?? '').trim();
    if (/^\d+$/.test(text)) return Number(text);
    if (/^[a-z][a-z0-9.:-]{0,99}$/i.test(text)) return text;
    return null;
}

class NotificationManager {
    constructor() {
        const Logger = ServiceManager.get('Logger');
        Logger.debug('NotificationManager wird initialisiert');
    }

    /**
     * Eine Meldung in `notifications` anlegen.
     *
     * **Der einzige Weg in die Tabelle.** Bis zum 2026-11-10 schrieb diese
     * Funktion in Spalten, die es seit der Mehrsprachigkeit (Migration
     * 20260327_111415) nicht mehr gibt (`_id`, `title`, `message`), und der
     * Admin-Bereich hatte drei eigene `INSERT` daneben (K360). Jetzt rufen die
     * ihn hier.
     *
     * @param {Object} translations `{title, message, action_text}`, je `{ 'de-DE': …, 'en-GB': … }`
     * @param {Object} [metadata] type, category, action_url, expiry, roles,
     *   delivery_method (JSON-Text), target_guild_ids (JSON-Text), discord_channel_id
     * @returns {Promise<{id: number, daten: Object}>} neue Kennung und die
     *   aufbereiteten Daten (für den Discord-Versand per IPC)
     */
    async addNotification(translations, metadata = {}) {
        const daten = this.#aufbereiten(translations, metadata);
        const result = await ServiceManager.get('dbService').query(`
            INSERT INTO notifications
            (title_translations, message_translations, action_text_translations,
             type, category, action_url, expiry, roles, dismissed,
             delivery_method, target_guild_ids, discord_channel_id,
             created_at, updated_at)
            VALUES (?,?,?,?,?,?,?,?,0,?,?,?,NOW(),NOW())
        `, this.#spalten(daten));
        return { id: result.insertId, daten };
    }

    /**
     * Eine Meldung ändern. Was schon in Discord steht, bleibt dort stehen.
     *
     * @param {number|string} id Kennung
     * @param {Object} translations wie bei `addNotification`
     * @param {Object} [metadata] wie bei `addNotification`
     * @returns {Promise<boolean>} true, wenn es die Zeile gab
     */
    async updateNotification(id, translations, metadata = {}) {
        const daten = this.#aufbereiten(translations, metadata);
        const result = await ServiceManager.get('dbService').query(`
            UPDATE notifications SET title_translations=?, message_translations=?,
            action_text_translations=?, type=?, category=?, action_url=?, expiry=?, roles=?,
            delivery_method=?, target_guild_ids=?, discord_channel_id=?, updated_at=NOW()
            WHERE id=?
        `, [...this.#spalten(daten), id]);
        return Number(result?.affectedRows) > 0;
    }

    /**
     * Eine Meldung löschen. Was schon in Discord steht, bleibt dort stehen.
     *
     * @param {number|string} id Kennung
     * @returns {Promise<boolean>} true, wenn es die Zeile gab
     */
    async deleteNotification(id) {
        const result = await ServiceManager.get('dbService').query(
            'DELETE FROM notifications WHERE id = ?', [id]);
        return Number(result?.affectedRows) > 0;
    }

    /**
     * @param {Object} translations Übersetzungen
     * @param {Object} metadata Metadaten
     * @returns {Object} Zeile, wie sie in die Tabelle geht
     */
    #aufbereiten(translations, metadata) {
        const { prepareNotificationForDB } = require('./utils/NotificationHelper');
        return prepareNotificationForDB(translations || {}, {
            ...metadata,
            type: metadata.type || 'info',
            // Dieselben Vorgaben wie die Tabelle selbst.
            category: metadata.category || 'announcement',
            delivery_method: metadata.delivery_method || '["dashboard"]',
            action_url: metadata.action_url || null,
            expiry: metadata.expiry || null,
            roles: Array.isArray(metadata.roles) ? JSON.stringify(metadata.roles) : (metadata.roles || null),
            target_guild_ids: metadata.target_guild_ids || null,
            discord_channel_id: metadata.discord_channel_id || null,
            dismissed: 0
        });
    }

    /**
     * @param {Object} d aufbereitete Zeile
     * @returns {Array} Werte in der Spaltenfolge von INSERT und UPDATE
     */
    #spalten(d) {
        return [d.title_translations, d.message_translations, d.action_text_translations,
            d.type, d.category, d.action_url, d.expiry, d.roles,
            d.delivery_method, d.target_guild_ids, d.discord_channel_id];
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
                AND (delivery_method IS NULL OR delivery_method LIKE '%dashboard%')
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

            // Dismissed IDs als Set mit String-Vergleich (robust gegen String/Number-Mismatch)
            const dismissedSet = new Set(dismissedIds.map(String));

            // JSON-Spalten parsen und lokalisieren
            return notifications
                .filter(n => !dismissedSet.has(String(n.id))) // Filter dismissed Notifications raus
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
                // Cleanup: Alle Einträge laden und zusammenführen (falls Duplikate von NULL-UNIQUE-Bug)
                const allRows = await dbService.query(
                    "SELECT id, config_value FROM user_configs WHERE user_id = ? AND plugin_name = 'core' AND config_key = 'DISMISSED_NOTIFICATIONS' AND guild_id IS NULL ORDER BY updated_at DESC",
                    [userId]
                );
                if (allRows && allRows.length > 0) {
                    // Alle IDs aus allen Einträgen zusammenführen
                    const mergedIds = new Set();
                    for (const row of allRows) {
                        try {
                            const parsed = JSON.parse(row.config_value);
                            if (Array.isArray(parsed)) parsed.forEach(id => {
                                const k = normalisiereKennung(id);
                                if (k !== null) mergedIds.add(k);
                            });
                        } catch {}
                    }
                    dismissedIds = [...mergedIds];
                    
                    // Duplikate löschen (alle bis auf den neuesten)
                    if (allRows.length > 1) {
                        const keepId = allRows[0].id;
                        const deleteIds = allRows.slice(1).map(r => r.id);
                        await dbService.query(
                            "DELETE FROM user_configs WHERE id IN (?)",
                            [deleteIds]
                        );
                        Logger.debug(`[NotificationManager] ${deleteIds.length} Duplikat-Einträge bereinigt für User ${userId}`);
                    }
                }
            } catch (err) {
                Logger.debug('[NotificationManager] Keine dismissed IDs gefunden, erstelle neue Liste');
            }

            // Füge neue ID hinzu (wenn noch nicht vorhanden) — Zahl oder Text.
            const kennung = normalisiereKennung(notificationId);
            if (kennung === null) {
                Logger.warn(`[NotificationManager] dismissNotification: unbrauchbare Kennung ${JSON.stringify(notificationId)}`);
                return false;
            }
            if (!dismissedIds.includes(kennung)) {
                dismissedIds.push(kennung);
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
     * Die Meldungen ohne die, die dieser Nutzer weggeklickt hat — für Meldungen,
     * die nicht aus `notifications` kommen (Filter `guild_notices`).
     *
     * @param {string|null} userId
     * @param {Array<{id: string|number}>} liste
     * @returns {Promise<Array>}
     */
    async ohneWeggeklickte(userId, liste) {
        if (!userId || !Array.isArray(liste) || liste.length === 0) return liste || [];
        const dbService = ServiceManager.get('dbService');
        const weg = await dbService.getUserConfig(userId, 'core', 'DISMISSED_NOTIFICATIONS');
        const set = new Set((Array.isArray(weg) ? weg : []).map(String));
        return liste.filter(n => !set.has(String(n.id)));
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
module.exports.normalisiereKennung = normalisiereKennung;