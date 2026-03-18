-- =====================================================
-- Migration: Add Metadata Fields to RootServer
-- @version 1.1.1
-- @description Hostname, Datacenter, Country-Code und Port-Range für Rootserver
-- =====================================================

ALTER TABLE rootserver
    ADD COLUMN IF NOT EXISTS hostname VARCHAR(255) DEFAULT NULL COMMENT 'FQDN for SFTP/SSH access (e.g. server01.example.com)' AFTER host,
    ADD COLUMN IF NOT EXISTS port_range_start INT DEFAULT NULL COMMENT 'Start of port range for gameservers (e.g. 25565)',
    ADD COLUMN IF NOT EXISTS port_range_end INT DEFAULT NULL COMMENT 'End of port range for gameservers (e.g. 25665)',
    ADD COLUMN IF NOT EXISTS datacenter VARCHAR(100) DEFAULT NULL COMMENT 'Datacenter location (e.g. Hetzner Falkenstein)',
    ADD COLUMN IF NOT EXISTS country_code CHAR(2) DEFAULT NULL COMMENT 'ISO country code (e.g. DE, US, FR)',
    ADD COLUMN IF NOT EXISTS description TEXT DEFAULT NULL COMMENT 'Optional user description';

-- Indexes für Filterung/Sortierung
CREATE INDEX IF NOT EXISTS idx_country ON rootserver(country_code);
CREATE INDEX IF NOT EXISTS idx_datacenter ON rootserver(datacenter);
