'use strict';
/**
 * Die Serverliste einer Guild — Abfrage und Aufbereitung an EINER Stelle.
 *
 * Gebraucht von der Übersicht (`routes/servers.js`, dort mit Filtern) und vom
 * Widget auf dem Hauptdashboard (2026-10-25). Zwei Abfragen für dieselbe Liste
 * hießen früher oder später: Das Widget sagt „läuft", die Übersicht „aus" —
 * genau das, was Baustelle 140 bei den Kacheln abgeschafft hat.
 *
 * @module helpers/Serverliste
 */

const { ladePaketeZuServern } = require('./Paketfassung');
const { baueServerListe } = require('./Serverseite');

/** Die Grundabfrage — endet mit `WHERE gs.guild_id = ?`, Filter hängt der Aufrufer an. */
const SERVER_LISTE_SQL = `
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
                gs.bereitschaft_bereit, gs.bereitschaft_plan,
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
                -- Die Buchung, gegen die der CPU-Streifen rechnet (B211).
                gs.allocated_cpu_percent,
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
                r.daemon_id,
                -- Ob ein Umzug läuft, sagt seine Zeile, nicht gs.status (Umzugsstand). Kein Fragezeichen in diesem Kommentar: mysql2 hielte es für einen Platzhalter.
                ${require('./Umzugsstand').SPALTE}
            FROM gameservers gs
            LEFT JOIN addon_marketplace am ON gs.addon_marketplace_id = am.id
            LEFT JOIN rootserver r ON gs.rootserver_id = r.id
            WHERE gs.guild_id = ?
        `;

/**
 * Alle Server einer Guild, aufbereitet wie in der Übersicht — samt Zeilen
 * (für Felder, die die Aufbereitung nicht weiterreicht, etwa das Spielsymbol).
 */
async function ladeServerListe(dbService, guildId) {
    const zeilen = await dbService.query(SERVER_LISTE_SQL + ' ORDER BY gs.created_at DESC', [guildId]);
    const paketNachServer = await ladePaketeZuServern(dbService, zeilen);
    return { zeilen, ...baueServerListe(zeilen, paketNachServer) };
}

module.exports = { SERVER_LISTE_SQL, ladeServerListe };
