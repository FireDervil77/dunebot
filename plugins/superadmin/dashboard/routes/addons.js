/**
 * SuperAdmin: Addon-Marketplace Management
 * Import, Konvertierung, Testing und Approval von Gameserver-Addons
 * 
 * @author FireDervil
 * @version 1.0.0
 */

const express = require('express');
const router = express.Router();
const { ServiceManager } = require('dunebot-core');

/**
 * GET /guild/:guildId/plugins/superadmin/addons
 * Hauptseite: Addon-Verwaltung
 */
router.get('/', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const themeManager = ServiceManager.get('themeManager');
    const guildId = res.locals.guildId;
    
    // Guild-Layout setzen
    res.locals.layout = themeManager.getLayout('guild');
    
    try {
        // Alle Addons aus Marketplace laden
        const addons = await dbService.query(`
            SELECT 
                id,
                name,
                slug,
                runtime_type,
                source_type,
                status,
                trust_level,
                visibility,
                verified_at,
                verified_by,
                last_tested_at,
                created_at
            FROM addon_marketplace
            ORDER BY 
                CASE trust_level
                    WHEN 'official' THEN 1
                    WHEN 'trusted' THEN 2
                    WHEN 'verified' THEN 3
                    ELSE 4
                END,
                created_at DESC
        `);
        
        // Stats berechnen
        const stats = {
            total: addons.length,
            official: addons.filter(a => a.trust_level === 'official').length,
            trusted: addons.filter(a => a.trust_level === 'trusted').length,
            verified: addons.filter(a => a.trust_level === 'verified').length,
            unverified: addons.filter(a => a.trust_level === 'unverified').length,
            pending: addons.filter(a => a.visibility === 'pending_review').length,
            native: addons.filter(a => a.runtime_type === 'native').length,
            proton: addons.filter(a => a.runtime_type === 'proton').length,
            wine: addons.filter(a => a.runtime_type === 'wine').length,
            java: addons.filter(a => a.runtime_type === 'java').length
        };
        
        res.render('guild/addons/index', {
            guildId,
            addons,
            stats,
            pageTitle: 'Addon Marketplace Management'
        });
        
    } catch (error) {
        Logger.error('[SuperAdmin Addons] Fehler beim Laden:', error);
        res.status(500).render('error', { 
            message: 'Fehler beim Laden der Addons',
            error 
        });
    }
});

/**
 * GET /guild/:guildId/plugins/superadmin/addons/import
 * Pterodactyl Import-Seite
 */
router.get('/import', async (req, res) => {
    const themeManager = ServiceManager.get('themeManager');
    const guildId = res.locals.guildId;
    
    // Guild-Layout setzen
    res.locals.layout = themeManager.getLayout('guild');
    
    res.render('guild/addons/import', {
        guildId,
        pageTitle: 'Pterodactyl Egg Import'
    });
});

/**
 * GET /guild/:guildId/plugins/superadmin/addons/:id
 * Addon-Details + Edit
 */
router.get('/:id', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const themeManager = ServiceManager.get('themeManager');
    const guildId = res.locals.guildId;
    const addonId = req.params.id;
    
    // Guild-Layout setzen
    res.locals.layout = themeManager.getLayout('guild');
    
    try {
        const addon = await dbService.query(
            'SELECT * FROM addon_marketplace WHERE id = ?',
            [addonId]
        );
        
        if (!addon || addon.length === 0) {
            return res.status(404).render('error', { 
                message: 'Addon nicht gefunden' 
            });
        }
        
        // JSON-Felder parsen
        const addonData = addon[0];
        
        // game_data enthält die PTDL_v2-Struktur mit variables, ports, scripts etc.
        if (addonData.game_data) {
            const gameData = JSON.parse(addonData.game_data);
            addonData.variables = gameData.variables || [];
            addonData.ports = gameData.ports || [];
            addonData.scripts = gameData.scripts || {};
            addonData.meta = gameData.meta || {};
            addonData.install = gameData.install || {};
            addonData.startup = gameData.startup || {};
            addonData.config = gameData.config || {};
        }
        
        // Tags ist separate Spalte
        if (addonData.tags) {
            addonData.tags = JSON.parse(addonData.tags);
        }
        
        res.render('guild/addons/edit', {
            guildId,
            addon: addonData,
            pageTitle: `Edit: ${addonData.name}`
        });
        
    } catch (error) {
        Logger.error('[SuperAdmin Addons] Fehler beim Laden des Addons:', error);
        res.status(500).render('error', { 
            message: 'Fehler beim Laden des Addons',
            error 
        });
    }
});

