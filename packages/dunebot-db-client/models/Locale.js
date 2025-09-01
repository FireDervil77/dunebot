/**
 * MySQL-Tabellendefinition für Locale
 * @author firedervil
 * @returns {string} SQL CREATE TABLE Statement
 */
module.exports = () => {
  return `
    CREATE TABLE IF NOT EXISTS localizations (
      id int(11) NOT NULL,
      app varchar(255) NOT NULL,
      plugin varchar(255) NOT NULL,
      lang varchar(255) NOT NULL,
      data longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
      lastModified datetime NOT NULL,
      created_at datetime DEFAULT NULL,
      updated_at datetime DEFAULT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;
};