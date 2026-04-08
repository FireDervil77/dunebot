/**
 * LinuxGSM (LGSM) Importer
 *
 * Importiert Gameserver-Konfigurationen aus dem LinuxGSM GitHub Repository
 * und konvertiert sie ins FireBot-Addon-Format (FIREBOT_v1).
 *
 * Datenquellen:
 *   lgsm/data/*.cfg          → pro-Spiel Konfiguration (gamename, steamappid, appid, glibc, ports)
 *   lgsm/data/ubuntu-22.04.csv → Paket-Abhängigkeiten pro Shortname
 *
 * Konvertierungs-Modi:
 *   Modus A (isSteam=true):  Steam App-ID bekannt → Standard-SteamCMD Script generieren. Direkt lauffähig.
 *   Modus B (isSteam=false): Kein Steam → Platzhalter-Script. needsReview=true, status='draft'.
 *
 * @author FireDervil + GitHub Copilot
 * @version 1.0.0
 */

const https = require('https');
const Logger = require('dunebot-core').ServiceManager.get('Logger');

// Kategorie-Mapping: LGSM gametype → unser ENUM
const CATEGORY_MAP = {
    'fps':        'fps',
    'survival':   'survival',
    'sandbox':    'sandbox',
    'mmorpg':     'mmorpg',
    'racing':     'racing',
    'strategy':   'strategy',
    'horror':     'horror',
    'scifi':      'scifi',
    'minecraft':  'sandbox',
    'source':     'fps',
    'goldsrc':    'fps',
    'rpg':        'mmorpg',
};

class LGSMImporter {
    constructor() {
        this.githubApiBase  = 'https://api.github.com';
        this.githubRawBase  = 'https://raw.githubusercontent.com';
        this.repoName       = 'GameServerManagers/LinuxGSM';
        this.branch         = 'master';

        // In-memory Caches (Lebensdauer: ca. 1h pro Prozess-Uptime)
        this._gameListCache = null;
        this._depsCache     = null;
    }

    // ══════════════════════════════════════════════════════════════════════════
    // PUBLIC API
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * Gibt die Liste aller verfügbaren LGSM-Games zurück.
     * Liest Shortnames aus ubuntu-22.04.csv — kein GitHub Contents API nötig,
     * kein Rate-Limit-Problem.
     *
     * @returns {Promise<Array<{shortname: string, displayName: string}>>}
     */
    async fetchGamesList() {
        if (this._gameListCache) return this._gameListCache;

        Logger.info('[LGSMImporter] Lade Spieleliste aus ubuntu-22.04.csv...');

        const depsMap = await this._getDepsCSV();

        const SKIP = new Set(['all', 'steamcmd']);
        const games = [];
        for (const shortname of depsMap.keys()) {
            if (SKIP.has(shortname)) continue;
            games.push({
                shortname,
                displayName: this._formatDisplayName(shortname),
            });
        }
        games.sort((a, b) => a.displayName.localeCompare(b.displayName));

        Logger.info(`[LGSMImporter] ${games.length} LGSM-Games gefunden`);
        this._gameListCache = games;
        return games;
    }

    /**
     * Lädt und konvertiert die Konfiguration eines einzelnen LGSM-Games.
     *
     * @param {string} shortname  z.B. 'vh', 'rust', 'cs2' (wie in ubuntu-22.04.csv)
     * @returns {Promise<{gameData: object, isSteam: boolean, needsReview: boolean, steamAppId: string|null}>}
     */
    async fetchAndConvert(shortname) {
        // Input-Validierung: nur sichere Zeichen erlaubt
        if (!/^[a-z0-9_-]{2,30}$/.test(shortname)) {
            throw new Error(`Ungültiger LGSM Shortname: ${shortname}`);
        }

        Logger.info(`[LGSMImporter] Lade + konvertiere: ${shortname}`);

        const [config, deps] = await Promise.all([
            this._fetchGameConfig(shortname),
            this._fetchDependencies(shortname),
        ]);

        return this.convertToOurFormat(shortname, config, deps);
    }