/**
 * POST /guild/:guildId/plugins/superadmin/addons/:id/approve
 * Addon zur Veröffentlichung freigeben
 */
router.post('/:id/approve', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const addonId = req.params.id;
    const user = res.locals.user;
    
    try {
        const { trust_level, visibility } = req.body;
        
        // Validierung
        const validTrustLevels = ['official', 'trusted', 'verified', 'unverified'];
        const validVisibility = ['official', 'public', 'unlisted', 'private'];  // ← KORREKTUR: Echte ENUM-Werte!
        
        if (!validTrustLevels.includes(trust_level)) {
            return res.status(400).json({
                success: false,
                message: 'Ungültiger Trust-Level'
            });
        }
        
        if (!validVisibility.includes(visibility)) {
            return res.status(400).json({
                success: false,
                message: 'Ungültige Visibility'
            });
        }
        
        // ✅ Prüfe ob Author = FireDervil (544578232704565262) → Auto-Official
        const [addon] = await dbService.query('SELECT author_user_id FROM addon_marketplace WHERE id = ?', [addonId]);
        const authorId = addon[0]?.author_user_id;
        const finalTrustLevel = (authorId === '544578232704565262') ? 'official' : trust_level;
        
        // Update Addon (inkl. status → approved, published_at setzen und source_type → native nach Approval)
        await dbService.query(`
            UPDATE addon_marketplace
            SET 
                status = 'approved',
                trust_level = ?,
                visibility = ?,
                source_type = 'native',
                verified_by = ?,
                verified_at = NOW(),
                published_at = NOW()
            WHERE id = ?
        `, [finalTrustLevel, visibility, user?.info?.id || null, addonId]);
        
        Logger.info(`[SuperAdmin Addons] Addon ${addonId} approved: ${trust_level}, ${visibility} by ${user?.info?.username || 'Unknown'}`);
        
        res.json({
            success: true,
            message: 'Addon erfolgreich freigegeben'
        });
        
    } catch (error) {
        Logger.error('[SuperAdmin Addons] Fehler beim Approval:', error);
        res.status(500).json({
            success: false,
            message: 'Fehler beim Freigeben des Addons'
        });
    }
});

/**
 * POST /guild/:guildId/plugins/superadmin/addons/:id/test
 * Installation auf Test-Daemon triggern
 */
router.post('/:id/test', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const addonId = req.params.id;
    
    try {
        // TODO: Integration mit Daemon (Phase 3)
        // Aktuell nur Logging
        
        Logger.info(`[SuperAdmin Addons] Test-Installation für Addon ${addonId} getriggert`);
        
        // Last-Tested-Timestamp setzen
        await dbService.query(
            'UPDATE addon_marketplace SET last_tested_at = NOW() WHERE id = ?',
            [addonId]
        );
        
        res.json({
            success: true,
            message: 'Test-Installation gestartet (TODO: Daemon-Integration)'
        });
        
    } catch (error) {
        Logger.error('[SuperAdmin Addons] Fehler beim Testen:', error);
        res.status(500).json({
            success: false,
            message: 'Fehler beim Starten des Tests'
        });
    }
});

/**
 * POST /guild/:guildId/plugins/superadmin/addons
 * Pterodactyl-Egg als Addon speichern (Draft)
 */
