/**
 * Guild Media-Router — WordPress-Style Medien-Manager
 * 
 * GET  /media               → Medien-Bibliothek (Galerie)
 * GET  /media/api/list      → JSON API: Medien laden (mit Filter)
 * GET  /media/api/:id       → JSON API: Einzelne Datei-Details
 * POST /media/api/upload    → Datei(en) hochladen
 * PUT  /media/api/:id       → Metadaten updaten (alt_text, title, folder)
 * DELETE /media/api/:id     → Datei löschen
 */

'use strict';

const express = require('express');
const router = express.Router({ mergeParams: true });
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { ServiceManager } = require('dunebot-core');

// ── Erlaubte MIME-Types ──
const ALLOWED_MIME_TYPES = [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
    'image/x-icon', 'image/vnd.microsoft.icon'
];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_FILES_PER_UPLOAD = 10;

// ── Multer Storage: Guild-basierte Ordner ──
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const guildId = req.params.guildId;
        const uploadDir = path.join(__dirname, '../../uploads/media', guildId);
        fs.mkdirSync(uploadDir, { recursive: true });
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const uniqueName = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
        cb(null, uniqueName);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: MAX_FILE_SIZE, files: MAX_FILES_PER_UPLOAD },
    fileFilter: (req, file, cb) => {
        if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error(`Dateityp '${file.mimetype}' ist nicht erlaubt`));
        }
    }
});

// ── Permission-Middleware ──
function requirePermission(permissionKey) {
    return async (req, res, next) => {
        const permissionManager = ServiceManager.get('permissionManager');
        const guildId = res.locals.guildId;
        const userId = res.locals.user?.id;
        if (!userId) return res.status(401).json({ success: false, message: 'Nicht eingeloggt' });
        const hasPermission = await permissionManager.hasPermission(userId, guildId, permissionKey);
        if (!hasPermission) return res.status(403).json({ success: false, message: 'Keine Berechtigung' });
        next();
    };
}

// =====================================================
// GET /guild/:guildId/media — Medien-Bibliothek (View)
// =====================================================
router.get('/', requirePermission('CORE.MEDIA.VIEW'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const themeManager = ServiceManager.get('themeManager');
    const guildId = res.locals.guildId;

    try {
        return themeManager.renderView(res, 'guild/media/index', {
            title: 'Medien',
            activeMenu: `/guild/${guildId}/media`,
            guildId,
            maxFileSize: MAX_FILE_SIZE,
            allowedTypes: ALLOWED_MIME_TYPES
        });
    } catch (error) {
        Logger.error('[Media] Fehler beim Laden:', error);
        res.status(500).send('Fehler beim Laden der Medienbibliothek');
    }
});

