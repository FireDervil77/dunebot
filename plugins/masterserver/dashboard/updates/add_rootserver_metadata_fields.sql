-- =====================================================
-- Migration: Add Metadata Fields to RootServer
-- =====================================================
-- Fügt Hostname, Datacenter, Country-Code und Port-Range hinzu
-- Datum: 2025-10-27
-- =====================================================

ALTER TABLE rootserver
    -- Connection Info
    ADD COLUMN hostname VARCHAR(255) DEFAULT NULL COMMENT 'FQDN for SFTP/SSH access (e.g. server01.example.com)' AFTER host,
    
    -- Port Management
    ADD COLUMN port_range_start INT DEFAULT NULL COMMENT 'Start of port range for gameservers (e.g. 25565)',
    ADD COLUMN port_range_end INT DEFAULT NULL COMMENT 'End of port range for gameservers (e.g. 25665)',
    
    -- Location Info
    ADD COLUMN datacenter VARCHAR(100) DEFAULT NULL COMMENT 'Datacenter location (e.g. Hetzner Falkenstein)',
    ADD COLUMN country_code CHAR(2) DEFAULT NULL COMMENT 'ISO country code (e.g. DE, US, FR)',
    
    -- Optional: Description
    ADD COLUMN description TEXT DEFAULT NULL COMMENT 'Optional user description';

-- Indexes für Filterung/Sortierung
CREATE INDEX idx_country ON rootserver(country_code);
CREATE INDEX idx_datacenter ON rootserver(datacenter);
