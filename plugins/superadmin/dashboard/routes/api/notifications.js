/**
 * SuperAdmin API - Notifications
 * 
 * API-Routen für das Notifications-Widget
 * 
 * @author FireDervil
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { ServiceManager } = require('dunebot-core');
const { NotificationHelper } = require('dunebot-sdk/utils');

/**
 * Config laden
 */
function loadConfig() {
    const configPath = path.join(__dirname, '..', '..', 'config.json');
    
    if (fs.existsSync(configPath)) {
        try {
            return JSON.parse(fs.readFileSync(configPath, 'utf8'));
        } catch (error) {
            return {};
        }
    }
    
    return {};
}

/**
 * POST /send
 * Erstellt eine neue Notification in der Datenbank (nur speichern, nicht an Discord senden)
 * 
 * Body:
 * - title: string
 * - message: string
 * - type: string (info, warning, success, danger)
 * - target: string ('all' | 'specific')
 * - target_guild_id: string (falls target='specific')
 */
router.post('/send', async (req, res) => {
    try {
        const logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');
        
        // Owner-Check direkt in der Route
        const user = res.locals.user || req.session?.user;
        const guildId = res.locals.guildId || req.params.guildId;
        const config = loadConfig();
        const ownerId = config.BOT_OWNER_ID || process.env.OWNER_IDS?.split(',')[0];
        const controlGuildId = process.env.CONTROL_GUILD_ID;
        
        const isOwner = user && String(user.info?.id) === String(ownerId);
        const isControlGuild = String(guildId) === String(controlGuildId);
        
        if (!isOwner || !isControlGuild) {
            return res.status(403).json({ 
                success: false, 
                message: 'Nur für Bot-Owner in der Control-Guild!' 
            });
        }
        
        const {
            title,
            message,
            type = 'info',
            target,
            target_guild_id
        } = req.body;

        // Validierung
        if (!title || !message) {
            return res.status(400).json({ 
                success: false, 
                message: 'Titel und Nachricht sind erforderlich' 
            });
        }

        logger.debug('[SuperAdmin Notifications API] Erstelle Notification:', {
            title,
            type,
            target,
            target_guild_id
        });

        // Übersetzungen vorbereiten (erst mal nur Deutsch)
        const translations = {
            title: {
                'de-DE': title,
                'en-GB': title // Fallback
            },
            message: {
                'de-DE': message,
                'en-GB': message // Fallback
            },
            action_text: {
                'de-DE': 'Mehr erfahren',
                'en-GB': 'Learn more'
            }
        };

        // Metadata
        const metadata = {
            type,
            action_url: null,
            expiry: null,
            roles: null,
            dismissed: 0,
            delivery_method: 'dashboard', // WICHTIG: Nur Dashboard, nicht Discord!
            target_guild_ids: target === 'specific' ? JSON.stringify([target_guild_id]) : null,
            discord_channel_id: null
        };

        // prepareNotificationForDB nutzen
        const notificationData = NotificationHelper.prepareNotificationForDB(translations, metadata);

        // In Datenbank speichern
        const [result] = await dbService.query(`
            INSERT INTO notifications 
            (title_translations, message_translations, action_text_translations,
             type, action_url, expiry, roles, dismissed,
             delivery_method, target_guild_ids, discord_channel_id,
             created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, NOW(), NOW())
        `, [
            notificationData.title_translations,
            notificationData.message_translations,
            notificationData.action_text_translations,
            notificationData.type,
            notificationData.action_url,
            notificationData.expiry,
            notificationData.roles,
            metadata.delivery_method,
            metadata.target_guild_ids,
            metadata.discord_channel_id
        ]);

        // Berechne Anzahl betroffener Guilds
        let targetCount = 0;
        if (target === 'all') {
            const guildCountResult = await dbService.query('SELECT COUNT(*) as count FROM guilds');
            targetCount = guildCountResult[0]?.count || 0;
        } else if (target === 'specific' && target_guild_id) {
            targetCount = 1;
        }

        logger.info('[SuperAdmin Notifications API] Notification erstellt:', {
            id: result.insertId,
            target,
            targetCount
        });

        res.json({ 
            success: true, 
            message: 'Notification erfolgreich erstellt',
            count: targetCount,
            notificationId: result.insertId
        });

    } catch (error) {
        const logger = ServiceManager.get('Logger');
        logger.error('[SuperAdmin Notifications API] Fehler beim Erstellen der Notification:', error);

        res.status(500).json({ 
            success: false, 
            message: 'Serverfehler beim Erstellen der Notification' 
        });
    }
});

module.exports = router;