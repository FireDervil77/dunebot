'use strict';

const { ServiceManager } = require('dunebot-core');

/**
 * ThemeCustomizer — Per-Guild CSS, Variables, DB-Zugriff
 */
class ThemeCustomizer {
    /**
     * @param {import('../ThemeManager')} manager - ThemeManager-Instanz
     */
    constructor(manager) {
        this.manager = manager;
    }

    /**
     * Aktives Theme für eine Guild aus DB laden (mit In-Memory-Cache).
     *
     * @param {string} guildId
     * @returns {Promise<string>} Theme-Name
     */
    async getThemeForGuild(guildId) {
        if (this.manager._themeGuildCache.has(guildId)) {
            return this.manager._themeGuildCache.get(guildId);
        }

        try {
            const dbService = ServiceManager.get('dbService');
            const rows = await dbService.query(
                'SELECT theme_name FROM guild_themes WHERE guild_id = ? LIMIT 1',
                [guildId]
            );

            const themeName = (rows && rows.length > 0)
                ? rows[0].theme_name
                : (process.env.ACTIVE_THEME || 'default');

            this.manager._themeGuildCache.set(guildId, themeName);
            return themeName;
        } catch {
            return process.env.ACTIVE_THEME || 'default';
        }
    }

    /**
     * Theme für eine Guild dauerhaft in DB speichern + Cache invalidieren.
     *
     * @param {string} guildId
     * @param {string} themeName
     */
    async setThemeForGuild(guildId, themeName) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');

        await dbService.query(
            `INSERT INTO guild_themes (guild_id, theme_name)
             VALUES (?, ?)
             ON DUPLICATE KEY UPDATE theme_name = VALUES(theme_name)`,
            [guildId, themeName]
        );

