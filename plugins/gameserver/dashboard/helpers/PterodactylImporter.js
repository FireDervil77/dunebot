/**
 * Pterodactyl Egg Importer
 *
 * Importiert Eggs aus dem Pelican-Eggs GitHub Repository und konvertiert
 * sie ins FireBot-Addon-Format (FIREBOT_v1).
 *
 * Zwei Konvertierungs-Modi:
 *   Modus A — SteamCMD-Spiele:
 *     AppID aus Variables/Script extrahieren → standardisiertes install.sh
 *     generieren → status 'pending_review' (direkt lauffähig)
 *
 *   Modus B — Standalone/Sonstige:
 *     Install-Script übersetzen (apk→apt, /mnt/server→${INSTALL_DIR}, Docker entfernen)
 *     → status 'draft' + needs_review=true (manuelle Prüfung nötig)
 *
 * @author FireDervil + GitHub Copilot
 * @version 2.0.0
 */

const https = require('https');
const Logger = require('dunebot-core').ServiceManager.get('Logger');

class PterodactylImporter {
    constructor() {
        this.githubApiBase = 'https://api.github.com';
        this.githubRawBase = 'https://raw.githubusercontent.com';
        
        // Verfügbare Kategorien (pelican-eggs Repositories)
        this.categories = {
            'games-steamcmd': 'Games (SteamCMD)',
            'games-standalone': 'Games (Standalone)',
            'minecraft': 'Minecraft',
            // 'voice-servers': 'Voice Servers',  // ❌ Repo existiert nicht (404)
            'database': 'Databases',
            // 'bots': 'Bots',  // ❌ Repo wurde verschoben (301)
            'software': 'Software'
        };
    }

