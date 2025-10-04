/**
 * MySQL-Tabellendefinition für Changelog
 * @author firedervil
 * @returns {string} SQL CREATE TABLE Statement
 */
module.exports = () => {
  return `
    CREATE TABLE IF NOT EXISTS changelogs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      version VARCHAR(50) NOT NULL,
      title VARCHAR(255) NOT NULL,
      description LONGTEXT NOT NULL,
      type ENUM('major', 'minor', 'patch', 'hotfix') NOT NULL DEFAULT 'minor',
      component ENUM('bot', 'dashboard', 'system', 'plugin') NOT NULL DEFAULT 'system',
      component_name VARCHAR(255) NULL,
      changes JSON NOT NULL,
      is_public TINYINT(1) NOT NULL DEFAULT 1,
      release_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      author_id VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;
};