    /**
     * Konvertiere geparste LGSM-Daten → FireBot Addon Format (FIREBOT_v1).
     * Kann auch direkt genutzt werden wenn config/deps bereits vorliegen.
     *
     * @param {string}   shortname
     * @param {object}   config  Ergebnis von _parseBashCFG()
     * @param {string[]} deps    System-Paket-Liste
     * @returns {{ gameData, isSteam, needsReview, steamAppId }}
     */
    convertToOurFormat(shortname, config, deps) {
        const gameName    = config.gamename || this._formatDisplayName(shortname);
        const steamAppId  = config.steamappid  || null;  // Client-AppID (z.B. 892970)
        const serverAppId = config.appid       || steamAppId;  // Server-AppID (z.B. 896660)

        const isSteam    = !!(serverAppId);
        const needsReview = !isSteam;

        // Standard SteamCMD-Script wenn Steam-AppID bekannt, sonst Platzhalter
        const installScript = isSteam
            ? this._generateSteamCMDScript(serverAppId)
            : '#!/bin/bash\n# TODO: Install-Script manuell erstellen\n# Keine Steam-AppID in LGSM-Konfiguration gefunden.\n';

        // Kategorie aus gametype-Feld ableiten (meist nicht in .cfg, daher 'other' als Fallback)
        const category = CATEGORY_MAP[config.gametype?.toLowerCase()] || 'other';

        // Ports
        const gamePort  = parseInt(config.port || '27015', 10);
        const queryPort = parseInt(config.queryport || String(gamePort + 1), 10);

        const ports = {
            game: {
                default:     gamePort,
                protocol:    'udp',
                description: 'Game Port',
            },
        };
        if (queryPort && queryPort !== gamePort) {
            ports.query = {
                default:     queryPort,
                protocol:    'udp',
                description: 'Query Port (Steam Browser)',
            };
        }
        if (config.rconport) {
            ports.rcon = {
                default:     parseInt(config.rconport, 10),
                protocol:    'tcp',
                description: 'RCON Port',
            };
        }

        const gameData = {
            meta: {
                version:          'FIREBOT_v1',
                source:           'lgsm',
                needs_review:     needsReview,
                name:             gameName,
                author:           'LinuxGSM Community',
                description:      `${gameName} Dedicated Server (importiert via LinuxGSM)`,
                lgsm_shortname:   shortname,
                glibc_required:   config.glibc || null,
            },
            steam: isSteam ? {
                app_id:        steamAppId  ? parseInt(steamAppId)  : null,
                server_app_id: serverAppId ? parseInt(serverAppId) : null,
            } : null,
            installation: {
                method:         isSteam ? 'steamcmd' : 'custom',
                app_id:         serverAppId || null,
                validate:       true,
                script_content: installScript,
                dependencies:   deps,
            },
            startup: {
                command:     `./${shortname}`,
                stop_signal: 'SIGTERM',
                done:        config.startedmessage || '',
            },
            config: {
                files: {},
                logs:  {},
            },
            variables: this._buildDefaultVariables(config),
            ports,
            requirements: {
                glibc:      config.glibc || null,
                ram_min_mb: null,  // LGSM CFG enthält kein RAM-Minimum
            },
        };

        Logger.info(`[LGSMImporter] Konvertierung abgeschlossen: ${gameName} (isSteam=${isSteam}, appId=${serverAppId})`);

        return { gameData, isSteam, needsReview, steamAppId: serverAppId || steamAppId, category };
    }

