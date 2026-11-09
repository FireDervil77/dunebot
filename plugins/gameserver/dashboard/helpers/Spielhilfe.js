'use strict';

/**
 * „Hilfe“ auf den Seiten eines Servers zeigt auf die Anleitung seines Spiels
 * (2026-11-09, Wunsch des Betreibers: „gezieltere Hilfe“).
 *
 * Die Kopfleiste nimmt `res.locals.hilfe`. Der Kern setzt es für jede Seite
 * eines Plugins auf dessen Steckbrief (`routes/guild.router.js`); hier wird es
 * für `/servers/<id>/…` durch den Artikel ersetzt, der auf das Spielpaket des
 * Servers zeigt (`kb_articles.spiel`, gepflegt in /admin/kb). Hat das Spiel
 * keine Anleitung, bleibt der Steckbrief.
 *
 * Nur bei Seitenaufrufen (GET, text/html) — Abrufe aus Skripten und
 * Ereignisströme laufen auch hier durch. Scheitert die Abfrage, steht es im
 * Log und die Seite geht mit dem Steckbrief weiter.
 */

const { ServiceManager } = require('dunebot-core');
const Wissen = require('../../../../apps/dashboard/helpers/Wissen');

async function fuerServer(req, res, next) {
    const serverId = String(req.params.serverId || '');
    if (req.method !== 'GET' || !String(req.headers.accept || '').includes('text/html') || !/^\d+$/.test(serverId)) {
        return next();
    }
    try {
        const [server] = await ServiceManager.get('dbService').query(
            'SELECT addon_marketplace_id FROM gameservers WHERE id = ? AND guild_id = ?',
            [Number(serverId), String(res.locals.guildId || req.params.guildId || '')]);
        const hilfe = server ? await Wissen.hilfeFuerSpiel(server.addon_marketplace_id, res.locals.locale) : null;
        if (hilfe) res.locals.hilfe = hilfe;
    } catch (fehler) {
        ServiceManager.get('Logger').error(`[Gameserver] Anleitung für Server ${serverId} nicht gelesen:`, fehler);
    }
    next();
}

module.exports = { fuerServer };
