/**
 * Gameserver File Management Routes (WebFTP)
 * Dateisystem-Zugriff für Gameserver via IPM
 * 
 * @module routes/files
 * @author FireBot Team
 */

const express = require('express');
const router = express.Router();
const { ServiceManager } = require('dunebot-core');
const path = require('path');
const { requirePermission } = require('../../../../apps/dashboard/middlewares/permissions.middleware');
// Grenze und Annahme liegen im Helfer — die Inhalte-Seite benutzt dieselben.
const { nimmDatei, MAX_UPLOAD_BYTES } = require('../helpers/DateiAnnahme');
const { gesperrt, ladeSperrliste } = require('../helpers/Sperrliste');

// Helper Functions
function isEditable(filename, size) {
    const ext = path.extname(filename).toLowerCase();
    if (size > 10 * 1024 * 1024) return false;
    const editableExts = ['.cfg', '.ini', '.json', '.yaml', '.txt', '.log', '.conf', '.sh', '.lua', '.py', '.js', '.xml', '.html', '.css', '.md'];
    return editableExts.includes(ext);
}

async function validateServerAccess(serverId, guildId) {
    const dbService = ServiceManager.get('dbService');
    const [server] = await dbService.query(
        `SELECT gs.*, r.daemon_id
         FROM gameservers gs
         LEFT JOIN rootserver r ON gs.rootserver_id = r.id
         WHERE gs.id = ? AND gs.guild_id = ?`,
        [serverId, guildId]
    );
    if (!server) throw new Error('Server nicht gefunden');
    const ipmServer = ServiceManager.get('ipmServer');
    if (!ipmServer || !ipmServer.isDaemonOnline(server.daemon_id)) {
        const err = new Error('Daemon nicht verbunden – Server ist offline oder nicht erreichbar');
        err.statusCode = 503;
        throw err;
    }
    return server;
}

function formatFileSize(bytes) {
    if (!bytes) return '-';
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes, i = 0;
    while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
    return `${size.toFixed(1)} ${units[i]}`;
}

/**
 * Sperrliste des Pakets gegen ALLE Pfade prüfen, die eine Anfrage berührt —
 * Quelle und Ziel, jede Datei eines Stapels. Antwortet selbst mit 403 und
 * gibt dann `true` zurück. Seit dem 2026-09-26 an jeder Route, die einen Pfad
 * annimmt; bis dahin prüften nur Liste, Lesen, Schreiben und Löschen, und die
 * Liste kam aus dem Egg (Egg-Rückbau C3).
 */
async function sperrt(res, server, pfade) {
    const liste = await ladeSperrliste(ServiceManager.get('dbService'), server);
    const treffer = pfade.filter(p => gesperrt(p, liste));
    if (treffer.length === 0) return false;
    res.status(403).json({
        success: false,
        error: `Gesperrt durch das Spielpaket: ${treffer.join(', ')}`,
        gesperrt: treffer,
    });
    return true;
}

