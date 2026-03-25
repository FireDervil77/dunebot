/**
 * Admin: Addon-Marketplace Management
 *
 * Endpoints:
 *   GET  /admin/addons                                            — Übersicht
 *   GET  /admin/addons/import                                     — Import-UI
 *   GET  /admin/addons/repositories                               — Pelican Repo-Liste (JSON)
 *   GET  /admin/addons/repositories/:repo/eggs                    — Egg-Liste eines Repos (JSON)
 *   GET  /admin/addons/repositories/:repo/eggs/fetch?url=...      — Egg laden + konvertieren (JSON)
 *   POST /admin/addons                                            — Neues Addon speichern (Draft)
 *   GET  /admin/addons/:id                                        — Addon-Detail + Edit
 *   PUT  /admin/addons/:id                                        — Addon aktualisieren
 *   POST /admin/addons/:id/approve                                — Addon freigeben
 *   POST /admin/addons/:id/test                                   — Test-Installation triggern
 *   DELETE /admin/addons/:id                                      — Addon löschen
 *
 * game_data Format: FIREBOT_v2 (docker_images, scripts.installation.container/entrypoint/script)
 *
 * @author FireDervil
 * @version 2.0.0
 */

'use strict';

const path    = require('path');
const express = require('express');

const router = express.Router();

const { ServiceManager } = require('dunebot-core');

// ─────────────────────────────────────────────────────────────────────────────
// Lazy-require Importer
// ─────────────────────────────────────────────────────────────────────────────
function getEggImporter() {
    const EggImporter = require(
        path.join(__dirname, '../../../../plugins/gameserver/dashboard/helpers/EggImporter')
    );
    return new EggImporter();
}

// ─────────────────────────────────────────────────────────────────────────────
// Hilfsfunktionen
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Leitet den runtime_type aus FIREBOT_v2 game_data ab.
 * @param {object} gameData
 * @returns {'docker_steam'|'docker_standalone'}
 */
function detectRuntimeType(gameData) {
    const script = gameData?.scripts?.installation?.script || '';
    const vars   = gameData?.variables || [];

    const hasSteam = script.toLowerCase().includes('steamcmd')
        || vars.some(v => v.env_variable === 'SRCDS_APPID' || v.env_variable === 'STEAM_APPID');

    return hasSteam ? 'docker_steam' : 'docker_standalone';
}

/**
 * Extrahiert die Steam AppID aus game_data.
 * @param {object} gameData
 * @returns {string|null}
 */
function extractSteamAppId(gameData) {
    const vars = gameData?.variables || [];

    const v = vars.find(v => v.env_variable === 'SRCDS_APPID' || v.env_variable === 'STEAM_APPID');
    if (v?.default_value && /^\d+$/.test(v.default_value)) return v.default_value;

    const match = (gameData?.scripts?.installation?.script || '').match(/app_update\s+(\d+)/i);
    if (match) return match[1];

    return null;
}

/**
 * Parst game_data sicher aus einem DB-Row.
 * @param {object} row
 * @returns {object}
 */
