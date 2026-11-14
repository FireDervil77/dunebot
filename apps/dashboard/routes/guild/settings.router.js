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
const { requirePermission, requireGuildOwner, requireBesitzerInKontrollGuild, istKontrollGuildGesperrt } = require('../../middlewares/permissions.middleware');
const { csrfProtection } = require('../../middlewares/security/csrf-protection.middleware');
const Datenauskunft = require('../../helpers/Datenauskunft');
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

    // „Guild löschen“ (G-04c) sieht nur der Besitzer, und nie in der Kontroll-Guild.
    let guildLoeschen = null;
    try {
        const [g] = await dbService.query('SELECT owner_id, guild_name FROM guilds WHERE _id = ?', [guildId]);
        if (g && g.owner_id === req.session.user?.info?.id && String(guildId) !== String(process.env.CONTROL_GUILD_ID)) {
            guildLoeschen = { name: g.guild_name || String(guildId) };
        }
    } catch (err) {
        Logger.warn(`[KernSettings] Besitzer nicht lesbar: ${err.message}`);
    }

    await themeManager.renderView(res, 'guild/settings/general', {
        title: 'Allgemeine Einstellungen',
        activeMenu: `/guild/${guildId}/settings/general`,
        guildId,
        settings,
        languagesMeta,
        aktivesTheme,
        guildLoeschen
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

/**
 * Guild löschen (G-04c, K380): nur der Besitzer, nie die Kontroll-Guild.
 *
 * Die Probe zählt mit `Datenauskunft.guildLoeschen(…, { trocken: true })`, was
 * ginge: dieselben Anweisungen, zurückgerollt. Abgeschaltet wird dabei nichts.
 * Das rote Fenster zeigt die Zahlen, bevor jemand den Namen eintippt.
 *
 * Gelöscht wird in dieser Reihenfolge: Plugins abschalten (Gameserver werden
 * dabei gestoppt), Zeilen über die Erklärungen, **dann** verlässt der Bot die
 * Guild (`GUILD_VERLASSEN`). So sieht der Besitzer das Ergebnis im Fenster.
 * Das danach folgende `guildDelete` findet keine Zeile mehr und tut nichts
 * (G-04d, `GuildManager.removeGuild`).
 */
async function guildFuerLoeschen(guildId) {
    if (String(guildId) === String(process.env.CONTROL_GUILD_ID)) return { fehler: 'Die Kontroll-Guild wird nicht gelöscht.' };
    const [zeile] = await ServiceManager.get('dbService').query('SELECT guild_name FROM guilds WHERE _id = ?', [guildId]);
    if (!zeile) return { fehler: 'Guild nicht gefunden' };
    return { name: zeile.guild_name || String(guildId) };
}

// GET /settings/general/loeschen-probe → was ginge (Probelauf)
router.get('/general/loeschen-probe', requirePermission('CORE.SETTINGS.VIEW'), requireGuildOwner(), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const guildId = res.locals.guildId;
    const g = await guildFuerLoeschen(guildId);
    if (g.fehler) return res.status(400).json({ success: false, message: g.fehler });
    try {
        const plugins = (await ServiceManager.get('dbService').getEnabledPlugins(guildId)).filter(p => p !== 'core');
        const probe = await Datenauskunft.guildLoeschen(guildId, { trocken: true, anlass: 'Probe Einstellungen' });
        if (!probe.ok) return res.status(500).json({ success: false, message: probe.fehler });
        const zeilen = Object.fromEntries(Object.entries(probe.geloescht)
            .map(([p, t]) => [p, Object.values(t).reduce((a, b) => a + b, 0)]));
        return res.json({ success: true, data: { name: g.name, plugins, zeilen } });
    } catch (err) {
        Logger.error(`[KernSettings] Probe „Guild löschen“ für ${guildId} gescheitert:`, err);
        return res.status(500).json({ success: false, message: err.message });
    }
});

// POST /settings/general/loeschen { bestaetigung } → Guild löschen, Bot geht
router.post('/general/loeschen', csrfProtection, requirePermission('CORE.SETTINGS.VIEW'), requireGuildOwner(), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const guildId = res.locals.guildId;
    const g = await guildFuerLoeschen(guildId);
    if (g.fehler) return res.status(400).json({ success: false, message: g.fehler });
    // Was eingetippt werden muss, steht hier fest, nicht im Browser.
    if (String(req.body?.bestaetigung ?? '').trim().toLowerCase() !== g.name.trim().toLowerCase()) {
        return res.status(400).json({ success: false, message: `Der Name stimmt nicht, es wurde nichts gelöscht. Erwartet: ${g.name}` });
    }

    const info = req.session.user.info;
    let ergebnis;
    try {
        ergebnis = await Datenauskunft.guildLoeschen(guildId, {
            wer: { userId: info.id, userName: info.global_name || info.username || null },
            anlass: 'Einstellungen → Allgemein',
        });
    } catch (err) {
        Logger.error(`[KernSettings] „Guild löschen“ für ${guildId} gescheitert:`, err);
        return res.status(500).json({ success: false, message: err.message });
    }
    if (!ergebnis.ok) {
        // Abgebrochen: Was schon abgeschaltet ist, bleibt abgeschaltet, Zeilen
        // sind keine gelöscht (Datenauskunft bricht vor dem Löschen ab).
        return res.status(500).json({ success: false, message: ergebnis.fehler, data: { abgeschaltet: ergebnis.abgeschaltet } });
    }

    let verlassenFehler = null;
    try {
        const huelle = await ServiceManager.get('ipcServer')
            .broadcastOne('dashboard:GUILD_VERLASSEN', { guildId }, true, { timeout: 15000 });
        const antwort = huelle?.data ?? huelle;
        if (!antwort?.success) verlassenFehler = antwort?.error || huelle?.error || 'keine Antwort';
    } catch (err) {
        verlassenFehler = err.message;
    }
    if (verlassenFehler) Logger.warn(`[KernSettings] Guild ${guildId} gelöscht, der Bot hat sie nicht verlassen: ${verlassenFehler}`);

    const zeilen = Object.values(ergebnis.geloescht).flatMap(t => Object.values(t)).reduce((a, b) => a + b, 0);
    return res.json({
        success: true,
        data: { abgeschaltet: ergebnis.abgeschaltet.map(a => a.plugin), zeilen, verlassen: !verlassenFehler, verlassenFehler },
    });
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
// AUFBEWAHRUNG (G-05)
// Kern-Teil `shared/aufbewahrung` auf den Seiten der Plugins. Sehen darf es
// jeder mit Zugang zur Guild, ändern nur, wer das Recht der Frist hat
// (`recht` in der Erklärung des Plugins).
// =============================================

const PLUGIN_NAME = /^[a-z0-9_-]{1,32}$/;

// GET /settings/aufbewahrung/:plugin → die einstellbaren Fristen des Plugins
router.get('/aufbewahrung/:plugin', async (req, res) => {
    const guildId = res.locals.guildId;
    const plugin = String(req.params.plugin);
    if (!PLUGIN_NAME.test(plugin)) return res.status(400).json({ success: false, message: 'Unbekanntes Plugin' });
    try {
        const pm = ServiceManager.get('permissionManager');
        const userId = req.session.user?.info?.id;
        const fristen = await require('../../helpers/Aufbewahrung').fuerGuild(guildId, plugin);
        const rechte = {};
        for (const f of fristen) {
            if (!(f.recht in rechte)) rechte[f.recht] = Boolean(userId && await pm.hasPermission(userId, guildId, f.recht));
        }
        res.json({
            success: true,
            data: fristen.map(f => ({ ...f, titel: req.translate(f.titel), darf: rechte[f.recht] })),
        });
    } catch (err) {
        ServiceManager.get('Logger').error(`[Aufbewahrung] Fristen von ${plugin} für ${guildId} nicht lesbar:`, err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// PUT /settings/aufbewahrung/:plugin { name, tage } → tage leer = Vorgabe
router.put('/aufbewahrung/:plugin', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const guildId = res.locals.guildId;
    const plugin = String(req.params.plugin);
    const name = String(req.body?.name ?? '');
    if (!PLUGIN_NAME.test(plugin)) return res.status(400).json({ success: false, message: 'Unbekanntes Plugin' });
    const Aufbewahrung = require('../../helpers/Aufbewahrung');
    const frist = Aufbewahrung.erklaerungen().find(e => e.plugin === plugin && e.name === name && e.guild);
    if (!frist) return res.status(404).json({ success: false, message: `Keine einstellbare Frist ${plugin}:${name}` });
    // Das Recht steht in der Erklärung, also erst hier bekannt.
    return requirePermission(frist.recht)(req, res, async () => {
        try {
            const r = await Aufbewahrung.setzeGuild(guildId, plugin, name, req.body?.tage);
            if (!r.ok) return res.status(400).json({ success: false, message: r.grund });
            Logger.info(`[Aufbewahrung] ${plugin}:${name} in ${guildId}: ${r.wirksam} Tage (von ${req.session.user.info.id})`);
            res.json({ success: true, data: { wirksam: r.wirksam } });
        } catch (err) {
            Logger.error(`[Aufbewahrung] ${plugin}:${name} in ${guildId} nicht gespeichert:`, err);
            res.status(500).json({ success: false, message: err.message });
        }
    });
});

// =============================================
// GESTALTUNG (G-09)
// Palette, Logo und Banner der Bot-Ausgaben unter Einstellungen → Gestaltung,
// dazu der Kern-Teil `shared/plugin-farben` auf den Seiten der Plugins.
// Schreiben: das Recht, und in der Kontroll-Guild nur der Besitzer
// (`requireBesitzerInKontrollGuild`). Wie eine Farbe wirkt, steht in
// `packages/dunebot-sdk/lib/Gestaltung.js`.
// =============================================

const GestaltungSeite = require('../../helpers/GestaltungSeite');

/** Darf der Nutzer hier schreiben? Recht und Kontroll-Guild, für die Anzeige. */
async function darfGestalten(req, guildId, recht) {
    const userId = req.session.user?.info?.id;
    if (!userId) return { darf: false, gesperrt: false };
    const gesperrt = await istKontrollGuildGesperrt(guildId, userId);
    const hat = await ServiceManager.get('permissionManager').hasPermission(userId, guildId, recht);
    return { darf: Boolean(hat) && !gesperrt, gesperrt };
}

// GET /settings/gestaltung → Seite
router.get('/gestaltung', requirePermission('CORE.SETTINGS.VIEW'), async (req, res) => {
    const themeManager = ServiceManager.get('themeManager');
    const guildId = res.locals.guildId;
    let gestaltung = null;
    let ladefehler = null;
    try {
        gestaltung = await GestaltungSeite.seite(guildId);
    } catch (err) {
        ServiceManager.get('Logger').error(`[Gestaltung] Seite für ${guildId} nicht lesbar:`, err);
        ladefehler = err.message;
    }
    const zugang = await darfGestalten(req, guildId, 'CORE.SETTINGS.EDIT');
    await themeManager.renderView(res, 'guild/settings/gestaltung', {
        title: 'Gestaltung',
        activeMenu: `/guild/${guildId}/settings/gestaltung`,
        guildId,
        gestaltung,
        ladefehler,
        darf: zugang.darf,
        gesperrt: zugang.gesperrt,
    });
});

// PUT /settings/gestaltung { farben: {rolle: hex|''}, logo, banner }
router.put('/gestaltung', csrfProtection, requirePermission('CORE.SETTINGS.EDIT'), requireBesitzerInKontrollGuild(), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const guildId = res.locals.guildId;
    try {
        await GestaltungSeite.speichereGuild(guildId, req.body || {});
        Logger.info(`[Gestaltung] Palette von ${guildId} gespeichert (von ${req.session.user.info.id})`);
        res.json({ success: true, data: await GestaltungSeite.seite(guildId) });
    } catch (err) {
        if (err instanceof GestaltungSeite.Eingabefehler) return res.status(400).json({ success: false, message: err.message });
        Logger.error(`[Gestaltung] Palette von ${guildId} nicht gespeichert:`, err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET /settings/gestaltung/plugin/:plugin → Kern-Teil „Farben dieses Plugins“
router.get('/gestaltung/plugin/:plugin', async (req, res) => {
    const guildId = res.locals.guildId;
    const plugin = String(req.params.plugin);
    if (!PLUGIN_NAME.test(plugin)) return res.status(400).json({ success: false, message: 'Unbekanntes Plugin' });
    try {
        const teil = await GestaltungSeite.pluginTeil(guildId, plugin);
        const zugang = await darfGestalten(req, guildId, teil.recht);
        res.json({ success: true, data: { ...teil, darf: zugang.darf, gesperrt: zugang.gesperrt } });
    } catch (err) {
        if (err instanceof GestaltungSeite.Eingabefehler) return res.status(404).json({ success: false, message: err.message });
        ServiceManager.get('Logger').error(`[Gestaltung] Farben von ${plugin} für ${guildId} nicht lesbar:`, err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// PUT /settings/gestaltung/plugin/:plugin { eigen, farben }
router.put('/gestaltung/plugin/:plugin', csrfProtection, async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const guildId = res.locals.guildId;
    const plugin = String(req.params.plugin);
    if (!PLUGIN_NAME.test(plugin)) return res.status(400).json({ success: false, message: 'Unbekanntes Plugin' });
    const recht = require('dunebot-sdk').Gestaltung.erklaerung(plugin)?.recht;
    if (!recht) return res.status(404).json({ success: false, message: `${plugin} erklärt keine Farben` });
    // Das Recht steht in der Erklärung des Plugins, also erst hier bekannt.
    return requirePermission(recht)(req, res, () => requireBesitzerInKontrollGuild()(req, res, async () => {
        try {
            await GestaltungSeite.speicherePlugin(guildId, plugin, { eigen: req.body?.eigen === true, farben: req.body?.farben });
            Logger.info(`[Gestaltung] Farben von ${plugin} in ${guildId}: ${req.body?.eigen === true ? 'eigene' : 'der Guild'} (von ${req.session.user.info.id})`);
            res.json({ success: true, data: await GestaltungSeite.pluginTeil(guildId, plugin) });
        } catch (err) {
            if (err instanceof GestaltungSeite.Eingabefehler) return res.status(400).json({ success: false, message: err.message });
            Logger.error(`[Gestaltung] Farben von ${plugin} in ${guildId} nicht gespeichert:`, err);
            res.status(500).json({ success: false, message: err.message });
        }
    }));
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
