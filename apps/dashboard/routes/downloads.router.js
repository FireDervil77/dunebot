/**
 * Downloads Router
 * 
 * Öffentliche Download-Endpunkte für:
 * - Daemon-Installationsskript (install.sh)
 * - Daemon-Binaries (verschiedene Plattformen)
 * - Konfigurationsvorlagen
 * 
 * Diese Endpunkte sind OHNE Authentifizierung erreichbar (für curl/wget)
 * 
 * @module routes/downloads
 * @author FireBot Team
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs').promises;
const { ServiceManager } = require('dunebot-core');

const Logger = ServiceManager.get('Logger');

// Basis-Pfad für Downloads
const DOWNLOADS_PATH = path.join(__dirname, '../downloads');

/**
 * GET /downloads/daemon/install.sh
 * 
 * Daemon-Installationsskript herunterladen
 * Verwendung: curl -fsSL https://dashboard.example.com/downloads/daemon/install.sh | bash
 */
router.get('/daemon/install.sh', async (req, res) => {
    try {
        const scriptPath = path.join(DOWNLOADS_PATH, 'daemon', 'install.sh');
        
        // Prüfe ob Datei existiert
        try {
            await fs.access(scriptPath);
        } catch {
            Logger.warn('[Downloads] install.sh nicht gefunden');
            return res.status(404).send('# Installationsskript nicht gefunden\necho "ERROR: install.sh nicht verfügbar"');
        }

        // Setze Content-Type für Shell-Script
        res.setHeader('Content-Type', 'text/x-shellscript');
        res.setHeader('Content-Disposition', 'inline; filename="install.sh"');
        
        // Sende Datei
        res.sendFile(scriptPath);
        
        Logger.debug('[Downloads] install.sh heruntergeladen');
    } catch (error) {
        Logger.error('[Downloads] Fehler beim Senden von install.sh:', error);
        res.status(500).send('# Serverfehler\necho "ERROR: Interner Serverfehler"');
    }
});

/**
 * GET /downloads/daemon/config.yaml
 * 
 * Beispiel-Konfigurationsdatei herunterladen
 */
router.get('/daemon/config.yaml', async (req, res) => {
    try {
        const configPath = path.join(DOWNLOADS_PATH, 'daemon', 'config.yaml');
        
        try {
            await fs.access(configPath);
        } catch {
            Logger.warn('[Downloads] config.yaml nicht gefunden');
            return res.status(404).send('# Config nicht gefunden');
        }

        res.setHeader('Content-Type', 'text/yaml');
        res.setHeader('Content-Disposition', 'inline; filename="daemon.yaml"');
        res.sendFile(configPath);
        
        Logger.debug('[Downloads] config.yaml heruntergeladen');
    } catch (error) {
        Logger.error('[Downloads] Fehler beim Senden von config.yaml:', error);
        res.status(500).send('# Serverfehler');
    }
});

/**
 * Helper-Funktion für Binary-Download
 */
const handleBinaryDownload = async (req, res, platform, filename) => {
    try {
        // Validierung: Nur erlaubte Plattformen
        const allowedPlatforms = [
            'linux-amd64',
            'linux-arm64',
            'linux-arm',
            'windows-amd64',
            'darwin-amd64',
            'darwin-arm64'
        ];
        
        if (!allowedPlatforms.includes(platform)) {
            return res.status(400).send('Ungültige Plattform');
        }
        
        // Validiere Dateiname (nur firebot-daemon oder firebot-daemon.exe erlaubt)
        if (filename !== 'firebot-daemon' && filename !== 'firebot-daemon.exe') {
            return res.status(400).send('Ungültiger Dateiname');
        }
        
        const binaryPath = path.join(DOWNLOADS_PATH, 'daemon', 'binaries', platform, filename);
        
        try {
            await fs.access(binaryPath);
        } catch {
            Logger.warn(`[Downloads] Binary nicht gefunden: ${platform}/${filename}`);
            return res.status(404).send('Binary nicht gefunden');
        }

        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.sendFile(binaryPath);
        
        Logger.info(`[Downloads] Binary heruntergeladen: ${platform}/${filename}`);
    } catch (error) {
        Logger.error('[Downloads] Fehler beim Senden der Binary:', error);
        res.status(500).send('Serverfehler');
    }
};

