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
const { ladePaketFuerServer, ladePaketFuerAnlegen } = require('../helpers/StartPayload');
const { loeseInhaltAuf } = require('../helpers/InhaltJeLader');
const Inhalte = require('../helpers/Inhalte');
const InhalteHolen = require('../helpers/InhalteHolen');
const Quellen = require('../helpers/Quellen');
const BepInExLog = require('../helpers/BepInExLog');

/**
 * Server samt Paket laden — und pruefen, dass er zur Guild gehoert.
 *
 * @returns {Promise<{server: object, paket: object|null}|null>}
 */
async function ladeServerUndPaket(dbService, serverId, guildId) {
    // `paket_werte` MUSS mit: Seit Stufe 3 haengt der Inhaltsvertrag am
    // gewaehlten Lader (Minecraft), und der steht dort.
    const [server] = await dbService.query(
        `SELECT id, name, guild_id, rootserver_id, install_path, addon_marketplace_id, status,
                paket_werte
           FROM gameservers WHERE id = ? AND guild_id = ?`,
        [serverId, guildId]
    );
    if (!server) return null;

    const zeile = await ladePaketFuerServer(dbService, server.id);
    const roh = zeile
        ? (typeof zeile.paket_json === 'string' ? JSON.parse(zeile.paket_json) : zeile.paket_json)
        : null;

    // Einmal aufloesen, direkt an der Quelle: Danach sehen alle zwoelf Leser in
    // dieser Datei einen gewoehnlichen `content`-Block — den des Laders, den
    // dieser Server benutzt.
    let werte = {};
    try {
        werte = typeof server.paket_werte === 'string'
            ? JSON.parse(server.paket_werte) : (server.paket_werte || {});
    } catch { werte = {}; }
    const paket = loeseInhaltAuf(roh, werte);

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
        const raeume = Quellen.raeumeAus(inhalt);
        const mitAdresse = (z) => (z ? { ...z, url: Inhalte.paketAdresse(z, raeume) } : z);
        liste.lader = mitAdresse(liste.lader);
        liste.mods = liste.mods.map(mitAdresse);
        liste.entfernt = liste.entfernt.map(mitAdresse);

        return res.json({
            success: true,
            // Alle Anbieter dieses Spiels, in der Reihenfolge des Pakets — die
            // Karte baut daraus ihre Auswahl und ihre Adressen.
            quellen: Quellen.ausPaket(inhalt).map(q => ({
                kennung: q, titel: Quellen.fuer(q).TITEL,
                raumName: Quellen.fuer(q).RAUM_NAME, raum: raeume[q] || null,
            })),
            raeume,
            // Was das PAKET sagt — ohne das weiss die Ansicht nicht, ob sie
            // ueberhaupt etwas anbieten darf.
            unterstuetzt: Boolean(inhalt?.supported),
            lader: inhalt?.loader?.key || null,
            // ── Kommt der Lader als INHALT oder mit der Installation? ───────
            //
            // Valheim holt BepInEx wie eine Mod von Thunderstore — deshalb
            // steht dort `content.loader`, und die Karte darf sagen „zuerst der
            // Lader". Minecraft hat keinen solchen Block: Sein Lader IST die
            // Serverdatei, gewaehlt beim Anlegen und mitinstalliert.
            //
            // Ohne diese Unterscheidung erklaerte die Seite einem
            // Minecraft-Server, er brauche BepInEx von Thunderstore (Betreiber,
            // 2026-09-22). Beides falsch, und das zweite fuehrt zum Klicken.
            laderAlsInhalt: Boolean(inhalt?.loader),
            // Welcher Lader hier tatsaechlich laeuft — aus den Werten des
            // Servers, nicht geraten.
            laderGewaehlt: (() => {
                const schluessel = geladen.paket?.content?.by_setting
                    || (geladen.paket?.settings || []).some(e => e.key === 'loader') ? 'loader' : null;
                if (!schluessel) return null;
                try {
                    const w = typeof geladen.server?.paket_werte === 'string'
                        ? JSON.parse(geladen.server.paket_werte) : (geladen.server?.paket_werte || {});
                    return w[schluessel] || null;
                } catch { return null; }
            })(),
            pfad: inhalt?.path || null,
            // Was das Paket WOERTLICH nennt — auch `upload` und Anbieter, die
            // dieses Dashboard noch nicht kann.
            quellenImPaket: inhalt?.sources || [],
            reihenfolgeZaehlt: Boolean(inhalt?.order_matters),
            // Kennt dieses Spiel Modpacks? Die Karte bietet den Abschnitt nur
            // dann an — und zwar auch, wenn noch keines liegt (2026-09-23).
            modpackMoeglich: kenntModpacks(geladen.paket),
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
 * Welcher Anbieter ist gemeint — und hat das Spiel ihn ueberhaupt?
 *
 * Gibt entweder den Namen zurueck oder eine fertige Absage. Drei Faelle, drei
 * verschiedene Saetze: Das Spiel nimmt gar keine Inhalte; es kennt diesen
 * Anbieter nicht; es sagt nicht, welcher Teil seines Katalogs zu ihm gehoert.
 * Eine gemeinsame Meldung („geht nicht") liesse den Betreiber raten, was zu tun
 * ist — und zu tun ist bei allen dreien etwas anderes.
 *
 * @returns {{quelle: string, raum: string}|{absage: true}}
 */
function quelleWaehlen(res, inhalt, gewuenscht) {
    if (!inhalt?.supported) {
        res.status(409).json({ success: false,
            message: 'Dieses Spiel nimmt laut seinem Paket keine Inhalte auf.' });
        return { absage: true };
    }
    const quelle = Quellen.waehle(inhalt, gewuenscht);
    if (!quelle) {
        const moeglich = Quellen.ausPaket(inhalt);
        res.status(409).json({ success: false,
            message: gewuenscht
                ? `Das Paket nennt ${gewuenscht} nicht als Quelle.`
                  + (moeglich.length ? ` Möglich wäre: ${moeglich.join(', ')}.` : '')
                : 'Das Paket nennt keine Quelle, aus der sich Inhalte holen lassen.' });
        return { absage: true };
    }
    const raum = Quellen.raumAus(inhalt, quelle);
    if (!raum) {
        const anbieter = Quellen.fuer(quelle);
        res.status(409).json({ success: false,
            message: `Das Paket sagt nicht, welche ${anbieter.RAUM_NAME} bei ${anbieter.TITEL} `
                   + `zu diesem Spiel gehört (content.source_ids.${quelle}).` });
        return { absage: true };
    }
    return { quelle, raum };
}

/**
 * Suchen fuer ein Spiel, das noch keinen Server hat — der Schritt „Mods" beim
 * Anlegen.
 *
 * Muss VOR den `/:serverId/...`-Routen stehen: `mods` waere sonst eine
 * Server-Kennung.
 */
/**
 * Modpacks suchen — beim Anlegen, bevor ein Lader feststeht.
 *
 * ── Warum eine eigene Route und nicht `mods/suche` mit einem Schalter ───────
 *
 * Ein Modpack ist kein Inhalt eines Servers, sondern eine Bauentscheidung: Es
 * bestimmt Lader UND Spielfassung (gemessen am 2026-09-22: `loaders:
 * ["fabric"], game_versions: ["26.3"]`). Es hat deshalb keinen Raum, keinen
 * Ablageort und keinen Server — die drei Dinge, um die sich `mods/suche` dreht.
 *
 * Und es braucht KEINEN Lader als Eingabe. Im Gegenteil: Nach Lader zu filtern
 * waere hier falsch herum, und die Kategorie bei Modrinth luegt ohnehin — das
 * Paket „MAX FPS" steht unter `categories:neoforge` und verlangt `fabric-loader`.
 */
router.get('/modpacks/suche', requirePermission('GAMESERVER.CREATE'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    try {
        const Modrinth = require('../helpers/Modrinth');
        const treffer = await Modrinth.sucheModpacks(req.query.q, { seite: req.query.seite });
        return res.json({ success: true, ...treffer });
    } catch (error) {
        Logger.warn('[Gameserver/Inhalte] Modpack-Suche fehlgeschlagen:', error);
        return res.status(502).json({ success: false, message: error.message });
    }
});

/**
 * Was dieses Modpack VORSCHREIBT — Lader und Spielfassung.
 *
 * Die Auswahlseite fragt hier nach, sobald jemand ein Paket anklickt: Sie zeigt
 * danach „Fabric · 26.3" statt eines leeren Laderfeldes. Die Anlegeroute
 * fragt dieselbe Stelle noch einmal — was der Browser schickt, ist ein
 * Vorschlag, keine Auskunft.
 */
router.get('/modpacks/fassung', requirePermission('GAMESERVER.CREATE'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    try {
        const Modrinth = require('../helpers/Modrinth');
        const f = await Modrinth.modpackFassung(req.query.kennung, req.query.fassung || null);
        return res.json({ success: true, modpack: f });
    } catch (error) {
        Logger.warn('[Gameserver/Inhalte] Modpack-Fassung fehlgeschlagen:', error);
        return res.status(400).json({ success: false, message: error.message });
    }
});

router.get('/mods/suche', requirePermission('GAMESERVER.CREATE'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');

    try {
        // Die Modsuche beim ANLEGEN — dieselbe Fassung, mit der der Server entstünde.
        const paketZeile = await ladePaketFuerAnlegen(dbService, parseInt(req.query.addon_id, 10), res.locals.guildId);
        const roh = paketZeile
            ? (typeof paketZeile.paket_json === 'string'
                ? JSON.parse(paketZeile.paket_json) : paketZeile.paket_json)
            : null;
        // Hier gibt es noch keinen Server und also keine `paket_werte` — der
        // Lader steht im Formular und kommt als Abfrageteil mit. Ohne ihn bleibt
        // `content` auf `supported: false`, und die Suche sagt „dieses Spiel
        // nennt keinen Katalog": richtig, solange niemand einen Lader gewaehlt
        // hat (Stufe 3, Minecraft).
        const paket = loeseInhaltAuf(roh, req.query.lader ? { loader: req.query.lader } : {});
        const inhalt = paket?.content || null;

        const gewaehlt = quelleWaehlen(res, inhalt, req.query.quelle);
        if (gewaehlt.absage) return;

        // Hier gibt es noch keinen Server und also keine installierte Ausgabe:
        // Beim Anlegen ist „latest" noch ein Wunsch. Deshalb KEIN Fassungsfilter
        // — die Karte sagt das auch („Ausgabe unbekannt"). Fuer den Server
        // selbst filtert die Suche weiter unten sehr wohl.
        return res.json(await sucheAntwort(inhalt, gewaehlt.quelle, gewaehlt.raum,
            req.query.q, req.query.seite));
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
async function sucheAntwort(inhalt, quelle, raum, begriff, seite, spielfassung = null) {
    const anbieter = Quellen.fuer(quelle);
    const roh = await anbieter.suche(raum, begriff || '', { seite, spielfassung });
    return {
        success: true,
        // Was gefiltert wurde, gehoert in die Antwort: Sonst steht in der Karte
        // eine Trefferzahl, und niemand weiss, wogegen sie gilt.
        spielfassung: spielfassung || null,
        quelle,
        titel: anbieter.TITEL,
        raum,
        gestoebert: !String(begriff || '').trim(),
        lader: inhalt.loader?.packages?.[quelle] || null,
        // Wie viel es hier ueberhaupt gibt — die Frage stellt sich jeder, der
        // ein Spiel noch nicht kennt, und ohne Antwort blaettert er blind.
        gesamt:   roh.gesamt,
        seite:    roh.seite,
        seiten:   Math.max(1, Math.ceil(roh.gesamt / (roh.proSeite || 20))),
        weiter:   roh.weiter,
        zurueck:  roh.zurueck,
        // Wer wirklich stoebern will, ist im Verzeichnis besser aufgehoben als
        // in einer Karte mit 20 Zeilen.
        verzeichnis: anbieter.verzeichnis(raum),
        treffer: roh.treffer.map(t => ({
            ...t,
            url: Inhalte.paketAdresse({ quelle, kennung: t.kennung }, raum),
        })),
    };
}

/**
 * Welche Spielfassung laeuft auf diesem Server?
 *
 * ── Warum das die Suche braucht (Betreiber, 2026-09-22) ─────────────────────
 *
 * *„eigentlich müsste die modrinth mod seite nun mods aus modrinth zeigen die
 * mit neoforge kompatibel sind."*
 *
 * Nach dem LADER filtert sie schon (`content.source_ids.modrinth`). Nach der
 * FASSUNG nicht — und das ist der groessere Teil: Gemessen am 2026-09-22 hat
 * der neoforge-Raum 28 891 Projekte, davon passen zu Ausgabe 26.2 genau
 * **6 109**. Vier von fuenf Treffern liessen sich also gar nicht installieren,
 * und man erfuehre es erst beim Klick („keine Fassung fuer diesen Server").
 *
 * ── Woher die Fassung kommt, in dieser Reihenfolge ──────────────────────────
 *
 *  1. Aus den Werten des Servers — aber nur, wenn dort eine ECHTE Nummer steht.
 *     „latest" ist keine: Es ist ein Wunsch, und was daraus wurde, entscheidet
 *     die Installation.
 *  2. Vom Merkzettel `.fb/minecraft-version`, den das Installationsskript
 *     schreibt. Das ist die einzige Stelle, die die Antwort wirklich kennt.
 *  3. Gar nicht. Dann wird NICHT gefiltert, und die Karte sagt es — lieber zu
 *     viele Treffer mit einem Hinweis als zu wenige ohne Erklaerung.
 *
 * Der Abruf kostet einen Daemon-Aufruf je Suche. Das ist vertretbar: Eine Suche
 * stoesst ein Mensch an, kein Takt.
 */
async function spielfassungVonServer(ipmServer, dbService, geladen) {
    const ausWerten = String(paketWerte(geladen).version || '').trim();
    if (ausWerten && ausWerten !== 'latest') return ausWerten;
    return merkzettel(ipmServer, dbService, geladen, 'minecraft-version');
}

/**
 * Mit welchem Lader laeuft dieser Server?
 *
 * Dieselben drei Stufen wie bei der Fassung, und aus demselben Grund: Der Wert
 * in den Einstellungen ist die ABSICHT, der Merkzettel in `.fb` das Ergebnis.
 * Sie koennen auseinanderlaufen — `latest` ist der offensichtliche Fall, aber
 * auch ein Server, dessen Einstellung nach der Installation geaendert wurde,
 * laeuft bis zum naechsten Mal noch mit dem alten Lader.
 *
 * Fuer die Modpack-Suche ist das der entscheidende Wert: Ein Paket, das zum
 * EINGESTELLTEN statt zum LAUFENDEN Lader passt, waere genau die halbe Auskunft,
 * die schlimmer ist als keine.
 */
async function laderVonServer(ipmServer, dbService, geladen) {
    const vomMerkzettel = await merkzettel(ipmServer, dbService, geladen, 'minecraft-lader');
    if (vomMerkzettel) return vomMerkzettel;
    return String(paketWerte(geladen).loader || '').trim() || null;
}

/** Die Einstellungen dieses Servers, wie sie in `gameservers.paket_werte` stehen. */
function paketWerte(geladen) {
    try {
        return typeof geladen.server?.paket_werte === 'string'
            ? JSON.parse(geladen.server.paket_werte) : (geladen.server?.paket_werte || {});
    } catch {
        return {};
    }
}

/**
 * Ein Merkzettel des Installationsskripts aus `.fb`.
 *
 * Eine Funktion statt zweier fast gleicher: Die Fassung und der Lader liegen
 * nebeneinander im selben Ordner, werden gleich gelesen und gleich zerlegt.
 * Zwei Fassungen davon waeren zwei Stellen, an denen die Base64-Falle aus
 * Baustelle 135 wieder einziehen kann — einmal korrigiert, einmal nicht.
 */
async function merkzettel(ipmServer, dbService, geladen, name) {
    try {
        const daemonId = await daemonVon(dbService, geladen.server);
        if (!daemonId || !ipmServer?.isDaemonOnline(daemonId)) return null;
        const gelesen = await ipmServer.sendCommand(daemonId, 'gameserver.files.read', {
            server_id: String(geladen.server.id),
            rootserver_id: String(geladen.server.rootserver_id),
            install_path: geladen.server.install_path,
            path: `/.fb/${name}`,
        }, 8000).catch(() => null);
        if (!gelesen?.success) return null;
        // Der Daemon liefert Base64, immer (Baustelle 135).
        const text = Buffer.from(String(gelesen.data?.content || ''), 'base64').toString('utf8');
        return text.trim().split(/\s+/)[0] || null;
    } catch {
        return null;
    }
}

/** Suchen fuer einen bestehenden Server. */
router.get('/:serverId/inhalte/suche', requirePermission('GAMESERVER.VIEW'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');

    try {
        const geladen = await ladeServerUndPaket(dbService, req.params.serverId, res.locals.guildId);
        if (!geladen) return res.status(404).json({ success: false, message: 'Server nicht gefunden' });

        const inhalt = geladen.paket?.content || null;
        const gewaehlt = quelleWaehlen(res, inhalt, req.query.quelle);
        if (gewaehlt.absage) return;

        // Die Fassung dieses Servers geht mit — sonst zeigt die Suche Mods, die
        // sich gar nicht installieren lassen (2026-09-22).
        const fassung = await spielfassungVonServer(
            ServiceManager.get('ipmServer'), dbService, geladen);
        return res.json(await sucheAntwort(inhalt, gewaehlt.quelle, gewaehlt.raum,
            req.query.q, req.query.seite, fassung));
    } catch (error) {
        // 502, nicht 500: Der Fehler liegt beim fremden Dienst, nicht bei uns —
        // und die Meldung sagt das auch, statt „Serverfehler" zu behaupten.
        Logger.warn('[Gameserver/Inhalte] Suche fehlgeschlagen:', error);
        return res.status(502).json({ success: false, message: error.message });
    }
});

/**
 * Modpacks fuer DIESEN Server suchen (Betreiber, 2026-09-23).
 *
 * *„ueber den mods tab. passend zum lader wie das mod pack selbst. also wenn
 * die such zeile in modrinth eben auch modpacks anzeigen wuerde dann koennte
 * sie die auf dem gleichen weg filtern wie schon die mods selber nur eben als
 * paket."*
 *
 * Genau so. Der Unterschied zur Suche beim Anlegen (`/modpacks/suche`, weiter
 * oben) ist nicht die Adresse, sondern die Richtung:
 *
 *   Beim Anlegen   das Modpack BESTIMMT Lader und Fassung — nicht filtern
 *   Hier           der Server HAT beide — filtern, und zwar hart
 *
 * „Hart" heisst: Was nicht passt, steht nicht in der Liste. Dieselbe Regel wie
 * bei der Mod-Suche seit dem 2026-09-22 — ein Treffer, den man nicht
 * installieren kann, ist kein Treffer.
 *
 * Womit gefiltert wird und warum die Modrinth-Kategorie dafuer NICHT taugt,
 * steht an `Modrinth.sucheModpacks`.
 */
router.get('/:serverId/inhalte/modpacks/suche', requirePermission('GAMESERVER.VIEW'),
    async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const ipmServer = ServiceManager.get('ipmServer');

    try {
        const geladen = await ladeServerUndPaket(dbService, req.params.serverId, res.locals.guildId);
        if (!geladen) return res.status(404).json({ success: false, message: 'Server nicht gefunden' });

        // Nur wo das Paket Modpacks ueberhaupt kennt. Die Einstellung `modpack`
        // ist der Beleg dafuer — sie steht heute nur im Minecraft-Paket, und
        // das ist eine Eigenschaft des Pakets, keine Annahme ueber das Spiel.
        if (!kenntModpacks(geladen.paket)) {
            return res.json({ success: true, unterstuetzt: false, treffer: [],
                grund: 'Dieses Spiel kennt laut seinem Paket keine Modpacks.' });
        }

        const lader = await laderVonServer(ipmServer, dbService, geladen);
        const spielfassung = await spielfassungVonServer(ipmServer, dbService, geladen);

        // ── Ohne bekannten Lader wird NICHT gesucht ────────────────────────
        //
        // Und das ist der Unterschied zur Spielfassung, wo ein Nichtwissen nur
        // den Filter kostet: Ein Modpack fuer den falschen Lader laesst sich
        // nicht installieren, sondern nur neu installieren. Eine Liste, die das
        // nicht wissen kann, waere eine Einladung zum Fehlgriff.
        if (!lader) {
            return res.json({ success: true, unterstuetzt: false, treffer: [],
                grund: 'Der Lader dieses Servers steht noch nicht fest — er wird beim '
                     + 'Installieren gesetzt. Nach der ersten Installation geht es hier weiter.' });
        }

        const Modrinth = require('../helpers/Modrinth');
        const treffer = await Modrinth.sucheModpacks(req.query.q, {
            seite: req.query.seite, lader, spielfassung,
        });

        return res.json({ success: true, unterstuetzt: true, lader, spielfassung, ...treffer });
    } catch (error) {
        Logger.warn('[Gameserver/Inhalte] Modpack-Suche fehlgeschlagen:', error);
        return res.status(502).json({ success: false, message: error.message });
    }
});

/**
 * Ein Modpack auf diesen Server legen.
 *
 * Kein eigener Vorschau-Schritt wie bei den Mods: Was mitkommt, ist beim
 * Modpack die ganze Frage — es BESTEHT aus seinen Abhaengigkeiten. Was der
 * Betreiber vorher wissen muss (Lader, Spielfassung, Groesse), steht schon an
 * der Karte; was danach zaehlt (wie viele Dateien, wie viele als reine
 * Client-Dateien ausgelassen wurden), steht in der Antwort.
 */
router.post('/:serverId/inhalte/modpack', requirePermission('GAMESERVER.FILES.MANAGE'),
    async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const ipmServer = ServiceManager.get('ipmServer');

    try {
        const geladen = await ladeServerUndPaket(dbService, req.params.serverId, res.locals.guildId);
        if (!geladen) return res.status(404).json({ success: false, message: 'Server nicht gefunden' });

        if (!kenntModpacks(geladen.paket)) {
            return res.status(400).json({ success: false,
                message: 'Dieses Spiel kennt laut seinem Paket keine Modpacks.' });
        }
        if (!req.body?.kennung) {
            return res.status(400).json({ success: false, message: 'kennung fehlt' });
        }

        // ── Was der Browser schickt, ist ein Vorschlag ─────────────────────
        //
        // Die Fassung wird hier NEU erfragt statt aus dem Rumpf uebernommen:
        // Lader, Spielfassung, Adresse und Pruefsumme kommen damit aus der
        // Quelle und nicht aus einer Trefferliste, die der Browser seit fuenf
        // Minuten offen hat. Dieselbe Regel gilt beim Anlegen (Stufe 3).
        const Modrinth = require('../helpers/Modrinth');
        const paket = await Modrinth.modpackFassung(
            String(req.body.kennung), req.body.fassung ? String(req.body.fassung) : null);

        const lader = await laderVonServer(ipmServer, dbService, geladen);
        const ergebnis = await InhalteHolen.installiereModpack({
            server: geladen.server, guildId: res.locals.guildId,
            paket, laderDesServers: lader,
        });

        if (!ergebnis.success) {
            return res.status(502).json({ success: false, message: ergebnis.fehler, ...wirkung(geladen) });
        }

        Logger.info(`[Gameserver/Inhalte] Modpack ${paket.kennung} ${paket.fassung} `
            + `auf Server ${req.params.serverId}`);
        return res.json({ success: true, ...ergebnis, ...wirkung(geladen) });
    } catch (error) {
        Logger.error('[Gameserver/Inhalte] Modpack-Installation fehlgeschlagen:', error);
        return res.status(502).json({ success: false, message: error.message });
    }
});

/**
 * Kennt das Paket dieses Spiels ueberhaupt Modpacks?
 *
 * Gefragt wird die Einstellung `modpack`, nicht der Spielname. Ein Name im Code
 * („wenn Minecraft, dann…") waere beim zweiten Spiel mit Modpacks falsch und
 * beim Umbenennen des ersten auch.
 */
function kenntModpacks(paket) {
    return (paket?.settings || []).some(e => e.key === 'modpack');
}

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
        const gewaehlt = quelleWaehlen(res, inhalt, req.query.quelle);
        if (gewaehlt.absage) return;

        const schau = await InhalteHolen.vorschau({
            serverId: req.params.serverId, inhalt, quelle: gewaehlt.quelle,
            kennung: req.query.kennung, fassung: req.query.fassung || null,
        });
        return res.json({ success: true, ...schau });
    } catch (error) {
        Logger.warn('[Gameserver/Inhalte] Vorschau fehlgeschlagen:', error);
        return res.status(502).json({ success: false, message: error.message });
    }
});

/**
 * Welche Fassungen gibt es? (Betreiber, 2026-09-23)
 *
 * *„muss noch die versionierung ausprobieren. wenn ich mit verschiedenen
 * versionen anstelle von latest mods mache."*
 *
 * Das ging bis heute nicht — nicht, weil der Weg fehlte, sondern weil ihn
 * niemand kannte: `paket()`, `aufloesen()`, die Vorschau- und die Holroute
 * nahmen eine Fassung alle entgegen, aber **keine Stelle nannte die Auswahl.**
 * Die Oberflaeche schickte deshalb nie eine, und es kam immer die neueste.
 *
 * Gefiltert wird wie bei der Suche: Lader aus dem Paket, Spielfassung vom
 * Server. Eine Fassung, die sich nicht installieren laesst, waere keine Auswahl,
 * sondern ein Fehlgriff mit Ansage.
 */
router.get('/:serverId/inhalte/fassungen', requirePermission('GAMESERVER.VIEW'),
    async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');

    try {
        const geladen = await ladeServerUndPaket(dbService, req.params.serverId, res.locals.guildId);
        if (!geladen) return res.status(404).json({ success: false, message: 'Server nicht gefunden' });

        const inhalt = geladen.paket?.content || null;
        const gewaehlt = quelleWaehlen(res, inhalt, req.query.quelle);
        if (gewaehlt.absage) return;

        if (!req.query.kennung) {
            return res.status(400).json({ success: false, message: 'kennung fehlt' });
        }

        const anbieter = Quellen.fuer(gewaehlt.quelle);
        // Ein Anbieter ohne diese Faehigkeit bekommt keine erfundene Antwort:
        // Der Vertrag sagt, was er kann, und was er nicht kann, steht als Grund
        // da — nicht als leere Liste.
        if (typeof anbieter.fassungen !== 'function') {
            return res.json({ success: true, liste: [], vollstaendig: false,
                grund: `${anbieter.TITEL} kann seine Fassungen nicht aufzählen.` });
        }

        const spielfassung = await spielfassungVonServer(
            ServiceManager.get('ipmServer'), dbService, geladen);

        const ergebnis = await anbieter.fassungen(gewaehlt.raum, String(req.query.kennung),
            { spielfassung });
        return res.json({ success: true, spielfassung, ...ergebnis });
    } catch (error) {
        Logger.warn('[Gameserver/Inhalte] Fassungen nicht abrufbar:', error);
        return res.status(502).json({ success: false, message: error.message });
    }
});

/**
 * Installieren — das Paket samt allem, was es braucht.
 *
 * Die Route hiess bis zum 2026-09-14 `/thunderstore`. Ein Anbietername im
 * PFAD haette bei jedem weiteren Anbieter eine zweite Route ergeben, die
 * dasselbe tut — und die erste waere beim naechsten Fund berichtigt worden und
 * die zweite nicht. Jetzt steht der Anbieter im Rumpf, wo er hingehoert: Er ist
 * eine Angabe, keine andere Handlung.
 */
router.post('/:serverId/inhalte/holen', requirePermission('GAMESERVER.FILES.MANAGE'),
    async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');

    try {
        const { serverId } = req.params;
        const guildId = res.locals.guildId;

        const geladen = await ladeServerUndPaket(dbService, serverId, guildId);
        if (!geladen) return res.status(404).json({ success: false, message: 'Server nicht gefunden' });

        const inhalt = geladen.paket?.content || null;
        const gewaehlt = quelleWaehlen(res, inhalt, req.body?.quelle);
        if (gewaehlt.absage) return;

        if (!req.body?.kennung) {
            return res.status(400).json({ success: false, message: 'kennung fehlt' });
        }

        const ergebnis = await InhalteHolen.installiere({
            server: geladen.server, inhalt, guildId, quelle: gewaehlt.quelle,
            kennung: String(req.body.kennung),
            fassung: req.body.fassung ? String(req.body.fassung) : null,
        });

        Logger.info(`[Gameserver/Inhalte] ${gewaehlt.quelle} ${req.body.kennung} auf Server ${serverId}: `
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
        // Hier wird keine Quelle gewaehlt: Jede vorgemerkte Zeile bringt ihre
        // eigene mit. Geprueft wird nur, dass das Spiel ueberhaupt Inhalte nimmt.
        const gewaehlt = quelleWaehlen(res, inhalt, null);
        if (gewaehlt.absage) return;

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
 * Was hat der Lader beim letzten Start wirklich geladen? (Betreiber, 2026-09-13: B)
 *
 * Gelesen wird die Logdatei, die das PAKET nennt (`content.loader.log`) —
 * ueber die Dateibefehle, die der Daemon schon hat. Warum die Datei und nicht
 * die Konsole, steht in helpers/BepInExLog.js.
 *
 * Kein Fehlerstatus, wenn es nichts auszuwerten gibt: `verfuegbar: false` mit
 * dem Grund. Ein Server ohne Start seit der Installation hat keinen Ladestand,
 * und das ist eine Auskunft, kein Fehler.
 */
router.get('/:serverId/inhalte/ladestand', requirePermission('GAMESERVER.VIEW'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const ipmServer = ServiceManager.get('ipmServer');

    try {
        const geladen = await ladeServerUndPaket(dbService, req.params.serverId, res.locals.guildId);
        if (!geladen) return res.status(404).json({ success: false, message: 'Server nicht gefunden' });

        const nicht = (grund) => res.json({ success: true, verfuegbar: false, grund });
        const lader = geladen.paket?.content?.loader;
        if (!lader?.log) return nicht('Das Paket nennt keine Logdatei des Laders (content.loader.log).');
        if (lader.key !== 'bepinex') return nicht(`Für den Lader „${lader.key}" gibt es noch keine Auswertung.`);

        const daemonId = await daemonVon(dbService, geladen.server);
        if (!daemonId || !ipmServer?.isDaemonOnline(daemonId)) return nicht('Der Daemon ist gerade nicht erreichbar.');

        const pfad = '/' + String(lader.log).replace(/^\/+/, '');
        const ordner = pfad.slice(0, pfad.lastIndexOf('/')) || '/';
        const datei = pfad.slice(pfad.lastIndexOf('/') + 1);
        const nutzlast = {
            server_id: String(geladen.server.id),
            rootserver_id: String(geladen.server.rootserver_id),
            install_path: geladen.server.install_path,
        };

        const liste = await ipmServer.sendCommand(daemonId, 'gameserver.files.list', { ...nutzlast, path: ordner }, 15000)
            .catch(fehler => ({ success: false, error: fehler.message }));
        const eintrag = liste?.success ? (liste.data?.files || []).find(f => f.name === datei && !f.is_dir) : null;
        if (!eintrag) return nicht('Seit der Lader liegt, gab es noch keinen Start — die Logdatei fehlt.');

        const gelesen = await ipmServer.sendCommand(daemonId, 'gameserver.files.read', { ...nutzlast, path: pfad }, 15000)
            .catch(fehler => ({ success: false, error: fehler.message }));
        if (!gelesen?.success) {
            return nicht('Die Logdatei ließ sich nicht lesen: ' + (gelesen?.error || 'keine Antwort'));
        }

        // ── Der Daemon liefert Base64, immer (Baustelle 135, 2026-09-17) ────
        //
        // `HandleFileRead` in `internal/gameserver/files.go` endet mit
        // `base64.StdEncoding.EncodeToString(content)`. Hier stand bis heute
        // der rohe Wert im Parser — der findet in Base64 keine einzige
        // `[Message: BepInEx]`-Zeile und kein `Chainloader startup complete`.
        //
        // Folge: `vollstaendig` war IMMER false, jede Modzeile bekam „kommt im
        // Log nicht vor", und die Seite schrieb bei jedem Server und jedem
        // Start „das Laden wurde nicht abgeschlossen". Eine falsche Auskunft,
        // die wie eine richtige aussah — der Betreiber hat ihr geglaubt und
        // nach einem Mod-Fehler gesucht, den es an der Stelle nicht gab.
        //
        // Die beiden anderen Aufrufer derselben Antwort (`routes/files.js`,
        // Zeile 164 und 505) dekodieren seit jeher. Nur dieser nicht.
        const text = Buffer.from(String(gelesen.data?.content || ''), 'base64').toString('utf8');
        const ergebnis = BepInExLog.werteAus(text);
        const zuordnung = BepInExLog.ordneZu(ergebnis, await Inhalte.fuerServer(req.params.serverId), eintrag.mod_time);

        return res.json({
            success: true, verfuegbar: true,
            stand: eintrag.mod_time || null,
            vollstaendig: ergebnis.vollstaendig,
            bepinex: ergebnis.bepinex,
            pack: ergebnis.pack,
            // Der Stand der Spieldateien — die andere Haelfte von Vorschlag A.
            // Er steht in derselben Zeile wie die BepInEx-Fassung, wird also
            // ohne einen zweiten Griff zum Daemon mitgelesen.
            spiel: ergebnis.spiel,
            laeuft: wirkung(geladen).laeuft,
            ...zuordnung,
        });
    } catch (error) {
        Logger.error('[Gameserver/Inhalte] Ladestand nicht auswertbar:', error);
        return res.status(500).json({ success: false, message: 'Serverfehler' });
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

        const inhalt = geladen.paket?.content || null;
        const namen = Object.keys(Quellen.ANBIETER);
        const zeilen = await dbService.query(
            `SELECT id, kennung, fassung, quelle,
                    DATE_FORMAT(veroeffentlicht, '%Y-%m-%d') AS veroeffentlicht
               FROM gameserver_content
              WHERE server_id = ? AND status = 'installiert'
                AND quelle IN (${namen.map(() => '?').join(', ')})`,
            [req.params.serverId, ...namen]
        );
        if (!zeilen.length) return res.json({ success: true, stand: [] });

        // Je Anbieter EIN Aufruf mit seinen Zeilen: Er kennt seine Frist, seine
        // Ratengrenze und seine Art, „neuer" zu entscheiden. Ein Anbieter, der
        // gerade nicht antwortet, nimmt die anderen nicht mit — seine Zeilen
        // tragen dann den Grund.
        const stand = [];
        for (const name of namen) {
            const seine = zeilen.filter(z => z.quelle === name);
            if (!seine.length) continue;
            const raum = Quellen.raumAus(inhalt, name);
            try {
                stand.push(...await Quellen.fuer(name).aktualisierungen(raum, seine));
            } catch (fehler) {
                Logger.warn(`[Gameserver/Inhalte] ${name} nicht abfragbar: ${fehler.message}`);
                for (const z of seine) {
                    stand.push({ id: z.id, kennung: z.kennung, installiert: z.fassung,
                        neueste: null, neuer: false, fehler: fehler.message });
                }
            }
        }
        return res.json({ success: true, stand });
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

        const [zeile] = await dbService.query(
            `SELECT *, DATE_FORMAT(veroeffentlicht, '%Y-%m-%d') AS veroeffentlicht
               FROM gameserver_content WHERE id = ? AND server_id = ?`,
            [id, serverId]
        );
        if (!zeile) return res.status(404).json({ success: false, message: 'Eintrag nicht gefunden' });

        // Eine hochgeladene Datei hat keinen Anbieter, den man fragen koennte.
        if (!Quellen.gibtEs(zeile.quelle)) {
            return res.status(409).json({ success: false,
                message: 'Dieser Eintrag kam nicht aus einem Katalog — für ihn gibt es keine '
                       + 'Fassung zum Nachschlagen.' });
        }
        const gewaehlt = quelleWaehlen(res, inhalt, zeile.quelle);
        if (gewaehlt.absage) return;

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
        let weg = { bestaetigt: 0, gesamt: 0, blieb: [], ohneListe: false };
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

        // `bestaetigtWeg` statt `dateien`: Der Daemon meldet auch Erfolg, wenn
        // die Datei schon fehlte (siehe entferneDateien). Die Zahl sagt „dort
        // liegt nichts mehr", nicht „so viel haben wir geloescht".
        return res.json({ success: true, dateiWeg: weg.bestaetigt > 0,
                          bestaetigtWeg: weg.bestaetigt, hinweis, ...wirkung(geladen) });
    } catch (error) {
        Logger.error('[Gameserver/Inhalte] Entfernen fehlgeschlagen:', error);
        return res.status(500).json({ success: false, message: 'Serverfehler' });
    }
});

module.exports = router;
