/**
 * Giveaway - Seitenrouten
 *
 * Bis zum 2026-08-07 eine Seite mit sechs Tabs. Jetzt traegt jeder Bereich
 * eine eigene Adresse:
 *
 *   /              -> Weiterleitung auf /dashboard
 *   /dashboard     Uebersicht
 *   /laufende      Laufende und geplante Verlosungen
 *   /beendet       Abgeschlossene Verlosungen samt Gewinnern
 *   /vorlagen      Wiederverwendbare Vorlagen
 *   /sperrliste    Ausgeschlossene Mitglieder
 *   /auswertung    Zahlen ueber alle Verlosungen
 *
 * @module giveaway/routes/guild
 */

const express = require('express');
const router = express.Router();
const { ServiceManager } = require('dunebot-core');
const { requirePermission } = require('../../../../apps/dashboard/middlewares/permissions.middleware');
const { makeTranslator, renderView, getGuildChannels, getGuildRoles, renderFehler } = require('./_shared');

/** Skripte anmelden, die eine Seite braucht. */
function skripteAnmelden(handles) {
    const assetManager = ServiceManager.get('assetManager');
    if (!assetManager) return;
    handles.forEach(h => assetManager.enqueueScript(h));
}

/** Laufende und pausierte Verlosungen, jeweils mit Teilnehmerzahl. */
async function ladeLaufende(guildId) {
    const dbService = ServiceManager.get('dbService');

    const verlosungen = await dbService.query(
        'SELECT * FROM giveaways WHERE guild_id = ? AND status IN (?, ?) ORDER BY created_at DESC',
        [guildId, 'active', 'paused']
    );
    if (verlosungen.length === 0) return [];

    // Eine Abfrage statt einer je Verlosung - vorher lief hier eine Schleife
    // mit je einem eigenen COUNT.
    const ids = verlosungen.map(v => v.id);
    const platzhalter = ids.map(() => '?').join(',');
    const zaehler = await dbService.query(
        `SELECT giveaway_id, COUNT(*) AS anzahl FROM giveaway_entries
          WHERE giveaway_id IN (${platzhalter}) GROUP BY giveaway_id`,
        ids
    );

    const nachId = {};
    zaehler.forEach(z => { nachId[z.giveaway_id] = z.anzahl; });
    verlosungen.forEach(v => { v.entry_count = nachId[v.id] || 0; });

    return verlosungen;
}

/** Geplante Verlosungen, die noch nicht begonnen haben. */
async function ladeGeplante(guildId) {
    return await ServiceManager.get('dbService').query(
        'SELECT * FROM giveaways WHERE guild_id = ? AND starts_at > NOW() AND status = ? ORDER BY starts_at ASC',
        [guildId, 'active']
    );
}

/** Beendete Verlosungen samt Gewinnern. */
async function ladeBeendete(guildId, grenze = 20) {
    const dbService = ServiceManager.get('dbService');

    const verlosungen = await dbService.query(
        'SELECT * FROM giveaways WHERE guild_id = ? AND status = ? ORDER BY ended_at DESC LIMIT ?',
        [guildId, 'ended', grenze]
    );
    if (verlosungen.length === 0) return [];

    const ids = verlosungen.map(v => v.id);
    const platzhalter = ids.map(() => '?').join(',');
    const gewinner = await dbService.query(
        `SELECT giveaway_id, user_id, claim_status FROM giveaway_winners
          WHERE giveaway_id IN (${platzhalter})`,
        ids
    );

    const nachId = {};
    gewinner.forEach(g => {
        (nachId[g.giveaway_id] = nachId[g.giveaway_id] || []).push(g);
    });
    verlosungen.forEach(v => {
        v.winner_details = nachId[v.id] || [];
        v.winners = v.winner_details.map(g => g.user_id);
    });

    return verlosungen;
}

/** Vorlagen; deren `config` liegt als JSON-Text in der Datenbank. */
async function ladeVorlagen(guildId) {
    const vorlagen = await ServiceManager.get('dbService').query(
        'SELECT * FROM giveaway_templates WHERE guild_id = ? ORDER BY name ASC',
        [guildId]
    );

    vorlagen.forEach(v => {
        if (typeof v.config === 'string') {
            try { v.config = JSON.parse(v.config); } catch { v.config = {}; }
        }
        v.config = v.config || {};
    });

    return vorlagen;
}

/** Sperrliste der Guild. */
async function ladeSperrliste(guildId) {
    return await ServiceManager.get('dbService').query(
        'SELECT * FROM giveaway_blacklist WHERE guild_id = ? ORDER BY created_at DESC',
        [guildId]
    );
}

