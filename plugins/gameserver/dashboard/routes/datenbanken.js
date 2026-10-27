'use strict';

/**
 * Datenbanken eines Servers (Stufe 11 S3, 2026-10-27).
 *
 * Lesen (Liste, Größe) genügt `GAMESERVER.VIEW`. Alles, was den Zugang zeigt
 * oder ändert, verlangt `GAMESERVER.FILES.MANAGE` — dieselbe Grenze wie beim
 * SFTP-Passwort und den Mods: Wer Dateien verwalten darf, kann die
 * Zugangsdaten ohnehin in die Konfiguration des Spiels schreiben.
 */
const express = require('express');
const router = express.Router();
const { ServiceManager } = require('dunebot-core');
const { requirePermission } = require('../../../../apps/dashboard/middlewares/permissions.middleware');
const Datenbanken = require('../helpers/Datenbanken');

async function mitServer(req, res, tun) {
    const Logger = ServiceManager.get('Logger');
    try {
        const server = await Datenbanken.ladeServer(req.params.serverId, res.locals.guildId);
        if (!server) return res.status(404).json({ success: false, message: 'Server nicht gefunden' });
        const ergebnis = await tun(server);
        return res.json({ success: true, ...ergebnis });
    } catch (e) {
        const status = e.status || 500;
        if (status >= 500) Logger.error(`[Gameserver] Datenbanken (Server ${req.params.serverId}): ${e.message}`);
        return res.status(status).json({ success: false, message: e.message });
    }
}

function nummer(req) {
    const n = Number(req.params.nr);
    return Number.isInteger(n) && n >= 1 && n <= 99 ? n : null;
}

router.get('/:serverId/datenbanken', requirePermission('GAMESERVER.VIEW'), (req, res) =>
    mitServer(req, res, async (server) => {
        const liste = await Datenbanken.liste(server.id);
        return { stand: Datenbanken.stand(server, liste.length), datenbanken: liste };
    }));

router.post('/:serverId/datenbanken', requirePermission('GAMESERVER.FILES.MANAGE'), (req, res) =>
    mitServer(req, res, async (server) => ({ zugang: await Datenbanken.anlegen(server) })));

router.post('/:serverId/datenbanken/groessen', requirePermission('GAMESERVER.VIEW'), (req, res) =>
    mitServer(req, res, async (server) => {
        const abgleich = await Datenbanken.groessenMessen(server);
        return { ...abgleich, datenbanken: await Datenbanken.liste(server.id) };
    }));

router.get('/:serverId/datenbanken/:nr/zugang', requirePermission('GAMESERVER.FILES.MANAGE'), (req, res) =>
    mitServer(req, res, async (server) => {
        const nr = nummer(req);
        if (!nr) return Promise.reject(Object.assign(new Error('Ungültige Nummer'), { status: 400 }));
        return { zugang: await Datenbanken.zugang(server, nr) };
    }));

router.post('/:serverId/datenbanken/:nr/kennwort', requirePermission('GAMESERVER.FILES.MANAGE'), (req, res) =>
    mitServer(req, res, async (server) => {
        const nr = nummer(req);
        if (!nr) return Promise.reject(Object.assign(new Error('Ungültige Nummer'), { status: 400 }));
        return { zugang: await Datenbanken.neuesKennwort(server, nr) };
    }));

// Löschen nur mit eingetipptem Namen (Zerstörende Rückfrage): Die Daten sind
// danach weg, eine Sicherung der Datenbank gibt es erst mit S6.
router.delete('/:serverId/datenbanken/:nr', requirePermission('GAMESERVER.FILES.MANAGE'), (req, res) =>
    mitServer(req, res, async (server) => {
        const nr = nummer(req);
        if (!nr) return Promise.reject(Object.assign(new Error('Ungültige Nummer'), { status: 400 }));
        const [zeile] = (await Datenbanken.liste(server.id)).filter(d => d.nr === nr);
        if (!zeile) return Promise.reject(Object.assign(new Error('Diese Datenbank gibt es nicht.'), { status: 404 }));
        if (String(req.body?.bestaetigung || '').trim() !== zeile.name) {
            return Promise.reject(Object.assign(new Error(`Zum Löschen den Namen eintippen: ${zeile.name}`), { status: 400 }));
        }
        return await Datenbanken.loeschen(server, nr);
    }));

module.exports = router;
