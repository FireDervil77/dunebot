/**
 * Einmaliges Script: Alle registrierten Slash-Commands löschen
 * Löscht sowohl globale als auch guild-spezifische Commands.
 *
 * Aufruf: node scripts/clear-slash-commands.js
 */
'use strict';

// BOT_TOKEN kommt aus apps/bot/.env, CLIENT_ID aus apps/dashboard/.env
require('dotenv').config({ path: './apps/bot/.env' });
require('dotenv').config({ path: './apps/dashboard/.env', override: false });
const { REST, Routes } = require('discord.js');

const token = process.env.BOT_TOKEN;
const clientId = process.env.CLIENT_ID;

if (!token || !clientId) {
    console.error('❌ BOT_TOKEN fehlt in apps/bot/.env oder CLIENT_ID fehlt in apps/dashboard/.env');
    process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
    // 1. Globale Commands löschen
    console.log('Lösche globale Slash-Commands...');
    await rest.put(Routes.applicationCommands(clientId), { body: [] });
    console.log('✅ Globale Commands gelöscht');

    // 2. Alle Guilds des Bots abrufen und Guild-Commands löschen
    const guilds = await rest.get(Routes.userGuilds());
    console.log(`Gefunden: ${guilds.length} Guild(s)`);

    for (const guild of guilds) {
        try {
            await rest.put(Routes.applicationGuildCommands(clientId, guild.id), { body: [] });
            console.log(`✅ Guild ${guild.name} (${guild.id}) — Commands gelöscht`);
        } catch (err) {
            console.warn(`⚠️  Guild ${guild.id}: ${err.message}`);
        }
    }

    console.log('\n✅ Fertig! Alle Slash-Commands wurden deregistriert.');
    console.log('Starte den Bot neu damit er die Commands neu registriert.');
})().catch(err => {
    console.error('❌ Fehler:', err);
    process.exit(1);
});
