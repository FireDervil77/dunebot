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
const InhalteHolen = require('../helpers/InhalteHolen');
const Thunderstore = require('../helpers/Thunderstore');

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

/**
 * Wirkt die Aenderung sofort — oder erst nach einem Neustart?
 *
 * Mods laedt das Spiel beim START. Wer im laufenden Betrieb installiert,
 * entfernt oder schaltet, sieht im Spiel nichts, bis der Server neu startet
 * (Betreiber, 2026-09-13). Ob jetzt jemand handeln muss, haengt am Status: Ein
 * laufender Server braucht den Neustart, ein gestoppter nimmt die Aenderung
 * beim naechsten Start ohnehin mit.
 *
 * „Laeuft" heisst hier dasselbe wie auf der Serverseite (Serverseite.js):
 * online oder starting. Ein Server, der gerade hochfaehrt, hat seine Mods
 * schon gelesen.
 */
function wirkung(geladen) {
    return {
        neustartNoetig: geladen.paket?.content?.needs_restart !== false,
        laeuft: ['online', 'starting'].includes(geladen.server?.status),
    };
}

/**
 * Der Daemon dieses Servers — ohne ihn geht nichts auf die Maschine.
 *
 * Steht im Helfer, weil der Abruf von Thunderstore ihn ebenso braucht; zwei
 * Abfragen fuer dieselbe Frage driften auseinander.
 */
const { daemonVon } = InhalteHolen;

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

        // Jede Zeile bekommt die Seite ihrer Quelle mit — daraus baut die Karte
        // die Liste zum Weitergeben. Gebaut wird sie HIER, weil nur hier das
        // Spielpaket bekannt ist (die Gemeinschaft steht darin).
        const gemeinschaft = inhalt?.source_ids?.thunderstore || null;
        const mitAdresse = (z) => (z ? { ...z, url: Inhalte.paketAdresse(z, gemeinschaft) } : z);
        liste.lader = mitAdresse(liste.lader);
        liste.mods = liste.mods.map(mitAdresse);
        liste.entfernt = liste.entfernt.map(mitAdresse);

        return res.json({
            success: true,
            gemeinschaft,
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
            ...wirkung(geladen),
        });
    } catch (error) {
        Logger.error('[Gameserver/Inhalte] Hochladen fehlgeschlagen:', error);
        return res.status(500).json({ success: false, message: 'Serverfehler' });
    }
});

// ════════════════════════════════════════════════════════════════════════════
// Thunderstore: suchen, ansehen, installieren, aktualisieren
// ════════════════════════════════════════════════════════════════════════════

/**
 * Bei welcher Thunderstore-Gemeinschaft dieses Spiel liegt.
 *
 * Thunderstore ist nach Spielen getrennt (`valheim`, `lethal-company`). Das
 * sagt das PAKET (`content.source_ids.thunderstore`) — geraten waere es die
 * Sorte Annahme, die bei jedem zweiten Spiel danebenliegt.
 */
function gemeinschaftAus(inhalt) {
    return inhalt?.source_ids?.thunderstore || null;
}

/** Antwort, wenn das Paket Thunderstore gar nicht kennt. */
function keineQuelle(res, inhalt) {
    if (!inhalt?.supported) {
        return res.status(409).json({ success: false,
            message: 'Dieses Spiel nimmt laut seinem Paket keine Inhalte auf.' });
    }
    if (!(inhalt.sources || []).includes('thunderstore')) {
        return res.status(409).json({ success: false,
            message: 'Das Paket nennt Thunderstore nicht als Quelle.' });
    }
    if (!gemeinschaftAus(inhalt)) {
        return res.status(409).json({ success: false,
            message: 'Das Paket sagt nicht, welche Thunderstore-Gemeinschaft zu diesem Spiel '
                   + 'gehoert (content.source_ids.thunderstore).' });
    }
    return null;
}

/**
 * Suchen fuer ein Spiel, das noch keinen Server hat — der Schritt „Mods" beim
 * Anlegen.
 *
 * Muss VOR den `/:serverId/...`-Routen stehen: `mods` waere sonst eine
 * Server-Kennung.
 */
router.get('/mods/suche', requirePermission('GAMESERVER.CREATE'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');

    try {
        const paketZeile = await ladePaketFuerAddon(dbService, parseInt(req.query.addon_id, 10));
        const paket = paketZeile
            ? (typeof paketZeile.paket_json === 'string'
                ? JSON.parse(paketZeile.paket_json) : paketZeile.paket_json)
            : null;
        const inhalt = paket?.content || null;

        const absage = keineQuelle(res, inhalt);
        if (absage) return absage;

        return res.json(await sucheAntwort(inhalt, req.query.q, req.query.seite));
    } catch (error) {
        Logger.warn('[Gameserver/Inhalte] Suche fehlgeschlagen:', error);
        return res.status(502).json({ success: false, message: error.message });
    }
});