// =====================================================
// GET /guild/:guildId/media/api/list — JSON: Medien auflisten
// =====================================================
router.get('/api/list', requirePermission('CORE.MEDIA.VIEW'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const guildId = res.locals.guildId;

    try {
        const { folder, search, page = 1, limit = 24 } = req.query;
        const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
        const params = [guildId];
        let where = 'WHERE guild_id = ?';

        if (folder && folder !== 'all') {
            where += ' AND folder = ?';
            params.push(folder);
        }
        if (search) {
            where += ' AND (filename LIKE ? OR title LIKE ? OR alt_text LIKE ?)';
            const term = `%${search}%`;
            params.push(term, term, term);
        }

        const countResult = await dbService.query(`SELECT COUNT(*) as total FROM guild_media ${where}`, params);
        const total = countResult[0]?.total || 0;

        const media = await dbService.query(
            `SELECT * FROM guild_media ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
            [...params, parseInt(limit), offset]
        );

        // Ordner-Statistik
        const folders = await dbService.query(
            'SELECT folder, COUNT(*) as count FROM guild_media WHERE guild_id = ? GROUP BY folder ORDER BY folder',
            [guildId]
        );

        return res.json({
            success: true,
            data: media.map(m => ({
                ...m,
                url: `/uploads/media/${guildId}/${m.stored_name}`
            })),
            folders,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        Logger.error('[Media] Fehler beim Laden der Medien:', error);
        res.status(500).json({ success: false, message: 'Fehler beim Laden' });
    }
});

// =====================================================
// GET /guild/:guildId/media/api/:id — JSON: Einzelne Datei
// =====================================================
router.get('/api/:id', requirePermission('CORE.MEDIA.VIEW'), async (req, res) => {
    const dbService = ServiceManager.get('dbService');
    const guildId = res.locals.guildId;

    const [media] = await dbService.query(
        'SELECT * FROM guild_media WHERE id = ? AND guild_id = ?',
        [req.params.id, guildId]
    );
    if (!media) return res.status(404).json({ success: false, message: 'Datei nicht gefunden' });

    return res.json({
        success: true,
        data: { ...media, url: `/uploads/media/${guildId}/${media.stored_name}` }
    });
});

// =====================================================
// POST /guild/:guildId/media/api/upload — Dateien hochladen
// =====================================================
router.post('/api/upload', requirePermission('CORE.MEDIA.UPLOAD'), (req, res, next) => {
    upload.array('files', MAX_FILES_PER_UPLOAD)(req, res, (err) => {
        if (err instanceof multer.MulterError) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({ success: false, message: `Datei zu groß (max. ${MAX_FILE_SIZE / 1024 / 1024} MB)` });
            }
            return res.status(400).json({ success: false, message: err.message });
        }
        if (err) return res.status(400).json({ success: false, message: err.message });
        next();
    });
}, async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const guildId = res.locals.guildId;
    const userId = res.locals.user.id;
    const folder = req.body.folder || 'general';

    // Ordner-Name validieren
    if (!/^[a-z0-9-]{1,50}$/.test(folder)) {
        return res.status(400).json({ success: false, message: 'Ungültiger Ordnername' });
    }

    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ success: false, message: 'Keine Dateien hochgeladen' });
    }

    try {
        const results = [];

        for (const file of req.files) {
            let width = null, height = null;

            // Bildgröße ermitteln (für Raster-Bilder)
            if (['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.mimetype)) {
                try {
                    // Einfache Header-basierte Größenerkennung
                    const dimensions = getImageDimensions(file.path, file.mimetype);
                    if (dimensions) {
                        width = dimensions.width;
                        height = dimensions.height;
                    }
                } catch { /* Dimension optional */ }
            }

            const result = await dbService.query(
                `INSERT INTO guild_media (guild_id, uploaded_by, filename, stored_name, mime_type, file_size, width, height, folder)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [guildId, userId, file.originalname, file.filename, file.mimetype, file.size, width, height, folder]
            );

            results.push({
                id: result.insertId,
                filename: file.originalname,
                stored_name: file.filename,
                mime_type: file.mimetype,
                file_size: file.size,
                width, height, folder,
                url: `/uploads/media/${guildId}/${file.filename}`
            });
        }

        Logger.info(`[Media] ${results.length} Datei(en) hochgeladen für Guild ${guildId} von User ${userId}`);
        return res.json({ success: true, data: results });
    } catch (error) {
        Logger.error('[Media] Upload-Fehler:', error);
        // Hochgeladene Dateien aufräumen bei DB-Fehler
        for (const file of req.files) {
            try { fs.unlinkSync(file.path); } catch { /* ignore */ }
        }
        res.status(500).json({ success: false, message: 'Upload fehlgeschlagen' });
    }
});

// =====================================================
// PUT /guild/:guildId/media/api/:id — Metadaten updaten
// =====================================================
router.put('/api/:id', requirePermission('CORE.MEDIA.UPLOAD'), async (req, res) => {
    const dbService = ServiceManager.get('dbService');
    const guildId = res.locals.guildId;
    const { alt_text, title, folder } = req.body;

    // Prüfe ob Datei existiert und zu dieser Guild gehört
    const [media] = await dbService.query(
        'SELECT id FROM guild_media WHERE id = ? AND guild_id = ?',
        [req.params.id, guildId]
    );
    if (!media) return res.status(404).json({ success: false, message: 'Datei nicht gefunden' });

    const updates = [];
    const params = [];
    if (alt_text !== undefined) { updates.push('alt_text = ?'); params.push(alt_text.substring(0, 255)); }
    if (title !== undefined) { updates.push('title = ?'); params.push(title.substring(0, 255)); }
    if (folder !== undefined) {
        if (!/^[a-z0-9-]{1,50}$/.test(folder)) {
            return res.status(400).json({ success: false, message: 'Ungültiger Ordnername' });
        }
        updates.push('folder = ?'); params.push(folder);
    }

    if (updates.length === 0) return res.json({ success: true, message: 'Nichts zu aktualisieren' });

    params.push(req.params.id, guildId);
    await dbService.query(`UPDATE guild_media SET ${updates.join(', ')} WHERE id = ? AND guild_id = ?`, params);

    return res.json({ success: true, message: 'Metadaten aktualisiert' });
});

// =====================================================
// DELETE /guild/:guildId/media/api/:id — Datei löschen
// =====================================================
router.delete('/api/:id', requirePermission('CORE.MEDIA.DELETE'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const guildId = res.locals.guildId;

    const [media] = await dbService.query(
        'SELECT * FROM guild_media WHERE id = ? AND guild_id = ?',
        [req.params.id, guildId]
    );
    if (!media) return res.status(404).json({ success: false, message: 'Datei nicht gefunden' });

    // Datei vom Dateisystem löschen
    const filePath = path.join(__dirname, '../../uploads/media', guildId, media.stored_name);
    try { fs.unlinkSync(filePath); } catch { /* Datei evtl. schon weg */ }

    // DB-Eintrag löschen
    await dbService.query('DELETE FROM guild_media WHERE id = ? AND guild_id = ?', [req.params.id, guildId]);

    Logger.info(`[Media] Datei ${media.filename} gelöscht (Guild ${guildId})`);
    return res.json({ success: true, message: 'Datei gelöscht' });
});