// ROUTES
router.get('/servers/:serverId/files', requirePermission('GAMESERVER.FILES.VIEW'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const ipmServer = ServiceManager.get('ipmServer');
    try {
        const { serverId } = req.params;
        const guildId = res.locals.guildId;
        const requestedPath = req.query.path || '/';
        const server = await validateServerAccess(serverId, guildId);
        
        const response = await ipmServer.sendCommand(server.daemon_id, 'gameserver.files.list', {
            server_id: serverId.toString(),
            rootserver_id: server.rootserver_id.toString(),
            install_path: server.install_path,
            path: requestedPath
        });
        
        if (!response.success) {
            return res.status(500).json({ success: false, error: response.error });
        }
        
        const rawFiles = response.data?.files;
        if (!rawFiles) {
            // Server noch nicht installiert / kein Verzeichnis vorhanden
            return res.json({ success: true, files: [], path: requestedPath });
        }
        // Gesperrtes zeigt die Liste gar nicht erst an
        const sperrliste = await ladeSperrliste(ServiceManager.get('dbService'), server);
        const files = rawFiles
            .filter(file => !gesperrt(path.posix.join(requestedPath, file.name), sperrliste))
            .map(file => ({
                ...file,
                editable: !file.is_dir && isEditable(file.name, file.size),
                size_formatted: formatFileSize(file.size)
            }));
        
        res.json({ success: true, files, path: requestedPath });
    } catch (error) {
        Logger.error('[Files] Error:', error);
        res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
});

router.get('/servers/:serverId/files/read', requirePermission('GAMESERVER.FILES.VIEW'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const ipmServer = ServiceManager.get('ipmServer');
    try {
        const { serverId } = req.params;
        const guildId = res.locals.guildId;
        const filePath = req.query.path;
        if (!filePath) return res.status(400).json({ success: false, error: 'Pfad erforderlich' });
        
        const server = await validateServerAccess(serverId, guildId);

        if (await sperrt(res, server, [filePath])) return;

        const response = await ipmServer.sendCommand(server.daemon_id, 'gameserver.files.read', {
            server_id: serverId.toString(),
            rootserver_id: server.rootserver_id.toString(),
            install_path: server.install_path,
            path: filePath
        });
        
        if (!response.success) {
            return res.status(500).json({ success: false, error: response.error });
        }
        
        const content = Buffer.from(response.data.content, 'base64').toString('utf8');
        res.json({ success: true, content, path: filePath });
    } catch (error) {
        Logger.error('[Files] Read Error:', error);
        res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
});

router.post('/servers/:serverId/files/write', requirePermission('GAMESERVER.FILES.MANAGE'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const ipmServer = ServiceManager.get('ipmServer');
    try {
        const { serverId } = req.params;
        const guildId = res.locals.guildId;
        const { path: filePath, content } = req.body;
        if (!filePath || content === undefined) {
            return res.status(400).json({ success: false, error: 'Pfad und Inhalt erforderlich' });
        }
        
        const server = await validateServerAccess(serverId, guildId);

        if (await sperrt(res, server, [filePath])) return;

        const contentBase64 = Buffer.from(content, 'utf8').toString('base64');

        // Dieselbe Grenze wie beim Upload: Der Inhalt geht in einer einzigen
        // Nachricht zum Daemon. Wird sie zu gross, schliesst die Gegenseite die
        // Verbindung, statt zu antworten.
        if (Buffer.byteLength(contentBase64) > MAX_UPLOAD_BYTES) {
            return res.status(413).json({
                success: false,
                error: `Datei zu gross zum Speichern (Grenze: ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB).`
            });
        }

        
        const response = await ipmServer.sendCommand(server.daemon_id, 'gameserver.files.write', {
            server_id: serverId.toString(),
            rootserver_id: server.rootserver_id.toString(),
            install_path: server.install_path,
            path: filePath,
            content: contentBase64
        });
        
        if (!response.success) {
            return res.status(500).json({ success: false, error: response.error });
        }
        
        res.json({ success: true, message: 'Datei gespeichert' });
    } catch (error) {
        Logger.error('[Files] Write Error:', error);
        res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
});

router.delete('/servers/:serverId/files', requirePermission('GAMESERVER.FILES.MANAGE'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const ipmServer = ServiceManager.get('ipmServer');
    try {
        const { serverId } = req.params;
        const guildId = res.locals.guildId;
        const filePath = req.query.path;
        if (!filePath) return res.status(400).json({ success: false, error: 'Pfad erforderlich' });
        
        const server = await validateServerAccess(serverId, guildId);

        if (await sperrt(res, server, [filePath])) return;

        const response = await ipmServer.sendCommand(server.daemon_id, 'gameserver.files.delete', {
            server_id: serverId.toString(),
            rootserver_id: server.rootserver_id.toString(),
            install_path: server.install_path,
            path: filePath
        });
        
        if (!response.success) {
            return res.status(500).json({ success: false, error: response.error });
        }
        
        res.json({ success: true, message: 'Datei gelöscht' });
    } catch (error) {
        Logger.error('[Files] Delete Error:', error);
        res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
});

router.post('/servers/:serverId/files/bulk-delete', requirePermission('GAMESERVER.FILES.MANAGE'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const ipmServer = ServiceManager.get('ipmServer');
    try {
        const { serverId } = req.params;
        const guildId = res.locals.guildId;
        const { paths } = req.body;
        if (!paths || !Array.isArray(paths)) {
            return res.status(400).json({ success: false, error: 'Keine Pfade' });
        }
        
        const server = await validateServerAccess(serverId, guildId);
        if (await sperrt(res, server, paths)) return;
        const results = await Promise.allSettled(
            paths.map(path => ipmServer.sendCommand(server.daemon_id, 'gameserver.files.delete', {
                server_id: serverId.toString(),
                rootserver_id: server.rootserver_id.toString(),
                install_path: server.install_path,
                path
            }))
        );
        
        const succeeded = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
        res.json({ success: true, message: `${succeeded} Dateien gelöscht` });
    } catch (error) {
        Logger.error('[Files] Bulk-Delete Error:', error);
        res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
});

router.post('/servers/:serverId/files/mkdir', requirePermission('GAMESERVER.FILES.MANAGE'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const ipmServer = ServiceManager.get('ipmServer');
    try {
        const { serverId } = req.params;
        const guildId = res.locals.guildId;
        const { path: dirPath } = req.body;
        if (!dirPath) return res.status(400).json({ success: false, error: 'Pfad erforderlich' });
        
        const server = await validateServerAccess(serverId, guildId);
        if (await sperrt(res, server, [dirPath])) return;
        const response = await ipmServer.sendCommand(server.daemon_id, 'gameserver.files.mkdir', {
            server_id: serverId.toString(),
            rootserver_id: server.rootserver_id.toString(),
            install_path: server.install_path,
            path: dirPath
        });
        
        if (!response.success) {
            return res.status(500).json({ success: false, error: response.error });
        }
        
        res.json({ success: true, message: 'Verzeichnis erstellt' });
    } catch (error) {
        Logger.error('[Files] Mkdir Error:', error);
        res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
});

router.delete('/servers/:serverId/files/rmdir', requirePermission('GAMESERVER.FILES.MANAGE'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const ipmServer = ServiceManager.get('ipmServer');
    try {
        const { serverId } = req.params;
        const guildId = res.locals.guildId;
        const dirPath = req.query.path;
        if (!dirPath) return res.status(400).json({ success: false, error: 'Pfad erforderlich' });
        
        const server = await validateServerAccess(serverId, guildId);
        if (await sperrt(res, server, [dirPath])) return;
        const response = await ipmServer.sendCommand(server.daemon_id, 'gameserver.files.rmdir', {
            server_id: serverId.toString(),
            rootserver_id: server.rootserver_id.toString(),
            install_path: server.install_path,
            path: dirPath
        });
        
        if (!response.success) {
            return res.status(500).json({ success: false, error: response.error });
        }
        
        res.json({ success: true, message: 'Verzeichnis gelöscht' });
    } catch (error) {
        Logger.error('[Files] Rmdir Error:', error);
        res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
});

router.post('/servers/:serverId/files/rename', requirePermission('GAMESERVER.FILES.MANAGE'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const ipmServer = ServiceManager.get('ipmServer');
    try {
        const { serverId } = req.params;
        const guildId = res.locals.guildId;
        const { path: oldPath, new_name: newName } = req.body;
        if (!oldPath || !newName) {
            return res.status(400).json({ success: false, error: 'Pfad und Name erforderlich' });
        }
        
        const server = await validateServerAccess(serverId, guildId);
        // Der neue Name landet im selben Ordner — er darf keine gesperrte Datei werden
        if (await sperrt(res, server, [oldPath, path.posix.join(path.posix.dirname(oldPath), newName)])) return;
        const response = await ipmServer.sendCommand(server.daemon_id, 'gameserver.files.rename', {
            server_id: serverId.toString(),
            rootserver_id: server.rootserver_id.toString(),
            install_path: server.install_path,
            path: oldPath,
            new_name: newName
        });
        
        if (!response.success) {
            return res.status(500).json({ success: false, error: response.error });
        }
        
        res.json({ success: true, message: 'Umbenannt' });
    } catch (error) {
        Logger.error('[Files] Rename Error:', error);
        res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
});

router.post('/servers/:serverId/files/move', requirePermission('GAMESERVER.FILES.MANAGE'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const ipmServer = ServiceManager.get('ipmServer');
    try {
        const { serverId } = req.params;
        const guildId = res.locals.guildId;
        const { source_path, dest_path } = req.body;
        if (!source_path || !dest_path) {
            return res.status(400).json({ success: false, error: 'Pfade erforderlich' });
        }
        
        const server = await validateServerAccess(serverId, guildId);
        if (await sperrt(res, server, [source_path, dest_path])) return;
        const response = await ipmServer.sendCommand(server.daemon_id, 'gameserver.files.mv', {
            server_id: serverId.toString(),
            rootserver_id: server.rootserver_id.toString(),
            install_path: server.install_path,
            source_path,
            dest_path
        });
        
        if (!response.success) {
            return res.status(500).json({ success: false, error: response.error });
        }
        
        res.json({ success: true, message: 'Verschoben' });
    } catch (error) {
        Logger.error('[Files] Move Error:', error);
        res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
});

router.post('/servers/:serverId/files/bulk-move', requirePermission('GAMESERVER.FILES.MANAGE'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const ipmServer = ServiceManager.get('ipmServer');
    try {
        const { serverId } = req.params;
        const guildId = res.locals.guildId;
        const { source_paths, dest_folder } = req.body;
        if (!source_paths || !dest_folder) {
            return res.status(400).json({ success: false, error: 'Pfade erforderlich' });
        }
        
        const server = await validateServerAccess(serverId, guildId);
        const ziele = source_paths.map(source => `${dest_folder}/${path.basename(source)}`);
        if (await sperrt(res, server, [...source_paths, ...ziele])) return;
        const results = await Promise.allSettled(
            source_paths.map(source => {
                const filename = path.basename(source);
                const dest = `${dest_folder}/${filename}`;
                return ipmServer.sendCommand(server.daemon_id, 'gameserver.files.mv', {
                    server_id: serverId.toString(),
                    rootserver_id: server.rootserver_id.toString(),
                    install_path: server.install_path,
                    source_path: source,
                    dest_path: dest
                });
            })
        );
        
        const succeeded = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
        res.json({ success: true, message: `${succeeded} Dateien verschoben` });
    } catch (error) {
        Logger.error('[Files] Bulk-Move Error:', error);
        res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
});

router.post('/servers/:serverId/files/upload', requirePermission('GAMESERVER.FILES.MANAGE'), nimmDatei, async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const ipmServer = ServiceManager.get('ipmServer');
    try {
        const { serverId } = req.params;
        const guildId = res.locals.guildId;
        const uploadPath = req.body.path || '/';

        if (!req.file) {
            return res.status(400).json({ success: false, error: 'Keine Datei' });
        }

        const server = await validateServerAccess(serverId, guildId);

        // Ziel-Pfad: uploadPath + Dateiname
        const targetPath = uploadPath === '/'
            ? `/${req.file.originalname}`
            : `${uploadPath}/${req.file.originalname}`;

        if (await sperrt(res, server, [targetPath])) return;

        const contentBase64 = req.file.buffer.toString('base64');

        const response = await ipmServer.sendCommand(server.daemon_id, 'gameserver.files.write', {
            server_id: serverId.toString(),
            rootserver_id: server.rootserver_id.toString(),
            install_path: server.install_path,
            path: targetPath,
            content: contentBase64
        });

        if (!response.success) {
            return res.status(500).json({ success: false, error: response.error });
        }

        res.json({ success: true, message: `${req.file.originalname} hochgeladen` });
    } catch (error) {
        Logger.error('[Files] Upload Error:', error);
        res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
});

/**
 * GET /servers/:serverId/files/download
 * Datei herunterladen (als Attachment)
 * Query: ?path=/server.properties
 */
router.get('/servers/:serverId/files/download', requirePermission('GAMESERVER.FILES.VIEW'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const ipmServer = ServiceManager.get('ipmServer');
    try {
        const { serverId } = req.params;
        const guildId = res.locals.guildId;
        const filePath = req.query.path;
        if (!filePath) return res.status(400).json({ success: false, error: 'Pfad erforderlich' });

        const server = await validateServerAccess(serverId, guildId);
        if (await sperrt(res, server, [filePath])) return;
        const response = await ipmServer.sendCommand(server.daemon_id, 'gameserver.files.read', {
            server_id: serverId.toString(),
            rootserver_id: server.rootserver_id.toString(),
            install_path: server.install_path,
            path: filePath
        });

        if (!response.success) {
            return res.status(500).json({ success: false, error: response.error || 'Datei konnte nicht gelesen werden' });
        }

        const fileBuffer = Buffer.from(response.data.content, 'base64');
        const filename = path.basename(filePath);

        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Length', fileBuffer.length);
        res.send(fileBuffer);
    } catch (error) {
        Logger.error('[Files] Download Error:', error);
        res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
});

module.exports = router;
