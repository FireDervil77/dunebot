-- Migration: DuneMap v3 – Leaflet Map Support
-- Datum: 17.03.2026
-- Feinere Koordinaten für Marker (x/y innerhalb des Sektors)
-- + Neues Feld für Notizen/Labels

ALTER TABLE dunemap_markers
  ADD COLUMN pos_x FLOAT DEFAULT NULL COMMENT 'X-Position auf Leaflet-Karte (0-900)' AFTER sector_y,
  ADD COLUMN pos_y FLOAT DEFAULT NULL COMMENT 'Y-Position auf Leaflet-Karte (0-900)' AFTER pos_x,
  ADD COLUMN label VARCHAR(100) DEFAULT NULL COMMENT 'Optionaler Marker-Name/Label' AFTER pos_y,
  ADD COLUMN notes TEXT DEFAULT NULL COMMENT 'Optionale Notizen zum Marker' AFTER label;

-- Index für Koordinaten-basierte Suche
ALTER TABLE dunemap_markers ADD INDEX idx_position (guild_id, pos_x, pos_y);
