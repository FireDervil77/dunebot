/**
 * MySQL-Tabellendefinition für GuildSettings
 * @author firedervil
 * @returns {string} SQL CREATE TABLE Statement
 */
module.exports = () => {
  return `
    CREATE TABLE IF NOT EXISTS guild_settings (
      id int(11) NOT NULL,
      guild_id varchar(255) DEFAULT NULL,
      option_key varchar(255) NOT NULL,
      option_value text DEFAULT NULL,
      created_at datetime NOT NULL,
      updated_at datetime NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;
};