/**
 * Die Antwort auf eine Suche — samt Seite je Treffer.
 *
 * **Ohne Suchbegriff kommen die beliebtesten.** Das ist kein Nebeneffekt,
 * sondern der Weg fuer jemanden, der das Spiel noch nicht kennt: erst schauen,
 * was es gibt. Die Ansicht sagt es auch so.
 *
 * Die Adresse baut der Server, nicht die Ansicht: Sie braucht die Gemeinschaft
 * aus dem Paket, und ohne sie landet man beim falschen Spiel.
 */
async function sucheAntwort(inhalt, begriff, seite) {
    const gemeinschaft = gemeinschaftAus(inhalt);
    const roh = await Thunderstore.suche(gemeinschaft, begriff || '', { seite });
    return {
        success: true,
        gemeinschaft,
        gestoebert: !String(begriff || '').trim(),
        lader: inhalt.loader?.packages?.thunderstore || null,
        // Wie viel es hier ueberhaupt gibt — die Frage stellt sich jeder, der
        // ein Spiel noch nicht kennt, und ohne Antwort blaettert er blind.
        gesamt:   roh.gesamt,
        seite:    roh.seite,
        seiten:   Math.max(1, Math.ceil(roh.gesamt / (roh.proSeite || 20))),
        weiter:   roh.weiter,
        zurueck:  roh.zurueck,
        // Wer wirklich stoebern will, ist im Verzeichnis besser aufgehoben als
        // in einer Karte mit 20 Zeilen.
        verzeichnis: Thunderstore.verzeichnis(gemeinschaft),
        treffer: roh.treffer.map(t => ({
            ...t,
            url: Inhalte.paketAdresse({ quelle: 'thunderstore', kennung: t.kennung }, gemeinschaft),
        })),
    };
}

/** Suchen fuer einen bestehenden Server. */
router.get('/:serverId/inhalte/suche', requirePermission('GAMESERVER.VIEW'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');

    try {
        const geladen = await ladeServerUndPaket(dbService, req.params.serverId, res.locals.guildId);
        if (!geladen) return res.status(404).json({ success: false, message: 'Server nicht gefunden' });

        const inhalt = geladen.paket?.content || null;
        const absage = keineQuelle(res, inhalt);
        if (absage) return absage;

        return res.json(await sucheAntwort(inhalt, req.query.q, req.query.seite));
    } catch (error) {
        // 502, nicht 500: Der Fehler liegt beim fremden Dienst, nicht bei uns —
        // und die Meldung sagt das auch, statt „Serverfehler" zu behaupten.
        Logger.warn('[Gameserver/Inhalte] Suche fehlgeschlagen:', error);
        return res.status(502).json({ success: false, message: error.message });
    }
});

/**
 * Was kaeme mit? — die Abhaengigkeiten, bevor jemand klickt.
 *
 * Der Lader ist dabei meist eine Abhaengigkeit: Wer Jotunn waehlt, bekommt
 * BepInEx mit. Das gehoert VOR die Installation, nicht in ein Log danach.
 */
router.get('/:serverId/inhalte/vorschau', requirePermission('GAMESERVER.VIEW'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');

    try {
        const geladen = await ladeServerUndPaket(dbService, req.params.serverId, res.locals.guildId);
        if (!geladen) return res.status(404).json({ success: false, message: 'Server nicht gefunden' });

        const inhalt = geladen.paket?.content || null;
        const absage = keineQuelle(res, inhalt);
        if (absage) return absage;

        const schau = await InhalteHolen.vorschau({
            serverId: req.params.serverId, inhalt,
            kennung: req.query.kennung, fassung: req.query.fassung || null,
        });
        return res.json({ success: true, ...schau });
    } catch (error) {
        Logger.warn('[Gameserver/Inhalte] Vorschau fehlgeschlagen:', error);
        return res.status(502).json({ success: false, message: error.message });
    }
});

