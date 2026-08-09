/**
 * AutoMod - Seitenrouten
 *
 * Bis zum 2026-08-07 war das hier eine einzige Seite mit neun Tabs. Jetzt
 * traegt jeder Bereich eine eigene Adresse und einen eigenen Navigationspunkt:
 *
 *   /                     -> Weiterleitung auf /dashboard
 *   /dashboard            Uebersicht (Lage auf einen Blick)
 *   /filter               Inhaltsfilter und Grenzwerte
 *   /regeln               Stichwortlisten, Regex- und Kombinations-Regeln
 *   /eskalation           Stufen je Strike-Anzahl
 *   /ausnahmen            Rollen, Channels, Whitelist
 *   /raid                 Raid-Schutz
 *   /protokoll            Was der AutoMod tatsaechlich getan hat
 *   /settings             Grundeinstellungen (haengt unter Kern-Einstellungen)
 *
 * @module automod/routes/guild
 */

const express = require('express');
const router = express.Router();
const { ServiceManager, KanalTypen } = require('dunebot-core');
const { requirePermission } = require('../../../../apps/dashboard/middlewares/permissions.middleware');
const {
    AutoModSettings,
    AutoModExemptions,
    AutoModRegexRules,
    AutoModEscalation,
    AutoModCompoundRules,
    AutoModLogs,
    AutoModStrikes,
    AutoModRaidEvents,
    AutoModKeywordLists
} = require('../../shared/models');
const { TREFFERARTEN } = require('../../shared/stichwortTreffer');
const { makeTranslator, renderView, getGuildChannels, getGuildRoles, renderFehler } = require('./_shared');

/**
 * Skripte anmelden, die eine Seite braucht.
 *
 * @param {Array<string>} handles Registrierte Skript-Namen
 */
function skripteAnmelden(handles) {
    const assetManager = ServiceManager.get('assetManager');
    if (!assetManager) return;
    handles.forEach(handle => assetManager.enqueueScript(handle));
}

// =====================================================
// Hauptmenue-Punkt -> Uebersicht
// =====================================================
router.get('/', requirePermission('AUTOMOD.VIEW'), (req, res) => {
    res.redirect(`/guild/${res.locals.guildId}/plugins/automod/dashboard`);
});

// =====================================================
// Uebersicht
// =====================================================
router.get('/dashboard', requirePermission('AUTOMOD.VIEW'), async (req, res) => {
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);

    try {
        const [settings, statistik, letzteLogs, raidEreignisse, eskalation, regexRegeln, kombiRegeln] = await Promise.all([
            AutoModSettings.getSettings(guildId),
            AutoModLogs.getStats(guildId, 7).catch(() => null),
            AutoModLogs.getRecentLogs(guildId, 10).catch(() => []),
            AutoModRaidEvents.getRecentEvents(guildId, 5).catch(() => []),
            AutoModEscalation.getConfig(guildId).catch(() => []),
            AutoModRegexRules.getRules(guildId).catch(() => []),
            AutoModCompoundRules.getRules(guildId).catch(() => [])
        ]);

        // Zaehler fuer die Uebersicht. Die Stichwortlisten liegen seit dem
        // 2026-08-09 in eigenen Tabellen, nicht mehr als JSON in den
        // Einstellungen.
        const stichwortlisten = await AutoModKeywordLists.getLists(guildId).catch(() => []);

        await renderView(res, 'guild/automod-dashboard', {
            tr,
            guildId,
            settings,
            statistik,
            letzteLogs,
            raidEreignisse,
            anzahl: {
                eskalation: eskalation.length,
                regexRegeln: regexRegeln.filter(r => r.enabled).length,
                kombiRegeln: kombiRegeln.filter(r => r.enabled).length,
                stichwortlisten: stichwortlisten.filter(l => l.enabled).length
            }
        });
    } catch (error) {
        return renderFehler(res, error, 'Die AutoMod-Uebersicht konnte nicht geladen werden');
    }
});

