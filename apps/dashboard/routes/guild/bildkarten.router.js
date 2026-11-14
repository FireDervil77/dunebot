/**
 * Kern-Bereich „Bildkarten“ je Guild (G-21, G-22, F-G11, K382, 2026-11-14).
 *
 * Routes: /guild/:guildId/bildkarten/*
 *
 *   GET /                              → jede Karte dieser Guild: Schablonen des Kerns
 *                                        und Karten eingeschalteter Plugins, dazu wo sie
 *                                        benutzt wird
 *   GET /bild/:name                    → die Karte als Bild, mit dem angemeldeten Nutzer
 *                                        als Mitglied, in den Farben der Guild (G-09), so
 *                                        eingestellt, wie der Bot sie hier zeichnet
 *   GET /einstellen/:plugin/:karte     → Einstellseite einer Nutzung (G-22)
 *   GET /einstellen/:plugin/:karte/vorschau?e=JSON
 *                                      → Bild mit den Werten aus dem Formular, nicht gespeichert
 *   PUT /einstellen/:plugin/:karte     → speichern { vorlage, werte } (CORE.BILDKARTEN.EDIT,
 *                                        in der Kontroll-Guild nur deren Besitzer)
 *
 * Wo eine Karte benutzt wird, erklärt das Plugin in seiner package.json unter
 * `bildkarten` (`Bildkarte.nutzungen`). Ein Plugin, das in dieser Guild aus
 * ist, zeigt weder seine Karten noch seine Nutzung von Kern-Schablonen.
 * Eine Nutzung steht unter der Schablone, die die Guild gewählt hat.
 *
 * Eingestellt wird nur hier (F-G11 Punkt 2); Plugins verweisen her. Prüfen,
 * Speichern und Zeichnen macht `Bildkarte` im SDK, dieselbe Rechnung wie im Bot.
 * `/admin/bildkarten` bleibt die Betreiberseite (Schriften, Zeiten, alle Karten).
 *
 * Wächter: scripts/check-bildkarten.js (12, 13)
 */

'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router({ mergeParams: true });
const { ServiceManager } = require('dunebot-core');
const { Bildkarte } = require('dunebot-sdk');
const { requirePermission, requireBesitzerInKontrollGuild, istKontrollGuildGesperrt } = require('../../middlewares/permissions.middleware');
const { csrfProtection } = require('../../middlewares/security/csrf-protection.middleware');

const PLUGINS = path.join(__dirname, '..', '..', '..', '..', 'plugins');

/** Anzeigename eines Plugins aus seiner package.json. */
function pluginName(plugin) {
    try {
        return JSON.parse(fs.readFileSync(path.join(PLUGINS, plugin, 'package.json'), 'utf8')).displayName || plugin;
    } catch {
        return plugin;
    }
}

/** Gibt es an dieser Nutzung etwas einzustellen? */
function hatEinstellbares(nutzung) {
    const schablonen = nutzung.schablonen || [nutzung.karte];
    if (schablonen.length > 1) return true;
    return schablonen.some((s) => {
        try { return Bildkarte.einstellbar(Bildkarte.vorlage(s)).length > 0; } catch { return false; }
    });
}

/** Plugins, die in der Guild an sind. */
async function eingeschaltet(guildId) {
    return new Set((await ServiceManager.get('dbService').query(
        'SELECT plugin_name FROM guild_plugins WHERE guild_id = ? AND is_enabled = 1',
        [guildId]
    ) || []).map((z) => z.plugin_name));
}

/**
 * Die Karten, die diese Guild sieht, mit ihren Nutzungen. Eine Nutzung steht
 * unter der Schablone, die die Guild für sie gewählt hat.
 * @param {string} guildId
 * @returns {Promise<Array<{name: string, besitzer: string, titel: string|null, nutzungen: Array}>>}
 */
