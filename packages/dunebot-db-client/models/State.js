/**
 * MySQL-Tabellendefinition für State
 * @author firedervil
 * @returns {string} SQL CREATE TABLE Statement
 */
module.exports = () => {
  return `
    CREATE TABLE IF NOT EXISTS states (
     id varchar(255) NOT NULL,
     value text DEFAULT NULL,
     created_at datetime NOT NULL DEFAULT current_timestamp()
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;
};