/**
 * Moderation - Seitenrouten
 *
 * Bis zum 2026-08-07 eine einzige Seite mit fuenf Tabs. Jetzt traegt jeder
 * Bereich eine eigene Adresse:
 *
 *   /                 -> Weiterleitung auf /dashboard
 *   /dashboard        Uebersicht
 *   /faelle           Faelle (Verwarnungen, Kicks, Banns)
 *   /notizen          Mod-Notizen
 *   /kanalregeln      Abweichende Regeln je Kanal
 *   /rollen           Geschuetzte Rollen
 *   /settings         Grundeinstellungen (unter Kern-Einstellungen)
 *
 * @module moderation/routes/guild
 */

const express = require('express');
const router = express.Router();
const { ServiceManager } = require('dunebot-core');
const { requirePermission } = require('../../../../apps/dashboard/middlewares/permissions.middleware');
const { makeTranslator, renderView, getGuildChannels, getGuildRoles, getSettings, renderFehler } = require('./_shared');

/** Skripte anmelden, die eine Seite braucht. */
function skripteAnmelden(handles) {
    const assetManager = ServiceManager.get('assetManager');
    if (!assetManager) return;
    handles.forEach(h => assetManager.enqueueScript(h));
}

// =====================================================
// Hauptmenue-Punkt -> Uebersicht
// =====================================================
router.get('/', requirePermission('MODERATION.VIEW'), (req, res) => {
    res.redirect(`/guild/${res.locals.guildId}/plugins/moderation/dashboard`);
});

// =====================================================
// Uebersicht
// =====================================================
router.get('/dashboard', requirePermission('MODERATION.VIEW'), async (req, res) => {
    const dbService = ServiceManager.get('dbService');
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);

    try {
        const [settings, channels, letzteFaelle, zaehler, geschuetzt, kanalregeln] = await Promise.all([
            getSettings(guildId),
            getGuildChannels(guildId),
            dbService.query('SELECT * FROM moderation_logs WHERE guild_id = ? ORDER BY created_at DESC LIMIT 10', [guildId]),
            dbService.query(
                `SELECT type, COUNT(*) AS anzahl
                   FROM moderation_logs
                  WHERE guild_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
                  GROUP BY type`,
                [guildId]
            ),
            dbService.query('SELECT COUNT(*) AS anzahl FROM moderation_protected_roles WHERE guild_id = ?', [guildId]),
            dbService.query('SELECT COUNT(*) AS anzahl FROM moderation_channel_rules WHERE guild_id = ?', [guildId])
        ]);

        const [notizen, gesamt] = await Promise.all([
            dbService.query('SELECT COUNT(*) AS anzahl FROM moderation_notes WHERE guild_id = ?', [guildId]),
            dbService.query('SELECT COUNT(*) AS anzahl FROM moderation_logs WHERE guild_id = ?', [guildId])
        ]);

        await renderView(res, 'guild/moderation-dashboard', {
            tr,
            guildId,
            settings,
            channels,
            letzteFaelle,
            zaehler,
            anzahl: {
                faelleGesamt: gesamt[0]?.anzahl || 0,
                geschuetzteRollen: geschuetzt[0]?.anzahl || 0,
                kanalregeln: kanalregeln[0]?.anzahl || 0,
                notizen: notizen[0]?.anzahl || 0
            }
        });
    } catch (error) {
        return renderFehler(res, error, 'Die Moderations-Uebersicht konnte nicht geladen werden');
    }
});

// =====================================================
// Faelle
// =====================================================
router.get('/faelle', requirePermission('MODERATION.LOGS.VIEW'), async (req, res) => {
    const dbService = ServiceManager.get('dbService');
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);

    const seite = Math.max(1, parseInt(req.query.seite, 10) || 1);
    const proSeite = 25;
    const versatz = (seite - 1) * proSeite;
    const art = req.query.art || null;

    try {
        const bedingung = art ? 'WHERE guild_id = ? AND type = ?' : 'WHERE guild_id = ?';
        const werte = art ? [guildId, art] : [guildId];

        const [faelle, zaehlung] = await Promise.all([
            dbService.query(
                `SELECT * FROM moderation_logs ${bedingung} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
                [...werte, proSeite, versatz]
            ),
            dbService.query(`SELECT COUNT(*) AS gesamt FROM moderation_logs ${bedingung}`, werte)
        ]);

        const gesamt = zaehlung[0]?.gesamt || 0;

        skripteAnmelden(['moderation-actions']);

        await renderView(res, 'guild/moderation-logs', {
            tr,
            guildId,
            faelle,
            art,
            seiten: { aktuell: seite, proSeite, gesamt, anzahl: Math.ceil(gesamt / proSeite) }
        });
    } catch (error) {
        return renderFehler(res, error, 'Die Faelle konnten nicht geladen werden');
    }
});

// =====================================================
// Notizen
// =====================================================
router.get('/notizen', requirePermission('MODERATION.NOTES.VIEW'), async (req, res) => {
    const dbService = ServiceManager.get('dbService');
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);

    try {
        const notizen = await dbService.query(
            'SELECT * FROM moderation_notes WHERE guild_id = ? ORDER BY created_at DESC LIMIT 100',
            [guildId]
        );

        skripteAnmelden(['moderation-actions']);

        await renderView(res, 'guild/moderation-notes', { tr, guildId, notizen });
    } catch (error) {
        return renderFehler(res, error, 'Die Notizen konnten nicht geladen werden');
    }
});

// =====================================================
// Kanalregeln
// =====================================================
router.get('/kanalregeln', requirePermission('MODERATION.VIEW'), async (req, res) => {
    const dbService = ServiceManager.get('dbService');
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);

    try {
        const [kanalregeln, channels] = await Promise.all([
            dbService.query('SELECT * FROM moderation_channel_rules WHERE guild_id = ? ORDER BY created_at DESC', [guildId]),
            getGuildChannels(guildId)
        ]);

        skripteAnmelden(['moderation-actions']);

        await renderView(res, 'guild/moderation-channel-rules', { tr, guildId, kanalregeln, channels });
    } catch (error) {
        return renderFehler(res, error, 'Die Kanalregeln konnten nicht geladen werden');
    }
});

// =====================================================
// Geschuetzte Rollen
// =====================================================
router.get('/rollen', requirePermission('MODERATION.VIEW'), async (req, res) => {
    const dbService = ServiceManager.get('dbService');
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);

    try {
        const [geschuetzt, roles] = await Promise.all([
            dbService.query('SELECT * FROM moderation_protected_roles WHERE guild_id = ? ORDER BY created_at DESC', [guildId]),
            getGuildRoles(guildId)
        ]);

        skripteAnmelden(['moderation-actions']);

        await renderView(res, 'guild/moderation-protected', { tr, guildId, geschuetzteRollen: geschuetzt, roles });
    } catch (error) {
        return renderFehler(res, error, 'Die geschuetzten Rollen konnten nicht geladen werden');
    }
});

// =====================================================
// Grundeinstellungen (haengt unter den Kern-Einstellungen)
// =====================================================
router.get('/settings', requirePermission('MODERATION.VIEW'), async (req, res) => {
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);

    try {
        const [settings, channels] = await Promise.all([
            getSettings(guildId),
            getGuildChannels(guildId)
        ]);

        skripteAnmelden(['moderation-forms']);

        await renderView(res, 'guild/moderation-settings', { tr, guildId, settings, channels });
    } catch (error) {
        return renderFehler(res, error, 'Die Moderations-Einstellungen konnten nicht geladen werden');
    }
});

module.exports = router;
