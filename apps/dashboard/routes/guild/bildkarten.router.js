/**
 * Kern-Bereich „Bildkarten“ je Guild (G-21, F-G11, K382, 2026-11-14).
 *
 * Routes: /guild/:guildId/bildkarten/*
 *
 *   GET /               → jede Karte dieser Guild: Schablonen des Kerns und die
 *                         Karten eingeschalteter Plugins, dazu wo sie benutzt wird
 *   GET /bild/:name     → die Karte als Bild, mit dem angemeldeten Nutzer als
 *                         Mitglied, in den Farben der Guild (G-09) und mit den
 *                         Werten, mit denen der Bot sie hier zeichnet
 *
 * Wo eine Karte benutzt wird, erklärt das Plugin in seiner package.json unter
 * `bildkarten` (`Bildkarte.nutzungen`). Ein Plugin, das in dieser Guild aus
 * ist, zeigt weder seine Karten noch seine Nutzung von Kern-Schablonen.
 *
 * Nur Lesen. Einstellen kommt mit G-22 (Recht `CORE.BILDKARTEN.EDIT`).
 * `/admin/bildkarten` bleibt die Betreiberseite (Schriften, Zeiten, alle Karten).
 *
 * Wächter: scripts/check-bildkarten.js (12)
 */

'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router({ mergeParams: true });
const { ServiceManager } = require('dunebot-core');
const { Bildkarte } = require('dunebot-sdk');
const { requirePermission } = require('../../middlewares/permissions.middleware');

const PLUGINS = path.join(__dirname, '..', '..', '..', '..', 'plugins');

/** Anzeigename eines Plugins aus seiner package.json. */
function pluginName(plugin) {
    try {
        return JSON.parse(fs.readFileSync(path.join(PLUGINS, plugin, 'package.json'), 'utf8')).displayName || plugin;
    } catch {
        return plugin;
    }
}

/**
 * Die Karten, die diese Guild sieht, mit ihren Nutzungen.
 * @param {string} guildId
 * @returns {Promise<Array<{name: string, besitzer: string, titel: string|null, nutzungen: Array}>>}
 */
async function kartenDerGuild(guildId) {
    const dbService = ServiceManager.get('dbService');
    const an = new Set((await dbService.query(
        'SELECT plugin_name FROM guild_plugins WHERE guild_id = ? AND is_enabled = 1',
        [guildId]
    ) || []).map((z) => z.plugin_name));
    const { karten } = Bildkarte.nutzungen();
    const aus = [];
    for (const name of Bildkarte.liste()) {
        const besitzer = name.split(':')[0];
        if (besitzer !== 'kern' && !an.has(besitzer)) continue;
        const nutzungen = (karten.get(name) || []).filter((n) => an.has(n.plugin)).map((n) => ({ ...n, pluginName: pluginName(n.plugin) }));
        const eigene = nutzungen.find((n) => n.plugin === besitzer);
        aus.push({ name, besitzer, besitzerName: besitzer === 'kern' ? null : pluginName(besitzer), titel: eigene?.titel || null, nutzungen });
    }
    return aus;
}

/** Sprache der Guild wie im Bot (`guild.locale` = core `LOCALE`). */
async function spracheDerGuild(guildId) {
    const zeilen = await ServiceManager.get('dbService').query(
        "SELECT config_value FROM configs WHERE plugin_name = 'core' AND config_key = 'LOCALE' AND guild_id = ? AND context = 'shared'",
        [guildId]
    );
    return zeilen?.[0]?.config_value || 'de-DE';
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
        let werte;
        for (const n of karte.nutzungen) {
            const s = await Bildkarte.nutzungStand(n, guildId);
            if (s.werte) { werte = s.werte; break; }
        }
        const zeilen = await ServiceManager.get('dbService').query('SELECT guild_name FROM guilds WHERE _id = ?', [guildId]);
        const bild = await Bildkarte.beispiel(name, {
            guildId,
            guildName: zeilen?.[0]?.guild_name || '',
            nutzer: req.session.user.info,
            werte,
            sprache: await spracheDerGuild(guildId),
        });
        res.set('Cache-Control', 'no-store');
        res.type(bild.typ === 'png' ? 'png' : 'jpeg').send(bild.puffer);
    } catch (err) {
        ServiceManager.get('Logger').error(`[Bildkarten] Bild ${name} in ${guildId}:`, err);
        res.status(500).type('text').send(err.message);
    }
});

module.exports = router;
module.exports.kartenDerGuild = kartenDerGuild;
