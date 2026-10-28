'use strict';

/**
 * Läuft für einen Server gerade ein Umzug auf einen anderen Rootserver?
 * (2026-10-28)
 *
 * ── Warum nicht `gameservers.status` ────────────────────────────────────────
 *
 * Der Umzug setzt den Server zu Beginn auf `updating` — die Seite zeigte
 * damit „Wird aktualisiert", also etwas Falsches. Und sobald der Daemon das
 * Stoppen meldet, steht dort `offline`: Server 217 stand mitten im Umzug in
 * der Übersicht auf „Aus" (Betreiber: „weder in der Übersicht noch auf der
 * Seite kann man sehen, dass der Server migriert wird"). Die Prüfung vor dem
 * Umzug fragte nach `migrating` — einem Status, den es in der Tabelle gar
 * nicht gibt; ein zweiter Umzug ließ sich starten, während einer lief.
 *
 * Die Wahrheit steht in `gameserver_migrations`: die jüngste Zeile des
 * Servers und ihr Status. Liste, Serverseite, Live-Anzeige und die Sperre
 * lesen sie von hier — eine Liste der laufenden Zustände, ein Ausschnitt SQL.
 */

/** Die Zustände eines Umzugs, solange er läuft (MigrationManager schreibt sie). */
const LAEUFT = ['pending', 'stopping_server', 'backing_up', 'transferring', 'restoring', 'updating_db'];

/** Für ein SELECT auf `gameservers gs`: der Status des jüngsten Umzugs. */
const SPALTE = `(SELECT m.status FROM gameserver_migrations m
                  WHERE m.server_id = gs.id ORDER BY m.id DESC LIMIT 1) AS umzug_status`;

/** Läuft ein Umzug, nach dem Status seiner jüngsten Zeile? */
function laeuft(status) {
    return LAEUFT.includes(String(status || ''));
}

/** Der jüngste Umzug eines Servers — oder null. */
async function letzter(dbService, serverId) {
    const [z] = await dbService.query(
        `SELECT id, status, progress_percent, current_step, error_message, started_at, completed_at,
                source_rootserver_id, target_rootserver_id
           FROM gameserver_migrations WHERE server_id = ? ORDER BY id DESC LIMIT 1`, [serverId]);
    return z || null;
}

module.exports = { LAEUFT, SPALTE, laeuft, letzter };
