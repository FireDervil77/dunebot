/**
 * Standardisierte Message-Types für IPM (Inter-Process Messaging)
 * Genutzt für Daemon ↔ Dashboard ↔ Browser Kommunikation
 * 
 * @module ipm/MessageTypes
 * @author FireBot Team
 */

// =====================================================
// MESSAGE TYPES
// =====================================================

/**
 * Command - Dashboard → Daemon (Request)
 * Fordert eine Aktion an (z.B. Server starten)
 */
const TYPE_COMMAND = 'command';

/**
 * Event - Daemon → Dashboard (Push)
 * Benachrichtigt über Status-Änderungen (z.B. Server crashed)
 */
const TYPE_EVENT = 'event';

/**
 * Response - Daemon → Dashboard (Reply)
 * Antwort auf ein Command (z.B. Task-ID nach Start-Request)
 */
const TYPE_RESPONSE = 'response';

// =====================================================
// NAMESPACES
// =====================================================

/**
 * Gameserver-Management
 * Start, Stop, Restart, Status-Updates
 */
const NS_GAMESERVER = 'gameserver';

/**
 * Live-Console
 * Attach, Detach, Input, Output-Streaming
 */
const NS_CONSOLE = 'console';

/**
 * Log-Streaming und History
 * Fetch, Stream, Search
 */
const NS_LOGS = 'logs';

/**
 * SFTP/File-Management
 * Upload, Download, List, Delete, Permissions
 */
const NS_SFTP = 'sftp';

/**
 * System-Monitoring
 * Resource-Stats, Daemon-Status, Updates
 */
const NS_SYSTEM = 'system';

/**
 * Installation-Queue
 * Progress, Logs, Completed, Failed
 */
const NS_INSTALL = 'install';

// =====================================================
// GAMESERVER ACTIONS
// =====================================================

/**
 * Command: Server starten
 * Payload: { server_id, guild_id, config: {...} }
 */
const GAMESERVER_START = 'start';

/**
 * Command: Server stoppen
 * Payload: { server_id }
 */
const GAMESERVER_STOP = 'stop';

/**
 * Command: Server neu starten
 * Payload: { server_id }
 */
const GAMESERVER_RESTART = 'restart';

/**
 * Event: Status hat sich geändert
 * Payload: { server_id, status: 'online'|'offline'|'starting'|'stopping'|'error', timestamp }
 */
const GAMESERVER_STATUS_CHANGED = 'status_changed';

/**
 * Event: Resource-Usage Update
 * Payload: { server_id, cpu: 45.2, ram: 2048, disk: 10240, timestamp }
 */
const GAMESERVER_RESOURCE_USAGE = 'resource_usage';

/**
 * Event: Server ist abgestürzt
 * Payload: { server_id, crash_count, reason, timestamp }
 */
const GAMESERVER_CRASHED = 'crashed';

// =====================================================
// CONSOLE ACTIONS
// =====================================================

/**
 * Command: Console-Output anhängen (Subscribe)
 * Payload: { server_id }
 */
const CONSOLE_ATTACH = 'attach';

/**
 * Command: Console-Output abmelden (Unsubscribe)
 * Payload: { server_id }
 */
const CONSOLE_DETACH = 'detach';

/**
 * Event: Console-Output (Stream)
 * Payload: { server_id, line: 'text', timestamp }
 */
const CONSOLE_OUTPUT = 'output';

/**
 * Command: Command an Server senden
 * Payload: { server_id, command: 'say Hello' }
 */
const CONSOLE_INPUT = 'input';

// =====================================================
// LOGS ACTIONS
// =====================================================

/**
 * Command: Letzte N Zeilen abrufen
 * Payload: { server_id, lines: 100 }
 */
const LOGS_FETCH = 'fetch';

/**
 * Command: Log-Streaming starten (tail -f)
 * Payload: { server_id }
 */
const LOGS_STREAM = 'stream';

/**
 * Command: In Logs suchen
 * Payload: { server_id, query: 'error', regex: false }
 */
const LOGS_SEARCH = 'search';

