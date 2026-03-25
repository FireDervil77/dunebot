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

    // ─────────────────────────────────────────────────────────────────────────
    // Statische Game-Datenbank: Port-Definitionen + Query-Konfiguration
    // Wird beim Import automatisch in game_data.ports + game_data.query übernommen.
    // Key = lowercase Suchbegriff der im Egg-Namen gesucht wird.
    // ─────────────────────────────────────────────────────────────────────────
    static GAME_PORT_QUERY_DB = {
        'valheim': {
            ports: { game: { default: 2456, protocol: 'udp' } },
            query: { gamedig_type: 'valheim', port_var: 'game_plus_1' }
        },
        '7 days to die': {
            ports: { game: { default: 26900, protocol: 'udp' } },
            query: { gamedig_type: '7d2d', port_var: 'game' }
        },
        'counter-strike 2': {
            ports: { game: { default: 27015, protocol: 'both' } },
            query: { gamedig_type: 'cs2', port_var: 'game' }
        },
        'enshrouded': {
            ports: { game: { default: 15636, protocol: 'udp' } },
            query: { gamedig_type: 'enshrouded', port_var: 'game_plus_1' }
        },
        'palworld': {
            ports: {
                game:  { default: 8211,  protocol: 'udp' },
                query: { default: 27015, protocol: 'udp' }
            },
            query: { gamedig_type: 'palworld', port_var: 'query' }
        },
        'satisfactory': {
            ports: {
                game:    { default: 7777,  protocol: 'udp' },
                beacon:  { default: 15000, protocol: 'udp' },
                query:   { default: 15777, protocol: 'udp' }
            },
            query: { gamedig_type: 'satisfactory', port_var: 'query' }
        },
        'core keeper': {
            ports: { game: { default: 27015, protocol: 'udp' } },
            query: { gamedig_type: 'corekeeper', port_var: 'game_plus_1' }
        },
        'astroneer': {
            ports: { game: { default: 8777, protocol: 'udp' } },
            query: null
        },
        'foundry': {
            ports: { game: { default: 3724, protocol: 'udp' } },
            query: null
        },
        // Weitere Spiele hier ergänzen …
        'rust': {
            ports: { game: { default: 28015, protocol: 'udp' } },
            query: { gamedig_type: 'rust', port_var: 'game' }
        },
        'ark: survival evolved': {
            ports: {
                game:  { default: 7777, protocol: 'udp' },
                query: { default: 27015, protocol: 'udp' }
            },
            query: { gamedig_type: 'arkse', port_var: 'query' }
        },
        'minecraft': {
            ports: { game: { default: 25565, protocol: 'tcp' } },
            query: { gamedig_type: 'minecraft', port_var: 'game' }
        },
        'terraria': {
            ports: { game: { default: 7777, protocol: 'tcp' } },
            query: { gamedig_type: 'terraria', port_var: 'game' }
        },
        'team fortress 2': {
            ports: { game: { default: 27015, protocol: 'both' } },
            query: { gamedig_type: 'tf2', port_var: 'game' }
        },
        'garry\'s mod': {
            ports: { game: { default: 27015, protocol: 'both' } },
            query: { gamedig_type: 'garrysmod', port_var: 'game' }
        },
    };

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
            // {{server.build.*}} Variablen werden auf unsere ENV-Variablen umgemappt
            startup: {
                command: this._remapPterodactylVariable(egg.startup || ''),
                done:    egg.config?.startup?.done           || '',
                stop:    egg.config?.stop                    || 'stop',
            },

            // Config-Datei-Parser (INI, File, JSON, XML)
            // {{server.build.*}} Variablen werden auf unsere ENV-Variablen umgemappt
            config: {
                files: this._normalizeConfigFiles(egg.config?.files || {}),
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

            // Port-Definitionen: aus statischer Game-DB oder Fallback
            ports: this._resolvePortConfig(egg),

            // Query-Konfiguration: GameDig-Typ + Port-Variable
            query: this._resolveQueryConfig(egg),

            // File-Denylist: Dateien die im File-Manager nicht sichtbar/editierbar sind
            // Aus Pelican-Egg übernehmen + Standard-Schutz ergänzen
            file_denylist: this._normalizeFileDenylist(egg.file_denylist),

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

        // Wirklich Wings/Pelican-interne Vars — für uns bedeutungslos, rausfiltern
        const wingsInternalOnly = new Set([
            'P_SERVER_UUID',      // Wings Allocation-UUID
            'P_SERVER_ALLOCATION', // Wings Allocation-Objekt
            'STARTUP',            // Wings erzeugt das selbst aus Invocation
        ]);

        // Diese Vars werden beim Server-Erstellen automatisch auf echte Werte gemappt
        // (SERVER_PORT → allokierter Port, SERVER_IP → 0.0.0.0, TZ → UTC)
        const daemonAutoAssign = new Set(['SERVER_IP', 'SERVER_PORT', 'TZ']);

        return raw
            .filter(v => v?.env_variable && !wingsInternalOnly.has(v.env_variable))
            .map(v => ({
                name:              v.name          || v.env_variable,
                env_variable:      v.env_variable,
                default_value:     v.default_value ?? '',
                description:       v.description   || '',
                user_viewable:     v.user_viewable  !== false,
                // daemon_auto_assign-Vars sind read-only: werden beim Erstellen überschrieben
                user_editable:     daemonAutoAssign.has(v.env_variable) ? false : (v.user_editable !== false),
                rules:             v.rules          || 'nullable|string',
                field_type:        this._inferFieldType(v),
                daemon_auto_assign: daemonAutoAssign.has(v.env_variable) || false,
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
        // Pelican-Eggs liefern rules als Array (z.B. ["boolean", "required"])
        // ältere Eggs als Pipe-String (z.B. "required|boolean")
        const rules = Array.isArray(v.rules)
            ? v.rules.join('|').toLowerCase()
            : (v.rules || '').toLowerCase();
        if (rules.includes('integer') || rules.includes('numeric')) return 'number';
        if (rules.includes('boolean'))                              return 'boolean';
        if (v.env_variable?.toLowerCase().includes('password'))     return 'password';
        if (rules.includes('in:'))                                  return 'select';
        return 'text';
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Pterodactyl → FIREBOT Variable-Remapping
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Normalisiert config.files aus dem Egg.
     * Mappt {{server.build.*}} Pterodactyl-Variablen auf unsere ENV-Variablen.
     *
     * Pterodactyl-Eggs nutzen in config.files Werte wie:
     *   {{server.build.default.port}} → {{SERVER_PORT}}
     *   {{server.build.default.ip}}   → {{SERVER_IP}}
     *   {{server.build.env.MOTD}}     → {{MOTD}}
     *   {{server.build.memory}}       → {{SERVER_MEMORY}}
     *
     * Unser System nutzt nur {{ENV_VARIABLE}} Format.
     *
     * @param {object} configFiles — config.files Objekt aus Egg
     * @returns {object} — Normalisiertes config.files mit umgemappten Variablen
     */
    _normalizeConfigFiles(configFiles) {
        if (!configFiles || typeof configFiles !== 'object') return {};

        const result = {};

        for (const [filePath, entry] of Object.entries(configFiles)) {
            // Auch der Dateipfad kann Variablen enthalten (z.B. Rust: server/{{SERVER_IDENTITY}}/cfg/server.cfg)
            const normalizedPath = this._remapPterodactylVariable(filePath);

            if (!entry || typeof entry !== 'object') {
                result[normalizedPath] = entry;
                continue;
            }

            result[normalizedPath] = {
                parser: entry.parser || 'file',
                find: this._remapFindValues(entry.find),
            };
        }

        return result;
    }

    /**
     * Remappt {{server.build.*}} Variablen in allen Find-Values (rekursiv für nested Objekte).
     *
     * @param {object} find — Find-Objekt aus config.files Entry
     * @returns {object} — Find-Objekt mit umgemappten Variablen
     */
    _remapFindValues(find) {
        if (!find || typeof find !== 'object') return find || {};

        const result = {};
        for (const [key, value] of Object.entries(find)) {
            if (typeof value === 'string') {
                result[key] = this._remapPterodactylVariable(value);
            } else if (typeof value === 'object' && value !== null) {
                // Rekursiv für nested Objekte (z.B. INI-Sections)
                result[key] = this._remapFindValues(value);
            } else {
                result[key] = value;
            }
        }
        return result;
    }

    /**
     * Ersetzt Pterodactyl-spezifische {{server.build.*}} Platzhalter
     * mit unseren Standard-ENV-Variablen {{VARIABLE}}.
     *
     * Mapping:
     *   {{server.build.default.port}}  → {{SERVER_PORT}}
     *   {{server.build.default.ip}}    → {{SERVER_IP}}
     *   {{server.build.env.VARIABLE}}  → {{VARIABLE}}
     *   {{server.build.memory}}        → {{SERVER_MEMORY}}
     *   {{server.build.allocations.*}} → {{SERVER_PORT}} (Fallback)
     *
     * @param {string} value — String mit möglichen Pterodactyl-Variablen
     * @returns {string} — String mit umgemappten Variablen
     */
    _remapPterodactylVariable(value) {
        if (typeof value !== 'string') return value;

        return value
            // {{server.build.env.VARIABLE}} → {{VARIABLE}}
            .replace(/\{\{server\.build\.env\.([^}]+)\}\}/gi, '{{$1}}')
            // {{server.build.default.port}} → {{SERVER_PORT}}
            .replace(/\{\{server\.build\.default\.port\}\}/gi, '{{SERVER_PORT}}')
            // {{server.build.default.ip}} → {{SERVER_IP}}
            .replace(/\{\{server\.build\.default\.ip\}\}/gi, '{{SERVER_IP}}')
            // {{server.build.memory}} → {{SERVER_MEMORY}}
            .replace(/\{\{server\.build\.memory\}\}/gi, '{{SERVER_MEMORY}}')
            // {{server.build.allocations.default.port}} → {{SERVER_PORT}} (Alias)
            .replace(/\{\{server\.build\.allocations\.[^}]*\.port\}\}/gi, '{{SERVER_PORT}}')
            // {{server.build.allocations.default.ip}} → {{SERVER_IP}} (Alias)
            .replace(/\{\{server\.build\.allocations\.[^}]*\.ip\}\}/gi, '{{SERVER_IP}}');
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

    // ─────────────────────────────────────────────────────────────────────────
    // Port- & Query-Auflösung aus GAME_PORT_QUERY_DB
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Sucht die passende Game-Config aus GAME_PORT_QUERY_DB anhand des Egg-Namens.
     * Versucht: exakter Match → enthält-Match (beides case-insensitive).
     *
     * @param {string} eggName — z.B. "Valheim", "Palworld Proton", "Counter-Strike 2"
     * @returns {object|null} — { ports, query } oder null
     */
    _findGameConfig(eggName) {
        if (!eggName) return null;
        const nameLower = eggName.toLowerCase();

        // 1. Exakter Match
        if (EggImporter.GAME_PORT_QUERY_DB[nameLower]) {
            return EggImporter.GAME_PORT_QUERY_DB[nameLower];
        }

        // 2. Enthält-Match: "palworld" findet "Palworld Proton"
        for (const [key, config] of Object.entries(EggImporter.GAME_PORT_QUERY_DB)) {
            if (nameLower.includes(key) || key.includes(nameLower)) {
                return config;
            }
        }

        return null;
    }

    /**
     * Ermittelt die Port-Konfiguration für ein Egg.
     * Nutzt GAME_PORT_QUERY_DB oder fällt auf einen generischen Game-Port zurück.
     *
     * @param {object} egg — Pelican Egg JSON
     * @returns {object} — z.B. { game: { default: 2456, protocol: 'udp' } }
     */
    _resolvePortConfig(egg) {
        const config = this._findGameConfig(egg.name);
        if (config?.ports) {
            Logger.info(`[EggImporter] Port-Config für '${egg.name}' aus Game-DB geladen`);
            return config.ports;
        }

        // Fallback: generischer Game-Port
        Logger.info(`[EggImporter] Kein Port-Eintrag für '${egg.name}' — nutze Default 27015/udp`);
        return { game: { default: 27015, protocol: 'udp' } };
    }

    /**
     * Ermittelt die Query-Konfiguration (GameDig) für ein Egg.
     * 1. Statische GAME_PORT_QUERY_DB
     * 2. Fallback: Automatische Erkennung via GameDig-Spieledatenbank
     *
     * @param {object} egg — Pelican Egg JSON
     * @returns {object|null} — z.B. { gamedig_type: 'valheim', port_var: 'game_plus_1' } oder null
     */
    _resolveQueryConfig(egg) {
        const config = this._findGameConfig(egg.name);
        if (config?.query) {
            Logger.info(`[EggImporter] Query-Config für '${egg.name}' aus Game-DB geladen: ${config.query.gamedig_type}`);
            return config.query;
        }

        // Fallback: GameDig-Spieledatenbank durchsuchen
        const autoQuery = this._autoDetectGameDig(egg.name);
        if (autoQuery) {
            Logger.info(`[EggImporter] Query-Config für '${egg.name}' automatisch erkannt: ${autoQuery.gamedig_type} (port_var: ${autoQuery.port_var})`);
            return autoQuery;
        }

        Logger.info(`[EggImporter] Kein Query-Support für '${egg.name}'`);
        return null;
    }

    /**
     * Versucht den Egg-Namen gegen die GameDig-Spieledatenbank zu matchen.
     * Leitet gamedig_type und port_var automatisch ab.
     *
     * @param {string} eggName
     * @returns {object|null}
     */
    _autoDetectGameDig(eggName) {
        try {
            const gamedig = require('gamedig');
            const games = gamedig.games;
            if (!games || !eggName) return null;

            const nameLower = eggName.toLowerCase().trim();

            // Suche: Exakter Name-Match, dann enthält-Match (min. 4 Zeichen für Teilmatch)
            let matchKey = null;
            let bestScore = 0;
            for (const [key, game] of Object.entries(games)) {
                const gdName = (game.name || '').toLowerCase();
                if (gdName === nameLower) {
                    matchKey = key;
                    break; // Exakter Match — sofort nehmen
                }
                // Enthält-Match: nur wenn der Game-Name lang genug ist (min. 4 Zeichen)
                if (gdName.length >= 4 && nameLower.includes(gdName) && gdName.length > bestScore) {
                    matchKey = key;
                    bestScore = gdName.length; // Längster Match gewinnt
                }
                if (nameLower.length >= 4 && gdName.includes(nameLower) && nameLower.length > bestScore) {
                    matchKey = key;
                    bestScore = nameLower.length;
                }
            }

            // Fallback: Key-Match (z.B. "rust", "valheim")
            if (!matchKey) {
                const nameWords = nameLower.replace(/[^a-z0-9 ]/g, '').split(/\s+/);
                for (const word of nameWords) {
                    if (word.length >= 3 && games[word]) {
                        matchKey = word;
                        break;
                    }
                }
            }

            if (!matchKey) return null;

            const game = games[matchKey];
            const opts = game.options || {};

            // port_var bestimmen — offset kann ein Array sein (z.B. [1, 15]), dann erstes nehmen
            let offset = opts.port_query_offset;
            if (Array.isArray(offset)) offset = offset[0];

            let portVar = 'game';
            if (offset === 1) {
                portVar = 'game_plus_1';
            } else if (offset && offset !== 0) {
                portVar = `game_plus_${offset}`;
            }
            // Separater fester Query-Port → port_var bleibt 'game' (GameDig handhabt den Offset intern)

            return {
                gamedig_type: matchKey,
                port_var: portVar
            };
        } catch {
            return null;
        }
    }

    /**
     * Normalisiert die File-Denylist aus einem Pelican/Pterodactyl Egg.
     * Pelican nutzt `file_denylist` als Array von Pfad-Patterns.
     * Ergänzt Standard-Schutz-Einträge falls nicht vorhanden.
     *
     * @param {string[]|null} raw — Denylist aus dem Egg
     * @returns {string[]}
     */
    _normalizeFileDenylist(raw) {
        const defaults = ['.env', 'start.sh', 'firebot.lock', 'firebot.pid'];
        const list = new Set(defaults);

        if (Array.isArray(raw)) {
            for (const entry of raw) {
                if (typeof entry === 'string' && entry.trim()) {
                    list.add(entry.trim());
                }
            }
        }

        return [...list];
    }
}

module.exports = EggImporter;
