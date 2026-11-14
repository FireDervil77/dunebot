/**
 * Admin Router — Zentraler Admin-Bereich
 * 
 * Admin-Routen (ehemals SuperAdmin-Plugin).
 * Alle Routen unter /admin/* (ohne Guild-Kontext).
 * Zugriff nur für Bot-Owner (admin.middleware.js).
 *
 * @author FireBot Team
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { Router } = require('express');
const { ServiceManager } = require('dunebot-core');

const router = Router();

// ================================================================
// MIDDLEWARE: Guild-Layout für alle Admin-Routen setzen
// (Schutz gegen Frontend-Router, der res.locals.layout = frontend setzt)
// ================================================================
router.use((req, res, next) => {
    const themeManager = ServiceManager.get('themeManager');
    res.locals.layout = themeManager.getLayout('guild');
    next();
});

// ================================================================
// HELPER: Global Stats
// ================================================================

async function getGlobalStats(dbService) {
    const Logger = ServiceManager.get('Logger');
    const stats = {};

    const guilds = await dbService.query('SELECT COUNT(*) as count FROM guilds');
    stats.guilds = guilds[0]?.count || 0;

    const users = await dbService.query('SELECT COUNT(*) as count FROM users');
    stats.users = users[0]?.count || 0;

    const news = await dbService.query('SELECT COUNT(*) as count FROM news');
    stats.news = news[0]?.count || 0;

    const notifications = await dbService.query('SELECT COUNT(*) as count FROM notifications');
    stats.notifications = notifications[0]?.count || 0;

    try {
        stats.topGuilds = await dbService.query(`
            SELECT _id, _id AS guild_id, guild_name, created_at
            FROM guilds ORDER BY created_at DESC LIMIT 10
        `);
    } catch (err) {
        Logger.error('[Admin] Fehler beim Laden der Top-Guilds:', err);
        stats.topGuilds = [];
    }

    try {
        const newsResults = await dbService.query(`
            SELECT _id, title_translations, author, status, date, created_at
            FROM news ORDER BY date DESC LIMIT 10
        `);
        stats.recentNews = newsResults.map(n => {
            let title = 'Kein Titel';
            if (n.title_translations) {
                try {
                    const t = typeof n.title_translations === 'string'
                        ? JSON.parse(n.title_translations) : n.title_translations;
                    title = t['de-DE'] || t['en-GB'] || 'Kein Titel';
                } catch (_) {}
            }
            return { ...n, title };
        });
    } catch (err) {
        Logger.error('[Admin] Fehler beim Laden der News:', err);
        stats.recentNews = [];
    }

    try {
        const pluginStats = await dbService.query(`
            SELECT plugin_name, COUNT(DISTINCT guild_id) as guild_count
            FROM guild_plugins WHERE is_enabled = 1
            GROUP BY plugin_name
        `);
        const totalGuilds = (await dbService.query(
            'SELECT COUNT(DISTINCT guild_id) as count FROM guild_plugins WHERE is_enabled = 1'
        ))[0]?.count || 0;

        stats.pluginStats = Object.fromEntries(
            pluginStats.map(r => [r.plugin_name, r.guild_count])
        );
        stats.pluginStats = pluginStats
            .map(({ plugin_name: name, guild_count: count }) => ({
                name, count,
                percentage: totalGuilds > 0 ? Math.round((count / totalGuilds) * 100) : 0
            }))
            .sort((a, b) => b.count - a.count);
    } catch (err) {
        Logger.error('[Admin] Fehler beim Laden der Plugin-Statistiken:', err);
        stats.pluginStats = [];
    }

    return stats;
}

// ================================================================
// DASHBOARD (Übersicht)
// ================================================================

router.get('/', async (req, res) => {
    const themeManager = ServiceManager.get('themeManager');
    const dbService = ServiceManager.get('dbService');
    const pluginManager = ServiceManager.get('pluginManager');

    try {
        const stats = await getGlobalStats(dbService);

        // Widgets einsammeln — Plugins können sich über denselben Filter
        // danebenstellen, wie sie es beim Guild-Dashboard längst tun.
        let widgets = [];
        if (pluginManager?.hooks) {
            widgets = await pluginManager.hooks.applyFilter(
                'admin_dashboard_widgets', [], { req, res, stats, user: req.session?.user || null }
            );
        }

        const { getInstance: getWidgetManager } = require('dunebot-sdk/lib/WidgetManager');
        const widgetManager = getWidgetManager();

        res.locals.renderWidgetArea = (areaId) =>
            widgetManager.getWidgetsForArea(areaId, widgets, []);

        await themeManager.renderView(res, 'admin/dashboard', {
            title: 'Admin Dashboard',
            activeMenu: '/admin',
            stats,
            widgets
        });
    } catch (error) {
        ServiceManager.get('Logger').error('[Admin] Fehler beim Dashboard:', error);
        res.status(500).render('error', { message: 'Fehler beim Laden des Dashboards', error });
    }
});

// ================================================================
// STATISTIKEN
// ================================================================

router.get('/stats', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const themeManager = ServiceManager.get('themeManager');
    const dbService = ServiceManager.get('dbService');

    try {
        const stats = await getGlobalStats(dbService);
        await themeManager.renderView(res, 'admin/stats', {
            title: 'System Statistiken',
            activeMenu: '/admin/stats',
            stats,
            topGuilds: stats.topGuilds || [],
            recentNews: stats.recentNews || [],
            pluginStats: stats.pluginStats || []
        });
    } catch (error) {
        Logger.error('[Admin] Fehler bei /stats:', error);
        res.status(500).render('error', { message: 'Fehler beim Laden der Statistiken', error });
    }
});

// ================================================================
// USER FEEDBACK VERWALTUNG
// ================================================================

router.get('/feedback', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const themeManager = ServiceManager.get('themeManager');
    const dbService = ServiceManager.get('dbService');

    try {
        const feedbackList = await dbService.query(`
            SELECT uf.*, g.guild_name
            FROM user_feedback uf
            LEFT JOIN guilds g ON g._id = uf.guild_id
            ORDER BY uf.created_at DESC
        `);
        await themeManager.renderView(res, 'admin/feedback-management', {
            title: 'User Feedback Verwaltung',
            activeMenu: '/admin/feedback',
            feedbackList: feedbackList || []
        });
    } catch (error) {
        Logger.error('[Admin] Fehler beim Laden des User Feedbacks:', error);
        res.status(500).render('error', { message: 'Fehler beim Laden des User Feedbacks', error });
    }
});

router.post('/feedback/:id/update', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const { status, priority, admin_notes, admin_response } = req.body;

    try {
        const updates = [];
        const values = [];

        if (status) { updates.push('status = ?'); values.push(status); }
        if (priority) { updates.push('priority = ?'); values.push(priority); }
        if (admin_notes !== undefined) { updates.push('admin_notes = ?'); values.push(admin_notes); }
        if (admin_response !== undefined) { updates.push('admin_response = ?'); values.push(admin_response); }

        if (status === 'resolved' || status === 'implemented') {
            updates.push('resolved_at = NOW()');
            updates.push('resolved_by = ?');
            values.push(req.session.user?.info?.username || 'Admin');
        }

        values.push(req.params.id);
        await dbService.query(
            `UPDATE user_feedback SET ${updates.join(', ')} WHERE id = ?`,
            values
        );
        res.json({ success: true, message: 'Feedback erfolgreich aktualisiert' });
    } catch (error) {
        Logger.error('[Admin] Fehler beim Aktualisieren des Feedbacks:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

router.delete('/feedback/:id', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    try {
        await dbService.query('DELETE FROM user_feedback WHERE id = ?', [req.params.id]);
        res.json({ success: true, message: 'Feedback erfolgreich gelöscht' });
    } catch (error) {
        Logger.error('[Admin] Fehler beim Löschen des Feedbacks:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ================================================================
// PLUGIN BADGE MANAGEMENT
// ================================================================

router.get('/plugin-badges', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const themeManager = ServiceManager.get('themeManager');
    const dbService = ServiceManager.get('dbService');

    try {
        const badges = await dbService.getAllPluginBadges();
        const pluginsDir = path.join(__dirname, '../../../plugins');
        const availablePlugins = fs.readdirSync(pluginsDir, { withFileTypes: true })
            .filter(d => d.isDirectory() && d.name !== 'node_modules' && !d.name.startsWith('.'))
            .map(d => d.name)
            .sort();

        await themeManager.renderView(res, 'admin/plugin-badges', {
            title: 'Plugin Badge Management',
            activeMenu: '/admin/plugin-badges',
            badges,
            availablePlugins
        });
    } catch (error) {
        Logger.error('[Admin] Fehler beim Laden der Plugin-Badges:', error);
        res.status(500).send('Fehler beim Laden der Plugin-Badges');
    }
});

router.post('/plugin-badges', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const { pluginName, badgeStatus, badgeUntil, isFeatured } = req.body;

    try {
        if (!pluginName || !badgeStatus) {
            return res.status(400).json({ success: false, message: 'Plugin-Name und Badge-Status sind erforderlich' });
        }
        await dbService.setPluginBadge(pluginName, badgeStatus, badgeUntil || null, isFeatured === '1' || isFeatured === true);
        res.json({ success: true, message: `Badge für Plugin "${pluginName}" erfolgreich gesetzt` });
    } catch (error) {
        Logger.error('[Admin] Fehler beim Setzen des Plugin-Badges:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

router.delete('/plugin-badges/:pluginName', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    try {
        await dbService.removePluginBadge(req.params.pluginName);
        res.json({ success: true, message: `Badge für Plugin "${req.params.pluginName}" erfolgreich entfernt` });
    } catch (error) {
        Logger.error('[Admin] Fehler beim Entfernen des Plugin-Badges:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ================================================================
// FIREBUS: KONTROLLE
// ================================================================

router.get('/firebus', async (req, res) => {
    const themeManager = ServiceManager.get('themeManager');
    const dbService = ServiceManager.get('dbService');
    const Logger = ServiceManager.get('Logger');

    try {
        const zeilen = await dbService.query(
            `SELECT daemon_id, name, grund, SUM(anzahl) AS anzahl, MAX(zuletzt) AS zuletzt
               FROM firebus_kontrolle
              GROUP BY daemon_id, name, grund
              ORDER BY zuletzt DESC
              LIMIT 200`);
        // In JavaScript, nicht per JOIN: Die Kollationen von Kern und Plugin passen nicht.
        const maschinen = await dbService.query('SELECT daemon_id, name FROM rootserver');
        const namen = new Map(maschinen.map(m => [m.daemon_id, m.name]));

        await themeManager.renderView(res, 'admin/firebus', {
            title: 'FireBus: Kontrolle',
            activeMenu: '/admin/firebus',
            zeilen: zeilen.map(z => ({ ...z, maschine: namen.get(z.daemon_id) || z.daemon_id })),
            gruende: require('../helpers/FireBusKontrolle').GRUENDE,
            fassung: require('../../../packages/firebus').fassung,
            // Die Tür prüft seit Paket 4 nach dem Fahrplan des Bahnhofs, nicht nach dem hier.
            bahnhof: ServiceManager.has('ipmServer') ? (ServiceManager.get('ipmServer').dock?.bahnhof || null) : null,
        });
    } catch (error) {
        Logger.error('[Admin] FireBus-Kontrolle nicht lesbar:', error);
        res.status(500).send('Die Kontrolle ließ sich nicht lesen.');
    }
});

// ================================================================
// FACHEREIGNISSE: ZUSTELLER (G-02)
// Liegengebliebenes erneut zustellen, Probe über den Bot.
// ================================================================

router.get('/ereignisse', async (req, res) => {
    const themeManager = ServiceManager.get('themeManager');
    const Logger = ServiceManager.get('Logger');
    try {
        const stand = ServiceManager.has('ereignisZusteller')
            ? await ServiceManager.get('ereignisZusteller').stand()
            : null;
        await themeManager.renderView(res, 'admin/ereignisse', {
            title: 'Fachereignisse',
            activeMenu: '/admin/ereignisse',
            stand,
            kontrollGuild: process.env.CONTROL_GUILD_ID || '',
        });
    } catch (error) {
        Logger.error('[Admin] Fachereignisse nicht lesbar:', error);
        res.status(500).send('Der Stand des Zustellers ließ sich nicht lesen.');
    }
});

router.post('/ereignisse/erneut', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    if (!ServiceManager.has('ereignisZusteller')) return res.status(503).json({ success: false, message: 'Der Zusteller läuft nicht.' });
    try {
        const ids = req.body?.alle === true ? null : req.body?.ids;
        if (ids !== null && !Array.isArray(ids)) return res.status(400).json({ success: false, message: 'Keine Quittung gewählt.' });
        const n = await ServiceManager.get('ereignisZusteller').erneut(ids);
        res.json({ success: true, anzahl: n, message: n ? `${n} Quittung(en) werden erneut zugestellt.` : 'Nichts lag mehr.' });
    } catch (error) {
        Logger.error('[Admin] Erneut zustellen gescheitert:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

router.post('/ereignisse/probe', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const guildId = process.env.CONTROL_GUILD_ID;
    if (!guildId) return res.status(500).json({ success: false, message: 'CONTROL_GUILD_ID fehlt.' });
    try {
        const huelle = await ServiceManager.get('ipcServer').broadcastOne('dashboard:EREIGNIS_PROBE', {
            guild_id: guildId,
            verzoegerung_s: Number(req.body?.verzoegerung_s) || 0,
            doppelt: req.body?.doppelt === true,
        }, true, { timeout: 10_000 });
        // Kern-Handler im Bot antworten in der Hülle `{ success, data }`.
        if (!huelle?.success) {
            return res.status(502).json({ success: false, message: `Der Bot hat nicht gemeldet: ${huelle?.error || 'keine Antwort'}` });
        }
        const d = huelle.data || {};
        const message = d.verzoegerung_s
            ? `Der Bot meldet ${d.schluessel} in ${d.verzoegerung_s} s.`
            : `Der Bot hat ${d.schluessel} gemeldet: ${(d.ergebnisse || []).map(e => `#${e.id} ${e.neu ? 'neu' : 'doppelt'}`).join(', ')}.`;
        res.json({ success: true, message, ergebnis: d });
    } catch (error) {
        Logger.error('[Admin] Probe der Fachereignisse gescheitert:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ================================================================
// ZEITPLAN-REGISTER (G-06)
// Stand je Aufgabe, von Hand ausführen, gestrichene Zeilen vergessen.
// ================================================================

router.get('/zeitplan', async (req, res) => {
    const themeManager = ServiceManager.get('themeManager');
    const Logger = ServiceManager.get('Logger');
    try {
        const aufgaben = ServiceManager.has('zeitplan') ? await ServiceManager.get('zeitplan').stand() : null;
        await themeManager.renderView(res, 'admin/zeitplan', {
            title: 'Zeitplan',
            activeMenu: '/admin/zeitplan',
            aufgaben,
        });
    } catch (error) {
        Logger.error('[Admin] Zeitplan nicht lesbar:', error);
        res.status(500).send('Der Stand des Zeitplans ließ sich nicht lesen.');
    }
});

router.post('/zeitplan/jetzt', (req, res) => {
    const Logger = ServiceManager.get('Logger');
    if (!ServiceManager.has('zeitplan')) return res.status(503).json({ success: false, message: 'Der Zeitplan läuft nicht.' });
    const name = String(req.body?.name || '');
    try {
        const r = ServiceManager.get('zeitplan').jetzt(name);
        if (!r.gestartet) return res.status(409).json({ success: false, message: `${name} läuft schon seit ${r.seit.toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}.` });
        Logger.info(`[Admin] Zeitplan: ${name} von Hand gestartet`);
        res.json({ success: true, message: `${name} läuft. Das Ergebnis steht nach dem Neuladen in der Tabelle.` });
    } catch (error) {
        res.status(404).json({ success: false, message: error.message });
    }
});

router.post('/zeitplan/vergessen', async (req, res) => {
    if (!ServiceManager.has('zeitplan')) return res.status(503).json({ success: false, message: 'Der Zeitplan läuft nicht.' });
    const name = String(req.body?.name || '');
    try {
        const weg = await ServiceManager.get('zeitplan').vergessen(name);
        res.json({ success: true, message: weg ? `Zeile ${name} entfernt.` : 'Die Zeile war schon weg.' });
    } catch (error) {
        res.status(409).json({ success: false, message: error.message });
    }
});

// ================================================================
// BILDKARTEN (G-10)
// Jede Vorlage mit Beispielwerten gezeichnet, in der Palette der
// Kontroll-Guild, mit Zeit und Größe. Ein Name zum Testen von Emoji und
// Schriften ersetzt den Anzeigenamen des Beispiel-Mitglieds.
// ================================================================

router.get('/bildkarten', async (req, res) => {
    const themeManager = ServiceManager.get('themeManager');
    const { Bildkarte } = require('dunebot-sdk');
    const guildId = String(process.env.CONTROL_GUILD_ID || '');
    const testname = String(req.query.name || '').slice(0, 64);
    const sprache = req.query.sprache === 'en-GB' ? 'en-GB' : 'de-DE';
    const nutzer = { ...(req.session.user?.info || {}) };
    if (testname) nutzer.global_name = testname;
    const karten = [];
    let guildName = '';
    try {
        const zeilen = await ServiceManager.get('dbService').query('SELECT guild_name FROM guilds WHERE _id = ?', [guildId]);
        guildName = zeilen?.[0]?.guild_name || '';
    } catch { /* ohne Namen */ }
    for (const name of Bildkarte.liste()) {
        try {
            const v = Bildkarte.vorlage(name);
            const k = await Bildkarte.beispiel(name, { guildId, guildName, nutzer, sprache });
            karten.push({
                name, titel: v.titel || name, breite: v.breite, hoehe: v.hoehe, ebenen: v.ebenen.length,
                werte: (v.werte || []).map((w) => w.name),
                ms: k.ms, bytes: k.bytes, typ: k.typ, hinweise: k.hinweise,
                bild: `data:image/${k.typ};base64,${k.puffer.toString('base64')}`,
            });
        } catch (err) {
            karten.push({ name, fehler: err.message });
        }
    }
    await themeManager.renderView(res, 'admin/bildkarten', {
        title: 'Bildkarten',
        activeMenu: '/admin/bildkarten',
        karten, schriften: Bildkarte.schriftStand(), testname, sprache, guildName,
        grenzeBytes: Bildkarte.PNG_MAX_BYTES,
    });
});

