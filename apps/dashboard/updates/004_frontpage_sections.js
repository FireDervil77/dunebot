/**
 * Kern-Update 004: CMS Frontpage — Sektionen, Navigation, Footer
 *
 * 1. Erstellt frontpage_sections Tabelle (mit divider_before + custom_html)
 * 2. Erstellt frontend_menu_items Tabelle
 * 3. Erstellt frontend_footer_columns + frontend_footer_links Tabellen
 * 4. Seeded Standard-Sektionen, Menüpunkte und Footer-Spalten
 */
module.exports = {
    version: "7.2.0",
    description: "CMS Frontpage: Sektionen, Navigation & Footer Verwaltung",

    async run(dbService, { ServiceManager, Logger }) {

        // ═══════════════════════════════════════════════════
        // 1. frontpage_sections
        // ═══════════════════════════════════════════════════
        await dbService.pool.execute(`
            CREATE TABLE IF NOT EXISTS frontpage_sections (
                id              INT           NOT NULL AUTO_INCREMENT,
                section_type    VARCHAR(50)   NOT NULL COMMENT 'hero, features, news, changelogs, plugins, documentation, stats, skills, custom',
                title           VARCHAR(255)  NOT NULL,
                position        INT           NOT NULL DEFAULT 0,
                visible         TINYINT(1)    NOT NULL DEFAULT 1,
                config          JSON          NULL,
                css_class       VARCHAR(100)  NOT NULL DEFAULT '',
                divider_before  VARCHAR(50)   NOT NULL DEFAULT 'auto' COMMENT 'auto, light-to-dark, dark-to-light, none',
                custom_html     TEXT          NULL,
                created_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                KEY idx_section_type (section_type),
                KEY idx_position (position)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        Logger.info("[Update 004] frontpage_sections Tabelle erstellt.");

        // Seed Sektionen (nur wenn leer)
        const [secCount] = await dbService.pool.execute('SELECT COUNT(*) AS cnt FROM frontpage_sections');
        if (secCount[0].cnt === 0) {
            const sections = [
                ['hero',          'Hero-Carousel',          1, '{}',  'dark-background',  'auto'],
                ['features',      'Features',               2, '{}',  'dark-background',  'auto'],
                ['news',          'News',                   3, '{}',  'light-background', 'auto'],
                ['changelogs',    'Changelogs',             4, '{}',  'dark-background',  'auto'],
                ['plugins',       'Plugins',                5, '{}',  '',                 'auto'],
                ['documentation', 'Dokumentation & Service',6, '{}',  'dark-background',  'auto'],
                ['stats',         'Statistiken',            7, JSON.stringify({items:[
                    {label:'Invites',value:232,duration:1},{label:'Users',value:2512,duration:4},
                    {label:'Hours Of Support',value:1453,duration:1},{label:'LifeTime Spend (minutes)',value:92160,duration:3}
                ]}), '', 'auto'],
                ['skills',        'Skills',                 8, JSON.stringify({items:[
                    {label:'HTML',value:100},{label:'CSS',value:82},{label:'JavaScript',value:100},
                    {label:'Discord',value:100},{label:'Dashboard',value:75},{label:'Dunebot',value:55}
                ]}), '', 'auto']
            ];
            for (const [type,title,pos,config,css,div] of sections) {
                await dbService.pool.execute(
                    `INSERT INTO frontpage_sections (section_type,title,position,visible,config,css_class,divider_before) VALUES (?,?,?,1,?,?,?)`,
                    [type,title,pos,config,css,div]
                );
            }
            Logger.info("[Update 004] 8 Standard-Sektionen geseeded.");
        }

        // ═══════════════════════════════════════════════════
        // 2. frontend_menu_items
        // ═══════════════════════════════════════════════════
        await dbService.pool.execute(`
            CREATE TABLE IF NOT EXISTS frontend_menu_items (
                id          INT           NOT NULL AUTO_INCREMENT,
                parent_id   INT           NULL,
                label       VARCHAR(255)  NOT NULL,
                url         VARCHAR(500)  NOT NULL DEFAULT '#',
                icon        VARCHAR(100)  NULL,
                target      VARCHAR(20)   NOT NULL DEFAULT '_self',
                position    INT           NOT NULL DEFAULT 0,
                visible     TINYINT(1)    NOT NULL DEFAULT 1,
                css_class   VARCHAR(100)  NULL,
                created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                KEY idx_parent (parent_id),
                KEY idx_position (position),
                CONSTRAINT fk_menu_parent FOREIGN KEY (parent_id) REFERENCES frontend_menu_items(id) ON DELETE CASCADE ON UPDATE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        Logger.info("[Update 004] frontend_menu_items Tabelle erstellt.");

        // Seed Menu (nur wenn leer)
        const [menuCount] = await dbService.pool.execute('SELECT COUNT(*) AS cnt FROM frontend_menu_items');
        if (menuCount[0].cnt === 0) {
            // Top-Level Items
            const topItems = [
                { label: 'Home',       url: '/',            pos: 1 },
                { label: 'Features',   url: '/#features',   pos: 2 },
                { label: 'News',       url: '/#news',       pos: 3 },
                { label: 'Services',   url: '/#documentation', pos: 4 }, // wird Dropdown
                { label: 'Dashboard',  url: '/guild',       pos: 5 }
            ];
            const insertedIds = {};
            for (const item of topItems) {
                const [res] = await dbService.pool.execute(
                    'INSERT INTO frontend_menu_items (parent_id,label,url,position,visible) VALUES (NULL,?,?,?,1)',
                    [item.label, item.url, item.pos]
                );
                insertedIds[item.label] = res.insertId;
            }
            // Dropdown-Kinder für "Services"
            const servicesId = insertedIds['Services'];
            const children = [
                { label: 'Dokumentation', url: '/#documentation', pos: 1 },
                { label: 'Changelogs',    url: '/changelogs',     pos: 2 },
                { label: 'Plugins',       url: '/#plugins',       pos: 3 },
                { label: 'GitHub',        url: 'https://github.com/firedervil77/dunebot', pos: 4, target: '_blank' },
                { label: 'AGB',           url: '/tos',            pos: 5 },
                { label: 'Datenschutz',   url: '/privacy',        pos: 6 },
                { label: 'Dashboard',     url: '/guild',          pos: 7 }
            ];
            for (const ch of children) {
                await dbService.pool.execute(
                    'INSERT INTO frontend_menu_items (parent_id,label,url,target,position,visible) VALUES (?,?,?,?,?,1)',
                    [servicesId, ch.label, ch.url, ch.target || '_self', ch.pos]
                );
            }
            Logger.info("[Update 004] Standard-Menüpunkte geseeded.");
        }

        // ═══════════════════════════════════════════════════
        // 3. frontend_footer_columns + frontend_footer_links
        // ═══════════════════════════════════════════════════
        await dbService.pool.execute(`
            CREATE TABLE IF NOT EXISTS frontend_footer_columns (
                id          INT           NOT NULL AUTO_INCREMENT,
                title       VARCHAR(255)  NOT NULL,
                col_width   VARCHAR(20)   NOT NULL DEFAULT 'col-lg-3',
                position    INT           NOT NULL DEFAULT 0,
                visible     TINYINT(1)    NOT NULL DEFAULT 1,
                column_type VARCHAR(30)   NOT NULL DEFAULT 'links' COMMENT 'links, about, social, custom',
                content     TEXT          NULL,
                created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                KEY idx_position (position)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        await dbService.pool.execute(`
            CREATE TABLE IF NOT EXISTS frontend_footer_links (
                id          INT           NOT NULL AUTO_INCREMENT,
                column_id   INT           NOT NULL,
                label       VARCHAR(255)  NOT NULL,
                url         VARCHAR(500)  NOT NULL DEFAULT '#',
                icon        VARCHAR(100)  NULL,
                target      VARCHAR(20)   NOT NULL DEFAULT '_self',
                position    INT           NOT NULL DEFAULT 0,
                visible     TINYINT(1)    NOT NULL DEFAULT 1,
                created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                KEY idx_column (column_id),
                KEY idx_position (position),
                CONSTRAINT fk_footer_link_column FOREIGN KEY (column_id) REFERENCES frontend_footer_columns(id) ON DELETE CASCADE ON UPDATE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        Logger.info("[Update 004] Footer-Tabellen erstellt.");

        // Seed Footer (nur wenn leer)
        const [footCount] = await dbService.pool.execute('SELECT COUNT(*) AS cnt FROM frontend_footer_columns');
        if (footCount[0].cnt === 0) {
            // Spalte 1: About
            const [aboutRes] = await dbService.pool.execute(
                `INSERT INTO frontend_footer_columns (title, col_width, position, column_type, content)
                 VALUES ('DuneBot', 'col-lg-5', 1, 'about', 'Ein vielseitiger Discord-Bot mit Plugin-System und Web-Dashboard.')`,
            );
            // Spalte 2: Services (Links)
            const [servRes] = await dbService.pool.execute(
                `INSERT INTO frontend_footer_columns (title, col_width, position, column_type) VALUES ('Services', 'col-lg-3', 2, 'links')`
            );
            const servId = servRes.insertId;
            const servLinks = [
                { label: 'GitHub',        url: 'https://github.com/firedervil77/dunebot', target: '_blank' },
                { label: 'Dokumentation', url: '#' },
                { label: 'Dashboard',     url: '/guild' },
                { label: 'Plugins',       url: '#' }
            ];
            for (let i = 0; i < servLinks.length; i++) {
                await dbService.pool.execute(
                    'INSERT INTO frontend_footer_links (column_id,label,url,target,position) VALUES (?,?,?,?,?)',
                    [servId, servLinks[i].label, servLinks[i].url, servLinks[i].target || '_self', i+1]
                );
            }

            // Spalte 3: Nützliche Links
            const [linksRes] = await dbService.pool.execute(
                `INSERT INTO frontend_footer_columns (title, col_width, position, column_type) VALUES ('Nützliche Links', 'col-lg-2', 3, 'links')`
            );
            const linksId = linksRes.insertId;
            const usefulLinks = [
                { label: 'Home',               url: '/' },
                { label: 'Features',           url: '/#features' },
                { label: 'News',               url: '/#news' },
                { label: 'Terms of Service',   url: '/tos' },
                { label: 'Datenschutz',        url: '/privacy' }
            ];
            for (let i = 0; i < usefulLinks.length; i++) {
                await dbService.pool.execute(
                    'INSERT INTO frontend_footer_links (column_id,label,url,position) VALUES (?,?,?,?)',
                    [linksId, usefulLinks[i].label, usefulLinks[i].url, i+1]
                );
            }
            Logger.info("[Update 004] Standard-Footer geseeded.");
        }
    }
};
