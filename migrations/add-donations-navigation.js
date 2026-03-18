// migrations/add-donations-navigation.js
const path = require('path');
const { DBService } = require('dunebot-db-client');
const { Logger } = require('dunebot-sdk/utils');
const { ServiceManager } = require('dunebot-core');
require('dotenv').config({ path: './apps/dashboard/.env' });

(async () => {
    // Logger initialisieren (wird von DBService benötigt)
    const logsDir = path.join(__dirname, '..', 'logs');
    const today = new Date();
    const logsFile = `migration-${today.getFullYear()}.${today.getMonth() + 1}.${today.getDate()}.log`;
    Logger.init(path.join(logsDir, logsFile));
    ServiceManager.register('Logger', Logger);
    
    const dbService = new DBService({
        database: process.env.MYSQL_DATABASE,
        username: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        host: process.env.MYSQL_HOST,
        port: process.env.MYSQL_PORT
    });
    
    await dbService.connect();
    
    // Alle Guilds holen
    const guilds = await dbService.query('SELECT _id FROM guilds WHERE left_at IS NULL');
    
    console.log(`📊 Füge Donations-Navigation für ${guilds.length} Guilds hinzu...`);
    
    for (const guild of guilds) {
        const guildId = guild._id;
        
        // Prüfen ob Navigation schon existiert
        const existing = await dbService.query(
            'SELECT id FROM guild_nav_items WHERE guildId = ? AND url = ?',
            [guildId, `/guild/${guildId}/donations`]
        );
        
        if (existing.length > 0) {
            console.log(`⏭️  ${guildId}: Navigation existiert bereits`);
            continue;
        }
        
        // Navigation hinzufügen
        const result = await dbService.query(`
            INSERT INTO guild_nav_items (plugin, guildId, title, url, icon, sort_order, parent, visible, type)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            'core',
            guildId,
            'Donations',
            `/guild/${guildId}/donations`,
            'fas fa-heart',
            100,
            null,
            1,
            'main'
        ]);
        
        const parentId = result.insertId;
        
        // Hall of Fame als Unter-Item
        await dbService.query(`
            INSERT INTO guild_nav_items (plugin, guildId, title, url, icon, sort_order, parent, visible, type)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            'core',
            guildId,
            'Hall of Fame',
            `/guild/${guildId}/hall-of-fame`,
            'fas fa-trophy',
            1,
            parentId.toString(),
            1,
            'main'
        ]);
        
        console.log(`✅ ${guildId}: Navigation hinzugefügt`);
    }
    
    console.log('🎉 Migration abgeschlossen!');
    process.exit(0);
})();