/**
 * MySQL-Tabellendefinition für Changelog
 * @author firedervil
 * @returns {string} SQL CREATE TABLE Statement
 */
module.exports = () => {
  return `
    CREATE TABLE IF NOT EXISTS changelogs (
      _id INT AUTO_INCREMENT PRIMARY KEY,
      version VARCHAR(50) NOT NULL,
      title VARCHAR(255) NOT NULL,
      description LONGTEXT NOT NULL COMMENT 'Beschreibung des Updates (Markdown)',
      type ENUM('major', 'minor', 'patch', 'hotfix') NOT NULL DEFAULT 'minor',
      component ENUM('bot', 'dashboard', 'system', 'plugin') NOT NULL DEFAULT 'system',
      component_name VARCHAR(255) NULL COMMENT 'Name der Komponente (z.B. Plugin-Name)',
      changes JSON NOT NULL DEFAULT (JSON_OBJECT('added', JSON_ARRAY(), 'changed', JSON_ARRAY(), 'fixed', JSON_ARRAY(), 'removed', JSON_ARRAY())),
      is_public BOOLEAN NOT NULL DEFAULT TRUE,
      release_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      author_id VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      
      INDEX idx_version (version),
      INDEX idx_type (type),
      INDEX idx_component (component),
      INDEX idx_release_date (release_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;
};