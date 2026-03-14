/**
 * @file QuotaProfile.js
 * @description Model für Quota-Profile (Templates für Rootserver-Größen)
 * @module plugins/masterserver/dashboard/models/QuotaProfile
 * @author FireBot Development Team
 */

const {ServiceManager} = require('dunebot-core');

class QuotaProfile {
    /**
     * Erstellt ein neues Quota-Profil
     * @param {Object} data - Profil-Daten
     * @param {string} data.name - Interner Name (z.B. 'small', 'medium')
     * @param {string} data.displayName - Anzeigename
     * @param {string} [data.description] - Beschreibung
     * @param {number} data.ramMB - RAM in MB
     * @param {number} data.cpuCores - CPU Cores
     * @param {number} data.diskGB - Disk in GB
     * @param {number} [data.maxGameservers] - Max. Gameserver (NULL = unbegrenzt)
     * @param {boolean} [data.isDefault=false] - Standard-Profil?
     * @returns {Promise<Object>} Erstelltes Profil
     * @throws {Error} Bei Validierungs- oder DB-Fehlern
     */
    static async create(data) {
        const dbService = ServiceManager.get('dbService');
        const Logger = ServiceManager.get('Logger');

        // Validierung
        if (!data.name || !data.displayName) {
            throw new Error('Name und Display-Name sind erforderlich');
        }
        if (!data.ramMB || data.ramMB <= 0) {
            throw new Error('RAM muss größer als 0 sein');
        }
        if (!data.cpuCores || data.cpuCores <= 0) {
            throw new Error('CPU Cores müssen größer als 0 sein');
        }
        if (!data.diskGB || data.diskGB <= 0) {
            throw new Error('Disk GB muss größer als 0 sein');
        }

        try {
            const result = await dbService.query(
                `INSERT INTO quota_profiles 
                (name, display_name, description, ram_mb, cpu_cores, disk_gb, max_gameservers, is_default) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    data.name,
                    data.displayName,
                    data.description || null,
                    data.ramMB,
                    data.cpuCores,
                    data.diskGB,
                    data.maxGameservers || null,
                    data.isDefault || false
                ]
            );

            Logger.info(`[QuotaProfile] Profil erstellt: ${data.name} (ID: ${result.insertId})`);
            return this.getById(result.insertId);
        } catch (error) {
            Logger.error('[QuotaProfile] Fehler beim Erstellen:', error);
            throw error;
        }
    }

    /**
     * Holt ein Profil nach ID
     * @param {number} profileId - Profil-ID
     * @returns {Promise<Object|null>} Profil oder null
     */
    static async getById(profileId) {
        const dbService = ServiceManager.get('dbService');
        const rows = await dbService.query(
            'SELECT * FROM quota_profiles WHERE id = ?',
            [profileId]
        );
        return rows[0] || null;
    }

    /**
     * Holt ein Profil nach Name
     * @param {string} name - Profil-Name
     * @returns {Promise<Object|null>} Profil oder null
     */
    static async getByName(name) {
        const dbService = ServiceManager.get('dbService');
        const rows = await dbService.query(
            'SELECT * FROM quota_profiles WHERE name = ?',
            [name]
        );
        return rows[0] || null;
    }

    /**
     * Holt alle aktiven Profile
     * @param {boolean} [activeOnly=true] - Nur aktive Profile?
     * @returns {Promise<Array>} Array von Profilen
     */
    static async getAll(activeOnly = true) {
        const dbService = ServiceManager.get('dbService');
        const query = activeOnly
            ? 'SELECT * FROM quota_profiles WHERE is_active = TRUE ORDER BY ram_mb ASC'
            : 'SELECT * FROM quota_profiles ORDER BY ram_mb ASC';
        
        const rows = await dbService.query(query);
        return rows;
    }

    /**
     * Holt das Standard-Profil
     * @returns {Promise<Object|null>} Standard-Profil oder null
     */
    static async getDefault() {
        const dbService = ServiceManager.get('dbService');
        const rows = await dbService.query(
            'SELECT * FROM quota_profiles WHERE is_default = TRUE AND is_active = TRUE LIMIT 1'
        );
        return rows[0] || null;
    }

    /**
     * Aktualisiert ein Profil
     * @param {number} profileId - Profil-ID
     * @param {Object} updates - Zu aktualisierende Felder
     * @returns {Promise<Object>} Aktualisiertes Profil
     * @throws {Error} Bei Validierungs- oder DB-Fehlern
     */
    static async update(profileId, updates) {
        const dbService = ServiceManager.get('dbService');
        const Logger = ServiceManager.get('Logger');

        const allowedFields = [
            'display_name', 'description', 'ram_mb', 'cpu_cores', 'disk_gb',
            'max_gameservers', 'is_default', 'is_active'
        ];

        const updateFields = [];
        const updateValues = [];

        for (const [key, value] of Object.entries(updates)) {
            const snakeKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
            if (allowedFields.includes(snakeKey)) {
                updateFields.push(`${snakeKey} = ?`);
                updateValues.push(value);
            }
        }

        if (updateFields.length === 0) {
            throw new Error('Keine gültigen Felder zum Aktualisieren');
        }

        updateValues.push(profileId);

        try {
            await dbService.query(
                `UPDATE quota_profiles SET ${updateFields.join(', ')} WHERE id = ?`,
                updateValues
            );

            Logger.info(`[QuotaProfile] Profil ${profileId} aktualisiert`);
            return this.getById(profileId);
        } catch (error) {
            Logger.error('[QuotaProfile] Fehler beim Aktualisieren:', error);
            throw error;
        }
    }

    /**
     * Löscht ein Profil
     * @param {number} profileId - Profil-ID
     * @returns {Promise<boolean>} true bei Erfolg
     * @throws {Error} Bei DB-Fehlern
     */
    static async delete(profileId) {
        const dbService = ServiceManager.get('dbService');
        const Logger = ServiceManager.get('Logger');

        try {
            // Prüfe ob Profil in Verwendung
            const usage = await dbService.query(
                'SELECT COUNT(*) as count FROM rootserver_quotas WHERE profile_id = ?',
                [profileId]
            );

            if (usage[0].count > 0) {
                throw new Error(`Profil wird von ${usage[0].count} Rootserver(n) verwendet und kann nicht gelöscht werden`);
            }

            await dbService.query('DELETE FROM quota_profiles WHERE id = ?', [profileId]);
            Logger.info(`[QuotaProfile] Profil ${profileId} gelöscht`);
            return true;
        } catch (error) {
            Logger.error('[QuotaProfile] Fehler beim Löschen:', error);
            throw error;
        }
    }

    /**
     * Prüft ob ein Profil-Name bereits existiert
     * @param {string} name - Profil-Name
     * @param {number} [excludeId] - ID zum Ausschließen (für Updates)
     * @returns {Promise<boolean>} true wenn Name existiert
     */
    static async nameExists(name, excludeId = null) {
        const dbService = ServiceManager.get('dbService');
        const query = excludeId
            ? 'SELECT COUNT(*) as count FROM quota_profiles WHERE name = ? AND id != ?'
            : 'SELECT COUNT(*) as count FROM quota_profiles WHERE name = ?';
        
        const params = excludeId ? [name, excludeId] : [name];
        const rows = await dbService.query(query, params);
        return rows[0].count > 0;
    }

    /**
     * Seed Standard-Profile (wird beim Plugin-Enable aufgerufen)
     * @returns {Promise<void>}
     */
    static async seedDefaultProfiles() {
        const dbService = ServiceManager.get('dbService');
        const Logger = ServiceManager.get('Logger');

        const defaultProfiles = [
            {
                name: 'small',
                display_name: 'Klein (8GB RAM, 2 CPU)',
                description: 'Für kleine Projekte mit wenigen Gameservern',
                ram_mb: 8192,
                cpu_cores: 2,
                disk_gb: 100,
                max_gameservers: 5,
                is_default: false
            },
            {
                name: 'medium',
                display_name: 'Mittel (16GB RAM, 4 CPU)',
                description: 'Standard-Profil für die meisten Anwendungsfälle',
                ram_mb: 16384,
                cpu_cores: 4,
                disk_gb: 250,
                max_gameservers: 10,
                is_default: true
            },
            {
                name: 'large',
                display_name: 'Groß (32GB RAM, 8 CPU)',
                description: 'Für größere Projekte mit vielen Servern',
                ram_mb: 32768,
                cpu_cores: 8,
                disk_gb: 500,
                max_gameservers: 25,
                is_default: false
            },
            {
                name: 'enterprise',
                display_name: 'Enterprise (64GB RAM, 16 CPU)',
                description: 'Für sehr große Deployments ohne Gameserver-Limit',
                ram_mb: 65536,
                cpu_cores: 16,
                disk_gb: 1000,
                max_gameservers: null,
                is_default: false
            }
        ];

        try {
            for (const profile of defaultProfiles) {
                // Check if profile exists
                const existing = await dbService.query(
                    'SELECT id FROM quota_profiles WHERE name = ?',
                    [profile.name]
                );

                if (existing.length === 0) {
                    // Insert new profile
                    await dbService.query(
                        `INSERT INTO quota_profiles 
                        (name, display_name, description, ram_mb, cpu_cores, disk_gb, max_gameservers, is_default)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            profile.name,
                            profile.display_name,
                            profile.description,
                            profile.ram_mb,
                            profile.cpu_cores,
                            profile.disk_gb,
                            profile.max_gameservers,
                            profile.is_default
                        ]
                    );
                    Logger.info(`[QuotaProfile] Standard-Profil "${profile.name}" erstellt`);
                } else {
                    // Update existing profile (keep ID but update values)
                    await dbService.query(
                        `UPDATE quota_profiles SET 
                        display_name = ?, description = ?, ram_mb = ?, cpu_cores = ?, 
                        disk_gb = ?, max_gameservers = ? 
                        WHERE name = ?`,
                        [
                            profile.display_name,
                            profile.description,
                            profile.ram_mb,
                            profile.cpu_cores,
                            profile.disk_gb,
                            profile.max_gameservers,
                            profile.name
                        ]
                    );
                    Logger.debug(`[QuotaProfile] Standard-Profil "${profile.name}" aktualisiert`);
                }
            }
        } catch (error) {
            Logger.error('[QuotaProfile] Fehler beim Seeden der Profile:', error);
            throw error;
        }
    }
}

module.exports = QuotaProfile;
