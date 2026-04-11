require('dotenv').config({ path: 'apps/dashboard/.env' });
const mysql = require('mysql2/promise');

(async () => {
    const conn = await mysql.createConnection({
        host: process.env.MYSQL_HOST || process.env.DB_HOST,
        user: process.env.MYSQL_USER || process.env.DB_USER,
        password: process.env.MYSQL_PASSWORD || process.env.DB_PASSWORD,
        database: process.env.MYSQL_DATABASE || process.env.DB_NAME
    });

    const [full] = await conn.query(
        "SELECT gg.permissions FROM guild_groups gg JOIN guilds g ON gg.guild_id = g._id WHERE gg.slug = 'administrator' AND g.guild_name = 'Haus Ares'"
    );
    const [partial] = await conn.query(
        "SELECT gg.permissions FROM guild_groups gg JOIN guilds g ON gg.guild_id = g._id WHERE gg.slug = 'administrator' AND g.guild_name = 'FireNetworks-FireBot'"
    );

    const fullPerms = Object.keys(JSON.parse(full[0].permissions));
    const partialPerms = Object.keys(JSON.parse(partial[0].permissions));

    const missingInFirenet = fullPerms.filter(p => !partialPerms.includes(p));
    const extraInFirenet = partialPerms.filter(p => !fullPerms.includes(p));

    console.log(`Haus Ares: ${fullPerms.length} permissions`);
    console.log(`FireNetworks: ${partialPerms.length} permissions`);
    console.log(`\nFEHLENDE Permissions in FireNetworks (${missingInFirenet.length}):`);
    missingInFirenet.forEach(p => console.log(`  - ${p}`));

    if (extraInFirenet.length > 0) {
        console.log(`\nEXTRA in FireNetworks (${extraInFirenet.length}):`);
        extraInFirenet.forEach(p => console.log(`  + ${p}`));
    }

    // Check permission_definitions
    const [allDefs] = await conn.query('SELECT permission_key FROM permission_definitions WHERE is_active = 1 ORDER BY permission_key');
    const allKeys = allDefs.map(r => r.permission_key);
    const notInDefs = fullPerms.filter(p => !allKeys.includes(p));
    if (notInDefs.length > 0) {
        console.log(`\n⚠ In Haus Ares Admin aber NICHT in permission_definitions:`);
        notInDefs.forEach(p => console.log(`  ! ${p}`));
    }

    await conn.end();
})();
