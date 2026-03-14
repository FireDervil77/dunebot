/**
 * @file quotas.js
 * @description Quota-Management Routes für Masterserver-Plugin
 * @module plugins/masterserver/dashboard/routes/quotas
 * @author FireBot Development Team
 */

const express = require('express');
const router = express.Router();
const { ServiceManager } = require('dunebot-core');
const RootServer = require('../models/RootServer');
const QuotaProfile = require('../models/QuotaProfile');

/**
 * GET /guild/:guildId/plugins/masterserver/quotas
 * Zeigt Quota-Übersicht für alle Rootserver der Guild
 */
router.get('/', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const themeManager = ServiceManager.get('themeManager');
    const dbService = ServiceManager.get('dbService');
    
    // Guild-ID aus res.locals (Guild-Middleware)
    const guildId = res.locals.guildId || res.locals.guild?.id;
    
    if (!guildId) {
        Logger.error('[Quotas Route] Keine Guild-ID gefunden!');
        return res.status(400).render('error', {
            message: 'Ungültige Guild-ID',
            error: {}
        });
    }

    try {
        // 🔒 CHECK: Daemon muss registriert sein (egal ob online oder offline)
        
        const _rs = (await require("../models/RootServer").getByGuild(guildId))[0]; const daemon = _rs ? { ..._rs, status: _rs.daemon_status } : null;
        
        if (!daemon) {
            Logger.warn(`[Quotas Route] Kein Daemon für Guild ${guildId} - Redirect zu Setup`);
            return res.redirect(`/guild/${guildId}/plugins/masterserver/daemon`);
        }
        
        // Lade alle Quota-Profile
        const profiles = await QuotaProfile.getAll(true);

        // Lade Ressourcen-Übersicht für alle Rootserver dieser Guild
        const rootservers = await RootServer.getResourceSummaryByGuild(guildId);

        // Guild-Layout über ThemeManager laden
        res.locals.layout = themeManager.getLayout('guild');

        res.render('guild/quotas', {
            profiles,
            rootservers,
            pageTitle: 'Quota-Management',
            breadcrumbs: [
                { label: 'Masterserver', url: `/guild/${guildId}/plugins/masterserver` },
                { label: 'Quota-Management', active: true }
            ]
        });
    } catch (error) {
        Logger.error('[Quotas Route] Fehler beim Laden der Quota-Übersicht:', error);
        res.status(500).render('error', {
            message: 'Fehler beim Laden der Quota-Übersicht',
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
});

/**
 * GET /guild/:guildId/plugins/masterserver/quotas/rootserver/:rootserverId
 * Zeigt Detail-Ansicht für einen spezifischen Rootserver
 */
router.get('/rootserver/:rootserverId', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const { guildId, rootserverId } = req.params;

    try {
        // Lade Rootserver
        const rootserver = await RootServer.getById(rootserverId);
        if (!rootserver || rootserver.guild_id !== guildId) {
            return res.status(404).render('error', {
                message: 'Rootserver nicht gefunden'
            });
        }

        // Lade Quota-Daten
        const quota = await RootServer.getQuota(rootserverId);
        const resources = await RootServer.getAvailableResources(rootserverId);
        const profiles = await QuotaProfile.getAll(true);

        res.render('plugins/masterserver/quota-detail', {
            rootserver,
            quota,
            resources,
            profiles,
            pageTitle: `Quota: ${rootserver.name}`,
            breadcrumbs: [
                { label: 'Masterserver', url: `/guild/${guildId}/plugins/masterserver` },
                { label: 'Quota-Management', url: `/guild/${guildId}/plugins/masterserver/quotas` },
                { label: rootserver.name, active: true }
            ]
        });
    } catch (error) {
        Logger.error('[Quotas Route] Fehler beim Laden der Rootserver-Quota:', error);
        res.status(500).render('error', {
            message: 'Fehler beim Laden der Rootserver-Quota',
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
});

/**
 * POST /guild/:guildId/plugins/masterserver/quotas/rootserver/:rootserverId/initialize
 * Initialisiert Quota für einen Rootserver
 */
router.post('/rootserver/:rootserverId/initialize', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const guildId = res.locals.guildId;
    const { rootserverId } = req.params;
    const { profileId, customRamMB, customCpuCores, customDiskGB, reservedRamMB, reservedCpuCores, reservedDiskGB } = req.body;

    try {
        // Validierung: Rootserver gehört zur Guild
        const rootserver = await RootServer.getById(rootserverId);
        if (!rootserver || rootserver.guild_id !== guildId) {
            return res.status(404).json({
                success: false,
                message: 'Rootserver nicht gefunden'
            });
        }

        // Initialisiere Quota
        const config = {
            profileId: profileId || null,
            customRamMB: customRamMB || null,
            customCpuCores: customCpuCores || null,
            customDiskGB: customDiskGB || null,
            reservedRamMB: reservedRamMB || 2048,
            reservedCpuCores: reservedCpuCores || 1,
            reservedDiskGB: reservedDiskGB || 50
        };

        await RootServer.initializeQuota(rootserverId, config);

        Logger.info(`[Quotas Route] Quota initialisiert für Rootserver ${rootserverId} (Guild: ${guildId})`);

        res.json({
            success: true,
            message: 'Quota erfolgreich initialisiert'
        });
    } catch (error) {
        Logger.error('[Quotas Route] Fehler beim Initialisieren der Quota:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Fehler beim Initialisieren der Quota'
        });
    }
});

/**
 * PUT /guild/:guildId/plugins/masterserver/quotas/rootserver/:rootserverId
 * Aktualisiert Quota-Konfiguration eines Rootservers
 */
router.put('/rootserver/:rootserverId', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const { guildId, rootserverId } = req.params;
    const { profileId, customRamMB, customCpuCores, customDiskGB, reservedRamMB, reservedCpuCores, reservedDiskGB } = req.body;

    try {
        // Validierung: Rootserver gehört zur Guild
        const rootserver = await RootServer.getById(rootserverId);
        if (!rootserver || rootserver.guild_id !== guildId) {
            return res.status(404).json({
                success: false,
                message: 'Rootserver nicht gefunden'
            });
        }

        // Baue Updates-Objekt
        const updates = {};
        if (profileId !== undefined) updates.profile_id = profileId || null;
        if (customRamMB !== undefined) updates.custom_ram_mb = customRamMB || null;
        if (customCpuCores !== undefined) updates.custom_cpu_cores = customCpuCores || null;
        if (customDiskGB !== undefined) updates.custom_disk_gb = customDiskGB || null;
        if (reservedRamMB !== undefined) updates.reserved_ram_mb = reservedRamMB;
        if (reservedCpuCores !== undefined) updates.reserved_cpu_cores = reservedCpuCores;
        if (reservedDiskGB !== undefined) updates.reserved_disk_gb = reservedDiskGB;

        // Aktualisiere Quota
        await RootServer.updateQuota(rootserverId, updates);

        Logger.info(`[Quotas Route] Quota aktualisiert für Rootserver ${rootserverId} (Guild: ${guildId})`);

        res.json({
            success: true,
            message: 'Quota erfolgreich aktualisiert'
        });
    } catch (error) {
        Logger.error('[Quotas Route] Fehler beim Aktualisieren der Quota:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Fehler beim Aktualisieren der Quota'
        });
    }
});

