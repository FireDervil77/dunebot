/**
 * Admin Docs Router — Dokumentations-Verwaltung
 * 
 * Markdown-basierter Dokumentations-Editor für den Admin-Bereich.
 * Liest/schreibt Dateien aus dem /documentation/ Verzeichnis.
 * 
 * Routes:
 *   GET  /admin/docs              → Dateiliste (Baumstruktur)
 *   GET  /admin/docs/edit         → Editor (query: ?path=getting-started/erste-schritte.md)
 *   GET  /admin/docs/api/file     → Datei-Inhalt laden (JSON)
 *   PUT  /admin/docs/api/file     → Datei speichern (JSON)
 *   POST /admin/docs/api/file     → Neue Datei erstellen (JSON)
 *   DELETE /admin/docs/api/file   → Datei löschen (JSON)
 *   POST /admin/docs/api/folder   → Neuen Ordner erstellen (JSON)
 */

'use strict';

const { Router } = require('express');
const { ServiceManager } = require('dunebot-core');
const path = require('path');
const fs = require('fs').promises;

const router = Router();
const { apiLimiter } = require('../../middlewares/security/rate-limiter.middleware');

// Docs-Basisverzeichnis (absolut)
const DOCS_ROOT = path.resolve(__dirname, '..', '..', '..', '..', 'documentation');

/**
 * Sicherstellen, dass ein Pfad innerhalb von DOCS_ROOT liegt.
 * Verhindert Path-Traversal-Angriffe.
 */
function safePath(relativePath) {
    if (!relativePath) return null;
    // Normalisieren und ../ entfernen
    const cleaned = path.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, '');
    const absolute = path.resolve(DOCS_ROOT, cleaned);
    if (!absolute.startsWith(DOCS_ROOT)) return null;
    return { absolute, relative: path.relative(DOCS_ROOT, absolute) };
}

/**
 * Rekursiv Verzeichnisbaum aufbauen
 */
async function buildTree(dirPath, basePath = '') {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const tree = [];

    for (const entry of entries) {
        const relativePath = path.join(basePath, entry.name);
        if (entry.isDirectory()) {
            const children = await buildTree(path.join(dirPath, entry.name), relativePath);
            tree.push({
                name: entry.name,
                path: relativePath,
                type: 'folder',
                children
            });
        } else if (entry.name.endsWith('.md')) {
            tree.push({
                name: entry.name,
                path: relativePath,
                type: 'file'
            });
        }
    }

    // Ordner zuerst, dann Dateien, alphabetisch
    tree.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
        return a.name.localeCompare(b.name);
    });

    return tree;
}

// ================================================================
// GET /admin/docs — Dateiliste
// ================================================================
router.get('/', async (req, res) => {
    const themeManager = ServiceManager.get('themeManager');
    const Logger = ServiceManager.get('Logger');

    try {
        const tree = await buildTree(DOCS_ROOT);
        await themeManager.renderView(res, 'admin/docs/index', {
            title: 'Dokumentation verwalten',
            activeMenu: '/admin/docs',
            tree
        });
    } catch (error) {
        Logger.error('[Admin/Docs] Fehler beim Laden:', error);
        res.status(500).render('error', { message: 'Fehler beim Laden der Dokumentation' });
    }
});

// ================================================================
// GET /admin/docs/edit — Editor
// ================================================================
router.get('/edit', async (req, res) => {
    const themeManager = ServiceManager.get('themeManager');
    const Logger = ServiceManager.get('Logger');
    const filePath = req.query.path;

    if (!filePath) {
        return res.redirect('/admin/docs');
    }

    const resolved = safePath(filePath);
    if (!resolved) {
        return res.status(400).send('Ungültiger Pfad');
    }

    try {
        let content = '';
        try {
            content = await fs.readFile(resolved.absolute, 'utf-8');
        } catch (e) {
            if (e.code !== 'ENOENT') throw e;
        }

        const tree = await buildTree(DOCS_ROOT);

        await themeManager.renderView(res, 'admin/docs/editor', {
            title: `Bearbeiten: ${resolved.relative}`,
            activeMenu: '/admin/docs',
            filePath: resolved.relative,
            content,
            tree
        });
    } catch (error) {
        Logger.error('[Admin/Docs] Fehler beim Laden der Datei:', error);
        res.status(500).render('error', { message: 'Fehler beim Laden der Datei' });
    }
});

