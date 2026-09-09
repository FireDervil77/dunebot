'use strict';

/**
 * Inhalte eines Servers: Mods und der Lader, der sie traegt (E6/B.12).
 *
 * ── Warum ein eigener Router und nicht der Dateimanager ─────────────────────
 *
 * Technisch sind Mods Dateien, und der Dateimanager koennte sie ablegen. Was er
 * nicht kann, ist die Frage beantworten, die dahinter steht: WELCHE Fassung
 * liegt da, ist sie an, braucht der Mitspieler sie auch, und in welcher
 * Reihenfolge laedt der Lader. Das steht in `gameserver_content`, und diese
 * Routen halten Datei und Zeile zusammen.
 *
 * ── Das Recht ───────────────────────────────────────────────────────────────
 *
 * `GAMESERVER.FILES.MANAGE` fuer alles Schreibende. Ein eigenes Recht waere ein
 * Eintrag mehr im Katalog fuer eine Grenze, die es nicht gibt: Wer Dateien
 * verwalten darf, kann eine .dll ohnehin von Hand in `BepInEx/plugins` legen.
 * Lesen genuegt `GAMESERVER.VIEW`.
 */

const express = require('express');
const router = express.Router();
const { ServiceManager } = require('dunebot-core');
const { requirePermission } = require('../../../../apps/dashboard/middlewares/permissions.middleware');
const { nimmDatei } = require('../helpers/DateiAnnahme');
const { ladePaketFuerAddon } = require('../helpers/StartPayload');
const Inhalte = require('../helpers/Inhalte');

/**
 * Server samt Paket laden — und pruefen, dass er zur Guild gehoert.
 *
 * @returns {Promise<{server: object, paket: object|null}|null>}
 */
async function ladeServerUndPaket(dbService, serverId, guildId) {
    const [server] = await dbService.query(
        `SELECT id, name, guild_id, rootserver_id, install_path, addon_marketplace_id, status
           FROM gameservers WHERE id = ? AND guild_id = ?`,
        [serverId, guildId]
    );
    if (!server) return null;

    const zeile = await ladePaketFuerAddon(dbService, server.addon_marketplace_id);
    const paket = zeile
        ? (typeof zeile.paket_json === 'string' ? JSON.parse(zeile.paket_json) : zeile.paket_json)
        : null;

    return { server, paket };
}

/** Der Daemon dieses Servers — ohne ihn geht nichts auf die Maschine. */
async function daemonVon(dbService, server) {
    const [zeile] = await dbService.query(
        'SELECT daemon_id FROM rootserver WHERE id = ?', [server.rootserver_id]);
    return zeile ? zeile.daemon_id : null;
}

// ════════════════════════════════════════════════════════════════════════════
// Lesen
// ════════════════════════════════════════════════════════════════════════════

router.get('/:serverId/inhalte', requirePermission('GAMESERVER.VIEW'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');

    try {
        const geladen = await ladeServerUndPaket(dbService, req.params.serverId, res.locals.guildId);
        if (!geladen) return res.status(404).json({ success: false, message: 'Server nicht gefunden' });

        const inhalt = geladen.paket?.content || null;
        const liste = await Inhalte.fuerServer(req.params.serverId);

        return res.json({
            success: true,
            // Was das PAKET sagt — ohne das weiss die Ansicht nicht, ob sie
            // ueberhaupt etwas anbieten darf.
            unterstuetzt: Boolean(inhalt?.supported),
            lader: inhalt?.loader?.key || null,
            pfad: inhalt?.path || null,
            quellen: inhalt?.sources || [],
            reihenfolgeZaehlt: Boolean(inhalt?.order_matters),
            ...liste,
        });
    } catch (error) {
        Logger.error('[Gameserver/Inhalte] Liste nicht lesbar:', error);
        return res.status(500).json({ success: false, message: 'Serverfehler' });
    }
});

// ════════════════════════════════════════════════════════════════════════════
// Hochladen
// ════════════════════════════════════════════════════════════════════════════