/**
 * GET /guild/:guildId/plugins/masterserver/quotas/rootserver/:rootserverId/check
 * Prüft Ressourcen-Verfügbarkeit für einen geplanten Gameserver
 */
router.get('/rootserver/:rootserverId/check', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const { guildId, rootserverId } = req.params;
    const { ramMB, cpuCores, diskGB } = req.query;

    try {
        // Validierung: Rootserver gehört zur Guild
        const rootserver = await RootServer.getById(rootserverId);
        if (!rootserver || rootserver.guild_id !== guildId) {
            return res.status(404).json({
                success: false,
                message: 'Rootserver nicht gefunden'
            });
        }

        // Validierung: Ressourcen-Parameter
        const required = {
            ramMB: parseInt(ramMB) || 0,
            cpuCores: parseInt(cpuCores) || 0,
            diskGB: parseInt(diskGB) || 0
        };

        if (required.ramMB <= 0 || required.cpuCores <= 0 || required.diskGB <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Ungültige Ressourcen-Angaben'
            });
        }

        // Prüfe Verfügbarkeit
        const check = await RootServer.checkResourceAvailability(rootserverId, required);

        res.json({
            success: true,
            ...check
        });
    } catch (error) {
        Logger.error('[Quotas Route] Fehler beim Prüfen der Ressourcen:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Fehler beim Prüfen der Ressourcen'
        });
    }
});

/**
 * GET /guild/:guildId/plugins/masterserver/quotas/profiles
 * API-Endpoint: Liste aller Quota-Profile
 */
router.get('/profiles', async (req, res) => {
    const Logger = ServiceManager.get('Logger');

    try {
        const profiles = await QuotaProfile.getAll(true);
        res.json({
            success: true,
            profiles
        });
    } catch (error) {
        Logger.error('[Quotas Route] Fehler beim Laden der Profile:', error);
        res.status(500).json({
            success: false,
            message: 'Fehler beim Laden der Profile'
        });
    }
});

module.exports = router;
