-- Migration: Füge current_players Spalte zu server_registry hinzu
-- Für Heartbeat-Updates vom Daemon

ALTER TABLE server_registry 
ADD COLUMN current_players INT DEFAULT 0 AFTER status,
ADD COLUMN last_heartbeat TIMESTAMP NULL DEFAULT NULL AFTER current_players;

-- Index für schnelle Heartbeat-Queries
CREATE INDEX idx_last_heartbeat ON server_registry(last_heartbeat);
CREATE INDEX idx_daemon_heartbeat ON server_registry(daemon_id, last_heartbeat);
