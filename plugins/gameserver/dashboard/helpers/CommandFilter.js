/**
 * Command-Filter für Gameserver-Console
 * 
 * Blockiert gefährliche Shell-Commands mit Blacklist-Ansatz.
 * Alle Game-Commands sind erlaubt, nur System-Commands blockiert.
 * 
 * @author FireBot Team
 * @version 1.0.0
 */

const Logger = require('dunebot-core').ServiceManager.get('Logger');

/**
 * Blacklist: Gefährliche Commands die NICHT erlaubt sind
 * 
 * Diese Commands würden Shell-Zugriff ermöglichen oder System-Operationen ausführen.
 * Alle anderen Commands (Game-Commands wie "say", "kick", etc.) sind erlaubt.
 */
const COMMAND_BLACKLIST = [
    // Shell-Commands (File-Operations)
    'rm', 'mv', 'cp', 'dd', 'chmod', 'chown', 'chgrp',
    'mkdir', 'rmdir', 'touch', 'ln', 'unlink',
    
    // System-Commands
    'sudo', 'su', 'passwd', 'useradd', 'userdel', 'usermod',
    'groupadd', 'groupdel', 'groupmod',
    'systemctl', 'service', 'reboot', 'shutdown', 'halt', 'poweroff', 'init',
    
    // Netzwerk-Commands
    'wget', 'curl', 'nc', 'netcat', 'nmap', 'ssh', 'scp', 'sftp', 'ftp',
    'ping', 'traceroute', 'mtr', 'netstat', 'ss', 'ip', 'ifconfig', 'route',
    
    // Programmierung/Compilation
    'gcc', 'g++', 'clang', 'make', 'cmake', 'python', 'python3', 'python2',
    'node', 'npm', 'yarn', 'pip', 'pip3', 'cargo', 'rustc', 'go', 'java', 'javac',
    
    // Shell-Escape
    'bash', 'sh', 'zsh', 'fish', 'dash', 'ksh', 'csh', 'tcsh',
    'exec', 'eval', 'source', '.', 
    
    // File-Transfer & Archive
    'rsync', 'scp', 'tar', 'zip', 'unzip', 'gzip', 'gunzip', 'bzip2', 'bunzip2',
    '7z', 'rar', 'unrar',
    
    // Process-Management
    'kill', 'killall', 'pkill', 'ps', 'top', 'htop', 'nice', 'renice',
    
    // Editors (könnten für Shell-Escape genutzt werden)
    'vim', 'vi', 'nano', 'emacs', 'sed', 'awk', 'pico',
    
    // Cron/Scheduling
    'crontab', 'at', 'batch',
    
    // Package-Manager
    'apt', 'apt-get', 'yum', 'dnf', 'pacman', 'snap', 'flatpak', 'brew',
    
    // Mount/Disk
    'mount', 'umount', 'fdisk', 'parted', 'mkfs', 'fsck',
    
    // Kernel/Hardware
    'modprobe', 'insmod', 'rmmod', 'lsmod', 'dmesg',
    
    // Git (könnte für Downloads genutzt werden)
    'git', 'svn', 'hg', 'bzr'
];

/**
 * Gefährliche Patterns die in Commands NICHT vorkommen dürfen
 */
