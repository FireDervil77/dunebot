/**
 * Plugin Update System - Database Migrations
 * Erstellt plugin_versions Tabelle und SuperAdmin Config
 * @author FireDervil
 */

const dotenv = require('dotenv');
const mysql = require('mysql2/promise');
const fs = require('fs').promises;
const path = require('path');

// Load .env from correct path
const envPath = path.join(__dirname, '..', 'apps', 'dashboard', '.env');
console.log('Loading ENV from:', envPath);
dotenv.config({ path: envPath });

async function runMigrations() {
    console.log('🔄 Starting Plugin Update System migrations...\n');

    console.log('DB Config:', {
        host: process.env.MYSQL_HOST,
        port: process.env.MYSQL_PORT,
        user: process.env.MYSQL_USER,
        database: process.env.MYSQL_DATABASE
    });

    const connection = await mysql.createConnection({
        host: process.env.MYSQL_HOST,
        port: process.env.MYSQL_PORT,
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE,
        multipleStatements: true
    });

    try {
        // 1. plugin_versions Tabelle
        console.log('📊 Creating plugin_versions table...');
        const sql1 = await fs.readFile(
            path.join(__dirname, 'create_plugin_versions_table.sql'),
            'utf8'
        );
        await connection.query(sql1);
        console.log('✅ plugin_versions table created\n');

        // 2. SuperAdmin Config
        console.log('⚙️  Adding SuperAdmin config...');
        const sql2 = await fs.readFile(
            path.join(__dirname, 'add_plugin_update_config.sql'),
            'utf8'
        );
        await connection.query(sql2);
        console.log('✅ SuperAdmin config added\n');

        // Verify
        const [tables] = await connection.query(`
            SHOW TABLES LIKE 'plugin_versions'
        `);
        
        const [configs] = await connection.query(`
            SELECT * FROM superadmin_config 
            WHERE config_key LIKE 'plugin_%'
        `);

        console.log('📋 Verification:');
        console.log(`   - plugin_versions table: ${tables.length > 0 ? '✅' : '❌'}`);
        console.log(`   - SuperAdmin configs: ${configs.length} entries`);
        
        configs.forEach(cfg => {
            console.log(`     • ${cfg.config_key} = ${cfg.config_value}`);
        });

        console.log('\n✅ All migrations completed successfully!');

    } catch (error) {
        console.error('❌ Migration failed:', error);
        throw error;
    } finally {
        await connection.end();
    }
}

runMigrations().catch(console.error);
