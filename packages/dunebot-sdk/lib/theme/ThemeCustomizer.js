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
     * Erzeugt den <style>-Block einer Guild: Design-Tokens und eigenes CSS.
     *
     * Gesetzt werden **nur Variablen**. Was die Variablen bewirken, steht
     * gebündelt in `assets/css/tokens.css` — früher stand hier ein Generator,
     * der für jede Variable handgeschriebene `!important`-Selektorlisten
     * ausgab und dabei auf drei AdminLTE-Generationen gleichzeitig zielte.
     * Jedes neue Bedienelement musste dort nachgetragen werden.
     *
     * @param {string} guildId
     * @returns {Promise<string>} CSS-String
     */
    async renderGuildCustomCSS(guildId) {
        const { custom_css, custom_variables } = await this.getGuildCustomization(guildId);

        let css = '';

        const tokens = this.buildTokenBlock(custom_variables);
        if (tokens) css += tokens;

        if (custom_css) css += this.sanitizeCss(custom_css);

        return css;
    }

    /**
     * Aus gespeicherten Tokens einen `:root`-Block bauen.
     *
     * Farben bekommen zusätzlich ein `-rgb`-Tripel, weil die Utilities von
     * Bootstrap (`.text-primary`, `.bg-primary`) mit
     * `rgba(var(--…-rgb), …)` rechnen und mit einem Hex-Wert nichts anfangen
     * können.
     *
     * @param {object|null} variables - { 'fb-primary': '#3498db', … }
     * @returns {string} CSS-Block oder leerer String
     */
    buildTokenBlock(variables) {
        if (!variables || typeof variables !== 'object') return '';

        const zeilen = [];

        for (const [key, value] of Object.entries(variables)) {
            if (value == null || value === '') continue;

            const name = String(key).replace(/[^a-zA-Z0-9-_]/g, '');
            const wert = String(value).replace(/[;<>{}]/g, '').trim();
            if (!name || !wert) continue;

            zeilen.push(`  --${name}: ${wert};`);

            const rgb = this.hexToRgbTriplet(wert);
            if (rgb) zeilen.push(`  --${name}-rgb: ${rgb};`);
        }

        return zeilen.length ? `:root {\n${zeilen.join('\n')}\n}\n` : '';
    }

    /**
     * '#3498db' → '52, 152, 219'. Kurzform '#abc' wird mitgenommen.
     *
     * @param {string} wert
     * @returns {string|null} Tripel oder null, wenn es keine Hex-Farbe ist
     */
    hexToRgbTriplet(wert) {
        const treffer = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(wert.trim());
        if (!treffer) return null;

        let hex = treffer[1];
        if (hex.length === 3) hex = hex.split('').map(z => z + z).join('');

        const zahl = parseInt(hex, 16);
        return `${(zahl >> 16) & 255}, ${(zahl >> 8) & 255}, ${zahl & 255}`;
    }

    /**
     * Eigenes CSS entschärfen, bevor es in die Seite geschrieben wird.
     *
     * @param {string} css
     * @returns {string}
     */
    sanitizeCss(css) {
        return String(css)
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<\/style>/gi, '')
            .replace(/expression\s*\(/gi, '')
            .replace(/javascript\s*:/gi, '')
            .replace(/url\s*\(\s*['"]?\s*javascript:/gi, '');
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
