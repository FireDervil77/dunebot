/**
 * @file quotas.router.js
 * @description Quota-Management Routes (Pterodactyl-Style)
 * @module plugins/masterserver/dashboard/routes/quotas
 */

const express = require('express');
const router = express.Router();
const { ServiceManager } = require('dunebot-core');
const RootServer = require('../models/RootServer');

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Quota für RootServer auto-initialisieren (aus Hardware-Daten)
// ─────────────────────────────────────────────────────────────────────────────
async function autoInitQuota(rootserver, dbService) {
    const existing = await RootServer.getQuota(rootserver.id);
    if (existing) return existing;

    const ramMB    = rootserver.ram_total_gb  ? Math.round(rootserver.ram_total_gb  * 1024) : 4096;
    const cpuCores = rootserver.cpu_cores     || 4;
    const diskGB   = rootserver.disk_total_gb ? Math.round(rootserver.disk_total_gb)        : 100;

    try {
        await RootServer.initializeQuota(rootserver.id, {
            customRamMB:    ramMB,
            customCpuCores: cpuCores,
            customDiskGB:   diskGB,
            reservedRamMB:  1024,
            reservedCpuCores: 0,
            reservedDiskGB: 10
        });
        return await RootServer.getQuota(rootserver.id);
    } catch (_) {
        return await RootServer.getQuota(rootserver.id);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Allokierte Ressourcen aller Gameserver eines RootServers
// ─────────────────────────────────────────────────────────────────────────────
async function getAllocatedResources(rootserverId, dbService) {
    try {
        const [row] = await dbService.query(
            `SELECT
                COALESCE(SUM(gq.allocated_ram_mb),    0) AS allocated_ram_mb,
                COALESCE(SUM(gq.allocated_cpu_cores), 0) AS allocated_cpu_cores,
                COALESCE(SUM(gq.allocated_disk_gb),   0) AS allocated_disk_gb,
                COUNT(gq.id)                             AS server_count
             FROM gameserver_quotas gq WHERE gq.rootserver_id = ?`,
            [rootserverId]
        );
        return row || { allocated_ram_mb: 0, allocated_cpu_cores: 0, allocated_disk_gb: 0, server_count: 0 };
    } catch (_) {
        return { allocated_ram_mb: 0, allocated_cpu_cores: 0, allocated_disk_gb: 0, server_count: 0 };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Gameserver-Liste mit Quota-Daten
// ─────────────────────────────────────────────────────────────────────────────
async function getGameserversWithQuotas(daemonId, dbService) {
    try {
        return await dbService.query(
            `SELECT sr.id, sr.server_id, sr.server_name, sr.server_type, sr.status,
                    gq.allocated_ram_mb, gq.allocated_cpu_cores, gq.allocated_disk_gb,
                    gq.current_ram_usage_mb, gq.current_cpu_usage_percent
             FROM server_registry sr
             LEFT JOIN gameserver_quotas gq ON sr.id = gq.gameserver_id
             WHERE sr.daemon_id = ?
             ORDER BY sr.server_name ASC`,
            [daemonId]
        );
    } catch (_) {
        return [];
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /  – Quota-Übersicht (Pterodactyl Node-Style)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
    const Logger       = ServiceManager.get('Logger');
    const themeManager = ServiceManager.get('themeManager');
    const dbService    = ServiceManager.get('dbService');
    const guildId      = res.locals.guildId;

    try {
        const allRootservers = await RootServer.getByGuild(guildId);
        if (!allRootservers.length) {
            return res.redirect(`/guild/${guildId}/plugins/masterserver/daemon`);
        }

        const nodes = await Promise.all(allRootservers.map(async (rs) => {
            const quota      = await autoInitQuota(rs, dbService);
            const allocated  = await getAllocatedResources(rs.id, dbService);
            const gameservers = await getGameserversWithQuotas(rs.daemon_id, dbService);

            const overRam  = quota?.overallocate_ram_percent  ?? 0;
            const overDisk = quota?.overallocate_disk_percent ?? 0;

            const totalRamMB   = quota ? Math.round(quota.effective_ram_mb  * (1 + overRam  / 100)) : 0;
            const totalCpuCores = quota?.effective_cpu_cores ?? 0;
            const totalDiskGB  = quota ? Math.round(quota.effective_disk_gb * (1 + overDisk / 100)) : 0;

            const reservedRamMB  = quota?.reserved_ram_mb  ?? 0;
            const reservedDiskGB = quota?.reserved_disk_gb ?? 0;

            const usableRamMB  = Math.max(0, totalRamMB  - reservedRamMB);
            const usableDiskGB = Math.max(0, totalDiskGB - reservedDiskGB);

            const ramPct  = usableRamMB  > 0 ? Math.min(100, Math.round((allocated.allocated_ram_mb  / usableRamMB)  * 100)) : 0;
            const diskPct = usableDiskGB > 0 ? Math.min(100, Math.round((allocated.allocated_disk_gb / usableDiskGB) * 100)) : 0;
            const cpuPct  = totalCpuCores > 0 ? Math.min(100, Math.round((allocated.allocated_cpu_cores / totalCpuCores) * 100)) : 0;

            return {
                ...rs,
                quota,
                allocated,
                gameservers,
                limits: { totalRamMB, usableRamMB, reservedRamMB, totalCpuCores, totalDiskGB, usableDiskGB, reservedDiskGB, overRam, overDisk },
                usage:  { ramPct, diskPct, cpuPct }
            };
        }));

        await themeManager.renderView(res, 'guild/quotas', { nodes, guildId, pageTitle: 'Ressourcen-Management' });

    } catch (error) {
        Logger.error('[Quotas] Fehler:', error);
        res.status(500).render('error', {
            message: 'Fehler beim Laden des Ressourcen-Managements',
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /rootserver/:id/overallocation
// ─────────────────────────────────────────────────────────────────────────────
router.put('/rootserver/:rootserverId/overallocation', async (req, res) => {
    const Logger    = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const guildId   = res.locals.guildId;
    const { rootserverId } = req.params;
    const { overallocateRam, overallocateDisk } = req.body;

    try {
        const rs = await RootServer.getById(rootserverId);
        if (!rs || rs.guild_id !== guildId) return res.status(404).json({ success: false, message: 'Nicht gefunden' });

        await autoInitQuota(rs, dbService);

        const overRam  = Math.max(0, Math.min(300, parseInt(overallocateRam)  || 0));
        const overDisk = Math.max(0, Math.min(300, parseInt(overallocateDisk) || 0));

        await dbService.query(
            `UPDATE rootserver_quotas SET overallocate_ram_percent = ?, overallocate_disk_percent = ? WHERE rootserver_id = ?`,
            [overRam, overDisk, rootserverId]
        );

        Logger.info(`[Quotas] Overallocation: RS ${rootserverId} RAM=${overRam}% Disk=${overDisk}%`);
        res.json({ success: true, overRam, overDisk });
    } catch (error) {
        Logger.error('[Quotas] Overallocation Fehler:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /rootserver/:id/reserved
// ─────────────────────────────────────────────────────────────────────────────
router.put('/rootserver/:rootserverId/reserved', async (req, res) => {
    const dbService = ServiceManager.get('dbService');
    const guildId   = res.locals.guildId;
    const { rootserverId } = req.params;
    const { reservedRamMB, reservedDiskGB } = req.body;

    try {
        const rs = await RootServer.getById(rootserverId);
        if (!rs || rs.guild_id !== guildId) return res.status(404).json({ success: false, message: 'Nicht gefunden' });

        await autoInitQuota(rs, dbService);

        await dbService.query(
            `UPDATE rootserver_quotas SET reserved_ram_mb = ?, reserved_disk_gb = ? WHERE rootserver_id = ?`,
            [Math.max(0, parseInt(reservedRamMB) || 0), Math.max(0, parseInt(reservedDiskGB) || 0), rootserverId]
        );
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /rootserver/:id/check  – Verfügbarkeit prüfen
// ─────────────────────────────────────────────────────────────────────────────
router.get('/rootserver/:rootserverId/check', async (req, res) => {
    const guildId = res.locals.guildId;
    const { rootserverId } = req.params;
    const { ramMB, cpuCores, diskGB } = req.query;

    try {
        const rs = await RootServer.getById(rootserverId);
        if (!rs || rs.guild_id !== guildId) return res.status(404).json({ success: false, message: 'Nicht gefunden' });

        const check = await RootServer.checkResourceAvailability(rootserverId, {
            ramMB:    parseInt(ramMB)    || 0,
            cpuCores: parseInt(cpuCores) || 0,
            diskGB:   parseInt(diskGB)   || 0
        });
        res.json({ success: true, ...check });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
