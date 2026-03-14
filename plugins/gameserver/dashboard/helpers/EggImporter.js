/**
 * EggImporter — Pelican/Pterodactyl Egg → FIREBOT_v2 Konvertierung
 *
 * Übernimmt das Pelican Egg-Format (PTDL_v2) als Source of Truth.
 * Keine Script-Generierung, keine Compat-Weichen.
 *
 * FIREBOT_v2 game_data Struktur:
 * {
 *   meta:          { version, name, author, description }
 *   docker_images: { "image:tag": "Label" }
 *   startup:       { command, done, stop }
 *   config:        { files: {}, logs: [] }
 *   scripts:       { installation: { container, entrypoint, script } }
 *   variables:     [ { name, env_variable, default_value, description,
 *                      user_viewable, user_editable, rules, field_type } ]
 *   templates:     []   ← unser Feature, leer bei Import
 * }
 *
 * @author FireDervil
 * @version 1.0.0
 */

'use strict';

const https = require('https');
const Logger = require('dunebot-core').ServiceManager.get('Logger');

class EggImporter {
    constructor() {
        this.githubApiBase  = 'https://api.github.com';
        this.githubRawBase  = 'https://raw.githubusercontent.com';

        // Pelican-Eggs Repositories: slug → Anzeigename
        this.repositories = {
            'games-steamcmd':  'Games (SteamCMD)',
            'games-standalone': 'Games (Standalone)',
            'minecraft':       'Minecraft',
            'database':        'Databases',
            'software':        'Software',
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // HTTP
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * HTTPS GET → parst JSON wenn möglich, gibt sonst String zurück.
     * @param {string} url
     * @returns {Promise<object|string>}
     */
    _fetch(url) {
        return new Promise((resolve, reject) => {
            const headers = { 'User-Agent': 'FireBot-EggImporter/1.0' };
            if (process.env.GITHUB_API_TOKEN) {
                headers['Authorization'] = `Bearer ${process.env.GITHUB_API_TOKEN}`;
            }

            https.get(url, { headers }, (res) => {
                let raw = '';
                res.on('data', chunk => { raw += chunk; });
                res.on('end', () => {
                    if (res.statusCode !== 200) {
                        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
                    }
                    try { resolve(JSON.parse(raw)); } catch { resolve(raw); }
                });
            }).on('error', reject);
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GitHub Discovery
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Gibt die verfügbaren Repositories zurück.
     * @returns {Array<{ id, name }>}
     */
    getRepositories() {
        return Object.entries(this.repositories).map(([id, name]) => ({ id, name }));
    }

    /**
     * Listet alle Eggs eines Repository auf.
     * Nutzt GitHub Tree API (ein Request statt vieler).
     *
     * @param {string} repo  — z.B. 'games-steamcmd'
     * @returns {Promise<Array<{ name, displayName, downloadUrl }>>}
     */
    async listEggs(repo) {
        const repoPath = `pelican-eggs/${repo}`;

        Logger.info(`[EggImporter] Liste Eggs für: ${repoPath}`);

        const branch = await this._fetch(
            `${this.githubApiBase}/repos/${repoPath}/branches/main`
        );
        if (!branch?.commit?.sha) {
            throw new Error(`Kein main-Branch in ${repoPath}`);
        }

        const tree = await this._fetch(
            `${this.githubApiBase}/repos/${repoPath}/git/trees/${branch.commit.sha}?recursive=1`
        );
        if (!Array.isArray(tree?.tree)) {
            throw new Error(`Kein Tree-Ergebnis für ${repoPath}`);
        }

        const seen = new Set();
        const eggs = [];

        for (const item of tree.tree) {
            if (item.type !== 'blob') continue;
            if (!item.path.endsWith('.json')) continue;

            const parts = item.path.split('/');
            // Wir erwarten: folder/[subfolder/]egg-name.json
            const filename = parts[parts.length - 1];
            if (!filename.startsWith('egg-')) continue;

            // Eindeutiger Key = Pfad ohne Dateiname (z.B. "valheim/valheim_vanilla")
            const folderKey = parts.slice(0, -1).join('/');
            if (seen.has(folderKey)) continue;
            seen.add(folderKey);

            eggs.push({
                name:        folderKey,
                displayName: this._toDisplayName(parts[parts.length - 2] || folderKey),
                downloadUrl: `${this.githubRawBase}/${repoPath}/main/${item.path}`,
            });
        }

        Logger.info(`[EggImporter] ${eggs.length} Eggs gefunden in ${repo}`);
        return eggs;
    }

    /**
     * Lädt ein einzelnes Egg von einer direkten URL (aus DB-Cache oder listEggs).
     * @param {string} url — raw.githubusercontent.com URL
     * @returns {Promise<object>} — Pelican Egg JSON (PTDL_v2)
     */
    async fetchEgg(url) {
        Logger.info(`[EggImporter] Lade Egg von: ${url}`);
        const data = await this._fetch(url);
        if (typeof data !== 'object' || !data.startup) {
            throw new Error('Ungültiges Egg-Format — kein startup-Feld vorhanden');
        }
        return data;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Konvertierung PTDL_v2 → FIREBOT_v2
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Konvertiert ein Pelican Egg (PTDL_v2) in das FIREBOT_v2 game_data Format.
     *
     * Keine Script-Generierung, keine Übersetzung — das Egg bleibt Source of Truth.
     * Das Installation-Script wird 1:1 übernommen (Pfad /mnt/server ist Container-Standard).
     *
     * @param {object} egg  — Pelican Egg JSON
     * @returns {object}     — FIREBOT_v2 game_data
     */
    convert(egg) {
        if (!egg || typeof egg !== 'object') {
            throw new Error('egg muss ein Objekt sein');
        }

        const gameData = {
            meta: {
                version:     'FIREBOT_v2',
                name:        egg.name        || 'Importiertes Egg',
                author:      egg.author      || 'Pelican Community',
                description: egg.description || '',
            },

            // Welche Docker-Images stehen zur Auswahl
            // Format: { "image:tag": "Anzeigename" }
            docker_images: this._normalizeDockerImages(egg.docker_images),

            // Startup-Command im Pelican-Format: {{VARNAME}} Platzhalter
            startup: {
                command: egg.startup                          || '',
                done:    egg.config?.startup?.done           || '',
                stop:    egg.config?.stop                    || 'stop',
            },

            // Config-Datei-Parser (INI, File, JSON, XML)
            config: {
                files: egg.config?.files  || {},
                logs:  egg.config?.logs   || [],
            },

            // Installation: Container + Script direkt aus Egg
            scripts: {
                installation: {
                    container:   egg.scripts?.installation?.container   || '',
                    entrypoint:  egg.scripts?.installation?.entrypoint  || 'bash',
                    script:      egg.scripts?.installation?.script      || '',
                },
            },

            // Variablen: Pelican-Format direkt übernehmen, fehlende Felder ergänzen
            variables: this._normalizeVariables(egg.variables),

            // Templates: leer bei Import — User kann sie danach hinzufügen
            templates: [],
        };

        Logger.info(`[EggImporter] Konvertiert: ${gameData.meta.name}`);
        return gameData;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Hilfsmethoden
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Normalisiert docker_images aus dem Egg.
     * Pelican nutzt beide Formate:
     *   - Objekt: { "image:tag": "Label" }
     *   - Array:  [{ image: "...", display: "..." }]
     *   - String: (altes Format) → wird in Objekt gewrappt
     *
     * @param {object|Array|string} raw
     * @returns {{ [imageTag: string]: string }}
     */
    _normalizeDockerImages(raw) {
        if (!raw) return {};

        if (typeof raw === 'string') {
            return { [raw]: raw };
        }

        if (Array.isArray(raw)) {
            const result = {};
            for (const entry of raw) {
                if (typeof entry === 'string') {
                    result[entry] = entry;
                } else if (entry?.image) {
                    result[entry.image] = entry.display || entry.image;
                }
            }
            return result;
        }

        if (typeof raw === 'object') {
            // Bereits korrektes Format
            return raw;
        }

        return {};
    }

    /**
     * Normalisiert variables[].
     * Stellt sicher dass alle Pflichtfelder vorhanden sind.
     * Entfernt Pelican-interne Variablen die der Daemon selbst verwaltet.
     *
     * @param {Array} raw
     * @returns {Array}
     */
    _normalizeVariables(raw) {
        if (!Array.isArray(raw)) return [];

        // Diese werden vom Daemon/Docker injiziert — nicht ans Frontend geben
        const daemonManaged = new Set([
            'SERVER_IP', 'SERVER_PORT', 'P_SERVER_UUID',
            'P_SERVER_ALLOCATION', 'STARTUP', 'TZ',
        ]);

        return raw
            .filter(v => v?.env_variable && !daemonManaged.has(v.env_variable))
            .map(v => ({
                name:          v.name          || v.env_variable,
                env_variable:  v.env_variable,
                default_value: v.default_value ?? '',
                description:   v.description   || '',
                user_viewable: v.user_viewable  !== false,
                user_editable: v.user_editable  !== false,
                rules:         v.rules          || 'nullable|string',
                field_type:    this._inferFieldType(v),
            }));
    }

    /**
     * Leitet den UI-Feldtyp aus den Pelican Variable-Regeln ab.
     * Pelican hat kein field_type — wir leiten es aus rules ab.
     *
     * @param {object} v  — Pelican variable
     * @returns {string}  — 'text' | 'number' | 'boolean' | 'password' | 'select'
     */
    _inferFieldType(v) {
        const rules = (v.rules || '').toLowerCase();
        if (rules.includes('integer') || rules.includes('numeric')) return 'number';
        if (rules.includes('boolean'))                              return 'boolean';
        if (v.env_variable?.toLowerCase().includes('password'))     return 'password';
        if (rules.includes('in:'))                                  return 'select';
        return 'text';
    }

    /**
     * Ordnername → hübscher Anzeigename.
     * "valheim_vanilla" → "Valheim Vanilla"
     */
    _toDisplayName(name) {
        return (name || '')
            .replace(/[-_]/g, ' ')
            .replace(/\b\w/g, c => c.toUpperCase());
    }
}

module.exports = EggImporter;
