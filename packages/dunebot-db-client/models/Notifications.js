/**
 * MySQL-Tabellendefinition für Notifications
 * @author firedervil
 * @returns {string} SQL CREATE TABLE Statement
 */
module.exports = () => {
  return `
    CREATE TABLE IF NOT EXISTS notifications (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      message TEXT NOT NULL,
      type ENUM('info', 'warning', 'error', 'success') DEFAULT 'info',
      expiry DATETIME DEFAULT NULL,
      roles TEXT NULL,
      dismissed TINYINT(1) NOT NULL DEFAULT 0,
      action_url VARCHAR(255) NULL,
      action_text VARCHAR(100) NULL DEFAULT 'Mehr erfahren',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;
};