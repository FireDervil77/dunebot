/**
 * Admin: Spiele-Marktplatz (Anker der Spielpakete in addon_marketplace)
 *
 * Endpoints:
 *   GET    /admin/addons              — Übersicht
 *   GET    /admin/addons/:id          — Detail: Name, Beschreibung, Tags, Freigabe
 *   PUT    /admin/addons/:id          — Name, Beschreibung, Tags speichern
 *   POST   /admin/addons/:id/approve  — Freigeben (Vertrauensstufe, Sichtbarkeit)
 *   POST   /admin/addons/:id/fassungen/:fassungId/freigeben      — Paketfassung test → stable
 *   POST   /admin/addons/:id/fassungen/:fassungId/zuruecknehmen  — Paketfassung stable → test
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

// Die Freigabe einer Paketfassung (Baustelle 172). Die Regel — was freigegeben
// werden darf und was ein Server danach bekommt — steht im Gameserver-Plugin an
// EINER Stelle; hier ist nur der Knopf. Er gehört in den Adminbereich, weil eine
// Freigabe alle Guilds betrifft, nicht die, in der gerade jemand sitzt.
const Paketfassung = require('../../../../plugins/gameserver/dashboard/helpers/Paketfassung');

// Tags kommen aus der Tag-Bibliothek (helpers/Tags.js) — nicht mehr aus dem
// Kommafeld `addon_marketplace.tags`.
const Tags = require('../../helpers/Tags');

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

        await themeManager.renderView(res, 'admin/addons/index', { addons, stats, pageTitle: 'Spiele-Marktplatz' });

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

        // Die Tags dieses Spiels und die ganze Bibliothek für die Vorschläge.
        // Ein Fehler hier darf nicht so aussehen, als hätte das Spiel keine Tags
        // — sonst speichert der nächste Klick eine leere Liste darüber.
        let alleTags = [], tagsFehler = null;
        try {
            addon.tags = await Tags.fuer(dbService, 'spiel', addon.id);
            alleTags = await Tags.alle(dbService);
        } catch (err) {
            addon.tags = [];
            tagsFehler = err.message;
            Logger.error('[Addons] Tags laden fehlgeschlagen:', err);
        }

        // Fassungen des Pakets (packages.id = addon_marketplace.id) und wie viele
        // Server welchem Kanal folgen. Ein Spiel ohne Paket hat keine — dann
        // bleibt die Karte bei einem Satz. Ein Fehler hier kostet die Karte,
        // nicht die Seite, wird aber gezeigt statt verschluckt.
        let fassungen = [], serverJeKanal = { stable: 0, test: 0 }, fassungenFehler = null;
        try {
            fassungen = await Paketfassung.fassungenZuPaket(dbService, addon.id);
            serverJeKanal = await Paketfassung.serverJeKanal(dbService, addon.id);
        } catch (err) {
            fassungenFehler = err.message;
            Logger.error('[Addons] Fassungen laden fehlgeschlagen:', err);
        }

        await themeManager.renderView(res, 'admin/addons/edit', {
            addon, alleTags, tagsFehler, fassungen, serverJeKanal, fassungenFehler, pageTitle: `Edit: ${addon.name}`,
        });

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

        // Erst prüfen, dann schreiben: Ein Tag, das nicht passt, soll nicht den
        // halben Eintrag speichern. `tags` fehlt in der Nutzlast (undefined) heisst
        // „nicht anfassen" — eine leere Liste heisst „keine Tags".
        if (tags !== undefined) Tags.bereinige(tags);

        await dbService.query(`
            UPDATE addon_marketplace
            SET name = ?, description = ?, updated_at = NOW()
            WHERE id = ?
        `, [name, description || '', id]);

        if (tags !== undefined) await Tags.setze(dbService, 'spiel', id, tags);

        Logger.info(`[Addons] Aktualisiert: ID ${id} → ${name}`);
        res.json({ success: true, message: 'Addon gespeichert' });

    } catch (err) {
        Logger.error('[Addons] Update fehlgeschlagen:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ────────────────────────────────────────────────────────
// POST /admin/addons/:id/fassungen/:fassungId/freigeben
// POST /admin/addons/:id/fassungen/:fassungId/zuruecknehmen
//
// Eine Paketfassung freigeben (test → stable) oder die Freigabe zurücknehmen.
// Freigegeben wird nur, was einen grünen Prüfdurchlauf hat (E-17) — die Prüfung
// steht in Paketfassung.js und kommt von dort als Satz zurück.
// ────────────────────────────────────────────────────────
router.post('/:id/fassungen/:fassungId/freigeben', async (req, res) => {
    const Logger    = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    try {
        const f = await Paketfassung.freigeben(dbService, {
            paketId: req.params.id, fassungId: req.params.fassungId,
            userId: res.locals.user?.info?.id || null,
        });
        Logger.info(`[Addons] Paketfassung freigegeben: Paket ${req.params.id}, Fassung ${f.version}`);
        res.json({ success: true, message: `Fassung ${f.version} ist freigegeben. Server auf „stable" nehmen sie beim nächsten Start.` });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

router.post('/:id/fassungen/:fassungId/zuruecknehmen', async (req, res) => {
    const Logger    = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    try {
        const f = await Paketfassung.zuruecknehmen(dbService, {
            paketId: req.params.id, fassungId: req.params.fassungId,
        });
        Logger.info(`[Addons] Freigabe zurückgenommen: Paket ${req.params.id}, Fassung ${f.version}`);
        res.json({
            success: true,
            message: f.nochFreigegeben
                ? `Freigabe von ${f.version} zurückgenommen. Server auf „stable" nehmen die vorige freigegebene Fassung.`
                : `Freigabe von ${f.version} zurückgenommen. Es ist keine Fassung mehr freigegeben — Server auf „stable" lassen sich nicht starten, bis wieder eine freigegeben ist.`,
        });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
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
