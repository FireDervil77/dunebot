/**
 * MySQL-Tabellendefinition für Locale
 * @author firedervil
 * @returns {string} SQL CREATE TABLE Statement
 */
module.exports = () => {
  return `
    CREATE TABLE IF NOT EXISTS localizations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      app VARCHAR(255) NOT NULL,
      plugin VARCHAR(255) NOT NULL,
      lang VARCHAR(255) NOT NULL,
      data LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
      lastModified DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;
};