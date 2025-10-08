/**
 * Greeting Plugin - Basis Settings Router
 * Handles base-level plugin routes (non-guild-specific)
 * 
 * @module greeting/dashboard/routes/settings
 * @author DuneBot Team
 */

const express = require('express');
const router = express.Router();

/**
 * GET /plugins/greeting/settings
 * Plugin-Einstellungen (system-weit, falls benötigt)
 */
router.get('/settings', async (req, res) => {
    const { ServiceManager } = require('dunebot-core');
    const themeManager = ServiceManager.get('themeManager');
    
    // Für Greeting gibt es aktuell keine system-weiten Settings
    // Alle Settings sind guild-spezifisch
    
    await themeManager.renderView(res, 'greeting/settings', {
        title: 'Greeting Plugin - Einstellungen',
        activeMenu: '/plugins/greeting/settings'
    });
});

module.exports = router;