async function kartenDerGuild(guildId) {
    const dbService = ServiceManager.get('dbService');
    const an = await eingeschaltet(guildId);
    const gewaehlt = new Map((await dbService.query(
        'SELECT plugin, karte, vorlage FROM guild_bildkarten WHERE guild_id = ? AND vorlage IS NOT NULL',
        [guildId]
    ) || []).map((z) => [`${z.plugin}|${z.karte}`, z.vorlage]));
    const { karten } = Bildkarte.nutzungen();
    const sichtbar = Bildkarte.liste().filter((name) => {
        const besitzer = name.split(':')[0];
        return besitzer === 'kern' || an.has(besitzer);
    });
    const unter = new Map(sichtbar.map((name) => [name, []]));
    for (const [karte, liste] of karten) {
        for (const n of liste) {
            if (!an.has(n.plugin)) continue;
            const wahl = gewaehlt.get(`${n.plugin}|${karte}`);
            const ziel = wahl && (n.schablonen || []).includes(wahl) && unter.has(wahl) ? wahl : karte;
            if (!unter.has(ziel)) continue;
            unter.get(ziel).push({ ...n, karte, pluginName: pluginName(n.plugin), einstellbar: hatEinstellbares({ ...n, karte }) });
        }
    }
    return sichtbar.map((name) => {
        const besitzer = name.split(':')[0];
        const eigene = (karten.get(name) || []).find((n) => n.plugin === besitzer);
        return { name, besitzer, besitzerName: besitzer === 'kern' ? null : pluginName(besitzer), titel: eigene?.titel || null, nutzungen: unter.get(name) };
    });
}

/** Sprache der Guild wie im Bot (`guild.locale` = core `LOCALE`). */
async function spracheDerGuild(guildId) {
    const zeilen = await ServiceManager.get('dbService').query(
        "SELECT config_value FROM configs WHERE plugin_name = 'core' AND config_key = 'LOCALE' AND guild_id = ? AND context = 'shared'",
        [guildId]
    );
    return zeilen?.[0]?.config_value || 'de-DE';
}

/** Sprache der Seite für Titel aus der Vorlage und Meldungen. */
function seitenSprache(res) {
    return String(res.locals.locale || 'de-DE').toLowerCase().startsWith('de') ? 'de' : 'en';
}

async function guildName(guildId) {
    const zeilen = await ServiceManager.get('dbService').query('SELECT guild_name FROM guilds WHERE _id = ?', [guildId]);
    return zeilen?.[0]?.guild_name || '';
}

/**
 * Die Nutzung aus der Adresse, nur wenn das Plugin in der Guild an ist.
 * @returns {Promise<Object|null>}
 */
async function nutzungAusAdresse(req, guildId) {
    const plugin = String(req.params.plugin || '');
    const karte = String(req.params.karte || '');
    const n = (Bildkarte.nutzungen().karten.get(karte) || []).find((x) => x.plugin === plugin);
    if (!n) return null;
    if (!(await eingeschaltet(guildId)).has(plugin)) return null;
    return n;
}

// GET /bildkarten
router.get('/', requirePermission('CORE.BILDKARTEN.VIEW'), async (req, res) => {
    const guildId = res.locals.guildId;
    const Logger = ServiceManager.get('Logger');
    try {
        const karten = await kartenDerGuild(guildId);
        for (const k of karten) {
            for (const n of k.nutzungen) Object.assign(n, await Bildkarte.nutzungStand(n, guildId));
            try {
                const v = Bildkarte.vorlage(k.name);
                k.breite = v.breite;
                k.hoehe = v.hoehe;
            } catch (err) {
                k.fehler = err.message;
            }
        }
        await ServiceManager.get('themeManager').renderView(res, 'guild/bildkarten', {
            title: 'Bildkarten',
            activeMenu: `/guild/${guildId}/bildkarten`,
            guildId,
            karten,
        });
    } catch (err) {
        Logger.error(`[Bildkarten] Übersicht in ${guildId}:`, err);
        res.status(500).send('Die Bildkarten konnten nicht geladen werden.');
    }
});

