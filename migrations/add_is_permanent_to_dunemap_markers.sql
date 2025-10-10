-- Migration: Add is_permanent column to dunemap_markers table
-- Allows marking permanent markers (A1-A9) that cannot be deleted by users
-- Date: 2025-10-09

ALTER TABLE dunemap_markers 
ADD COLUMN is_permanent TINYINT(1) NOT NULL DEFAULT 0 AFTER updated_at,
ADD INDEX idx_permanent (guild_id, is_permanent);

-- Update description
ALTER TABLE dunemap_markers 
COMMENT = 'DuneMap markers with permanent marker support for A1-A9 sectors';
