/**
 * Guild: Spiele-Marktplatz
 *
 * Endpunkte:
 *   GET  /        — Marktplatz (approved + public/official), Filter nach Tag
 *   GET  /:slug   — Detailseite eines Spiels
 *
 * Bis zum 2026-09-26 lagen hier auch „Meine Addons“ und der Addon-Editor
 * (anlegen, bearbeiten, löschen). Sie schrieben das Egg-Format FIREBOT_v2, und
 * seit dem 2026-09-10 startet der Daemon nur Server mit Spielpaket — was dort
 * entstand, war nicht startbar. Pakete entstehen in der Werkbank
 * (Egg-Rückbau B, Baustelle 166).
 *
 * @author FireDervil
 */

'use strict';

const express = require('express');
const router  = express.Router();
const { ServiceManager } = require('dunebot-core');
const { requirePermission } = require('../../../../apps/dashboard/middlewares/permissions.middleware');
// Tags eines Spiels kommen aus der Tag-Bibliothek des Kerns (2026-10-07) —
// nicht mehr aus dem Kommafeld `addon_marketplace.tags`.
const Tags = require('../../../../apps/dashboard/helpers/Tags');
// Entwurf oder freigegeben sagt die Fassung des Spielpakets (2026-10-08) —
// nicht mehr `addon_marketplace.trust_level`.
const Paketfassung = require('../helpers/Paketfassung');

// ─────────────────────────────────────────────────────────────────────────────
// GET / — Marketplace
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', requirePermission('GAMESERVER.ADDONS.VIEW'), async (req, res) => {
    const Logger       = ServiceManager.get('Logger');
    const dbService    = ServiceManager.get('dbService');
    const themeManager = ServiceManager.get('themeManager');

    try {
        const guildId = res.locals.guildId;
        const { tag, search, sort } = req.query;

        let query = `
            SELECT id, slug, name, description,
                   steam_app_id, author_user_id,
                   rating_avg, rating_count, install_count,
                   icon_url, banner_url, created_at
            FROM addon_marketplace
            WHERE status = 'approved'
            AND (visibility = 'official' OR visibility = 'public')
        `;
        const params = [];

        // Gefiltert wird nach einem Tag (2026-10-08) — bis dahin nach der einen
        // Kategorie, die jedes Spiel hatte. Der Wert darf der Name oder der
        // slug sein; verglichen wird der slug.
        const tagSlug = tag && tag !== 'all' ? Tags.slugVon(tag) : '';
        if (tagSlug) {
            query += ` AND ${Tags.hatTagSql('spiel', 'addon_marketplace.id')}`;
            params.push(tagSlug);
        }
        if (search) {
            // Der dritte Platzhalter sucht in den Tags der Bibliothek — vorher
            // im rohen Text der Spalte (samt JSON-Klammern).
            query += ` AND (name LIKE ? OR description LIKE ? OR ${Tags.sucheSql('spiel', 'addon_marketplace.id')})`;
            const term = `%${search}%`;
            params.push(term, term, term);
        }

        const orderMap = {
            newest:  'ORDER BY created_at DESC',
            popular: 'ORDER BY install_count DESC',
            rating:  'ORDER BY rating_avg DESC, rating_count DESC',
        };
        query += ` ${orderMap[sort] || 'ORDER BY rating_avg DESC, install_count DESC, name ASC'}`;

        const [addons, sichtbare] = await Promise.all([
            dbService.query(query, params),
            dbService.query(`
                SELECT id FROM addon_marketplace
                WHERE status = 'approved' AND (visibility = 'official' OR visibility = 'public')
            `),
        ]);
        // Zur Wahl steht, was die gezeigten Spiele wirklich tragen — häufigstes zuerst.
        const tagListe = await Tags.benutzte(dbService, 'spiel', sichtbare.map(z => z.id));

        // Die Tags aller gezeigten Spiele in EINEM Zug, als Liste am Spiel.
        const tagsJeSpiel = await Tags.fuerViele(dbService, 'spiel', (addons || []).map(a => a.id));
        for (const a of (addons || [])) a.tags = tagsJeSpiel[a.id] || [];

        // Entwurf oder freigegeben — für die Marke an der Kachel.
        const stand = await Paketfassung.freigabeJePaket(dbService);
        for (const a of (addons || [])) a.freigabe = stand[a.id] || null;

        await themeManager.renderView(res, 'guild/gameserver-marketplace', {
            title: 'Spiele-Datenbank',
            activeMenu: `/guild/${guildId}/plugins/gameserver/addons`,
            addons: addons || [],
            tagListe,
            filters: { tag: tagSlug || 'all', search: search || '', sort: sort || 'default' },
            guildId,
        });
    } catch (err) {
        Logger.error('[Gameserver/Addons] Marketplace Error:', err);
        res.status(500).render('error', { message: 'Fehler beim Laden des Marketplace', error: err });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /:slug — Addon-Detail
// WICHTIG: Muss nach /my-addons, /create und /edit/:id stehen!
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:slug', requirePermission('GAMESERVER.ADDONS.VIEW'), async (req, res) => {
    const Logger       = ServiceManager.get('Logger');
    const dbService    = ServiceManager.get('dbService');
    const themeManager = ServiceManager.get('themeManager');

    try {
        const guildId = res.locals.guildId;

        const [addon] = await dbService.query(`
            SELECT id, slug, name, description,
                   steam_app_id, steam_server_app_id, author_user_id,
                   rating_avg, rating_count, install_count,
                   icon_url, banner_url, screenshots, created_at
            FROM addon_marketplace
            WHERE slug = ? AND status = 'approved'
        `, [req.params.slug]);

        if (!addon) {
            return res.status(404).render('error', { message: 'Addon nicht gefunden' });
        }

        addon.tags = await Tags.fuer(dbService, 'spiel', addon.id);
        addon.freigabe = (await Paketfassung.freigabeJePaket(dbService))[addon.id] || null;

        // Ähnliche Spiele: die, die Tags mit diesem teilen — die mit den meisten
        // gemeinsamen zuerst. Nur was auch in der Liste stünde.
        let aehnliche = [];
        const verwandt = await Tags.verwandte(dbService, 'spiel', addon.id, 6);
        if (verwandt.length) {
            const zeilen = await dbService.query(`
                SELECT id, slug, name, icon_url FROM addon_marketplace
                WHERE id IN (${verwandt.map(() => '?').join(',')})
                  AND status = 'approved' AND (visibility = 'official' OR visibility = 'public')`, verwandt.map(v => v.id));
            const nachId = new Map(zeilen.map(z => [z.id, z]));
            const tagsJe = await Tags.fuerViele(dbService, 'spiel', zeilen.map(z => z.id));
            const eigene = new Set(addon.tags.map(Tags.slugVon));
            aehnliche = verwandt.filter(v => nachId.has(v.id)).map(v => ({
                ...nachId.get(v.id),
                gemeinsam: (tagsJe[v.id] || []).filter(n => eigene.has(Tags.slugVon(n))),
            }));
        }

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

        await themeManager.renderView(res, 'guild/gameserver-addon-detail', {
            title: `${addon.name} — Spiele-Datenbank`,
            activeMenu: `/guild/${guildId}/plugins/gameserver/addons`,
            addon,
            aehnliche,
            ratings: ratings || [],
            comments: comments || [],
            guildId,
        });
    } catch (err) {
        Logger.error('[Gameserver/Addons] Detail Error:', err);
        res.status(500).render('error', { message: 'Fehler beim Laden der Addon-Details', error: err });
    }
});

module.exports = router;
