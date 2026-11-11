/**
 * Kern-Settings-Router
 * Routes: /guild/:guildId/settings/*
 *
 * Ersetzt das Core-Plugin für Settings-Routen.
 *
 * @author FireDervil
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const { ServiceManager } = require('dunebot-core');
const { requirePermission } = require('../../middlewares/permissions.middleware');
const { istAn } = require('dunebot-sdk/utils');
const Kerneinstellungen = require('../../helpers/Kerneinstellungen');

// GET /settings → Overview
router.get('/', requirePermission('CORE.SETTINGS.VIEW'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const themeManager = ServiceManager.get('themeManager');
    const guildId = res.locals.guildId;

    let enabledPlugins = [];
    try {
        enabledPlugins = await dbService.getEnabledPluginsWithBadges(guildId);
    } catch (err) {
        Logger.error('[KernSettings] Fehler beim Laden der Plugins:', err);
    }

    await themeManager.renderView(res, 'guild/settings', {
        title: 'Einstellungen',
        activeMenu: `/guild/${guildId}/settings`,
        guildId,
        enabledPlugins: enabledPlugins || []
    });
});

// GET /settings/general
router.get('/general', requirePermission('CORE.SETTINGS.VIEW'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const themeManager = ServiceManager.get('themeManager');
    const i18n = ServiceManager.get('i18n');
    const guildId = res.locals.guildId;

    res.locals.pluginName = 'core';
    req.params.pluginName = 'core';

    // Kein `THEME` mehr (2026-11-04): Das aktive Theme steht in `guild_themes`
    // und wird unter /themes gesetzt. `configs.THEME` las niemand.
    const settings = { prefix: '!', locale: 'de-DE', slashCommands: true, praefixBefehle: true };

    try {
        const configs = await dbService.query(`
            SELECT config_key, config_value
            FROM configs
            WHERE plugin_name = 'core'
              AND guild_id = ?
              AND context = 'shared'
              AND config_key IN ('PREFIX_COMMANDS_PREFIX', 'LOCALE', 'INTERACTIONS_SLASH', 'PREFIX_COMMANDS_ENABLED')
        `, [guildId]);

        const keyMap = {
            'PREFIX_COMMANDS_PREFIX': 'prefix',
            'LOCALE': 'locale',
            'INTERACTIONS_SLASH': 'slashCommands',
            'PREFIX_COMMANDS_ENABLED': 'praefixBefehle'
        };

        // Die zwei Schalter mit derselben Auslegung wie der Bot (`istAn`, K365):
        // Sonst zeigte die Seite „an“, während der Bot „aus“ liest, oder umgekehrt.
        const schalter = new Set(['slashCommands', 'praefixBefehle']);
        configs.forEach(row => {
            const viewKey = keyMap[row.config_key];
            if (viewKey) {
                settings[viewKey] = schalter.has(viewKey)
                    ? istAn(row.config_value)
                    : row.config_value;
            }
        });
    } catch (err) {
        Logger.error('[KernSettings] Fehler beim Laden der Settings:', err);
    }

    const languagesMeta = i18n.languagesMeta || [];

    // Die Statuskarte nennt das Theme, das wirklich gilt — dieselbe Quelle wie
    // die Themes-Seite, nicht mehr `configs.THEME`.
    let aktivesTheme = null;
    try {
        const name = await themeManager.getThemeForGuild(guildId);
        const theme = (await themeManager.getInstalledThemes()).find(t => t.name === name);
        aktivesTheme = theme?.displayName || name;
    } catch (err) {
        Logger.warn(`[KernSettings] Aktives Theme nicht lesbar: ${err.message}`);
    }

    await themeManager.renderView(res, 'guild/settings/general', {
        title: 'Allgemeine Einstellungen',
        activeMenu: `/guild/${guildId}/settings/general`,
        guildId,
        settings,
        languagesMeta,
        aktivesTheme
    });
});

// PUT /settings/general
router.put('/general', requirePermission('CORE.SETTINGS.EDIT'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const guildId = res.locals.guildId;
    const { prefix, locale, slashCommands, praefixBefehle } = req.body;

    // Dieselbe Regel wie /setprefix in Discord (K372): Beide gehen durch
    // `Kerneinstellungen`. Bis 2026-11-11 prüfte die Route nichts — nur das
    // Eingabefeld, und das lässt sich umgehen.
    const praefix = Kerneinstellungen.pruefePraefix(prefix);
    if (!praefix.ok) {
        return res.status(400).json({ success: false, message: praefix.grund });
    }

    try {
        await Kerneinstellungen.schreibe(dbService, guildId, {
            'PREFIX_COMMANDS_PREFIX': praefix.praefix,
            'LOCALE': locale,
            // Ein abgewähltes Kästchen schickt der Browser gar nicht mit — fehlt
            // das Feld, heisst das „aus“.
            'INTERACTIONS_SLASH': slashCommands === 'on' ? 1 : 0,
            'PREFIX_COMMANDS_ENABLED': praefixBefehle === 'on' ? 1 : 0
        });

        // Session-Locale löschen → sofortiger Sprachwechsel
        delete req.session.locale;

        // Dem Bot Bescheid sagen. Er hält die Sprache je Guild im Speicher
        // (`guild.locale`) und liest sie sonst nur beim Start — ohne diese
        // Zeile redet er bis zum nächsten Neustart in der alten Sprache
        // weiter. Der Handler dafür lag seit jeher ungenutzt in
        // `apps/bot/ipc/SET_GUILD_LOCALE.js`.
        if (locale) {
            try {
                const ipcServer = ServiceManager.get('ipcServer');
                // Frist gesetzt: veza wartet sonst unbegrenzt und haengt das
                // Speichern der Seite an die Antwort des Bots.
                await ipcServer.broadcast('dashboard:SET_GUILD_LOCALE', { guildId, locale }, true, { timeout: 3000 });
            } catch (err) {
                Logger.warn(`[KernSettings] Bot über die neue Sprache nicht erreicht: ${err.message}`);
            }
        }

        // Slash-Befehle wirken bei Discord nur über die Registrierung (K365).
        // Der Bot meldet die Befehle der Guild neu an — bei „aus“ einen leeren
        // Satz. Hat sich nichts geändert, sendet er nichts (Prüfsumme).
        // Präfix-Befehle brauchen das nicht: Der Bot liest den Schalter bei
        // jeder Nachricht.
        let botMeldung = null;
        try {
            const ipcServer = ServiceManager.get('ipcServer');
            const huelle = await ipcServer.broadcastOne('dashboard:BEFEHLE_NEU_ANMELDEN', { guildId }, true, { timeout: 5000 });
            const antwort = huelle?.data ?? huelle;
            if (!antwort?.success) botMeldung = antwort?.error || huelle?.error || 'keine Antwort';
        } catch (err) {
            botMeldung = err.message;
        }
        if (botMeldung) {
            Logger.warn(`[KernSettings] Bot hat die Befehle von Guild ${guildId} nicht neu angemeldet: ${botMeldung}`);
            return res.json({
                success: true,
                message: `Gespeichert. Der Bot hat die Slash-Befehle nicht neu angemeldet (${botMeldung}) — in Discord ändern sie sich erst bei seinem nächsten Start.`
            });
        }

        res.json({ success: true, message: 'Einstellungen erfolgreich gespeichert!' });
    } catch (error) {
        Logger.error('[KernSettings] Fehler beim Speichern:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET /settings/theme → Redirect auf neuen Themes-Bereich
router.get('/theme', (req, res) => {
    const guildId = res.locals.guildId;
    res.redirect(`/guild/${guildId}/themes`);
});

// POST /settings/theme → Redirect auf neuen Endpoint
router.post('/theme', requirePermission('CORE.SETTINGS.EDIT'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const themeManager = ServiceManager.get('themeManager');
    const guildId = res.locals.guildId;
    const { themeName } = req.body;

    try {
        const installed = await themeManager.getInstalledThemes();
        const theme = installed.find(t => t.name === themeName);

        if (!theme) {
            return res.status(404).json({ success: false, message: `Theme '${themeName}' nicht gefunden` });
        }

        await themeManager.setThemeForGuild(guildId, themeName);
        Logger.info(`[KernSettings] Theme für Guild ${guildId} auf '${themeName}' gesetzt`);

        return res.json({ success: true, message: `Theme '${theme.displayName || themeName}' aktiviert` });
    } catch (error) {
        Logger.error('[KernSettings] Fehler beim Setzen des Themes:', error);
        res.status(500).json({ success: false, message: 'Serverfehler' });
    }
});

// GET /settings/integrations
router.get('/integrations', requirePermission('CORE.SETTINGS.EDIT'), async (req, res) => {
    const themeManager = ServiceManager.get('themeManager');
    const guildId = res.locals.guildId;

    // Die Twitch-Karte zeigte seit jeher einen abgeschalteten Schalter und
    // einen toten Knopf (Befund B-7 des Streaming-Vorhabens). Statt Erwartung
    // zu wecken und nichts zu tun, verweist sie jetzt dorthin, wo die Sache
    // wirklich eingerichtet wird - und sagt es ehrlich, wenn das Plugin in
    // dieser Guild gar nicht laeuft.
    let streamingAktiv = false;
    try {
        const pluginManager = ServiceManager.get('pluginManager');
        streamingAktiv = Boolean(await pluginManager?.isPluginEnabledForGuild('streaming', guildId));
    } catch (err) {
        ServiceManager.get('Logger').warn(`[Settings] Streaming-Status nicht ermittelbar: ${err.message}`);
    }

    await themeManager.renderView(res, 'guild/settings/integrations', {
        title: 'Integrationen',
        activeMenu: `/guild/${guildId}/settings/integrations`,
        guildId,
        streamingAktiv
    });
});

// =============================================
// CHANNEL-VERWALTUNG (Discord Channels Mirror)
// =============================================

// ─────────────────────────────────────────────────────────────────────────────
// Rollen und Kanäle standen bis zum 2026-08-09 hier.
//
// Sie sind keine Einstellungen: beide Seiten haben keine eigene Datenhaltung,
// sie spiegeln Discord live über IPC und schreiben dorthin zurück. Sie liegen
// jetzt im Plugin `discord` unter /guild/:guildId/plugins/discord.
//
// Die IPC-Handler (dashboard:GET_GUILD_ROLES_DETAILED und Verwandte) bleiben
// bewusst im Kern unter apps/bot/ipc/ — sie sind gemeinsame Infrastruktur,
// auch music fragt dort Kanäle ab.
// ─────────────────────────────────────────────────────────────────────────────

module.exports = router;