// =====================================================
// Inhaltsfilter und Grenzwerte
// =====================================================
router.get('/filter', requirePermission('AUTOMOD.VIEW'), async (req, res) => {
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);

    try {
        const settings = await AutoModSettings.getSettings(guildId);
        skripteAnmelden(['automod-forms']);

        await renderView(res, 'guild/automod-filter', { tr, guildId, settings });
    } catch (error) {
        return renderFehler(res, error, 'Die Filter-Einstellungen konnten nicht geladen werden');
    }
});

// =====================================================
// Regeln: Stichwortlisten, Regex, Kombinationen
// =====================================================
router.get('/regeln', requirePermission('AUTOMOD.VIEW'), async (req, res) => {
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);

    try {
        const [settings, regexRegeln, kombiRegeln, guildRoles] = await Promise.all([
            AutoModSettings.getSettings(guildId),
            AutoModRegexRules.getRules(guildId).catch(() => []),
            AutoModCompoundRules.getRules(guildId).catch(() => []),
            getGuildRoles(guildId)
        ]);

        skripteAnmelden(['automod-forms', 'automod-rules']);

        await renderView(res, 'guild/automod-rules', {
            tr,
            guildId,
            settings,
            regexRules: regexRegeln,
            compoundRules: kombiRegeln,
            guildRoles,
            conditionTypes: AutoModCompoundRules.CONDITION_TYPES
        });
    } catch (error) {
        return renderFehler(res, error, 'Die Regeln konnten nicht geladen werden');
    }
});

// =====================================================
// Eskalation
// =====================================================
router.get('/eskalation', requirePermission('AUTOMOD.VIEW'), async (req, res) => {
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);

    try {
        const [settings, eskalation] = await Promise.all([
            AutoModSettings.getSettings(guildId),
            AutoModEscalation.getConfig(guildId).catch(() => [])
        ]);

        skripteAnmelden(['automod-rules']);

        await renderView(res, 'guild/automod-escalation', {
            tr,
            guildId,
            settings,
            escalationConfig: eskalation
        });
    } catch (error) {
        return renderFehler(res, error, 'Die Eskalationsstufen konnten nicht geladen werden');
    }
});

// =====================================================
// Ausnahmen
// =====================================================
router.get('/ausnahmen', requirePermission('AUTOMOD.VIEW'), async (req, res) => {
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);

    try {
        const [settings, exemptions, guildChannels, guildRoles] = await Promise.all([
            AutoModSettings.getSettings(guildId),
            AutoModExemptions.getAll(guildId).catch(() => []),
            // Auswahl, kein Ziel: alles, was moderiert wird, muss ausnehmbar
            // sein - Sprachkanaele eingeschlossen. Vorgabe der Funktion.
            getGuildChannels(guildId),
            getGuildRoles(guildId)
        ]);

        skripteAnmelden(['automod-forms', 'automod-rules']);

        await renderView(res, 'guild/automod-exemptions', {
            tr,
            guildId,
            settings,
            exemptions,
            guildChannels,
            guildRoles
        });
    } catch (error) {
        return renderFehler(res, error, 'Die Ausnahmen konnten nicht geladen werden');
    }
});

// =====================================================
// Stichwortlisten
// =====================================================
router.get('/stichwoerter', requirePermission('AUTOMOD.VIEW'), async (req, res) => {
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);

    try {
        // Beim ersten Aufruf aus den Vorlagen befuellen. Danach greift die
        // Marke `keyword_lists_seeded_at` - eine Guild, die ihre Listen bewusst
        // geloescht hat, bekommt sie nicht zurueck.
        await AutoModKeywordLists.befuelleAusVorlagen(guildId).catch(() => 0);

        const [listen, offenerAbgleich] = await Promise.all([
            AutoModKeywordLists.getLists(guildId),
            AutoModKeywordLists.vergleicheMitVorlage(guildId).catch(() => [])
        ]);

        // Die Woerter je Liste dazuholen. Bei fuenf bis zehn Listen ist das
        // billig genug, um sie in einem Rutsch anzuzeigen statt nachzuladen.
        const listenMitWoertern = [];
        for (const liste of listen || []) {
            const voll = await AutoModKeywordLists.getList(guildId, liste.id);
            if (voll) listenMitWoertern.push({ ...liste, keywords: voll.keywords });
        }

        skripteAnmelden(['automod-stichwoerter']);

        await renderView(res, 'guild/automod-stichwoerter', {
            tr,
            guildId,
            listen: listenMitWoertern,
            offenerAbgleich,
            trefferarten: TREFFERARTEN
        });
    } catch (error) {
        return renderFehler(res, error, 'Die Stichwortlisten konnten nicht geladen werden');
    }
});

