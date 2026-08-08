/**
 * AutoMod - Einstellungen speichern
 *
 * Eine einzige PUT-Route fuer alle Formularseiten. Jedes Feld wird nur
 * angefasst, wenn es auch mitgeschickt wurde (`!== undefined`) - genau deshalb
 * duerfen Filter, Raid-Schutz und Grundeinstellungen getrennte Formulare auf
 * getrennten Seiten sein und trotzdem hierher schreiben.
 *
 * @module automod/routes/settings
 */

const express = require('express');
const router = express.Router();
const { ServiceManager } = require('dunebot-core');
const { requirePermission } = require('../../../../apps/dashboard/middlewares/permissions.middleware');
const { AutoModSettings } = require('../../shared/models');
const { makeTranslator } = require('./_shared');

/** Checkbox-Werte kommen als '1'/'0' aus dem Formular. */
const zuBool = (wert) => wert === '1' || wert === 1 || wert === true || wert === 'true';

/** Ganzzahl mit Rueckfallwert, wenn das Feld leer oder unlesbar ist. */
const zuZahl = (wert, ersatz) => {
    const zahl = parseInt(wert, 10);
    return Number.isNaN(zahl) ? ersatz : zahl;
};

/**
 * Ein Wert, der als Array oder als JSON-Text ankommen kann, zu einem Array.
 *
 * @param {*} roh Formularwert
 * @returns {Array} Liste
 */
function zuListe(roh) {
    if (Array.isArray(roh)) return roh;
    if (typeof roh === 'string') {
        try {
            const gelesen = JSON.parse(roh);
            return Array.isArray(gelesen) ? gelesen : [];
        } catch {
            return [];
        }
    }
    return [];
}

router.put('/', requirePermission('AUTOMOD.SETTINGS.EDIT'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);

    try {
        const b = req.body;
        const updates = {};

        // --- Grundeinstellungen ---
        if (b.log_channel !== undefined) updates.log_channel = b.log_channel || null;
        if (b.max_strikes !== undefined) updates.max_strikes = zuZahl(b.max_strikes, 10);
        if (b.action !== undefined && ['TIMEOUT', 'KICK', 'BAN'].includes(b.action)) {
            updates.action = b.action;
        }
        // Dauer der Hauptaktion in Minuten. 40320 = 28 Tage ist die Grenze,
        // die Discord fuer Timeouts setzt - alles darueber lehnt die Schnittstelle ab.
        if (b.action_duration !== undefined) {
            updates.action_duration = Math.min(40320, Math.max(1, zuZahl(b.action_duration, 1440)));
        }
        if (b.debug_mode !== undefined) updates.debug_mode = zuBool(b.debug_mode);
        if (b.dm_message !== undefined) updates.dm_message = b.dm_message || null;

        // --- Inhaltsfilter ---
        if (b.anti_ghostping !== undefined) updates.anti_ghostping = zuBool(b.anti_ghostping);
        if (b.anti_spam !== undefined) updates.anti_spam = zuBool(b.anti_spam);

        // Anti-Spam-Schwellen. Untergrenzen bewusst hart: 1 Nachricht je
        // Fenster oder 1 Wiederholung wuerde jede zweite Nachricht loeschen.
        if (b.anti_spam_messages !== undefined) {
            updates.anti_spam_messages = Math.min(50, Math.max(2, zuZahl(b.anti_spam_messages, 5)));
        }
        if (b.anti_spam_seconds !== undefined) {
            updates.anti_spam_seconds = Math.min(60, Math.max(1, zuZahl(b.anti_spam_seconds, 5)));
        }
        if (b.anti_spam_duplicates !== undefined) {
            updates.anti_spam_duplicates = Math.min(20, Math.max(2, zuZahl(b.anti_spam_duplicates, 3)));
        }
        if (b.anti_massmention !== undefined) updates.anti_massmention = zuBool(b.anti_massmention);
        if (b.anti_massmention_threshold !== undefined) updates.anti_massmention_threshold = zuZahl(b.anti_massmention_threshold, 3);
        if (b.anti_attachments !== undefined) updates.anti_attachments = zuBool(b.anti_attachments);
        if (b.anti_invites !== undefined) updates.anti_invites = zuBool(b.anti_invites);
        if (b.anti_links !== undefined) updates.anti_links = zuBool(b.anti_links);

        // --- Grenzwerte ---
        if (b.max_lines !== undefined) updates.max_lines = zuZahl(b.max_lines, 0);
        if (b.max_mentions !== undefined) updates.max_mentions = zuZahl(b.max_mentions, 0);
        if (b.max_role_mentions !== undefined) updates.max_role_mentions = zuZahl(b.max_role_mentions, 0);

        // --- Ausnahmen ---
        if (b.whitelisted_channels !== undefined) {
            updates.whitelisted_channels = zuListe(b.whitelisted_channels);
        }

        // --- Stichwortlisten ---
        // Wird als JSON-Text gespeichert. Das Formular schickt das Feld nur auf
        // der Regel-Seite mit; auf allen anderen Seiten bleibt es unangetastet.
        if (b.active_keyword_lists !== undefined) {
            updates.active_keyword_lists = JSON.stringify(zuListe(b.active_keyword_lists));
        }

        // --- Raid-Schutz ---
        if (b.raid_protection_enabled !== undefined) updates.raid_protection_enabled = zuBool(b.raid_protection_enabled);
        if (b.raid_join_threshold !== undefined) updates.raid_join_threshold = zuZahl(b.raid_join_threshold, 5);
        if (b.raid_join_timespan !== undefined) updates.raid_join_timespan = zuZahl(b.raid_join_timespan, 10);
        if (b.raid_min_account_age_days !== undefined) updates.raid_min_account_age_days = zuZahl(b.raid_min_account_age_days, 0);
        if (b.raid_action !== undefined && ['KICK', 'BAN'].includes(b.raid_action)) {
            updates.raid_action = b.raid_action;
        }
        if (b.raid_lockdown_enabled !== undefined) updates.raid_lockdown_enabled = zuBool(b.raid_lockdown_enabled);
        if (b.raid_alert_channel !== undefined) updates.raid_alert_channel = b.raid_alert_channel || null;
        if (b.raid_alert_mention_mods !== undefined) updates.raid_alert_mention_mods = zuBool(b.raid_alert_mention_mods);

        // Vertrauenswuerdige Einladungen: ein Code je Zeile, ganze URLs werden
        // auf den Code gekuerzt.
        if (b.raid_trusted_invites !== undefined) {
            if (typeof b.raid_trusted_invites === 'string') {
                updates.raid_trusted_invites = b.raid_trusted_invites
                    .split(/\r?\n/)
                    .map(zeile => zeile.trim())
                    .filter(zeile => zeile.length > 0)
                    .map(zeile => {
                        const treffer = zeile.match(/discord\.gg\/([A-Za-z0-9]+)/);
                        return treffer ? treffer[1] : zeile;
                    });
            } else {
                updates.raid_trusted_invites = Array.isArray(b.raid_trusted_invites) ? b.raid_trusted_invites : [];
            }
        }

        await AutoModSettings.updateSettings(guildId, updates);
        Logger.info(`[AutoMod] Einstellungen gespeichert fuer Guild ${guildId} (${Object.keys(updates).length} Felder)`);

        res.json({ success: true, message: tr('automod:MESSAGES.SETTINGS_SAVED') });
    } catch (error) {
        Logger.error('[AutoMod] Fehler beim Speichern der Einstellungen:', error);
        res.status(500).json({ success: false, message: tr('automod:MESSAGES.SETTINGS_ERROR') });
    }
});

module.exports = router;
