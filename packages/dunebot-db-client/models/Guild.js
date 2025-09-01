/**
 * MySQL-Tabellendefinition für Guild
 * @author firedervil
 * @returns {string} SQL CREATE TABLE Statement
 */
module.exports = () => {
  return `
    CREATE TABLE IF NOT EXISTS guilds (
        _id varchar(255) NOT NULL,
        guild_name varchar(255) NOT NULL,
        owner_id varchar(255) DEFAULT NULL,
        owner_name varchar(255) DEFAULT NULL,
        joined_at datetime NOT NULL,
        left_at datetime DEFAULT NULL,
        created_at datetime NOT NULL,
        updated_at datetime NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;
};