// =====================================================
// POST /guild/:guildId/media/api/:id/edit — Bild bearbeiten (Crop/Rotate/Flip)
// Empfängt ein Base64-encoded bearbeitetes Bild vom Cropper.js Frontend
// =====================================================
router.post('/api/:id/edit', requirePermission('CORE.MEDIA.UPLOAD'), express.json({ limit: '10mb' }), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const guildId = res.locals.guildId;
    const { imageData, saveAs } = req.body;

    if (!imageData) return res.status(400).json({ success: false, message: 'Keine Bilddaten' });

    // Originalbild laden
    const [media] = await dbService.query(
        'SELECT * FROM guild_media WHERE id = ? AND guild_id = ?',
        [req.params.id, guildId]
    );
    if (!media) return res.status(404).json({ success: false, message: 'Datei nicht gefunden' });

    // Nur bearbeitbare Raster-Formate
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(media.mime_type)) {
        return res.status(400).json({ success: false, message: 'Dieses Format kann nicht bearbeitet werden' });
    }

    try {
        // Base64 → Buffer
        const base64Match = imageData.match(/^data:image\/(png|jpeg|webp);base64,(.+)$/);
        if (!base64Match) return res.status(400).json({ success: false, message: 'Ungültiges Bildformat' });

        const outputMime = `image/${base64Match[1]}`;
        const buffer = Buffer.from(base64Match[2], 'base64');
        const dimensions = getImageDimensions(null, outputMime, buffer);
        const uploadDir = path.join(__dirname, '../../uploads/media', guildId);

        if (saveAs === 'copy') {
            // Als Kopie speichern
            const ext = outputMime === 'image/png' ? '.png' : outputMime === 'image/webp' ? '.webp' : '.jpg';
            const newStoredName = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
            const newFilePath = path.join(uploadDir, newStoredName);
            fs.writeFileSync(newFilePath, buffer);

            const nameBase = path.basename(media.filename, path.extname(media.filename));
            const newFilename = `${nameBase}-edited${ext}`;

            const result = await dbService.query(
                `INSERT INTO guild_media (guild_id, uploaded_by, filename, stored_name, mime_type, file_size, width, height, folder, alt_text, title)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [guildId, res.locals.user.id, newFilename, newStoredName, outputMime, buffer.length,
                 dimensions?.width || null, dimensions?.height || null, media.folder, media.alt_text, media.title]
            );

            Logger.info(`[Media] Bild bearbeitet (Kopie) → ${newFilename} (Guild ${guildId})`);
            return res.json({
                success: true,
                message: 'Bearbeitetes Bild als Kopie gespeichert',
                data: { id: result.insertId, url: `/uploads/media/${guildId}/${newStoredName}` }
            });
        } else {
            // Original überschreiben
            const filePath = path.join(uploadDir, media.stored_name);
            fs.writeFileSync(filePath, buffer);

            await dbService.query(
                'UPDATE guild_media SET file_size = ?, width = ?, height = ?, mime_type = ? WHERE id = ? AND guild_id = ?',
                [buffer.length, dimensions?.width || null, dimensions?.height || null, outputMime, req.params.id, guildId]
            );

            Logger.info(`[Media] Bild bearbeitet (überschrieben) → ${media.filename} (Guild ${guildId})`);
            return res.json({
                success: true,
                message: 'Bild wurde aktualisiert',
                data: { id: media.id, url: `/uploads/media/${guildId}/${media.stored_name}?t=${Date.now()}` }
            });
        }
    } catch (error) {
        Logger.error('[Media] Bearbeitungsfehler:', error);
        res.status(500).json({ success: false, message: 'Bearbeitung fehlgeschlagen' });
    }
});

// ── Helper: Einfache Bildgrößen-Erkennung ohne externe Deps ──
function getImageDimensions(filePath, mimeType, existingBuffer) {
    try {
        const buffer = existingBuffer || fs.readFileSync(filePath);
        
        if (mimeType === 'image/png') {
            if (buffer.length >= 24 && buffer[0] === 0x89 && buffer[1] === 0x50) {
                return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
            }
        }
        
        if (mimeType === 'image/jpeg') {
            let offset = 2;
            while (offset < buffer.length) {
                if (buffer[offset] !== 0xFF) break;
                const marker = buffer[offset + 1];
                if (marker === 0xC0 || marker === 0xC2) {
                    return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
                }
                const segmentLength = buffer.readUInt16BE(offset + 2);
                offset += 2 + segmentLength;
            }
        }
        
        if (mimeType === 'image/gif') {
            if (buffer.length >= 10) {
                return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
            }
        }

        return null;
    } catch {
        return null;
    }
}

module.exports = router;