        this.manager._themeGuildCache.delete(guildId);
        Logger.info(`[ThemeCustomizer] Theme für Guild ${guildId} auf '${themeName}' gesetzt`);
    }

    /**
     * Custom CSS + Variablen für eine Guild laden.
     * @param {string} guildId
     * @returns {Promise<{custom_css: string|null, custom_variables: object|null}>}
     */
    async getGuildCustomization(guildId) {
        try {
            const dbService = ServiceManager.get('dbService');
            const rows = await dbService.query(
                'SELECT custom_css, custom_variables FROM guild_themes WHERE guild_id = ? LIMIT 1',
                [guildId]
            );

            if (rows && rows.length > 0) {
                let variables = rows[0].custom_variables;
                if (typeof variables === 'string') {
                    try { variables = JSON.parse(variables); } catch { variables = null; }
                }
                return {
                    custom_css: rows[0].custom_css || null,
                    custom_variables: variables || null
                };
            }
            return { custom_css: null, custom_variables: null };
        } catch {
            return { custom_css: null, custom_variables: null };
        }
    }

    /**
     * Custom CSS + Variablen für eine Guild speichern.
     * @param {string} guildId
     * @param {object} customization - { custom_css, custom_variables }
     */
    async setGuildCustomization(guildId, { custom_css, custom_variables }) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');

        const varsJson = custom_variables ? JSON.stringify(custom_variables) : null;

        const existing = await dbService.query(
            'SELECT id FROM guild_themes WHERE guild_id = ? LIMIT 1',
            [guildId]
        );

        if (existing && existing.length > 0) {
            await dbService.query(
                'UPDATE guild_themes SET custom_css = ?, custom_variables = ? WHERE guild_id = ?',
                [custom_css || null, varsJson, guildId]
            );
        } else {
            const themeName = process.env.ACTIVE_THEME || 'default';
            await dbService.query(
                'INSERT INTO guild_themes (guild_id, theme_name, custom_css, custom_variables) VALUES (?, ?, ?, ?)',
                [guildId, themeName, custom_css || null, varsJson]
            );
        }

        Logger.info(`[ThemeCustomizer] Custom CSS/Variables für Guild ${guildId} gespeichert`);
    }

    /**
     * Generiert CSS-<style>-Block aus Guild-Customization.
     * @param {string} guildId
     * @returns {Promise<string>} CSS-String
     */
    async renderGuildCustomCSS(guildId) {
        const { custom_css, custom_variables } = await this.getGuildCustomization(guildId);

        let css = '';

        if (custom_variables && typeof custom_variables === 'object') {
            const entries = Object.entries(custom_variables).filter(([, v]) => v != null && v !== '');
            if (entries.length > 0) {
                css += ':root {\n';
                for (const [key, value] of entries) {
                    const safeKey = key.replace(/[^a-zA-Z0-9-_]/g, '');
                    const safeValue = String(value).replace(/[;<>{}]/g, '').trim();
                    if (safeKey && safeValue) {
                        css += `  --${safeKey}: ${safeValue};\n`;
                    }
                }
                css += '}\n';

                const v = {};
                for (const [key, value] of entries) {
                    const safeKey = key.replace(/[^a-zA-Z0-9-_]/g, '');
                    const safeValue = String(value).replace(/[;<>{}]/g, '').trim();
                    if (safeKey && safeValue) v[safeKey] = safeValue;
                }

                // Sidebar
                if (v['sidebar-bg']) {
                    css += `.app-sidebar, .main-sidebar, .sidebar { background-color: ${v['sidebar-bg']} !important; }\n`;
                }
                if (v['sidebar-color']) {
                    css += `.app-sidebar .nav-link, .app-sidebar .nav-link p, .app-sidebar .nav-header, .app-sidebar .sidebar-brand-text { color: ${v['sidebar-color']} !important; }\n`;
                    css += `.app-sidebar .nav-icon, .app-sidebar .nav-link .nav-icon { color: ${v['sidebar-color']} !important; }\n`;
                    css += `.nav-sidebar .nav-link, .nav-sidebar .nav-link p { color: ${v['sidebar-color']} !important; }\n`;
                    css += `[data-bs-theme="dark"] .nav-sidebar .nav-link, [data-bs-theme="dark"] .nav-link p { color: ${v['sidebar-color']} !important; }\n`;
                    css += `.sidebar .nav-link, .sidebar .nav-link p, .sidebar .nav-header, .sidebar-brand-text { color: ${v['sidebar-color']} !important; }\n`;
                }
                if (v['sidebar-hover-bg']) {
                    css += `.app-sidebar .nav-link:hover, .app-sidebar .nav-link.active { background-color: ${v['sidebar-hover-bg']} !important; }\n`;
                    css += `.nav-sidebar > .nav-item > .nav-link.active, .nav-sidebar .nav-treeview > .nav-item > .nav-link.active { background-color: ${v['sidebar-hover-bg']} !important; }\n`;
                    css += `.sidebar .nav-link:hover, .sidebar .nav-link.active, .sidebar .nav-treeview > .nav-item > .nav-link.active { background-color: ${v['sidebar-hover-bg']} !important; }\n`;
                }

                // Header
                if (v['header-bg']) {
                    css += `.app-header, .main-header, .main-header.navbar { background-color: ${v['header-bg']} !important; }\n`;
                }

                // Body / Content
                if (v['body-bg']) {
                    css += `.content-wrapper, .app-main { background-color: ${v['body-bg']} !important; }\n`;
                }

                // Cards
                if (v['card-bg']) {
                    css += `.card { background-color: ${v['card-bg']} !important; }\n`;
                }

                // Text
                if (v['text-color']) {
                    css += `body, .content-wrapper, .card-body, p, span, td, th, li, label { color: ${v['text-color']} !important; }\n`;
                    css += `h1, h2, h3, h4, h5, h6, .card-title, .info-box-text, .info-box-number { color: ${v['text-color']} !important; }\n`;
                    css += `.main-header .navbar-nav .nav-link, .main-header .navbar-nav .nav-link i { color: ${v['text-color']} !important; }\n`;
                    css += `.content-header h1, .breadcrumb-item a, .breadcrumb-item.active { color: ${v['text-color']} !important; }\n`;
                }

                // Primary Color
                if (v['primary-color']) {
                    css += `.btn-primary { background-color: ${v['primary-color']} !important; border-color: ${v['primary-color']} !important; }\n`;
                    css += `.btn-outline-primary { color: ${v['primary-color']} !important; border-color: ${v['primary-color']} !important; }\n`;
                    css += `.btn-outline-primary:hover { background-color: ${v['primary-color']} !important; color: #fff !important; }\n`;
                    css += `.badge-primary { background-color: ${v['primary-color']} !important; }\n`;
                    css += `.bg-primary { background-color: ${v['primary-color']} !important; }\n`;
                    css += `.text-primary { color: ${v['primary-color']} !important; }\n`;
                    css += `.page-item.active .page-link { background-color: ${v['primary-color']} !important; border-color: ${v['primary-color']} !important; }\n`;
                    css += `.custom-control-input:checked ~ .custom-control-label::before { background-color: ${v['primary-color']} !important; border-color: ${v['primary-color']} !important; }\n`;
                }

                // Accent Color
                if (v['accent-color']) {
                    css += `.btn-warning { background-color: ${v['accent-color']} !important; border-color: ${v['accent-color']} !important; }\n`;
                    css += `.badge-warning { background-color: ${v['accent-color']} !important; }\n`;
                    css += `.text-warning { color: ${v['accent-color']} !important; }\n`;
                }

                // Link Color
                if (v['link-color']) {
                    css += `a:not(.btn):not(.nav-link):not(.dropdown-item) { color: ${v['link-color']} !important; }\n`;
                    css += `a:not(.btn):not(.nav-link):not(.dropdown-item):hover { color: ${v['link-color']} !important; filter: brightness(0.85); }\n`;
                }
            }
        }

        // Custom CSS anhängen (sanitized)
        if (custom_css) {
            const safeCss = custom_css
                .replace(/<script[\s\S]*?<\/script>/gi, '')
                .replace(/<\/style>/gi, '')
                .replace(/expression\s*\(/gi, '')
                .replace(/javascript\s*:/gi, '')
                .replace(/url\s*\(\s*['"]?\s*javascript:/gi, '');
            css += safeCss;
        }

        return css;
    }

    /**
     * Theme-Name für den aktuellen Request ermitteln.
     *
     * @param {import('express').Request} req
     * @param {import('express').Response} res
     * @returns {Promise<string>} Theme-Name
     */
    async getThemeForRequest(req, res) {
        const guildId = res?.locals?.guildId || req?.params?.guildId || null;

        if (guildId) {
            return this.getThemeForGuild(guildId);
        }

        return process.env.ACTIVE_THEME || this.manager.activeTheme || 'default';
    }
}

module.exports = ThemeCustomizer;
