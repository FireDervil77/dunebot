/**
 * Guild: Addon Marketplace & eigene Addons
 *
 * Endpunkte:
 *   GET  /                   — Marketplace (approved + public/official)
 *   GET  /my-addons          — Eigene Addons der Guild/User
 *   GET  /create             — Addon-Editor (neu)
 *   GET  /edit/:id           — Addon-Editor (bearbeiten)
 *   POST /                   — Eigenes Addon anlegen (FIREBOT_v2)
 *   PUT  /:id                — Eigenes Addon aktualisieren (FIREBOT_v2)
 *   DELETE /:id              — Eigenes Addon löschen
 *   GET  /:slug              — Addon-Detailseite
 *
 * game_data Format: FIREBOT_v2
 *
 * @author FireDervil
 * @version 2.0.0
 */

'use strict';

const express = require('express');
const router  = express.Router();
const { ServiceManager } = require('dunebot-core');

// ─────────────────────────────────────────────────────────────────────────────
// Hilfsfunktionen
// ─────────────────────────────────────────────────────────────────────────────

function parseGameData(row) {
    if (!row?.game_data) return {};
    try {
        return typeof row.game_data === 'string' ? JSON.parse(row.game_data) : row.game_data;
    } catch {
        return {};
    }
}

function detectRuntimeType(gameData) {
    const script = gameData?.scripts?.installation?.script || '';
    const vars   = gameData?.variables || [];
    const hasSteam = script.toLowerCase().includes('steamcmd')
        || vars.some(v => v.env_variable === 'SRCDS_APPID' || v.env_variable === 'STEAM_APPID');
    return hasSteam ? 'docker_steam' : 'docker_standalone';
}