// GET /bildkarten/bild/:name
router.get('/bild/:name', requirePermission('CORE.BILDKARTEN.VIEW'), async (req, res) => {
    const guildId = res.locals.guildId;
    const name = String(req.params.name || '');
    try {
        const karte = (await kartenDerGuild(guildId)).find((k) => k.name === name);
        if (!karte) return res.status(404).type('text').send('Diese Karte gibt es auf diesem Server nicht.');
        const allgemein = { guildId, guildName: await guildName(guildId), nutzer: req.session.user.info, sprache: await spracheDerGuild(guildId) };
        const n = karte.nutzungen[0];
        let bild;
        if (n) {
            const s = await Bildkarte.nutzungStand(n, guildId);
            bild = await Bildkarte.beispielNutzung(n.plugin, n.karte, { ...allgemein, werte: s.werte || undefined });
        } else {
            bild = await Bildkarte.beispiel(name, allgemein);
        }
        res.set('Cache-Control', 'no-store');
        res.type(bild.typ === 'png' ? 'png' : 'jpeg').send(bild.puffer);
    } catch (err) {
        ServiceManager.get('Logger').error(`[Bildkarten] Bild ${name} in ${guildId}:`, err);
        res.status(500).type('text').send(err.message);
    }
});

/**
 * Felder der Einstellseite: jeder einstellbare Wert aller wählbaren
 * Schablonen, mit dem Wert, den die Guild jetzt hat (Bild als Adresse).
 */
function seitenFelder(nutzung, e, sprache) {
    const felder = new Map();
    const schablonen = [];
    const vorschlaege = [];
    for (const name of nutzung.schablonen) {
        const v = Bildkarte.vorlage(name);
        schablonen.push({ name, titel: v.titel || name, breite: v.breite, hoehe: v.hoehe });
        for (const w of Bildkarte.einstellbar(v)) {
            if (!felder.has(w.name)) {
                let wert = w.beispiel;
                if (name === e.vorlage) wert = e.werte[w.name] ?? w.beispiel;
                else if (w.name in e.gespeichert.werte && w.einstellbar !== 'bild') wert = e.gespeichert.werte[w.name];
                felder.set(w.name, { name: w.name, art: w.einstellbar, titel: w.titel[sprache] || w.titel.de, vorgabe: w.beispiel, wert, vorlagen: [] });
            }
            felder.get(w.name).vorlagen.push(name);
        }
        for (const s of v.vorschlaege || []) vorschlaege.push({ vorlage: name, titel: s.titel[sprache] || s.titel.de, werte: s.werte });
    }
    return { felder: [...felder.values()], schablonen, vorschlaege };
}

// GET /bildkarten/einstellen/:plugin/:karte
router.get('/einstellen/:plugin/:karte', requirePermission('CORE.BILDKARTEN.VIEW'), async (req, res) => {
    const guildId = res.locals.guildId;
    const Logger = ServiceManager.get('Logger');
    try {
        const n = await nutzungAusAdresse(req, guildId);
        if (!n) return res.status(404).send('Diese Karte gibt es auf diesem Server nicht.');
        const sprache = seitenSprache(res);
        const e = await Bildkarte.einstellung(n.plugin, n.karte, guildId);
        const stand = await Bildkarte.nutzungStand(n, guildId);
        const userId = req.session.user?.info?.id;
        const gesperrt = await istKontrollGuildGesperrt(guildId, userId);
        const hat = await ServiceManager.get('permissionManager').hasPermission(userId, guildId, 'CORE.BILDKARTEN.EDIT');
        await ServiceManager.get('themeManager').renderView(res, 'guild/bildkarte-einstellen', {
            title: 'Bildkarten',
            activeMenu: `/guild/${guildId}/bildkarten`,
            guildId,
            nutzung: { ...n, pluginName: pluginName(n.plugin), an: stand.an },
            gewaehlt: e.vorlage,
            hinweise: e.hinweise,
            ...seitenFelder(n, e, sprache),
            darf: Boolean(hat) && !gesperrt,
            gesperrt,
        });
    } catch (err) {
        Logger.error(`[Bildkarten] Einstellseite ${req.params.plugin}/${req.params.karte} in ${guildId}:`, err);
        res.status(500).send('Die Einstellungen der Karte konnten nicht geladen werden.');
    }
});

