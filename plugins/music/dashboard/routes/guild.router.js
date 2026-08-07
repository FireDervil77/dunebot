/**
 * Musik - Seitenrouten
 *
 *   /               -> Weiterleitung auf /dashboard
 *   /dashboard      Was gerade laeuft, samt Steuerung
 *   /warteschlange  Die volle Warteschlange
 *   /listen         Gespeicherte Wiedergabelisten
 *   /verlauf        Was gespielt wurde
 *   /settings       Einstellungen (unter Kern-Einstellungen)
 *
 * @module music/dashboard/routes/guild
 */

const express = require('express');
const router = express.Router();
const { ServiceManager } = require('dunebot-core');
const { requirePermission } = require('../../../../apps/dashboard/middlewares/permissions.middleware');
const { MusicSettings, MusicHistory, MusicPlaylists } = require('../../shared/models');
const klangfilter = require('../../bot/klangfilter');
const {
    makeTranslator, renderView, getGuildChannels, getSprachkanaele, getGuildRoles,
    zustandHolen, renderFehler, spielzeitText
} = require('./_shared');

/** Skripte anmelden, die eine Seite braucht. */
function skripteAnmelden(handles) {
    const assetManager = ServiceManager.get('assetManager');
    if (!assetManager) return;
    handles.forEach(h => assetManager.enqueueScript(h));
}

// =====================================================
// Hauptmenue-Punkt -> Uebersicht
// =====================================================
router.get('/', requirePermission('MUSIC.VIEW'), (req, res) => {
    res.redirect(`/guild/${res.locals.guildId}/plugins/music/dashboard`);
});

// =====================================================
// Uebersicht mit Steuerung
// =====================================================
router.get('/dashboard', requirePermission('MUSIC.VIEW'), async (req, res) => {
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);

    try {
        const [zustand, einstellungen, statistik, channels] = await Promise.all([
            zustandHolen(guildId),
            MusicSettings.getSettings(guildId),
            MusicHistory.getStats(guildId, 30).catch(() => null),
            getGuildChannels(guildId)
        ]);

        skripteAnmelden(['music-steuerung']);

        await renderView(res, 'guild/music-dashboard', {
            tr, guildId, zustand, einstellungen, statistik, channels,
            filter: klangfilter.auswahl(),
            spielzeitText
        });
    } catch (error) {
        return renderFehler(res, error, 'Die Musik-Uebersicht konnte nicht geladen werden');
    }
});

// =====================================================
// Warteschlange
// =====================================================
router.get('/warteschlange', requirePermission('MUSIC.VIEW'), async (req, res) => {
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);

    try {
        const [zustand, listen] = await Promise.all([
            zustandHolen(guildId),
            MusicPlaylists.getAll(guildId).catch(() => [])
        ]);

        skripteAnmelden(['music-steuerung']);

        await renderView(res, 'guild/music-queue', { tr, guildId, zustand, listen, spielzeitText });
    } catch (error) {
        return renderFehler(res, error, 'Die Warteschlange konnte nicht geladen werden');
    }
});

// =====================================================
// Wiedergabelisten
// =====================================================
router.get('/listen', requirePermission('MUSIC.VIEW'), async (req, res) => {
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);

    try {
        const listen = await MusicPlaylists.getAll(guildId);

        // Eine Liste im Detail, wenn danach gefragt wurde
        let offen = null;
        if (req.query.liste) {
            const id = parseInt(req.query.liste, 10);
            if (!Number.isNaN(id)) offen = await MusicPlaylists.getWithTracks(id, guildId);
        }

        skripteAnmelden(['music-steuerung']);

        await renderView(res, 'guild/music-playlists', { tr, guildId, listen, offen, spielzeitText });
    } catch (error) {
        return renderFehler(res, error, 'Die Wiedergabelisten konnten nicht geladen werden');
    }
});

// =====================================================
// Verlauf
// =====================================================
router.get('/verlauf', requirePermission('MUSIC.HISTORY.VIEW'), async (req, res) => {
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);

    const tage = Math.min(Math.max(parseInt(req.query.tage, 10) || 30, 1), 365);

    try {
        const [verlauf, statistik] = await Promise.all([
            MusicHistory.getRecent(guildId, 100),
            MusicHistory.getStats(guildId, tage)
        ]);

        skripteAnmelden(['music-steuerung']);

        await renderView(res, 'guild/music-history', { tr, guildId, verlauf, statistik, tage, spielzeitText });
    } catch (error) {
        return renderFehler(res, error, 'Der Verlauf konnte nicht geladen werden');
    }
});

// =====================================================
// Einstellungen (haengt unter den Kern-Einstellungen)
// =====================================================
router.get('/settings', requirePermission('MUSIC.VIEW'), async (req, res) => {
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);

    try {
        // Textkanaele fuer die Ansage, Sprachkanaele fuer die Freigabe -
        // die kommen aus zwei verschiedenen IPC-Handlern.
        const [einstellungen, channels, sprachkanaele, roles] = await Promise.all([
            MusicSettings.getSettings(guildId),
            getGuildChannels(guildId),
            getSprachkanaele(guildId),
            getGuildRoles(guildId)
        ]);

        skripteAnmelden(['music-steuerung']);

        await renderView(res, 'guild/music-settings', {
            tr, guildId, einstellungen, channels, sprachkanaele, roles,
            filter: klangfilter.auswahl(),
            spotifyEingerichtet: Boolean(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET)
        });
    } catch (error) {
        return renderFehler(res, error, 'Die Musik-Einstellungen konnten nicht geladen werden');
    }
});

module.exports = router;
