-- =====================================================
-- Masterserver Plugin - Rootserver Quotas Effective View
-- =====================================================
-- Berechnet die effektiven Quota-Werte pro Rootserver
-- Logik: Custom-Werte haben Vorrang vor Profil-Werten
-- NULL in Custom-Feldern = Nutze Profil-Werte
-- =====================================================

CREATE OR REPLACE VIEW rootserver_quotas_effective AS
SELECT 
    rq.id AS quota_id,
    rq.rootserver_id,
    rq.profile_id,
    
    -- Effektive Werte (Custom hat Vorrang vor Profil)
    COALESCE(rq.custom_ram_mb, qp.ram_mb) AS effective_ram_mb,
    COALESCE(rq.custom_cpu_cores, qp.cpu_cores) AS effective_cpu_cores,
    COALESCE(rq.custom_disk_gb, qp.disk_gb) AS effective_disk_gb,
    COALESCE(rq.custom_max_gameservers, qp.max_gameservers) AS effective_max_gameservers,
    
    -- Reservierte Ressourcen
    rq.reserved_ram_mb,
    rq.reserved_cpu_cores,
    rq.reserved_disk_gb,
    
    -- Custom-Werte (können NULL sein)
    rq.custom_ram_mb,
    rq.custom_cpu_cores,
    rq.custom_disk_gb,
    rq.custom_max_gameservers,
    
    -- Profil-Werte (können NULL sein wenn kein Profil)
    qp.ram_mb AS profile_ram_mb,
    qp.cpu_cores AS profile_cpu_cores,
    qp.disk_gb AS profile_disk_gb,
    qp.max_gameservers AS profile_max_gameservers,
    
    -- Profil-Info
    qp.name AS profile_name,
    qp.display_name AS profile_display_name,
    qp.description AS profile_description,
    
    -- Timestamps
    rq.created_at,
    rq.updated_at
    
FROM rootserver_quotas rq
LEFT JOIN quota_profiles qp ON rq.profile_id = qp.id;
