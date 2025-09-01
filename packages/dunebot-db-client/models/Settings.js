/**
 * MySQL-Tabellendefinition für Settings
 * @author firedervil
 * @returns {string} SQL CREATE TABLE Statement
 */
module.exports = () => {
  return `
    CREATE TABLE IF NOT EXISTS settings (
      id int(11) NOT NULL,
      _id varchar(64) NOT NULL,
      prefix varchar(255) NOT NULL DEFAULT '!',
      locale varchar(255) NOT NULL DEFAULT 'de-DE',
      enabled_plugins text NOT NULL,
      disabled_prefix varchar(255) DEFAULT NULL,
      disabled_slash varchar(255) DEFAULT NULL,
      created_at datetime NOT NULL,
      updated_at datetime NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;
};