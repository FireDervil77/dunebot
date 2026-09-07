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

/**
 * Welche Bedingungen der Stream-Weg pruefen kann.
 *
 * @returns {Array<Object>} Bedingungsarten der eingetragenen Quellen
 */
function streamBedingungen() {
    const { LosquellenRegistry } = require('dunebot-sdk');
    // Was der Stream-Weg pruefen kann, weiss die Quelle. Diese Seite zeigt es
    // an und speichert den Schluessel; verstehen muss sie ihn nie.
    return LosquellenRegistry.bedingungsarten();
}

/**
 * Kann diese Guild ueberhaupt aus dem Stream heraus mitmachen lassen?
 *
 * @param {string} guildId Guild
 * @returns {Promise<boolean>} true, wenn das Streaming-Plugin hier laeuft
 */
async function streamWegMoeglich(guildId) {
    const { ServiceManager } = require('dunebot-core');
    if (!ServiceManager.has('pluginManager')) return false;
    return Boolean(await ServiceManager.get('pluginManager')
        .isPluginEnabledForGuild('streaming', guildId));
}

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

    await fremdeLoseZaehlen(verlosungen);
    await streamBedingungenAnhaengen(verlosungen);
    return verlosungen;
}

/**
 * Die Stream-Bedingungen einer Verlosung als Klartext anhaengen.
 *
 * **Damit die Einstellung nach dem Anlegen nicht verschwindet.** Ohne das
 * stuende in der Uebersicht nur „Twitch-Chat" - und ob die Verlosung dort
 * jedem offensteht oder nur Abonnenten, waere nur noch in der Datenbank
 * nachlesbar.
 *
 * Der Klartext kommt aus dem Katalog der Quelle; steht dort nichts (Plugin
 * abgeschaltet), bleibt der rohe Schluessel stehen. Das ist haesslich und
 * ehrlich - besser als eine Bedingung, die unsichtbar wird, weil niemand sie
 * uebersetzen kann.
 *
 * @param {Array} verlosungen Die Verlosungen
 * @returns {Promise<void>}
 */
async function streamBedingungenAnhaengen(verlosungen) {
    const betroffen = verlosungen.filter(v => v.teilnahme === 'stream' || v.teilnahme === 'beide');
    for (const v of verlosungen) v.stream_bedingungen = [];
    if (!betroffen.length) return;

    const ids = betroffen.map(v => v.id);
    const zeilen = await ServiceManager.get('dbService').query(
        `SELECT giveaway_id, type, value FROM giveaway_requirements
          WHERE weg = 'stream' AND giveaway_id IN (${ids.map(() => '?').join(',')})`,
        ids);

    const katalog = new Map(streamBedingungen().map(b => [b.art, b]));
    for (const z of zeilen) {
        const v = betroffen.find(x => x.id === z.giveaway_id);
        if (!v) continue;
        const art = katalog.get(z.type);
        v.stream_bedingungen.push(
            art ? (art.eingabe === 'keine' ? art.label : `${art.label}: ${z.value}`)
                : `${z.type} = ${z.value}`);
    }
}

/**
 * Die Lose zaehlen, die aus einer fremden Quelle kommen.
 *
 * **Getrennt gezaehlt, nicht dazugerechnet.** `entry_count` ist die Zahl der
 * Discord-Teilnehmer und wird an mehreren Stellen so gelesen; sie still um
 * Twitch-Lose zu erhoehen hiesse, zwei verschiedene Dinge unter einem Namen zu
 * fuehren. Die Seite zeigt beide Zahlen nebeneinander.
 *
 * Ohne das zeigte eine Verlosung, an der nur im Stream mitgemacht wird,
 * dauerhaft "0 Teilnehmer" - und der Betreiber haelt sie fuer kaputt, waehrend
 * sie laeuft.
 *
 * @param {Array} verlosungen Die Verlosungen
 * @returns {Promise<void>}
 */
async function fremdeLoseZaehlen(verlosungen) {
    const { LosquellenRegistry } = require('dunebot-sdk');
    const quellen = LosquellenRegistry.list();

    for (const v of verlosungen) {
        v.lose_fremd = 0;
        if (v.teilnahme !== 'stream' && v.teilnahme !== 'beide') continue;

        for (const { name, quelle } of quellen) {
            try {
                const lose = await quelle.lose(v);
                v.lose_fremd += (lose || []).length;
            } catch (e) {
                // Eine kaputte Quelle darf die Uebersicht nicht mitnehmen -
                // dieselbe Regel wie bei der Ziehung.
                ServiceManager.get('Logger').warn(
                    `[Giveaway] Losquelle "${name}" lieferte nicht: ${e.message}`);
            }
        }
    }
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
            laufende, geplante, beendete, vorlagen, sperrliste, auswertung,
            streamWeg: await streamWegMoeglich(guildId),
            streamBedingungen: streamBedingungen()
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

        await renderView(res, 'guild/giveaway-active', {
            tr, guildId, laufende, geplante, vorlagen, channels, roles,
            streamWeg: await streamWegMoeglich(guildId),
            streamBedingungen: streamBedingungen()
        });
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
