/**
 * Umfassende Berechtigungssystem-Diagnose
 * Prüft alle Aspekte des Permission-Systems
 * 
 * @author FireDervil + GitHub Copilot
 * @date 2025-11-03
 */

const mysql = require('mysql2/promise');
require('dotenv').config({ path: './apps/dashboard/.env' });

// ANSI Colors für bessere Lesbarkeit
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
    magenta: '\x1b[35m'
};

function log(color, prefix, message) {
    console.log(`${color}${prefix}${colors.reset} ${message}`);
}

function success(message) {
    log(colors.green, '✅', message);
}

function error(message) {
    log(colors.red, '❌', message);
}

function warning(message) {
    log(colors.yellow, '⚠️', message);
}

function info(message) {
    log(colors.blue, 'ℹ️', message);
}

function header(message) {
    console.log(`\n${colors.bright}${colors.cyan}${'='.repeat(70)}${colors.reset}`);
    console.log(`${colors.bright}${colors.cyan}${message}${colors.reset}`);
    console.log(`${colors.cyan}${'='.repeat(70)}${colors.reset}\n`);
}

async function runDiagnostics() {
    let conn;
    
    try {
        conn = await mysql.createConnection({
            host: process.env.MYSQL_HOST,
            user: process.env.MYSQL_USER,
            password: process.env.MYSQL_PASSWORD,
            database: process.env.MYSQL_DATABASE
        });

        info('Verbindung zur Datenbank hergestellt');
        
        // =====================================================
        // 1. PERMISSION_DEFINITIONS ANALYSE
        // =====================================================
        header('1. PERMISSION DEFINITIONS - Registrierte Berechtigungen');
        
        const [permissions] = await conn.query(`
            SELECT 
                plugin_name as plugin,
                COUNT(*) as total,
                SUM(CASE WHEN category = 'admin' THEN 1 ELSE 0 END) as admin_perms,
                SUM(CASE WHEN category = 'user' THEN 1 ELSE 0 END) as user_perms,
                SUM(CASE WHEN category = 'moderator' THEN 1 ELSE 0 END) as mod_perms,
                SUM(CASE WHEN category = 'dashboard' THEN 1 ELSE 0 END) as dashboard_perms,
                SUM(CASE WHEN category = 'permissions' THEN 1 ELSE 0 END) as permission_perms
            FROM permission_definitions
            GROUP BY plugin_name
            ORDER BY plugin_name
        `);
        
        console.table(permissions);
        
        const totalPerms = permissions.reduce((sum, p) => sum + p.total, 0);
        success(`Gesamt: ${totalPerms} Berechtigungen über ${permissions.length} Plugins`);
        
        // Details pro Plugin
        for (const plugin of permissions) {
            info(`\n📦 Plugin: ${plugin.plugin}`);
            
            const [perms] = await conn.query(`
                SELECT permission_key, name_translation_key as display_name, category
                FROM permission_definitions
                WHERE plugin_name = ?
                ORDER BY category, permission_key
            `, [plugin.plugin]);
            
            console.table(perms);
        }

        // =====================================================
        // 2. GUILD_GROUPS ANALYSE
        // =====================================================
        header('2. GUILD GROUPS - Rollen-Konfiguration');
        
        const [groups] = await conn.query(`
            SELECT 
                gg.guild_id,
                gg.group_name,
                gg.is_default,
                gg.priority,
                COUNT(DISTINCT gp.permission_id) as assigned_permissions,
                gg.created_at
            FROM guild_groups gg
            LEFT JOIN group_permissions gp ON gg.id = gp.group_id
            GROUP BY gg.id
            ORDER BY gg.guild_id, gg.priority DESC
        `);
        
        if (groups.length === 0) {
            warning('Keine Guild-Groups gefunden!');
        } else {
            console.table(groups);
            success(`${groups.length} Guild-Groups gefunden`);
            
            // Default-Groups prüfen
            const defaultGroups = groups.filter(g => g.is_default === 1);
            info(`Default-Groups: ${defaultGroups.length}`);
            
            // Groups ohne Berechtigungen
            const emptyGroups = groups.filter(g => g.assigned_permissions === 0);
            if (emptyGroups.length > 0) {
                warning(`${emptyGroups.length} Groups haben KEINE Berechtigungen!`);
                console.table(emptyGroups.map(g => ({
                    guild_id: g.guild_id,
                    group_name: g.group_name,
                    priority: g.priority
                })));
            }
        }

        // =====================================================
        // 3. GROUP_PERMISSIONS ANALYSE
        // =====================================================
        header('3. GROUP PERMISSIONS - Zuweisungen');
        
        const [assignments] = await conn.query(`
            SELECT 
                gg.guild_id,
                gg.group_name,
                pd.plugin_name as plugin,
                pd.permission_key,
                pd.name_translation_key as display_name,
                gp.has_permission as assigned_value
            FROM group_permissions gp
            JOIN guild_groups gg ON gp.group_id = gg.id
            JOIN permission_definitions pd ON gp.permission_id = pd.id
            ORDER BY gg.guild_id, gg.group_name, pd.plugin_name, pd.permission_key
        `);
        
        if (assignments.length === 0) {
            warning('Keine Permission-Zuweisungen gefunden!');
        } else {
            console.log(`\n${colors.bright}Zuweisungen nach Guild/Group:${colors.reset}`);
            
            // Gruppiere nach Guild und Group
            const byGuildGroup = assignments.reduce((acc, a) => {
                const key = `${a.guild_id}|${a.group_name}`;
                if (!acc[key]) acc[key] = [];
                acc[key].push(a);
                return acc;
            }, {});
            
            for (const [key, perms] of Object.entries(byGuildGroup)) {
                const [guildId, groupName] = key.split('|');
                info(`\n🏰 Guild: ${guildId} | 👥 Group: ${groupName}`);
                
                // Gruppiere nach Plugin
                const byPlugin = perms.reduce((acc, p) => {
                    if (!acc[p.plugin]) acc[p] = [];
                    acc[p.plugin].push(p);
                    return acc;
                }, {});
                
                for (const [plugin, pluginPerms] of Object.entries(byPlugin)) {
                    console.log(`\n  📦 ${plugin}:`);
                    console.table(pluginPerms.map(p => ({
                        permission: p.permission_key,
                        display_name: p.display_name,
                        assigned: p.assigned_value
                    })));
                }
            }
            
            success(`${assignments.length} Permission-Zuweisungen gefunden`);
        }

        // =====================================================
        // 4. FOREIGN KEY CONSTRAINTS PRÜFEN
        // =====================================================
        header('4. FOREIGN KEY CONSTRAINTS - Datenbank-Integrität');
        
        // Prüfe group_permissions → guild_groups
        const [orphanedGroupPerms] = await conn.query(`
            SELECT gp.id, gp.group_id, gp.permission_id
            FROM group_permissions gp
            LEFT JOIN guild_groups gg ON gp.group_id = gg.id
            WHERE gg.id IS NULL
        `);
        
        if (orphanedGroupPerms.length > 0) {
            error(`${orphanedGroupPerms.length} verwaiste group_permissions (group_id existiert nicht)!`);
            console.table(orphanedGroupPerms);
        } else {
            success('Keine verwaisten group_permissions (FK guild_groups)');
        }
        
        // Prüfe group_permissions → permission_definitions
        const [orphanedPermDefs] = await conn.query(`
            SELECT gp.id, gp.group_id, gp.permission_id
            FROM group_permissions gp
            LEFT JOIN permission_definitions pd ON gp.permission_id = pd.id
            WHERE pd.id IS NULL
        `);
        
        if (orphanedPermDefs.length > 0) {
            error(`${orphanedPermDefs.length} verwaiste group_permissions (permission_id existiert nicht)!`);
            console.table(orphanedPermDefs);
        } else {
            success('Keine verwaisten group_permissions (FK permission_definitions)');
        }

        // =====================================================
        // 5. CASCADE DELETE TEST (Simulation)
        // =====================================================
        header('5. CASCADE DELETE - Integrität prüfen');
        
        info('Prüfe ob Foreign Keys korrekt konfiguriert sind...');
        
        const [fkConstraints] = await conn.query(`
            SELECT 
                TABLE_NAME,
                COLUMN_NAME,
                CONSTRAINT_NAME,
                REFERENCED_TABLE_NAME,
                REFERENCED_COLUMN_NAME
            FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
            WHERE TABLE_SCHEMA = ? 
            AND REFERENCED_TABLE_NAME IS NOT NULL
            AND (TABLE_NAME = 'group_permissions' OR TABLE_NAME = 'guild_groups')
            ORDER BY TABLE_NAME, COLUMN_NAME
        `, [process.env.MYSQL_DATABASE]);
        
        console.table(fkConstraints);
        
        if (fkConstraints.length >= 2) {
            success('Foreign Key Constraints sind vorhanden');
        } else {
            error('Foreign Key Constraints fehlen oder sind unvollständig!');
        }
        
        // Prüfe DELETE CASCADE Option
        const [cascadeInfo] = await conn.query(`
            SELECT 
                rc.CONSTRAINT_NAME,
                rc.TABLE_NAME,
                rc.REFERENCED_TABLE_NAME,
                rc.DELETE_RULE,
                rc.UPDATE_RULE
            FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc
            WHERE rc.CONSTRAINT_SCHEMA = ?
            AND (rc.TABLE_NAME = 'group_permissions' OR rc.TABLE_NAME = 'guild_groups')
        `, [process.env.MYSQL_DATABASE]);
        
        console.table(cascadeInfo);
        
        const hasCascade = cascadeInfo.some(c => c.DELETE_RULE === 'CASCADE');
        if (hasCascade) {
            success('CASCADE DELETE ist aktiv');
        } else {
            warning('Keine CASCADE DELETE Regel gefunden - manuelle Cleanup nötig!');
        }

        // =====================================================
        // 6. PLUGIN-LIFECYCLE SIMULATION
        // =====================================================
        header('6. PLUGIN LIFECYCLE - Aktivieren/Deaktivieren simulieren');
        
        info('Teste was passiert wenn Plugin deaktiviert wird...\n');
        
        // Beispiel: Gameserver Plugin
        const testPlugin = 'gameserver';
        
        const [pluginPerms] = await conn.query(`
            SELECT id, permission_key FROM permission_definitions WHERE plugin_name = ?
        `, [testPlugin]);
        
        info(`Plugin "${testPlugin}" hat ${pluginPerms.length} Berechtigungen`);
        
        if (pluginPerms.length > 0) {
            // Prüfe wie viele Zuweisungen betroffen wären
            const permIds = pluginPerms.map(p => p.id);
            const placeholders = permIds.map(() => '?').join(',');
            
            const [affectedAssignments] = await conn.query(`
                SELECT COUNT(*) as count FROM group_permissions WHERE permission_id IN (${placeholders})
            `, permIds);
            
            info(`Bei Deaktivierung würden ${affectedAssignments[0].count} Zuweisungen gelöscht`);
            
            // Prüfe welche Groups betroffen wären
            const [affectedGroups] = await conn.query(`
                SELECT DISTINCT gg.guild_id, gg.group_name, COUNT(gp.id) as perms_lost
                FROM group_permissions gp
                JOIN guild_groups gg ON gp.group_id = gg.id
                WHERE gp.permission_id IN (${placeholders})
                GROUP BY gg.id
            `, permIds);
            
            if (affectedGroups.length > 0) {
                console.log('\nBetroffene Groups:');
                console.table(affectedGroups);
            }
        }

        // =====================================================
        // 7. PERMISSION-CHECK FUNKTIONALITÄT
        // =====================================================
        header('7. PERMISSION CHECK - Zugriffsprüfung simulieren');
        
        info('Simuliere: Hat User X in Guild Y Berechtigung Z?\n');
        
        // Beispiel-Prüfung
        const testGuild = groups.length > 0 ? groups[0].guild_id : null;
        const testPermission = permissions.length > 0 ? 'gameserver.server.create' : null;
        
        if (testGuild && testPermission) {
            info(`Prüfe: Guild ${testGuild} - Permission ${testPermission}`);
            
            // 1. Finde Permission-Definition
            const [permDef] = await conn.query(`
                SELECT id FROM permission_definitions 
                WHERE permission_key = ?
            `, [testPermission]);
            
            if (permDef.length === 0) {
                warning(`Permission "${testPermission}" nicht registriert!`);
            } else {
                success(`Permission gefunden (ID: ${permDef[0].id})`);
                
                // 2. Suche in Guild-Groups (höchste Priority zuerst)
                const [groupValue] = await conn.query(`
                    SELECT gg.group_name, gg.priority, gp.has_permission
                    FROM guild_groups gg
                    JOIN group_permissions gp ON gg.id = gp.group_id
                    WHERE gg.guild_id = ? AND gp.permission_id = ?
                    ORDER BY gg.priority DESC
                    LIMIT 1
                `, [testGuild, permDef[0].id]);
                
                if (groupValue.length > 0) {
                    success(`Permission in Group "${groupValue[0].group_name}" (Priority: ${groupValue[0].priority}): ${groupValue[0].has_permission}`);
                } else {
                    info(`Keine Zuweisung in Groups gefunden`);
                }
            }
        } else {
            warning('Keine Test-Daten für Permission-Check verfügbar');
        }

        // =====================================================
        // 8. ZUSAMMENFASSUNG & EMPFEHLUNGEN
        // =====================================================
        header('8. ZUSAMMENFASSUNG & EMPFEHLUNGEN');
        
        console.log(`${colors.bright}Statistik:${colors.reset}`);
        console.log(`  Plugins mit Permissions:    ${permissions.length}`);
        console.log(`  Gesamt Permissions:         ${totalPerms}`);
        console.log(`  Guild Groups:               ${groups.length}`);
        console.log(`  Permission-Zuweisungen:     ${assignments.length}`);
        console.log(`  Verwaiste Einträge:         ${orphanedGroupPerms.length + orphanedPermDefs.length}`);
        console.log(`  Foreign Key Constraints:    ${fkConstraints.length}`);
        
        console.log(`\n${colors.bright}Status:${colors.reset}`);
        
        let issuesFound = 0;
        
        if (groups.length === 0) {
            error('❌ Keine Guild-Groups gefunden - Permissions können nicht genutzt werden!');
            issuesFound++;
        }
        
        if (assignments.length === 0) {
            error('❌ Keine Permission-Zuweisungen - System ist funktionslos!');
            issuesFound++;
        }
        
        if (orphanedGroupPerms.length > 0 || orphanedPermDefs.length > 0) {
            error(`❌ ${orphanedGroupPerms.length + orphanedPermDefs.length} verwaiste Einträge gefunden!`);
            issuesFound++;
        }
        
        if (fkConstraints.length < 2) {
            error('❌ Foreign Key Constraints fehlen - Datenintegrität gefährdet!');
            issuesFound++;
        }
        
        if (!hasCascade) {
            warning('⚠️  CASCADE DELETE nicht aktiv - manuelle Cleanup nötig!');
        }
        
        if (issuesFound === 0) {
            success('\n✅ BERECHTIGUNGSSYSTEM IST VOLL FUNKTIONSFÄHIG!');
        } else {
            error(`\n❌ ${issuesFound} KRITISCHE PROBLEME GEFUNDEN!`);
        }

    } catch (err) {
        error(`Fehler beim Ausführen der Diagnose: ${err.message}`);
        console.error(err);
    } finally {
        if (conn) {
            await conn.end();
            info('\nDatenbank-Verbindung geschlossen');
        }
    }
}

// Script ausführen
console.log(`${colors.bright}${colors.magenta}`);
console.log('╔═══════════════════════════════════════════════════════════════════╗');
console.log('║   DUNEBOT BERECHTIGUNGSSYSTEM - VOLLSTÄNDIGE DIAGNOSE            ║');
console.log('║   Version 2.0 - Comprehensive Permission System Analysis         ║');
console.log('╚═══════════════════════════════════════════════════════════════════╝');
console.log(colors.reset);

runDiagnostics().catch(err => {
    error('Fataler Fehler:');
    console.error(err);
    process.exit(1);
});
