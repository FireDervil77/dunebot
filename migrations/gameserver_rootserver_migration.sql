-- =====================================================
-- Migration: Gameserver zu Rootserver-System
-- =====================================================
-- Ändert gameservers.daemon_server_id zu rootserver_id
-- und passt Foreign Keys an
-- =====================================================

-- Schritt 1: Alte Spalte auf NULL setzen (falls vorhanden)
ALTER TABLE gameservers 
MODIFY COLUMN daemon_server_id VARCHAR(36) DEFAULT NULL COMMENT 'Deprecated - use rootserver_id instead';

-- Schritt 2: Neue Spalte hinzufügen
ALTER TABLE gameservers 
ADD COLUMN rootserver_id INT DEFAULT NULL COMMENT 'FK to rootserver.id' 
AFTER guild_id;

-- Schritt 3: Daten migrieren (falls daemon_server_id vorhanden)
-- HINWEIS: Diese Query funktioniert nur, wenn daemon_server_id existiert
-- Falls nicht, einfach überspringen

-- UPDATE gameservers gs
-- SET rootserver_id = (
--     SELECT r.id 
--     FROM rootserver r 
--     WHERE r.daemon_id = gs.daemon_server_id 
--     LIMIT 1
-- )
-- WHERE gs.daemon_server_id IS NOT NULL;

-- Schritt 4: Alte Spalte löschen (nach erfolgreicher Migration)
ALTER TABLE gameservers DROP COLUMN daemon_server_id;

-- Schritt 5: Index hinzufügen
ALTER TABLE gameservers 
ADD INDEX idx_rootserver (rootserver_id);

-- Schritt 6: Foreign Key hinzufügen
-- HINWEIS: Nur ausführen, wenn rootserver-Tabelle existiert
ALTER TABLE gameservers 
ADD CONSTRAINT fk_gameservers_rootserver 
FOREIGN KEY (rootserver_id) REFERENCES rootserver(id) 
ON DELETE SET NULL 
ON UPDATE CASCADE;

-- =====================================================
-- Fertig!
-- =====================================================
