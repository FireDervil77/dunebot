/**
 * MySQL-Tabellendefinition für User
 * @author firedervil
 * @returns {string} SQL CREATE TABLE Statement
 */
module.exports = () => {
  return `
    CREATE TABLE IF NOT EXISTS users (
      _id varchar(255) NOT NULL,
      locale varchar(255) DEFAULT NULL,
      logged_in tinyint(1) DEFAULT NULL,
      tokens longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
      created_at datetime DEFAULT NULL,
      updated_at datetime DEFAULT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;
};