    // ══════════════════════════════════════════════════════════════════════════
    // PRIVATE: Daten laden
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * Lädt und parsed die .cfg-Datei eines LGSM-Games.
     * @param {string} shortname
     * @returns {Promise<object>}
     */
    async _fetchGameConfig(shortname) {
        // CSV-Shortnames (ck, vh, rust) → Repo-Verzeichnis immer shortname + "server"
        const dir  = `${shortname}server`;
        const url  = `${this.githubRawBase}/${this.repoName}/${this.branch}/lgsm/config-default/config-lgsm/${dir}/_default.cfg`;
        Logger.debug(`[LGSMImporter] Lade CFG: ${url}`);

        const raw = await this._fetch(url);
        if (typeof raw !== 'string') {
            throw new Error(`LGSM: Konfigurationsdatei für '${shortname}' konnte nicht geladen werden`);
        }
        return this._parseBashCFG(raw);
    }

    /**
     * Ermittelt System-Abhängigkeiten eines LGSM-Games aus ubuntu-22.04.csv.
     * Kombiniert 'steamcmd' Basis-Deps mit spielspezifischen Deps.
     * @param {string} shortname  z.B. 'vhserver'
     * @returns {Promise<string[]>}
     */
    async _fetchDependencies(shortname) {
        let depsMap;
        try {
            depsMap = await this._getDepsCSV();
        } catch (err) {
            Logger.warn(`[LGSMImporter] Deps-CSV nicht ladbar: ${err.message}. Verwende SteamCMD-Defaults.`);
            return ['lib32gcc-s1', 'lib32stdc++6'];
        }

        // SteamCMD-Basis-Pakete (immer nötig für Steam-Games)
        const steamcmdDeps = depsMap.get('steamcmd') || [];

        // Spielspezifisch: versuche verschiedene Schlüssel-Varianten
        // 'vhserver' → 'vhserver', 'vh', 'valheim' (letzteres zur Not)
        const gameKey   = shortname;
        const shortKey  = shortname.replace(/server$/, '');  // 'vhserver' → 'vh'

        const gameDeps = depsMap.get(gameKey) || depsMap.get(shortKey) || [];

        return [...new Set([...steamcmdDeps, ...gameDeps])];
    }

    /**
     * Lädt und cached ubuntu-22.04.csv als Map<shortname, string[]>.
     */
    async _getDepsCSV() {
        if (this._depsCache) return this._depsCache;

        const url = `${this.githubRawBase}/${this.repoName}/${this.branch}/lgsm/data/ubuntu-22.04.csv`;
        Logger.debug('[LGSMImporter] Lade ubuntu-22.04.csv...');

        const raw = await this._fetch(url);
        if (typeof raw !== 'string') {
            throw new Error('LGSM: ubuntu-22.04.csv ist nicht als Text ladbar');
        }

        const map = new Map();
        for (const line of raw.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const parts = trimmed.split(',');
            if (parts.length >= 2) {
                const key  = parts[0].trim();
                const pkgs = parts.slice(1).map(p => p.trim()).filter(Boolean);
                map.set(key, pkgs);
            }
        }

        Logger.debug(`[LGSMImporter] ubuntu-22.04.csv: ${map.size} Einträge geladen`);
        this._depsCache = map;
        return map;
    }

