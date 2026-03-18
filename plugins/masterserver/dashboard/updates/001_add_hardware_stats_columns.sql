-- =====================================================
-- Migration: Hardware Stats Spalten zu rootserver Tabelle
-- Datum: 2025-10-26
-- @version 1.1.0
-- @description Hardware-Stats Spalten für Daemon-Monitoring
-- =====================================================

-- Hardware-Informationen (vom Daemon erfasst)
ALTER TABLE rootserver 
ADD COLUMN IF NOT EXISTS cpu_cores INT DEFAULT NULL COMMENT 'Total CPU cores available';

ALTER TABLE rootserver
ADD COLUMN IF NOT EXISTS cpu_threads INT DEFAULT NULL COMMENT 'Total CPU threads available';

ALTER TABLE rootserver
ADD COLUMN IF NOT EXISTS cpu_model VARCHAR(255) DEFAULT NULL COMMENT 'CPU model name';

ALTER TABLE rootserver
ADD COLUMN IF NOT EXISTS ram_total_gb DECIMAL(10,2) DEFAULT NULL COMMENT 'Total RAM in GB';

ALTER TABLE rootserver
ADD COLUMN IF NOT EXISTS disk_total_gb DECIMAL(10,2) DEFAULT NULL COMMENT 'Total disk space in GB';

-- Current Usage (vom Daemon aktualisiert)
ALTER TABLE rootserver
ADD COLUMN IF NOT EXISTS cpu_usage_percent DECIMAL(5,2) DEFAULT 0.00 COMMENT 'Current CPU usage percentage';

ALTER TABLE rootserver
ADD COLUMN IF NOT EXISTS ram_usage_gb DECIMAL(10,2) DEFAULT 0.00 COMMENT 'Current RAM usage in GB';

ALTER TABLE rootserver
ADD COLUMN IF NOT EXISTS disk_usage_gb DECIMAL(10,2) DEFAULT 0.00 COMMENT 'Current disk usage in GB';

ALTER TABLE rootserver
ADD COLUMN IF NOT EXISTS last_stats_update TIMESTAMP NULL DEFAULT NULL COMMENT 'Last hardware stats update';

-- Index für Performance
CREATE INDEX IF NOT EXISTS idx_last_stats_update ON rootserver(last_stats_update);
