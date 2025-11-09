-- Migration: Add runtime_type to addon_marketplace
-- Date: 2025-11-08
-- Purpose: Store runtime type (native_steamcmd, proton, wine, java, custom) for addons

ALTER TABLE `addon_marketplace` 
ADD COLUMN `runtime_type` ENUM(
    'native_steamcmd',
    'proton', 
    'wine',
    'java',
    'nodejs',
    'python',
    'custom'
) DEFAULT NULL AFTER `category`,
ADD COLUMN `source_type` ENUM(
    'native',
    'pterodactyl',
    'custom'
) DEFAULT 'native' AFTER `runtime_type`,
ADD COLUMN `verified_by` VARCHAR(20) DEFAULT NULL AFTER `trust_level`,
ADD COLUMN `verified_at` TIMESTAMP NULL DEFAULT NULL AFTER `verified_by`,
ADD COLUMN `last_tested_at` TIMESTAMP NULL DEFAULT NULL AFTER `verified_at`,
ADD COLUMN `test_notes` TEXT DEFAULT NULL AFTER `last_tested_at`;

-- Indexes für Performance
ALTER TABLE `addon_marketplace` 
ADD INDEX `idx_runtime_type` (`runtime_type`),
ADD INDEX `idx_source_type` (`source_type`),
ADD INDEX `idx_verified_by` (`verified_by`);

-- Existing addons auf native_steamcmd setzen (Default)
UPDATE `addon_marketplace` 
SET `runtime_type` = 'native_steamcmd' 
WHERE `runtime_type` IS NULL;
