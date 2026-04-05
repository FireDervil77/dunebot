'use strict';

module.exports = {
    async up(db) {
        await db.query(`
            CREATE TABLE IF NOT EXISTS blog_posts (
                id INT AUTO_INCREMENT PRIMARY KEY,
                title_translations JSON NOT NULL COMMENT '{"de-DE":"...","en-GB":"..."}',
                content_translations JSON NOT NULL COMMENT '{"de-DE":"...","en-GB":"..."}',
                excerpt_translations JSON NOT NULL COMMENT '{"de-DE":"...","en-GB":"..."}',
                slug VARCHAR(255) NOT NULL,
                author VARCHAR(255) NOT NULL,
                image_url VARCHAR(512) DEFAULT NULL,
                category VARCHAR(100) DEFAULT 'gaming',
                tags VARCHAR(500) DEFAULT NULL,
                status VARCHAR(50) NOT NULL DEFAULT 'draft',
                published_at DATETIME DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY unique_slug (slug),
                INDEX idx_status_date (status, published_at DESC),
                INDEX idx_category (category)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
    },

    async down(db) {
        await db.query('DROP TABLE IF EXISTS blog_posts');
    }
};
