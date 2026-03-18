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
const multer = require('multer');
const path = require('path');

// File-Upload konfigurieren (Max 500MB, Memory-Storage)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { 
        fileSize: 500 * 1024 * 1024,  // 500MB
        files: 1
    }
});

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

// ROUTES
router.get('/servers/:serverId/files', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const ipmServer = ServiceManager.get('ipmServer');
    try {
        const { serverId } = req.params;
        const guildId = res.locals.guildId;
        const requestedPath = req.query.path || '/';
        const server = await validateServerAccess(serverId, guildId);
        
        const response = await ipmServer.sendCommand(server.daemon_id, 'gameserver.files.list', {
            server_id: server.daemon_server_id || serverId.toString(),
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
        const files = rawFiles.map(file => ({
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

router.get('/servers/:serverId/files/read', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const ipmServer = ServiceManager.get('ipmServer');
    try {
        const { serverId } = req.params;
        const guildId = res.locals.guildId;
        const filePath = req.query.path;
        if (!filePath) return res.status(400).json({ success: false, error: 'Pfad erforderlich' });
        
        const server = await validateServerAccess(serverId, guildId);
        const response = await ipmServer.sendCommand(server.daemon_id, 'gameserver.files.read', {
            server_id: server.daemon_server_id || serverId.toString(),
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

router.post('/servers/:serverId/files/write', async (req, res) => {
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
        const contentBase64 = Buffer.from(content, 'utf8').toString('base64');
        
        const response = await ipmServer.sendCommand(server.daemon_id, 'gameserver.files.write', {
            server_id: server.daemon_server_id || serverId.toString(),
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

router.delete('/servers/:serverId/files', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const ipmServer = ServiceManager.get('ipmServer');
    try {
        const { serverId } = req.params;
        const guildId = res.locals.guildId;
        const filePath = req.query.path;
        if (!filePath) return res.status(400).json({ success: false, error: 'Pfad erforderlich' });
        
        const server = await validateServerAccess(serverId, guildId);
        const response = await ipmServer.sendCommand(server.daemon_id, 'gameserver.files.delete', {
            server_id: server.daemon_server_id || serverId.toString(),
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

router.post('/servers/:serverId/files/bulk-delete', async (req, res) => {
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
        const results = await Promise.allSettled(
            paths.map(path => ipmServer.sendCommand(server.daemon_id, 'gameserver.files.delete', {
                server_id: server.daemon_server_id || serverId.toString(),
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

router.post('/servers/:serverId/files/mkdir', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const ipmServer = ServiceManager.get('ipmServer');
    try {
        const { serverId } = req.params;
        const guildId = res.locals.guildId;
        const { path: dirPath } = req.body;
        if (!dirPath) return res.status(400).json({ success: false, error: 'Pfad erforderlich' });
        
        const server = await validateServerAccess(serverId, guildId);
        const response = await ipmServer.sendCommand(server.daemon_id, 'gameserver.files.mkdir', {
            server_id: server.daemon_server_id || serverId.toString(),
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

router.delete('/servers/:serverId/files/rmdir', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const ipmServer = ServiceManager.get('ipmServer');
    try {
        const { serverId } = req.params;
        const guildId = res.locals.guildId;
        const dirPath = req.query.path;
        if (!dirPath) return res.status(400).json({ success: false, error: 'Pfad erforderlich' });
        
        const server = await validateServerAccess(serverId, guildId);
        const response = await ipmServer.sendCommand(server.daemon_id, 'gameserver.files.rmdir', {
            server_id: server.daemon_server_id || serverId.toString(),
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

router.post('/servers/:serverId/files/rename', async (req, res) => {
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
        const response = await ipmServer.sendCommand(server.daemon_id, 'gameserver.files.rename', {
            server_id: server.daemon_server_id || serverId.toString(),
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

router.post('/servers/:serverId/files/move', async (req, res) => {
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
        const response = await ipmServer.sendCommand(server.daemon_id, 'gameserver.files.mv', {
            server_id: server.daemon_server_id || serverId.toString(),
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

router.post('/servers/:serverId/files/bulk-move', async (req, res) => {
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
        const results = await Promise.allSettled(
            source_paths.map(source => {
                const filename = path.basename(source);
                const dest = `${dest_folder}/${filename}`;
                return ipmServer.sendCommand(server.daemon_id, 'gameserver.files.mv', {
                    server_id: server.daemon_server_id || serverId.toString(),
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

router.post('/servers/:serverId/files/upload', upload.single('file'), async (req, res) => {
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

        const contentBase64 = req.file.buffer.toString('base64');

        const response = await ipmServer.sendCommand(server.daemon_id, 'gameserver.files.write', {
            server_id: server.daemon_server_id || serverId.toString(),
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
router.get('/servers/:serverId/files/download', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const ipmServer = ServiceManager.get('ipmServer');
    try {
        const { serverId } = req.params;
        const guildId = res.locals.guildId;
        const filePath = req.query.path;
        if (!filePath) return res.status(400).json({ success: false, error: 'Pfad erforderlich' });

        const server = await validateServerAccess(serverId, guildId);
        const response = await ipmServer.sendCommand(server.daemon_id, 'gameserver.files.read', {
            server_id: server.daemon_server_id || serverId.toString(),
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
