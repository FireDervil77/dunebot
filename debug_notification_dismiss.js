#!/usr/bin/env node

/**
 * Debug-Script für Notification Dismiss Problem
 */

require('dotenv').config({ path: './apps/dashboard/.env' });
const mysql = require('mysql2/promise');

async function debugNotificationDismiss() {
    console.log('🔍 Debug: Notification Dismiss Problem\n');
    
    try {
        const connection = await mysql.createConnection({
            host: process.env.MYSQL_HOST,
            port: process.env.MYSQL_PORT,
            user: process.env.MYSQL_USER,
            password: process.env.MYSQL_PASSWORD,
            database: process.env.MYSQL_DATABASE
        });

        // 1. Prüfen ob es aktive Notifications gibt
        console.log('📋 Aktive Notifications:');
        const [notifications] = await connection.execute(
            'SELECT id, title_translations, type, created_at FROM notifications WHERE dismissed = 0 ORDER BY created_at DESC LIMIT 5'
        );
        console.table(notifications);

        // 2. Prüfen ob es user_configs Einträge gibt
        console.log('\n👤 User Configs mit DISMISSED_NOTIFICATIONS:');
        const [userConfigs] = await connection.execute(
            "SELECT user_id, config_value FROM user_configs WHERE plugin_name = 'core' AND config_key = 'DISMISSED_NOTIFICATIONS'"
        );
        
        if (userConfigs.length > 0) {
            console.table(userConfigs.map(row => ({
                user_id: row.user_id,
                dismissed_count: JSON.parse(row.config_value || '[]').length,
                dismissed_ids: row.config_value
            })));
        } else {
            console.log('❌ KEINE user_configs mit DISMISSED_NOTIFICATIONS gefunden!');
        }

        // 3. Alle user_configs für 'core' Plugin anzeigen  
        console.log('\n🔧 Alle Core User Configs:');
        const [coreConfigs] = await connection.execute(
            "SELECT user_id, config_key, config_value FROM user_configs WHERE plugin_name = 'core' LIMIT 10"
        );
        
        if (coreConfigs.length > 0) {
            console.table(coreConfigs);
        } else {
            console.log('❌ KEINE Core User Configs gefunden!');
        }

        // 4. User Sessions prüfen (falls sessions Tabelle existiert)
        try {
            console.log('\n🔐 Aktive Sessions:');
            const [sessions] = await connection.execute(
                'SELECT session_id, data FROM sessions LIMIT 3'
            );
            console.log(`Anzahl aktive Sessions: ${sessions.length}`);
            
            if (sessions.length > 0) {
                // Versuche Session-Daten zu parsen
                sessions.forEach((session, index) => {
                    try {
                        const data = JSON.parse(session.data);
                        console.log(`Session ${index + 1}: User ID = ${data.user?.info?.id || 'KEINE'}`);
                    } catch (e) {
                        console.log(`Session ${index + 1}: Nicht parseable`);
                    }
                });
            }
        } catch (e) {
            console.log('ℹ️  Keine sessions Tabelle gefunden oder Zugriff verweigert');
        }

        await connection.end();
        
    } catch (error) {
        console.error('❌ Fehler:', error.message);
    }
}

debugNotificationDismiss();