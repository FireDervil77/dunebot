-- =============================================================
-- Migration: Ticket Claiming, Reopening & Forms
-- Date: 2026-03-16
-- =============================================================

-- 1. Claiming: claimed_at Timestamp
ALTER TABLE tickets ADD COLUMN claimed_at TIMESTAMP NULL DEFAULT NULL AFTER claimed_by;

-- 2. Reopening: Tracking-Spalten
ALTER TABLE tickets ADD COLUMN reopened_by VARCHAR(20) DEFAULT NULL AFTER closed_at;
ALTER TABLE tickets ADD COLUMN reopened_at TIMESTAMP NULL DEFAULT NULL AFTER reopened_by;
ALTER TABLE tickets ADD COLUMN reopen_count INT UNSIGNED DEFAULT 0 AFTER reopened_at;

-- 3. Forms: form_fields pro Kategorie, form_responses pro Ticket
ALTER TABLE ticket_categories ADD COLUMN form_fields JSON DEFAULT NULL COMMENT '[{"label":"Betreff","placeholder":"...","style":"SHORT","required":true}]' AFTER max_open_per_user;
ALTER TABLE tickets ADD COLUMN form_responses JSON DEFAULT NULL COMMENT '[{"label":"Betreff","value":"answer"}]' AFTER category_name;