    // ══════════════════════════════════════════════════════════════════════════
    // PRIVATE: Parsing & Generierung
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * Parst eine bash-style .cfg-Datei (key="value" oder key=value Zeilen).
     * @param {string} content
     * @returns {object}
     */
    _parseBashCFG(content) {
        const result = {};
        for (const line of content.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;

            // Unterstützte Formate:
            // key="value"  key='value'  key=value  key="${variable}"
            const match = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_]*)=["']?([^"'\n]*)["']?\s*(?:#.*)?$/);
            if (match) {
                // Variablen-Referenzen (${HOME} etc.) als Leer-String behandeln
                const val = match[2].replace(/\$\{[^}]+\}/g, '').trim();
                result[match[1]] = val;
            }
        }
        return result;
    }

    /**
     * Generiert ein standardisiertes SteamCMD Install-Script (LGSM-Modus A).
     */
    _generateSteamCMDScript(appId) {
        return `#!/bin/bash
# FireBot Standard SteamCMD Install Script (LGSM-Quelle)
# Automatisch generiert – AppID: ${appId}

# HOME korrekt setzen (verhindert Steam/.config Fehler)
export HOME=$(getent passwd "$(whoami)" | cut -d: -f6)

# SteamCMD bootstrappen falls nicht vorhanden
if [[ ! -f "\${STEAMCMD}" ]]; then
    echo "SteamCMD nicht gefunden – wird installiert..."
    mkdir -p "\${STEAMCMD_DIR}"
    cd "\${STEAMCMD_DIR}"
    curl -sqL "https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz" | tar zxvf -
    if [[ ! -f "\${STEAMCMD_DIR}/steamcmd.sh" ]]; then
        echo "FEHLER: SteamCMD Download fehlgeschlagen."
        exit 1
    fi
    echo "SteamCMD erfolgreich installiert."
fi

echo "Starte SteamCMD Download für AppID ${appId}..."
"\${STEAMCMD}" \\
    +force_install_dir "\${INSTALL_DIR}" \\
    +login anonymous \\
    +app_update ${appId} validate \\
    +quit

echo "Installation abgeschlossen."
`;
    }

    /**
     * Baut sinnvolle Default-Variablen aus der LGSM-Config.
     */
    _buildDefaultVariables(config) {
        const vars = [];

        vars.push({
            name:          'Server Name',
            env_variable:  'SERVER_NAME',
            default_value: config.servername || 'FireBot Server',
            description:   'Anzeige-Name des Servers',
            user_viewable: true,
            user_editable: true,
            rules:         'required|string|max:100',
            field_type:    'text',
        });

        if (config.maxplayers) {
            vars.push({
                name:          'Max Players',
                env_variable:  'MAX_PLAYERS',
                default_value: config.maxplayers,
                description:   'Maximale Spieler-Anzahl',
                user_viewable: true,
                user_editable: true,
                rules:         'required|integer|min:1|max:999',
                field_type:    'text',
            });
        }

        if (config.serverpassword !== undefined) {
            vars.push({
                name:          'Server Password',
                env_variable:  'SERVER_PASSWORD',
                default_value: '',
                description:   'Passwort zum Betreten (leer = kein Passwort)',
                user_viewable: true,
                user_editable: true,
                rules:         'nullable|string|max:64',
                field_type:    'password',
            });
        }

        return vars;
    }

    /**
     * Formatiert Shortname → lesbaren Display-Namen.
     * 'vhserver' → 'Vh Server'  (wird im UI noch durch cfg.gamename ersetzt)
     */
    _formatDisplayName(shortname) {
        return shortname
            .replace(/server$/i, ' Server')
            .replace(/[-_]/g, ' ')
            .trim()
            .split(' ')
            .map(w => w ? w.charAt(0).toUpperCase() + w.slice(1) : '')
            .join(' ')
            .trim() || shortname;
    }

    // ══════════════════════════════════════════════════════════════════════════
    // PRIVATE: HTTP
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * Einfacher HTTPS-GET-Wrapper. Parst JSON automatisch, liefert sonst String.
     */
    async _fetch(url) {
        return new Promise((resolve, reject) => {
            const headers = {
                'User-Agent': 'FireBot-LGSM-Importer/1.0',
            };
            if (process.env.GITHUB_API_TOKEN) {
                headers['Authorization'] = `Bearer ${process.env.GITHUB_API_TOKEN}`;
            }

            const req = https.get(url, { headers }, (res) => {
                // Folge Redirects (302, 301)
                if (res.statusCode === 301 || res.statusCode === 302) {
                    return resolve(this._fetch(res.headers.location));
                }

                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    if (res.statusCode !== 200) {
                        return reject(new Error(`HTTP ${res.statusCode} für ${url}`));
                    }
                    try {
                        resolve(JSON.parse(data));
                    } catch {
                        resolve(data); // Kein JSON → Raw String zurückgeben
                    }
                });
            });
            req.on('error', reject);
            req.setTimeout(15000, () => {
                req.destroy();
                reject(new Error(`Timeout (15s) für ${url}`));
            });
        });
    }
}

module.exports = LGSMImporter;