/** Auswertung beim Bot erfragen; er ist ein eigener Prozess und darf fehlen. */
async function ladeAuswertung(guildId) {
    const ipcServer = ServiceManager.get('ipcServer');
    if (!ipcServer) return null;
    try {
        const antworten = await ipcServer.broadcast('giveaway:getAnalytics', { guildId });
        return antworten?.[0]?.analytics || null;
    } catch {
        return null;
    }
}

// =====================================================
// Hauptmenue-Punkt -> Uebersicht
// =====================================================
router.get('/', requirePermission('GIVEAWAY.VIEW'), (req, res) => {
    res.redirect(`/guild/${res.locals.guildId}/plugins/giveaway/dashboard`);
});

// =====================================================
// Uebersicht
// =====================================================
router.get('/dashboard', requirePermission('GIVEAWAY.VIEW'), async (req, res) => {
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);

    try {
        const [laufende, geplante, beendete, vorlagen, sperrliste, auswertung, channels, roles] = await Promise.all([
            ladeLaufende(guildId),
            ladeGeplante(guildId),
            ladeBeendete(guildId, 5),
            ladeVorlagen(guildId),
            ladeSperrliste(guildId),
            ladeAuswertung(guildId),
            getGuildChannels(guildId),
            getGuildRoles(guildId)
        ]);

        skripteAnmelden(['giveaway-actions']);

        await renderView(res, 'guild/giveaway-dashboard', {
            tr, guildId, channels, roles,
            laufende, geplante, beendete, vorlagen, sperrliste, auswertung
        });
    } catch (error) {
        return renderFehler(res, error, 'Die Giveaway-Uebersicht konnte nicht geladen werden');
    }
});

// =====================================================
// Laufende und geplante Verlosungen
// =====================================================
router.get('/laufende', requirePermission('GIVEAWAY.VIEW'), async (req, res) => {
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);

    try {
        const [laufende, geplante, vorlagen, channels, roles] = await Promise.all([
            ladeLaufende(guildId),
            ladeGeplante(guildId),
            ladeVorlagen(guildId),
            getGuildChannels(guildId),
            getGuildRoles(guildId)
        ]);

        skripteAnmelden(['giveaway-actions']);

        await renderView(res, 'guild/giveaway-active', { tr, guildId, laufende, geplante, vorlagen, channels, roles });
    } catch (error) {
        return renderFehler(res, error, 'Die laufenden Verlosungen konnten nicht geladen werden');
    }
});

// =====================================================
// Beendete Verlosungen
// =====================================================
router.get('/beendet', requirePermission('GIVEAWAY.VIEW'), async (req, res) => {
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);

    try {
        const [beendete, channels] = await Promise.all([
            ladeBeendete(guildId, 50),
            getGuildChannels(guildId)
        ]);

        skripteAnmelden(['giveaway-actions']);

        await renderView(res, 'guild/giveaway-ended', { tr, guildId, beendete, channels });
    } catch (error) {
        return renderFehler(res, error, 'Die beendeten Verlosungen konnten nicht geladen werden');
    }
});

// =====================================================
// Vorlagen
// =====================================================
router.get('/vorlagen', requirePermission('GIVEAWAY.VIEW'), async (req, res) => {
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);

    try {
        const vorlagen = await ladeVorlagen(guildId);
        skripteAnmelden(['giveaway-actions']);

        await renderView(res, 'guild/giveaway-templates', { tr, guildId, vorlagen });
    } catch (error) {
        return renderFehler(res, error, 'Die Vorlagen konnten nicht geladen werden');
    }
});

// =====================================================
// Sperrliste
// =====================================================
router.get('/sperrliste', requirePermission('GIVEAWAY.VIEW'), async (req, res) => {
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);

    try {
        const sperrliste = await ladeSperrliste(guildId);
        skripteAnmelden(['giveaway-actions']);

        await renderView(res, 'guild/giveaway-blacklist', { tr, guildId, sperrliste });
    } catch (error) {
        return renderFehler(res, error, 'Die Sperrliste konnte nicht geladen werden');
    }
});

// =====================================================
// Auswertung
// =====================================================
router.get('/auswertung', requirePermission('GIVEAWAY.VIEW'), async (req, res) => {
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);

    try {
        const auswertung = await ladeAuswertung(guildId);
        await renderView(res, 'guild/giveaway-analytics', { tr, guildId, auswertung });
    } catch (error) {
        return renderFehler(res, error, 'Die Auswertung konnte nicht geladen werden');
    }
});

module.exports = router;
