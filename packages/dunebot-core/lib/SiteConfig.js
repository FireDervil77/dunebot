'use strict';

/**
 * SiteConfig — Zentraler ENV-Cache Service
 *
 * Liest alle statischen ENV-Variablen einmalig beim Start und cached sie
 * in-memory. Damit muss base.middleware.js nicht mehr bei jedem Request
 * process.env lesen.
 *
 * Analogie: WordPress get_bloginfo() / get_option()
 *
 * Verwendung:
 *   const siteConfig = ServiceManager.get('siteConfig');
 *   siteConfig.get('SITE_NAME')         → 'DuneBot'
 *   siteConfig.get('OWNER_IDS')         → ['123456789']  (Array)
 *   siteConfig.toLocals()               → { siteName, dashboardVersion, ... }
 *   siteConfig.set('SITE_NAME', 'Foo')  → Runtime-Override ohne Neustart
 *   siteConfig.reload()                 → ENV neu einlesen (Dev-Workflow)
 *
 * @author firedervil
 */
class SiteConfig {
    /**
     * Die Typen-Map definiert wie jeder Key gelesen/gecasted wird.
     * 'string' | 'bool' | 'int' | 'array' | 'url'
     *
     * @type {Map<string, { type: string, fallback: * }>}
     */
    static #schema = new Map([
        // Allgemein
        ['SITE_NAME',                     { type: 'string',  fallback: 'DuneBot' }],
        ['NODE_ENV',                       { type: 'string',  fallback: 'development' }],

        // Versionen
        ['DASHBOARD_VERSION',              { type: 'string',  fallback: '1.0.0' }],
        ['BOT_VERSION',                    { type: 'string',  fallback: '1.0.0' }],

        // URLs
        ['DASHBOARD_URL',                  { type: 'url',     fallback: null }],         // Fallback ist dynamisch (req.protocol + host)
        ['BASE_URL',                       { type: 'url',     fallback: null }],
        ['SUPPORT_URL',                    { type: 'url',     fallback: '#' }],
        ['DOCS_URL',                       { type: 'url',     fallback: '#documentation' }],
        ['GITHUB_URL',                     { type: 'url',     fallback: 'https://github.com/yourusername/dunebot' }],
        ['BUYMEACOFFEE_URL',               { type: 'url',     fallback: '#' }],

        // Discord Support Server
        ['DISCORD_SUPPORT_SERVER_URL',     { type: 'url',     fallback: '' }],
        ['DISCORD_SUPPORT_SERVER_NAME',    { type: 'string',  fallback: 'Discord Support' }],

        // Owner/Auth
        ['OWNER_IDS',                      { type: 'array',   fallback: [] }],

        // Theme
        ['ACTIVE_THEME',                   { type: 'string',  fallback: 'default' }],
    ]);

    constructor() {
        /** @type {Map<string, *>} In-Memory Store */
        this._store = new Map();

        this._load();
    }

    /**
     * ENV lesen und in den Store schreiben.
     * @private
     */
    _load() {
        for (const [key, { type, fallback }] of SiteConfig.#schema) {
            const raw = process.env[key];
            this._store.set(key, SiteConfig._cast(raw, type, fallback));
        }
    }

    /**
     * Typisiertes Casten eines rohen ENV-Strings.
     * @param {string|undefined} raw
     * @param {'string'|'bool'|'int'|'array'|'url'} type
     * @param {*} fallback
     * @returns {*}
     * @private
     */
    static _cast(raw, type, fallback) {
        if (raw === undefined || raw === '') return fallback;

        switch (type) {
            case 'bool':
                return raw.toLowerCase() === 'true' || raw === '1';
            case 'int':
                return parseInt(raw, 10) || fallback;
            case 'array':
                return raw.split(',').map(s => s.trim()).filter(Boolean);
            case 'url':
            case 'string':
            default:
                return raw;
        }
    }

    /**
     * Wert lesen.
     * @param {string} key
     * @param {*} [fallback] - Überschreibt Schema-Fallback falls angegeben
     * @returns {*}
     */
    get(key, fallback) {
        if (this._store.has(key)) {
            const val = this._store.get(key);
            // Null/undefined → expliziter Fallback-Parameter
            if (val === null || val === undefined) {
                return fallback !== undefined ? fallback : val;
            }
            return val;
        }
        // Key nicht im Schema → direkt aus ENV lesen als String
        const raw = process.env[key];
        return raw !== undefined ? raw : (fallback !== undefined ? fallback : undefined);
    }

    /**
     * Alle gecachten Werte als einfaches Objekt.
     * @returns {Object}
     */
    getAll() {
        return Object.fromEntries(this._store);
    }

    /**
     * Runtime-Override — Überschreibt einen Wert in-memory ohne Neustart.
     * Nützlich für Admin-Panel Änderungen zur Laufzeit.
     * @param {string} key
     * @param {*} value
     * @returns {SiteConfig} für Method-Chaining
     */
    set(key, value) {
        this._store.set(key, value);
        return this;
    }

    /**
     * ENV neu einlesen und Store aktualisieren.
     * Nützlich im Dev-Workflow nach .env Änderungen.
     * @returns {SiteConfig}
     */
    reload() {
        // dotenv neu laden falls vorhanden
        try {
            require('dotenv').config({ override: true });
        } catch (_) { /* dotenv optional */ }

        this._load();
        return this;
    }

    /**
     * Gibt ein flaches Objekt zurück, das direkt per
     * Object.assign(res.locals, siteConfig.toLocals()) gesetzt werden kann.
     *
     * Enthält nur wirklich statische Werte — kein user, kein locale, kein guildNav.
     *
     * @param {string} [dynamicBaseUrl] - Optionaler request-basierter baseUrl-Fallback
     * @returns {Object}
     */
    toLocals(dynamicBaseUrl) {
        const baseUrl = this.get('DASHBOARD_URL') || this.get('BASE_URL') || dynamicBaseUrl || '';

        return {
            siteName:           this.get('SITE_NAME'),
            dashboard_version:  this.get('DASHBOARD_VERSION'),
            dashboardVersion:   this.get('DASHBOARD_VERSION'),
            bot_version:        this.get('BOT_VERSION'),
            botVersion:         this.get('BOT_VERSION'),
            environment:        this.get('NODE_ENV'),
            baseUrl,
            supportUrl:         this.get('SUPPORT_URL'),
            docsUrl:            this.get('DOCS_URL'),
            githubUrl:          this.get('GITHUB_URL'),
            buyMeCoffeeUrl:     this.get('BUYMEACOFFEE_URL'),
            supportName:        this.get('DISCORD_SUPPORT_SERVER_NAME'),
            supportServerUrl:   this.get('DISCORD_SUPPORT_SERVER_URL'),
            year:               new Date().getFullYear(),
        };
    }

    /**
     * Prüft ob eine User-ID in OWNER_IDS enthalten ist.
     * @param {string} userId
     * @returns {boolean}
     */
    isOwner(userId) {
        if (!userId) return false;
        return this.get('OWNER_IDS', []).includes(String(userId));
    }
}

module.exports = SiteConfig;
