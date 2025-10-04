/**
 * MySQL-Tabellendefinition für News
 * @author firedervil
 * @returns {string} SQL CREATE TABLE Statement
 */
module.exports = () => {
  return `
    CREATE TABLE IF NOT EXISTS news (
      _id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      slug VARCHAR(255) NOT NULL,
      author VARCHAR(255) NOT NULL,
      news_text TEXT NOT NULL,
      excerpt TEXT DEFAULT NULL,
      image_url VARCHAR(255) DEFAULT NULL,
      date DATETIME NOT NULL,
      status VARCHAR(255) NOT NULL DEFAULT 'published',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;
};