const express = require('express');
const router = express.Router();

// Route Konfiguration
router.config = {
    path: '/guild/:guildId/plugins/dunemap',
    auth: true,
    navigation: {
        section: 'guild',
        item: {
            title: 'DuneMap',
            icon: 'fa-map',
            order: 50,
            items: [
                { 
                    title: 'Karte',
                    path: '/guild/:guildId/plugins/dunemap',
                    icon: 'fa-map-marked'
                },
                {
                    title: 'Einstellungen',
                    path: '/guild/:guildId/plugins/dunemap/settings',
                    icon: 'fa-cogs'
                }
            ]
        }
    }
};

module.exports = router;