-- =====================================================
-- Masterserver Plugin - Rootserver Resource Summary View
-- =====================================================
-- Zeigt Total/Allocated/Available Ressourcen pro Rootserver
-- Aggregiert Daten aus rootserver, quotas und gameserver_quotas
-- =====================================================

CREATE OR REPLACE VIEW rootserver_resource_summary AS
SELECT 
    rs.id AS rootserver_id,
    rs.name AS rootserver_name,
    rs.guild_id,
    
    -- Effektive Quotas
    rqe.effective_ram_mb AS total_ram_mb,
    rqe.effective_cpu_cores AS total_cpu_cores,
    rqe.effective_disk_gb AS total_disk_gb,
    
    -- Reservierte Ressourcen
    rqe.reserved_ram_mb,
    rqe.reserved_cpu_cores,
    rqe.reserved_disk_gb,
    
    -- Allokierte Ressourcen (Summe aller Gameserver)
    COALESCE(SUM(gq.allocated_ram_mb), 0) AS allocated_ram_mb,
    COALESCE(SUM(gq.allocated_cpu_cores), 0) AS allocated_cpu_cores,
    COALESCE(SUM(gq.allocated_disk_gb), 0) AS allocated_disk_gb,
    
    -- Verfügbare Ressourcen (Total - Reserved - Allocated)
    rqe.effective_ram_mb - rqe.reserved_ram_mb - COALESCE(SUM(gq.allocated_ram_mb), 0) AS available_ram_mb,
    rqe.effective_cpu_cores - rqe.reserved_cpu_cores - COALESCE(SUM(gq.allocated_cpu_cores), 0) AS available_cpu_cores,
    rqe.effective_disk_gb - rqe.reserved_disk_gb - COALESCE(SUM(gq.allocated_disk_gb), 0) AS available_disk_gb,
    
    -- Auslastungs-Prozentsatz
    ROUND((COALESCE(SUM(gq.allocated_ram_mb), 0) / (rqe.effective_ram_mb - rqe.reserved_ram_mb)) * 100, 2) AS ram_usage_percent,
    ROUND((COALESCE(SUM(gq.allocated_cpu_cores), 0) / (rqe.effective_cpu_cores - rqe.reserved_cpu_cores)) * 100, 2) AS cpu_usage_percent,
    ROUND((COALESCE(SUM(gq.allocated_disk_gb), 0) / (rqe.effective_disk_gb - rqe.reserved_disk_gb)) * 100, 2) AS disk_usage_percent,
    
    -- Gameserver-Anzahl
    COUNT(gq.id) AS gameserver_count,
    rqe.effective_max_gameservers AS max_gameservers,
    
    -- Profile Info
    rqe.profile_name,
    rqe.profile_display_name
    
FROM rootserver rs
LEFT JOIN rootserver_quotas_effective rqe ON rs.id = rqe.rootserver_id
LEFT JOIN gameserver_quotas gq ON rs.id = gq.rootserver_id
GROUP BY rs.id, rs.name, rs.guild_id, 
         rqe.effective_ram_mb, rqe.effective_cpu_cores, rqe.effective_disk_gb,
         rqe.reserved_ram_mb, rqe.reserved_cpu_cores, rqe.reserved_disk_gb,
         rqe.effective_max_gameservers, rqe.profile_name, rqe.profile_display_name;
