/**
 * @file quotas.router.js
 * @description Quota-Management Routes (Pterodactyl-Style)
 * @module plugins/masterserver/dashboard/routes/quotas
 */

const express = require('express');
const router = express.Router();
const { ServiceManager } = require('dunebot-core');
const { requirePermission } = require('../../../../apps/dashboard/middlewares/permissions.middleware');
const RootServer = require('../models/RootServer');

// Die frühere lokale `autoInitQuota()` liegt jetzt als `RootServer.ensureQuota()`
// im Modell — die Kapazitätsprüfung beim Anlegen eines Gameservers braucht
// dieselbe Vorbelegung, und zwei Kopien davon wären zwei Wahrheiten.
const autoInitQuota = (rootserver) => RootServer.ensureQuota(rootserver);

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Allokierte Ressourcen aller Gameserver eines RootServers
//
// Gezählt wird `gameservers` — der einzige Ort, an dem Ressourcen wirklich
// gebucht werden. Vorher stand hier `gameserver_quotas`, eine Tabelle, in die
// nie ein INSERT ging; die Seite meldete deshalb dauerhaft 0 % Auslastung.
// `allocated_cpu_percent` zählt Prozent eines Kerns (100 = 1 Kern), die
// RootServer-Quota zählt Kerne — daher die Division.
// ─────────────────────────────────────────────────────────────────────────────
async function getAllocatedResources(rootserverId, dbService) {
    const leer = { allocated_ram_mb: 0, allocated_cpu_cores: 0, allocated_disk_gb: 0, server_count: 0 };
    try {
        const [row] = await dbService.query(
            `SELECT
                COALESCE(SUM(allocated_ram_mb),      0)       AS allocated_ram_mb,
                COALESCE(SUM(allocated_cpu_percent), 0) / 100 AS allocated_cpu_cores,
                COALESCE(SUM(allocated_disk_gb),     0)       AS allocated_disk_gb,
                COUNT(*)                                      AS server_count
             FROM gameservers WHERE rootserver_id = ?`,
            [rootserverId]
        );
        return row || leer;
    } catch (_) {
        return leer;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Gameserver-Liste eines RootServers samt gebuchter Ressourcen
//
// Ausgangspunkt ist `gameservers` (nach rootserver_id), nicht mehr
// `server_registry` (nach daemon_id): ein Daemon kann mehrere RootServer
// bedienen, die Zuordnung über die daemon_id warf deren Server zusammen.
// `server_registry` liefert nur noch die Live-Messwerte dazu.
// ─────────────────────────────────────────────────────────────────────────────
async function getGameserversWithQuotas(rootserverId, dbService) {
    try {
        return await dbService.query(
            `SELECT gs.id, gs.id AS server_id, gs.name AS server_name,
                    gs.template_name AS server_type, gs.status,
                    gs.allocated_ram_mb, gs.allocated_cpu_percent, gs.allocated_disk_gb,
                    sr.ram_used_mb  AS current_ram_usage_mb,
                    sr.cpu_percent  AS current_cpu_usage_percent
             FROM gameservers gs
             LEFT JOIN server_registry sr ON sr.server_id = gs.id
             WHERE gs.rootserver_id = ?
             ORDER BY gs.name ASC`,
            [rootserverId]
        );
    } catch (_) {
        return [];
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /  – Quota-Übersicht (Pterodactyl Node-Style)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', requirePermission('MASTERSERVER.RESOURCES.VIEW'), async (req, res) => {
    const Logger       = ServiceManager.get('Logger');
    const themeManager = ServiceManager.get('themeManager');
    const dbService    = ServiceManager.get('dbService');
    const guildId      = res.locals.guildId;

    try {
        const allRootservers = await RootServer.getByGuild(guildId);
        if (!allRootservers.length) {
            return res.redirect(`/guild/${guildId}/plugins/masterserver/rootservers`);
        }

        const nodes = await Promise.all(allRootservers.map(async (rs) => {
            const quota      = await autoInitQuota(rs, dbService);
            const allocated  = await getAllocatedResources(rs.id, dbService);
            const gameservers = await getGameserversWithQuotas(rs.id, dbService);

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
router.put('/rootserver/:rootserverId/overallocation', requirePermission('MASTERSERVER.RESOURCES.MANAGE'), async (req, res) => {
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
router.put('/rootserver/:rootserverId/reserved', requirePermission('MASTERSERVER.RESOURCES.MANAGE'), async (req, res) => {
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
router.get('/rootserver/:rootserverId/check', requirePermission('MASTERSERVER.RESOURCES.VIEW'), async (req, res) => {
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
