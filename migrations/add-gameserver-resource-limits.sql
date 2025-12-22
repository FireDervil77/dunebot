-- Migration: Resource Limits für Gameserver
-- Datum: 2025-11-14
-- Beschreibung: Fügt Spalten für RAM, CPU und Disk Limits hinzu

-- Prüfen ob Spalten bereits existieren (MySQL 8.0+)
SET @dbname = DATABASE();
SET @tablename = 'gameservers';

-- allocated_ram_mb hinzufügen
SET @col_exists = (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @dbname
    AND TABLE_NAME = @tablename
    AND COLUMN_NAME = 'allocated_ram_mb'
);

SET @sql = IF(@col_exists = 0,
    'ALTER TABLE gameservers ADD COLUMN allocated_ram_mb INT NULL DEFAULT NULL COMMENT "Allocated RAM in MiB (NULL = unlimited)" AFTER auto_update',
    'SELECT "Column allocated_ram_mb already exists" AS info'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- allocated_cpu_percent hinzufügen
SET @col_exists = (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @dbname
    AND TABLE_NAME = @tablename
    AND COLUMN_NAME = 'allocated_cpu_percent'
);

SET @sql = IF(@col_exists = 0,
    'ALTER TABLE gameservers ADD COLUMN allocated_cpu_percent INT NULL DEFAULT NULL COMMENT "Allocated CPU in % (NULL = unlimited, 100 = 1 core)" AFTER allocated_ram_mb',
    'SELECT "Column allocated_cpu_percent already exists" AS info'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- allocated_disk_gb hinzufügen
SET @col_exists = (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @dbname
    AND TABLE_NAME = @tablename
    AND COLUMN_NAME = 'allocated_disk_gb'
);

SET @sql = IF(@col_exists = 0,
    'ALTER TABLE gameservers ADD COLUMN allocated_disk_gb INT NULL DEFAULT NULL COMMENT "Allocated Disk Space in GiB (NULL = unlimited)" AFTER allocated_cpu_percent',
    'SELECT "Column allocated_disk_gb already exists" AS info'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Erfolgsmeldung
SELECT 'Resource Limits Spalten erfolgreich hinzugefügt/überprüft' AS status;
