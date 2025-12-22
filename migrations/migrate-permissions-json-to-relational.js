/**
 * Migration Script: JSON Permissions → group_permissions Tabelle
 * 
 * Migriert alle Permissions aus guild_groups.permissions (JSON) 
 * in die neue group_permissions Tabelle (relational)
 * 
 * @author FireBot Team
 * @version 1.0.0
 * @date 2025-11-03
 */

const mysql = require('mysql2/promise');
require('dotenv').config({ path: './apps/dashboard/.env' });

// Logging Helper
const log = {
    info: (msg, ...args) => console.log(`[INFO] ${msg}`, ...args),
    success: (msg, ...args) => console.log(`[✅ SUCCESS] ${msg}`, ...args),
    warn: (msg, ...args) => console.warn(`[⚠️  WARN] ${msg}`, ...args),
    error: (msg, ...args) => console.error(`[❌ ERROR] ${msg}`, ...args),
    debug: (msg, ...args) => console.log(`[DEBUG] ${msg}`, ...args)
};

// Statistics
const stats = {
    groupsTotal: 0,
    groupsProcessed: 0,
    groupsSkipped: 0,
    groupsFailed: 0,
    permissionsTotal: 0,
    permissionsInserted: 0,
    permissionsFailed: 0,
    permissionsSkipped: 0
};

/**
 * Migriere Permissions für eine Gruppe
 * @param {object} connection - MySQL Connection
 * @param {object} group - Guild Group Object
 * @returns {Promise<object>} Migration Result
 */
async function migrateGroupPermissions(connection, group) {
    const result = {
        groupId: group.id,
        groupName: group.name,
        permissionsCount: 0,
        inserted: 0,
        failed: 0,
        skipped: 0,
        errors: []
    };
    
    try {
        // 1. Parse JSON Permissions
        let permissions = {};
        if (group.permissions) {
            try {
                permissions = typeof group.permissions === 'string' 
                    ? JSON.parse(group.permissions) 
                    : group.permissions;
            } catch (parseError) {
                log.error(`JSON Parse Error für Gruppe ${group.id} (${group.name}):`, parseError.message);
                result.errors.push(`JSON Parse Error: ${parseError.message}`);
                return result;
            }
        }
        
        // Keine Permissions? Skip!
        if (!permissions || Object.keys(permissions).length === 0) {
            log.debug(`Gruppe ${group.id} (${group.name}) hat keine Permissions - Skip`);
            result.skipped = 0;
            return result;
        }
        
        result.permissionsCount = Object.keys(permissions).length;
        log.info(`Migriere ${result.permissionsCount} Permissions für Gruppe: ${group.name} (ID: ${group.id})`);
        
        // 2. Für jede Permission: Finde ID in permission_definitions
        for (const [permKey, permValue] of Object.entries(permissions)) {
            // Skip wenn Permission = false (nicht zugewiesen)
            if (!permValue) {
                log.debug(`  - ${permKey}: false (Skip)`);
                result.skipped++;
                stats.permissionsSkipped++;
                continue;
            }
            
            try {
                // 2.1 Finde permission_id in permission_definitions
                const [permDefs] = await connection.query(
                    'SELECT id FROM permission_definitions WHERE guild_id = ? AND permission_key = ? LIMIT 1',
                    [group.guild_id, permKey]
                );
                
                if (!permDefs || permDefs.length === 0) {
                    log.warn(`  - ${permKey}: Nicht in permission_definitions gefunden (Guild: ${group.guild_id})`);
                    result.errors.push(`Permission "${permKey}" not found in permission_definitions`);
                    result.failed++;
                    stats.permissionsFailed++;
                    continue;
                }
                
                const permissionId = permDefs[0].id;
                
                // 2.2 Insert in group_permissions (IGNORE falls schon existiert)
                try {
                    await connection.query(
                        `INSERT IGNORE INTO group_permissions 
                         (group_id, permission_id, assigned_at, assigned_by, is_inherited, grant_option) 
                         VALUES (?, ?, NOW(), NULL, 0, 0)`,
                        [group.id, permissionId]
                    );
                    
                    log.debug(`  - ${permKey}: ✅ Inserted (permission_id: ${permissionId})`);
                    result.inserted++;
                    stats.permissionsInserted++;
                    
                } catch (insertError) {
                    // Duplicate Entry ist OK (UNIQUE Constraint)
                    if (insertError.code === 'ER_DUP_ENTRY') {
                        log.debug(`  - ${permKey}: Bereits vorhanden (Skip)`);
                        result.skipped++;
                        stats.permissionsSkipped++;
                    } else {
                        throw insertError;
                    }
                }
                
            } catch (permError) {
                log.error(`  - ${permKey}: Fehler bei Migration:`, permError.message);
                result.errors.push(`${permKey}: ${permError.message}`);
                result.failed++;
                stats.permissionsFailed++;
            }
        }
        
        // 3. Markiere Gruppe als migriert
        if (result.inserted > 0 || result.skipped > 0) {
            await connection.query(
                'UPDATE guild_groups SET permissions_migrated = 1 WHERE id = ?',
                [group.id]
            );
            log.success(`Gruppe ${group.name} migriert: ${result.inserted} inserted, ${result.skipped} skipped, ${result.failed} failed`);
        }
        
        return result;
        
    } catch (error) {
        log.error(`Fehler bei Migration von Gruppe ${group.id}:`, error);
        result.errors.push(error.message);
        return result;
    }
}

