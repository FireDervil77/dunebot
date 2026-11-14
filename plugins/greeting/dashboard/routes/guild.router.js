/**
 * Greeting - Seitenrouten und JSON-Routen
 *
 * Bis zum 2026-08-07 eine einzige Seite mit acht Tabs. Jetzt traegt jeder
 * Bereich eine eigene Adresse:
 *
 *   /                  -> Weiterleitung auf /dashboard
 *   /dashboard         Uebersicht
 *   /nachrichten       Begruessung, Verabschiedung und Direktnachricht
 *   /rollen            Autorollen und Reaktionsrollen
 *   /verifizierung     Verifizierung neuer Mitglieder
 *   /boost             Nachricht beim Server-Boost
 *   /einladungen       Wer ueber welche Einladung kam
 *   /settings          Schalter je Bereich (unter Kern-Einstellungen)
 *
 * @module greeting/routes/guild
 */

const express = require('express');
const router = express.Router();
const { ServiceManager } = require('dunebot-core');
const { requirePermission } = require('../../../../apps/dashboard/middlewares/permissions.middleware');
const { makeTranslator, renderView, ladeDaten, renderFehler, ANLAESSE } = require('./_shared');
const { Vorlage } = require('dunebot-sdk');

/** Skripte anmelden, die eine Seite braucht. */
function skripteAnmelden(handles) {
    const assetManager = ServiceManager.get('assetManager');
    if (!assetManager) return;
    handles.forEach(h => assetManager.enqueueScript(h));
}

/**
 * Eine Seite des Bereichs ausliefern.
 *
 * Alle Seiten brauchen denselben Datensatz - der Unterschied liegt nur in der
 * View. Deshalb eine Fabrik statt sieben fast gleicher Routen.
 *
 * @param {string} view Name der View unterhalb von guild/
 * @param {string} kontext Fehlertext, falls das Laden scheitert
 * @returns {Function} Express-Handler
 */
function seite(view, kontext) {
    return async (req, res) => {
        const guildId = res.locals.guildId;
        const tr = makeTranslator(req, res);

        try {
            const daten = await ladeDaten(guildId);
            skripteAnmelden(['greeting-forms']);

            await renderView(res, `guild/${view}`, { tr, guildId, ...daten });
        } catch (error) {
            return renderFehler(res, error, kontext);
        }
    };
}

// =====================================================
// Seiten
// =====================================================
router.get('/', requirePermission('GREETING.VIEW'), (req, res) => {
    res.redirect(`/guild/${res.locals.guildId}/plugins/greeting/dashboard`);
});

router.get('/dashboard',      requirePermission('GREETING.VIEW'), seite('greeting-dashboard',     'Die Greeting-Uebersicht konnte nicht geladen werden'));
router.get('/nachrichten',    requirePermission('GREETING.VIEW'), seite('greeting-messages',      'Die Nachrichten konnten nicht geladen werden'));
router.get('/rollen',         requirePermission('GREETING.VIEW'), seite('greeting-roles',         'Die Rollen konnten nicht geladen werden'));
router.get('/verifizierung',  requirePermission('GREETING.VIEW'), seite('greeting-verification',  'Die Verifizierung konnte nicht geladen werden'));
router.get('/boost',          requirePermission('GREETING.VIEW'), seite('greeting-boost',         'Die Boost-Nachricht konnte nicht geladen werden'));
router.get('/einladungen',    requirePermission('GREETING.VIEW'), seite('greeting-invites',       'Die Einladungen konnten nicht geladen werden'));
router.get('/settings',       requirePermission('GREETING.VIEW'), seite('greeting-settings',      'Die Greeting-Einstellungen konnten nicht geladen werden'));

/**
 * PUT /guild/:guildId/plugins/greeting/settings
 * Speichert Guild-spezifische Greeting-Einstellungen.
 *
 * `type` waehlt den Bereich, `action` ist `save`, `enable` oder `disable`.
 * Die vier Nachrichten (welcome, dm_welcome, farewell, boost) bringen ihre
 * Vorlage als `vorlage` mit; sie geht in die Kern-Tabelle `guild_vorlagen`
 * (`Vorlage.speichere`, G-08). Hier bleiben Kanal und Schalter.
 *
 * Das erste Speichern einer Nachricht schaltet sie ein; danach bleibt der
 * Schalter, wie er ist. Bis 2026-11-14 schaltete welcome und farewell jedes
 * Speichern ohne Nachrichtentext (also jedes Embed) wieder ein, dm_welcome
 * und boost jedes Speichern.
 */
