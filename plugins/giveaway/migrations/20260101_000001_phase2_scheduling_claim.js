'use strict';

/**
 * Giveaway Plugin: Phase 2 — Scheduling & Claim Erweiterungen
 * Migriert von: plugins/giveaway/dashboard/updates/001_phase2_scheduling_claim.js
 */
module.exports = {
    description: 'Scheduling & Claim Spalten + Index für Giveaways',

    async up(db) {
        async function columnExists(table, column) {
            const rows = await db.query(
                `SELECT COUNT(*) as cnt FROM information_schema.columns 
                 WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
                [table, column]
            );
            return (rows[0]?.cnt || rows?.cnt) > 0;
        }

        async function indexExists(table, indexName) {
            const rows = await db.query(
                `SELECT COUNT(*) as cnt FROM information_schema.statistics 
                 WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?`,
                [table, indexName]
            );
            return (rows[0]?.cnt || rows?.cnt) > 0;
        }

        if (!await columnExists('giveaways', 'scheduled_start')) {
            await db.query(`ALTER TABLE giveaways ADD COLUMN scheduled_start TIMESTAMP NULL DEFAULT NULL COMMENT 'Geplanter Startzeitpunkt' AFTER ends_at`);
        }

        if (!await columnExists('giveaways', 'claim_duration_ms')) {
            await db.query(`ALTER TABLE giveaways ADD COLUMN claim_duration_ms INT NULL DEFAULT NULL COMMENT 'Claim-Zeitlimit in ms' AFTER button_emoji`);
        }

        if (!await columnExists('giveaways', 'claim_ends_at')) {
            await db.query(`ALTER TABLE giveaways ADD COLUMN claim_ends_at TIMESTAMP NULL DEFAULT NULL COMMENT 'Wann das Claim-Zeitlimit abläuft' AFTER claim_duration_ms`);
        }

        if (!await columnExists('giveaway_winners', 'claim_status')) {
            await db.query(`ALTER TABLE giveaway_winners ADD COLUMN claim_status ENUM('pending','claimed','expired') NOT NULL DEFAULT 'pending' AFTER won_at`);
        }

        if (!await indexExists('giveaways', 'idx_scheduled')) {
            await db.query(`CREATE INDEX idx_scheduled ON giveaways (scheduled_start, status)`);
        }
    },

    async down(db) {
        await db.query('ALTER TABLE giveaway_winners DROP COLUMN IF EXISTS claim_status');
        await db.query('ALTER TABLE giveaways DROP COLUMN IF EXISTS claim_ends_at');
        await db.query('ALTER TABLE giveaways DROP COLUMN IF EXISTS claim_duration_ms');
        await db.query('ALTER TABLE giveaways DROP COLUMN IF EXISTS scheduled_start');
        await db.query('DROP INDEX IF EXISTS idx_scheduled ON giveaways');
    }
};
