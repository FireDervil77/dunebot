const express = require('express');
const router = express.Router();

// Route Konfiguration
router.config = {
    path: '/guild/:guildId/plugins/moderation',
    auth: true,
    navigation: {
        section: 'guild',
        item: {
            title: 'Moderation',
            icon: 'fa-cogs',
            order: 50,
            items: [
                { 
                    title: 'Karte',
                    path: '/guild/:guildId/plugins/moderation',
                    icon: 'fa-map-marked'
                },
                {
                    title: 'Einstellungen',
                    path: '/guild/:guildId/plugins/moderation/settings',
                    icon: 'fa-cogs'
                }
            ]
        }
    }
};

module.exports = router;