// =====================================================
// SFTP ACTIONS
// =====================================================

/**
 * Command: Verzeichnis-Inhalt auflisten
 * Payload: { server_id, path: '/config' }
 */
const SFTP_LIST = 'list';

/**
 * Command: Datei hochladen
 * Payload: { server_id, path: '/file.txt', content: base64, overwrite: true }
 */
const SFTP_UPLOAD = 'upload';

/**
 * Command: Datei herunterladen
 * Payload: { server_id, path: '/file.txt' }
 */
const SFTP_DOWNLOAD = 'download';

/**
 * Command: Datei/Ordner löschen
 * Payload: { server_id, path: '/file.txt', recursive: false }
 */
const SFTP_DELETE = 'delete';

/**
 * Command: Ordner erstellen
 * Payload: { server_id, path: '/new-folder' }
 */
const SFTP_CREATE_DIR = 'create_dir';

/**
 * Command: Permissions ändern (chmod)
 * Payload: { server_id, path: '/file.txt', mode: '755' }
 */
const SFTP_CHMOD = 'chmod';

// =====================================================
// SYSTEM ACTIONS
// =====================================================

/**
 * Event: System-Ressourcen-Stats
 * Payload: { cpu: 45.2, ram: { used: 2048, total: 4096 }, disk: {...}, network: {...} }
 */
const SYSTEM_STATS = 'stats';

/**
 * Event: Daemon-Status
 * Payload: { status: 'online'|'offline', version: '1.0.0', uptime: 3600 }
 */
const SYSTEM_DAEMON_STATUS = 'daemon_status';

/**
 * Event: Update verfügbar
 * Payload: { current_version: '1.0.0', latest_version: '1.1.0', changelog: '...' }
 */
const SYSTEM_UPDATE_AVAILABLE = 'update_available';

// =====================================================
// INSTALL ACTIONS
// =====================================================

/**
 * Event: Installation-Progress
 * Payload: { install_id, server_id, progress: 45, step: 'downloading', message: '...' }
 */
const INSTALL_PROGRESS = 'progress';

/**
 * Event: Installation-Logs
 * Payload: { install_id, server_id, line: 'log text', timestamp }
 */
const INSTALL_LOGS = 'logs';

/**
 * Event: Installation abgeschlossen
 * Payload: { install_id, server_id, duration: 120 }
 */
const INSTALL_COMPLETED = 'completed';

/**
 * Event: Installation fehlgeschlagen
 * Payload: { install_id, server_id, error: 'reason', logs: [...] }
 */
const INSTALL_FAILED = 'failed';

// =====================================================
// EXPORTS
// =====================================================

module.exports = {
  // Message Types
  TYPE_COMMAND,
  TYPE_EVENT,
  TYPE_RESPONSE,
  
  // Namespaces
  NS_GAMESERVER,
  NS_CONSOLE,
  NS_LOGS,
  NS_SFTP,
  NS_SYSTEM,
  NS_INSTALL,
  
  // Gameserver Actions
  GAMESERVER_START,
  GAMESERVER_STOP,
  GAMESERVER_RESTART,
  GAMESERVER_STATUS_CHANGED,
  GAMESERVER_RESOURCE_USAGE,
  GAMESERVER_CRASHED,
  
  // Console Actions
  CONSOLE_ATTACH,
  CONSOLE_DETACH,
  CONSOLE_OUTPUT,
  CONSOLE_INPUT,
  
  // Logs Actions
  LOGS_FETCH,
  LOGS_STREAM,
  LOGS_SEARCH,
  
  // SFTP Actions
  SFTP_LIST,
  SFTP_UPLOAD,
  SFTP_DOWNLOAD,
  SFTP_DELETE,
  SFTP_CREATE_DIR,
  SFTP_CHMOD,
  
  // System Actions
  SYSTEM_STATS,
  SYSTEM_DAEMON_STATUS,
  SYSTEM_UPDATE_AVAILABLE,
  
  // Install Actions
  INSTALL_PROGRESS,
  INSTALL_LOGS,
  INSTALL_COMPLETED,
  INSTALL_FAILED,
};
