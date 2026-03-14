-- =====================================================
-- Masterserver Plugin - RootServer Table (= Node = Daemon)
-- =====================================================
-- Repräsentiert eine physische Maschine (Server/VPS/Dedi)
-- auf der der FireBot Daemon läuft.
-- Entspricht einem "Node" in Pelican/Pterodactyl.
-- Eine Guild kann mehrere RootServer haben (= mehrere Maschinen).
-- daemon_id ist die UUID mit der sich der Daemon authentifiziert.
-- =====================================================

CREATE TABLE IF NOT EXISTS rootserver (
    -- Primary Key
    id INT AUTO_INCREMENT PRIMARY KEY,

    -- Guild & Ownership
    guild_id VARCHAR(30) NOT NULL COMMENT 'Discord Guild ID',
    owner_user_id VARCHAR(30) DEFAULT NULL COMMENT 'Discord User ID des Erstellers (optional)',

    -- Daemon Connection Key (wird vom Dashboard generiert, Daemon übernimmt ihn aus config)
    daemon_id VARCHAR(36) UNIQUE NOT NULL COMMENT 'UUID für IPM-Verbindung (einmalig pro Maschine)',

    -- Display Info
    name VARCHAR(100) NOT NULL COMMENT 'Anzeigename (z.B. "Hetzner Frankfurt")',
    description TEXT DEFAULT NULL COMMENT 'Optionale Beschreibung',

    -- Connection Info
    host VARCHAR(255) NOT NULL COMMENT 'IP-Adresse oder FQDN der Maschine',
    hostname VARCHAR(255) DEFAULT NULL COMMENT 'FQDN für SFTP-Zugriff (z.B. server01.example.com)',
    daemon_port INT NOT NULL DEFAULT 9340 COMMENT 'WebSocket-Port des Daemons',

    -- Port Allocation Pool
    port_range_start INT DEFAULT NULL COMMENT 'Erster Port im Allocation-Pool (z.B. 25565)',
    port_range_end   INT DEFAULT NULL COMMENT 'Letzter Port im Allocation-Pool (z.B. 25665)',

    -- Location
    datacenter VARCHAR(100) DEFAULT NULL COMMENT 'Rechenzentrum (z.B. Hetzner Falkenstein)',
    country_code CHAR(2) DEFAULT NULL COMMENT 'ISO-Ländercode (z.B. DE, US, FR)',

    -- Filesystem
    base_directory VARCHAR(512) NOT NULL DEFAULT '/opt/firebot' COMMENT 'Basispfad für Gameserver-Volumes',

    -- Daemon-Setup Status
    install_status ENUM('pending','installing','completed','failed') DEFAULT 'pending' COMMENT 'Einrichtungsstatus',
    install_log TEXT DEFAULT NULL COMMENT 'Log-Output der Einrichtung',

    -- Authentication
    api_key VARCHAR(255) NOT NULL COMMENT 'API-Key für Daemon-Authentifizierung',
    session_token TEXT DEFAULT NULL COMMENT 'Rotierender Session-Token',
    session_token_expires_at TIMESTAMP NULL DEFAULT NULL COMMENT 'Session-Token Ablauf',

    -- Live Connection Status (vom Daemon aktualisiert)
    daemon_status ENUM('online','offline','error','maintenance') DEFAULT 'offline' COMMENT 'Live-Verbindungsstatus',
    daemon_version VARCHAR(20) DEFAULT NULL COMMENT 'Daemon-Version (z.B. 1.0.0)',
    os_info VARCHAR(255) DEFAULT NULL COMMENT 'Betriebssystem-Info',
    last_seen TIMESTAMP NULL DEFAULT NULL COMMENT 'Letzter Heartbeat',
    last_ping_ms INT DEFAULT NULL COMMENT 'Letzte Ping-Latenz in ms',
    missed_heartbeats INT DEFAULT 0 COMMENT 'Verpasste Heartbeats (Reset bei Verbindung)',
    total_commands INT DEFAULT 0 COMMENT 'Gesendete Commands (gesamt)',
    total_uptime_seconds BIGINT DEFAULT 0 COMMENT 'Gesamte Uptime in Sekunden',
    last_disconnect TIMESTAMP NULL DEFAULT NULL COMMENT 'Letzter Disconnect',

    -- Hardware (vom Daemon gemeldet)
    cpu_cores INT DEFAULT NULL COMMENT 'CPU-Kerne gesamt',
    cpu_threads INT DEFAULT NULL COMMENT 'CPU-Threads gesamt',
    cpu_model VARCHAR(255) DEFAULT NULL COMMENT 'CPU-Modell',
    ram_total_gb DECIMAL(10,2) DEFAULT NULL COMMENT 'RAM gesamt in GB',
    disk_total_gb DECIMAL(10,2) DEFAULT NULL COMMENT 'Speicher gesamt in GB',

    -- Resource Limits (für Overallocation-Kontrolle)
    ram_limit_gb DECIMAL(10,2) DEFAULT NULL COMMENT 'Max. zuweisbares RAM in GB (NULL = unbegrenzt)',
    disk_limit_gb DECIMAL(10,2) DEFAULT NULL COMMENT 'Max. zuweisbarer Speicher in GB (NULL = unbegrenzt)',
    cpu_limit_percent INT DEFAULT NULL COMMENT 'Max. zuweisbare CPU in % (NULL = unbegrenzt)',

    -- Current Usage (vom Daemon aktualisiert)
    cpu_usage_percent DECIMAL(5,2) DEFAULT 0.00 COMMENT 'Aktuelle CPU-Last in %',
    ram_usage_gb DECIMAL(10,2) DEFAULT 0.00 COMMENT 'Aktuell genutztes RAM in GB',
    disk_usage_gb DECIMAL(10,2) DEFAULT 0.00 COMMENT 'Aktuell genutzter Speicher in GB',
    last_stats_update TIMESTAMP NULL DEFAULT NULL COMMENT 'Letzte Hardware-Statistik-Aktualisierung',

    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT 'Erstellungszeitpunkt',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Letzte Änderung',

    -- Indexes
    INDEX idx_guild    (guild_id),
    INDEX idx_owner    (owner_user_id),
    INDEX idx_daemon   (daemon_id),
    INDEX idx_status   (daemon_status),
    INDEX idx_install  (install_status),
    INDEX idx_country  (country_code),
    INDEX idx_dc       (datacenter)

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Physische Maschinen (Nodes) auf denen der FireBot Daemon läuft';
