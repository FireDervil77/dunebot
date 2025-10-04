/**
 * MySQL-Tabellendefinition für StormTimer
 * @author firedervil
 * @type {object}
 */
module.exports = {
  name: 'StormTimer',
  schema: `
    CREATE TABLE IF NOT EXISTS dunemap_storm_timer (
        guild_id VARCHAR(20) NOT NULL PRIMARY KEY,
        start_time BIGINT NOT NULL,
        duration BIGINT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        created_by VARCHAR(20) NOT NULL,
        INDEX idx_guild_time (guild_id, start_time)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `
};