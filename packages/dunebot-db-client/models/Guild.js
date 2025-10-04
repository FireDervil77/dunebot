/**
 * MySQL-Tabellendefinition für Guild
 * @author firedervil
 * @returns {string} SQL CREATE TABLE Statement
 */
module.exports = () => {
  return `
    CREATE TABLE IF NOT EXISTS guilds (
      _id VARCHAR(255) NOT NULL PRIMARY KEY,
      guild_name VARCHAR(255) NOT NULL,
      owner_id VARCHAR(255) DEFAULT NULL,
      owner_name VARCHAR(255) DEFAULT NULL,
      joined_at DATETIME NOT NULL,
      left_at DATETIME DEFAULT NULL,
      is_active_guild TINYINT(1) DEFAULT 0,
      active_user_id VARCHAR(255) DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_owner_active (owner_id, is_active_guild),
      INDEX idx_active_user (active_user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;
};