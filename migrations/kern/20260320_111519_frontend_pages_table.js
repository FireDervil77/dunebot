'use strict';

module.exports = {
    description: 'frontend_pages_table',

    async up(db) {
        await db.query(`
            CREATE TABLE IF NOT EXISTS frontend_pages (
                id INT NOT NULL AUTO_INCREMENT,
                title VARCHAR(255) NOT NULL,
                slug VARCHAR(255) NOT NULL,
                content LONGTEXT NULL,
                status ENUM('draft', 'published') NOT NULL DEFAULT 'draft',
                template VARCHAR(50) NOT NULL DEFAULT 'default',
                meta_title VARCHAR(255) NULL,
                meta_description TEXT NULL,
                position INT NOT NULL DEFAULT 0,
                visible_in_menu TINYINT(1) NOT NULL DEFAULT 0,
                created_by VARCHAR(20) NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                UNIQUE KEY uq_page_slug (slug),
                KEY idx_status (status),
                KEY idx_position (position)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
    },

    async down(db) {
        await db.query('DROP TABLE IF EXISTS frontend_pages');
    }
};
