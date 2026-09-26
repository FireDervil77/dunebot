/**
 * Admin: Spiele-Marktplatz (Anker der Spielpakete in addon_marketplace)
 *
 * Endpoints:
 *   GET    /admin/addons              — Übersicht
 *   GET    /admin/addons/:id          — Detail: Name, Beschreibung, Tags, Freigabe
 *   PUT    /admin/addons/:id          — Name, Beschreibung, Tags speichern
 *   POST   /admin/addons/:id/approve  — Freigeben (Vertrauensstufe, Sichtbarkeit)
 *   DELETE /admin/addons/:id          — Löschen (nie den Anker eines Pakets)
 *
 * Bis zum 2026-09-26 standen hier auch Egg-Import (Pelican-Repositories),
 * Anlegen, JSON-Einfügen, ein game_data-Editor und ein Test-Knopf, der nur
 * einen Zeitstempel setzte. Alles davon schrieb FIREBOT_v2 — seit dem
 * 2026-09-10 startet der Daemon nur Server mit Spielpaket. Neue Spiele
 * entstehen in der Werkbank (Egg-Rückbau B, Baustelle 166).
 *
 * @author FireDervil
 */

'use strict';

const express = require('express');
const router = express.Router();
const { ServiceManager } = require('dunebot-core');

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
                id, name, slug,
                status, trust_level, visibility,
                verified_at, verified_by, created_at
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
        };

        await themeManager.renderView(res, 'admin/addons/index', { addons, stats, pageTitle: 'Addon Marketplace' });

    } catch (err) {
        Logger.error('[Addons] Fehler Übersicht:', err);
        res.status(500).render('error', { message: 'Fehler beim Laden der Addons', error: err });
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

        const addon = rows[0];

        if (addon.tags) {
            try   { addon.tags = JSON.parse(addon.tags); }
            catch { addon.tags = addon.tags.split(',').map(t => t.trim()).filter(Boolean); }
        }

        await themeManager.renderView(res, 'admin/addons/edit', { addon, pageTitle: `Edit: ${addon.name}` });

    } catch (err) {
        Logger.error('[Addons] Detail laden fehlgeschlagen:', err);
        res.status(500).render('error', { message: 'Fehler beim Laden', error: err });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /admin/addons/:id — Name, Beschreibung, Tags
//
// Der Slug bleibt fest: Über ihn findet die Einlieferung ihren Anker. Wer ihn
// hier änderte, legte beim nächsten Einliefern einen zweiten Anker an und
// trennte den ersten lautlos vom Paket.
// ─────────────────────────────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
    const Logger    = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const { id }    = req.params;

    try {
        const { name, description, tags } = req.body;

        if (!name) {
            return res.status(400).json({ success: false, message: 'name ist erforderlich' });
        }

        const tagsJson = tags
            ? JSON.stringify(tags.split(',').map(t => t.trim()).filter(Boolean))
            : null;

        await dbService.query(`
            UPDATE addon_marketplace
            SET name = ?, description = ?, tags = ?, updated_at = NOW()
            WHERE id = ?
        `, [name, description || '', tagsJson, id]);

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

        // Der Anker eines Spielpakets (packages.id = addon_marketplace.id) wird
        // hier nie gelöscht: Ohne ihn ist das Paket wählbar, aber nicht mehr
        // anlegbar (Fremdschlüssel gameservers → addon_marketplace).
        const paket = await dbService.query('SELECT slug FROM packages WHERE id = ?', [req.params.id]);
        if (paket.length) {
            return res.status(400).json({
                success: false,
                message: `Das ist der Anker des Spielpakets „${paket[0].slug}" — ohne ihn lässt sich kein Server mehr anlegen.`,
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