/**
 * Eine Datei auf den Server legen und die Zeile dazu schreiben.
 *
 * ── Wohin die Datei geht, sagt das Paket ────────────────────────────────────
 *
 *   Lader   in das Serververzeichnis selbst — BepInEx bringt seine eigene
 *           Ordnerstruktur mit (`BepInEx/core`, `doorstop_libs`)
 *   Mod     in `content.path` (z. B. `BepInEx/plugins`)
 *
 * Kein Pfad im Code: Ein Spiel ohne `content.path` bekommt hier eine Absage
 * statt einer geratenen Ablage.
 */
router.post('/:serverId/inhalte', requirePermission('GAMESERVER.FILES.MANAGE'), nimmDatei,
    async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const ipmServer = ServiceManager.get('ipmServer');

    try {
        const { serverId } = req.params;
        const guildId = res.locals.guildId;

        if (!req.file) return res.status(400).json({ success: false, message: 'Keine Datei' });

        const geladen = await ladeServerUndPaket(dbService, serverId, guildId);
        if (!geladen) return res.status(404).json({ success: false, message: 'Server nicht gefunden' });

        const inhalt = geladen.paket?.content;
        if (!inhalt?.supported) {
            return res.status(409).json({
                success: false,
                message: 'Dieses Spiel nimmt laut Paket keine Inhalte auf.'
            });
        }

        const art = req.body.art === Inhalte.ART_LADER ? Inhalte.ART_LADER : Inhalte.ART_MOD;

        if (art === Inhalte.ART_MOD && !inhalt.path) {
            return res.status(409).json({
                success: false,
                message: 'Das Paket nennt keinen Ablageort fuer Mods (content.path). '
                       + 'Ohne ihn waere jeder Ort geraten.'
            });
        }

        const daemonId = await daemonVon(dbService, geladen.server);
        if (!daemonId) {
            return res.status(503).json({ success: false, message: 'Kein Daemon zugewiesen' });
        }

        // Der Lader bringt seine Struktur mit und gehoert in die Wurzel; ein Mod
        // in den Ordner, den das Paket nennt.
        const ziel = art === Inhalte.ART_LADER ? '' : inhalt.path;
        const entpacken = /\.zip$/i.test(req.file.originalname);

        const antwort = await ipmServer.sendCommand(daemonId, 'gameserver.content.install', {
            server_id:     String(serverId),
            rootserver_id: String(geladen.server.rootserver_id),
            install_path:  geladen.server.install_path,
            ziel,
            dateiname:     req.file.originalname,
            inhalt:        req.file.buffer.toString('base64'),
            entpacken,
        }, 120000);

        if (!antwort?.success) {
            // **Die Zeile wird trotzdem geschrieben** — als fehlgeschlagen, mit
            // Grund. Ein Fehlschlag, der keine Spur hinterlaesst, wiederholt
            // sich, und niemand weiss, dass es schon einmal nicht ging.
            await Inhalte.eintragen({
                serverId, guildId, art, quelle: 'upload',
                kennung: req.file.originalname,
                name: req.body.name || req.file.originalname,
                fassung: req.body.fassung || null,
                clientSide: Boolean(inhalt.client_side),
                status: 'fehlgeschlagen',
                fehler: antwort?.error || 'Der Daemon hat nicht geantwortet',
            });
            return res.status(502).json({
                success: false,
                message: antwort?.error || 'Der Daemon hat die Datei nicht angenommen'
            });
        }

        const dateien = antwort.data?.dateien || [];

        const id = await Inhalte.eintragen({
            serverId, guildId, art, quelle: 'upload',
            kennung: req.file.originalname,
            name: req.body.name || req.file.originalname,
            fassung: req.body.fassung || null,
            // Bei einem Archiv sind es viele Dateien; die Spalte haelt den
            // Zielordner, damit spaeteres Entfernen nicht raten muss.
            ablage: dateien.length === 1 ? dateien[0] : (ziel || '.'),
            clientSide: Boolean(inhalt.client_side),
            status: 'installiert',
        });

        Logger.info(`[Gameserver/Inhalte] ${art} "${req.file.originalname}" auf Server ${serverId}: `
            + `${dateien.length} Datei(en) geschrieben`);

        return res.json({
            success: true,
            id,
            dateien: dateien.length,
            // Der Betreiber soll wissen, dass es erst nach dem Neustart wirkt —
            // sonst sucht er den Mod im laufenden Spiel.
            neustartNoetig: inhalt.needs_restart !== false,
        });
    } catch (error) {
        Logger.error('[Gameserver/Inhalte] Hochladen fehlgeschlagen:', error);
        return res.status(500).json({ success: false, message: 'Serverfehler' });
    }
});

