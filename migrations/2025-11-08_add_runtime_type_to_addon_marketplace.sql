-- Migration: Add runtime_type, source_type und Verifikations-Spalten zu addon_marketplace
-- Date: 2025-11-08  (überarbeitet 2026-03-11: ENUM-Werte korrigiert, lgsm hinzugefügt)
-- Purpose: Laufzeit-Typ, Import-Quelle und Verifikationsfelder für Addons

ALTER TABLE `addon_marketplace`

    -- Laufzeit-Typ: 'native' = SteamCMD/native binary, 'proton'/'wine' = Windows-Game
    ADD COLUMN `runtime_type` ENUM(
        'native',
        'proton',
        'wine',
        'java',
        'other'
    ) DEFAULT 'native' COMMENT 'Laufzeit-Typ des Gameservers' AFTER `category`,

    -- Import-Quelle des Addons
    ADD COLUMN `source_type` ENUM(
        'native',
        'pterodactyl',
        'lgsm',
        'custom'
    ) DEFAULT 'native' COMMENT 'Import-Quelle des Addons' AFTER `runtime_type`,

    -- Wer hat das Addon verifiziert + wann?
    ADD COLUMN `verified_by`      VARCHAR(20)    DEFAULT NULL              COMMENT 'Discord User-ID des verifizierenden SuperAdmins' AFTER `trust_level`,
    ADD COLUMN `verified_at`      TIMESTAMP NULL DEFAULT NULL              COMMENT 'Zeitstempel der Verifikation' AFTER `verified_by`,
    ADD COLUMN `last_tested_at`   TIMESTAMP NULL DEFAULT NULL              COMMENT 'Zeitstempel des letzten Test-Installs' AFTER `verified_at`,
    ADD COLUMN `test_notes`       TEXT           DEFAULT NULL              COMMENT 'Notizen zum letzten Test' AFTER `last_tested_at`;

-- Performance-Indizes
ALTER TABLE `addon_marketplace`
    ADD INDEX `idx_runtime_type` (`runtime_type`),
    ADD INDEX `idx_source_type`  (`source_type`),
    ADD INDEX `idx_verified_by`  (`verified_by`);

-- Bestehende Datensätze auf 'native' setzen
UPDATE `addon_marketplace`
SET `runtime_type` = 'native'
WHERE `runtime_type` IS NULL;