router.post('/', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const guildId = res.locals.guildId;
    const userId = res.locals.user?.info?.id;  // ✅ KORREKTUR: user.info.id statt user.id!
    
    try {
        const {
            name, slug, description, category,
            runtime_type, source_type,
            variables, ports, scripts,
            meta, install, installation, startup, config  // ✅ installation hinzugefügt
        } = req.body;
        
        // Validierung
        if (!name) {
            return res.status(400).json({
                success: false,
                message: 'Name ist erforderlich'
            });
        }
        
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: 'User nicht authentifiziert'
            });
        }
        
        // Auto-generate slug if not provided
        const finalSlug = slug || name.toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
        
        // Prüfe ob Slug bereits existiert
        const existingSlug = await dbService.query(
            'SELECT id FROM addon_marketplace WHERE slug = ?',
            [finalSlug]
        );
        
        if (existingSlug.length > 0) {
            return res.status(400).json({
                success: false,
                message: `Slug "${finalSlug}" existiert bereits. Bitte Namen ändern.`
            });
        }
        
        // PTDL_v2 game_data strukturieren
        const gameData = {
            meta: {
                version: 'PTDL_v2',
                name: name || 'Imported Egg',
                author: 'Pterodactyl Community',
                description: description || '',
                category: category || 'imported'
            },
            install: install || {},
            installation: installation || {},  // ✅ NEU: installation für Daemon
            startup: startup || {},
            config: config || {},
            scripts: scripts || {},
            // ✅ variables kann jetzt Object (Map) oder Array sein
            variables: typeof variables === 'object' && variables !== null 
                ? variables 
                : (typeof variables === 'string' ? JSON.parse(variables) : []),
            // ✅ ports kann Object oder Array sein
            ports: typeof ports === 'object' && ports !== null
                ? ports
                : (typeof ports === 'string' ? JSON.parse(ports) : [])
        };
        
        // ✅ Steam App ID extrahieren (aus variables Map)
        let steamAppId = null;
        if (typeof variables === 'object' && variables !== null) {
            // Suche nach SRCDS_APPID, STEAM_APPID, APP_ID etc.
            steamAppId = variables.SRCDS_APPID || variables.STEAM_APPID || 
                         variables.APP_ID || variables.STEAM_APP_ID || null;
        }
        
        // INSERT in addon_marketplace (Spalten-Reihenfolge entspricht SQL-Schema!)
        const result = await dbService.query(`
            INSERT INTO addon_marketplace (
                name, slug, description, author_user_id,
                visibility, status, trust_level,
                game_data, category, runtime_type, source_type,
                steam_app_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            name || 'Unnamed Addon',                                    // name
            finalSlug,                                                  // slug
            description || '',                                          // description
            userId,                                                     // author_user_id (validiert oben, NOT NULL!)
            'unlisted',                                                 // visibility (ENUM: official, public, unlisted, private) - unlisted bis approved
            'pending_review',                                           // status (ENUM: draft, pending_review, approved, rejected)
            'unverified',                                               // trust_level (ENUM: unverified, verified, trusted, official)
            JSON.stringify(gameData),                                   // game_data (JSON)
            category || 'other',                                        // category (ENUM: fps, survival, sandbox, mmorpg, racing, strategy, horror, scifi, other)
            runtime_type || 'native_steamcmd',                          // runtime_type (ENUM: native_steamcmd, proton, wine, java, nodejs, python, custom)
            source_type || 'pterodactyl',                               // source_type (ENUM: native, pterodactyl, custom)
            steamAppId                                                  // steam_app_id (INT NULL)
        ]);
        
        Logger.info(`[SuperAdmin Addons] Pterodactyl-Egg importiert: ${name} (ID: ${result.insertId}) von User ${userId}`);
        
        res.json({
            success: true,
            message: 'Addon erfolgreich als Draft gespeichert',
            id: result.insertId
        });
        
    } catch (error) {
        Logger.error('[SuperAdmin Addons] Fehler beim Speichern:', error);
        res.status(500).json({
            success: false,
            message: 'Fehler beim Speichern des Addons: ' + error.message
        });
    }
});

/**
 * DELETE /guild/:guildId/plugins/superadmin/addons/:id
 * Addon löschen
 */
router.delete('/:id', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const addonId = req.params.id;
    
    try {
        // Prüfen ob Server mit diesem Addon existieren
        const servers = await dbService.query(
            'SELECT COUNT(*) as count FROM gameservers WHERE addon_marketplace_id = ?',
            [addonId]
        );
        
        if (servers[0].count > 0) {
            return res.status(400).json({
                success: false,
                message: `Addon kann nicht gelöscht werden: ${servers[0].count} Server nutzen dieses Addon. Bitte zuerst die Server löschen.`
            });
        }
        
        await dbService.query('DELETE FROM addon_marketplace WHERE id = ?', [addonId]);
        
        Logger.info(`[SuperAdmin Addons] Addon ${addonId} gelöscht`);
        
        res.json({
            success: true,
            message: 'Addon erfolgreich gelöscht'
        });
        
    } catch (error) {
        Logger.error('[SuperAdmin Addons] Fehler beim Löschen:', error);
        
        // Foreign Key Constraint Error
        if (error.code === 'ER_ROW_IS_REFERENCED_2') {
            return res.status(400).json({
                success: false,
                message: 'Addon kann nicht gelöscht werden: Es existieren noch Server die dieses Addon nutzen'
            });
        }
        
        res.status(500).json({
            success: false,
            message: 'Fehler beim Löschen des Addons'
        });
    }
});

// ============================================================================
// PTERODACTYL IMPORT API (GitHub-Zugriff für SuperAdmin)
// ============================================================================

/**
 * GET /pterodactyl/categories
 * Liste aller verfügbaren Pterodactyl-Kategorien
 */
router.get('/pterodactyl/categories', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const path = require('path');
    
    try {
        const importerPath = path.join(__dirname, '../../../gameserver/dashboard/helpers/PterodactylImporter');
        const PterodactylImporter = require(importerPath);
        const importer = new PterodactylImporter();
        const categories = importer.getCategories();
        
        res.json({
            success: true,
            categories: categories.map(cat => ({
                id: cat.id,
                name: cat.name
            }))
        });
    } catch (error) {
        Logger.error('[SuperAdmin Addons] Fehler beim Laden der Kategorien:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

/**
 * GET /pterodactyl/eggs/:category
 * Liste aller Eggs einer Kategorie
 */
router.get('/pterodactyl/eggs/:category', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const path = require('path');
    const { category } = req.params;
    
    try {
        const importerPath = path.join(__dirname, '../../../gameserver/dashboard/helpers/PterodactylImporter');
        const PterodactylImporter = require(importerPath);
        const importer = new PterodactylImporter();
        const eggs = await importer.fetchEggsList(category);
        
        res.json({
            success: true,
            category,
            eggs: eggs.map(egg => ({
                name: egg.name,
                displayName: egg.displayName,
                downloadUrl: egg.downloadUrl
            }))
        });
    } catch (error) {
        Logger.error(`[SuperAdmin Addons] Fehler beim Laden der Eggs (${category}):`, error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

/**
 * GET /pterodactyl/fetch/:category/:eggName
 * Fetch + Convert spezifisches Pterodactyl Egg (nutzt DB-Cache!)
 */
// Route für Pterodactyl Egg Import
// Nutzt Query-Parameter um Slashes im eggName zu unterstützen
router.get('/pterodactyl/fetch/:category', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const path = require('path');
    
    const category = req.params.category;
    const eggName = req.query.egg; // Query-Parameter: ?egg=valheim/valheim_vanilla
    
    Logger.info(`[SuperAdmin Addons] Pterodactyl fetch: category=${category}, egg=${eggName}`);
    
    if (!eggName) {
        return res.status(400).json({
            success: false,
            message: 'Missing egg parameter. Use: /pterodactyl/fetch/CATEGORY?egg=EGG_NAME'
        });
    }
    
    try {
        Logger.info(`[SuperAdmin Addons] Importing Pterodactyl egg: ${category}/${eggName}`);
        
        const importerPath = path.join(__dirname, '../../../gameserver/dashboard/helpers/PterodactylImporter');
        const PterodactylImporter = require(importerPath);
        
        // 1. Prüfe ob wir die URL aus dem Cache haben
        const cached = await dbService.query(`
            SELECT download_url, json_data 
            FROM gameserver_pterodactyl_cache 
            WHERE category = ? AND egg_name = ?
        `, [category, eggName]);
        
        let pterodactylEgg;
        
        if (cached.length > 0 && cached[0].download_url) {
            // Cache Hit! Nutze die korrekte URL aus der DB
            Logger.debug(`[SuperAdmin Addons] Using cached download_url: ${cached[0].download_url}`);
            
            const importer = new PterodactylImporter();
            
            // Falls json_data gecached ist, nutze das
            if (cached[0].json_data) {
                Logger.debug('[SuperAdmin Addons] Using cached JSON data');
                pterodactylEgg = typeof cached[0].json_data === 'string' 
                    ? JSON.parse(cached[0].json_data) 
                    : cached[0].json_data;
            } else {
                // Lade direkt von der gecachten URL (korrekte Filename!)
                pterodactylEgg = await importer.fetch(cached[0].download_url);
            }
        } else {
            // Cache Miss - Fallback zur alten Methode (mit Filename-Guessing)
            Logger.warn(`[SuperAdmin Addons] Cache miss for ${category}/${eggName}, using fallback`);
            const importer = new PterodactylImporter();
            pterodactylEgg = await importer.fetchEggJSON(category, eggName);
        }
        
        const importer = new PterodactylImporter();
        const convertedEgg = importer.convertToOurFormat(pterodactylEgg);
        
        res.json({
            success: true,
            category,
            eggName,
            data: convertedEgg  // ← Konsistente Response-Struktur!
        });
        
    } catch (error) {
        Logger.error('[SuperAdmin Addons] Fehler beim Importieren des Pterodactyl-Eggs:', error);
        res.status(500).json({
            success: false,
            message: error?.message || 'Fehler beim Importieren des Eggs'
        });
    }
});

module.exports = router;
