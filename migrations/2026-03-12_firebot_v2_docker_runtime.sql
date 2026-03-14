-- Migration: FIREBOT_v2 runtime_type für Docker-Unterstützung
-- Stand: 2026-03-12
--
-- runtime_type Bedeutung:
--   docker_steam      — Steam-Spiel via Docker + SteamCMD install container
--   docker_standalone — Standalone-Spiel via Docker (kein Steam)
--   (native_steamcmd und custom bleiben für Altdaten, werden nicht neu angelegt)

ALTER TABLE `addon_marketplace`
  MODIFY COLUMN `runtime_type`
    ENUM('native_steamcmd', 'custom', 'docker_steam', 'docker_standalone')
    NOT NULL DEFAULT 'docker_steam'
    COMMENT 'Laufzeit-Typ: docker_steam = SteamCMD im Container, docker_standalone = eigenes Image';

-- addon_marketplace: source_type um 'pelican' erweitern
ALTER TABLE `addon_marketplace`
  MODIFY COLUMN `source_type`
    ENUM('native', 'pterodactyl', 'lgsm', 'custom', 'pelican')
    NOT NULL DEFAULT 'pelican';

-- gameservers: Docker Container-ID persistieren
ALTER TABLE `gameservers`
  ADD COLUMN `docker_container_id` VARCHAR(64) NULL DEFAULT NULL
    COMMENT 'Docker Container-ID (für Runtime + Stop/Attach)'
    AFTER `daemon_server_id`;
