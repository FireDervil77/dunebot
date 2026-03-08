/**
 * Kern API-Router
 * Routes: /api/core/*
 *
 * Kombiniert Toast-Logger, Donations und Notification-Dismiss APIs.
 * Ersetzt die Core-Plugin API-Routen.
 *
 * @author FireDervil
 */

const express = require('express');
const router = express.Router();
const { ServiceManager } = require('dunebot-core');

// Toast-Logger API
router.use('/toasts', require('./toast-logger'));

// Donations / Stripe API
router.use('/donate', require('./create-donation'));

// POST /dismiss-notification
router.post('/dismiss-notification', async (req, res) => {
    const Logger = ServiceManager.get('Logger');

    try {
        const { notificationId } = req.body;

        if (!notificationId) {
            return res.status(400).json({
                success: false,
                message: 'Notification-ID erforderlich'
            });
        }

        if (!req.session?.user?.id) {
            return res.status(401).json({
                success: false,
                message: 'Nicht authentifiziert'
            });
        }

        const userId = req.session.user.id;

        const current = await req.userConfig.get('core', 'DISMISSED_NOTIFICATIONS');
        const dismissed = Array.isArray(current) ? current : [];

        if (!dismissed.includes(parseInt(notificationId))) {
            dismissed.push(parseInt(notificationId));
            await req.userConfig.set('core', 'DISMISSED_NOTIFICATIONS', dismissed);
            Logger.debug(`[KernAPI] User ${userId} dismissed Notification #${notificationId}`);
        }

        res.json({
            success: true,
            message: 'Notification erfolgreich ausgeblendet'
        });
    } catch (error) {
        Logger.error('[KernAPI] Fehler beim Dismiss der Notification:', error);
        res.status(500).json({
            success: false,
            message: 'Serverfehler beim Ausblenden'
        });
    }
});

module.exports = router;