function parseGameData(row) {
    if (!row.game_data) return {};
    try {
        return typeof row.game_data === 'string' ? JSON.parse(row.game_data) : row.game_data;
    } catch {
        return {};
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/addons — Übersicht
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
    const Logger       = ServiceManager.get('Logger');
    const dbService    = ServiceManager.get('dbService');
    const themeManager = ServiceManager.get('themeManager');

    res.locals.layout = themeManager.getLayout('guild');

    try {
        const addons = await dbService.query(`
            SELECT
                id, name, slug, runtime_type, source_type,
                status, trust_level, visibility,
                verified_at, verified_by, last_tested_at, created_at
            FROM addon_marketplace
            ORDER BY
                CASE trust_level
                    WHEN 'official' THEN 1
                    WHEN 'trusted'  THEN 2
                    WHEN 'verified' THEN 3
                    ELSE 4
                END,
                created_at DESC
        `);

        const stats = {
            total:             addons.length,
            official:          addons.filter(a => a.trust_level === 'official').length,
            pending_review:    addons.filter(a => a.status === 'pending_review').length,
            docker_steam:      addons.filter(a => a.runtime_type === 'docker_steam').length,
            docker_standalone: addons.filter(a => a.runtime_type === 'docker_standalone').length,
        };

        res.render('admin/addons/index', { addons, stats, pageTitle: 'Addon Marketplace' });

    } catch (err) {
        Logger.error('[Addons] Fehler Übersicht:', err);
        res.status(500).render('error', { message: 'Fehler beim Laden der Addons', error: err });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/addons/import — Import-UI (Pelican Repo-Browser)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/import', (req, res) => {
    const themeManager = ServiceManager.get('themeManager');
    res.locals.layout  = themeManager.getLayout('guild');
    res.render('admin/addons/import', { pageTitle: 'Egg importieren' });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/addons/create — Manuell erstellen / externe URL importieren
// ─────────────────────────────────────────────────────────────────────────────
router.get('/create', (req, res) => {
    const themeManager = ServiceManager.get('themeManager');
    res.locals.layout  = themeManager.getLayout('guild');
    res.render('admin/addons/create', { pageTitle: 'Addon erstellen' });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/addons/fetch-external?url= — Externes Egg per URL laden
// Erlaubte Hosts: raw.githubusercontent.com, gist.githubusercontent.com
// ─────────────────────────────────────────────────────────────────────────────
router.get('/fetch-external', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const { url } = req.query;

    if (!url) {
        return res.status(400).json({ success: false, message: 'Parameter ?url= fehlt' });
    }

    // URL-Validierung
    let parsedUrl;
    try {
        parsedUrl = new URL(url);
    } catch {
        return res.status(400).json({ success: false, message: 'Ungültige URL' });
    }

    // Nur HTTPS + allowlisted Hosts (SSRF-Schutz)
    if (parsedUrl.protocol !== 'https:') {
        return res.status(400).json({ success: false, message: 'Nur HTTPS-URLs erlaubt' });
    }
    const ALLOWED_HOSTS = ['raw.githubusercontent.com', 'gist.githubusercontent.com'];
    if (!ALLOWED_HOSTS.includes(parsedUrl.hostname)) {
        return res.status(400).json({
            success: false,
            message: `Host nicht erlaubt. Erlaubt: ${ALLOWED_HOSTS.join(', ')}`,
        });
    }

    try {
        Logger.info(`[Addons] Externes Egg laden: ${url}`);
        const importer = getEggImporter();
        const egg      = await importer.fetchEgg(url);
        const gameData = importer.convert(egg);
        res.json({ success: true, gameData });
    } catch (err) {
        Logger.error(`[Addons] Externes Egg fehlgeschlagen (${url}):`, err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/addons/repositories — Liste Pelican Repositories
// ─────────────────────────────────────────────────────────────────────────────
router.get('/repositories', (req, res) => {
    const importer = getEggImporter();
    res.json({ success: true, repositories: importer.getRepositories() });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/addons/repositories/:repo/eggs — Eggs eines Repos auflisten
// ─────────────────────────────────────────────────────────────────────────────
router.get('/repositories/:repo/eggs', async (req, res) => {
    const Logger  = ServiceManager.get('Logger');
    const { repo } = req.params;

    try {
        const importer = getEggImporter();
        const eggs     = await importer.listEggs(repo);
        res.json({ success: true, repo, eggs });
    } catch (err) {
        Logger.error(`[Addons] Eggs laden fehlgeschlagen (${repo}):`, err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/addons/repositories/:repo/eggs/fetch?url=<rawUrl>
// Lädt ein einzelnes Egg und konvertiert es in FIREBOT_v2
// ─────────────────────────────────────────────────────────────────────────────
router.get('/repositories/:repo/eggs/fetch', async (req, res) => {
    const Logger    = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const { repo }  = req.params;
    const { url }   = req.query;

    if (!url) {
        return res.status(400).json({
            success: false,
            message: 'Query-Parameter ?url= fehlt. Verwende die URL aus der Egg-Liste.',
        });
    }

    // Nur raw.githubusercontent.com URLs erlaubt (kein SSRF)
    if (!url.startsWith('https://raw.githubusercontent.com/')) {
        return res.status(400).json({
            success: false,
            message: 'Nur raw.githubusercontent.com URLs sind erlaubt.',
        });
    }

    try {
        Logger.info(`[Addons] Egg laden: ${url}`);

        // Cache prüfen
        const cached = await dbService.query(
            'SELECT json_data FROM gameserver_pterodactyl_cache WHERE download_url = ?',
            [url]
        );

        let egg;
        const importer = getEggImporter();

        if (cached.length > 0 && cached[0].json_data) {
            Logger.info('[Addons] Egg aus Cache geladen');
            egg = typeof cached[0].json_data === 'string'
                ? JSON.parse(cached[0].json_data)
                : cached[0].json_data;
        } else {
            egg = await importer.fetchEgg(url);
        }

        const gameData = importer.convert(egg);

        res.json({ success: true, repo, gameData });

    } catch (err) {
        Logger.error(`[Addons] Egg fetch fehlgeschlagen (${url}):`, err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /admin/addons — Addon speichern (aus Import)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
    const Logger    = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const userId    = res.locals.user?.id;

    if (!userId) {
        return res.status(401).json({ success: false, message: 'Nicht authentifiziert' });
    }

    try {
        const { name, slug, description, category, game_data, source_type } = req.body;

        if (!name || !game_data) {
            return res.status(400).json({
                success: false,
                message: 'name und game_data sind erforderlich',
            });
        }

        let gameData;
        try {
            gameData = typeof game_data === 'string' ? JSON.parse(game_data) : game_data;
        } catch {
            return res.status(400).json({ success: false, message: 'game_data ist kein valides JSON' });
        }

        // ── Auto-Konvertierung: Pterodactyl/Pelican Egg → FIREBOT_v2 ────
        // Wenn das eingefügte JSON kein FIREBOT_v2 Format hat (z.B. PTDL_v2),
        // wird es automatisch durch den EggImporter konvertiert.
        if (gameData?.meta?.version !== 'FIREBOT_v2') {
            try {
                const importer = getEggImporter();
                gameData = importer.convert(gameData);
                Logger.info(`[Addons] Auto-Konvertierung: ${gameData.meta?.version || 'unbekanntes Format'} → FIREBOT_v2`);
            } catch (convErr) {
                Logger.warn('[Addons] Auto-Konvertierung fehlgeschlagen:', convErr.message);
                return res.status(400).json({
                    success: false,
                    message: `Konvertierung fehlgeschlagen: ${convErr.message}. Bitte FIREBOT_v2 Format verwenden.`,
                });
            }
        }

        // Slug generieren falls nicht angegeben
        const finalSlug = slug
            ? slug.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '')
            : name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

        const exists = await dbService.query(
            'SELECT id FROM addon_marketplace WHERE slug = ?',
            [finalSlug]
        );
        if (exists.length > 0) {
            return res.status(400).json({
                success: false,
                message: `Slug "${finalSlug}" existiert bereits`,
            });
        }

        const runtimeType = detectRuntimeType(gameData);
        const steamAppId  = extractSteamAppId(gameData);

        const VALID_CATEGORIES = ['fps','survival','sandbox','mmorpg','racing','strategy','horror','scifi','other'];
        const safeCategory = VALID_CATEGORIES.includes(category) ? category : 'other';

        const VALID_SOURCES = ['pelican', 'community', 'native'];
        const safeSourceType = VALID_SOURCES.includes(source_type) ? source_type : 'pelican';

        const result = await dbService.query(`
            INSERT INTO addon_marketplace
                (name, slug, description, author_user_id,
                 visibility, status, trust_level,
                 game_data, category, runtime_type, source_type, steam_app_id)
            VALUES (?, ?, ?, ?, 'unlisted', 'pending_review', 'unverified', ?, ?, ?, ?, ?)
        `, [
            name,
            finalSlug,
            description || gameData.meta?.description || '',
            userId,
            JSON.stringify(gameData),
            safeCategory,
            runtimeType,
            safeSourceType,
            steamAppId,
        ]);

        Logger.info(`[Addons] Neu importiert: ${name} (ID: ${result.insertId}, ${runtimeType})`);

        res.json({
            success: true,
            message: 'Addon importiert und zur Prüfung eingereicht',
            id:      result.insertId,
        });

    } catch (err) {
        Logger.error('[Addons] Speichern fehlgeschlagen:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/addons/:id — Detail + Edit
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
    const Logger       = ServiceManager.get('Logger');
    const dbService    = ServiceManager.get('dbService');
    const themeManager = ServiceManager.get('themeManager');

    res.locals.layout = themeManager.getLayout('guild');

    try {
        const rows = await dbService.query(
            'SELECT * FROM addon_marketplace WHERE id = ?',
            [req.params.id]
        );

        if (!rows.length) {
            return res.status(404).render('error', { message: 'Addon nicht gefunden' });
        }

        const addon     = rows[0];
        addon.game_data = parseGameData(addon);

        if (addon.tags) {
            try   { addon.tags = JSON.parse(addon.tags); }
            catch { addon.tags = addon.tags.split(',').map(t => t.trim()).filter(Boolean); }
        }

        res.render('admin/addons/edit', { addon, pageTitle: `Edit: ${addon.name}` });

    } catch (err) {
        Logger.error('[Addons] Detail laden fehlgeschlagen:', err);
        res.status(500).render('error', { message: 'Fehler beim Laden', error: err });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /admin/addons/:id — Addon aktualisieren
// ─────────────────────────────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
    const Logger    = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const { id }    = req.params;

    try {
        const { name, slug, description, tags, game_data } = req.body;

        if (!name || !slug) {
            return res.status(400).json({ success: false, message: 'name und slug sind erforderlich' });
        }

        // Slug-Konflikt prüfen (nicht gegen sich selbst)
        const conflict = await dbService.query(
            'SELECT id FROM addon_marketplace WHERE slug = ? AND id != ?',
            [slug, id]
        );
        if (conflict.length) {
            return res.status(400).json({ success: false, message: `Slug "${slug}" wird bereits verwendet` });
        }

        let gameData = null;
        if (game_data !== undefined) {
            try {
                gameData = typeof game_data === 'string' ? JSON.parse(game_data) : game_data;
            } catch {
                return res.status(400).json({ success: false, message: 'game_data ist kein valides JSON' });
            }

            // ── Auto-Konvertierung: Pterodactyl/Pelican Egg → FIREBOT_v2 ────
            if (gameData?.meta?.version !== 'FIREBOT_v2') {
                try {
                    const importer = getEggImporter();
                    gameData = importer.convert(gameData);
                    Logger.info(`[Addons] PUT Auto-Konvertierung → FIREBOT_v2 für ID ${id}`);
                } catch (convErr) {
                    Logger.warn(`[Addons] PUT Auto-Konvertierung fehlgeschlagen für ID ${id}:`, convErr.message);
                    return res.status(400).json({
                        success: false,
                        message: `Konvertierung fehlgeschlagen: ${convErr.message}. Bitte FIREBOT_v2 Format verwenden.`,
                    });
                }
            }
        }

        const tagsJson = tags
            ? JSON.stringify(tags.split(',').map(t => t.trim()).filter(Boolean))
            : null;

        if (gameData) {
            const runtimeType = detectRuntimeType(gameData);
            await dbService.query(`
                UPDATE addon_marketplace
                SET name = ?, slug = ?, description = ?, tags = ?,
                    game_data = ?, runtime_type = ?, updated_at = NOW()
                WHERE id = ?
            `, [name, slug, description || '', tagsJson, JSON.stringify(gameData), runtimeType, id]);
        } else {
            await dbService.query(`
                UPDATE addon_marketplace
                SET name = ?, slug = ?, description = ?, tags = ?, updated_at = NOW()
                WHERE id = ?
            `, [name, slug, description || '', tagsJson, id]);
        }

        Logger.info(`[Addons] Aktualisiert: ID ${id} → ${name}`);
        res.json({ success: true, message: 'Addon gespeichert' });

    } catch (err) {
        Logger.error('[Addons] Update fehlgeschlagen:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /admin/addons/:id/approve — Addon freigeben
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:id/approve', async (req, res) => {
    const Logger    = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const user      = res.locals.user;

    try {
        const { trust_level, visibility } = req.body;

        const validTrust      = ['official', 'trusted', 'verified', 'unverified'];
        const validVisibility = ['official', 'public', 'unlisted', 'private'];

        if (!validTrust.includes(trust_level)) {
            return res.status(400).json({ success: false, message: 'Ungültiger trust_level' });
        }
        if (!validVisibility.includes(visibility)) {
            return res.status(400).json({ success: false, message: 'Ungültige visibility' });
        }

        const rows = await dbService.query(
            'SELECT author_user_id FROM addon_marketplace WHERE id = ?',
            [req.params.id]
        );
        // FireDervil bekommt immer official trust_level
        const finalTrustLevel = rows[0]?.author_user_id === '544578232704565262'
            ? 'official'
            : trust_level;

        await dbService.query(`
            UPDATE addon_marketplace
            SET status = 'approved', trust_level = ?, visibility = ?,
                source_type = 'native', verified_by = ?, verified_at = NOW(), published_at = NOW()
            WHERE id = ?
        `, [finalTrustLevel, visibility, user?.info?.id || null, req.params.id]);

        Logger.info(`[Addons] Approved: ID ${req.params.id} (${finalTrustLevel}/${visibility})`);
        res.json({ success: true, message: 'Addon freigegeben' });

    } catch (err) {
        Logger.error('[Addons] Approve fehlgeschlagen:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /admin/addons/:id/test — Test-Installation triggern
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:id/test', async (req, res) => {
    const Logger    = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');

    try {
        await dbService.query(
            'UPDATE addon_marketplace SET last_tested_at = NOW() WHERE id = ?',
            [req.params.id]
        );
        // TODO Phase 2: Daemon-Integration
        Logger.info(`[Addons] Test-Install getriggert: ID ${req.params.id}`);
        res.json({ success: true, message: 'Test-Installation gestartet (Daemon-Integration folgt)' });

    } catch (err) {
        Logger.error('[Addons] Test fehlgeschlagen:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /admin/addons/:id — Addon löschen
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
    const Logger    = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');

    try {
        const count = await dbService.query(
            'SELECT COUNT(*) as n FROM gameservers WHERE addon_marketplace_id = ?',
            [req.params.id]
        );
        if (count[0].n > 0) {
            return res.status(400).json({
                success: false,
                message: `${count[0].n} Server nutzen dieses Addon — zuerst Server löschen`,
            });
        }

        await dbService.query('DELETE FROM addon_marketplace WHERE id = ?', [req.params.id]);
        Logger.info(`[Addons] Gelöscht: ID ${req.params.id}`);
        res.json({ success: true, message: 'Addon gelöscht' });

    } catch (err) {
        Logger.error('[Addons] Löschen fehlgeschlagen:', err);
        if (err.code === 'ER_ROW_IS_REFERENCED_2') {
            return res.status(400).json({
                success: false,
                message: 'Addon wird noch von einem Server referenziert',
            });
        }
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
