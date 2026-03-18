-- Migration: user_feedback - Admin-Felder + ENUM-Erweiterung
-- Datum: 2026-03-18
-- Zweck: Fehlende Admin-Spalten + Status-Enum für vollständigen Feedback-Workflow

ALTER TABLE `user_feedback`

    -- Status-ENUM um alle im Admin genutzten Werte erweitern
    MODIFY COLUMN `status`
        ENUM('open', 'in_progress', 'planned', 'resolved', 'implemented', 'rejected', 'closed', 'wontfix')
        NOT NULL DEFAULT 'open'
        COMMENT 'Aktueller Bearbeitungsstatus',

    -- Admin-interne Notizen (nicht für User sichtbar)
    ADD COLUMN IF NOT EXISTS `admin_notes`
        TEXT DEFAULT NULL
        COMMENT 'Interne Admin-Notizen (nicht öffentlich)' AFTER `upvotes`,

    -- Antwort des Admins (für User sichtbar)
    ADD COLUMN IF NOT EXISTS `admin_response`
        TEXT DEFAULT NULL
        COMMENT 'Öffentliche Admin-Antwort für den Ersteller' AFTER `admin_notes`,

    -- Wer hat das Feedback resolved/implemented
    ADD COLUMN IF NOT EXISTS `resolved_by`
        VARCHAR(100) DEFAULT NULL
        COMMENT 'Username des Admin der resolved/implemented gesetzt hat' AFTER `admin_response`,

    -- Wann wurde resolved/implemented gesetzt
    ADD COLUMN IF NOT EXISTS `resolved_at`
        TIMESTAMP NULL DEFAULT NULL
        COMMENT 'Zeitstempel der Auflösung' AFTER `resolved_by`;

-- user_tag Spalte hinzufügen falls noch nicht vorhanden (wird von der Route genutzt)
ALTER TABLE `user_feedback`
    ADD COLUMN IF NOT EXISTS `user_tag`
        VARCHAR(100) DEFAULT NULL
        COMMENT 'Discord-Tag des Users zum Zeitpunkt der Einreichung' AFTER `user_id`;