/** Installieren — das Paket samt allem, was es braucht. */
router.post('/:serverId/inhalte/thunderstore', requirePermission('GAMESERVER.FILES.MANAGE'),
    async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');

    try {
        const { serverId } = req.params;
        const guildId = res.locals.guildId;

        const geladen = await ladeServerUndPaket(dbService, serverId, guildId);
        if (!geladen) return res.status(404).json({ success: false, message: 'Server nicht gefunden' });

        const inhalt = geladen.paket?.content || null;
        const absage = keineQuelle(res, inhalt);
        if (absage) return absage;

        if (!req.body?.kennung) {
            return res.status(400).json({ success: false, message: 'kennung fehlt' });
        }

        const ergebnis = await InhalteHolen.installiere({
            server: geladen.server, inhalt, guildId,
            kennung: String(req.body.kennung),
            fassung: req.body.fassung ? String(req.body.fassung) : null,
        });

        Logger.info(`[Gameserver/Inhalte] Thunderstore ${req.body.kennung} auf Server ${serverId}: `
            + `${ergebnis.installiert.length} installiert, ${ergebnis.fehlgeschlagen.length} fehlgeschlagen`);

        // Auch ein Teilerfolg ist ein Erfolg der Anfrage — was misslang, steht
        // in der Antwort und in den Zeilen, nicht in einem 500er.
        return res.json({ success: true, ...ergebnis, ...wirkung(geladen) });
    } catch (error) {
        Logger.error('[Gameserver/Inhalte] Installation fehlgeschlagen:', error);
        return res.status(502).json({ success: false, message: error.message });
    }
});

/**
 * Die vorgemerkten Mods jetzt holen.
 *
 * Normalerweise passiert das von selbst, sobald die Grundinstallation fertig
 * gemeldet ist (`install`/`completed` → `_holeVorgemerkteMods`). Diesen Weg
 * braucht es trotzdem, und zwar fuer die beiden Faelle, in denen das Ereignis
 * nichts nuetzt: Der Abruf ist fehlgeschlagen (Thunderstore war nicht
 * erreichbar), oder er ist gar nicht erst gelaufen — wie am 2026-09-12, als
 * der Haken in einer Methode ohne Aufrufer sass.
 *
 * Ohne diesen Knopf waere die einzige Rettung, den Server neu zu installieren.
 */
router.post('/:serverId/inhalte/geplant-holen', requirePermission('GAMESERVER.FILES.MANAGE'),
    async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');

    try {
        const { serverId } = req.params;
        const guildId = res.locals.guildId;

        const geladen = await ladeServerUndPaket(dbService, serverId, guildId);
        if (!geladen) return res.status(404).json({ success: false, message: 'Server nicht gefunden' });

        const inhalt = geladen.paket?.content || null;
        const absage = keineQuelle(res, inhalt);
        if (absage) return absage;

        const ergebnis = await InhalteHolen.holeGeplante({
            server: geladen.server, inhalt, guildId });

        if (!ergebnis) {
            return res.json({ success: true, nichts: true,
                message: 'Es ist nichts vorgemerkt.' });
        }

        Logger.info(`[Gameserver/Inhalte] Vorgemerktes für Server ${serverId} geholt: `
            + `${ergebnis.installiert.length} installiert, ${ergebnis.fehlgeschlagen.length} fehlgeschlagen`);
        return res.json({ success: true, ...ergebnis, ...wirkung(geladen) });
    } catch (error) {
        Logger.error('[Gameserver/Inhalte] Vorgemerktes nicht geholt:', error);
        return res.status(502).json({ success: false, message: error.message });
    }
});

/**
 * Gibt es neuere Fassungen?
 *
 * Auf Knopfdruck, nicht beim Laden der Seite: Das ist eine Abfrage je Mod bei
 * einem fremden Dienst — bei zehn Mods zehn Anfragen, und eine Serverseite, die
 * darauf wartet, waere langsam ohne Not.
 */
router.get('/:serverId/inhalte/aktualisierungen', requirePermission('GAMESERVER.VIEW'),
    async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');

    try {
        const geladen = await ladeServerUndPaket(dbService, req.params.serverId, res.locals.guildId);
        if (!geladen) return res.status(404).json({ success: false, message: 'Server nicht gefunden' });

        const zeilen = await dbService.query(
            `SELECT id, kennung, fassung FROM gameserver_content
              WHERE server_id = ? AND quelle = 'thunderstore' AND status = 'installiert'`,
            [req.params.serverId]
        );
        if (!zeilen.length) return res.json({ success: true, stand: [] });

        return res.json({ success: true, stand: await Thunderstore.aktualisierungen(zeilen) });
    } catch (error) {
        Logger.warn('[Gameserver/Inhalte] Aktualisierungen nicht abfragbar:', error);
        return res.status(502).json({ success: false, message: error.message });
    }
});

