/**
 * Gameserver Management Routes
 * CRUD für Gameserver-Instanzen
 * @module routes/servers
 * @author FireBot Team
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { ServiceManager } = require('dunebot-core');
const StatusService = require('../helpers/StatusService');
const { buildStartPayload, loadServerForStart, baueInstallNutzlast,
        paketWerteAnlegen, autoUpdateAus, istWahr } = require('../helpers/StartPayload');
// Welche Paketfassung gilt — für einen Server, beim Anlegen — steht in EINER
// Datei (Baustelle 172). Hier wird nur noch gefragt.
const { FASSUNG_FUER_SERVER, ladePaketFuerServer, ladePaketFuerAnlegen, ladePaketeZuServern,
        ladePaketeFuerAnlegen, kanalSetzen, istKontrollGuild } = require('../helpers/Paketfassung');
const { vergibPortsAusPaket } = require('../helpers/Portvergabe');
const Inhalte = require('../helpers/Inhalte');
const Quellen = require('../helpers/Quellen');
const ServerStopp = require('../helpers/ServerStopp');
const { baueUebersicht, baueServerListe, bauePaketAuswahl,
        baueMaschinenAuswahl, baueWerteSchritt,
        baueBereitschaftAuskunft, bauePlatz,
        baueMesswerte } = require('../helpers/Serverseite');
const { resolveStatusConfig } = require('../helpers/StatusSchema');
// ── Wieder eingehaengt am 2026-09-17 (Baustelle 137) ────────────────────────
//
// `69bedad` ("Egg-Weg raus", 2026-09-11) hat diesen Import entfernt und den
// AUFRUF in der Bearbeiten-Route stehen lassen. Seither warf `GET
// /:serverId/edit` einen ReferenceError und antwortete mit 500 — bei jedem
// Server, eine Woche lang, bis es jemand anklickte.
//
// Der Aufruf gehoert dorthin: Die Bearbeiten-Seite zeigt den ALTBESTAND
// (`frozen_game_data`) und kennzeichnet, welche Variablen nirgends vorkommen
// (Konzept 23.2 — kennzeichnen, nicht verstecken). Das ist eine Hilfe beim
// Aufraeumen und nicht der Egg-Weg beim Anlegen oder Starten, den 69bedad
// beseitigt hat.
const PanelService = require('../helpers/PanelService');
const { validateCommand, rateLimiter } = require('../helpers/CommandFilter');
const { resolveConsoleTransport } = require('../helpers/ConsoleTransport');
// const TemplateEngine = require('../helpers/TemplateEngine'); // ENTFERNT - existiert nicht mehr
// const PortValidator = require('../helpers/PortValidator'); // ENTFERNT - existiert nicht mehr

// ✅ PERMISSION-MIDDLEWARE IMPORTIEREN
const { requirePermission, loadUserPermissions } = require('../../../../apps/dashboard/middlewares/permissions.middleware');
// Tags eines Spiels — sie stehen im Anlege-Assistenten, wo bis zum 2026-10-08 die Kategorie stand.
const Tags = require('../../../../apps/dashboard/helpers/Tags');

// ── „Für den Server läuft schon eine Installation" (2026-10-01) ─────────────
// Der Daemon lehnt einen zweiten Auftrag mit `code: install_laeuft` ab. Das ist
// kein Fehler: Die laufende Installation geht weiter — oft wartet sie auf eine
// Eingabe (Hytale: Anmeldecode des Downloaders, steht in der Konsole).
const INSTALL_LAEUFT_TEXT = 'Die Installation läuft noch. Sie wartet vermutlich auf etwas — sieh in die Konsole, '
    + 'dort steht ihre Ausgabe (z.B. ein Anmeldecode).';
async function installLaeuftNoch(dbService, serverId) {
    await dbService.query(
        "UPDATE gameservers SET status = 'installing', error_message = NULL WHERE id = ?", [serverId]);
}

// ✅ WICHTIG: Permission-Middleware für ALLE Guild-Routes laden!
router.use(loadUserPermissions);

/**
 * Formular-Wert in einen Boolean übersetzen.
 *
 * Selects/Hidden-Felder liefern Strings – "0", "false" und "" sind in JS aber
 * truthy bzw. uneinheitlich. Ohne diese Normalisierung landen Schalter falsch
 * in der DB (auto_update stand deshalb immer auf 1).
 *
 * @param {*} value
 * @param {boolean} [fallback=false] - Wert wenn nichts übergeben wurde
 * @returns {boolean}
 */
function toBool(value, fallback = false) {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    const v = String(value).trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'on' || v === 'yes';
}

// `ladePaketeZuServern` stand hier bis zum 2026-10-07 und lud je ADDON ein Paket.
// Seit ein Server einem Kanal folgt, hat jeder Server seine Fassung — die
// Funktion wohnt jetzt in helpers/Paketfassung.js und ordnet nach Server.

/**
 * GET /guild/:guildId/plugins/gameserver/servers
 * Server-Übersicht - Card-Grid mit Live-Status (NEU!)
 */
