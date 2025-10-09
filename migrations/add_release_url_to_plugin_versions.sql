-- Migration: Release URL zu plugin_versions Tabelle hinzufügen
-- Speichert den Link zum GitHub Release für jeden verfügbaren Update
--
-- @author FireDervil
-- @date 2025-10-09

ALTER TABLE plugin_versions
ADD COLUMN release_url VARCHAR(500) DEFAULT NULL COMMENT 'GitHub Release URL' AFTER changelog;

-- Index für schnellere Abfragen
CREATE INDEX idx_release_url ON plugin_versions(release_url);

SELECT 'Migration erfolgreich: release_url Spalte hinzugefügt' AS Status;