// =====================================================
// Raid-Schutz
// =====================================================
router.get('/raid', requirePermission('AUTOMOD.VIEW'), async (req, res) => {
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);

    try {
        const [settings, guildChannels, raidEreignisse] = await Promise.all([
            AutoModSettings.getSettings(guildId),
            // Alarmkanal ist ein Ziel - dorthin schreibt der Bot.
            getGuildChannels(guildId, KanalTypen.BESCHREIBBARE_TYPEN),
            AutoModRaidEvents.getRecentEvents(guildId, 10).catch(() => [])
        ]);

        skripteAnmelden(['automod-forms']);

        await renderView(res, 'guild/automod-raid', {
            tr,
            guildId,
            settings,
            guildChannels,
            raidEreignisse
        });
    } catch (error) {
        return renderFehler(res, error, 'Der Raid-Schutz konnte nicht geladen werden');
    }
});

// =====================================================
// Protokoll
//
// Neu am 2026-08-07. Der Bot schreibt seit jeher in automod_logs,
// automod_strikes und automod_raid_events - im Dashboard gab es dafuer
// bis heute weder Route noch Ansicht, und AUTOMOD.LOGS.VIEW bewachte nichts.
// =====================================================
router.get('/protokoll', requirePermission('AUTOMOD.LOGS.VIEW'), async (req, res) => {
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);

    const tage = Math.min(Math.max(parseInt(req.query.tage, 10) || 7, 1), 90);

    try {
        const [statistik, logs, strikes, raidEreignisse, raidStatistik, guildRoles] = await Promise.all([
            AutoModLogs.getStats(guildId, tage).catch(() => null),
            AutoModLogs.getRecentLogs(guildId, 100).catch(() => []),
            AutoModStrikes.getTopStrikes(guildId, 25).catch(() => []),
            AutoModRaidEvents.getRecentEvents(guildId, 50).catch(() => []),
            AutoModRaidEvents.getEventStats(guildId).catch(() => null),
            getGuildRoles(guildId)
        ]);

        skripteAnmelden(['automod-logs']);

        await renderView(res, 'guild/automod-logs', {
            tr,
            guildId,
            tage,
            statistik,
            logs,
            strikes,
            raidEreignisse,
            raidStatistik,
            guildRoles
        });
    } catch (error) {
        return renderFehler(res, error, 'Das Protokoll konnte nicht geladen werden');
    }
});

// =====================================================
// Grundeinstellungen
//
// Bleibt bewusst unter den Kern-Einstellungen haengen: ein Plugin darf seine
// Einstellungsseite dort einhaengen, auch wenn es einen eigenen Bereich hat.
// =====================================================
router.get('/settings', requirePermission('AUTOMOD.VIEW'), async (req, res) => {
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);

    try {
        const [settings, guildChannels] = await Promise.all([
            AutoModSettings.getSettings(guildId),
            // Log-Kanal ist ein Ziel - dorthin schreibt der Bot.
            getGuildChannels(guildId, KanalTypen.BESCHREIBBARE_TYPEN)
        ]);

        skripteAnmelden(['automod-forms']);

        await renderView(res, 'guild/automod-settings', { tr, guildId, settings, guildChannels });
    } catch (error) {
        return renderFehler(res, error, 'Die AutoMod-Einstellungen konnten nicht geladen werden');
    }
});

module.exports = router;