/** Eingabe aus `?e=` (Vorschau) oder dem Rumpf (Speichern). */
function eingabeAus(roh) {
    if (roh && typeof roh === 'object') return roh;
    const s = String(roh || '');
    if (s.length > 8000) throw new Bildkarte.Eingabefehler('Eingabe zu lang.');
    try { return JSON.parse(s || '{}') || {}; } catch { throw new Bildkarte.Eingabefehler('Eingabe ist kein JSON.'); }
}

// GET /bildkarten/einstellen/:plugin/:karte/vorschau?e=JSON
router.get('/einstellen/:plugin/:karte/vorschau', requirePermission('CORE.BILDKARTEN.VIEW'), async (req, res) => {
    const guildId = res.locals.guildId;
    try {
        const n = await nutzungAusAdresse(req, guildId);
        if (!n) return res.status(404).type('text').send('Diese Karte gibt es auf diesem Server nicht.');
        const g = await Bildkarte.eingabePruefen(n, guildId, eingabeAus(req.query?.e), seitenSprache(res));
        const e = await Bildkarte.einstellungAufloesen(n, guildId, g);
        const s = await Bildkarte.nutzungStand(n, guildId);
        const bild = await Bildkarte.beispielNutzung(n.plugin, n.karte, {
            guildId, guildName: await guildName(guildId), nutzer: req.session.user.info,
            sprache: await spracheDerGuild(guildId), werte: s.werte || undefined, einstellung: e,
        });
        res.set('Cache-Control', 'no-store');
        res.type(bild.typ === 'png' ? 'png' : 'jpeg').send(bild.puffer);
    } catch (err) {
        if (err instanceof Bildkarte.Eingabefehler) return res.status(400).type('text').send(err.message);
        ServiceManager.get('Logger').error(`[Bildkarten] Vorschau ${req.params.plugin}/${req.params.karte} in ${guildId}:`, err);
        res.status(500).type('text').send(err.message);
    }
});

// PUT /bildkarten/einstellen/:plugin/:karte { vorlage, werte }
router.put('/einstellen/:plugin/:karte', csrfProtection, requirePermission('CORE.BILDKARTEN.EDIT'), requireBesitzerInKontrollGuild(), async (req, res) => {
    const guildId = res.locals.guildId;
    const Logger = ServiceManager.get('Logger');
    try {
        const n = await nutzungAusAdresse(req, guildId);
        if (!n) return res.status(404).json({ success: false, message: 'Diese Karte gibt es auf diesem Server nicht.' });
        const e = await Bildkarte.speichereEinstellung(n.plugin, n.karte, guildId, eingabeAus(req.body), seitenSprache(res));
        Logger.info(`[Bildkarten] ${n.plugin}/${n.karte} in ${guildId} gespeichert (von ${req.session.user.info.id})`);
        res.json({ success: true, data: { vorlage: e.vorlage, hinweise: e.hinweise } });
    } catch (err) {
        if (err instanceof Bildkarte.Eingabefehler) return res.status(400).json({ success: false, message: err.message });
        Logger.error(`[Bildkarten] ${req.params.plugin}/${req.params.karte} in ${guildId} nicht gespeichert:`, err);
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
module.exports.kartenDerGuild = kartenDerGuild;
module.exports.seitenFelder = seitenFelder;