// ================================================================
// AUFBEWAHRUNG (G-05)
// Fristen aller Plugins, Obergrenze des Betreibers, Probelauf.
// ================================================================

router.get('/aufbewahrung', async (req, res) => {
    const themeManager = ServiceManager.get('themeManager');
    const Logger = ServiceManager.get('Logger');
    try {
        const Aufbewahrung = require('../helpers/Aufbewahrung');
        const fristen = await Aufbewahrung.stand();
        await themeManager.renderView(res, 'admin/aufbewahrung', {
            title: 'Aufbewahrung',
            activeMenu: '/admin/aufbewahrung',
            fristen,
            eingetragen: ServiceManager.has('aufbewahrung'),
            takt: Aufbewahrung.TAKT,
            tageMax: Aufbewahrung.TAGE_MAX,
        });
    } catch (error) {
        Logger.error('[Admin] Aufbewahrung nicht lesbar:', error);
        res.status(500).send(`Die Fristen ließen sich nicht lesen: ${error.message}`);
    }
});

router.post('/aufbewahrung/grenze', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const plugin = String(req.body?.plugin || '');
    const name = String(req.body?.name || '');
    try {
        const r = await require('../helpers/Aufbewahrung').setzeGrenze(plugin, name, req.body?.tage);
        if (!r.ok) return res.status(400).json({ success: false, message: r.grund });
        Logger.info(`[Admin] Aufbewahrung ${plugin}:${name}: Obergrenze ${r.obergrenze} Tage`);
        res.json({ success: true, message: `${plugin}:${name}: höchstens ${r.obergrenze} Tage.` });
    } catch (error) {
        Logger.error('[Admin] Obergrenze nicht gespeichert:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

router.post('/aufbewahrung/probe', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    try {
        const r = await require('../helpers/Aufbewahrung').laufen({ trocken: true });
        res.json({ success: true, ergebnis: r, message: r.zeilen ? `Heute Nacht gingen ${r.zeilen} Zeile(n).` : 'Heute Nacht ginge nichts.' });
    } catch (error) {
        Logger.error('[Admin] Probelauf der Aufbewahrung gescheitert:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ================================================================
// WARTUNGSSEITE
// Geschaltet wird hier, ausgeliefert vom Apache (helpers/Wartung.js).
// ================================================================

router.get('/wartung', async (req, res) => {
    const themeManager = ServiceManager.get('themeManager');
    const Wartung = require('../helpers/Wartung');
    await themeManager.renderView(res, 'admin/wartung', {
        title: 'Wartungsseite',
        activeMenu: '/admin/wartung',
        wartung: Wartung.stand(),
        maxText: Wartung.MAX_TEXT,
    });
});

/** Die Seite, wie der Apache sie zeigen würde, mit dem Text aus dem Formular. */
router.post('/wartung/vorschau', (req, res) => {
    try {
        res.type('html').send(require('../helpers/Wartung').baue(req.body));
    } catch (error) {
        res.status(error.status || 500).type('text').send(error.message);
    }
});

router.post('/wartung', (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const info = req.session?.user?.info || {};
    const wer = info.username ? `${info.username} (${info.id})` : String(info.id || 'unbekannt');
    try {
        const stand = require('../helpers/Wartung').setze(req.body, req.body?.an === true, wer);
        res.json({ success: true, wartung: stand });
    } catch (error) {
        if (!error.status) Logger.error('[Wartung] Nicht geschaltet:', error);
        res.status(error.status || 500).json({ success: false, message: error.message });
    }
});

// ================================================================
// TOAST-HISTORY
// ================================================================

router.get('/toast-history', async (req, res) => {
    const themeManager = ServiceManager.get('themeManager');
    await themeManager.renderView(res, 'admin/toast-history', {
        title: 'Toast-Event History',
        activeMenu: '/admin/toast-history'
    });
});

// ================================================================
// DONATIONS & ADDONS (migriert aus SuperAdmin → Kern)
// ================================================================

const donationsRouter = require('./admin/donations.router');
router.use('/donations', donationsRouter);

const addonsRouter = require('./admin/addons.router');
router.use('/addons', addonsRouter);

const themesRouter = require('./admin/themes.router');
router.use('/themes', themesRouter);

// Wissensdatenbank (2026-10-11) — ersetzt den Datei-Editor /admin/docs, der
// Markdown in `documentation/` schrieb. Die alte Adresse führt in die neue
// Verwaltung, damit ein Lesezeichen nicht auf einer 404 endet.
const kbRouter = require('./admin/kb.router');
router.use('/kb', kbRouter);
router.use('/docs', (req, res) => res.redirect(301, '/admin/kb'));

const contentRouter = require('./admin/content.router');
router.use('/content', contentRouter);

// Konten, die der Anlage gehoeren (Stufe 13a) — Chatbot-Konto und was noch
// folgt. Gehoert unter /admin, weil es fuer den ganzen Betrieb gilt und an
// keinem Menschen haengen darf.
const anlagenkontenRouter = require('./admin/anlagenkonten.router');
router.use('/anlagenkonten', anlagenkontenRouter);

module.exports = router;