/**
 * Einen Eintrag auf die neueste Fassung bringen.
 *
 * Je Mod und auf Knopfdruck — nicht automatisch beim Start. Ein Mod-Update ist
 * die haeufigste Ursache dafuer, dass ein Server nicht mehr startet (B.12);
 * dass es passiert, weil jemand es ausgeloest hat, ist der halbe Unterschied.
 */
router.post('/:serverId/inhalte/:id/aktualisieren', requirePermission('GAMESERVER.FILES.MANAGE'),
    async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');

    try {
        const { serverId, id } = req.params;
        const guildId = res.locals.guildId;

        const geladen = await ladeServerUndPaket(dbService, serverId, guildId);
        if (!geladen) return res.status(404).json({ success: false, message: 'Server nicht gefunden' });

        const inhalt = geladen.paket?.content || null;
        const absage = keineQuelle(res, inhalt);
        if (absage) return absage;

        const [zeile] = await dbService.query(
            `SELECT * FROM gameserver_content
              WHERE id = ? AND server_id = ? AND quelle = 'thunderstore'`,
            [id, serverId]
        );
        if (!zeile) return res.status(404).json({ success: false, message: 'Eintrag nicht gefunden' });

        const ergebnis = await InhalteHolen.aktualisiere({
            server: geladen.server, inhalt, guildId, zeile,
        });

        if (!ergebnis.geaendert) {
            return res.json({ success: true, geaendert: false,
                message: `${zeile.name || zeile.kennung} ist schon auf ${ergebnis.nachher}.` });
        }

        Logger.info(`[Gameserver/Inhalte] ${zeile.kennung}: ${ergebnis.vorher} → ${ergebnis.nachher} `
            + `(Server ${serverId})`);
        return res.json({ success: true, ...ergebnis, ...wirkung(geladen) });
    } catch (error) {
        Logger.error('[Gameserver/Inhalte] Aktualisieren fehlgeschlagen:', error);
        return res.status(502).json({ success: false, message: error.message });
    }
});

// ════════════════════════════════════════════════════════════════════════════
// An/aus und entfernen
// ════════════════════════════════════════════════════════════════════════════

router.post('/:serverId/inhalte/:id/schalten', requirePermission('GAMESERVER.FILES.MANAGE'),
    async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    try {
        const dbService = ServiceManager.get('dbService');
        const geladen = await ladeServerUndPaket(dbService, req.params.serverId, res.locals.guildId);
        if (!geladen) return res.status(404).json({ success: false, message: 'Server nicht gefunden' });

        const getroffen = await Inhalte.schalten(
            req.params.id, req.params.serverId, req.body.aktiv === true || req.body.aktiv === '1');
        if (!getroffen) {
            return res.status(404).json({
                success: false,
                message: 'Eintrag nicht gefunden oder bereits entfernt'
            });
        }
        return res.json({ success: true, ...wirkung(geladen) });
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

        // Geloescht wird die aufgehobene LISTE der Dateien, nicht `ablage`:
        // Bei einem Mod aus mehreren Dateien steht dort der ZIELORDNER
        // (`BepInEx/plugins`) — und den zu loeschen naehme jeden anderen Mod
        // mit. Bis zum 2026-09-11 tat diese Route genau das.
        let weg = { weg: 0, blieb: [], ohneListe: false };
        if (zeile.art === Inhalte.ART_MOD) {
            weg = await InhalteHolen.entferneDateien({
                server: geladen.server, zeile, inhalt: geladen.paket?.content || null,
            });
        }

        // Melden, nicht verschweigen: Eine Zeile auf „entfernt", deren Datei
        // noch liegt, laedt beim naechsten Start weiter — und niemand versteht
        // warum.
        const hinweis = zeile.art === Inhalte.ART_LADER
            ? 'Der Lader ist abgeschaltet. Seine Dateien bleiben liegen — ohne den '
              + 'Schalter laedt er nicht.'
            : weg.ohneListe
                ? 'Die Zeile ist entfernt. Welche Dateien zu diesem Eintrag gehoeren, wurde '
                  + 'bei seiner Installation nicht festgehalten — sie liegen noch auf dem Server.'
                : weg.blieb.length
                    ? `Die Zeile ist entfernt, ${weg.blieb.length} Datei(en) blieben liegen: `
                      + weg.blieb.join(', ')
                    : null;

        return res.json({ success: true, dateiWeg: weg.weg > 0, dateien: weg.weg, hinweis, ...wirkung(geladen) });
    } catch (error) {
        Logger.error('[Gameserver/Inhalte] Entfernen fehlgeschlagen:', error);
        return res.status(500).json({ success: false, message: 'Serverfehler' });
    }
});

module.exports = router;