/**
 * Hauptfunktion: Migration starten
 */
async function runMigration() {
    let connection;
    
    try {
        log.info('='.repeat(80));
        log.info('Starte Permission Migration: JSON → group_permissions');
        log.info('='.repeat(80));
        
        // 1. Verbinde zu MySQL
        connection = await mysql.createConnection({
            host: process.env.MYSQL_HOST,
            port: process.env.MYSQL_PORT,
            user: process.env.MYSQL_USER,
            password: process.env.MYSQL_PASSWORD,
            database: process.env.MYSQL_DATABASE
        });
        
        log.success('MySQL Verbindung hergestellt');
        
        // 2. Prüfe ob group_permissions Tabelle existiert
        const [tables] = await connection.query(
            "SHOW TABLES LIKE 'group_permissions'"
        );
        
        if (!tables || tables.length === 0) {
            log.error('Tabelle group_permissions existiert nicht!');
            log.error('Bitte erst Migration refactor-permission-system.sql ausführen!');
            process.exit(1);
        }
        
        log.success('Tabelle group_permissions gefunden');
        
        // 3. Hole alle guild_groups (auch bereits migrierte für Re-Migration)
        const [groups] = await connection.query(`
            SELECT 
                id, 
                guild_id, 
                name, 
                slug, 
                permissions, 
                permissions_migrated,
                priority
            FROM guild_groups 
            ORDER BY guild_id, priority DESC
        `);
        
        stats.groupsTotal = groups.length;
        log.info(`Gefunden: ${stats.groupsTotal} Gruppen`);
        log.info('-'.repeat(80));
        
        // 4. Migriere jede Gruppe
        for (const group of groups) {
            // Skip wenn bereits migriert (außer FORCE_REMIGRATE=true)
            if (group.permissions_migrated && !process.env.FORCE_REMIGRATE) {
                log.debug(`Gruppe ${group.id} (${group.name}) bereits migriert - Skip`);
                stats.groupsSkipped++;
                continue;
            }
            
            const result = await migrateGroupPermissions(connection, group);
            
            if (result.errors.length > 0) {
                stats.groupsFailed++;
            } else if (result.inserted > 0 || result.skipped > 0) {
                stats.groupsProcessed++;
            } else {
                stats.groupsSkipped++;
            }
            
            stats.permissionsTotal += result.permissionsCount;
        }
        
        // 5. Abschluss-Statistik
        log.info('='.repeat(80));
        log.success('Migration abgeschlossen!');
        log.info('='.repeat(80));
        log.info('Statistik:');
        log.info(`  Gruppen:`);
        log.info(`    - Total:      ${stats.groupsTotal}`);
        log.info(`    - Verarbeitet: ${stats.groupsProcessed}`);
        log.info(`    - Übersprungen: ${stats.groupsSkipped}`);
        log.info(`    - Fehler:      ${stats.groupsFailed}`);
        log.info(`  Permissions:`);
        log.info(`    - Total (aus JSON): ${stats.permissionsTotal}`);
        log.info(`    - Inserted:         ${stats.permissionsInserted}`);
        log.info(`    - Übersprungen:     ${stats.permissionsSkipped}`);
        log.info(`    - Fehler:           ${stats.permissionsFailed}`);
        log.info('='.repeat(80));
        
        // 6. Verifiziere Migration
        const [verifyCount] = await connection.query(
            'SELECT COUNT(*) as count FROM group_permissions'
        );
        log.info(`Verifizierung: ${verifyCount[0].count} Einträge in group_permissions`);
        
        // 7. Zeige Beispiel-Daten
        const [sampleData] = await connection.query(`
            SELECT 
                group_name,
                permission_key,
                plugin_name,
                assigned_at
            FROM v_group_permissions_detailed 
            LIMIT 5
        `);
        
        if (sampleData.length > 0) {
            log.info('-'.repeat(80));
            log.info('Beispiel-Daten (erste 5 Einträge):');
            sampleData.forEach((row, i) => {
                log.info(`  ${i+1}. ${row.group_name} → ${row.plugin_name}:${row.permission_key}`);
            });
        }
        
        log.info('='.repeat(80));
        
    } catch (error) {
        log.error('Kritischer Fehler bei Migration:', error);
        process.exit(1);
        
    } finally {
        if (connection) {
            await connection.end();
            log.debug('MySQL Verbindung geschlossen');
        }
    }
}

// Script ausführen
if (require.main === module) {
    runMigration()
        .then(() => {
            log.success('Migration Script beendet');
            process.exit(0);
        })
        .catch((error) => {
            log.error('Unerwarteter Fehler:', error);
            process.exit(1);
        });
}

module.exports = { runMigration };
