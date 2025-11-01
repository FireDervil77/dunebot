-- Migration: Add status, slug, and author columns to changelogs table
-- Date: 2025-10-31
-- Author: FireDervil

ALTER TABLE changelogs 
ADD COLUMN status ENUM('draft', 'published') DEFAULT 'published' AFTER author_id,
ADD COLUMN slug VARCHAR(255) NULL AFTER status,
ADD COLUMN author VARCHAR(255) NULL AFTER slug;

-- Erstelle Index für slug (für schnelle URL-Lookups)
ALTER TABLE changelogs ADD UNIQUE INDEX idx_slug (slug);

-- Migriere bestehende Daten: Generiere Slugs aus Versionen
UPDATE changelogs 
SET slug = CONCAT('v', REPLACE(version, '.', '-'))
WHERE slug IS NULL;

-- Migriere bestehende Daten: Setze author auf author_id falls leer
UPDATE changelogs 
SET author = 'FireBot Team'
WHERE author IS NULL;

-- Setze alle bestehenden Changelogs auf 'published'
UPDATE changelogs 
SET status = 'published'
WHERE status IS NULL;
