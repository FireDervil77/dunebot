/**
 * Giveaway Plugin – Phase 2: Scheduling & Claim Erweiterungen
 * @version 2.1.0
 * @description ALTER TABLE für Scheduling + Claim-System (JS-Migration für Robustheit)
 */
module.exports = {
    version: '2.1.0',
    description: 'Scheduling & Claim Spalten + Index für Giveaways',

    async run(dbService, { Logger }) {
        // Helper: Prüfe ob Spalte existiert
        async function columnExists(table, column) {
            const rows = await dbService.query(
                `SELECT COUNT(*) as cnt FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
                [table, column]
            );
            return rows[0]?.cnt > 0;
        }

        // Helper: Prüfe ob Index existiert
        async function indexExists(table, indexName) {
            const rows = await dbService.query(
                `SELECT COUNT(*) as cnt FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?`,
                [table, indexName]
            );
            return rows[0]?.cnt > 0;
        }

        // 1) scheduled_start in giveaways
        if (!await columnExists('giveaways', 'scheduled_start')) {
            await dbService.query(`ALTER TABLE giveaways ADD COLUMN scheduled_start TIMESTAMP NULL DEFAULT NULL COMMENT 'Geplanter Startzeitpunkt' AFTER ends_at`);
            Logger.info('[Giveaway Update] Spalte scheduled_start hinzugefügt');
        }

        // 2) claim_duration_ms in giveaways
        if (!await columnExists('giveaways', 'claim_duration_ms')) {
            await dbService.query(`ALTER TABLE giveaways ADD COLUMN claim_duration_ms INT NULL DEFAULT NULL COMMENT 'Claim-Zeitlimit in ms' AFTER button_emoji`);
            Logger.info('[Giveaway Update] Spalte claim_duration_ms hinzugefügt');
        }

        // 3) claim_ends_at in giveaways
        if (!await columnExists('giveaways', 'claim_ends_at')) {
            await dbService.query(`ALTER TABLE giveaways ADD COLUMN claim_ends_at TIMESTAMP NULL DEFAULT NULL COMMENT 'Wann das Claim-Zeitlimit abläuft' AFTER claim_duration_ms`);
            Logger.info('[Giveaway Update] Spalte claim_ends_at hinzugefügt');
        }

        // 4) claim_status in giveaway_winners
        if (!await columnExists('giveaway_winners', 'claim_status')) {
            await dbService.query(`ALTER TABLE giveaway_winners ADD COLUMN claim_status ENUM('pending','claimed','expired') NOT NULL DEFAULT 'pending' AFTER won_at`);
            Logger.info('[Giveaway Update] Spalte claim_status hinzugefügt');
        }

        // 5) Index für Scheduling
        if (!await indexExists('giveaways', 'idx_scheduled')) {
            await dbService.query(`CREATE INDEX idx_scheduled ON giveaways (scheduled_start, status)`);
            Logger.info('[Giveaway Update] Index idx_scheduled erstellt');
        }
    }
};
