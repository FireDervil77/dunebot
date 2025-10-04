/**
 * MySQL-Tabellendefinition für User
 * @author firedervil
 * @returns {string} SQL CREATE TABLE Statement
 */
module.exports = () => {
  return `
    CREATE TABLE IF NOT EXISTS users (
      _id VARCHAR(255) NOT NULL PRIMARY KEY,
      locale VARCHAR(255) DEFAULT NULL,
      logged_in TINYINT(1) DEFAULT NULL,
      tokens LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;
};