const DANGEROUS_PATTERNS = [
    { pattern: /&&|;|\|\|/, message: 'Command-Chaining (&&, ;, ||) ist nicht erlaubt' },
    { pattern: /`|\$\(/, message: 'Command-Substitution ist nicht erlaubt' },
    { pattern: /[><]/, message: 'Redirects (>, <) sind nicht erlaubt' },
    { pattern: /\|(?!\|)/, message: 'Pipes (|) sind nicht erlaubt' }, // | aber nicht ||
    { pattern: /\\x[0-9a-f]{2}/i, message: 'Hex-Escape-Sequences sind nicht erlaubt' },
    { pattern: /\\[0-7]{1,3}/, message: 'Octal-Escape-Sequences sind nicht erlaubt' },
    { pattern: /\.\./, message: 'Pfad-Traversierung (..) ist nicht erlaubt' },
    { pattern: /~/, message: 'Tilde-Expansion (~) ist nicht erlaubt' },
    { pattern: /\$\{/, message: 'Variable-Expansion ist nicht erlaubt' }
];

/**
 * Validiert einen Command gegen Blacklist und Patterns
 * 
 * WICHTIG: Diese Funktion wird NUR für RCON-Commands genutzt!
 * PTY stdin ist Read-Only (keine Command-Filterung nötig).
 * 
 * Commands gehen über RCON → Gameserver (nicht über PTY stdin).
 * RCON kennt nur Game-Commands, Shell-Commands funktionieren dort nicht.
 * 
 * Diese Blacklist ist ein zusätzlicher Sicherheits-Layer falls RCON
 * kompromittiert wird oder falsch konfiguriert ist.
 * 
 * @param {string} command - Der zu validierende Command
 * @param {object} options - Optionen
 * @param {string} options.userId - User-ID für Audit-Log
 * @param {string} options.serverId - Server-ID
 * @param {string} options.guildId - Guild-ID
 * @param {boolean} options.rconSupported - Hat der Server RCON? (optional)
 * @returns {object} { valid: boolean, error?: string, sanitized?: string }
 */
function validateCommand(command, options = {}) {
    try {
        // 0. RCON-Support prüfen (wenn mitgegeben)
        if (options.rconSupported === false) {
            return { 
                valid: false, 
                error: 'Dieses Spiel unterstützt keine Commands (RCON nicht verfügbar)' 
            };
        }
        
        // 1. Leerer Command
        if (!command || typeof command !== 'string') {
            return { valid: false, error: 'Command ist leer oder ungültig' };
        }
        
        const trimmed = command.trim();
        
        if (trimmed.length === 0) {
            return { valid: false, error: 'Command ist leer' };
        }
        
        // 2. Max-Länge (Schutz vor Buffer-Overflow)
        if (trimmed.length > 1000) {
            return { valid: false, error: 'Command zu lang (max 1000 Zeichen)' };
        }
        
        // 3. Prüfe gefährliche Patterns
        for (const { pattern, message } of DANGEROUS_PATTERNS) {
            if (pattern.test(trimmed)) {
                Logger.warn(`[CommandFilter] Gefährliches Pattern blockiert: ${message}`, {
                    command: trimmed,
                    ...options
                });
                return { valid: false, error: message };
            }
        }
        
        // 4. Extrahiere Command-Name (erstes Wort)
        const parts = trimmed.split(/\s+/);
        const cmdName = parts[0].toLowerCase();
        
        // Entferne Pfad (falls Command als /bin/rm angegeben)
        const cmdBase = cmdName.split('/').pop();
        
        // 5. Prüfe Blacklist
        if (COMMAND_BLACKLIST.includes(cmdBase)) {
            Logger.warn(`[CommandFilter] Blockierter Command: ${cmdBase}`, {
                command: trimmed,
                ...options
            });
            return { 
                valid: false, 
                error: `Command '${cmdBase}' ist aus Sicherheitsgründen blockiert` 
            };
        }
        
        // 6. Sanitize: Entferne führende/trailing Whitespaces
        const sanitized = trimmed;
        
        // ✅ Command ist valid!
        Logger.debug(`[CommandFilter] Command erlaubt: ${cmdBase}`, options);
        
        return { valid: true, sanitized };
        
    } catch (error) {
        Logger.error('[CommandFilter] Validierungs-Fehler:', error);
        return { valid: false, error: 'Interner Fehler bei Command-Validierung' };
    }
}

/**
 * Rate-Limiter für Commands
 * 
 * Verhindert Spam (max 10 Commands pro Minute pro User)
 */
class CommandRateLimiter {
    constructor() {
        this.history = new Map(); // userId → timestamps[]
        this.maxCommands = 10; // Max Commands
        this.windowMs = 60000; // Pro Minute
    }
    
    /**
     * Prüft ob User Rate-Limit erreicht hat
     * 
     * @param {string} userId - User-ID
     * @returns {object} { allowed: boolean, error?: string, remaining?: number }
     */
    check(userId) {
        const now = Date.now();
        const userHistory = this.history.get(userId) || [];
        
        // Entferne alte Timestamps (außerhalb Window)
        const recent = userHistory.filter(ts => now - ts < this.windowMs);
        
        if (recent.length >= this.maxCommands) {
            const oldestTs = Math.min(...recent);
            const resetIn = Math.ceil((oldestTs + this.windowMs - now) / 1000);
            
            return { 
                allowed: false, 
                error: `Zu viele Commands (max ${this.maxCommands}/${this.windowMs / 1000}s). Versuche es in ${resetIn}s erneut.`,
                remaining: 0
            };
        }
        
        // Füge aktuellen Timestamp hinzu
        recent.push(now);
        this.history.set(userId, recent);
        
        return { 
            allowed: true, 
            remaining: this.maxCommands - recent.length 
        };
    }
    
    /**
     * Cleanup-Job (sollte regelmäßig aufgerufen werden)
     * Entfernt alte Einträge aus der History
     */
    cleanup() {
        const now = Date.now();
        
        for (const [userId, timestamps] of this.history.entries()) {
            const recent = timestamps.filter(ts => now - ts < this.windowMs);
            
            if (recent.length === 0) {
                this.history.delete(userId);
            } else {
                this.history.set(userId, recent);
            }
        }
    }
}

// Singleton-Instanz
const rateLimiter = new CommandRateLimiter();

// Cleanup alle 5 Minuten
setInterval(() => rateLimiter.cleanup(), 5 * 60 * 1000);

module.exports = {
    validateCommand,
    rateLimiter,
    COMMAND_BLACKLIST, // Export für Tests/Dokumentation
    DANGEROUS_PATTERNS
};
