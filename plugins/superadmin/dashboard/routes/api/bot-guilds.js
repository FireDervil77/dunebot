/**
 * API Route: Bot-Guilds abrufen via IPC
 * Ruft GET_BOT_GUILDS vom Bot ab
 * @author DuneBot Team
 */

const express = require('express');
const router = express.Router();
const { ServiceManager } = require('dunebot-core');

router.get('/', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const ipcServer = ServiceManager.get('ipcServer');
    
    try {
        Logger.debug('[SuperAdmin API] Bot-Guilds werden abgerufen...');
        
        // IPC-Call zum Bot
        const result = await ipcServer.broadcastOne('dashboard:GET_BOT_GUILDS', {}, true);
        
        if (result && result.success && result.data) {
            Logger.debug(`[SuperAdmin API] ${result.data.length} Guilds vom Bot empfangen`);
            
            return res.json({
                success: true,
                guilds: result.data
            });
        } else {
            Logger.warn('[SuperAdmin API] Bot-Guilds-Abfrage fehlgeschlagen:', result);
            return res.status(500).json({
                success: false,
                error: 'Fehler beim Abrufen der Bot-Guilds'
            });
        }
    } catch (error) {
        Logger.error('[SuperAdmin API] Fehler beim Abrufen der Bot-Guilds:', error);
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;
