/**
 * Musik - Einstellungen speichern
 *
 * @module music/dashboard/routes/settings
 */

const express = require('express');
const router = express.Router();
const { requirePermission } = require('../../../../apps/dashboard/middlewares/permissions.middleware');
const { MusicSettings } = require('../../shared/models');
const klangfilter = require('../../bot/klangfilter');
const { makeTranslator, fehler } = require('./_shared');

/** Checkbox-Werte kommen als '1'/'0'. */
const zuBool = (w) => w === '1' || w === 1 || w === true || w === 'true' || w === 'on';

/** Ganzzahl im erlaubten Bereich. */
const zahl = (wert, ersatz, min, max) => {
    const n = parseInt(wert, 10);
    if (Number.isNaN(n)) return ersatz;
    return Math.max(min, Math.min(max, n));
};

router.put('/', requirePermission('MUSIC.SETTINGS.EDIT'), async (req, res) => {
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);
    const b = req.body;

    try {
        const updates = {};

        if (b.dj_role_id !== undefined) updates.dj_role_id = b.dj_role_id || null;
        if (b.default_volume !== undefined) updates.default_volume = zahl(b.default_volume, 50, 0, 200);
        // 0 heisst unbegrenzt
        if (b.max_queue_size !== undefined) updates.max_queue_size = zahl(b.max_queue_size, 0, 0, 10000);
        if (b.max_track_seconds !== undefined) updates.max_track_seconds = zahl(b.max_track_seconds, 0, 0, 86400);
        if (b.announce_channel !== undefined) updates.announce_channel = b.announce_channel || null;
        if (b.announce_now_playing !== undefined) updates.announce_now_playing = zuBool(b.announce_now_playing) ? 1 : 0;
        if (b.leave_when_empty !== undefined) updates.leave_when_empty = zuBool(b.leave_when_empty) ? 1 : 0;
        if (b.leave_after_seconds !== undefined) updates.leave_after_seconds = zahl(b.leave_after_seconds, 120, 10, 3600);

        // Quellen
        if (b.allow_youtube !== undefined) updates.allow_youtube = zuBool(b.allow_youtube) ? 1 : 0;
        if (b.allow_soundcloud !== undefined) updates.allow_soundcloud = zuBool(b.allow_soundcloud) ? 1 : 0;
        if (b.allow_spotify !== undefined) updates.allow_spotify = zuBool(b.allow_spotify) ? 1 : 0;
        if (b.allow_direct !== undefined) updates.allow_direct = zuBool(b.allow_direct) ? 1 : 0;

        // Betrieb
        if (b.mode_247 !== undefined) updates.mode_247 = zuBool(b.mode_247) ? 1 : 0;
        if (b.autoplay !== undefined) updates.autoplay = zuBool(b.autoplay) ? 1 : 0;
        if (b.audio_quality !== undefined) updates.audio_quality = zahl(b.audio_quality, 2, 0, 2);

        if (b.audio_filter !== undefined) {
            updates.audio_filter = klangfilter.bekannt(b.audio_filter) ? String(b.audio_filter).toLowerCase() : 'aus';
        }

        // Abstimmung
        if (b.vote_skip_enabled !== undefined) updates.vote_skip_enabled = zuBool(b.vote_skip_enabled) ? 1 : 0;
        if (b.vote_skip_percent !== undefined) updates.vote_skip_percent = zahl(b.vote_skip_percent, 50, 1, 100);

        if (b.embed_color !== undefined) {
            const farbe = String(b.embed_color || '').trim();
            updates.embed_color = /^#[0-9A-Fa-f]{6}$/.test(farbe) ? farbe : '#1DB954';
        }

        // Erlaubte Sprachkanaele; leere Liste heisst "ueberall"
        if (b.allowed_voice !== undefined) {
            let liste = b.allowed_voice;
            if (typeof liste === 'string') {
                try { liste = JSON.parse(liste); } catch { liste = []; }
            }
            updates.allowed_voice = JSON.stringify(Array.isArray(liste) ? liste : []);
        }

        await MusicSettings.updateSettings(guildId, updates);
        res.json({ success: true, message: tr('music:MESSAGES.SETTINGS_SAVED') });
    } catch (error) {
        fehler(res, error, tr('music:MESSAGES.SETTINGS_ERROR'));
    }
});

module.exports = router;
