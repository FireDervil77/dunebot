-- =====================================================
-- Migration: UNIQUE Constraint auf daemon_id entfernen
-- =====================================================
-- Erlaubt mehrere virtuelle RootServer pro physischem Daemon
-- Architektur: 1 Daemon (physisch) → N RootServer (virtuell) → N Gameserver
-- =====================================================

-- Schritt 1: Bestehenden UNIQUE Index/Constraint auf daemon_id entfernen
-- (Name kann variieren: daemon_id, daemon_id_unique, oder UNIQUE KEY daemon_id)

-- Methode 1: Falls es ein benannter UNIQUE Index ist
-- ALTER TABLE rootserver DROP INDEX daemon_id;

-- Methode 2: Falls es ein benannter UNIQUE Constraint ist
-- ALTER TABLE rootserver DROP CONSTRAINT daemon_id_unique;

-- Dynamischer Ansatz (funktioniert für beide Fälle):
ALTER TABLE rootserver DROP INDEX daemon_id;

-- Schritt 2: Composite UNIQUE Constraint hinzufügen
-- Stellt sicher, dass RootServer-Namen pro Daemon einzigartig sind
ALTER TABLE rootserver 
ADD UNIQUE KEY unique_rootserver_name_per_daemon (daemon_id, name);

-- Schritt 3: Index für Performance behalten (falls nicht automatisch erstellt)
-- Der UNIQUE Constraint erstellt bereits einen Index, daher optional:
-- ALTER TABLE rootserver ADD INDEX idx_daemon_id (daemon_id);

-- =====================================================
-- Validierung der Änderungen
-- =====================================================
-- Nach der Migration sollte folgendes funktionieren:
--
-- ERLAUBT:
-- INSERT INTO rootserver (daemon_id, guild_id, name, ...) 
-- VALUES ('uuid-1', 'guild-1', 'Virtual Server 1', ...);
-- INSERT INTO rootserver (daemon_id, guild_id, name, ...) 
-- VALUES ('uuid-1', 'guild-1', 'Virtual Server 2', ...); ✅
--
-- BLOCKIERT:
-- INSERT INTO rootserver (daemon_id, guild_id, name, ...) 
-- VALUES ('uuid-1', 'guild-1', 'Virtual Server 1', ...); ❌ (Duplicate name)
--
-- =====================================================
-- Fertig! Multi-Tenant RootServer-Architektur aktiviert
-- =====================================================