router.put('/settings', requirePermission('GREETING.SETTINGS.EDIT'), async (req, res) => {
    const dbService = ServiceManager.get('dbService');
    const Logger = ServiceManager.get('Logger');
    const guildId = res.locals.guildId;
    const body = req.body || {};

    try {
        const [vorhanden] = await dbService.query('SELECT * FROM greeting_settings WHERE guild_id = ?', [guildId]);
        const settings = {
            autorole_id: null, autorole_ids: [],
            welcome_enabled: false, welcome_channel: null,
            dm_welcome_enabled: false,
            welcome_image_enabled: false, welcome_image_bg: 'default', welcome_image_text: null, welcome_image_color: '#5865f2',
            farewell_enabled: false, farewell_channel: null,
            boost_enabled: false, boost_channel: null,
            verification_enabled: false, verification_channel: null, verification_role_id: null,
            verification_type: 'button', verification_message: null, verification_remove_role_id: null,
            verification_emoji: '✅', verification_success_message: null,
            ...(vorhanden || {})
        };
        if (typeof settings.autorole_ids === 'string') {
            try { settings.autorole_ids = JSON.parse(settings.autorole_ids); } catch { settings.autorole_ids = []; }
        }
        if (!Array.isArray(settings.autorole_ids)) settings.autorole_ids = [];

        // ── Die vier Nachrichten ───────────────────────────────────────────
        const anlass = ANLAESSE[body.type];
        if (anlass) {
            const schalter = `${body.type}_enabled`;
            if (body.action === 'save') {
                const kanal = body[`${body.type}_channel`];
                if (kanal && `${body.type}_channel` in settings) settings[`${body.type}_channel`] = String(kanal);
                const vorher = await Vorlage.lade(guildId, anlass);
                await Vorlage.speichere(guildId, anlass, body.vorlage);
                if (!vorher) settings[schalter] = true;

                if (body.type === 'welcome') {
                    if (body.welcome_image_enabled !== undefined) {
                        settings.welcome_image_enabled = body.welcome_image_enabled === true || body.welcome_image_enabled === 'true';
                    }
                    if (body.welcome_image_bg !== undefined) settings.welcome_image_bg = body.welcome_image_bg || 'default';
                    if (body.welcome_image_text !== undefined) settings.welcome_image_text = body.welcome_image_text || null;
                    if (body.welcome_image_color !== undefined) settings.welcome_image_color = body.welcome_image_color || '#5865f2';
                }
            }
            if (body.action === 'enable') settings[schalter] = true;
            if (body.action === 'disable') settings[schalter] = false;
        }

        // ── Autorollen ─────────────────────────────────────────────────────
        if (body.type === 'autorole') {
            if (body.action === 'save') {
                if (Array.isArray(body.autorole_ids) && body.autorole_ids.length > 0) {
                    settings.autorole_ids = body.autorole_ids;
                    settings.autorole_id = body.autorole_ids[0]; // Backward compat
                } else {
                    settings.autorole_ids = [];
                    settings.autorole_id = null;
                }
            }
            if (body.action === 'disable') {
                settings.autorole_ids = [];
                settings.autorole_id = null;
            }
        }

        // ── Willkommensbild allein ─────────────────────────────────────────
        if (body.type === 'welcome_image' && body.action === 'save') {
            settings.welcome_image_enabled = body.welcome_image_enabled === true || body.welcome_image_enabled === 'true';
            if (body.welcome_image_bg !== undefined) settings.welcome_image_bg = body.welcome_image_bg || 'default';
            if (body.welcome_image_text !== undefined) settings.welcome_image_text = body.welcome_image_text || null;
            if (body.welcome_image_color !== undefined) settings.welcome_image_color = body.welcome_image_color || '#5865f2';
        }

        // ── Verifizierung ──────────────────────────────────────────────────
        if (body.type === 'verification') {
            if (body.action === 'save') {
                settings.verification_enabled = body.verification_enabled === true || body.verification_enabled === 'true' ? 1 : 0;
                if (body.verification_channel !== undefined) settings.verification_channel = body.verification_channel || null;
                if (body.verification_role_id !== undefined) settings.verification_role_id = body.verification_role_id || null;
                if (body.verification_type !== undefined) settings.verification_type = body.verification_type || 'button';
                if (body.verification_message !== undefined) settings.verification_message = body.verification_message || null;
                if (body.verification_remove_role_id !== undefined) settings.verification_remove_role_id = body.verification_remove_role_id || null;
                if (body.verification_emoji !== undefined) settings.verification_emoji = body.verification_emoji || '✅';
                if (body.verification_success_message !== undefined) settings.verification_success_message = body.verification_success_message || null;
            }
            if (body.action === 'enable') settings.verification_enabled = 1;
            if (body.action === 'disable') settings.verification_enabled = 0;
        }

        await dbService.query(`
            INSERT INTO greeting_settings (
                guild_id,
                autorole_id, autorole_ids,
                welcome_enabled, welcome_channel,
                dm_welcome_enabled,
                welcome_image_enabled, welcome_image_bg, welcome_image_text, welcome_image_color,
                farewell_enabled, farewell_channel,
                boost_enabled, boost_channel,
                verification_enabled, verification_channel, verification_role_id, verification_type, verification_message, verification_remove_role_id, verification_emoji, verification_success_message
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                autorole_id = VALUES(autorole_id),
                autorole_ids = VALUES(autorole_ids),
                welcome_enabled = VALUES(welcome_enabled),
                welcome_channel = VALUES(welcome_channel),
                dm_welcome_enabled = VALUES(dm_welcome_enabled),
                welcome_image_enabled = VALUES(welcome_image_enabled),
                welcome_image_bg = VALUES(welcome_image_bg),
                welcome_image_text = VALUES(welcome_image_text),
                welcome_image_color = VALUES(welcome_image_color),
                farewell_enabled = VALUES(farewell_enabled),
                farewell_channel = VALUES(farewell_channel),
                boost_enabled = VALUES(boost_enabled),
                boost_channel = VALUES(boost_channel),
                verification_enabled = VALUES(verification_enabled),
                verification_channel = VALUES(verification_channel),
                verification_role_id = VALUES(verification_role_id),
                verification_type = VALUES(verification_type),
                verification_message = VALUES(verification_message),
                verification_remove_role_id = VALUES(verification_remove_role_id),
                verification_emoji = VALUES(verification_emoji),
                verification_success_message = VALUES(verification_success_message),
                updated_at = CURRENT_TIMESTAMP
        `, [
            guildId,
            settings.autorole_id,
            JSON.stringify(settings.autorole_ids || []),
            settings.welcome_enabled ? 1 : 0,
            settings.welcome_channel,
            settings.dm_welcome_enabled ? 1 : 0,
            settings.welcome_image_enabled ? 1 : 0,
            settings.welcome_image_bg,
            settings.welcome_image_text,
            settings.welcome_image_color,
            settings.farewell_enabled ? 1 : 0,
            settings.farewell_channel,
            settings.boost_enabled ? 1 : 0,
            settings.boost_channel,
            settings.verification_enabled ? 1 : 0,
            settings.verification_channel,
            settings.verification_role_id,
            settings.verification_type,
            settings.verification_message,
            settings.verification_remove_role_id,
            settings.verification_emoji || '✅',
            settings.verification_success_message
        ]);

        Logger.info(`[Greeting] Settings für Guild ${guildId} gespeichert (${body.type}/${body.action})`);
        res.json({ success: true, message: 'Settings gespeichert' });

    } catch (error) {
        if (error instanceof Vorlage.Eingabefehler) {
            return res.status(400).json({ success: false, message: Vorlage.alsText(makeTranslator(req, res), 'FEHLER', error) });
        }
        Logger.error('[Greeting] Fehler beim Speichern der Settings:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================================
// INVITE MAPPING CRUD
// ============================================================================

router.get('/invite-mappings', requirePermission('GREETING.SETTINGS.EDIT'), async (req, res) => {
    const dbService = ServiceManager.get('dbService');
    const guildId = res.locals.guildId;
    try {
        const rows = await dbService.query(
            'SELECT * FROM greeting_invite_mappings WHERE guild_id = ? ORDER BY created_at DESC',
            [guildId]
        );
        res.json({ success: true, mappings: rows });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

router.post('/invite-mappings', requirePermission('GREETING.SETTINGS.EDIT'), async (req, res) => {
    const dbService = ServiceManager.get('dbService');
    const Logger = ServiceManager.get('Logger');
    const guildId = res.locals.guildId;
    const { invite_code, label, welcome_content } = req.body;

    if (!invite_code || typeof invite_code !== 'string' || invite_code.length > 50) {
        return res.status(400).json({ success: false, message: 'Invalid invite code' });
    }

    // Strip discord.gg/ prefix if present
    const code = invite_code.replace(/^(https?:\/\/)?(discord\.gg\/|discord\.com\/invite\/)/, '').trim();

    try {
        await dbService.query(`
            INSERT INTO greeting_invite_mappings (guild_id, invite_code, label, welcome_content)
            VALUES (?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                label = VALUES(label),
                welcome_content = VALUES(welcome_content),
                updated_at = CURRENT_TIMESTAMP
        `, [guildId, code, label || null, welcome_content || null]);

        Logger.info(`[Greeting] Invite mapping created/updated: ${code} for guild ${guildId}`);
        res.json({ success: true });
    } catch (error) {
        Logger.error('[Greeting] Error creating invite mapping:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

router.delete('/invite-mappings/:id', requirePermission('GREETING.SETTINGS.EDIT'), async (req, res) => {
    const dbService = ServiceManager.get('dbService');
    const guildId = res.locals.guildId;
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ success: false, message: 'Invalid ID' });

    try {
        await dbService.query(
            'DELETE FROM greeting_invite_mappings WHERE id = ? AND guild_id = ?',
            [id, guildId]
        );
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================================
// SEND VERIFICATION PANEL (IPC → Bot)
// ============================================================================

router.post('/send-verification-panel', requirePermission('GREETING.SETTINGS.EDIT'), async (req, res) => {
    const ipcServer = ServiceManager.get('ipcServer');
    const Logger = ServiceManager.get('Logger');
    const guildId = res.locals.guildId;

    try {
        const responses = await ipcServer.broadcast('greeting:SEND_VERIFICATION_PANEL', { guildId });
        const resp = responses && responses.length > 0 ? responses[0] : null;
        if (resp && resp.success) {
            res.json({ success: true });
        } else {
            res.json({ success: false, message: resp?.error || 'Bot did not respond' });
        }
    } catch (error) {
        Logger.error('[Greeting] Error sending verification panel:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;