function parseTags(tags) {
    if (!tags) return null;
    try {
        const arr = typeof tags === 'string' ? JSON.parse(tags) : tags;
        return JSON.stringify(Array.isArray(arr) ? arr : [arr]);
    } catch {
        return JSON.stringify(tags.split(',').map(t => t.trim()).filter(Boolean));
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET / — Marketplace
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
    const Logger       = ServiceManager.get('Logger');
    const dbService    = ServiceManager.get('dbService');
    const themeManager = ServiceManager.get('themeManager');

    try {
        const guildId = res.locals.guildId;
        const { category, search, sort } = req.query;

        let query = `
            SELECT id, slug, name, description, category, tags,
                   steam_app_id, author_user_id, trust_level, visibility,
                   status, rating_avg, rating_count, install_count,
                   icon_url, banner_url, runtime_type, created_at
            FROM addon_marketplace
            WHERE status = 'approved'
            AND (visibility = 'official' OR visibility = 'public')
        `;
        const params = [];

        if (category && category !== 'all') {
            query += ' AND category = ?';
            params.push(category);
        }
        if (search) {
            query += ' AND (name LIKE ? OR description LIKE ? OR tags LIKE ?)';
            const term = `%${search}%`;
            params.push(term, term, term);
        }

        const orderMap = {
            newest:  'ORDER BY created_at DESC',
            popular: 'ORDER BY install_count DESC',
            rating:  'ORDER BY rating_avg DESC, rating_count DESC',
        };
        query += ` ${orderMap[sort] || 'ORDER BY trust_level DESC, rating_avg DESC, install_count DESC'}`;

        const [addons, categories] = await Promise.all([
            dbService.query(query, params),
            dbService.query(`
                SELECT DISTINCT category, COUNT(*) as count
                FROM addon_marketplace
                WHERE status = 'approved' AND (visibility = 'official' OR visibility = 'public')
                GROUP BY category ORDER BY count DESC
            `),
        ]);

        await themeManager.renderView(res, 'guild/gameserver-marketplace', {
            title: 'Addon Marketplace',
            activeMenu: `/guild/${guildId}/plugins/gameserver/addons`,
            addons: addons || [],
            categories: categories || [],
            filters: { category: category || 'all', search: search || '', sort: sort || 'default' },
            guildId,
            user: req.session.user,
        });
    } catch (err) {
        Logger.error('[Gameserver/Addons] Marketplace Error:', err);
        res.status(500).render('error', { message: 'Fehler beim Laden des Marketplace', error: err });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /my-addons
// ─────────────────────────────────────────────────────────────────────────────
router.get('/my-addons', async (req, res) => {
    const Logger       = ServiceManager.get('Logger');
    const dbService    = ServiceManager.get('dbService');
    const themeManager = ServiceManager.get('themeManager');

    try {
        const guildId = res.locals.guildId;
        const userId  = req.session.user.info.id;

        const myAddons = await dbService.query(`
            SELECT id, slug, name, description, category, visibility,
                   status, trust_level, runtime_type, install_count, icon_url, updated_at
            FROM addon_marketplace
            WHERE (guild_id = ? OR author_user_id = ?) AND status != 'rejected'
            ORDER BY updated_at DESC
        `, [guildId, userId]);

        await themeManager.renderView(res, 'guild/gameserver-my-addons', {
            title: 'Meine Addons',
            activeMenu: `/guild/${guildId}/plugins/gameserver/addons/my-addons`,
            myAddons: myAddons || [],
            guildId,
            user: req.session.user,
        });
    } catch (err) {
        Logger.error('[Gameserver/Addons] My-Addons Error:', err);
        res.status(500).render('error', { message: 'Fehler beim Laden deiner Addons', error: err });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /create — Addon-Editor (neu)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/create', async (req, res) => {
    const Logger       = ServiceManager.get('Logger');
    const dbService    = ServiceManager.get('dbService');
    const themeManager = ServiceManager.get('themeManager');

    try {
        const guildId  = res.locals.guildId;
        const userId   = req.session.user.info.id;

        let template = null;
        let gameData = {};

        // Clone-Support: ?template=clone:123
        const templateSource = req.query.template;
        if (templateSource?.startsWith('clone:')) {
            const cloneId = templateSource.split(':')[1];
            const [addon] = await dbService.query(
                'SELECT * FROM addon_marketplace WHERE id = ? AND (guild_id = ? OR author_user_id = ?)',
                [cloneId, guildId, userId]
            );
            if (addon) {
                template = addon;
                gameData = parseGameData(addon);
            }
        }

        const myAddons = await dbService.query(
            `SELECT id, name, category FROM addon_marketplace
             WHERE (guild_id = ? OR author_user_id = ?) AND status != 'rejected'
             ORDER BY created_at DESC`,
            [guildId, userId]
        );

        await themeManager.renderView(res, 'guild/gameserver-addon-editor', {
            title: 'Neues Addon erstellen',
            activeMenu: `/guild/${guildId}/plugins/gameserver/addons/my-addons`,
            mode: 'create',
            template: template || null,
            gameData,
            myAddons: myAddons || [],
            guildId,
            user: req.session.user,
        });
    } catch (err) {
        Logger.error('[Gameserver/Addons] Create-Editor Error:', err);
        res.status(500).render('error', { message: 'Fehler beim Laden des Editors', error: err });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /edit/:id — Addon-Editor (bearbeiten)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/edit/:id', async (req, res) => {
    const Logger       = ServiceManager.get('Logger');
    const dbService    = ServiceManager.get('dbService');
    const themeManager = ServiceManager.get('themeManager');

    try {
        const guildId = res.locals.guildId;
        const userId  = req.session.user.info.id;

        const [addon] = await dbService.query(
            'SELECT * FROM addon_marketplace WHERE id = ? AND (guild_id = ? OR author_user_id = ?)',
            [req.params.id, guildId, userId]
        );

        if (!addon) {
            return res.status(404).render('error', { message: 'Addon nicht gefunden oder keine Berechtigung' });
        }

        await themeManager.renderView(res, 'guild/gameserver-addon-editor', {
            title: `Addon bearbeiten: ${addon.name}`,
            activeMenu: `/guild/${guildId}/plugins/gameserver/addons/my-addons`,
            mode: 'edit',
            addon,
            gameData: parseGameData(addon),
            template: null,
            guildId,
            user: req.session.user,
        });
    } catch (err) {
        Logger.error('[Gameserver/Addons] Edit-Editor Error:', err);
        res.status(500).render('error', { message: 'Fehler beim Laden des Editors', error: err });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /:slug — Addon-Detail
// WICHTIG: Muss nach /my-addons, /create und /edit/:id stehen!
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:slug', async (req, res) => {
    const Logger       = ServiceManager.get('Logger');
    const dbService    = ServiceManager.get('dbService');
    const themeManager = ServiceManager.get('themeManager');

    try {
        const guildId = res.locals.guildId;

        const [addon] = await dbService.query(`
            SELECT id, slug, name, description, category, tags,
                   steam_app_id, steam_server_app_id, author_user_id, game_data,
                   trust_level, visibility, status, runtime_type,
                   rating_avg, rating_count, install_count,
                   icon_url, banner_url, screenshots, created_at
            FROM addon_marketplace
            WHERE slug = ? AND status = 'approved'
        `, [req.params.slug]);

        if (!addon) {
            return res.status(404).render('error', { message: 'Addon nicht gefunden' });
        }

        const gameData = parseGameData(addon);

        const [ratings, comments] = await Promise.all([
            dbService.query(`
                SELECT rating, review, usage_hours, helpful_count, created_at, user_id
                FROM addon_ratings WHERE addon_id = ?
                ORDER BY helpful_count DESC, created_at DESC LIMIT 5
            `, [addon.id]),
            dbService.query(`
                SELECT id, comment, created_at, user_id
                FROM addon_comments
                WHERE addon_id = ? AND parent_id IS NULL AND is_deleted = 0
                ORDER BY created_at DESC LIMIT 10
            `, [addon.id]),
        ]);

        // install_count erhöhen
        await dbService.query(
            'UPDATE addon_marketplace SET install_count = install_count + 1 WHERE id = ?',
            [addon.id]
        );

        await themeManager.renderView(res, 'guild/gameserver-addon-detail', {
            title: `${addon.name} - Addon Details`,
            activeMenu: `/guild/${guildId}/plugins/gameserver/addons`,
            addon,
            gameData,
            ratings: ratings || [],
            comments: comments || [],
            guildId,
            user: req.session.user,
        });
    } catch (err) {
        Logger.error('[Gameserver/Addons] Detail Error:', err);
        res.status(500).render('error', { message: 'Fehler beim Laden der Addon-Details', error: err });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST / — Eigenes Addon anlegen
// Erwartet game_data als FIREBOT_v2 JSON-String
// ─────────────────────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
    const Logger    = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const guildId   = res.locals.guildId;
    const userId    = req.session.user.info.id;

    try {
        const { name, slug, description, category, tags, icon_url, visibility, game_data } = req.body;

        if (!name || !slug || !description || !category || !game_data) {
            return res.status(400).json({
                success: false,
                message: 'name, slug, description, category und game_data sind Pflicht',
            });
        }

        let gameData;
        try {
            gameData = typeof game_data === 'string' ? JSON.parse(game_data) : game_data;
        } catch {
            return res.status(400).json({ success: false, message: 'game_data ist kein valides JSON' });
        }

        if (gameData?.meta?.version !== 'FIREBOT_v2') {
            return res.status(400).json({
                success: false,
                message: 'Nur FIREBOT_v2 game_data wird akzeptiert',
            });
        }

        // Slug-Kollision prüfen
        const [existing] = await dbService.query(
            'SELECT id FROM addon_marketplace WHERE slug = ?', [slug]
        );
        if (existing) {
            return res.status(400).json({ success: false, message: `Slug "${slug}" existiert bereits` });
        }

        const runtimeType = detectRuntimeType(gameData);
        const finalVisibility = visibility || 'private';
        const status     = finalVisibility === 'private' ? 'approved' : 'pending_review';
        const guildIdVal = finalVisibility === 'private' ? guildId : null;

        const result = await dbService.query(`
            INSERT INTO addon_marketplace
                (name, slug, description, category, tags, icon_url,
                 visibility, status, trust_level,
                 guild_id, author_user_id,
                 game_data, runtime_type, source_type, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unverified', ?, ?, ?, ?, 'custom', NOW(), NOW())
        `, [
            name, slug, description, category,
            parseTags(tags), icon_url || null,
            finalVisibility, status,
            guildIdVal, userId,
            JSON.stringify(gameData), runtimeType,
        ]);

        Logger.info(`[Gameserver/Addons] Neu erstellt: ${name} (ID: ${result.insertId}, ${runtimeType})`);

        res.json({
            success: true,
            message: finalVisibility === 'private'
                ? 'Addon erstellt und für deine Guild freigegeben!'
                : 'Addon erstellt und zur Prüfung eingereicht.',
            addon_id: result.insertId,
            redirect: `/guild/${guildId}/plugins/gameserver/addons/my-addons`,
        });
    } catch (err) {
        Logger.error('[Gameserver/Addons] Create Error:', err);
        res.status(500).json({ success: false, message: 'Serverfehler beim Erstellen des Addons' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /:id — Eigenes Addon aktualisieren
// ─────────────────────────────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
    const Logger    = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const guildId   = res.locals.guildId;
    const userId    = req.session.user.info.id;
    const { id }    = req.params;

    try {
        const [addonRow] = await dbService.query(
            'SELECT * FROM addon_marketplace WHERE id = ?', [id]
        );
        if (!addonRow) {
            return res.status(404).json({ success: false, message: 'Addon nicht gefunden' });
        }
        if (addonRow.guild_id !== guildId && addonRow.author_user_id !== userId) {
            return res.status(403).json({ success: false, message: 'Keine Berechtigung' });
        }

        const { name, description, category, tags, icon_url, visibility, game_data } = req.body;

        let gameData = null;
        if (game_data !== undefined) {
            try {
                gameData = typeof game_data === 'string' ? JSON.parse(game_data) : game_data;
            } catch {
                return res.status(400).json({ success: false, message: 'game_data ist kein valides JSON' });
            }
            if (gameData?.meta?.version !== 'FIREBOT_v2') {
                return res.status(400).json({
                    success: false,
                    message: 'Nur FIREBOT_v2 game_data wird akzeptiert',
                });
            }
        }

        // Visibility-Wechsel
        let status     = addonRow.status;
        let guildIdVal = addonRow.guild_id;
        if (visibility && visibility !== addonRow.visibility) {
            if (visibility === 'private') {
                status     = 'approved';
                guildIdVal = guildId;
            } else if (visibility === 'public') {
                status     = 'pending_review';
                guildIdVal = null;
            }
        }

        if (gameData) {
            const runtimeType = detectRuntimeType(gameData);
            await dbService.query(`
                UPDATE addon_marketplace SET
                    name = ?, description = ?, category = ?, tags = ?, icon_url = ?,
                    visibility = ?, status = ?, guild_id = ?,
                    game_data = ?, runtime_type = ?, updated_at = NOW()
                WHERE id = ?
            `, [
                name, description, category, parseTags(tags), icon_url || null,
                visibility || addonRow.visibility, status, guildIdVal,
                JSON.stringify(gameData), runtimeType, id,
            ]);
        } else {
            await dbService.query(`
                UPDATE addon_marketplace SET
                    name = ?, description = ?, category = ?, tags = ?, icon_url = ?,
                    visibility = ?, status = ?, guild_id = ?, updated_at = NOW()
                WHERE id = ?
            `, [
                name, description, category, parseTags(tags), icon_url || null,
                visibility || addonRow.visibility, status, guildIdVal, id,
            ]);
        }

        Logger.info(`[Gameserver/Addons] Aktualisiert: ID ${id} → ${name}`);
        res.json({
            success: true,
            message: 'Addon erfolgreich aktualisiert!',
            redirect: `/guild/${guildId}/plugins/gameserver/addons/my-addons`,
        });
    } catch (err) {
        Logger.error('[Gameserver/Addons] Update Error:', err);
        res.status(500).json({ success: false, message: 'Serverfehler beim Aktualisieren' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /:id — Eigenes Addon löschen
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
    const Logger    = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const guildId   = res.locals.guildId;
    const userId    = req.session.user.info.id;

    try {
        const [addonRow] = await dbService.query(
            'SELECT * FROM addon_marketplace WHERE id = ?', [req.params.id]
        );
        if (!addonRow) {
            return res.status(404).json({ success: false, message: 'Addon nicht gefunden' });
        }
        if (addonRow.guild_id !== guildId && addonRow.author_user_id !== userId) {
            return res.status(403).json({ success: false, message: 'Keine Berechtigung' });
        }

        const [count] = await dbService.query(
            'SELECT COUNT(*) as n FROM gameservers WHERE addon_marketplace_id = ?', [req.params.id]
        );
        if (count.n > 0) {
            return res.status(400).json({
                success: false,
                message: `${count.n} Server nutzen dieses Addon — zuerst Server löschen`,
            });
        }

        await dbService.query('DELETE FROM addon_marketplace WHERE id = ?', [req.params.id]);
        Logger.info(`[Gameserver/Addons] Gelöscht: ${addonRow.name} (ID: ${req.params.id})`);

        res.json({ success: true, message: 'Addon erfolgreich gelöscht!' });
    } catch (err) {
        Logger.error('[Gameserver/Addons] Delete Error:', err);
        res.status(500).json({ success: false, message: 'Serverfehler beim Löschen' });
    }
});

module.exports = router;
