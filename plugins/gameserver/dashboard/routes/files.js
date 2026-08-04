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
const { requirePermission } = require('../../../../apps/dashboard/middlewares/permissions.middleware');

/**
 * Groesste Datei, die durch die Daemon-Verbindung passt.
 *
 * Der Inhalt geht base64-kodiert in EINER WebSocket-Nachricht zum Daemon, wird
 * dabei also um ein Drittel groesser. Die Nachrichtengrenze liegt bei 64 MiB
 * (MAX_NACHRICHT_BYTES im IPMServer, MaxNachrichtBytes im Daemon) — 45 MB
 * Rohgroesse landen bei rund 60 MiB und bleiben sicher darunter.
 *
 * Bis zum 2026-08-04 stand hier 500 MB. Das war eine Zusage, die die Leitung
 * nicht halten konnte: Ueberschreitet eine Nachricht die Grenze der Gegenseite,
 * schliesst diese die Verbindung (Status 1009), statt zu antworten. Der Daemon
 * verschwand also mitten im Upload und galt als offline.
 */
const MAX_UPLOAD_BYTES = 45 * 1024 * 1024;

/**
 * Upload-Middleware mit verstaendlicher Fehlermeldung.
 *
 * Ohne diesen Mantel landet ein zu grosser Upload als MulterError im
 * allgemeinen Fehlerpfad — der Nutzer sieht einen 500er ohne Grund.
 */
function nimmDatei(req, res, next) {
    upload.single('file')(req, res, (err) => {
        if (err && err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({
                success: false,
                error: `Datei zu gross. Ueber die Daemon-Verbindung passen hoechstens ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`
            });
        }
        if (err) return next(err);
        next();
    });
}

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: MAX_UPLOAD_BYTES,
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

/**
 * Lädt die file_denylist aus frozen_game_data eines Servers.
 * @param {object} server - DB-Zeile des Servers
 * @returns {string[]} - Array von Denylist-Patterns
 */
function getFileDenylist(server) {
    try {
        const frozen = typeof server.frozen_game_data === 'string'
            ? JSON.parse(server.frozen_game_data)
            : server.frozen_game_data;
        if (Array.isArray(frozen?.file_denylist)) return frozen.file_denylist;
    } catch (_) {}
    return [];
}

/**
 * Prüft ob ein Datei-Pfad durch die Denylist blockiert wird.
 * Unterstützt: exakte Namen, Wildcard-Patterns (*.log), Verzeichnis-Patterns (dir/)
 * @param {string} filePath - Relativer Pfad
 * @param {string[]} denylist - Denylist-Patterns
 * @returns {boolean} - true wenn blockiert
 */
function isDenied(filePath, denylist) {
    if (!denylist || denylist.length === 0) return false;
    const basename = path.basename(filePath);
    for (const pattern of denylist) {
        // Exakter Dateiname-Match
        if (basename === pattern) return true;
        // Wildcard-Pattern (z.B. *.log)
        if (pattern.includes('*')) {
            const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
            if (regex.test(basename) || regex.test(filePath)) return true;
        }
        // Verzeichnis-Pattern (z.B. "dir/")
        if (pattern.endsWith('/') && (filePath.startsWith(pattern) || basename === pattern.slice(0, -1))) {
            return true;
        }
    }
    return false;
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
        // Denylist aus frozen_game_data laden und Dateien filtern
        const denylist = getFileDenylist(server);
        const files = rawFiles
            .filter(file => !isDenied(path.join(requestedPath, file.name), denylist))
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

        // Denylist-Check: Datei darf nicht gelesen werden wenn blockiert
        const denylist = getFileDenylist(server);
        if (isDenied(filePath, denylist)) {
            return res.status(403).json({ success: false, error: 'Zugriff auf diese Datei ist nicht erlaubt' });
        }

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

        // Denylist-Check: Datei darf nicht geschrieben werden wenn blockiert
        const denylist = getFileDenylist(server);
        if (isDenied(filePath, denylist)) {
            return res.status(403).json({ success: false, error: 'Diese Datei darf nicht bearbeitet werden' });
        }

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

        // Denylist-Check: Datei darf nicht gelöscht werden wenn blockiert
        const denylist = getFileDenylist(server);
        if (isDenied(filePath, denylist)) {
            return res.status(403).json({ success: false, error: 'Diese Datei darf nicht gelöscht werden' });
        }

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
