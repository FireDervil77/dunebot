/**
 * MySQL-Tabellendefinition für NavItem
 * @author firedervil
 * @returns {string} SQL CREATE TABLE Statement
 */
module.exports = () => {
  return `
    CREATE TABLE IF NOT EXISTS nav_items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      plugin VARCHAR(255) DEFAULT NULL,
      guildId VARCHAR(255) DEFAULT NULL,
      title VARCHAR(255) DEFAULT NULL,
      url VARCHAR(255) DEFAULT NULL,
      icon VARCHAR(255) DEFAULT 'fa-puzzle-piece',
      sort_order INT DEFAULT 50,
      parent VARCHAR(255) DEFAULT NULL,
      type VARCHAR(255) NOT NULL DEFAULT 'main',
      capability VARCHAR(255) DEFAULT 'manage_guild',
      target VARCHAR(255) DEFAULT '_self',
      visible TINYINT(1) DEFAULT 1,
      classes VARCHAR(255) DEFAULT '',
      position VARCHAR(255) DEFAULT 'normal',
      meta LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;
};