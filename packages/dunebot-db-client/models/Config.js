/**
 * MySQL-Tabellendefinition für Config
 * @author firedervil
 * @returns {string} SQL CREATE TABLE Statement
 */
module.exports = () => {
  return `
    CREATE TABLE IF NOT EXISTS configs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      plugin_name VARCHAR(255) NOT NULL,
      config_key VARCHAR(255) NOT NULL,
      config_value TEXT NULL,
      context VARCHAR(255) NOT NULL DEFAULT 'shared',
      guild_id VARCHAR(255) DEFAULT '', 
      is_global TINYINT(1) DEFAULT 1, 
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_plugin_context (plugin_name, config_key, context),
      INDEX idx_guild (guild_id),
      UNIQUE KEY unique_plugin_config (plugin_name, config_key, context, guild_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;
};