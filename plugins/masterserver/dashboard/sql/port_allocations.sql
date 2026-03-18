-- =====================================================
-- Masterserver Plugin - Port Allocations (Pterodactyl-Style)
-- =====================================================
-- Jeder verfügbare Port wird als einzelne Zeile gespeichert.
-- server_id = NULL → Port ist frei und kann zugewiesen werden.
-- Bei Gameserver-Installation wird eine freie Allocation zugewiesen.
-- Bei Gameserver-Löschung wird server_id zurück auf NULL gesetzt.
-- =====================================================

CREATE TABLE IF NOT EXISTS port_allocations (
    id INT AUTO_INCREMENT PRIMARY KEY,

    -- Zugehöriger RootServer (= Node)
    rootserver_id INT NOT NULL COMMENT 'RootServer-ID (Node)',

    -- Netzwerk
    ip VARCHAR(45) NOT NULL COMMENT 'IP-Adresse für diesen Port',
    ip_alias VARCHAR(255) DEFAULT NULL COMMENT 'Alias für die IP (z.B. "Game-IP")',
    port INT NOT NULL COMMENT 'Port-Nummer (1024-65535)',

    -- Zuweisung
    server_id INT DEFAULT NULL COMMENT 'Zugewiesener Gameserver (NULL = frei)',
    notes VARCHAR(256) DEFAULT NULL COMMENT 'Optionale Notizen',
    assigned_at TIMESTAMP NULL DEFAULT NULL COMMENT 'Zeitpunkt der Zuweisung',

    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    -- Constraints
    UNIQUE KEY uk_rootserver_ip_port (rootserver_id, ip, port),
    INDEX idx_rootserver (rootserver_id),
    INDEX idx_server (server_id),
    INDEX idx_available (rootserver_id, server_id),

    FOREIGN KEY (rootserver_id) REFERENCES rootserver(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Port-Allocations pro RootServer (Pterodactyl-Style: jeder Port = eine Zeile)';