router.get('/', requirePermission('GAMESERVER.VIEW'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const themeManager = ServiceManager.get('themeManager');
    
    try {
        const guildId = res.locals.guildId;
        const user = res.locals.user;
        
        // ========================================
        // 1. FILTER-PARAMETER aus Query-String
        // ========================================
        const statusFilter = req.query.status || 'all';
        const gameFilter = req.query.game || 'all';
        const searchQuery = req.query.search || '';

        Logger.debug(`[Gameserver] Server-Overview aufgerufen für Guild ${guildId}`, {
            statusFilter,
            gameFilter,
            searchQuery
        });

        // ========================================
        // 2. SERVER-LISTE mit JOINs
        // ========================================
        let query = `
            SELECT 
                gs.id,
                gs.name,
                gs.status,
                gs.error_message,
                gs.current_players,
                gs.max_players,
                gs.addon_marketplace_id,
                gs.template_name,
                gs.addon_version,
                -- Ohne diese drei zeigte die Bereitschaftskarte "noch nicht
                -- gemeldet", obwohl die Stufe in der Zeile stand. Der Handler
                -- schrieb sie, die Ansicht las sie nur nie (2026-08-23).
                gs.bereitschaft_stufe,
                gs.bereitschaft_grund,
                gs.bereitschaft_am,
                gs.bereitschaft_bereit,
                -- Der gemessene Platz (B101). Er steht seit der Migration
                -- 20260921_160000 in derselben Zeile; vorher lag er in
                -- server_registry und kam dort nie an (Baustelle 146).
                gs.platz_belegt_bytes,
                gs.platz_grenze_bytes,
                gs.platz_gemessen_am,
                gs.platz_ueber,
                gs.platz_geschaetzt,
                -- Die Live-Messwerte (CPU, RAM, Verkehr). Sie standen bis zum
                -- 2026-09-21 in der toten server_registry und wurden hier nie
                -- geholt — baueKennzahlen lieferte deshalb immer null.
                -- (Keine Backticks in dieser Abfrage: Template-Literal.)
                gs.cpu_percent,
                gs.ram_used_mb,
                gs.ram_total_mb,
                gs.last_heartbeat,
                gs.net_rx_bytes,
                gs.net_tx_bytes,
                gs.net_rx_rate,
                gs.net_tx_rate,
                gs.install_progress,
                gs.install_phase,
                gs.paket_werte,
                gs.update_available,
                gs.created_at,
                gs.last_started_at,
                gs.rootserver_id,
                gs.ports,
                gs.bind_ip,
                am.name as game_name,
                am.slug as game_slug,
                am.icon_url as game_icon,
                JSON_EXTRACT(gs.ports, '$.game.internal') as game_port,
                r.host as server_ip,
                r.fqdn,
                r.fqdn_gilt,
                r.name as rootserver_name,
                r.daemon_id
            FROM gameservers gs
            LEFT JOIN addon_marketplace am ON gs.addon_marketplace_id = am.id
            LEFT JOIN rootserver r ON gs.rootserver_id = r.id
            WHERE gs.guild_id = ?
        `;
        const params = [guildId];

        // Status-Filter anwenden
        if (statusFilter !== 'all') {
            query += ' AND gs.status = ?';
            params.push(statusFilter);
        }

        // Game-Filter anwenden
        if (gameFilter !== 'all') {
            query += ' AND am.slug = ?';
            params.push(gameFilter);
        }

        // Such-Filter (Server-Name)
        if (searchQuery) {
            query += ' AND gs.name LIKE ?';
            params.push(`%${searchQuery}%`);
        }

        query += ' ORDER BY gs.created_at DESC';

        const servers = await dbService.query(query, params);

        // ========================================
        // 3. GAME-TYPEN für Filter (mit Count)
        // ========================================
        const gameTypes = await dbService.query(`
            SELECT 
                am.slug as game_slug,
                am.name as display_name,
                COUNT(*) as count
            FROM gameservers gs
            LEFT JOIN addon_marketplace am ON gs.addon_marketplace_id = am.id
            WHERE gs.guild_id = ?
            GROUP BY am.slug, am.name
            ORDER BY count DESC
        `, [guildId]);

        // ========================================
        // 4. STATUS-COUNTS für Filter-Badges
        // ========================================
        const statusCounts = await dbService.query(`
            SELECT 
                status,
                COUNT(*) as count
            FROM gameservers
            WHERE guild_id = ?
            GROUP BY status
        `, [guildId]);

        const counts = {
            all: servers.length,
            online: statusCounts.find(s => s.status === 'online')?.count || 0,
            offline: statusCounts.find(s => s.status === 'offline')?.count || 0,
            starting: statusCounts.find(s => s.status === 'starting')?.count || 0,
            stopping: statusCounts.find(s => s.status === 'stopping')?.count || 0,
            error: statusCounts.find(s => s.status === 'error')?.count || 0,
            installing: statusCounts.find(s => s.status === 'installing')?.count || 0
        };

        // ========================================
        // 5. VIEW rendern - NEU: Card-View (servers-overview)
        // ========================================
        
        // ✅ Scripts für Server-Overview einreihen (NUR für diese View!)
        const assetManager = ServiceManager.get('assetManager');
        if (assetManager) {
            assetManager.enqueueScript('gameserver-sse');
            assetManager.enqueueStyle('gameserver-serverseite');
            assetManager.enqueueScript('gameserver-actions');
            assetManager.enqueueScript('gameserver-overview');
            assetManager.enqueueScript('gameserver-live');
        }
        
        // ── Die Übersicht nach dem Entwurf (Artboard 1) ─────────────────────
        //
        // Sie zeigt eine Spalte, die es vorher nicht gab: BEREITSCHAFT.
        // „Läuft" beantwortet nicht die Frage, die ein Betreiber wirklich hat —
        // ob jemand rein kann.
        // **Der Rueckfall muss dieselbe FORM haben wie das Ergebnis.** Er ist
        // dafuer da, dass die Seite auch dann etwas zeigt, wenn die
        // Aufbereitung scheitert. Fehlt darin ein Feld, das die Ansicht
        // anfasst, macht genau dieser Rueckfall aus einer halben Seite einen
        // 500er - er richtet dann mehr Schaden an als der Fehler, den er
        // abfangen soll. `spiele`, `online` und `spieler` kamen mit den
        // Kennzahl-Kacheln dazu (Baustelle 140).
        let liste = {
            liste: [],
            spiele: [],
            zahlen: { alle: 0, bereit: 0, aus: 0, online: 0, spieler: 0, maschinen: 0 },
        };
        try {
            // Die Pakete zu allen vorkommenden Addons in EINEM Zug — nicht je
            // Zeile eine Abfrage. Bei acht Servern fiele das nicht auf, bei
            // achtzig schon.
            const paketNachServer = await ladePaketeZuServern(dbService, servers);
            liste = baueServerListe(servers, paketNachServer);
        } catch (err) {
            Logger.error('[Gameserver] Serverliste konnte nicht aufbereitet werden', err);
        }

        await themeManager.renderView(res, 'guild/servers-overview', {
            title: 'Gameserver Übersicht',
            liste,
            filter: ['alle', 'bereit', 'aus'].includes(req.query.f) ? req.query.f : 'alle',
            activeMenu: `/guild/${guildId}/plugins/gameserver/servers`,
            servers: servers || [],
            games: gameTypes || [], // ← Template erwartet 'games'
            gameTypes: gameTypes || [], // ← Für Rückwärtskompatibilität
            statusCounts: counts,
            filters: {
                status: statusFilter,
                game: gameFilter,
                search: searchQuery
            },
            guildId,
            user
        });
    } catch (error) {
        Logger.error('[Gameserver] Fehler beim Laden der Server-Übersicht:', error);
        res.status(500).render('error', {
            message: 'Fehler beim Laden der Server-Übersicht',
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
});

/**
 * GET /guild/:guildId/plugins/gameserver/servers/create
 * Server-Erstellungs-Wizard (3 Steps)
 */
router.get('/create', requirePermission('GAMESERVER.CREATE'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const themeManager = ServiceManager.get('themeManager');
    
    try {
        const guildId = res.locals.guildId; // ← Aus res.locals!
        const { user } = req;
        const { addon, step } = req.query;

        Logger.debug(`[Gameserver] Server-Creation Wizard aufgerufen (Step: ${step || 1})`);

        const currentStep = parseInt(step) || 1;

        // Step 1: Basic Information (Name, Addon, Rootserver, Install/Start Options)
        if (currentStep === 1) {
            // ========================================
            // 1. ÖFFENTLICHE ADDONS (Official/Public)
            // ========================================
            const publicAddons = await dbService.query(`
                SELECT 
                    id,
                    slug,
                    name,
                    description,
                    category,
                    icon_url,
                    steam_app_id,
                    rating_avg,
                    rating_count,
                    'public' as addon_type
                FROM addon_marketplace
                WHERE status = 'approved'
                AND (visibility = 'official' OR visibility = 'public')
                ORDER BY rating_avg DESC, name ASC
            `);

            // ========================================
            // 2. EIGENE GUILD-ADDONS (My Addons)
            // ========================================
            const guildAddons = await dbService.query(`
                SELECT 
                    id,
                    slug,
                    name,
                    description,
                    category,
                    icon_url,
                    steam_app_id,
                    rating_avg,
                    rating_count,
                    'guild' as addon_type
                FROM addon_marketplace
                WHERE status = 'approved'
                AND visibility = 'guild'
                AND guild_id = ?
                ORDER BY name ASC
            `, [guildId]);

            // ========================================
            // 3. VERFÜGBARE ROOTSERVERS (für Dropdown)
            // ========================================
            const rootservers = await dbService.query(`
                SELECT 
                    r.id,
                    r.name,
                    r.hostname,
                    r.host as ip_address,
                    r.install_status as status,
                    r.daemon_id,
                    r.cpu_cores,
                    r.cpu_model,
                    r.ram_total_gb,
                    r.ram_usage_gb,
                    r.disk_total_gb,
                    r.disk_usage_gb,
                    r.cpu_usage_percent,
                    r.last_stats_update,
                    r.last_seen as last_heartbeat,
                    r.daemon_status
                FROM rootserver r
                WHERE r.guild_id = ?
                AND r.install_status = 'completed'
                ORDER BY r.cpu_usage_percent ASC, r.created_at DESC
            `, [guildId]);

            Logger.debug(`[Gameserver] Step 1 - Public: ${publicAddons.length}, Guild: ${guildAddons.length}, Rootservers: ${rootservers.length}`);

            // ── Die Auswahl nach dem Entwurf (Artboard 5a) ──────────────────
            //
            // Sie zeigt PAKETE, nicht Addons — und dazu, was ein Paket über sich
            // selbst nicht weiss (`status.open`). Spiele ohne Paket bleiben
            // darunter stehen: Heute hat eines von acht eines, und sie
            // wegzulassen hiesse sieben Spiele unanlegbar zu machen, damit eine
            // Liste sauber aussieht.
            let auswahl = { pakete: [], ohnePaket: [] };
            try {
                // Nur was diese Guild anlegen darf: freigegebene Pakete — und in
                // der Guild des Betreibers auch die Entwürfe (Paketfassung.js).
                const paketZeilen = await ladePaketeFuerAnlegen(dbService, guildId);
                const mitPaket = new Set(paketZeilen.map(z => z.id));
                const alle = [...(publicAddons || []), ...(guildAddons || [])];
                // „Ohne Paket" heisst: es gibt KEINS. Ein Spiel, dessen Paket für
                // diese Guild nur nicht freigegeben ist, gehört nicht in diese
                // Liste — es ist ein Entwurf und erscheint ihr gar nicht.
                const hatPaket = new Set((await dbService.query('SELECT id FROM packages')).map(z => z.id));
                const tagsJeSpiel = await Tags.fuerViele(dbService, 'spiel', paketZeilen.map(z => z.id));
                auswahl = bauePaketAuswahl(paketZeilen, alle.filter(a => !mitPaket.has(a.id) && !hatPaket.has(a.id)), tagsJeSpiel);
            } catch (err) {
                Logger.error('[Gameserver] Spielauswahl konnte nicht aufgebaut werden', err);
            }

            const am1 = ServiceManager.get('assetManager');
            if (am1) am1.enqueueStyle('gameserver-serverseite');

            return await themeManager.renderView(res, 'guild/server-create-step1', {
                title: 'Server anlegen — Spiel wählen',
                auswahl,
                activeMenu: `/guild/${guildId}/plugins/gameserver/servers`,
                publicAddons: publicAddons || [],
                guildAddons: guildAddons || [],
                rootservers: rootservers || [],
                guildId,
                user
            });
        }

        // Step 2: Template & Daemon Server wählen
        if (currentStep === 2 && addon) {
            // Addon mit game_data abrufen
            const [addonData] = await dbService.query(`
                SELECT 
                    id,
                    slug,
                    name,
                    game_data
                FROM addon_marketplace
                WHERE slug = ?
            `, [addon]);

            // ── Kein Ankersatz? Dann sagen, was fehlt ───────────────────────
            //
            // Am 2026-09-22 stand der Betreiber genau hier: Minecraft lag als
            // Paket in `packages`, die Spielwahl zeigte es, und dieser Zweig
            // fand keine Zeile in `addon_marketplace`. Die Seite sagte „Addon
            // nicht gefunden" — und weil sie keinen Status mitgab, stand als
            // Ueberschrift die erfundene 500. Gesucht wurde daraufhin ein
            // Absturz, den es nie gab.
            //
            // Der Satz nennt jetzt die Ursache UND den Griff. `status` geht mit,
            // damit die Seite die Wahrheit ueber sich selbst sagt.
            if (!addonData) {
                Logger.warn(`[Gameserver] Schritt 2: kein Ankersatz in addon_marketplace `
                          + `fuer "${addon}" — Paket ohne Anker ist nicht anlegbar`);
                return res.status(404).render('error', {
                    status: 404,
                    message: `Für „${addon}" fehlt der Ankersatz in der Spieleliste. `
                           + `Das Paket ist da, die Zeile in addon_marketplace nicht — und daran `
                           + `hängt jeder Server (Fremdschlüssel). Abhilfe: `
                           + `node scripts/liefere-pakete.js packages/fbpkg/beispiele/${addon}.json --wirklich`
                });
            }

            // game_data parsen. `?? {}` ist kein Schmuck: Die Spalte kann NULL
            // sein, und ein `null.variables` weiter unten wirft — dann waere es
            // wirklich eine 500.
            let gameData = {};
            try {
                gameData = (typeof addonData.game_data === 'string'
                    ? JSON.parse(addonData.game_data)
                    : addonData.game_data) ?? {};
            } catch (error) {
                Logger.error(`[Gameserver] Fehler beim Parsen von game_data:`, error);
                gameData = { templates: [], requirements: {} };
            }

            // Host-Server (rootserver) für diese Guild abrufen
            const rootservers = await dbService.query(`
                SELECT 
                    r.id,
                    r.name,
                    r.hostname,
                    r.host as ip_address,
                    r.install_status as status,
                    r.daemon_id,
                    r.cpu_cores,
                    r.cpu_model,
                    r.ram_total_gb,
                    r.ram_usage_gb,
                    r.disk_total_gb,
                    r.disk_usage_gb,
                    r.cpu_usage_percent,
                    r.last_stats_update,
                    r.last_seen as last_heartbeat,
                    r.daemon_status
                FROM rootserver r
                WHERE r.guild_id = ?
                AND r.install_status = 'completed'
                ORDER BY r.cpu_usage_percent ASC, r.created_at DESC
            `, [guildId]);

            // ── Maschinen nach dem Entwurf (Artboard 5b) ────────────────────
            //
            // Gezeigt wird das GEBUCHTE, nicht das Benutzte, und geprüft wird
            // das Portpaar. Ist der Nachbarport belegt, taugt die Maschine für
            // dieses Spiel nicht — das gehört gesagt, bevor jemand durch zwei
            // weitere Schritte klickt.
            let maschinen = [];
            let paketFuerWahl = null;
            try {
                const pz = await ladePaketFuerAnlegen(dbService, addonData.id, guildId);
                paketFuerWahl = pz ? (typeof pz.paket_json === 'string'
                    ? JSON.parse(pz.paket_json) : pz.paket_json) : null;

                const roh = await dbService.query(`
                    SELECT r.id, r.name, r.hostname, r.host, r.daemon_status,
                           r.cpu_cores, r.ram_total_gb, r.disk_total_gb,
                           r.fqdn, r.fqdn_gilt
                      FROM rootserver r
                     WHERE r.guild_id = ? AND r.install_status = 'completed'`, [guildId]);

                const gebuchtRoh = await dbService.query(`
                    SELECT rootserver_id,
                           COALESCE(SUM(allocated_ram_mb),0)    AS ram_mb,
                           COALESCE(SUM(allocated_cpu_percent),0) AS cpu,
                           COALESCE(SUM(allocated_disk_gb),0)   AS disk_gb,
                           COUNT(*) AS anzahl
                      FROM gameservers WHERE guild_id = ? GROUP BY rootserver_id`, [guildId]);
                const gebucht = {};
                for (const g of gebuchtRoh) {
                    gebucht[g.rootserver_id] = {
                        ram_mb: Number(g.ram_mb), cpu: Number(g.cpu),
                        disk_gb: Number(g.disk_gb), anzahl: Number(g.anzahl),
                    };
                }

                // Der Portvorrat der Maschinen dieser Guild.
                //
                // `port_allocations` hat KEIN guild_id — die Tabelle hängt an
                // `rootserver_id`. Genau dieser geratene Spaltenname liess die
                // Maschinenwahl monatelang leer bleiben (Baustelle 62a): Der
                // Fehler lief ins catch, die Liste blieb leer, die Seite sagte
                // nichts.
                const vorrat = roh.length
                    ? await dbService.query(
                        `SELECT rootserver_id, port, server_id
                           FROM port_allocations
                          WHERE rootserver_id IN (${roh.map(() => '?').join(',')})`,
                        roh.map(r => r.id))
                    : [];

                maschinen = baueMaschinenAuswahl(roh, gebucht, vorrat, paketFuerWahl);
            } catch (err) {
                Logger.error('[Gameserver] Maschinenauswahl konnte nicht aufgebaut werden', err);
            }

            const am2 = ServiceManager.get('assetManager');
            if (am2) am2.enqueueStyle('gameserver-serverseite');

            return await themeManager.renderView(res, 'guild/server-create-step2', {
                title: 'Server anlegen — Maschine wählen',
                maschinen,
                addonSlug: addonData.slug,
                spielName: paketFuerWahl?.identity?.name || addonData.name,
                activeMenu: `/guild/${guildId}/plugins/gameserver/servers`,
                addon: addonData,
                gameData,
                rootservers: rootservers || [],
                guildId,
                user
            });
        }

        // Step 3: Variablen konfigurieren
        if (currentStep === 3 && addon) {
            // ========================================
            // VEREINFACHT: Kein Template-Index mehr!
            // Addon IST das Template, game_data enthält alles
            // ========================================
            const daemonId = req.query.daemon;

            const [addonData] = await dbService.query(`
                SELECT 
                    id,
                    slug,
                    name,
                    game_data
                FROM addon_marketplace
                WHERE slug = ?
            `, [addon]);

            if (!addonData) {
                Logger.warn(`[Gameserver] Schritt 3: kein Ankersatz in addon_marketplace fuer "${addon}"`);
                return res.status(404).render('error', {
                    status: 404,
                    message: `Für „${addon}" fehlt der Ankersatz in der Spieleliste `
                           + `(addon_marketplace). Siehe Schritt 2.`
                });
            }

            // game_data parsen — `?? {}`, siehe Schritt 2: NULL ist erlaubt, und
            // die Portsuche darunter greift auf `gameData.variables` zu.
            let gameData = {};
            try {
                gameData = (typeof addonData.game_data === 'string'
                    ? JSON.parse(addonData.game_data)
                    : addonData.game_data) ?? {};
            } catch (error) {
                Logger.error(`[Gameserver] Fehler beim Parsen von game_data:`, error);
                gameData = { variables: [], installation: {}, startup: {} };
            }

            Logger.debug(`[Gameserver] Step 3 - Addon: ${addon}, Daemon: ${daemonId}`, {
                hasVariables: !!gameData.variables,
                variableCount: gameData.variables?.length || 0,
                hasStartup: !!gameData.startup?.command
            });

            // ========================================
            // Port-Anforderungen des Addons ermitteln
            // Aus game_data.ports + variables mit daemon_auto_assign
            // ========================================
            const addonPortRequirements = [];
            
            // 1. Explizite Ports aus game_data.ports
            if (gameData.ports && typeof gameData.ports === 'object') {
                for (const [portType, portDef] of Object.entries(gameData.ports)) {
                    addonPortRequirements.push({
                        type: portType,
                        label: portType.charAt(0).toUpperCase() + portType.slice(1) + '-Port',
                        default_value: portDef.default || 27015,
                        protocol: portDef.protocol || 'udp',
                        source: 'ports',
                    });
                }
            }
            // Fallback: mindestens game
            if (!addonPortRequirements.find(p => p.type === 'game')) {
                addonPortRequirements.push({ type: 'game', label: 'Game-Port', default_value: 27015, protocol: 'udp', source: 'fallback' });
            }
            
            // 2. Zusätzliche Ports aus variables mit daemon_auto_assign: true
            if (Array.isArray(gameData.variables)) {
                for (const v of gameData.variables) {
                    if (v.daemon_auto_assign && v.env_variable && v.env_variable.endsWith('_PORT') && v.env_variable !== 'SERVER_PORT') {
                        const portType = v.env_variable.replace(/_PORT$/, '').toLowerCase();
                        // Nicht doppelt einfügen wenn schon aus game_data.ports kommt
                        if (!addonPortRequirements.find(p => p.type === portType)) {
                            addonPortRequirements.push({
                                type: portType,
                                label: (v.name || portType.charAt(0).toUpperCase() + portType.slice(1)) + '-Port',
                                default_value: parseInt(v.default_value, 10) || 0,
                                protocol: 'udp',
                                source: 'variable',
                                env_variable: v.env_variable,
                            });
                        }
                    }
                }
            }

            // ── Werte nach dem Entwurf (Artboard 5c) ────────────────────────
            let werte = { felder: [], aufVorgabe: 0, passiert: {} };
            let paketFuerWerte = null;
            try {
                const pz = await ladePaketFuerAnlegen(dbService, addonData.id, guildId);
                paketFuerWerte = pz ? (typeof pz.paket_json === 'string'
                    ? JSON.parse(pz.paket_json) : pz.paket_json) : null;

                // Die gewählte Maschine samt vorgemerktem Portpaar — dieselbe
                // Rechnung wie in Schritt 2, damit die Adresse unten stimmt.
                let maschine = null;
                const rsId = req.query.rootserver_id;
                if (rsId && paketFuerWerte) {
                    const roh = await dbService.query(`
                        SELECT r.id, r.name, r.hostname, r.host, r.daemon_status,
                               r.cpu_cores, r.ram_total_gb, r.disk_total_gb,
                               r.fqdn, r.fqdn_gilt
                          FROM rootserver r WHERE r.id = ? AND r.guild_id = ?`, [rsId, guildId]);
                    // Dieselbe Rechnung wie in Schritt 2 — also auch derselbe
                    // Vorrat, nach rootserver_id statt nach einer Spalte, die
                    // es nicht gibt.
                    const vorrat = await dbService.query(
                        'SELECT rootserver_id, port, server_id FROM port_allocations WHERE rootserver_id = ?',
                        [rsId]);
                    maschine = baueMaschinenAuswahl(roh, {}, vorrat, paketFuerWerte)[0] || null;
                }
                werte = baueWerteSchritt(paketFuerWerte, maschine, false);
            } catch (err) {
                Logger.error('[Gameserver] Werteschritt konnte nicht aufgebaut werden', err);
            }

            const am3 = ServiceManager.get('assetManager');
            if (am3) am3.enqueueStyle('gameserver-serverseite');

            // Was das Paket zu Mods sagt — der Schritt „Mods" erscheint nur,
            // wenn es sie kennt UND mindestens einen Katalog nennt, den dieses
            // Dashboard fragen kann (Quellen.js). Seit dem 2026-09-14 ist das
            // nicht mehr zwingend Thunderstore.
            const inhaltDesPakets = paketFuerWerte?.content || null;
            const kataloge = Boolean(inhaltDesPakets?.supported)
                ? Quellen.ausPaket(inhaltDesPakets).filter(q => Quellen.raumAus(inhaltDesPakets, q))
                : [];
            const inhalte = {
                unterstuetzt: Boolean(inhaltDesPakets?.supported),
                quellen: kataloge.map(q => ({ kennung: q, titel: Quellen.fuer(q).TITEL })),
                laderName: inhaltDesPakets?.loader?.key || null,
            };

            return await themeManager.renderView(res, 'guild/server-create-step3', {
                title: 'Server anlegen — Werte',
                werte,
                inhalte,
                // Haengt der Inhalt am Lader, kann diese Seite ihn noch nicht
                // kennen — er wird hier gerade gewaehlt. Dann steht dort ein
                // Satz statt einer stillen Luecke (Stufe 3).
                inhalteAmLader: Boolean(paketFuerWerte?.content?.variants),
                addonId: addonData.id,
                addonSlug: addonData.slug,
                rootserverId: req.query.rootserver_id || '',
                spielName: paketFuerWerte?.identity?.name || addonData.name,
                activeMenu: `/guild/${guildId}/plugins/gameserver/servers`,
                addon: addonData,
                gameData, // Direkt das komplette gameData übergeben (mit migrierten Variables)
                addonPortRequirements, // Port-Anforderungen für die UI
                daemonId,
                guildId,
                user
            });
        }

        // Fallback: Redirect zu Step 1
        res.redirect(`/guild/${guildId}/plugins/gameserver/servers/create?step=1`);
    } catch (error) {
        Logger.error('[Gameserver] Fehler im Server-Creation Wizard:', error);
        res.status(500).render('error', {
            message: 'Fehler im Server-Erstellungs-Wizard',
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
});

/**
 * POST /guild/:guildId/plugins/gameserver/servers
 * Server erstellen (Final Step)
 */
router.post('/', requirePermission('GAMESERVER.CREATE'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');

    // Vorgemerkte Ports — VOR dem try, damit der catch-Block unten sie wieder
    // freigeben kann. Bis zum 2026-09-10 stand die Deklaration im try; ein
    // `const` dort ist im catch nicht sichtbar, `typeof` ergab still
    // "undefined", und die Freigabe nach einem Fehlschlag lief nie.
    const allocatedFromPool = {};
    
    try {
        const guildId = res.locals.guildId;
        
        // ✅ NEU: Fields aus 3-Step-Wizard
        const {  
            addon_slug, 
            rootserver_id,
            server_name,
            
            // Step 1 Fields
            run_install,
            start_after,
            
            // Step 3 Resource Limits (optional, null wenn unlimited)
            allocated_ram_mb,
            allocated_cpu_percent,
            allocated_disk_gb,
            
            // Step 3 Advanced Settings
            auto_restart,
            auto_update
        } = req.body;

        Logger.info(`[Gameserver] Server-Erstellung gestartet für Guild ${guildId}`, {
            addon_slug,
            rootserver_id,
            server_name,
            run_install,
            start_after,
            resource_limits: { ram: allocated_ram_mb, cpu: allocated_cpu_percent, disk: allocated_disk_gb }
        });

        // 🔍 DEBUG: Kompletten req.body loggen
        Logger.debug(`[Gameserver] req.body COMPLETE:`, req.body);

        // Validierung
        if (!addon_slug || !rootserver_id || !server_name) {
            Logger.error(`[Gameserver] ❌ Validierung fehlgeschlagen!`, {
                addon_slug: addon_slug || 'MISSING',
                rootserver_id: rootserver_id || 'MISSING',
                server_name: server_name || 'MISSING',
                received_keys: Object.keys(req.body)
            });
            return res.status(400).json({
                success: false,
                message: `Pflichtfelder fehlen: ${!addon_slug ? 'addon_slug ' : ''}${!rootserver_id ? 'rootserver_id ' : ''}${!server_name ? 'server_name' : ''}`
            });
        }
        
        // ========================================
        // Rootserver mit Daemon-Verbindung abrufen
        // ========================================
        const [rootserver] = await dbService.query(`
            SELECT 
                r.id,
                r.name,
                r.daemon_id,
                r.host,
                r.hostname,
                r.system_user
            FROM rootserver r
            WHERE r.id = ?
        `, [rootserver_id]);
        
        if (!rootserver) {
            return res.status(404).json({
                success: false,
                message: 'Rootserver nicht gefunden'
            });
        }
        
        if (!rootserver.daemon_id) {
            return res.status(400).json({
                success: false,
                message: 'Rootserver hat keinen Daemon zugewiesen'
            });
        }
        
        const daemonId = rootserver.daemon_id;  // ← Die Daemon-ID für IPM!

        Logger.debug(`[Gameserver] Rootserver: ${rootserver.name}, Daemon-ID: ${daemonId}`);

        // ════════════════════════════════════════════════════════════════════
        // Ressourcen: Pflichtangabe und Gegenprüfung gegen den RootServer
        //
        // Bis zum 2026-08-02 waren diese Felder optional und wurden nirgends
        // geprüft: alle Bestandsserver hatten NULL, der Daemon startete die
        // Container ohne Limit, und die Ressourcen-Seite zählte 0 % Auslastung,
        // während die Maschine voll lief. Ohne Angabe lässt sich weder buchen
        // noch begrenzen — deshalb sind die drei Werte jetzt verbindlich.
        // ════════════════════════════════════════════════════════════════════
        const ramMB      = parseInt(allocated_ram_mb, 10);
        const cpuPercent = parseInt(allocated_cpu_percent, 10);
        const diskGB     = parseInt(allocated_disk_gb, 10);

        const fehlend = [];
        if (!Number.isFinite(ramMB)      || ramMB      < 512) fehlend.push('Arbeitsspeicher (mind. 512 MiB)');
        if (!Number.isFinite(cpuPercent) || cpuPercent < 10 || cpuPercent > 1600) fehlend.push('CPU-Anteil (10–1600 %)');
        if (!Number.isFinite(diskGB)     || diskGB     < 1)   fehlend.push('Speicherplatz (mind. 1 GiB)');

        if (fehlend.length) {
            return res.status(400).json({
                success: false,
                message: `Ressourcen müssen angegeben werden: ${fehlend.join(', ')}`
            });
        }

        // Passt das noch auf die Maschine? `checkResourceAvailability` rechnet
        // gegen die Quota des RootServers inklusive Überallokation und Reserve
        // und berücksichtigt eine etwaige Obergrenze für die Serveranzahl.
        // CPU wird dort in Kernen geführt (100 % = 1 Kern).
        const RootServerModel = require('../../../masterserver/dashboard/models/RootServer');
        await RootServerModel.ensureQuota(rootserver.id);
        const platz = await RootServerModel.checkResourceAvailability(rootserver_id, {
            ramMB,
            cpuCores: cpuPercent / 100,
            diskGB
        });

        if (!platz.available) {
            const gruende = [];
            if (platz.missing?.ram) {
                gruende.push(`Arbeitsspeicher: ${ramMB} MiB angefordert, ${Math.max(0, Math.round(platz.missing.ram.available))} MiB frei`);
            }
            if (platz.missing?.cpu) {
                gruende.push(`CPU: ${cpuPercent} % angefordert, ${Math.max(0, Math.round(platz.missing.cpu.available * 100))} % frei`);
            }
            if (platz.missing?.disk) {
                gruende.push(`Speicherplatz: ${diskGB} GiB angefordert, ${Math.max(0, Math.round(platz.missing.disk.available))} GiB frei`);
            }
            if (platz.missing?.gameserver_limit) {
                gruende.push(`Serverzahl: ${platz.missing.gameserver_limit.current} von ${platz.missing.gameserver_limit.max} belegt`);
            }

            Logger.warn(`[Gameserver] Anlegen abgelehnt — RootServer ${rootserver.name} hat keinen Platz`, platz.missing);
            return res.status(409).json({
                success: false,
                message: gruende.length
                    ? `Auf "${rootserver.name}" ist nicht genug frei — ${gruende.join('; ')}.`
                    : `Auf "${rootserver.name}" ist nicht genug frei (${platz.reason || 'Kapazität erschöpft'}).`,
                missing: platz.missing || null
            });
        }

        // ── Das Spiel ist ein PAKET ─────────────────────────────────────────
        //
        // Bis zum 2026-09-10 las diese Route das Egg des Addons
        // (`addon_marketplace.game_data`): Installationsskript, Startzeile,
        // Variablen, Ports — und legte das Paket obendrauf. Die Addon-Zeile ist
        // jetzt nur noch der Fremdschlüssel, an dem der Server hängt (bis zum
        // Tabellenschnitt, E-1); gelesen wird aus dem Paket.
        const [addon] = await dbService.query(
            'SELECT id, name, slug, version FROM addon_marketplace WHERE slug = ?',
            [addon_slug]
        );
        if (!addon) {
            return res.status(404).json({
                success: false,
                message: 'Spiel nicht gefunden'
            });
        }

        // Die Fassung, mit der dieser Server ENTSTEHT — und der Kanal, dem er
        // danach folgt: `stable`, wenn es eine freigegebene Fassung gibt; ein
        // Entwurf (`test`) nur in der Guild des Betreibers. Die Auswahl in
        // Schritt 1 zeigt einer fremden Guild keine Entwürfe — hier wird es
        // noch einmal geprüft, weil ein Formular sich auch von Hand abschicken lässt.
        const pz = await ladePaketFuerAnlegen(dbService, addon.id, guildId);
        const paket = pz
            ? (typeof pz.paket_json === 'string' ? JSON.parse(pz.paket_json) : pz.paket_json)
            : null;
        if (!paket) {
            return res.status(400).json({
                success: false,
                message: `Für „${addon.name}" gibt es kein freigegebenes Spielpaket — ohne Paket lässt sich kein Server anlegen.`
            });
        }
        const templateName = paket.identity?.name || addon.name;

        // ── Ports nach dem Paket (Portvergabe.js) ───────────────────────────
        //
        // Jeder Port, den der Server benutzt, wird gebucht — und nur die. Der
        // Egg-Weg daneben (Egg-Ports, Offset-Ports ohne Buchung, `game_plus_1`)
        // ist am 2026-09-10 entfallen.
        let ports;
        try {
            const wunsch = (req.body.game_port && req.body.game_port !== 'auto')
                ? parseInt(req.body.game_port, 10) : null;
            const vergabe = await vergibPortsAusPaket(dbService, rootserver_id, paket, wunsch);
            ports = vergabe.ports;
            Object.assign(allocatedFromPool, vergabe.belegt);
            Logger.info(`[Gameserver] Ports aus dem Paket vergeben: `
                + Object.entries(ports).map(([z, d]) => `${z} ${d.internal}`).join(', '));
        } catch (err) {
            // Hier NICHT weiterlaufen: Ein Server mit falschen Ports startet
            // und ist trotzdem unerreichbar — der teuerste Ausgang.
            Logger.error('[Gameserver] Portvergabe nach dem Paket fehlgeschlagen', err);
            return res.status(400).json({ success: false, message: err.message });
        }

        // ── Die Werte, unter den Schlüsseln des PAKETS ──────────────────────
        //
        // Die Werte-Karte schickt `setting_<schlüssel>`. Was sie nicht fragt,
        // bekommt die Vorgabe des Pakets — danach hat jede Einstellung einen
        // Wert, und kein Start muss raten.
        const eingaben = {};
        for (const [feld, wert] of Object.entries(req.body)) {
            if (feld.startsWith('setting_')) eingaben[feld.slice('setting_'.length)] = wert;
        }
        if (auto_update !== undefined && eingaben.auto_update === undefined) {
            eingaben.auto_update = toBool(auto_update, false) ? '1' : '0';
        }
        // ── Ein Modpack bestimmt Lader und Ausgabe — der Browser nicht ─────
        //
        // Die Auswahlseite zeigt beides an, sobald jemand ein Paket anklickt.
        // Verlassen wird sich darauf NICHT: Was im Formular steht, hat den Weg
        // durch einen fremden Rechner genommen. Gefragt wird hier noch einmal,
        // und das Ergebnis ueberschreibt, was mitgeschickt wurde.
        //
        // Ein Paket fuer Forge oder Quilt wirft dabei — dann bricht das Anlegen
        // ab, statt einen Server zu bauen, der die Haelfte der Mods nicht laedt.
        if (eingaben.modpack) {
            try {
                const Modrinth = require('../helpers/Modrinth');
                const mp = await Modrinth.modpackFassung(eingaben.modpack, eingaben.modpack_version || null);
                eingaben.loader = mp.lader;
                if (mp.spielfassung) eingaben.version = mp.spielfassung;
                eingaben.modpack_version = mp.fassung;
                Logger.info(`[Gameserver] Modpack „${mp.name}" ${mp.fassung}: Lader ${mp.lader}, `
                          + `Ausgabe ${mp.spielfassung || '?'} (${Math.round(mp.bytes / 1024)} KB)`);
            } catch (fehler) {
                Logger.warn('[Gameserver] Modpack abgelehnt:', fehler);
                return res.status(400).json({ success: false, message: fehler.message });
            }
        }

        const paketWerte = paketWerteAnlegen(paket, eingaben, server_name);
        const autoAktualisieren = autoUpdateAus(paket, paketWerte);
        Logger.info(`[Gameserver] Paketwerte festgehalten: ${Object.keys(paketWerte).length} von `
            + `${(paket.settings || []).length} Einstellungen, Auto-Update ${autoAktualisieren ? 'an' : 'aus'}`);

        // User-ID aus Session extrahieren (falls vorhanden)
        const userId = res.locals.user?.id || '0';

        // Gameserver in DB erstellen (erstmal ohne install_path)
        //
        // `env_variables` und `frozen_game_data` bekommen `{}`: Die Spalten sind
        // NOT NULL und trugen bis zum 2026-09-10 das Egg. Sie fallen mit dem
        // Tabellenschnitt (E-1/E-2); bis dahin stehen sie leer, und für einen
        // Paket-Server liest sie niemand.
        const result = await dbService.query(`
            INSERT INTO gameservers (
                guild_id,
                user_id,
                rootserver_id,
                addon_marketplace_id,
                template_name,
                name,
                install_path,
                ports,
                env_variables,
                paket_werte,
                frozen_game_data,
                launch_params,
                auto_restart,
                auto_update,
                allocated_ram_mb,
                allocated_cpu_percent,
                allocated_disk_gb,
                addon_version,
                channel,
                status,
                created_at
            ) VALUES (?, ?, ?, ?, ?, ?, 'temp', ?, '{}', ?, '{}', NULL, ?, ?, ?, ?, ?, ?, ?, 'installing', NOW())
        `, [
            guildId,
            userId,
            rootserver_id,
            addon.id,
            templateName,
            server_name,
            JSON.stringify(ports),
            JSON.stringify(paketWerte),
            // Das Formular schickt die Strings "0"/"1" – und "0" ist in JS truthy.
            toBool(auto_restart, true) ? 1 : 0,
            // Dieselbe Aussage wie die Paketeinstellung. Der Startweg liest die
            // Spalte nicht mehr; die alte Bearbeitungsseite zeigt sie noch.
            autoAktualisieren ? 1 : 0,
            // Geprüfte Werte, keine Rohdaten aus dem Formular: die drei Felder
            // sind Pflicht und wurden oben gegen die Kapazität des RootServers
            // gerechnet. Damit ist dieser INSERT zugleich die Buchung.
            ramMB,
            cpuPercent,
            diskGB,
            paket.identity?.version || addon.version || '1.0.0',
            // Der Kanal, dem der Server folgt — aus derselben Auskunft wie das Paket.
            pz.kanal
        ]);

        const serverId = result.insertId;

        // ✅ Port-Allocations mit echter server_id aktualisieren
        if (Object.keys(allocatedFromPool).length > 0) {
            for (const [portType, alloc] of Object.entries(allocatedFromPool)) {
                await dbService.query(
                    'UPDATE port_allocations SET server_id = ?, assigned_at = NOW() WHERE id = ?',
                    [serverId, alloc.allocId]
                );
            }
            Logger.info(`[Gameserver] ${Object.keys(allocatedFromPool).length} Port-Allocations für Server ${serverId} zugewiesen`);
        }

        // Install-Pfad: {serverid}-{slug} — deterministisch, identisch zur Daemon-Logik
        const finalInstallPath = `${serverId}-${addon_slug}`;
        await dbService.query('UPDATE gameservers SET install_path = ? WHERE id = ?', [finalInstallPath, serverId]);

        // bind_ip aus rootserver.host setzen (damit Ports auf der richtigen IP landen)
        // Fallback-Kette: explizite bind_ip aus Step3-Form → rootserver.host → null (daemon.yaml)
        if (rootserver.host) {
            await dbService.query('UPDATE gameservers SET bind_ip = ? WHERE id = ?', [rootserver.host, serverId]);
        }

        // ── Vorgemerkte Mods (E6/B.12) ──────────────────────────────────────
        //
        // Die Auswahl aus Schritt 3 wird jetzt zur Zeile — und zwar `geplant`:
        // Ein Serververzeichnis, in das ein Mod gehoert, gibt es noch nicht.
        // Geholt werden sie, wenn die Grundinstallation fertig ist
        // (`_handleInstallCompleted`). Derselbe Weg wie im Tab „Mods", nur
        // zeitversetzt — und ein Mod, den Thunderstore gerade nicht
        // ausliefert, darf die Serveranlage nicht aufhalten.
        // Jede Auswahl reist als `<quelle>|<kennung>`. Der Trenner ist mit
        // Absicht kein Bindestrich: Thunderstore-Kennungen haben welche
        // (`ValheimModding-Jotunn`), Modrinth-Slugs duerfen welche haben
        // (`fabric-api`) — ein `|` kommt in keiner von beiden vor. Bis zum
        // 2026-09-14 stand hier `k.includes('-')` als Pruefung, und die haette
        // jeden Modrinth-Mod ohne Bindestrich stillschweigend verworfen.
        const gewaehlteMods = [].concat(req.body.mod || [])
            .filter(k => typeof k === 'string' && k.includes('|'))
            .map(k => ({ quelle: k.slice(0, k.indexOf('|')), kennung: k.slice(k.indexOf('|') + 1) }))
            .filter(m => m.kennung && Quellen.gibtEs(m.quelle));
        if (gewaehlteMods.length) {
            const inhalt = paket.content || {};
            for (let i = 0; i < gewaehlteMods.length; i++) {
                const { quelle, kennung } = gewaehlteMods[i];
                // Der Lader ist keine Zeile wie die anderen — und nur das Paket
                // weiss, welches Paket DIESER Quelle er ist.
                const laderPaket = inhalt.loader?.packages?.[quelle] || null;
                await Inhalte.eintragen({
                    serverId, guildId, quelle,
                    art: laderPaket && kennung.toLowerCase() === laderPaket.toLowerCase()
                        ? Inhalte.ART_LADER : Inhalte.ART_MOD,
                    kennung,
                    name: kennung.includes('-') ? kennung.slice(kennung.indexOf('-') + 1) : kennung,
                    reihenfolge: i,
                    // Vorlaeufig aus dem Paket: Was der Katalog je Mod sagt,
                    // steht erst beim Holen fest und wird dann ueberschrieben.
                    clientSide: Boolean(inhalt.client_side),
                    status: 'geplant',
                });
            }
            Logger.info(`[Gameserver] ${gewaehlteMods.length} Mod(s) für Server ${serverId} vorgemerkt`);
        }

        // ✅ SFTP-Credentials direkt beim Server-Erstellen setzen
        // Username = system_user des Rootservers (Linux-User dem das Verzeichnis gehört)
        // Das Passwort wird hier nur gehasht abgelegt; der Nutzer holt es sich
        // über "Zurücksetzen" auf der Detailseite.
        const sftpUsername = rootserver.system_user || `gs-${String(serverId).padStart(8, '0')}`;
        _setzeSftpPasswort(dbService, {
            serverId,
            username: sftpUsername,
            daemonId,
            guildId
        })
            .then(({ synchronisiert, fehler }) => {
                if (synchronisiert) {
                    Logger.info(`[Gameserver] SFTP-Credentials gesetzt für Server ${serverId} (User: ${sftpUsername})`);
                } else {
                    Logger.warn(`[Gameserver] SFTP-Credentials für Server ${serverId} nicht zum Daemon übertragen: ${fehler?.message}`);
                }
            })
            .catch(err => Logger.warn(`[Gameserver] SFTP-Credentials fehlgeschlagen: ${err.message}`));

        // IPC-Command an Daemon senden für Installation
        try {
            const ipmServer = ServiceManager.get('ipmServer');
            
            if (!ipmServer) {
                Logger.warn('[Gameserver] IPMServer nicht verfügbar - Server wird ohne Installation erstellt');
            } else if (!ipmServer.isDaemonOnline(daemonId)) {
                Logger.warn(`[Gameserver] Daemon ${daemonId} ist offline - Server Status bleibt auf 'installing'`);
                // Server-Status bleibt auf 'installing', bis Daemon online kommt
            } else {
                // Daemon ist online - Installation starten
                Logger.info(`[Gameserver] Sende Install-Command an Daemon ${daemonId}`, {
                    serverId,
                    addonSlug: addon_slug,
                    rootserverId: rootserver_id,
                    templateName
                });

                // ── Der Auftrag: Paket, Werte, Ports ───────────────────────
                //
                // Derselbe Baustein wie „Erneut versuchen", „Neuinstallieren",
                // Discord und der Wiederanstoß beim Reconnect
                // (StartPayload.baueInstallNutzlast) — aus der Zeile, die eben
                // entstanden ist.
                const zeile = await loadServerForStart(dbService, serverId, guildId);
                const { payload: installPayload, error: auftragsFehler } = baueInstallNutzlast(zeile, guildId, {
                    runInstall: toBool(run_install, true),
                    startAfter: toBool(start_after, false),
                });
                if (auftragsFehler) throw new Error(auftragsFehler);

                Logger.debug(`[Gameserver] 🔍 Install Payload:`, {
                    daemonId,
                    payload: installPayload
                });

                // Command-Response mit 60s Timeout (Installation kann dauern)
                const response = await ipmServer.sendCommand(daemonId, 'gameserver.install', installPayload, 60000);

                if (response.success) {
                    Logger.success(`[Gameserver] Installation gestartet für Server ${serverId}`);

                    // ✅ Allozierte Ports aus Daemon-Response in MySQL speichern
                    if (response.allocated_ports && Object.keys(response.allocated_ports).length > 0) {
                        const allocatedPorts = response.allocated_ports;
                        Logger.info(`[Gameserver] Allozierte Ports für Server ${serverId}:`, allocatedPorts);

                        // Ports-Objekt mit echten Ports aktualisieren
                        const realPorts = { ...ports };
                        for (const [portType, portNum] of Object.entries(allocatedPorts)) {
                            if (realPorts[portType]) {
                                realPorts[portType].external = portNum;
                                realPorts[portType].internal = portNum;
                            }
                        }

                        await dbService.query(
                            'UPDATE gameservers SET ports = ? WHERE id = ?',
                            [JSON.stringify(realPorts), serverId]
                        );
                        Logger.success(`[Gameserver] Ports in DB aktualisiert für Server ${serverId}`);

                    }
                    // Status wird vom Daemon via Heartbeat aktualisiert
                } else {
                    Logger.error(`[Gameserver] Installation fehlgeschlagen für Server ${serverId}:`, response.error);
                    // Status auf 'error' setzen
                    await dbService.query(
                        'UPDATE gameservers SET status = ?, error_message = ? WHERE id = ?',
                        ['error', response.error || 'Installation failed', serverId]
                    );
                }
            }
        } catch (ipcError) {
            Logger.error(`[Gameserver] IPC-Fehler bei Installation von Server ${serverId}:`, ipcError);
            // Fehler speichern, aber Request nicht fehlschlagen lassen
            await dbService.query(
                'UPDATE gameservers SET status = ?, error_message = ? WHERE id = ?',
                ['error', ipcError.message || 'IPC Communication failed', serverId]
            );
        }

        Logger.success(`[Gameserver] Server erstellt (ID: ${serverId}) für Guild ${guildId}`, {
            name: server_name,
            addon: addon.name,
            template: templateName
        });

        res.json({
            success: true,
            message: `Server "${server_name}" wird installiert...`,
            serverId,
            redirectUrl: `/guild/${guildId}/plugins/gameserver/servers`
        });
    } catch (error) {
        Logger.error('[Gameserver] Fehler beim Erstellen des Servers:', error);

        // ── Vorgemerkte Ports wieder freigeben ───────────────────────────────
        //
        // Die Portvergabe bucht mit `server_id = 0`, BEVOR die Zeile existiert —
        // sonst könnten zwei gleichzeitige Anlegevorgänge denselben Port
        // bekommen. Scheitert danach irgendetwas, blieb die Vormerkung stehen.
        //
        // Gemessen am 2026-08-23: Zwei fehlgeschlagene Versuche hinterliessen
        // vier gebuchte Ports (25000–25003), die kein Server je benutzte. Beim
        // dritten Versuch wäre der Vorrat um vier Nummern ärmer gewesen — und
        // niemand hätte gewusst warum, denn `server_id = 0` sieht aus wie eine
        // gültige Buchung.
        //
        // Aufgefallen ist es nur, weil scripts/check-portvergabe.js danach
        // sucht. Ohne diese eine Zeile im Prüfskript wäre der Vorrat still
        // leergelaufen.
        try {
            if (typeof allocatedFromPool === 'object' && allocatedFromPool
                && Object.keys(allocatedFromPool).length) {
                const ids = Object.values(allocatedFromPool).map(a => a.allocId).filter(Boolean);
                if (ids.length) {
                    await dbService.query(
                        `UPDATE port_allocations SET server_id = NULL, assigned_at = NULL
                          WHERE id IN (${ids.map(() => '?').join(',')}) AND server_id = 0`, ids);
                    Logger.info(`[Gameserver] ${ids.length} vorgemerkte Port(s) nach dem `
                        + 'Fehlschlag wieder freigegeben');
                }
            }
        } catch (aufraeumFehler) {
            // Nicht verschlucken: Ein Vorrat, der still schrumpft, ist genau die
            // Sorte Fehler, die Wochen später als "keine Ports mehr" auftaucht.
            Logger.error('[Gameserver] Vorgemerkte Ports konnten nicht freigegeben werden',
                aufraeumFehler);
        }

        res.status(500).json({
            success: false,
            message: 'Serverfehler beim Erstellen des Gameservers'
        });
    }
});

/**
 * GET /guild/:guildId/plugins/gameserver/servers/events
 * SSE-Stream für Gameserver-Events
 * 
 * ⚠️ WICHTIG: Diese Route MUSS VOR /:serverId stehen,
 * sonst wird "events" als Server-ID interpretiert!
 * 
 * Sendet Echtzeit-Updates für:
 * - Status-Änderungen (starting, running, stopping, stopped, crashed)
 * - Resource-Usage (CPU, RAM, Disk)
 * - Player-Count-Updates
 *
 * ⚠️ Der Stream transportiert dieselben Daten wie die geschützten Ansichten
 * (Status, Auslastung, Spielerzahlen) und braucht deshalb dieselbe Berechtigung
 * wie sie. Ohne GAMESERVER.VIEW konnte bis dahin jedes eingeloggte Guild-Mitglied
 * mitlesen – als einzige Gameserver-Route.
 */
router.get('/events', requirePermission('GAMESERVER.VIEW'), (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const sseManager = ServiceManager.get('sseManager');
    
    const guildId = res.locals.guildId;
    
    try {
        // User-ID robust extrahieren
        const sessionUser = req.session?.user;
        const localUser = res.locals.user;
        
        const userId = localUser?.id || 
                       localUser?.user_id || 
                       sessionUser?.info?.id || 
                       sessionUser?.id || 
                       'anonymous';
                       
        const username = localUser?.username || 
                         localUser?.global_name || 
                         sessionUser?.info?.username || 
                         sessionUser?.info?.global_name || 
                         sessionUser?.username || 
                         'Unknown';
        
        // Client-ID generieren (User-ID + Timestamp für Uniqueness)
        const clientId = `${userId}-${Date.now()}`;
        
        // Optional: Filter für bestimmte Server (via Query-Parameter)
        // ⚠️ String()-Konvertierung nötig: server_id kann Integer (Daemon) oder String (Query) sein
        const serverFilter = req.query.server_id ? 
            (message) => {
                // Nur Events für den spezifischen Server durchlassen
                return message.data && String(message.data.server_id) === String(req.query.server_id);
            } : null;
        
        // Client bei SSEManager registrieren
        // ⚠️ WICHTIG: addClient() setzt Headers und managed die Connection!
        sseManager.addClient(guildId, clientId, res, {
            filter: serverFilter,
            metadata: {
                userId: userId,
                username: username,
                serverId: req.query.server_id || null
            }
        });
        
        Logger.info(`[Gameserver SSE] Client ${clientId} connected (Guild: ${guildId}, User: ${username})`);
        
        // ⚠️ WICHTIG: KEIN res.send() oder res.json() hier!
        // SSEManager übernimmt die Response-Kontrolle!
        
    } catch (error) {
        Logger.error('[Gameserver SSE] Fehler beim Verbinden:', error);
        
        // Nur wenn Response noch nicht gesendet wurde
        if (!res.headersSent) {
            res.status(500).json({
                success: false,
                message: 'Fehler beim Aufbau der SSE-Verbindung'
            });
        }
    }
});

/**
 * GET /status
 * Live Status Polling Endpoint für Frontend
 * Gibt aktuelle Status aller Server einer Guild zurück
 * WICHTIG: Muss VOR /:serverId Route definiert werden!
 */
router.get('/status', requirePermission('GAMESERVER.VIEW'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    
    try {
        const guildId = res.locals.guildId;

        // Der Zustand, aus dem die Live-Anzeige zeichnet.
        //
        // Erweitert statt verdoppelt (2026-08-23): Diese Route gab bisher nur
        // id und status. Die Live-Anzeige braucht nach einem Verbindungsabriss
        // aber den GANZEN Zustand — ein verpasstes Ereignis lässt sich nicht
        // nachträglich empfangen, nur nachholen.
        //
        // ── Zwei Spalten mehr, und warum sie hier fehlten (Baustelle 134) ────
        //
        // `bereitschaft_am` und `last_started_at` entscheiden, ob eine Meldung
        // zu DIESEM Lauf gehört (Baustelle 105). Ohne sie konnte der Browser
        // diese Prüfung nicht führen — er zeigte nach einem Neustart die Stufe
        // des vorigen Laufs weiter als erreicht. Die Serverseite prüfte es, der
        // Live-Weg nicht: dieselbe Frage, zwei Antworten.
        //
        // Deshalb liefert diese Route jetzt nicht mehr Rohspalten, sondern die
        // fertige Auskunft aus `baueBereitschaftAuskunft()` — dieselbe Funktion,
        // aus der auch die Liste und die Serverseite zeichnen.
        const servers = await dbService.query(
            `SELECT id, status, error_message, current_players, max_players,
                    addon_marketplace_id,
                    bereitschaft_stufe, bereitschaft_grund, bereitschaft_am, bereitschaft_bereit,
                    last_started_at,
                    -- Fuer den Platz (B101): gebucht, gemessen, und ob die harte
                    -- Grenze greift — alles in derselben Zeile.
                    allocated_disk_gb, disk_quota_enforced, disk_quota_note,
                    platz_belegt_bytes, platz_grenze_bytes, platz_gemessen_am,
                    platz_ueber, platz_geschaetzt,
                    -- Die Live-Messwerte für den Streifen über den Bereichen.
                    cpu_percent, ram_used_mb, ram_total_mb, last_heartbeat,
                    net_rx_bytes, net_tx_bytes, net_rx_rate, net_tx_rate,
                    -- Und der Install-Fortschritt (B44): Er reitet auf demselben
                    -- Weg, damit ein Nachholen nach einem Verbindungsabriss auch
                    -- die Bahn wieder richtig setzt.
                    install_progress, install_phase
               FROM gameservers WHERE guild_id = ?`,
            [guildId]
        );

        const paketNachServer = await ladePaketeZuServern(dbService, servers);

        res.json({
            success: true,
            servers: (servers || []).map((s) => {
                const a = baueBereitschaftAuskunft(paketNachServer[s.id] || null, s);
                return {
                    id:              s.id,
                    status:          s.status,
                    current_players: s.current_players,
                    max_players:     s.max_players,
                    // Roh — die Ansicht zeigt die gemeldete Stufe weiterhin an.
                    bereitschaft_stufe: s.bereitschaft_stufe,
                    bereitschaft_grund: s.bereitschaft_grund,
                    // Beurteilt — hier steckt die Regel, nicht im Browser.
                    bereitschaft: {
                        messbar: a.messbar,
                        bereit:  a.bereit,
                        stufe:   a.stufe,
                        grund:   a.grund,
                        text:    a.text,
                        stufen:  a.stufen,
                    },
                    // Derselbe Aufruf, aus dem die Serverseite zeichnet. Der
                    // Browser bekommt Text und Farbe, nicht die Schwellen.
                    platz: bauePlatz(s),
                    messwerte: baueMesswerte(s),
                };
            })
        });

    } catch (error) {
        Logger.error('[Gameserver] Fehler beim Abrufen der Server-Status:', error);
        res.status(500).json({
            success: false,
            message: 'Serverfehler beim Abrufen der Status'
        });
    }
});

/**
 * GET /guild/:guildId/plugins/gameserver/servers/:serverId/query
 * Live-Status-Abfrage via GameDig (A2S, Minecraft, etc.)
 * Gibt: name, map, ping, players[], maxPlayers, connect
 * @permission GAMESERVER.VIEW
 */
router.get('/:serverId/query', requirePermission('GAMESERVER.VIEW'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');

    try {
        const guildId = res.locals.guildId;
        const serverId = req.params.serverId;

        const [server] = await dbService.query(`
            SELECT
                gs.id, gs.guild_id, gs.status, gs.ports, gs.env_variables, gs.bind_ip,
                r.host AS rootserver_ip,
                r.daemon_id,
                COALESCE(am.game_data, gs.frozen_game_data) AS game_data
            FROM gameservers gs
            LEFT JOIN rootserver r ON gs.rootserver_id = r.id
            LEFT JOIN addon_marketplace am ON gs.addon_marketplace_id = am.id
            WHERE gs.id = ? AND gs.guild_id = ?
        `, [serverId, guildId]);

        if (!server) {
            return res.status(404).json({ success: false, message: 'Server nicht gefunden' });
        }

        ServiceManager.get('gameserverStatusPoller')?.markInterest(server.id);

        // Frisches Ergebnis wiederverwenden statt den Gameserver erneut abzufragen –
        // der Poller hält den Wert ohnehin aktuell, solange die Seite offen ist.
        // Zwei Abfragen kurz hintereinander beantworten die meisten Spiele nicht.
        let result   = StatusService.getRecentQuery(serverId);
        let snapshot = null;

        if (!result) {
            // Über den StatusService, damit das Ergebnis im Snapshot landet und
            // Serverliste, Karten und Discord dieselbe Wahrheit sehen.
            snapshot = await StatusService.refresh(server);
            result = snapshot.query || { success: false, error: 'Server ist nicht online' };
        }

        // Die Query ist nur eine von zwei Quellen. Bleibt sie stumm, während RCON
        // antwortet, stehen die Spieler trotzdem im Snapshot – dann gewinnt der.
        // Ohne das zeigte die Detailseite bei Palworld dauerhaft den Query-Fehler,
        // obwohl ShowPlayers längst Namen lieferte.
        if (!result.success) {
            snapshot = snapshot || await StatusService.getSnapshot(serverId);
            if (snapshot?.online) {
                result = StatusService.toQueryShape(snapshot);
            }
        }

        if (!result.success) {
            Logger.debug(`[Gameserver] Keine Quelle erreichbar für Server ${serverId}: ${result.error}`);
        }

        return res.json(result);

    } catch (error) {
        Logger.error('[Gameserver] Fehler bei Live-Query:', error);
        return res.status(500).json({ success: false, error: 'Interner Serverfehler' });
    }
});

// ════════════════════════════════════════════════════════════════════════
// Öffentlicher Status (E5)
//
// Wie bei den Panels gilt: Ohne ausdrückliches Einschalten gibt es nichts zu
// sehen. Das Token wird erst beim Einschalten erzeugt – ein Server, der nie
// veröffentlicht wurde, hat auch keine Adresse, die irgendwo auftauchen könnte.
// ════════════════════════════════════════════════════════════════════════

/**
 * GET …/servers/:serverId/public-status
 * @permission GAMESERVER.VIEW
 */
router.get('/:serverId/public-status', requirePermission('GAMESERVER.VIEW'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');

    try {
        const [server] = await dbService.query(
            `SELECT public_status_token, public_status_enabled, public_status_players
             FROM gameservers WHERE id = ? AND guild_id = ? LIMIT 1`,
            [req.params.serverId, res.locals.guildId]
        );
        if (!server) return res.status(404).json({ success: false, error: 'Server nicht gefunden' });

        return res.json({
            success: true,
            enabled:      !!server.public_status_enabled,
            show_players: !!server.public_status_players,
            token:        server.public_status_token || null,
        });

    } catch (error) {
        Logger.error('[Gameserver] Öffentlicher Status nicht geladen:', error);
        return res.status(500).json({ success: false, error: 'Interner Serverfehler' });
    }
});

/**
 * PATCH …/servers/:serverId/public-status
 * Schaltet die öffentliche Seite und die Spielernamen. Nur mitgeschickte Felder
 * werden geändert.
 * @permission GAMESERVER.EDIT
 */
router.patch('/:serverId/public-status', requirePermission('GAMESERVER.EDIT'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const { neuesToken } = require('../helpers/PublicStatus');

    try {
        const guildId = res.locals.guildId;
        const serverId = Number(req.params.serverId);
        const { enabled, show_players } = req.body;

        const [server] = await dbService.query(
            'SELECT id, public_status_token FROM gameservers WHERE id = ? AND guild_id = ? LIMIT 1',
            [serverId, guildId]
        );
        if (!server) return res.status(404).json({ success: false, error: 'Server nicht gefunden' });

        const sets = [], werte = [];

        if (enabled !== undefined) {
            sets.push('public_status_enabled = ?');
            werte.push(toBool(enabled) ? 1 : 0);

            // Token erst beim Einschalten erzeugen, nicht auf Vorrat.
            if (toBool(enabled) && !server.public_status_token) {
                sets.push('public_status_token = ?');
                werte.push(neuesToken());
            }
        }
        if (show_players !== undefined) {
            sets.push('public_status_players = ?');
            werte.push(toBool(show_players) ? 1 : 0);
        }

        if (sets.length) {
            werte.push(serverId);
            await dbService.query(`UPDATE gameservers SET ${sets.join(', ')} WHERE id = ?`, werte);
        }

        const [neu] = await dbService.query(
            `SELECT public_status_token, public_status_enabled, public_status_players
             FROM gameservers WHERE id = ? LIMIT 1`,
            [serverId]
        );

        Logger.info(`[Gameserver] Öffentlicher Status für Server ${serverId} geändert `
            + `(an: ${!!neu.public_status_enabled}, Namen: ${!!neu.public_status_players})`);

        return res.json({
            success: true,
            enabled:      !!neu.public_status_enabled,
            show_players: !!neu.public_status_players,
            token:        neu.public_status_token || null,
        });

    } catch (error) {
        Logger.error('[Gameserver] Öffentlicher Status nicht geändert:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST …/servers/:serverId/public-status/regenerate
 * Würfelt das Token neu – alte Einbindungen sind danach tot.
 * @permission GAMESERVER.EDIT
 */
router.post('/:serverId/public-status/regenerate', requirePermission('GAMESERVER.EDIT'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const { neuesToken } = require('../helpers/PublicStatus');

    try {
        const token = neuesToken();
        const ergebnis = await dbService.query(
            'UPDATE gameservers SET public_status_token = ? WHERE id = ? AND guild_id = ?',
            [token, req.params.serverId, res.locals.guildId]
        );
        if (!ergebnis?.affectedRows) {
            return res.status(404).json({ success: false, error: 'Server nicht gefunden' });
        }

        Logger.warn(`[Gameserver] Öffentliches Token für Server ${req.params.serverId} neu gewürfelt – `
            + 'bestehende Einbindungen zeigen ab jetzt 404');

        return res.json({ success: true, token });

    } catch (error) {
        Logger.error('[Gameserver] Token nicht erneuert:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
});

// ════════════════════════════════════════════════════════════════════════
// Discord-Status-Panels (E4)
//
// Wichtig: Diese Routen stehen VOR `router.get('/:serverId')`. Express nimmt
// die erste passende Route, und `/:serverId` würde `/:serverId/panels` sonst
// nie erreichen lassen – dieselbe Falle wie früher bei den Migration-Routen
// hinter dem Catch-All in api.router.js.
// ════════════════════════════════════════════════════════════════════════

/**
 * GET …/servers/:serverId/panels
 * Panels des Servers samt Textkanal-Liste der Guild.
 * @permission GAMESERVER.VIEW
 */
router.get('/:serverId/panels', requirePermission('GAMESERVER.VIEW'), async (req, res) => {
    const Logger    = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');

    try {
        const guildId  = res.locals.guildId;
        const serverId = req.params.serverId;

        const panels = await dbService.query(
            `SELECT id, channel_id, message_id, enabled, min_interval_s,
                    show_players, show_controls, show_refresh, last_pushed_at, last_error
             FROM gameserver_status_panels
             WHERE server_id = ? AND guild_id = ?
             ORDER BY id`,
            [serverId, guildId]
        );

        // Kanalnamen kennt nur der Bot. Dafür gibt es den Kern-Handler
        // GET_GUILD_CHANNELS – ein plugin-eigener wäre eine Dublette. Fällt der
        // Bot aus, bleibt die Liste leer; die vorhandenen Panels sind dann
        // trotzdem sichtbar und löschbar.
        let channels = [];
        if (ServiceManager.has('ipcServer')) {
            const responses = await ServiceManager.get('ipcServer')
                .broadcast('dashboard:GET_GUILD_CHANNELS', { guildId })
                .catch(() => []);
            const hit = (responses || []).find(r => r && r.success);
            if (hit) channels = hit.channels || [];
        }

        return res.json({ success: true, panels, channels });

    } catch (error) {
        Logger.error('[Gameserver] Panels nicht geladen:', error);
        return res.status(500).json({ success: false, error: 'Interner Serverfehler' });
    }
});

/**
 * POST …/servers/:serverId/panels
 * Legt ein Panel an und postet es sofort.
 * @permission GAMESERVER.EDIT
 */
router.post('/:serverId/panels', requirePermission('GAMESERVER.EDIT'), async (req, res) => {
    const Logger    = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');

    try {
        const guildId  = res.locals.guildId;
        const serverId = Number(req.params.serverId);
        const { channel_id: channelId, show_players, show_controls, show_refresh, min_interval_s } = req.body;

        if (!channelId) {
            return res.status(400).json({ success: false, error: 'Kanal fehlt' });
        }

        // Server muss zur Guild gehören – die serverId kommt aus der URL.
        const [server] = await dbService.query(
            'SELECT id FROM gameservers WHERE id = ? AND guild_id = ? LIMIT 1',
            [serverId, guildId]
        );
        if (!server) {
            return res.status(404).json({ success: false, error: 'Server nicht gefunden' });
        }

        const panel = await PanelService.create({
            guildId,
            serverId,
            channelId:    String(channelId),
            showPlayers:  toBool(show_players),
            showControls: show_controls === undefined ? true : toBool(show_controls),
            showRefresh:  show_refresh  === undefined ? true : toBool(show_refresh),
            minIntervalS: Number(min_interval_s) || 60,
            createdBy:    res.locals.user?.id || null,
        });

        return res.json({ success: true, panel });

    } catch (error) {
        Logger.error('[Gameserver] Panel nicht angelegt:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * PATCH …/servers/:serverId/panels/:panelId
 * Ändert die Schalter eines bestehenden Panels und aktualisiert die Nachricht.
 *
 * Nur mitgeschickte Felder werden angefasst – die Oberfläche schickt immer nur
 * den einen Schalter, den jemand umgelegt hat.
 *
 * @permission GAMESERVER.EDIT
 */
router.patch('/:serverId/panels/:panelId', requirePermission('GAMESERVER.EDIT'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');

    try {
        const { show_players, show_controls, show_refresh, min_interval_s } = req.body;

        const panel = await PanelService.update({
            guildId:      res.locals.guildId,
            panelId:      Number(req.params.panelId),
            showPlayers:  show_players   === undefined ? undefined : toBool(show_players),
            showControls: show_controls  === undefined ? undefined : toBool(show_controls),
            showRefresh:  show_refresh   === undefined ? undefined : toBool(show_refresh),
            minIntervalS: min_interval_s === undefined ? undefined : Number(min_interval_s),
        });

        if (!panel) {
            return res.status(404).json({ success: false, error: 'Panel nicht gefunden' });
        }
        return res.json({ success: true, panel });

    } catch (error) {
        Logger.error('[Gameserver] Panel nicht geändert:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * DELETE …/servers/:serverId/panels/:panelId
 * Entfernt das Panel und löscht die Discord-Nachricht.
 * @permission GAMESERVER.EDIT
 */
router.delete('/:serverId/panels/:panelId', requirePermission('GAMESERVER.EDIT'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');

    try {
        const removed = await PanelService.remove(Number(req.params.panelId), res.locals.guildId);
        if (!removed) {
            return res.status(404).json({ success: false, error: 'Panel nicht gefunden' });
        }
        return res.json({ success: true });

    } catch (error) {
        Logger.error('[Gameserver] Panel nicht entfernt:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /guild/:guildId/plugins/gameserver/servers/:serverId
 * Server-Detail-Ansicht mit Tabbed-Interface
 * @permission GAMESERVER.VIEW
 */
router.get('/:serverId', requirePermission('GAMESERVER.VIEW'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const themeManager = ServiceManager.get('themeManager');
    
    try {
        const guildId = res.locals.guildId;
        const serverId = req.params.serverId;
        const user = res.locals.user;

        Logger.info(`[Gameserver] ===== Detail-View START für Server ${serverId}, Guild ${guildId} =====`);

        // Server mit allen relevanten JOINs laden
        const [server] = await dbService.query(`
            SELECT 
                gs.id,
                gs.guild_id,
                gs.name,
                gs.channel,
                gs.status,
                gs.error_message,
                gs.current_players,
                gs.max_players,
                gs.ports,
                gs.install_path,
                gs.launch_params,
                gs.auto_restart,
                gs.auto_update,
                gs.addon_marketplace_id,
                gs.template_name,
                gs.addon_version,
                gs.rootserver_id,
                gs.pid,
                gs.current_map,
                gs.last_started_at,
                gs.last_stopped_at,
                -- Ohne diese drei baute baueBereitschaft() die Leiter aus
                -- undefined und schrieb "nicht gemessen" hin, obwohl die Stufe
                -- in derselben Zeile stand. Der Helfer war richtig, die
                -- Abfrage holte seine Eingabe nicht (Baustelle 105, 2026-09-08).
                gs.bereitschaft_stufe,
                gs.bereitschaft_grund,
                gs.bereitschaft_am,
                gs.bereitschaft_bereit,
                -- Platz und Live-Messwerte (B101, B146) — sie standen bis zum
                -- 2026-09-21 in der toten server_registry. Ohne sie zeigt die
                -- Serverseite weder den Platzbalken noch den Messstreifen.
                -- install_progress/-phase tragen die Installationsbahn (B44).
                gs.install_progress,
                gs.install_phase,
                gs.platz_belegt_bytes,
                gs.platz_grenze_bytes,
                gs.platz_gemessen_am,
                gs.platz_ueber,
                gs.platz_geschaetzt,
                gs.cpu_percent,
                gs.ram_used_mb,
                gs.ram_total_mb,
                gs.last_heartbeat,
                gs.net_rx_bytes,
                gs.net_tx_bytes,
                gs.net_rx_rate,
                gs.net_tx_rate,
                gs.created_at,
                gs.updated_at,
                gs.sftp_username,
                gs.sftp_password_hash,
                gs.sftp_password_seen_at,
                gs.env_variables,
                -- Die Werte des Servers stehen seit dem 2026-08-23 in paket_werte,
                -- und seit dem Egg-Schnitt (2026-09-10) NUR noch dort. Ohne diese
                -- Spalte zeigte die Einstellungskarte "kein Wert hinterlegt", obwohl
                -- alles gespeichert war - gefunden am 2026-09-12 an Server 188.
                -- (Keine Backticks in dieser Abfrage: Sie steht in einem
                -- Template-Literal und waere damit zu Ende.)
                gs.paket_werte,
                am.name as game_name,
                am.slug as game_slug,
                am.icon_url as game_icon,
                am.game_data,
                r.name as rootserver_name,
                r.hostname as rootserver_hostname,
                r.host as rootserver_ip,
                -- Der geprüfte Name (M-1/M-3): fqdn_gilt setzt ausschliesslich
                -- eine Messung beim Verbinden des Daemons, nie eine Eingabe.
                r.fqdn,
                r.fqdn_gilt,
                r.daemon_id,
                r.sftp_fingerprint,
                r.sftp_port AS rootserver_sftp_port,
                r.system_user,
                -- Das Spielpaket: Die Fernsteuerung eines Paketservers steht in
                -- management.rcon, nicht in game_data (2026-09-22). Ohne diese
                -- Spalte sagte die Seite "keine RCON-Konfiguration", waehrend
                -- Port und Kennwort laengst da waren.
                -- (Keine Backticks in diesem Kommentar: Er steht in einem
                --  Template-Literal, und ein Backtick beendet es. Dritter
                --  Treffer derselben Falle in diesem Haus.)
                pv.fbpkg AS paket_json
            FROM gameservers gs
            LEFT JOIN addon_marketplace am ON gs.addon_marketplace_id = am.id
            LEFT JOIN rootserver r ON gs.rootserver_id = r.id
            LEFT JOIN packages pk ON pk.id = gs.addon_marketplace_id
            LEFT JOIN package_versions pv ON pv.id = ${FASSUNG_FUER_SERVER}
            WHERE gs.id = ? AND gs.guild_id = ?
        `, [serverId, guildId]);

        Logger.info(`[Gameserver] DB-Query abgeschlossen, Server gefunden: ${!!server}`);

        // 404 wenn Server nicht gefunden
        if (!server) {
            Logger.warn(`[Gameserver] Server ${serverId} nicht gefunden für Guild ${guildId}`);
            return res.status(404).render('error', {
                message: 'Server nicht gefunden',
                description: 'Der angeforderte Server existiert nicht oder gehört nicht zu dieser Guild.'
            });
        }

        // ports JSON parsen
        let ports = {};
        try {
            ports = typeof server.ports === 'string'
                ? JSON.parse(server.ports)
                : (server.ports || {});
        } catch (error) {
            Logger.error(`[Gameserver] Fehler beim Parsen von ports:`, error);
            ports = {};
        }

        // game_data parsen
        let gameData = {};
        try {
            gameData = typeof server.game_data === 'string'
                ? JSON.parse(server.game_data)
                : (server.game_data || {});
        } catch (error) {
            Logger.error(`[Gameserver] Fehler beim Parsen von game_data:`, error);
            gameData = {};
        }

        // env_variables parsen
        let envVariables = {};
        try {
            envVariables = typeof server.env_variables === 'string'
                ? JSON.parse(server.env_variables)
                : (server.env_variables || {});
        } catch (error) {
            Logger.error(`[Gameserver] Fehler beim Parsen von env_variables:`, error);
            envVariables = {};
        }
        server.env_variables_parsed = envVariables;

        Logger.info(`[Gameserver] JSON-Parsing abgeschlossen (ports, game_data, env_variables)`);

        // Ports zum Server-Objekt hinzufügen (für einfacheren Zugriff in View)
        server.ip_address = server.rootserver_ip || 'N/A';
        server.port_game = ports.game?.external || ports.game?.internal || ports.main?.external || null;
        // Query-Port: nur zeigen, was tatsächlich allokiert ist.
        //
        // Der Daemon mappt ausschließlich Ports aus der ports-Spalte
        // (docker/container.go → BuildPortMap). Ein aus dem Addon errechneter Wert
        // ("game_plus_1" = Game-Port + 1) beschreibt also nur, was das Spiel
        // *erwartet* – nicht, was von außen erreichbar ist. Früher stand er
        // trotzdem als fertiger Port da, und die Abfrage lief ins Leere, während
        // die Oberfläche alles in Ordnung meldete.
        const queryPortVar = gameData?.query?.port_var || null;
        server.port_query = ports.query?.external || ports.query?.internal || null;
        // Merken, aus welchem Eintrag der Query-Port stammt: Die Ansicht listet
        // darunter alle übrigen Ports auf und würde ihn sonst ein zweites Mal
        // zeigen – bei Valheim als "Game_plus_1-Port" neben "Query-Port".
        server.port_query_key = server.port_query ? 'query' : null;

        if (!server.port_query && queryPortVar && ports[queryPortVar]) {
            server.port_query = ports[queryPortVar].external || ports[queryPortVar].internal || null;
            if (server.port_query) server.port_query_key = queryPortVar;
        }

        // Erwartet das Addon einen Port, der nicht allokiert ist, wird das benannt
        // statt verschwiegen – inklusive der Nummer, die angelegt werden muss.
        server.port_query_expected = null;
        if (!server.port_query && queryPortVar) {
            const plus = /^(.+)_plus_(\d+)$/.exec(queryPortVar);
            if (plus && ports[plus[1]]) {
                const base = ports[plus[1]].external || ports[plus[1]].internal;
                if (base) server.port_query_expected = base + parseInt(plus[2], 10);
            }
        }
        server.port_rcon = ports.rcon?.external || ports.rcon?.internal || null;
        server.ports_parsed = ports; // Original-Struktur für erweiterte Ansicht

        // RCON-Verfügbarkeit prüfen statt raten: Port muss auflösbar, Passwort gesetzt
        // und das Protokoll vom Daemon unterstützt sein. Vorher galt allein die
        // Existenz eines config.rcon-Blocks als "verfügbar" — die RCON-Konsole
        // erschien dadurch auch bei Servern, bei denen sie nicht funktionieren kann.
        // Auch hier das Paket: Die Detailseite trifft sonst eine andere Aussage
        // als der Sendeweg — „keine RCON-Konfiguration" auf der Seite, waehrend
        // der Befehl durchginge. Zwei Wahrheiten ueber dieselbe Sache.
        const rconPaket = ladePaketUndWerte(server);
        const rcon = StatusService.resolveRcon({
            gameData, ports, envVars: envVariables,
            paket: rconPaket.paket, paketWerte: rconPaket.werte,
        });
        server.rcon_available = rcon.available;
        server.rcon_configured = rcon.configured;
        server.rcon_reason = rcon.reason;
        server.rcon_protocol = rcon.protocol;
        server.port_rcon = server.port_rcon || rcon.port;

        // Letztes tatsächliches RCON-Ergebnis (aus Snapshot) für die Anzeige
        const statusSnapshot = await StatusService.getSnapshot(server.id);
        server.status_snapshot = statusSnapshot;
        server.rcon_last_ok = statusSnapshot?.rcon_ok ?? null;
        if (statusSnapshot) {
            // Live-Werte gewinnen über die Registry-Spalten
            server.current_players = statusSnapshot.players_current ?? server.current_players;
            server.max_players     = statusSnapshot.players_max     ?? server.max_players;
            server.current_map     = statusSnapshot.map             ?? server.current_map;
        }

        // Anzeige-Konfiguration (Spalten, Felder, Badges) aus dem Addon auflösen –
        // ersetzt die fest verdrahteten Tabellenspalten in der View
        server.status_display = resolveStatusConfig(gameData).display;

        // Detailseite offen → Poller darf diesen Server häufiger abfragen
        ServiceManager.get('gameserverStatusPoller')?.markInterest(server.id);

        // SFTP-Credentials: Normally set at creation time. Lazy-fallback only if missing.
        if (!server.sftp_username && server.system_user) {
            // Fallback für ältere Server die vor dem direkten SFTP-Setup angelegt wurden.
            // Das erzeugte Passwort wird bewusst nicht angezeigt — es taucht in
            // keiner Antwort auf, der Nutzer holt es sich über "Zurücksetzen".
            server.sftp_username = server.system_user;
            const nachgezogen = await _setzeSftpPasswort(dbService, {
                serverId: server.id,
                username: server.sftp_username,
                daemonId: server.daemon_id,
                guildId
            }).catch(err => {
                Logger.warn(`[Gameserver] SFTP-Credentials fehlgeschlagen: ${err.message}`);
                return null;
            });
            server.sftp_passwort_gesetzt = Boolean(nachgezogen);
            if (nachgezogen && !nachgezogen.synchronisiert) {
                Logger.warn(`[Gameserver] SFTP-Credentials (Fallback) für Server ${server.id} nicht zum Daemon übertragen: ${nachgezogen.fehler?.message}`);
            } else if (nachgezogen) {
                Logger.info(`[Gameserver] SFTP-Credentials (Fallback) generiert für Server ${server.id} (User: ${server.sftp_username})`);
            }
        } else if (server.sftp_username && server.system_user && server.sftp_username !== server.system_user) {
            // Username korrigieren falls abweichend
            server.sftp_username = server.system_user;
            await dbService.query(
                'UPDATE gameservers SET sftp_username = ? WHERE id = ?',
                [server.sftp_username, server.id]
            );

            // Der Daemon muss den neuen Namen auch erfahren. Ohne das zeigte
            // die Seite ab hier einen Benutzernamen an, den der Rootserver
            // nicht kennt — anmelden konnte man sich damit nicht.
            //
            // Auffallen kann das seit es den Umzug zwischen Rootservern gibt:
            // Der Name leitet sich vom system_user des Rootservers ab, und der
            // ist am Ziel oft ein anderer. Der Abgleich schickt den ganzen
            // Bestand, wodurch der alte Eintrag dort verschwindet; das
            // Passwort bleibt dasselbe.
            ServiceManager.get('ipmServer')?.syncSftpUsers(server.daemon_id)
                .catch(err => Logger.warn(`[Gameserver] SFTP-Abgleich nach Namensänderung fehlgeschlagen: ${err.message}`));

            Logger.info(`[Gameserver] SFTP-Username korrigiert für Server ${server.id} → ${server.sftp_username}`);
        }
        // Die View erfährt nur, OB ein Passwort gesetzt ist. Der Hash selbst hat
        // in der Antwort nichts verloren — er ist zwar nicht umkehrbar, aber
        // offline angreifbar, und die Seite braucht ihn für nichts.
        server.sftp_passwort_gesetzt = server.sftp_passwort_gesetzt || Boolean(server.sftp_password_hash);
        // Gesetzt heisst nicht bekannt: beim Anlegen wird der Klartext erzeugt
        // und sofort verworfen. Erst "Zuruecksetzen" zeigt ihn einmal.
        server.sftp_passwort_gesehen = Boolean(server.sftp_password_seen_at);
        delete server.sftp_password_hash;

        // SFTP-Verbindungsinfo anfügen (IP bevorzugen – Hostname ist oft nicht konfiguriert)
        server.sftp_host = server.rootserver_ip || server.rootserver_hostname || 'N/A';
        // Der Port kommt vom Daemon, der ihn aus seinem laufenden Listener liest.
        // Fehlt er, laeuft dort KEIN SFTP-Server — dann bleibt das Feld leer
        // (Baustelle 144).
        //
        // Hier stand `|| 2022`, gedacht als Verbesserung gegenueber einem fest
        // eingebauten Port. Der Rueckfall macht aber aus „niemand lauscht" eine
        // plausible Zahl. Am 2026-09-21 gemessen: `sftp_port` ist bei BEIDEN
        // Rootservern NULL, es laeuft also nirgends einer — der Rueckfall haette
        // in genau dem Fall eine Verbindung versprochen, die nicht zustande
        // kommt.
        //
        // ⚠ Diese drei Felder werden heute von KEINER Vorlage angezeigt (am
        // 2026-09-21 gesucht: kein Treffer in `views/`, auch kein Knopf fuer
        // `POST /:serverId/sftp/reset-password`). Sie stehen hier fuer den Tag,
        // an dem SFTP wieder angeboten wird — und dann darf keines von ihnen
        // eine Zahl erfinden. Der Zustand von SFTP steht in Baustelle 144.
        server.sftp_port = server.rootserver_sftp_port || null;
        // Der Fingerabdruck kommt vom Daemon bei jeder Anmeldung. Fehlt er, ist
        // der Daemon zu alt oder SFTP dort abgeschaltet — dann sagt die Anzeige
        // das auch, statt ein leeres Feld zu zeigen.

        Logger.info(`[Gameserver] SFTP-Config gesetzt, lade RootServers...`);
        Logger.success(`[Gameserver] Server ${server.name} (${server.id}) geladen für Detail-View`);

        // RootServers für Migration-Modal laden
        const rootServers = await dbService.query(
            `SELECT r.id, r.name, r.daemon_id, r.daemon_status
             FROM rootserver r
             WHERE r.guild_id = ?
             ORDER BY r.name ASC`,
            [guildId]
        );

        Logger.info(`[Gameserver] RootServers geladen (${rootServers.length}), registriere Assets...`);

        // Assets für Detail-View einreihen
        // monaco-loader + gameserver-file-manager werden vom Files-Partial eingereiht
        // (NACH xterm-Skripten – verhindert AMD-Konflikt)
        const assetManager = ServiceManager.get('assetManager');
        if (assetManager) {
            assetManager.enqueueScript('gameserver-sse');
            assetManager.enqueueStyle('gameserver-serverseite');
            assetManager.enqueueScript('gameserver-actions');
            assetManager.enqueueScript('gameserver-live');
        }

        Logger.info(`[Gameserver] Assets eingereiht, rendere View...`);

        // View rendern
        // gamedig_type für Live-Query-Panel in der View bereitstellen
        server.gamedig_type = gameData?.query?.gamedig_type || null;

        // ── Die neue Serverseite (Entwurf 2026-08-18, Artboard 2) ───────────
        //
        // Sie liegt ÜBER der alten Übersicht und ersetzt sie noch nicht: dort
        // hängt arbeitende Mechanik (Live-Abfrage, Kennzahlen, Ports, SFTP), die
        // Stück für Stück herüberwandert. Scheitert etwas davon, fehlt die neue
        // Karte — die Seite bleibt benutzbar. Eine Übersicht ist kein Grund,
        // einen Server unerreichbar zu machen.
        let uebersicht = null;
        // Auch für die Konsole: Ein Paket-Server nimmt Befehle an (ConsoleTransport).
        let paketFuerKonsole = null;
        try {
            // Die Höhe hängt am SERVER, nicht am Betrachter (entschieden
            // 2026-08-18): Sonst sähen zwei Leute mit Rechten auf denselben
            // Server dieselbe Karte verschieden.
            const gewuenscht = req.query.ansicht;
            if (gewuenscht === 'einfach' || gewuenscht === 'fachlich') {
                if (gewuenscht !== server.ansicht) {
                    await dbService.query('UPDATE gameservers SET ansicht = ? WHERE id = ?',
                        [gewuenscht, server.id]);
                }
                server.ansicht = gewuenscht;
            }

            const paketZeile = await ladePaketFuerServer(dbService, server.id);
            const paket = paketZeile
                ? (typeof paketZeile.paket_json === 'string'
                    ? JSON.parse(paketZeile.paket_json) : paketZeile.paket_json)
                : null;

            // Fuenf statt einer (Wunsch des Betreibers, 2026-09-07): Die Karte
            // sagte nur, WANN zuletzt gesichert wurde. Die Frage vor einem
            // Update ist aber, ob es einen Stand gibt, auf den man zurueck
            // kann - dafuer braucht es mehrere Zeitpunkte.
            const sicherungen = await dbService.query(
                `SELECT id, name, size_bytes, completed_at FROM gameserver_backups
                  WHERE server_id = ? AND status = 'completed' AND completed_at IS NOT NULL
                  ORDER BY completed_at DESC LIMIT 5`, [server.id]);

            paketFuerKonsole = paket;
            uebersicht = baueUebersicht(server, paket, {
                sicherungen: sicherungen || [],
            });
        } catch (err) {
            Logger.error('[Gameserver] Übersichtskarte konnte nicht gebaut werden', err);
        }

        // Welcher Bereich gezeigt wird — was frueher ein Reiter war.
        // Kein Bereich heisst: die Serverseite selbst.
        const BEREICHE = {
            dateien: 'Dateien', sicherungen: 'Sicherungen', inhalte: 'Mods', konsole: 'Konsole',
            fernsteuerung: 'RCON',
            aufgaben: 'Wiederkehrende Aufgaben', panels: 'Discord-Panels',
            oeffentlich: 'Öffentliche Seite',
        };
        const bereich = BEREICHE[req.query.bereich] ? req.query.bereich : null;

        await themeManager.renderView(res, 'guild/server-detail', {
            title: `Server: ${server.name}`,
            uebersicht,
            bereich,
            bereichName: bereich ? BEREICHE[bereich] : null,
            activeMenu: `/guild/${guildId}/plugins/gameserver/servers`,
            server,
            gameData,
            guildId,
            user,
            rootServers,
            // Entscheidet, ob der Konsolen-Tab ein Eingabefeld zeigt (Konzept 23.3)
            consoleTransport: resolveConsoleTransport(gameData, paketFuerKonsole)
        });

    } catch (error) {
        Logger.error('[Gameserver] ===== FEHLER beim Laden der Server-Details =====');
        Logger.error('[Gameserver] Error Message:', error.message);
        Logger.error('[Gameserver] Error Stack:', error.stack);
        Logger.error('[Gameserver] Error Object:', error);
        
        res.status(500).render('error', {
            message: 'Fehler beim Laden der Server-Details',
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
});

/**
 * GET /guild/:guildId/plugins/gameserver/servers/:serverId/edit
 * Server-Bearbeitungs-Formular anzeigen
 */
router.get('/:serverId/edit', requirePermission('GAMESERVER.EDIT'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const themeManager = ServiceManager.get('themeManager');
    
    try {
        const guildId = res.locals.guildId;
        const serverId = req.params.serverId;

        Logger.debug(`[Gameserver] Edit-Formular aufgerufen für Server ${serverId}, Guild ${guildId}`);

        // Server-Daten mit Game-Informationen abrufen
        const [server] = await dbService.query(`
            SELECT 
                gs.id,
                gs.name,
                gs.status,
                gs.current_players,
                gs.max_players,
                gs.addon_marketplace_id,
                gs.template_name,
                gs.addon_version,
                gs.auto_restart,
                gs.auto_update,
                gs.paket_werte,
                gs.rootserver_id,
                gs.allocated_ram_mb,
                gs.allocated_cpu_percent,
                gs.allocated_disk_gb,
                gs.disk_quota_enforced,
                gs.disk_quota_note,
                gs.backup_keep,
                gs.backup_keep_days,
                am.name as game_name,
                am.slug as game_slug
            FROM gameservers gs
            LEFT JOIN addon_marketplace am ON gs.addon_marketplace_id = am.id
            WHERE gs.id = ? AND gs.guild_id = ?
        `, [serverId, guildId]);

        if (!server) {
            return res.status(404).render('error', {
                message: 'Server nicht gefunden'
            });
        }

        // Slots stehen unter dem Paketschlüssel `max_players` — derselbe, den die
        // Live-Anzeige nimmt (StatusService._maxSpielerAusWerten). Bis zum
        // 2026-09-26 las diese Seite sie aus `env_variables` über Egg-Namen
        // (MAX_PLAYERS, SLOTS …); die liest der Start seit dem 2026-09-10 nicht
        // mehr, bei jedem Paket-Server stand hier „keine Slot-Variable".
        let paketWerte = {};
        try {
            paketWerte = typeof server.paket_werte === 'string'
                ? JSON.parse(server.paket_werte) : (server.paket_werte || {});
        } catch (_) { paketWerte = {}; }
        const slots = StatusService._maxSpielerAusWerten(paketWerte);
        const slotVariable = slots ? 'max_players' : null;

        // ════════════════════════════════════════════════════════════════════
        // Wie viel darf dieser Server bekommen?
        //
        // Bis zum 2026-08-10 standen dort freie Zahlenfelder in MiB und Prozent,
        // und die Prüfung verlangte alle drei zusammen. Sechs von acht Servern
        // hatten NULL — wer dann nur den RAM eintrug, bekam beim Speichern
        // "CPU-Anteil, Speicherplatz fehlen" und kam nicht weiter.
        //
        // Jetzt bietet die Oberfläche nur an, was tatsächlich frei ist. Was der
        // Server heute schon hält, zählt dabei mit: es steckt in der Auslastung
        // des RootServers und darf ihm nicht ein zweites Mal fehlen.
        // ════════════════════════════════════════════════════════════════════
        let kapazitaet = null;
        try {
            const RootServerModel = require('../../../masterserver/dashboard/models/RootServer');
            const frei = await RootServerModel.getAvailableResources(server.rootserver_id);
            if (frei?.hasQuota) {
                // Bei der CPU zählt nur, was läuft (B54). Der eigene Anteil darf
                // deshalb auch nur dann zurückgerechnet werden, wenn dieser Server
                // in der laufenden Summe überhaupt drinsteckt — sonst bekäme ein
                // ausgeschalteter Server seine Kerne zweimal angeboten.
                const laeuft = RootServerModel.ZUSTAENDE_MIT_CPU.includes(server.status);
                kapazitaet = {
                    ramMB:    Math.floor(Number(frei.available_ram_mb    || 0)) + (server.allocated_ram_mb      || 0),
                    cpuCores: Number(frei.available_cpu_cores_running || 0)
                              + (laeuft ? (server.allocated_cpu_percent || 0) / 100 : 0),
                    diskGB:   Math.floor(Number(frei.available_disk_gb   || 0)) + (server.allocated_disk_gb     || 0),
                };
            }
        } catch (err) {
            // Ohne Quota-Angaben bleibt die Oberfläche bei freien Feldern —
            // besser als eine Auswahl, die auf geratenen Obergrenzen beruht.
            Logger.warn(`[Gameserver] Kapazität für RootServer ${server.rootserver_id} nicht lesbar: ${err.message}`);
        }

        return await themeManager.renderView(res, 'guild/gameserver-edit', {
            kapazitaet,
            // "Einstellungen" ueberall gleich: der Knopf auf der Serverseite
            // heisst so, die Karte auf dieser Seite auch. Vorher stand hier
            // "Server bearbeiten" — drei Namen fuer dieselbe Sache, und der
            // User hat den Knopf deshalb nicht gefunden.
            title: `Einstellungen: ${server.name}`,
            activeMenu: `/guild/${guildId}/plugins/gameserver/servers`,
            server,
            guildId,
            slots,
            slotVariable,
        });
    } catch (error) {
        Logger.error('[Gameserver] Fehler beim Laden des Edit-Formulars:', error);
        res.status(500).render('error', {
            message: 'Fehler beim Laden des Bearbeitungs-Formulars',
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
});

// Hier stand bis zum 2026-09-10 ein zweiter Start: `PUT /:serverId/start`. Er
// baute den Auftrag aus frozen_game_data und launch_params — ohne Paket — und
// hatte keinen Aufrufer mehr (Liste und Serverseite rufen `POST /:serverId/start`).
//
// Ebenso bis zum 2026-09-15 `PUT /:serverId/stop`: Er schrieb nur `stopping`, an
// der Stelle des Stopps stand ein TODO — und er hatte keinen Aufrufer. Gestoppt
// wird ueber `POST /:serverId/stop` → `ServerStopp.stoppe` (Baustelle 119).

/**
 * DELETE /guild/:guildId/plugins/gameserver/servers/:serverId
 * Server löschen (inkl. Dateien vom Daemon)
 */
router.delete('/:serverId', requirePermission('GAMESERVER.DELETE'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const ipmServer = ServiceManager.get('ipmServer');
    
    try {
        const guildId = res.locals.guildId;
        const { serverId } = req.params;

        Logger.info(`[Gameserver] Server-Löschung angefordert (ID: ${serverId})`);

        // ════════════════════════════════════════════════════════════
        // 1. Server-Daten mit Daemon-Info laden
        // ════════════════════════════════════════════════════════════
        const [server] = await dbService.query(`
            SELECT 
                gs.id,
                gs.name,
                gs.status,
                gs.last_status_update,
                gs.install_path,
                gs.rootserver_id,
                r.daemon_id,
                r.system_user,
                r.guild_id,  -- ✅ NEU: Guild-ID für Pfad-Konstruktion im Daemon
                am.slug as addon_slug
            FROM gameservers gs
            LEFT JOIN rootserver r ON gs.rootserver_id = r.id
            LEFT JOIN addon_marketplace am ON gs.addon_marketplace_id = am.id
            WHERE gs.id = ? AND gs.guild_id = ?
        `, [serverId, guildId]);

        if (!server) {
            return res.status(404).json({
                success: false,
                message: 'Server nicht gefunden'
            });
        }

        // ════════════════════════════════════════════════════════════
        // 2. Status-Check: Server muss gestoppt sein
        // ════════════════════════════════════════════════════════════
        // ── Läuft er noch? Dann erst stoppen, dann löschen ──────────────────
        //
        // Betreiber, 2026-09-14: „Dass man den Server stoppen muss zum Löschen —
        // das könnte diese Funktion ja auch von alleine machen." Bis dahin wies
        // die Route hier nur ab (Baustelle 115: ein hängendes `starting` machte
        // das Löschen ganz unmöglich).
        //
        // **Gewartet wird auf die Meldung des Daemons, nicht auf die Antwort
        // des Befehls.** Der Daemon reiht den Stopp nur ein, und beim
        // Deinstallieren stoppt er selbst NICHTS — er löscht Volume und
        // Verzeichnis, auch unter einem noch laufenden Container. Deshalb gilt:
        // Kommt der Server nicht sicher herunter, wird nichts gelöscht.
        // Der Ablauf selbst steht seit 2026-09-24 in ServerStopp.stoppeFallsLaeuft
        // — die Neuinstallation braucht denselben (Baustelle 155).
        const stopp = await ServerStopp.stoppeFallsLaeuft({ server, guildId });
        if (!stopp.ok) {
            Logger.warn(`[Gameserver] Löschen von Server ${serverId} abgebrochen: ${stopp.grund}`);
            return res.status(stopp.status).json({
                success: false,
                message: `${stopp.grund}. Es wurde nichts gelöscht — der Server bleibt, bis er sicher unten ist.`
            });
        }

        // ════════════════════════════════════════════════════════════
        // 3. Daemon-Uninstall: Server-Dateien löschen
        // ════════════════════════════════════════════════════════════
        const forceDelete = req.query.force === 'true';
        let uninstallSuccess = false;
        let uninstallError = null;
        
        if (server.daemon_id && ipmServer && ipmServer.isDaemonOnline(server.daemon_id)) {
            try {
                Logger.info(`[Gameserver] Sende Uninstall-Command an Daemon ${server.daemon_id}`, {
                    serverId,
                    installPath: server.install_path,
                    daemonId: server.daemon_id,  // ✅ DEBUG
                    rootserverId: server.rootserver_id
                });

                const uninstallPayload = {
                    server_id: serverId.toString(),
                    guild_id: guildId,
                    rootserver_id: server.rootserver_id,
                    daemon_id: server.daemon_id,
                    addon_slug: server.addon_slug
                };
                
                Logger.debug(`[Gameserver] 🔍 Uninstall Payload:`, uninstallPayload);

                const response = await ipmServer.sendCommand(server.daemon_id, 'gameserver.uninstall', uninstallPayload, 60000); // 60s Timeout

                if (response.success) {
                    Logger.success(`[Gameserver] Server ${serverId} erfolgreich deinstalliert (${response.deleted_files || 0} Dateien gelöscht)`);
                    uninstallSuccess = true;
                } else {
                    uninstallError = response.error || 'Uninstall fehlgeschlagen';
                    Logger.error(`[Gameserver] Daemon-Uninstall fehlgeschlagen: ${uninstallError}`);
                    if (!forceDelete) {
                        return res.status(500).json({
                            success: false,
                            message: `Deinstallation fehlgeschlagen: ${uninstallError}. Server wurde NICHT aus der Datenbank gelöscht.`,
                            canForce: true
                        });
                    }
                    Logger.warn(`[Gameserver] Force-Delete aktiv, lösche aus DB trotz Daemon-Fehler`);
                    uninstallSuccess = true;
                }
            } catch (ipmError) {
                Logger.error(`[Gameserver] IPM-Fehler beim Uninstall:`, ipmError);
                uninstallError = ipmError.message || 'IPM-Kommunikationsfehler';
                if (!forceDelete) {
                    return res.status(500).json({
                        success: false,
                        message: `IPM-Fehler: ${uninstallError}. Server wurde NICHT aus der Datenbank gelöscht.`,
                        canForce: true
                    });
                }
                Logger.warn(`[Gameserver] Force-Delete aktiv, lösche aus DB trotz IPM-Fehler`);
                uninstallSuccess = true;
            }
        } else {
            Logger.warn(`[Gameserver] Daemon ${server.daemon_id} offline`);
            if (!forceDelete) {
                return res.status(503).json({
                    success: false,
                    message: 'Daemon ist offline. Server kann nicht deinstalliert werden.',
                    canForce: true
                });
            }
            Logger.warn(`[Gameserver] Force-Delete aktiv, lösche aus DB ohne Daemon-Bestätigung`);
            uninstallSuccess = true;
        }

        // ════════════════════════════════════════════════════════════
        // 4. DB-Cleanup: Server aus Datenbank löschen (NUR wenn Daemon erfolgreich!)
        // ════════════════════════════════════════════════════════════
        if (uninstallSuccess) {
            // ✅ Port-Allocations freigeben (server_id zurück auf NULL)
            await dbService.query(
                'UPDATE port_allocations SET server_id = NULL, assigned_at = NULL WHERE server_id = ?',
                [serverId]
            );
            Logger.info(`[Gameserver] Port-Allocations für Server ${serverId} freigegeben`);

            await dbService.query('DELETE FROM gameservers WHERE id = ?', [serverId]);
            Logger.success(`[Gameserver] Server ${serverId} aus DB gelöscht`);

            // Der SFTP-Zugang muss mit dem Server verschwinden. Er lebt in der
            // Datenbank des Daemons weiter und würde sonst weiter angenommen:
            // Der Pfad-Auflöser setzt den Verzeichnisnamen nur zusammen und
            // meldet keinen Fehler, wenn es das Verzeichnis nicht mehr gibt.
            //
            // Der Abgleich schickt den verbliebenen Bestand des Rootservers und
            // löscht dort alles andere — deshalb genügt ein Aufruf ohne
            // eigenen Lösch-Befehl.
            if (server.daemon_id && ipmServer?.isDaemonOnline(server.daemon_id)) {
                ipmServer.syncSftpUsers(server.daemon_id)
                    .catch(err => Logger.warn(`[Gameserver] SFTP-Abgleich nach Löschen fehlgeschlagen: ${err.message}`));
            }

            res.json({
                success: true,
                message: `Server "${server.name}" wurde erfolgreich gelöscht`
            });
        }
    } catch (error) {
        Logger.error('[Gameserver] Fehler beim Löschen des Servers:', error);
        res.status(500).json({
            success: false,
            message: 'Serverfehler beim Löschen des Gameservers'
        });
    }
});

/**
 * PUT /guild/:guildId/plugins/gameserver/servers/:serverId
 * Server-Einstellungen aktualisieren
 */
router.put('/:serverId', requirePermission('GAMESERVER.EDIT'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    
    try {
        const guildId = res.locals.guildId;
        const { serverId } = req.params;
        // `max_players` wird bewusst NICHT mehr aus dem Formular übernommen
        // (Konzept 23.1): Die Slot-Anzahl ist die Einstellung `max_players` des
        // Pakets (paket_werte), nur die landet im Startbefehl. Die Spalte ist eine abgeleitete Anzeige,
        // die der StatusPoller aus dem Snapshot pflegt. Wer sie hier von Hand
        // überschrieb, änderte am Spiel nichts - der Wert wanderte lautlos zurück,
        // sobald die nächste Abfrage durchlief.
        const {
            name, auto_restart, auto_update,
            allocated_ram_mb, allocated_cpu_percent, allocated_disk_gb,
            backup_keep, backup_keep_days
        } = req.body;

        Logger.info(`[Gameserver] Server-Update angefordert (ID: ${serverId})`);

        // Validierung
        if (!name || typeof name !== 'string' || name.trim().length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Server-Name ist erforderlich'
            });
        }

        // Server existiert prüfen
        const [server] = await dbService.query(
            // `ports` gehoert dazu: die Portvariablen werden unten dagegen
            // geprueft. Ohne die Spalte liefe die Pruefung wirkungslos durch.
            `SELECT id, name, status, rootserver_id, ports, env_variables,
                    allocated_ram_mb, allocated_cpu_percent, allocated_disk_gb
             FROM gameservers WHERE id = ? AND guild_id = ?`,
            [serverId, guildId]
        );

        if (!server) {
            return res.status(404).json({
                success: false,
                message: 'Server nicht gefunden'
            });
        }

        // ════════════════════════════════════════════════════════════════════
        // Ressourcen ändern — inklusive Gegenprüfung gegen den RootServer
        //
        // Geprüft wird nur die *Differenz*: Was dieser Server bereits gebucht
        // hat, ist in der Auslastung schon enthalten und darf ihm nicht ein
        // zweites Mal angerechnet werden.
        // ════════════════════════════════════════════════════════════════════
        const ressourcenFelder = [allocated_ram_mb, allocated_cpu_percent, allocated_disk_gb];
        const ressourcenGesetzt = ressourcenFelder.some(v => v !== undefined && v !== null && v !== '');
        let neueRessourcen = null;

        if (ressourcenGesetzt) {
            const ramMB      = parseInt(allocated_ram_mb, 10);
            const cpuPercent = parseInt(allocated_cpu_percent, 10);
            const diskGB     = parseInt(allocated_disk_gb, 10);

            const fehlend = [];
            if (!Number.isFinite(ramMB)      || ramMB      < 512) fehlend.push('Arbeitsspeicher (mind. 512 MiB)');
            if (!Number.isFinite(cpuPercent) || cpuPercent < 10 || cpuPercent > 1600) fehlend.push('CPU-Anteil (10–1600 %)');
            if (!Number.isFinite(diskGB)     || diskGB     < 1)   fehlend.push('Speicherplatz (mind. 1 GiB)');

            if (fehlend.length) {
                return res.status(400).json({
                    success: false,
                    message: `Ungültige Ressourcenangabe: ${fehlend.join(', ')}`
                });
            }

            const mehrRamMB  = ramMB      - (server.allocated_ram_mb      || 0);
            const mehrCpuPct = cpuPercent - (server.allocated_cpu_percent || 0);
            const mehrDiskGB = diskGB     - (server.allocated_disk_gb     || 0);

            if (mehrRamMB > 0 || mehrCpuPct > 0 || mehrDiskGB > 0) {
                const RootServerModel = require('../../../masterserver/dashboard/models/RootServer');
                await RootServerModel.ensureQuota(server.rootserver_id);
                const platz = await RootServerModel.checkResourceAvailability(server.rootserver_id, {
                    ramMB:    Math.max(0, mehrRamMB),
                    cpuCores: Math.max(0, mehrCpuPct) / 100,
                    diskGB:   Math.max(0, mehrDiskGB)
                });

                if (!platz.available) {
                    const gruende = [];
                    if (platz.missing?.ram)  gruende.push(`${mehrRamMB} MiB mehr angefordert, ${Math.max(0, Math.round(platz.missing.ram.available))} MiB frei`);
                    if (platz.missing?.cpu)  gruende.push(`${mehrCpuPct} % mehr angefordert, ${Math.max(0, Math.round(platz.missing.cpu.available * 100))} % frei`);
                    if (platz.missing?.disk) gruende.push(`${mehrDiskGB} GiB mehr angefordert, ${Math.max(0, Math.round(platz.missing.disk.available))} GiB frei`);

                    return res.status(409).json({
                        success: false,
                        message: gruende.length
                            ? `Auf dem RootServer ist nicht genug frei — ${gruende.join('; ')}.`
                            : `Auf dem RootServer ist nicht genug frei (${platz.reason || 'Kapazität erschöpft'}).`,
                        missing: platz.missing || null
                    });
                }
            }

            neueRessourcen = { ramMB, cpuPercent, diskGB };
        }

        // `env_variables` nimmt diese Route seit dem 2026-09-26 nicht mehr an:
        // Der Start liest sie seit dem 2026-09-10 nicht (Werte kommen aus
        // `paket_werte`, Ports aus der Allocation). Das Feld speicherte, was nie
        // ankam (Egg-Rückbau B).

        // Update ausführen
        const felder = ['name = ?', 'auto_restart = ?', 'auto_update = ?'];
        const werte  = [
            name.trim(),
            toBool(auto_restart) ? 1 : 0,
            toBool(auto_update) ? 1 : 0,
        ];

        if (neueRessourcen) {
            felder.push('allocated_ram_mb = ?', 'allocated_cpu_percent = ?', 'allocated_disk_gb = ?');
            werte.push(neueRessourcen.ramMB, neueRessourcen.cpuPercent, neueRessourcen.diskGB);
        }

        // Backup-Aufbewahrung. Die Grenze haengt seit dem 2026-08-10 am Server,
        // damit sie auch dann gilt, wenn der Backup-Cronjob geloescht wird.
        // Ein leeres Feld heisst hier "unveraendert lassen", eine 0 heisst
        // "unbegrenzt" — deshalb keine Kurzform mit `|| 0`.
        const aufbewahrung = (wert) => {
            if (wert === undefined || wert === null || wert === '') return null;
            const n = Number.parseInt(wert, 10);
            if (!Number.isFinite(n) || n < 0) return 0;
            return Math.min(n, 65535);
        };
        const keep     = aufbewahrung(backup_keep);
        const keepDays = aufbewahrung(backup_keep_days);
        if (keep !== null)     { felder.push('backup_keep = ?');      werte.push(keep); }
        if (keepDays !== null) { felder.push('backup_keep_days = ?'); werte.push(keepDays); }

        werte.push(serverId, guildId);
        await dbService.query(
            `UPDATE gameservers SET ${felder.join(', ')} WHERE id = ? AND guild_id = ?`,
            werte
        );

        Logger.success(`[Gameserver] Server aktualisiert (ID: ${serverId})`);

        res.json({
            success: true,
            message: neueRessourcen
                ? `Server "${name}" aktualisiert — die neuen Ressourcen-Limits greifen beim nächsten Start.`
                : `Server "${name}" erfolgreich aktualisiert`
        });
    } catch (error) {
        Logger.error('[Gameserver] Fehler beim Aktualisieren des Servers:', error);
        res.status(500).json({
            success: false,
            message: 'Serverfehler beim Aktualisieren des Servers'
        });
    }
});

/**
 * POST /guild/:guildId/plugins/gameserver/servers/:serverId/retry-installation
 * Installation für Server mit Status 'error' erneut versuchen
 */
router.post('/:serverId/retry-installation', requirePermission('GAMESERVER.CREATE'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');

    try {
        const guildId = res.locals.guildId;
        const { serverId } = req.params;

        Logger.info(`[Gameserver] Retry-Installation angefordert (ID: ${serverId})`);

        // Server samt Paket — derselbe Weg wie beim Start. Bis zum 2026-09-10
        // lud diese Route frozen_game_data, launch_params und env_variables (das
        // Egg) und schickte das Paket nur dazu, wenn eines gefunden wurde.
        const server = await loadServerForStart(dbService, serverId, guildId);

        if (!server) {
            return res.status(404).json({
                success: false,
                message: 'Server nicht gefunden'
            });
        }

        if (server.status !== 'error' && server.status !== 'installing') {
            return res.status(400).json({
                success: false,
                message: 'Nur Server mit Status "error" oder "installing" können erneut installiert werden'
            });
        }

        if (!server.daemon_id) {
            return res.status(404).json({
                success: false,
                message: 'Kein Daemon zugewiesen'
            });
        }

        const { payload, error: auftragsFehler } = baueInstallNutzlast(server, guildId);
        if (auftragsFehler) {
            return res.status(400).json({ success: false, message: auftragsFehler });
        }

        // Status auf 'installing' setzen und error_message löschen. Ist der
        // Daemon offline, bleibt es dabei — der Wiederanstoß beim Reconnect
        // schickt denselben Auftrag.
        await dbService.query(
            'UPDATE gameservers SET status = ?, error_message = NULL WHERE id = ?',
            ['installing', serverId]
        );

        const ipmServer = ServiceManager.get('ipmServer');

        if (!ipmServer) {
            Logger.warn('[Gameserver] IPMServer nicht verfügbar');
            return res.status(503).json({
                success: false,
                message: 'IPM-Server nicht verfügbar'
            });
        }

        if (!ipmServer.isDaemonOnline(server.daemon_id)) {
            Logger.warn(`[Gameserver] Daemon ${server.daemon_id} ist offline`);
            return res.status(503).json({
                success: false,
                message: 'Daemon ist offline - Server bleibt auf "installing" bis Daemon verbindet'
            });
        }

        Logger.info(`[Gameserver] Sende Install-Command erneut an Daemon ${server.daemon_id}`, {
            serverId,
            paket: server.paket_slug
        });

        const response = await ipmServer.sendCommand(server.daemon_id, 'gameserver.install', payload, 60000);

        if (response.success) {
            Logger.success(`[Gameserver] Installation erneut gestartet für Server ${serverId}`);
            res.json({
                success: true,
                message: `Installation für "${server.name}" wird erneut durchgeführt...`
            });
        } else {
            Logger.error(`[Gameserver] Installation fehlgeschlagen für Server ${serverId}:`, response.error);

            // Status zurück auf 'error' setzen
            await dbService.query(
                'UPDATE gameservers SET status = ?, error_message = ? WHERE id = ?',
                ['error', response.error || 'Installation retry failed', serverId]
            );

            res.status(500).json({
                success: false,
                message: response.error || 'Installation konnte nicht gestartet werden'
            });
        }

    } catch (error) {
        if (error?.code === 'install_laeuft') {
            await installLaeuftNoch(dbService, req.params.serverId);
            return res.status(409).json({ success: false, message: INSTALL_LAEUFT_TEXT });
        }
        Logger.error('[Gameserver] Fehler beim Retry der Installation:', error);
        await dbService.query('UPDATE gameservers SET status = ?, error_message = ? WHERE id = ? AND status = ?',
            ['error', String(error?.message || 'Installation fehlgeschlagen').slice(0, 1000), req.params.serverId, 'installing'])
            .catch(e => Logger.error('[Gameserver] Status nach gescheitertem Retry nicht gesetzt:', e));
        res.status(500).json({
            success: false,
            message: error?.message || 'Serverfehler beim Neustarten der Installation'
        });
    }
});

/**
 * POST /guild/:guildId/plugins/gameserver/servers/:serverId/start
 * Startet einen Gameserver
 */
router.post('/:serverId/start', requirePermission('GAMESERVER.START'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    
    try {
        const guildId = res.locals.guildId;
        const { serverId } = req.params;

        Logger.info(`[Gameserver] Start angefordert (ID: ${serverId})`);

        // Server-Daten laden (identisch zum Neustart-Pfad)
        const server = await loadServerForStart(dbService, serverId, guildId);

        if (!server) {
            return res.status(404).json({
                success: false,
                message: 'Server nicht gefunden'
            });
        }

        // Status-Check
        if (server.status === 'online') {
            return res.status(400).json({
                success: false,
                message: 'Server läuft bereits'
            });
        }

        if (server.status === 'installing') {
            return res.status(400).json({
                success: false,
                message: 'Server wird noch installiert'
            });
        }

        if (!server.daemon_id) {
            return res.status(404).json({
                success: false,
                message: 'Kein Daemon zugewiesen'
            });
        }

        // Ports und Env-Variables parsen
        let ports = {};
        let envVariables = {};
        
        try {
            ports = typeof server.ports === 'string' 
                ? JSON.parse(server.ports) 
                : server.ports || {};
        } catch (error) {
            Logger.error('[Gameserver] Fehler beim Parsen von ports:', error);
        }

        try {
            envVariables = typeof server.env_variables === 'string' 
                ? JSON.parse(server.env_variables) 
                : server.env_variables || {};
        } catch (error) {
            Logger.error('[Gameserver] Fehler beim Parsen von env_variables:', error);
        }

        // 🔥 PORT-KONFLIKT-CHECK: Prüfe ob Ports frei sind
        Logger.debug(`[Gameserver] Prüfe Port-Verfügbarkeit für Server ${serverId}...`);
        
        // TODO: Einfacher Port-Check (ersetzt PortValidator.checkRuntimeConflicts)
        // Für jetzt einfach annehmen dass alle Ports frei sind
        const portCheck = { canStart: true, conflicts: [] };
        
        if (!portCheck.canStart) {
            const conflictMessages = portCheck.conflicts.map(c => 
                `Port ${c.port} (${c.portName}) wird bereits von Server "${c.conflictWith.serverName}" verwendet`
            ).join(', ');
            
            Logger.warn(`[Gameserver] Port-Konflikte erkannt: ${conflictMessages}`);
            
            return res.status(409).json({
                success: false,
                message: `Port-Konflikt: ${conflictMessages}. Bitte stoppe den anderen Server zuerst oder ändere die Ports.`,
                conflicts: portCheck.conflicts
            });
        }
        
        Logger.debug(`[Gameserver] Alle Ports verfügbar ✓`);

        // Payload zentral bauen: Template-Overrides, Variablen-Substitution,
        // Docker-Image, Runtime, Config-Patching und Auto-Update.
        // Dieselbe Funktion nutzen Neustart und Cronjob – sonst driften die Pfade
        // auseinander, wie es beim Restart bereits passiert war.
        const { payload: startPayload, error: payloadError, dockerImage } =
            await buildStartPayload(server, guildId, Logger);

        if (payloadError) {
            Logger.error(`[Gameserver] ${payloadError} (Server ${serverId})`);
            return res.status(500).json({ success: false, message: payloadError });
        }

        Logger.debug(`[Gameserver] Docker-Image: ${dockerImage}`);

        // Daemon-Verfügbarkeit prüfen
        const ipmServer = ServiceManager.get('ipmServer');
        
        if (!ipmServer) {
            return res.status(503).json({
                success: false,
                message: 'IPM-Server nicht verfügbar'
            });
        }

        if (!ipmServer.isDaemonOnline(server.daemon_id)) {
            return res.status(503).json({
                success: false,
                message: 'Daemon ist offline'
            });
        }

        // Status auf 'starting' setzen
        await dbService.query(
            'UPDATE gameservers SET status = ? WHERE id = ?',
            ['starting', serverId]
        );

        // IPM-Command an Daemon senden
        Logger.info(`[Gameserver] Sende Start-Command an Daemon ${server.daemon_id} (Image: ${dockerImage}${startPayload.auto_update ? ', mit Auto-Update' : ''})`);

        const response = await ipmServer.sendCommand(server.daemon_id, 'gameserver.start', startPayload, 30000);

        if (response.success) {
            if (response.task_id) {
                // Async: Daemon hat Task in Queue eingereiht.
                // Status bleibt 'starting' – der Daemon setzt ihn via Events (status_changed: running / crashed)
                Logger.info(`[Gameserver] Start-Task eingereiht für Server ${serverId} (Task: ${response.task_id})`);
                res.json({
                    success: true,
                    message: `Server "${server.name}" wird gestartet...`,
                    task_id: response.task_id
                });
            } else {
                // Sync: Container wurde direkt gestartet – done_string wird vom Daemon abgewartet.
                // Status bleibt 'starting', der Daemon sendet das "running" Event wenn spielbereit.
                await dbService.query(
                    'UPDATE gameservers SET last_started_at = NOW() WHERE id = ?',
                    [serverId]
                );
                Logger.success(`[Gameserver] Server ${serverId} wird gestartet (warte auf done_string)`);
                res.json({
                    success: true,
                    message: `Server "${server.name}" wird gestartet...`
                });
            }
        } else {
            // Status auf 'error' setzen (nicht 'offline' — User soll Fehler sehen)
            await dbService.query(
                'UPDATE gameservers SET status = ?, error_message = ? WHERE id = ?',
                ['error', response.error || 'Start failed', serverId]
            );

            // SSE-Broadcast damit Browser sofort den Error-Status sieht
            const sseManager = ServiceManager.get('sseManager');
            if (sseManager) {
                sseManager.broadcast(guildId, 'gameserver', {
                    action: 'status_changed',
                    server_id: String(serverId),
                    status: 'error',
                    error_message: response.error || 'Start failed',
                    timestamp: Date.now()
                });
            }

            Logger.error(`[Gameserver] Start fehlgeschlagen für Server ${serverId}:`, response.error);
            
            res.status(500).json({
                success: false,
                message: response.error || 'Server konnte nicht gestartet werden'
            });
        }

    } catch (error) {
        Logger.error('[Gameserver] Fehler beim Starten des Servers:', error);
        res.status(500).json({
            success: false,
            message: 'Serverfehler beim Starten'
        });
    }
});

/**
 * POST /guild/:guildId/plugins/gameserver/servers/:serverId/stop
 * Stoppt einen laufenden Gameserver
 */
router.post('/:serverId/stop', requirePermission('GAMESERVER.STOP'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    
    try {
        const guildId = res.locals.guildId;
        const { serverId } = req.params;

        Logger.info(`[Gameserver] Stop angefordert (ID: ${serverId})`);

        // Server-Daten laden
        const [server] = await dbService.query(
            `SELECT gs.*, r.daemon_id
             FROM gameservers gs
             LEFT JOIN rootserver r ON gs.rootserver_id = r.id
             WHERE gs.id = ? AND gs.guild_id = ?`,
            [serverId, guildId]
        );

        if (!server) {
            return res.status(404).json({
                success: false,
                message: 'Server nicht gefunden'
            });
        }

        // ── Seit dem 2026-09-14 über EINEN Helfer ──────────────────────────────
        //
        // Bis dahin prüfte diese Route selbst (`online`/`starting`), schrieb nach
        // der Antwort des Daemons sofort `offline` und schickte dem Browser nichts.
        // Der Daemon reiht den Stopp aber nur ein (`queued`) — `stopping` kam nie
        // live an, und ein noch laufender Container stand in der Datenbank schon
        // auf `offline`. Einzelheiten in helpers/ServerStopp.js; das Löschen
        // benutzt denselben Helfer, damit es erst dann Dateien anfasst, wenn der
        // Server wirklich unten ist.
        const ergebnis = await ServerStopp.stoppe({ server, guildId });
        if (!ergebnis.ok) {
            return res.status(ergebnis.status || 500).json({
                success: false,
                message: ergebnis.grund
            });
        }

        res.json({
            success: true,
            eingereiht: Boolean(ergebnis.eingereiht),
            message: ergebnis.eingereiht
                ? `Server "${server.name}" wird gestoppt …`
                : `Server "${server.name}" wurde gestoppt`
        });
    } catch (error) {
        Logger.error('[Gameserver] Fehler beim Stoppen des Servers:', error);
        res.status(500).json({
            success: false,
            message: 'Serverfehler beim Stoppen'
        });
    }
});

/**
 * POST /guild/:guildId/plugins/gameserver/servers/:serverId/restart
 * Startet einen Gameserver neu
 */
router.post('/:serverId/restart', requirePermission('GAMESERVER.RESTART'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    
    try {
        const guildId = res.locals.guildId;
        const { serverId } = req.params;

        Logger.info(`[Gameserver] Restart angefordert (ID: ${serverId})`);

        // Server-Daten laden (gleiche Felder wie beim Start – der Daemon braucht
        // beim Neustart dieselbe Konfiguration)
        const server = await loadServerForStart(dbService, serverId, guildId);

        if (!server) {
            return res.status(404).json({
                success: false,
                message: 'Server nicht gefunden'
            });
        }

        if (!server.daemon_id) {
            return res.status(404).json({
                success: false,
                message: 'Kein Daemon zugewiesen'
            });
        }

        const ipmServer = ServiceManager.get('ipmServer');
        
        if (!ipmServer) {
            return res.status(503).json({
                success: false,
                message: 'IPM-Server nicht verfügbar'
            });
        }

        if (!ipmServer.isDaemonOnline(server.daemon_id)) {
            return res.status(503).json({
                success: false,
                message: 'Daemon ist offline'
            });
        }

        // Status auf 'starting' setzen (ENUM hat kein 'restarting')
        await dbService.query(
            'UPDATE gameservers SET status = ? WHERE id = ?',
            ['starting', serverId]
        );

        // IPM-Command an Daemon senden
        Logger.info(`[Gameserver] Sende Restart-Command an Daemon ${server.daemon_id}`);

        // Vollständiges Payload wie beim Start: Image, Startup-Command, Ports und
        // Config leben nur im Speicher des Daemons. Nach einem Daemon-Neustart
        // stoppte ein Restart den Server sonst und scheiterte dann mit
        // "docker image not set".
        const { payload: restartPayload, error: payloadError } = await buildStartPayload(server, guildId, Logger);
        if (payloadError) {
            return res.status(500).json({ success: false, message: payloadError });
        }

        const response = await ipmServer.sendCommand(server.daemon_id, 'gameserver.restart', restartPayload, 30000);

        if (response.success) {
            // Der Status bleibt „starting", bis der Daemon „läuft" meldet — wie
            // beim Start. Bis zum 2026-09-10 stand er hier sofort auf „online",
            // auch während eines Updates von zwei Gigabyte.
            await dbService.query(
                'UPDATE gameservers SET last_started_at = NOW() WHERE id = ?',
                [serverId]
            );

            Logger.success(`[Gameserver] Neustart von Server ${serverId} angenommen`);
            
            res.json({
                success: true,
                message: `Server "${server.name}" wurde neu gestartet`
            });
        } else {
            // Status auf 'offline' setzen falls Restart fehlschlägt
            await dbService.query(
                'UPDATE gameservers SET status = ?, error_message = ? WHERE id = ?',
                ['offline', response.error || 'Restart failed', serverId]
            );

            Logger.error(`[Gameserver] Restart fehlgeschlagen für Server ${serverId}:`, response.error);
            
            res.status(500).json({
                success: false,
                message: response.error || 'Server konnte nicht neu gestartet werden'
            });
        }

    } catch (error) {
        Logger.error('[Gameserver] Fehler beim Neustarten des Servers:', error);
        res.status(500).json({
            success: false,
            message: 'Serverfehler beim Neustarten'
        });
    }
});

/**
 * POST /guild/:guildId/plugins/gameserver/servers/:serverId/reinstall
 * Installiert einen Gameserver neu (bei error-Status)
 */
router.post('/:serverId/reinstall', requirePermission('GAMESERVER.CREATE'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');

    try {
        const guildId = res.locals.guildId;
        const { serverId } = req.params;

        Logger.info(`[Gameserver] Reinstall angefordert (ID: ${serverId})`);

        // Server samt Paket — derselbe Weg wie beim Start (loadServerForStart).
        const server = await loadServerForStart(dbService, serverId, guildId);

        if (!server) {
            return res.status(404).json({
                success: false,
                message: 'Server nicht gefunden'
            });
        }

        if (!server.daemon_id) {
            return res.status(404).json({
                success: false,
                message: 'Kein Daemon zugewiesen'
            });
        }

        // Derselbe Auftrag wie beim Anlegen, mit `reinstall`. Bis zum 2026-09-10
        // schickte diese Route das Egg aus frozen_game_data mit, und das Paket
        // nur, wenn eines gefunden wurde. Datenerhalt ist bei der Umstellung
        // ausdrücklich NICHT gefordert (Betreiber, 2026-08-19).
        const { payload: installConfig, error: auftragsFehler } =
            baueInstallNutzlast(server, guildId, { reinstall: true });
        if (auftragsFehler) {
            return res.status(400).json({ success: false, message: auftragsFehler });
        }

        const ipmServer = ServiceManager.get('ipmServer');

        if (!ipmServer) {
            return res.status(503).json({
                success: false,
                message: 'IPM-Server nicht verfügbar'
            });
        }

        if (!ipmServer.isDaemonOnline(server.daemon_id)) {
            return res.status(503).json({
                success: false,
                message: 'Daemon ist offline'
            });
        }

        // ── Läuft er? Dann erst sauber stoppen (Baustelle 155) ──────────────
        //
        // Wie beim Löschen: Der Daemon installiert in das Volume, ohne auf den
        // Container zu sehen. Am 2026-09-24 lief #202 dabei weiter und stand
        // danach im Panel auf `offline`. Kommt der Server nicht sicher herunter,
        // wird nichts installiert.
        const stopp = await ServerStopp.stoppeFallsLaeuft({ server, guildId });
        if (!stopp.ok) {
            Logger.warn(`[Gameserver] Neuinstallation von Server ${serverId} abgebrochen: ${stopp.grund}`);
            return res.status(stopp.status).json({
                success: false,
                message: `${stopp.grund}. Es wurde nichts neu installiert.`
            });
        }

        // Status auf 'installing' setzen
        await dbService.query(
            'UPDATE gameservers SET status = ?, error_message = NULL WHERE id = ?',
            ['installing', serverId]
        );

        Logger.info(`[Gameserver] Sende Reinstall-Command an Daemon ${server.daemon_id}`);

        const response = await ipmServer.sendCommand(server.daemon_id, 'gameserver.install', installConfig, 60000);

        if (response.success) {
            Logger.success(`[Gameserver] Reinstall für Server ${serverId} gestartet`);

            res.json({
                success: true,
                message: (stopp.gestoppt ? `"${server.name}" wurde gestoppt. ` : '')
                    + `Neuinstallation von "${server.name}" wurde gestartet. Du erhältst eine Benachrichtigung, wenn sie abgeschlossen ist.`,
                gestoppt: stopp.gestoppt,
                task_id: response.task_id
            });
        } else {
            // Status zurück auf 'error' setzen
            await dbService.query(
                'UPDATE gameservers SET status = ?, error_message = ? WHERE id = ?',
                ['error', response.error || 'Reinstall failed', serverId]
            );

            Logger.error(`[Gameserver] Reinstall fehlgeschlagen für Server ${serverId}:`, response.error);

            res.status(500).json({
                success: false,
                message: response.error || 'Neuinstallation konnte nicht gestartet werden'
            });
        }

    } catch (error) {
        // `sendCommand` WIRFT bei einer Ablehnung — der `else`-Zweig oben
        // war nie erreichbar, und der Server blieb auf „installing" stehen.
        if (error?.code === 'install_laeuft') {
            await installLaeuftNoch(dbService, req.params.serverId);
            return res.status(409).json({ success: false, message: INSTALL_LAEUFT_TEXT });
        }
        Logger.error('[Gameserver] Fehler beim Reinstall des Servers:', error);
        await dbService.query('UPDATE gameservers SET status = ?, error_message = ? WHERE id = ? AND status = ?',
            ['error', String(error?.message || 'Reinstall fehlgeschlagen').slice(0, 1000), req.params.serverId, 'installing'])
            .catch(e => Logger.error('[Gameserver] Status nach gescheitertem Reinstall nicht gesetzt:', e));
        res.status(500).json({
            success: false,
            message: error?.message || 'Serverfehler beim Reinstall'
        });
    }
});

// Hier stand bis zum 2026-09-26 `PUT/POST /:serverId/launch-params`. Es
// schrieb `gameservers.launch_params` — die Startzeile der Egg-Zeit, die der
// Start seit dem 2026-09-10 nicht liest — und keine Vorlage rief es auf
// (Egg-Rückbau B).

// ============================================================
// PORTS: Server-Ports aktualisieren
// PUT /guild/:guildId/plugins/gameserver/servers/:serverId/ports
// ============================================================
router.put('/:serverId/ports', requirePermission('GAMESERVER.EDIT'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');

    try {
        const guildId = res.locals.guildId;
        const serverId = req.params.serverId;
        const portUpdates = req.body; // { game: 27015, query: 27016, ... }

        if (!portUpdates || typeof portUpdates !== 'object') {
            return res.status(400).json({ success: false, message: 'Ungültiges Format – erwartet { portKey: portNumber }' });
        }

        const [server] = await dbService.query(
            'SELECT id, status, ports FROM gameservers WHERE id = ? AND guild_id = ?',
            [serverId, guildId]
        );
        if (!server) return res.status(404).json({ success: false, message: 'Server nicht gefunden' });

        if (server.status === 'online' || server.status === 'starting') {
            return res.status(409).json({ success: false, message: 'Ports können nicht geändert werden solange der Server läuft' });
        }

        // Validierung: nur gültige Port-Nummern
        for (const [key, val] of Object.entries(portUpdates)) {
            if (!/^[a-zA-Z0-9_]+$/.test(key)) return res.status(400).json({ success: false, message: `Ungültiger Port-Key: ${key}` });
            const p = parseInt(val, 10);
            if (isNaN(p) || p < 1024 || p > 65535) return res.status(400).json({ success: false, message: `Ungültiger Port-Wert für "${key}": ${val}` });
        }

        // Bestehende Ports laden und mergen
        let currentPorts = {};
        try { currentPorts = typeof server.ports === 'string' ? JSON.parse(server.ports) : (server.ports || {}); } catch (_) {}

        for (const [key, val] of Object.entries(portUpdates)) {
            const p = parseInt(val, 10);
            if (!currentPorts[key]) currentPorts[key] = {};
            currentPorts[key].external = p;
            currentPorts[key].internal = p;
        }

        await dbService.query(
            'UPDATE gameservers SET ports = ?, updated_at = NOW() WHERE id = ?',
            [JSON.stringify(currentPorts), serverId]
        );

        Logger.info(`[Gameserver] Ports aktualisiert für Server ${serverId}: ${JSON.stringify(portUpdates)}`);
        return res.json({ success: true, message: 'Ports gespeichert', ports: currentPorts });

    } catch (error) {
        Logger.error('[Gameserver] Fehler beim Aktualisieren der Ports:', error);
        return res.status(500).json({ success: false, message: 'Interner Fehler' });
    }
});

// Hier stand bis zum 2026-09-26 `POST /:serverId/apply-config` — der
// Rohmodus patchte damit die `config.files` des Eggs (frozen_game_data) über
// `gameserver.apply_config`. Paket-Server hatten dort nichts; Dateien setzt
// das Paket selbst (`files.patch`, `apply` der Einstellungen) beim Start.

// ============================================================
// KANAL: Welcher Paketfassung der Server folgt (Baustelle 172)
// PUT /guild/:guildId/plugins/gameserver/servers/:serverId/kanal
// ============================================================
//
// `stable` = die neueste freigegebene Fassung, `test` = die neueste überhaupt.
// Die Regeln (test nur in der Guild des Betreibers, stable nur mit einer
// freigegebenen Fassung) stehen in helpers/Paketfassung.js. Wirksam wird der
// Wechsel beim nächsten Start — ein laufender Server behält, womit er läuft.
router.put('/:serverId/kanal', requirePermission('GAMESERVER.EDIT'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    try {
        const ergebnis = await kanalSetzen(dbService, {
            serverId: req.params.serverId,
            guildId: res.locals.guildId,
            kanal: typeof req.body?.kanal === 'string' ? req.body.kanal : '',
        });
        if (ergebnis.geaendert) {
            Logger.info(`[Gameserver] Server ${req.params.serverId} folgt jetzt dem Kanal ${ergebnis.kanal}`);
        }
        return res.json({
            success: true, ...ergebnis,
            message: ergebnis.kanal === 'test'
                ? 'Der Server folgt jetzt „test" — ab dem nächsten Start mit der neuesten Fassung.'
                : 'Der Server folgt jetzt „stable" — ab dem nächsten Start mit der neuesten freigegebenen Fassung.',
        });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
});

// ============================================================
// EINSTELLUNGEN: Werte des Servers ändern (Einstellungskarte)
// PUT /guild/:guildId/plugins/gameserver/servers/:serverId/variables
// ============================================================
//
// Geschrieben wird `paket_werte` — genau das, woraus Start, Neustart und
// Installation lesen (StartPayload.js). Bis zum 2026-09-10 schrieb diese Route
// nach `env_variables`, der Spalte des Eggs. Der Startweg liest seit dem
// 2026-08-23 (Stufe 5a) `paket_werte`: Was man auf der Einstellungskarte
// speicherte, kam bei keinem Paket-Server an — und die Karte zeigte nach dem
// Neuladen wieder den alten Wert.
//
// Angenommen wird nur, was das Paket als Einstellung nennt. Ein Server ohne
// Paket hat keine Einstellungen — kein Rückfall auf Egg-Variablen.
router.put('/:serverId/variables', requirePermission('GAMESERVER.EDIT'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');

    try {
        const guildId = res.locals.guildId;
        const serverId = req.params.serverId;
        const updates = req.body; // { <schlüssel des Pakets>: wert, ... }

        if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
            return res.status(400).json({ success: false, message: 'Ungültiges Format' });
        }

        const server = await loadServerForStart(dbService, serverId, guildId);
        if (!server) {
            return res.status(404).json({ success: false, message: 'Server nicht gefunden' });
        }
        let paket = null;
        try {
            paket = typeof server.paket_json === 'string' ? JSON.parse(server.paket_json) : server.paket_json;
        } catch (_) { paket = null; }
        if (!paket) {
            return res.status(400).json({ success: false,
                message: 'Dieser Server hat kein Spielpaket — ohne Paket gibt es keine Einstellungen.' });
        }

        let werte = {};
        try {
            werte = typeof server.paket_werte === 'string'
                ? JSON.parse(server.paket_werte) : (server.paket_werte || {});
        } catch (_) { werte = {}; }

        const nachSchluessel = new Map((paket.settings || []).map(e => [e.key, e]));
        const unbekannt = Object.keys(updates).filter(k => !nachSchluessel.has(k));
        if (unbekannt.length) {
            return res.status(400).json({ success: false,
                message: `Keine Einstellung dieses Pakets: ${unbekannt.join(', ')}` });
        }

        for (const [key, roh] of Object.entries(updates)) {
            const eintrag = nachSchluessel.get(key);
            const wert = String(roh ?? '');
            if (Array.isArray(eintrag.choices) && !eintrag.choices.some(c => String(c.value) === wert)) {
                return res.status(400).json({ success: false, message: `„${key}": ${wert} ist keine der Möglichkeiten` });
            }
            if (eintrag.type === 'number' && wert !== '' && !Number.isFinite(Number(wert))) {
                return res.status(400).json({ success: false, message: `„${key}" erwartet eine Zahl` });
            }
            // Ja/Nein immer als 1/0 — wie beim Anlegen (paketWerteAnlegen).
            werte[key] = eintrag.type === 'boolean' ? (istWahr(wert) ? '1' : '0') : wert;
        }

        await dbService.query(
            'UPDATE gameservers SET paket_werte = ?, updated_at = NOW() WHERE id = ?',
            [JSON.stringify(werte), server.id]
        );

        Logger.info(`[Gameserver] Einstellungen gespeichert für Server ${serverId}: ${Object.keys(updates).join(', ')}`);
        return res.json({ success: true, message: 'Einstellungen gespeichert' });

    } catch (error) {
        Logger.error('[Gameserver] Fehler beim Speichern der Einstellungen:', error);
        return res.status(500).json({ success: false, message: 'Serverfehler' });
    }
});

// ============================================================
// MIGRATION: Server zwischen RootServern verschieben
// POST /guild/:guildId/plugins/gameserver/servers/:serverId/migrate
// ============================================================
router.post('/:serverId/migrate', requirePermission('GAMESERVER.EDIT'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');

    try {
        const guildId = res.locals.guildId;
        const serverId = req.params.serverId;
        const { target_rootserver_id } = req.body;

        if (!target_rootserver_id) {
            return res.status(400).json({ success: false, message: 'target_rootserver_id erforderlich' });
        }

        const userId = req.user?.id || res.locals.userId || 'DASHBOARD';

        Logger.info(`[Gameserver] Migration-Request: Server ${serverId} -> RootServer ${target_rootserver_id} (User: ${userId})`);

        const MigrationManager = require('../helpers/MigrationManager.js');
        const result = await MigrationManager.startMigration(
            parseInt(serverId, 10),
            parseInt(target_rootserver_id, 10),
            String(userId),
            guildId
        );

        if (!result.success) {
            return res.status(400).json({ success: false, message: result.error });
        }

        return res.json({
            success: true,
            migration_id: result.migrationId,
            message: 'Migration gestartet. Du erhältst Live-Updates via SSE.'
        });

    } catch (error) {
        Logger.error('[Gameserver] Fehler beim Starten der Migration:', error);
        return res.status(500).json({ success: false, message: 'Serverfehler beim Starten der Migration' });
    }
});

// ============================================================
// MIGRATION STATUS: Abrufen des aktuellen Migration-Status
// GET /guild/:guildId/plugins/gameserver/servers/:serverId/migration/status
// ============================================================
router.get('/:serverId/migration/status', requirePermission('GAMESERVER.VIEW'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');

    try {
        const guildId = res.locals.guildId;
        const serverId = req.params.serverId;

        // Letzte Migration für diesen Server finden
        const [migration] = await dbService.query(
            `SELECT * FROM gameserver_migrations 
             WHERE server_id = ? 
             ORDER BY started_at DESC 
             LIMIT 1`,
            [serverId]
        );

        // Server-Infos hinzufügen
        const [server] = await dbService.query(
            'SELECT id, name, status FROM gameservers WHERE id = ? AND guild_id = ?',
            [serverId, guildId]
        );

        if (!server) {
            return res.status(404).json({ success: false, message: 'Server nicht gefunden' });
        }

        // "Noch nie migriert" ist der Normalfall, kein Fehler.
        //
        // Die Antwort war hier ein 404. Die Seite ruft den Status bei jedem
        // Aufruf ab, also erschien in den Entwicklerwerkzeugen bei praktisch
        // jedem Server ein roter Fehler — fuer einen voellig gesunden Zustand.
        // Das verdeckt echte Fehler, und genau dafuer schaut man dort hin.
        if (!migration) {
            return res.json({ success: true, migration: null, server: {
                id: server.id,
                name: server.name,
                status: server.status
            } });
        }

        return res.json({
            success: true,
            migration: {
                id: migration.id,
                status: migration.status,
                progress_percent: migration.progress_percent,
                current_step: migration.current_step,
                error_message: migration.error_message,
                started_at: migration.started_at,
                completed_at: migration.completed_at,
                source_rootserver_id: migration.source_rootserver_id,
                target_rootserver_id: migration.target_rootserver_id
            },
            server: {
                id: server.id,
                name: server.name,
                status: server.status
            }
        });

    } catch (error) {
        Logger.error('[Gameserver] Fehler beim Abrufen des Migration-Status:', error);
        return res.status(500).json({ success: false, message: 'Serverfehler' });
    }
});

// ============================================================
// SFTP: Passwort zurücksetzen
// POST /guild/:guildId/plugins/gameserver/servers/:serverId/sftp/reset-password
// ============================================================
router.post('/:serverId/sftp/reset-password', requirePermission('GAMESERVER.EDIT'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');

    try {
        const guildId = res.locals.guildId;
        const serverId = req.params.serverId;

        const [server] = await dbService.query(
            `SELECT gs.id, gs.sftp_username, gs.guild_id,
                    r.daemon_id, r.hostname, r.host, r.system_user
             FROM gameservers gs
             LEFT JOIN rootserver r ON gs.rootserver_id = r.id
             WHERE gs.id = ? AND gs.guild_id = ?`,
            [serverId, guildId]
        );

        if (!server) {
            return res.status(404).json({ success: false, message: 'Server nicht gefunden' });
        }

        // Username = immer der system_user des RootServers
        const sftp_username = server.system_user || server.sftp_username || `gs-${String(server.id).padStart(8, '0')}`;

        const { klartext, synchronisiert, fehler } = await _setzeSftpPasswort(dbService, {
            serverId: server.id,
            username: sftp_username,
            daemonId: server.daemon_id,
            guildId
        });

        if (!synchronisiert) {
            // Das alte Passwort gilt auf dem Rootserver weiter, das neue steht
            // schon in der Datenbank. Beides auszusprechen ist ehrlicher, als
            // ein Passwort auszugeben, das gerade nirgends funktioniert.
            Logger.warn(`[Gameserver] SFTP-Passwort für Server ${serverId} nicht zum Daemon übertragen: ${fehler?.message}`);
            return res.status(503).json({
                success: false,
                message: 'Der Rootserver war nicht erreichbar. Das neue Passwort ist noch nicht aktiv — '
                       + 'bitte erneut zurücksetzen, sobald er wieder online ist.'
            });
        }

        Logger.info(`[Gameserver] SFTP-Passwort zurückgesetzt für Server ${serverId}`);

        // Festhalten, dass der Klartext einmal sichtbar war. Ohne das steht auf
        // der Übersicht "Gesetzt" — auch für Passwörter, die beim Anlegen
        // erzeugt und sofort verworfen wurden und die nie jemand gesehen hat.
        await dbService.query(
            'UPDATE gameservers SET sftp_password_seen_at = NOW() WHERE id = ?',
            [serverId]
        );

        // Einzige Gelegenheit, den Klartext zu sehen — gespeichert ist nur der Hash.
        return res.json({ success: true, sftp_username, sftp_password: klartext });

    } catch (error) {
        Logger.error('[Gameserver] Fehler beim Zurücksetzen des SFTP-Passworts:', error);
        return res.status(500).json({ success: false, message: 'Serverfehler' });
    }
});

// ============================================================
// SFTP-Helper: Credentials per IPM an Daemon synchronisieren
// ============================================================
// Übertragen wird der bcrypt-Hash, nicht das Passwort. Der Daemon vergleicht
// beim Anmelden dagegen — das Klartext-Passwort verlässt das Dashboard nie.
async function _syncSftpUserToDaemon(daemonId, serverId, username, passwordHash, guildId) {
    if (!daemonId) return;
    const ipmServer = ServiceManager.get('ipmServer');
    if (!ipmServer) return;
    await ipmServer.sendCommand(daemonId, 'sftp.user.sync', {
        server_id: serverId,
        guild_id: guildId,
        username,
        password_hash: passwordHash
    });
}

// Erzeugt ein neues SFTP-Passwort, legt nur dessen Hash ab und meldet ihn dem
// Daemon. Der zurückgegebene Klartext ist die einzige Gelegenheit, ihn zu
// zeigen — danach ist er nirgends mehr abrufbar.
//
// `synchronisiert` sagt, ob der Rootserver das neue Passwort auch bekommen hat.
// Ist er offline, gilt dort weiter das alte: Das Dashboard darf dann kein
// funktionierendes Passwort vortäuschen.
async function _setzeSftpPasswort(dbService, { serverId, username, daemonId, guildId }) {
    const klartext = crypto.randomBytes(10).toString('hex'); // 20 Zeichen hex
    const hash = await bcrypt.hash(klartext, 10);

    await dbService.query(
        'UPDATE gameservers SET sftp_username = ?, sftp_password_hash = ? WHERE id = ?',
        [username, hash, serverId]
    );

    let synchronisiert = true;
    let fehler = null;
    try {
        await _syncSftpUserToDaemon(daemonId, String(serverId), username, hash, guildId);
    } catch (err) {
        synchronisiert = false;
        fehler = err;
    }

    return { klartext, synchronisiert, fehler };
}

// ============================================================
/**
 * Paket und Werte einer Serverzeile — beide als Objekt, beide fehlertolerant.
 *
 * Steht hier und nicht in jeder Route einzeln: Die Fernsteuerung braucht beide,
 * und zwei Parse-Stellen mit je eigenem try/catch driften auseinander.
 */
function ladePaketUndWerte(zeile) {
    const lies = (wert, vorgabe) => {
        try {
            return typeof wert === 'string' ? JSON.parse(wert) : (wert || vorgabe);
        } catch { return vorgabe; }
    };
    return {
        paket: lies(zeile?.paket_json, null),
        werte: lies(zeile?.paket_werte, {}) || {},
    };
}

// POST /:serverId/rcon – RCON-Befehl senden
// ============================================================
router.post('/:serverId/rcon', requirePermission('GAMESERVER.RCON'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const ipmServer = ServiceManager.get('ipmServer');

    try {
        const guildId = res.locals.guildId;
        const serverId = req.params.serverId;
        const command = (req.body.command || '').trim();

        // Discord-User für Rate-Limit und Protokoll - dieselbe Quelle wie in
        // routes/console.js, damit beide Wege auf denselben Zähler laufen.
        const userId = req.session?.user?.info?.id || res.locals.user?.info?.id || 'unknown';

        if (!command) {
            return res.status(400).json({ success: false, message: 'Befehl darf nicht leer sein' });
        }
        if (command.length > 512) {
            return res.status(400).json({ success: false, message: 'Befehl zu lang (max. 512 Zeichen)' });
        }

        // Rate-Limit vor der Datenbankarbeit: Ein Spammer soll keine Abfragen auslösen.
        const rateLimitCheck = rateLimiter.check(userId);
        if (!rateLimitCheck.allowed) {
            Logger.warn(`[RCON] Rate-Limit erreicht: User ${userId}`, { serverId, guildId });
            return res.status(429).json({ success: false, message: rateLimitCheck.error });
        }

        // `paket_werte` und das Paket gehoeren dazu: Bei einem Server aus einem
        // Spielpaket steht die Fernsteuerung dort, nicht in `game_data`
        // (2026-09-22). Die Fassung waehlt dieselbe Regel wie ueberall:
        // `stable` vor `test`, danach die neueste.
        const [server] = await dbService.query(`
            SELECT gs.id, gs.ports, gs.env_variables, gs.bind_ip, gs.paket_werte,
                   r.daemon_id, r.host AS rootserver_ip,
                   am.game_data,
                   pv.fbpkg AS paket_json
            FROM gameservers gs
            LEFT JOIN rootserver r ON gs.rootserver_id = r.id
            LEFT JOIN addon_marketplace am ON gs.addon_marketplace_id = am.id
            LEFT JOIN packages pk ON pk.id = gs.addon_marketplace_id
            LEFT JOIN package_versions pv ON pv.id = ${FASSUNG_FUER_SERVER}
            WHERE gs.id = ? AND gs.guild_id = ?
        `, [serverId, guildId]);

        if (!server) {
            return res.status(404).json({ success: false, message: 'Server nicht gefunden' });
        }

        // game_data (Egg) parsen
        let gameData = {};
        try {
            gameData = typeof server.game_data === 'string'
                ? JSON.parse(server.game_data) : (server.game_data || {});
        } catch (_) { /* ignorieren */ }

        // ports + env_variables parsen
        let ports = {};
        try { ports = typeof server.ports === 'string' ? JSON.parse(server.ports) : (server.ports || {}); } catch (_) { /* */ }
        let envVars = {};
        try { envVars = typeof server.env_variables === 'string' ? JSON.parse(server.env_variables) : (server.env_variables || {}); } catch (_) { /* */ }

        // Port, Passwort und Protokoll zentral auflösen (gleiche Prüfung wie in der View).
        //
        // Das PAKET geht mit: Ein Server aus einem Spielpaket hat kein
        // `game_data.config.rcon` — seine Fernsteuerung steht in
        // `management.rcon`, der Port als Zweck und das Kennwort als
        // Einstellung (2026-09-22).
        const paketFuerRcon = ladePaketUndWerte(server);
        const rcon = StatusService.resolveRcon({
            gameData, ports, envVars,
            paket: paketFuerRcon.paket, paketWerte: paketFuerRcon.werte,
        });
        if (!rcon.available) {
            return res.status(400).json({ success: false, message: rcon.reason || 'RCON ist für diesen Gameserver nicht verfügbar' });
        }
        if (!server.daemon_id) {
            return res.status(400).json({ success: false, message: 'Kein Daemon für diesen Server konfiguriert' });
        }

        // Blacklist und Muster prüfen - erst hier, weil die Ausnahme aus dem Addon
        // kommt: Palworld stoppt per `shutdown 15`, und `shutdown` steht auf der
        // Blacklist. Der vom Spiel selbst deklarierte Stoppbefehl darf durch,
        // sonst sperrte der Schutzwall den regulären Weg.
        const stoppBefehl = String(gameData.startup?.stop || '').trim().split(/\s+/)[0];
        const validation = validateCommand(command, {
            userId,
            serverId,
            guildId,
            zusaetzlichErlaubt: stoppBefehl ? [stoppBefehl] : []
        });

        if (!validation.valid) {
            Logger.warn(`[RCON] Befehl blockiert: ${command}`, {
                userId, serverId, guildId, reason: validation.error
            });
            return res.status(400).json({ success: false, message: validation.error });
        }

        // Das Kennwort kommt aus derselben Auflösung. Hier stand
        // `envVars[gameData.config.rcon.password_var]` — die Egg-Schreibweise,
        // und sie WIRFT bei einem Paketserver, weil `gameData.config` fehlt.
        const rconPassword = rcon.password || '';

        // sendCommand wirft, wenn der Daemon success:false meldet – die eigentliche
        // Meldung ("Verbindung abgelehnt", "falsches Passwort", …) steckt dann in
        // der Exception. Ohne dieses catch landete alles im generischen
        // "Serverfehler" und der Grund war nirgends sichtbar.
        let result;
        try {
            result = await ipmServer.sendCommand(server.daemon_id, 'gameserver.rcon', {
                guild_id: guildId,
                server_id: String(server.id),
                rcon_host: server.bind_ip || server.rootserver_ip || '127.0.0.1',
                rcon_port: rcon.port,
                rcon_password: rconPassword,
                rcon_protocol: rcon.protocol || 'srcds',
                rcon_command: validation.sanitized
            }, 15000);
        } catch (cmdError) {
            const reason = cmdError?.message || 'RCON-Befehl fehlgeschlagen';
            Logger.warn(`[Gameserver] RCON-Fehler für Server ${serverId}: ${reason}`);
            StatusService.recordRconResult(server.id, guildId, false, reason).catch(() => {});
            return res.json({ success: false, message: reason });
        }

        // Tatsächliches Ergebnis festhalten – davon lebt die RCON-Anzeige
        StatusService.recordRconResult(server.id, guildId, !!result?.success, result?.error)
            .catch(() => { /* Anzeige-Detail, kein Grund den Befehl scheitern zu lassen */ });

        if (!result?.success) {
            Logger.warn(`[Gameserver] RCON-Fehler für Server ${serverId}: ${result?.error}`);
            return res.json({ success: false, message: result?.error || 'RCON-Befehl fehlgeschlagen' });
        }

        Logger.info(`[Gameserver] RCON-Befehl ausgeführt (Server ${serverId}): ${validation.sanitized}`, {
            userId, remaining: rateLimitCheck.remaining
        });
        return res.json({ success: true, output: result.output || '' });

    } catch (error) {
        Logger.error('[Gameserver] RCON-Route Fehler:', error);
        return res.status(500).json({ success: false, message: 'Serverfehler beim Ausführen des RCON-Befehls' });
    }
});

// ════════════════════════════════════════════════════════════════════════════
// BACKUP ROUTEN
// ════════════════════════════════════════════════════════════════════════════

/**
 * GET /guild/:guildId/plugins/gameserver/servers/:serverId/backups
 * Backup-Liste für einen Server
 */
router.get('/:serverId/backups', requirePermission('GAMESERVER.BACKUPS.VIEW'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');

    try {
        const { serverId } = req.params;
        const guildId = res.locals.guildId;

        // Prüfen ob Server zur Guild gehört
        const [server] = await dbService.query(
            'SELECT id, name FROM gameservers WHERE id = ? AND guild_id = ?',
            [serverId, guildId]
        );
        if (!server) return res.status(404).json({ success: false, message: 'Server nicht gefunden' });

        const backups = await dbService.query(
            `SELECT id, name, size_bytes, status, note, created_by, created_at, completed_at, error_message
             FROM gameserver_backups
             WHERE server_id = ?
             ORDER BY created_at DESC`,
            [serverId]
        );

        // Ob das Herunterladen ueberhaupt angeboten werden kann: Der Daemon
        // meldet bei jeder Anmeldung den Port seines Sicherungsabrufs. Fehlt er
        // (aeltere Bauart, oder der Zuhoerer kam nicht hoch), soll gar kein
        // Knopf erscheinen - einer, der auf eine tote Adresse zeigt, ist
        // schlimmer als keiner.
        const [maschine] = await dbService.query(
            `SELECT r.abruf_port
               FROM gameservers gs JOIN rootserver r ON r.id = gs.rootserver_id
              WHERE gs.id = ?`, [serverId]);

        return res.json({
            success: true,
            backups: backups || [],
            abruf: Boolean(maschine && maschine.abruf_port)
        });
    } catch (error) {
        Logger.error('[Gameserver/Backups] Fehler beim Laden der Backup-Liste:', error);
        return res.status(500).json({ success: false, message: 'Serverfehler' });
    }
});

/**
 * GET /guild/:guildId/plugins/gameserver/servers/:serverId/backups/:backupId/download
 *
 * Leitet auf eine unterschriebene, kurzlebige Adresse beim Daemon um.
 *
 * ── Warum eine Umleitung und kein Durchreichen (Baustelle 106) ──────────────
 *
 * Die Sicherungen des Betreibers sind 1,45 GB und 227 MB gross (gemessen).
 * Durch das Dashboard geleitet hiesse: jedes Byte zweimal ueber die Leitung und
 * ein Prozess, der waehrenddessen an einer Datei haengt. Der Browser kann das
 * direkt bei der Maschine holen — er muss nur wissen, wo, und es beweisen
 * koennen.
 *
 * **Die Adresse wird erst hier gebaut, nicht in der Liste.** Sonst stuenden
 * fertige, gueltige Adressen im Quelltext der Seite, auch fuer Sicherungen, die
 * niemand anfasst. So entsteht je Klick genau eine, und sie gilt fuenf Minuten.
 *
 * ⚠ Die Adresse traegt die Unterschrift in der URL. Sie landet damit in der
 * Browser-Geschichte und in Zugriffsprotokollen dazwischen. Deshalb die kurze
 * Frist und die Bindung an GENAU eine Datei.
 */
router.get('/:serverId/backups/:backupId/download',
    requirePermission('GAMESERVER.BACKUPS.DOWNLOAD'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');

    try {
        const { serverId, backupId } = req.params;
        const guildId = res.locals.guildId;

        const [zeile] = await dbService.query(
            `SELECT b.name, b.status,
                    r.host, r.fqdn, r.fqdn_gilt, r.abruf_port, r.api_key
               FROM gameserver_backups b
               JOIN gameservers gs ON gs.id = b.server_id
               JOIN rootserver r  ON r.id = gs.rootserver_id
              WHERE b.id = ? AND b.server_id = ? AND b.guild_id = ?`,
            [backupId, serverId, guildId]);

        if (!zeile) {
            return res.status(404).json({ success: false, message: 'Sicherung nicht gefunden' });
        }
        if (zeile.status !== 'completed') {
            return res.status(409).json({
                success: false,
                message: 'Diese Sicherung ist noch nicht fertig.'
            });
        }
        if (!zeile.abruf_port) {
            // Kein stiller Fehlschlag: Der Betreiber soll den Grund lesen
            // koennen, sonst sucht er ihn beim Browser.
            return res.status(503).json({
                success: false,
                message: 'Die Maschine bietet keinen Abruf an — der Daemon ist zu alt '
                       + 'oder sein Abruf-Zuhoerer läuft nicht.'
            });
        }
        if (!zeile.api_key) {
            return res.status(500).json({
                success: false,
                message: 'Für diese Maschine ist kein Schlüssel hinterlegt.'
            });
        }

        const datei = `${zeile.name}.tar.gz`;
        const bis = Math.floor(Date.now() / 1000) + 300;

        // Dieselbe Rechnung wie im Daemon (internal/sicherungsabruf):
        // HMAC-SHA256 ueber Kennung, Dateiname und Frist, mit Zeilenumbruch
        // dazwischen - sonst waeren ("12","3x") und ("123","x") dasselbe.
        const unterschrift = crypto.createHmac('sha256', zeile.api_key)
            .update(`${serverId}\n${datei}\n${bis}`)
            .digest('hex');

        // Der geprüfte Name, wenn es einen gibt - sonst die IP. Die Regel
        // steht in helpers/Abruf.js, zusammen mit der für freigegebene
        // Spieldateien.
        const wirt = require('../helpers/Abruf').wirt(zeile);

        const adresse = `http://${wirt}:${zeile.abruf_port}/sicherung`
            + `?server=${encodeURIComponent(serverId)}`
            + `&datei=${encodeURIComponent(datei)}`
            + `&bis=${bis}`
            + `&sig=${unterschrift}`;

        Logger.info(`[Gameserver/Backups] Abruf ausgestellt: Sicherung ${backupId} `
            + `(Server ${serverId}) über ${wirt}:${zeile.abruf_port}, gültig 5 Minuten`);

        return res.redirect(adresse);
    } catch (error) {
        Logger.error('[Gameserver/Backups] Abruf konnte nicht ausgestellt werden:', error);
        return res.status(500).json({ success: false, message: 'Serverfehler' });
    }
});

/**
 * POST /guild/:guildId/plugins/gameserver/servers/:serverId/backups
 * Neues Backup erstellen
 */
router.post('/:serverId/backups', requirePermission('GAMESERVER.BACKUPS.CREATE'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');

    try {
        const { serverId } = req.params;
        const guildId = res.locals.guildId;
        const userId = res.locals.user?.id || req.session?.user?.info?.id || 'unknown';
        const note = (req.body.note || '').substring(0, 500);

        // Server validieren
        const [server] = await dbService.query(
            'SELECT id, name, install_path FROM gameservers WHERE id = ? AND guild_id = ?',
            [serverId, guildId]
        );
        if (!server) return res.status(404).json({ success: false, message: 'Server nicht gefunden' });

        // Backup-Namen generieren: server-name_YYYY-MM-DD_HH-MM
        const now = new Date();
        const timestamp = now.toISOString().replace('T', '_').replace(/:/g, '-').slice(0, 16);
        const safeName = server.name.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 40);
        const backupName = `${safeName}_${timestamp}`;

        // Backup-Eintrag in DB erstellen
        const result = await dbService.query(
            `INSERT INTO gameserver_backups (server_id, guild_id, name, status, note, created_by)
             VALUES (?, ?, ?, 'pending', ?, ?)`,
            [serverId, guildId, backupName, note, userId]
        );
        const backupId = result.insertId;

        // Backup über IPM starten (asynchron – Status wird per SSE gemeldet)
        const ipmServer = ServiceManager.get('ipmServer');
        const [rootserver] = await dbService.query(
            'SELECT daemon_id FROM rootserver r JOIN gameservers gs ON gs.rootserver_id = r.id WHERE gs.id = ?',
            [serverId]
        );

        if (rootserver && ipmServer?.isDaemonOnline(rootserver.daemon_id)) {
            // Status auf 'running' setzen
            await dbService.query(
                "UPDATE gameserver_backups SET status = 'running' WHERE id = ?",
                [backupId]
            );

            ipmServer.sendCommand(rootserver.daemon_id, 'gameserver.backup', {
                server_id: String(serverId),
                backup_id: String(backupId),
                backup_name: backupName,
                install_path: server.install_path
            }, 300000)
                .then(async (r) => {
                    const size = r?.size_bytes || 0;
                    await dbService.query(
                        "UPDATE gameserver_backups SET status = 'completed', size_bytes = ?, completed_at = NOW() WHERE id = ?",
                        [size, backupId]
                    );
                    // SSE-Broadcast
                    const sseManager = ServiceManager.get('sseManager');
                    sseManager?.broadcast(guildId, 'gameserver', {
                        action: 'backup_completed', server_id: serverId, backup_id: backupId, backup_name: backupName
                    });
                })
                .catch(async (err) => {
                    await dbService.query(
                        "UPDATE gameserver_backups SET status = 'failed', error_message = ? WHERE id = ?",
                        [err.message || 'Backup fehlgeschlagen', backupId]
                    );
                    Logger.error(`[Gameserver/Backups] Backup ${backupId} fehlgeschlagen:`, err);
                });
        } else {
            // Daemon offline → als fehlgeschlagen markieren
            await dbService.query(
                "UPDATE gameserver_backups SET status = 'failed', error_message = 'Daemon offline' WHERE id = ?",
                [backupId]
            );
            Logger.warn(`[Gameserver/Backups] Daemon offline für Server ${serverId} – Backup ${backupId} fehlgeschlagen`);
        }

        return res.json({ success: true, message: 'Backup gestartet', backup_id: backupId, backup_name: backupName });
    } catch (error) {
        Logger.error('[Gameserver/Backups] Fehler beim Erstellen des Backups:', error);
        return res.status(500).json({ success: false, message: 'Serverfehler beim Erstellen des Backups' });
    }
});

/**
 * DELETE /guild/:guildId/plugins/gameserver/servers/:serverId/backups/:backupId
 * Backup löschen
 */
router.delete('/:serverId/backups/:backupId', requirePermission('GAMESERVER.BACKUPS.DELETE'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');

    try {
        const { serverId, backupId } = req.params;
        const guildId = res.locals.guildId;

        const [backup] = await dbService.query(
            'SELECT id, name FROM gameserver_backups WHERE id = ? AND server_id = ? AND guild_id = ?',
            [backupId, serverId, guildId]
        );
        if (!backup) return res.status(404).json({ success: false, message: 'Backup nicht gefunden' });

        // Erst die Datei, dann die Zeile.
        //
        // Bis zum 2026-08-10 entfernte diese Route **nur** die DB-Zeile: das
        // tar.gz blieb auf dem Zielserver liegen, unsichtbar und für immer.
        // `DeleteBackupArchive` gab es im Daemon, es fehlte die Aktion dorthin.
        // Schlägt das Löschen fehl, bleibt auch die Zeile stehen – sonst
        // entsteht genau die verwaiste Datei wieder, die wir gerade abstellen.
        const ipmServer = ServiceManager.get('ipmServer');
        const [ziel] = await dbService.query(
            `SELECT r.daemon_id FROM gameservers gs
             LEFT JOIN rootserver r ON gs.rootserver_id = r.id
             WHERE gs.id = ?`,
            [serverId]
        );
        const daemonId = ziel?.daemon_id;

        if (!daemonId || !ipmServer?.isDaemonOnline(daemonId)) {
            return res.status(503).json({
                success: false,
                message: 'Der Daemon dieses Servers ist offline – das Backup lässt sich gerade nicht löschen.',
            });
        }

        const antwort = await ipmServer.sendCommand(daemonId, 'gameserver.backup_delete', {
            server_id: String(serverId),
            backup_name: backup.name,
        }, 30000);

        if (!antwort?.success) {
            Logger.warn(`[Gameserver/Backups] Archiv von Backup ${backupId} nicht gelöscht: ${antwort?.error || 'unbekannt'}`);
            return res.status(500).json({
                success: false,
                message: `Das Archiv konnte nicht gelöscht werden: ${antwort?.error || 'Der Daemon meldete keinen Erfolg'}`,
            });
        }

        await dbService.query('DELETE FROM gameserver_backups WHERE id = ?', [backupId]);

        Logger.info(`[Gameserver/Backups] Backup ${backupId} (${backup.name}) samt Archiv gelöscht`);
        return res.json({ success: true, message: 'Backup gelöscht' });
    } catch (error) {
        Logger.error('[Gameserver/Backups] Fehler beim Löschen des Backups:', error);
        return res.status(500).json({ success: false, message: 'Serverfehler' });
    }
});

/**
 * POST /guild/:guildId/plugins/gameserver/servers/:serverId/backups/:backupId/restore
 * Backup wiederherstellen
 */
router.post('/:serverId/backups/:backupId/restore', requirePermission('GAMESERVER.BACKUPS.RESTORE'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');

    try {
        const { serverId, backupId } = req.params;
        const guildId = res.locals.guildId;

        const [backup] = await dbService.query(
            "SELECT id, name FROM gameserver_backups WHERE id = ? AND server_id = ? AND guild_id = ? AND status = 'completed'",
            [backupId, serverId, guildId]
        );
        if (!backup) return res.status(404).json({ success: false, message: 'Backup nicht gefunden oder nicht abgeschlossen' });

        const [server] = await dbService.query(
            'SELECT gs.id, gs.install_path, gs.status, r.daemon_id FROM gameservers gs LEFT JOIN rootserver r ON gs.rootserver_id = r.id WHERE gs.id = ? AND gs.guild_id = ?',
            [serverId, guildId]
        );
        if (!server) return res.status(404).json({ success: false, message: 'Server nicht gefunden' });

        if (server.status === 'online' || server.status === 'starting') {
            return res.status(400).json({ success: false, message: 'Server muss gestoppt sein bevor ein Backup wiederhergestellt werden kann' });
        }

        const ipmServer = ServiceManager.get('ipmServer');
        if (!ipmServer?.isDaemonOnline(server.daemon_id)) {
            return res.status(503).json({ success: false, message: 'Daemon ist offline' });
        }

        await dbService.query(
            "UPDATE gameserver_backups SET status = 'restoring' WHERE id = ?",
            [backupId]
        );

        ipmServer.sendCommand(server.daemon_id, 'gameserver.restore', {
            server_id: String(serverId),
            backup_id: String(backupId),
            backup_name: backup.name,
            install_path: server.install_path
        }, 300000)
            .then(async () => {
                await dbService.query(
                    "UPDATE gameserver_backups SET status = 'completed' WHERE id = ?",
                    [backupId]
                );
                const sseManager = ServiceManager.get('sseManager');
                sseManager?.broadcast(guildId, 'gameserver', {
                    action: 'restore_completed', server_id: serverId, backup_id: backupId
                });
            })
            .catch(async (err) => {
                await dbService.query(
                    "UPDATE gameserver_backups SET status = 'completed' WHERE id = ?",
                    [backupId]
                );
                Logger.error(`[Gameserver/Backups] Restore ${backupId} fehlgeschlagen:`, err);
            });

        return res.json({ success: true, message: 'Wiederherstellung gestartet' });
    } catch (error) {
        Logger.error('[Gameserver/Backups] Fehler beim Restore:', error);
        return res.status(500).json({ success: false, message: 'Serverfehler beim Wiederherstellen' });
    }
});

// ════════════════════════════════════════════════════════════════════════════
// CRONJOB ROUTEN
// ════════════════════════════════════════════════════════════════════════════

/**
 * GET /guild/:guildId/plugins/gameserver/servers/:serverId/cronjobs
 * Cronjob-Liste für einen Server
 */
router.get('/:serverId/cronjobs', requirePermission('GAMESERVER.CRONJOBS.VIEW'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');

    try {
        const { serverId } = req.params;
        const guildId = res.locals.guildId;

        const [server] = await dbService.query(
            'SELECT id, name FROM gameservers WHERE id = ? AND guild_id = ?',
            [serverId, guildId]
        );
        if (!server) return res.status(404).json({ success: false, message: 'Server nicht gefunden' });

        const cronjobs = await dbService.query(
            `SELECT id, name, cron_expr, action, command, run_once, enabled,
                    backup_keep, backup_keep_days,
                    last_run_at, next_run_at, last_status, last_message, created_at
             FROM gameserver_cronjobs
             WHERE server_id = ?
             ORDER BY created_at DESC`,
            [serverId]
        );

        return res.json({ success: true, cronjobs: cronjobs || [] });
    } catch (error) {
        Logger.error('[Gameserver/Cronjobs] Fehler beim Laden:', error);
        return res.status(500).json({ success: false, message: 'Serverfehler' });
    }
});

/**
 * POST /guild/:guildId/plugins/gameserver/servers/:serverId/cronjobs
 * Neuen Cronjob erstellen
 */
router.post('/:serverId/cronjobs', requirePermission('GAMESERVER.CRONJOBS.MANAGE'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');

    try {
        const { serverId } = req.params;
        const guildId = res.locals.guildId;
        const userId = res.locals.user?.id || req.session?.user?.info?.id || 'unknown';

        const [server] = await dbService.query(
            'SELECT id FROM gameservers WHERE id = ? AND guild_id = ?',
            [serverId, guildId]
        );
        if (!server) return res.status(404).json({ success: false, message: 'Server nicht gefunden' });

        const { name, cron_expr, action, command, run_once, backup_keep, backup_keep_days } = req.body;

        // Validierung
        if (!name || !cron_expr || !action) {
            return res.status(400).json({ success: false, message: 'name, cron_expr und action sind Pflichtfelder' });
        }
        const allowedActions = ['start', 'stop', 'restart', 'backup', 'command'];
        if (!allowedActions.includes(action)) {
            return res.status(400).json({ success: false, message: 'Ungültige Aktion' });
        }
        if (action === 'command' && !command?.trim()) {
            return res.status(400).json({ success: false, message: 'command ist Pflichtfeld wenn action=command' });
        }
        // Einfache Cron-Validierung: 5 Felder
        if (cron_expr.trim().split(/\s+/).length !== 5) {
            return res.status(400).json({ success: false, message: 'Ungültige Cron-Expression (5 Felder erwartet, z.B. "0 4 * * *")' });
        }

        // Aufbewahrung gilt nur für Backup-Jobs. Eine Zahl an einem
        // Neustart-Job wäre stillschweigend wirkungslos, deshalb wird sie dort
        // gar nicht erst gespeichert.
        // NULL heisst "erbt die Servereinstellung", 0 heisst "ausdruecklich
        // unbegrenzt". Ein `|| 0` an dieser Stelle machte aus jedem geerbten
        // Wert ein "unbegrenzt", und niemand raeumte mehr auf.
        const grenze = (wert) => {
            if (wert === undefined || wert === null || wert === '') return null;
            const n = Number.parseInt(wert, 10);
            if (!Number.isFinite(n) || n < 0) return 0;
            return Math.min(n, 65535);
        };
        const keep     = action === 'backup' ? grenze(backup_keep) : null;
        const keepDays = action === 'backup' ? grenze(backup_keep_days) : null;

        const result = await dbService.query(
            `INSERT INTO gameserver_cronjobs (server_id, guild_id, name, cron_expr, action, command,
                                              backup_keep, backup_keep_days, run_once, enabled, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
            [serverId, guildId, name.substring(0, 128), cron_expr.trim(), action,
             action === 'command' ? command.trim() : null,
             keep, keepDays, run_once ? 1 : 0, userId]
        );

        Logger.info(`[Gameserver/Cronjobs] Cronjob ${result.insertId} erstellt für Server ${serverId}`);

        // CronWorker benachrichtigen
        const cronWorker = ServiceManager.get('gameserverCronWorker');
        if (cronWorker) {
            const [newJob] = await dbService.query(
                `SELECT cj.*, gs.name AS server_name, gs.install_path, r.daemon_id AS rootserver_daemon_id
                 FROM gameserver_cronjobs cj
                 JOIN gameservers gs ON gs.id = cj.server_id
                 LEFT JOIN rootserver r ON gs.rootserver_id = r.id
                 WHERE cj.id = ?`,
                [result.insertId]
            );
            if (newJob) cronWorker.add(newJob);
        }

        return res.json({ success: true, message: 'Cronjob erstellt', cronjob_id: result.insertId });
    } catch (error) {
        Logger.error('[Gameserver/Cronjobs] Fehler beim Erstellen:', error);
        return res.status(500).json({ success: false, message: 'Serverfehler' });
    }
});

/**
 * PUT /guild/:guildId/plugins/gameserver/servers/:serverId/cronjobs/:cronjobId
 * Cronjob aktualisieren (Name, Cron-Expr, Enabled-State)
 */
router.put('/:serverId/cronjobs/:cronjobId', requirePermission('GAMESERVER.CRONJOBS.MANAGE'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');

    try {
        const { serverId, cronjobId } = req.params;
        const guildId = res.locals.guildId;

        const [job] = await dbService.query(
            'SELECT id FROM gameserver_cronjobs WHERE id = ? AND server_id = ? AND guild_id = ?',
            [cronjobId, serverId, guildId]
        );
        if (!job) return res.status(404).json({ success: false, message: 'Cronjob nicht gefunden' });

        const { name, cron_expr, action, command, enabled, run_once, backup_keep, backup_keep_days } = req.body;

        if (cron_expr && cron_expr.trim().split(/\s+/).length !== 5) {
            return res.status(400).json({ success: false, message: 'Ungültige Cron-Expression' });
        }
        if (action) {
            const allowedActions = ['start', 'stop', 'restart', 'backup', 'command'];
            if (!allowedActions.includes(action)) {
                return res.status(400).json({ success: false, message: 'Ungültige Aktion' });
            }
        }

        // `null` heisst hier "unverändert" (COALESCE). Eine 0 ist dagegen ein
        // gültiger Wert – "unbegrenzt" –, deshalb wird sie ausdrücklich
        // durchgereicht und nicht mit `|| null` verschluckt.
        const grenze = (wert) => {
            if (wert === undefined || wert === null || wert === '') return null;
            const n = Number.parseInt(wert, 10);
            if (!Number.isFinite(n) || n < 0) return 0;
            return Math.min(n, 65535);
        };

        await dbService.query(
            `UPDATE gameserver_cronjobs
             SET name = COALESCE(?, name),
                 cron_expr = COALESCE(?, cron_expr),
                 action = COALESCE(?, action),
                 command = COALESCE(?, command),
                 backup_keep = COALESCE(?, backup_keep),
                 backup_keep_days = COALESCE(?, backup_keep_days),
                 run_once = COALESCE(?, run_once),
                 enabled = COALESCE(?, enabled)
             WHERE id = ?`,
            [name?.substring(0, 128) || null, cron_expr?.trim() || null, action || null, command?.trim() || null,
             grenze(backup_keep), grenze(backup_keep_days),
             run_once !== undefined ? (run_once ? 1 : 0) : null, enabled !== undefined ? (enabled ? 1 : 0) : null, cronjobId]
        );

        // CronWorker benachrichtigen
        const cronWorker = ServiceManager.get('gameserverCronWorker');
        if (cronWorker) {
            const [updatedJob] = await dbService.query(
                `SELECT cj.*, gs.name AS server_name, gs.install_path, r.daemon_id AS rootserver_daemon_id
                 FROM gameserver_cronjobs cj
                 JOIN gameservers gs ON gs.id = cj.server_id
                 LEFT JOIN rootserver r ON gs.rootserver_id = r.id
                 WHERE cj.id = ?`,
                [cronjobId]
            );
            if (updatedJob) cronWorker.update(updatedJob);
        }

        return res.json({ success: true, message: 'Cronjob aktualisiert' });
    } catch (error) {
        Logger.error('[Gameserver/Cronjobs] Fehler beim Aktualisieren:', error);
        return res.status(500).json({ success: false, message: 'Serverfehler' });
    }
});

/**
 * DELETE /guild/:guildId/plugins/gameserver/servers/:serverId/cronjobs/:cronjobId
 * Cronjob löschen
 */
router.delete('/:serverId/cronjobs/:cronjobId', requirePermission('GAMESERVER.CRONJOBS.MANAGE'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');

    try {
        const { serverId, cronjobId } = req.params;
        const guildId = res.locals.guildId;

        const [job] = await dbService.query(
            'SELECT id, name FROM gameserver_cronjobs WHERE id = ? AND server_id = ? AND guild_id = ?',
            [cronjobId, serverId, guildId]
        );
        if (!job) return res.status(404).json({ success: false, message: 'Cronjob nicht gefunden' });

        await dbService.query('DELETE FROM gameserver_cronjobs WHERE id = ?', [cronjobId]);

        // CronWorker benachrichtigen
        const cronWorker = ServiceManager.get('gameserverCronWorker');
        if (cronWorker) cronWorker.remove(Number(cronjobId));

        Logger.info(`[Gameserver/Cronjobs] Cronjob ${cronjobId} (${job.name}) gelöscht`);
        return res.json({ success: true, message: 'Cronjob gelöscht' });
    } catch (error) {
        Logger.error('[Gameserver/Cronjobs] Fehler beim Löschen:', error);
        return res.status(500).json({ success: false, message: 'Serverfehler' });
    }
});

module.exports = router;