// ════════════════════════════════════════════════════════════════════════════
// An/aus und entfernen
// ════════════════════════════════════════════════════════════════════════════

router.post('/:serverId/inhalte/:id/schalten', requirePermission('GAMESERVER.FILES.MANAGE'),
    async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    try {
        const getroffen = await Inhalte.schalten(
            req.params.id, req.params.serverId, req.body.aktiv === true || req.body.aktiv === '1');
        if (!getroffen) {
            return res.status(404).json({
                success: false,
                message: 'Eintrag nicht gefunden oder bereits entfernt'
            });
        }
        return res.json({ success: true });
    } catch (error) {
        Logger.error('[Gameserver/Inhalte] Schalten fehlgeschlagen:', error);
        return res.status(500).json({ success: false, message: 'Serverfehler' });
    }
});

/**
 * Entfernen — die Zeile bleibt, die Datei geht.
 *
 * ── Der Lader ist der Sonderfall ────────────────────────────────────────────
 *
 * Er wird nur ABGESCHALTET, seine Dateien bleiben liegen. Das ist kein
 * Nachlassen, sondern folgt aus seiner Bauform: BepInEx wird ueber die
 * Umgebung scharf (doorstop). Ohne den Schalter laedt es nicht — ob die Dateien
 * daliegen, ist dem Spiel gleich. Sie zu loeschen hiesse, ein Verzeichnis mit
 * Dutzenden Eintraegen rueckwaerts abzuraeumen, und ein halb abgeraeumtes
 * BepInEx ist schlimmer als ein vollstaendiges, das nicht geladen wird.
 */
router.delete('/:serverId/inhalte/:id', requirePermission('GAMESERVER.FILES.MANAGE'),
    async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const ipmServer = ServiceManager.get('ipmServer');

    try {
        const { serverId, id } = req.params;

        const geladen = await ladeServerUndPaket(dbService, serverId, res.locals.guildId);
        if (!geladen) return res.status(404).json({ success: false, message: 'Server nicht gefunden' });

        const zeile = await Inhalte.entfernen(id, serverId);
        if (!zeile) return res.status(404).json({ success: false, message: 'Eintrag nicht gefunden' });

        let dateiWeg = false;
        if (zeile.art === Inhalte.ART_MOD && zeile.ablage && !zeile.ablage.endsWith('.')) {
            const daemonId = await daemonVon(dbService, geladen.server);
            if (daemonId) {
                const antwort = await ipmServer.sendCommand(daemonId, 'gameserver.files.delete', {
                    server_id:     String(serverId),
                    rootserver_id: String(geladen.server.rootserver_id),
                    install_path:  geladen.server.install_path,
                    path:          '/' + zeile.ablage,
                }, 30000);
                dateiWeg = Boolean(antwort?.success);
                if (!dateiWeg) {
                    // Melden, nicht verschweigen: Die Zeile steht auf entfernt,
                    // die Datei liegt noch da — beim naechsten Start laedt der
                    // Mod weiter, und niemand versteht warum.
                    Logger.warn(`[Gameserver/Inhalte] Datei blieb liegen (${zeile.ablage}): `
                        + `${antwort?.error || 'keine Antwort'}`);
                }
            }
        }

        return res.json({
            success: true,
            dateiWeg,
            hinweis: zeile.art === Inhalte.ART_LADER
                ? 'Der Lader ist abgeschaltet. Seine Dateien bleiben liegen — ohne den '
                  + 'Schalter laedt er nicht.'
                : (dateiWeg ? null : 'Die Zeile ist entfernt, die Datei liegt noch auf dem Server.'),
        });
    } catch (error) {
        Logger.error('[Gameserver/Inhalte] Entfernen fehlgeschlagen:', error);
        return res.status(500).json({ success: false, message: 'Serverfehler' });
    }
});

module.exports = router;