// ================================================================
// API: GET /admin/docs/api/file — Datei-Inhalt
// ================================================================
router.get('/api/file', async (req, res) => {
    const resolved = safePath(req.query.path);
    if (!resolved) {
        return res.status(400).json({ success: false, message: 'Ungültiger Pfad' });
    }

    try {
        const content = await fs.readFile(resolved.absolute, 'utf-8');
        return res.json({ success: true, content, path: resolved.relative });
    } catch (e) {
        if (e.code === 'ENOENT') {
            return res.status(404).json({ success: false, message: 'Datei nicht gefunden' });
        }
        return res.status(500).json({ success: false, message: 'Lesefehler' });
    }
});

// ================================================================
// API: PUT /admin/docs/api/file — Datei speichern
// ================================================================
router.put('/api/file', apiLimiter, async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const { path: filePath, content } = req.body;

    const resolved = safePath(filePath);
    if (!resolved || !resolved.relative.endsWith('.md')) {
        return res.status(400).json({ success: false, message: 'Ungültiger Pfad (nur .md erlaubt)' });
    }

    if (typeof content !== 'string') {
        return res.status(400).json({ success: false, message: 'Inhalt fehlt' });
    }

    if (content.length > 500000) {
        return res.status(400).json({ success: false, message: 'Datei zu groß (max 500 KB)' });
    }

    try {
        await fs.writeFile(resolved.absolute, content, 'utf-8');
        Logger.info(`[Admin/Docs] Datei gespeichert: ${resolved.relative}`);
        return res.json({ success: true, message: 'Datei gespeichert' });
    } catch (error) {
        Logger.error('[Admin/Docs] Fehler beim Speichern:', error);
        return res.status(500).json({ success: false, message: 'Speicherfehler' });
    }
});

// ================================================================
// API: POST /admin/docs/api/file — Neue Datei erstellen
// ================================================================
router.post('/api/file', apiLimiter, async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const { path: filePath, content } = req.body;

    const resolved = safePath(filePath);
    if (!resolved || !resolved.relative.endsWith('.md')) {
        return res.status(400).json({ success: false, message: 'Ungültiger Pfad (nur .md erlaubt)' });
    }

    try {
        // Prüfen ob Datei bereits existiert
        try {
            await fs.access(resolved.absolute);
            return res.status(409).json({ success: false, message: 'Datei existiert bereits' });
        } catch (e) {
            // Gut — Datei existiert noch nicht
        }

        // Verzeichnis erstellen falls nötig
        await fs.mkdir(path.dirname(resolved.absolute), { recursive: true });
        await fs.writeFile(resolved.absolute, content || `# ${path.basename(filePath, '.md')}\n\n`, 'utf-8');

        Logger.info(`[Admin/Docs] Neue Datei erstellt: ${resolved.relative}`);
        return res.json({ success: true, message: 'Datei erstellt' });
    } catch (error) {
        Logger.error('[Admin/Docs] Fehler beim Erstellen:', error);
        return res.status(500).json({ success: false, message: 'Fehler beim Erstellen' });
    }
});

// ================================================================
// API: DELETE /admin/docs/api/file — Datei löschen
// ================================================================
router.delete('/api/file', apiLimiter, async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const { path: filePath } = req.body;

    const resolved = safePath(filePath);
    if (!resolved || !resolved.relative.endsWith('.md')) {
        return res.status(400).json({ success: false, message: 'Ungültiger Pfad (nur .md erlaubt)' });
    }

    // Schutz: index.md nicht löschbar
    if (resolved.relative === 'index.md') {
        return res.status(403).json({ success: false, message: 'index.md kann nicht gelöscht werden' });
    }

    try {
        await fs.unlink(resolved.absolute);
        Logger.info(`[Admin/Docs] Datei gelöscht: ${resolved.relative}`);
        return res.json({ success: true, message: 'Datei gelöscht' });
    } catch (e) {
        if (e.code === 'ENOENT') {
            return res.status(404).json({ success: false, message: 'Datei nicht gefunden' });
        }
        return res.status(500).json({ success: false, message: 'Löschfehler' });
    }
});

// ================================================================
// API: POST /admin/docs/api/folder — Ordner erstellen
// ================================================================
router.post('/api/folder', apiLimiter, async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const { path: folderPath } = req.body;

    const resolved = safePath(folderPath);
    if (!resolved) {
        return res.status(400).json({ success: false, message: 'Ungültiger Pfad' });
    }

    try {
        await fs.mkdir(resolved.absolute, { recursive: true });
        Logger.info(`[Admin/Docs] Ordner erstellt: ${resolved.relative}`);
        return res.json({ success: true, message: 'Ordner erstellt' });
    } catch (error) {
        Logger.error('[Admin/Docs] Fehler beim Ordner erstellen:', error);
        return res.status(500).json({ success: false, message: 'Fehler beim Erstellen' });
    }
});

module.exports = router;