/**
 * GET /downloads/daemon/binaries/:platform/:filename
 * 
 * Daemon-Binary mit explizitem Dateinamen herunterladen
 * Beispiele:
 * - /downloads/daemon/binaries/linux-amd64/firebot-daemon
 * - /downloads/daemon/binaries/darwin-arm64/firebot-daemon
 * - /downloads/daemon/binaries/windows-amd64/firebot-daemon.exe
 */
router.get('/daemon/binaries/:platform/:filename', async (req, res) => {
    const { platform, filename } = req.params;
    await handleBinaryDownload(req, res, platform, filename);
});

/**
 * GET /downloads/daemon/binaries/:platform
 * 
 * Daemon-Binary ohne Dateinamen (wird automatisch ergänzt)
 * Beispiele:
 * - /downloads/daemon/binaries/linux-amd64 → firebot-daemon
 * - /downloads/daemon/binaries/windows-amd64 → firebot-daemon.exe
 */
router.get('/daemon/binaries/:platform', async (req, res) => {
    const { platform } = req.params;
    const filename = platform.includes('windows') ? 'firebot-daemon.exe' : 'firebot-daemon';
    await handleBinaryDownload(req, res, platform, filename);
});

/**
 * GET /downloads/daemon (Index-Seite)
 * 
 * Zeigt verfügbare Downloads an
 */
router.get('/daemon', async (req, res) => {
    try {
        const html = `
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Daemon Downloads - FireBot</title>
    <style>
        body { font-family: monospace; max-width: 800px; margin: 50px auto; padding: 20px; background: #1e1e1e; color: #d4d4d4; }
        h1 { color: #4ec9b0; }
        h2 { color: #569cd6; margin-top: 30px; }
        pre { background: #2d2d2d; padding: 15px; border-radius: 5px; overflow-x: auto; }
        code { color: #ce9178; }
        a { color: #4fc1ff; text-decoration: none; }
        a:hover { text-decoration: underline; }
        .section { margin: 20px 0; }
    </style>
</head>
<body>
    <h1>🚀 FireBot Daemon Downloads</h1>
    
    <div class="section">
        <h2>📥 Schnellinstallation</h2>
        <p>Installiere den Daemon mit einem Befehl:</p>
        <pre><code>curl -fsSL ${req.protocol}://${req.get('host')}/downloads/daemon/install.sh | bash</code></pre>
    </div>
    
    <div class="section">
        <h2>📄 Verfügbare Downloads</h2>
        <ul>
            <li><a href="/downloads/daemon/install.sh">install.sh</a> - Automatisches Installationsskript</li>
            <li><a href="/downloads/daemon/config.yaml">config.yaml</a> - Beispiel-Konfigurationsdatei</li>
        </ul>
    </div>
    
    <div class="section">
        <h2>🔧 Binaries (verschiedene Plattformen)</h2>
        <ul>
            <li><a href="/downloads/daemon/binaries/linux-amd64/firebot-daemon">Linux AMD64</a></li>
            <li><a href="/downloads/daemon/binaries/linux-arm64/firebot-daemon">Linux ARM64</a></li>
            <li><a href="/downloads/daemon/binaries/linux-arm/firebot-daemon">Linux ARM</a></li>
            <li><a href="/downloads/daemon/binaries/windows-amd64/firebot-daemon.exe">Windows AMD64</a></li>
            <li><a href="/downloads/daemon/binaries/darwin-amd64/firebot-daemon">macOS AMD64</a></li>
            <li><a href="/downloads/daemon/binaries/darwin-arm64/firebot-daemon">macOS ARM64 (Apple Silicon)</a></li>
        </ul>
    </div>
    
    <div class="section">
        <h2>📚 Dokumentation</h2>
        <p>Weitere Informationen findest du in der <a href="https://github.com/FireDervil77/dunebot">GitHub-Repository</a>.</p>
    </div>
</body>
</html>
        `;
        
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    } catch (error) {
        Logger.error('[Downloads] Fehler beim Anzeigen der Index-Seite:', error);
        res.status(500).send('Serverfehler');
    }
});

module.exports = router;