    /**
     * Fetch-Wrapper für HTTPS-Requests (PUBLIC für DB-Cache-URLs)
     * @param {string} url 
     * @returns {Promise<object|string>}
     */
    async fetch(url) {
        return new Promise((resolve, reject) => {
            const headers = {
                'User-Agent': 'FireBot-Pterodactyl-Importer/1.0'
            };
            
            // GitHub Token aus .env wenn vorhanden
            if (process.env.GITHUB_API_TOKEN) {
                headers['Authorization'] = `Bearer ${process.env.GITHUB_API_TOKEN}`;
            }
            
            https.get(url, { headers }, (res) => {
                let data = '';
                
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        if (res.statusCode === 200) {
                            // JSON-Parsing: GitHub API liefert application/json, Raw Files text/plain
                            // → Versuche immer JSON zu parsen, fallback auf String
                            try {
                                resolve(JSON.parse(data));
                            } catch (parseError) {
                                // Falls kein valides JSON, gebe String zurück
                                resolve(data);
                            }
                        } else {
                            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                        }
                    } catch (error) {
                        reject(error);
                    }
                });
            }).on('error', reject);
        });
    }

    /**
     * Hole Liste aller verfügbaren Eggs einer Kategorie
     * @param {string} category - z.B. 'games-steamcmd'
     * @returns {Promise<Array>}
     */
    async fetchEggsList(category = 'games-steamcmd') {
        try {
            Logger.info(`[PterodactylImporter] Fetching eggs list for category: ${category}`);
            
            const repoName = `pelican-eggs/${category}`;
            
            // OPTIMIERT: Git Tree API nutzen (weniger Requests!)
            // Hole Branch-Info für den SHA
            const branchUrl = `${this.githubApiBase}/repos/${repoName}/branches/main`;
            Logger.debug(`[PterodactylImporter] Fetching branch data from: ${branchUrl}`);
            
            let branchData;
            try {
                branchData = await this.fetch(branchUrl);
            } catch (error) {
                Logger.error('[PterodactylImporter] Failed to fetch branch data:', error);
                throw new Error(`Failed to fetch branch data: ${error.message}`);
            }
            
            if (!branchData || !branchData.commit || !branchData.commit.sha) {
                Logger.error('[PterodactylImporter] Invalid branch data - missing commit.sha');
                throw new Error('Invalid branch data received from GitHub');
            }
            
            const treeSha = branchData.commit.sha;
            Logger.debug(`[PterodactylImporter] Tree SHA: ${treeSha}`);
            
            // Hole gesamten Tree (rekursiv)
            const treeUrl = `${this.githubApiBase}/repos/${repoName}/git/trees/${treeSha}?recursive=1`;
            Logger.debug(`[PterodactylImporter] Fetching tree data from: ${treeUrl}`);
            
            let treeData;
            try {
                treeData = await this.fetch(treeUrl);
            } catch (error) {
                Logger.error('[PterodactylImporter] Failed to fetch tree data:', error);
                throw new Error(`Failed to fetch tree data: ${error.message}`);
            }
            
            if (!treeData || !Array.isArray(treeData.tree)) {
                Logger.error('[PterodactylImporter] Invalid tree data - not an array');
                throw new Error('Invalid tree data received from GitHub');
            }
            
            Logger.debug(`[PterodactylImporter] Tree has ${treeData.tree.length} items`);
            
            // Filtere egg-*.json Files
            const eggFiles = treeData.tree.filter(item => 
                item.type === 'blob' && 
                item.path.includes('/egg-') && 
                item.path.endsWith('.json')
            );
            
            Logger.debug(`[PterodactylImporter] Found ${eggFiles.length} potential egg files`);
            
            const eggs = [];
            const seenEggs = new Set(); // Verhindere Duplikate
            
            for (const file of eggFiles) {
                // Path Format kann sein:
                // - "game/variant/egg-variant.json" (3-level, z.B. valheim/valheim_vanilla/egg-valheim-vanilla.json)
                // - "game/egg-game.json" (2-level, falls vorhanden)
                const pathParts = file.path.split('/');
                
                // 3-Level Format (valheim/valheim_vanilla/egg-valheim-vanilla.json)
                if (pathParts.length === 3) {
                    const parentFolder = pathParts[0];
                    const variantFolder = pathParts[1];
                    const fileName = pathParts[2];
                    
                    // Extrahiere Egg-Name aus Dateinamen (egg-valheim-vanilla.json → valheim_vanilla)
                    const eggNameMatch = fileName.match(/^egg-(.+)\.json$/);
                    if (eggNameMatch) {
                        const eggName = eggNameMatch[1];
                        const fullPath = `${parentFolder}/${variantFolder}`;
                        
                        // Vermeide Duplikate
                        if (!seenEggs.has(fullPath)) {
                            seenEggs.add(fullPath);
                            eggs.push({
                                name: fullPath,  // z.B. "valheim/valheim_vanilla"
                                displayName: this._formatDisplayName(variantFolder),  // "Valheim Vanilla"
                                category: category,
                                downloadUrl: `${this.githubRawBase}/${repoName}/main/${file.path}`
                            });
                        }
                    }
                }
                // 2-Level Format (fallback für alte Struktur)
                else if (pathParts.length === 2) {
                    const folderName = pathParts[0];
                    const fileName = pathParts[1];
                    
                    const eggNameMatch = fileName.match(/^egg-(.+)\.json$/);
                    if (eggNameMatch) {
                        const eggName = eggNameMatch[1];
                        
                        if (!seenEggs.has(folderName)) {
                            seenEggs.add(folderName);
                            eggs.push({
                                name: folderName,
                                displayName: this._formatDisplayName(folderName),
                                category: category,
                                downloadUrl: `${this.githubRawBase}/${repoName}/main/${file.path}`
                            });
                        }
                    }
                }
            }
            
            Logger.success(`[PterodactylImporter] Found ${eggs.length} eggs in ${category}`);
            return eggs;
            
        } catch (error) {
            // DEBUG: Was ist error?
            console.log('[DEBUG] Caught error:', typeof error, error);
            
            // Sicherstellen dass error ein Error-Objekt ist
            const safeError = error instanceof Error ? error : new Error(String(error || 'Unknown error in fetchEggsList'));
            
            Logger.error('[PterodactylImporter] Error fetching eggs list:', safeError);
            throw safeError;
        }
    }

    /**
     * Hole spezifisches Egg JSON
     * @param {string} category 
     * @param {string} eggName - Format: "valheim/valheim_vanilla" oder "simple-game"
     * @returns {Promise<object>}
     */
    async fetchEggJSON(category, eggName) {
        try {
            Logger.info(`[PterodactylImporter] Fetching egg: ${category}/${eggName}`);
            
            // eggName kann sein:
            // - "valheim/valheim_vanilla" (3-level)
            // - "core_keeper" (2-level mit Unterstrichen)
            const pathParts = eggName.split('/');
            let fileName;
            
            if (pathParts.length === 2) {
                // 3-Level: valheim/valheim_vanilla → egg-valheim-vanilla.json
                // Unterstriche durch Bindestriche ersetzen
                const normalizedName = pathParts[1].replace(/_/g, '-');
                fileName = `egg-${normalizedName}.json`;
            } else {
                // 2-Level: core_keeper → egg-core-keeper.json
                // Unterstriche durch Bindestriche ersetzen
                const normalizedName = eggName.replace(/_/g, '-');
                fileName = `egg-${normalizedName}.json`;
            }
            
            const url = `${this.githubRawBase}/pelican-eggs/${category}/main/${eggName}/${fileName}`;
            Logger.debug(`[PterodactylImporter] Fetching from: ${url}`);
            
            const rawJson = await this.fetch(url);
            
            const eggData = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson;
            
            Logger.success(`[PterodactylImporter] Successfully fetched egg: ${eggName}`);
            return eggData;
            
        } catch (error) {
            Logger.error('[PterodactylImporter] Error fetching egg JSON:', error);
            throw error;
        }
    }

    /**
     * Konvertiere Pterodactyl Egg → FireBot Addon Format (FIREBOT_v1)
     *
     * Modus A (SteamCMD): AppID extrahieren → Standard-Install-Script generieren
     * Modus B (Standalone): Script übersetzen → als Draft markieren
     *
     * @param {object} pterodactylEgg
     * @returns {object} { gameData, isSteamcmd, needsReview, steamAppId }
     */
    convertToOurFormat(pterodactylEgg) {
        try {
            Logger.info(`[PterodactylImporter] Converting egg: ${pterodactylEgg.name || 'Unknown'}`);

            const rawScript     = pterodactylEgg.scripts?.installation?.script || '';
            const rawStartup    = pterodactylEgg.startup || '';
            const rawVariables  = pterodactylEgg.variables || [];

            // ── Erkennung ────────────────────────────────────────────────────────
            const isSteamcmd  = this._isSteamCMD(rawScript, rawVariables);
            const steamAppId  = isSteamcmd ? this._extractSteamAppId(rawScript, rawVariables) : null;

            // ── Install-Script ───────────────────────────────────────────────────
            let installScript;
            let needsReview;

            if (isSteamcmd && steamAppId) {
                // Modus A: generiertes Standard-Script — direkt lauffähig
                installScript = this._generateSteamCMDScript(steamAppId, rawVariables);
                needsReview   = false;
                Logger.info(`[PterodactylImporter] Modus A (SteamCMD) – AppID: ${steamAppId}`);
            } else {
                // Modus B: übersetztes Script — muss manuell geprüft werden
                installScript = this._translateInstallScript(rawScript);
                needsReview   = true;
                Logger.info(`[PterodactylImporter] Modus B (Standalone) – needs_review=true`);
            }

            // ── Startup-Command ──────────────────────────────────────────────────
            const startupCommand = this._translateStartupCommand(rawStartup);

            // ── Variablen ────────────────────────────────────────────────────────
            const variables = this._convertVariables(rawVariables);

            // ── Ports ────────────────────────────────────────────────────────────
            const ports = this._extractPorts(pterodactylEgg);

            // ── Dependencies ─────────────────────────────────────────────────────
            const dependencies = isSteamcmd
                ? ['lib32gcc-s1', 'libsdl2-2.0-0']   // SteamCMD Standard-Deps
                : this._guessDependencies(rawScript);

            // ── Finales game_data ─────────────────────────────────────────────────
            const gameData = {
                meta: {
                    version:      'FIREBOT_v1',
                    source:       'pterodactyl',
                    needs_review: needsReview,
                    name:         pterodactylEgg.name        || 'Imported Game',
                    author:       pterodactylEgg.author      || 'Pterodactyl Community',
                    description:  pterodactylEgg.description || '',
                },
                installation: {
                    script_content: installScript,
                    dependencies:   dependencies,
                },
                startup: {
                    command:     startupCommand,
                    stop_signal: 'SIGTERM',
                },
                variables,
                ports,
            };

            // ── RCON-Konfiguration (Auto-Detect) ────────────────────────────────
            const rconConfig = this._detectRconConfig(rawVariables, ports);
            if (rconConfig) {
                gameData.config = { rcon: rconConfig };
                Logger.info(`[PterodactylImporter] RCON erkannt: port_var=${rconConfig.port_var}, password_var=${rconConfig.password_var}`);
            }

            Logger.success(`[PterodactylImporter] Conversion complete: ${gameData.meta.name} (needsReview: ${needsReview})`);

            return { gameData, isSteamcmd, needsReview, steamAppId };

        } catch (error) {
            Logger.error('[PterodactylImporter] Error converting egg:', error);
            throw error;
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // PRIVATE: Erkennung
    // ══════════════════════════════════════════════════════════════════════════

    /** Prüft ob das Egg SteamCMD nutzt */
    _isSteamCMD(script, variables) {
        const s = (script || '').toLowerCase();
        if (s.includes('steamcmd') || s.includes('steam_user') || s.includes('srcds_appid')) return true;
        const hasAppIdVar = (variables || []).some(v =>
            v.env_variable === 'SRCDS_APPID' || v.env_variable === 'STEAM_APPID'
        );
        return hasAppIdVar;
    }

    /**
     * Extrahiert die SteamCMD AppID aus Variables oder Install-Script.
     * Bevorzugt Variables (zuverlässiger als Regex auf Script-Text).
     */
    _extractSteamAppId(script, variables) {
        // 1. Aus Variables (SRCDS_APPID oder STEAM_APPID)
        const appIdVar = (variables || []).find(v =>
            v.env_variable === 'SRCDS_APPID' || v.env_variable === 'STEAM_APPID'
        );
        if (appIdVar?.default_value && /^\d+$/.test(appIdVar.default_value)) {
            return appIdVar.default_value;
        }

        // 2. Aus Script: app_update XXXXX
        const match = (script || '').match(/app_update\s+(\d+)/i);
        if (match) return match[1];

        // 3. Aus Script: APPID=XXXXX oder SRCDS_APPID=XXXXX
        const varMatch = (script || '').match(/(?:APPID|SRCDS_APPID)\s*=\s*["']?(\d+)["']?/i);
        if (varMatch) return varMatch[1];

        return null;
    }

    // ══════════════════════════════════════════════════════════════════════════
    // PRIVATE: Script-Generierung / Übersetzung
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * Modus A: Generiert ein standardisiertes SteamCMD Install-Script.
     * Nutzt unsere Daemon-Variablen: ${STEAMCMD}, ${INSTALL_DIR}, ${SRCDS_APPID}
     */
    _generateSteamCMDScript(appId, variables) {
        // Prüfe ob Beta-Branch-Variablen vorhanden sind
        const hasBetaId   = (variables || []).some(v => v.env_variable === 'SRCDS_BETAID');
        const hasBetaPass = (variables || []).some(v => v.env_variable === 'SRCDS_BETAPASS');

        const betaFlags = hasBetaId
            ? '\n# Beta-Branch falls konfiguriert\nBETA_FLAG=""\n[[ -n "${SRCDS_BETAID}" ]] && BETA_FLAG="-beta ${SRCDS_BETAID} ${SRCDS_BETAPASS:+-betapassword ${SRCDS_BETAPASS}}"\n'
            : '';
        const betaArg = hasBetaId ? ' \${BETA_FLAG}' : '';

        return `#!/bin/bash
# FireBot Standard SteamCMD Install Script
# Automatisch generiert aus Pterodactyl Egg (AppID: ${appId})

# HOME korrekt setzen (verhindert Steam/.config Fehler)
export HOME=\$(getent passwd "\$(whoami)" | cut -d: -f6)

# SteamCMD bootstrappen falls nicht vorhanden
if [[ ! -f "\${STEAMCMD}" ]]; then
    echo "SteamCMD nicht gefunden – wird installiert..."
    mkdir -p "\${STEAMCMD_DIR}"
    cd "\${STEAMCMD_DIR}"
    curl -sqL "https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz" | tar zxvf -
    if [[ ! -f "\${STEAMCMD_DIR}/steamcmd.sh" ]]; then
        echo "FEHLER: SteamCMD konnte nicht heruntergeladen werden."
        exit 1
    fi
    echo "SteamCMD erfolgreich installiert."
fi
${betaFlags}
echo "Starte SteamCMD Download für AppID ${appId}..."
"\${STEAMCMD}" \\
    +force_install_dir "\${INSTALL_DIR}" \\
    +login anonymous \\
    +app_update ${appId} validate${betaArg} \\
    +quit

echo "Download abgeschlossen."
`;
    }

    /**
     * Modus B: Übersetzt ein Pterodactyl Install-Script für native Debian/Ubuntu-Umgebung.
     * Entfernt Docker-spezifisches, übersetzt Package-Manager, ersetzt Pfade.
     */
    _translateInstallScript(script) {
        if (!script) return '#!/bin/bash\n# TODO: Install-Script manuell erstellen\n';

        // CRLF → LF
        let s = script.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

        // Zeilen filtern / übersetzen
        const lines = s.split('\n').map(line => {
            const t = line.trim();

            // Docker-spezifisch entfernen
            if (t.match(/^\s*#.*docker/i))          return null;
            if (t.includes('docker '))               return null;
            if (t.includes('container_id'))          return null;

            // apk → apt-get
            if (t.startsWith('apk add'))
                return line.replace(/\bapk\s+add\b/, 'apt-get install -y').replace(/--no-cache\s*/, '');
            if (t.startsWith('apk update'))
                return line.replace(/\bapk\s+update\b/, 'apt-get update');
            if (t.startsWith('apk '))
                return `# [NEEDS REVIEW] apk → apt-get: ${line}`;

            // /mnt/server → ${INSTALL_DIR}
            if (t.includes('/mnt/server'))
                return line.replace(/\/mnt\/server/g, '${INSTALL_DIR}');

            return line;
        }).filter(l => l !== null);

        return [
            '#!/bin/bash',
            '# [NEEDS REVIEW] Aus Pterodactyl Egg übersetzt – bitte vor Aktivierung prüfen!',
            '# Pfade: /mnt/server → ${INSTALL_DIR}, apk → apt-get, Docker-Zeilen entfernt',
            '',
            ...lines
        ].join('\n') + '\n';
    }

    /**
     * Übersetzt Startup-Command: {{VARNAME}} → ${VARNAME}
     * und bereinigt Wings-spezifische Syntax
     */
    _translateStartupCommand(command) {
        if (!command) return '';
        // {{VAR}} → ${VAR}
        return command.replace(/\{\{([A-Z0-9_]+)\}\}/g, '$${$1}');
    }

    /**
     * Rät benötigte System-Dependencies aus Script-Inhalt (Modus B).
     * Gibt nur bekannte, sichere Paketnamen zurück.
     */
    _guessDependencies(script) {
        const deps = new Set();
        const s = (script || '').toLowerCase();

        if (s.includes('curl'))                     deps.add('curl');
        if (s.includes('wget'))                     deps.add('wget');
        if (s.includes('unzip'))                    deps.add('unzip');
        if (s.includes('tar '))                     deps.add('tar');
        if (s.includes('git clone') || s.includes('git pull')) deps.add('git');
        if (s.includes('java ') || s.includes('openjdk'))      deps.add('default-jre-headless');
        if (s.includes('xvfb'))                     deps.add('xvfb');
        if (s.includes('lib32'))                    deps.add('lib32gcc-s1');

        return [...deps];
    }

    // ══════════════════════════════════════════════════════════════════════════
    // PRIVATE: Variablen & Ports
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * Konvertiert Pterodactyl variables[] in unser Format.
     * Behält user_editable, description und default bei.
     */
    _convertVariables(variables) {
        if (!Array.isArray(variables)) return [];

        // Diese Variablen werden vom Daemon intern gesetzt → nicht ans Frontend
        const daemonManaged = new Set([
            'SERVER_PORT', 'SERVER_IP', 'P_SERVER_UUID', 'P_SERVER_ALLOCATION',
            'STARTUP', 'TZ'
        ]);

        return variables
            .filter(v => v.env_variable && !daemonManaged.has(v.env_variable))
            .map(v => ({
                key:          v.env_variable,
                default:      v.default_value ?? '',
                description:  v.description   || v.name || '',
                user_editable: v.user_viewable !== false,
            }));
    }

    /**
     * Extrahiert Port-Definitionen aus Variables.
     */
    _extractPorts(egg) {
        const ports = {};
        const vars  = egg.variables || [];

        // SERVER_PORT → game port
        const serverPort = vars.find(v => v.env_variable === 'SERVER_PORT');
        ports.game = {
            protocol: this._guessProtocol(egg),
            default:  serverPort ? parseInt(serverPort.default_value) || 27015 : 27015,
        };

        // Zusätzliche Port-Variablen
        vars.forEach(v => {
            const key = (v.env_variable || '').toLowerCase();
            if (key !== 'server_port' && key.includes('port')) {
                const name = key.replace(/_port$/, '').replace(/^port_/, '') || 'extra';
                ports[name] = {
                    protocol: 'udp',
                    default:  parseInt(v.default_value) || 27016,
                };
            }
        });

        return ports;
    }

    /** Rät das Netzwerkprotokoll aus Name/Description des Eggs */
    _guessProtocol(egg) {
        const text = `${egg.name} ${egg.description} ${egg.startup}`.toLowerCase();
        if (text.includes(' tcp ') || text.includes('rcon'))    return 'tcp';
        return 'udp'; // Gameserver-Default
    }

    /**
     * Erkennt RCON-Konfiguration aus Egg-Variablen.
     * Sucht nach typischen RCON-Port- und Passwort-Variablen.
     *
     * @param {Array} variables - Rohvariablen aus dem Pterodactyl Egg
     * @param {object} ports - Bereits extrahierte Port-Map
     * @returns {object|null} { protocol, port_var, password_var } oder null
     */
    _detectRconConfig(variables, ports) {
        if (!Array.isArray(variables)) return null;

        // RCON-Port-Variable finden (RCON_PORT, RCONPORT, etc.)
        const rconPortVar = variables.find(v =>
            /^RCON_?PORT$/i.test(v.env_variable || '')
        );

        // RCON-Passwort-Variable finden (RCON_PASSWORD, RCONPASSWORD, ADMIN_PASSWORD, etc.)
        const rconPassVar = variables.find(v =>
            /^(RCON_?PASSWORD|ADMIN_?PASSWORD)$/i.test(v.env_variable || '')
        );

        // Beide müssen vorhanden sein damit RCON als unterstützt gilt
        if (!rconPortVar && !ports.rcon) return null;
        if (!rconPassVar) return null;

        // port_var: Wenn es einen "rcon"-Port in ports gibt → Kleinbuchstaben (Port-Key),
        // sonst die ENV-Variable (Großbuchstaben)
        const portVar = ports.rcon
            ? 'rcon'                           // → lookup in ports["rcon"].external
            : rconPortVar.env_variable;        // → lookup in env_variables["RCON_PORT"]

        return {
            protocol:     'srcds',
            port_var:     portVar,
            password_var: rconPassVar.env_variable,
        };
    }

    // ══════════════════════════════════════════════════════════════════════════
    // PRIVATE: Hilfsmethoden (unverändert)
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * Entferne Docker-spezifische Befehle aus Installation Script
     * (Legacy-Methode, weiterhin für interne Nutzung verfügbar)
     */
    _stripDockerCommands(script) {
        return this._translateInstallScript(script);
    }

    /**
     * Formatiere Ordnernamen zu Display-Namen
     * @param {string} folderName 
     * @returns {string}
     */
    _formatDisplayName(folderName) {
        return folderName
            .replace(/-/g, ' ')
            .split(' ')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }

    /**
     * Hole verfügbare Kategorien
     * @returns {object}
     */
    getCategories() {
        return this.categories;
    }
}

module.exports = PterodactylImporter;
