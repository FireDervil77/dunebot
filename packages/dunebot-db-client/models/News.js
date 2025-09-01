/**
 * MySQL-Tabellendefinition für News
 * @author firedervil
 * @returns {string} SQL CREATE TABLE Statement
 */
module.exports = () => {
  return `
    CREATE TABLE IF NOT EXISTS news (
      _id int(11) NOT NULL,
      title varchar(255) NOT NULL COMMENT 'Titel der Neuigkeit',
      slug varchar(255) NOT NULL COMMENT 'URL-freundliche Version des Titels',
      author varchar(255) NOT NULL COMMENT 'Autor der Neuigkeit',
      news_text text NOT NULL COMMENT 'Vollständiger Text der Neuigkeit',
      excerpt text DEFAULT NULL COMMENT 'Kurze Zusammenfassung für Vorschauen',
      image_url varchar(255) DEFAULT NULL COMMENT 'URL zum Vorschaubild',
      date datetime NOT NULL COMMENT 'Veröffentlichungsdatum der Neuigkeit',
      status varchar(255) NOT NULL DEFAULT 'published' COMMENT 'Status der Neuigkeit (draft, published, archived)',
      created_at timestamp NOT NULL DEFAULT current_timestamp(),
      updated_at timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;
};