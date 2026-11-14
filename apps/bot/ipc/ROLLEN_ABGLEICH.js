'use strict';

/**
 * Kern-IPC-Handler: ROLLEN_ABGLEICH (G-07, F-G12 Punkt 3, 2026-11-14)
 *
 * Das Buch `rollen_vergaben` folgt Discord. Solange der Bot läuft, sorgen die
 * Kern-Ereignisse dafür (`guildMemberUpdate`, `guildMemberRemove`,
 * `roleDelete`). Für die Zeit, in der er aus war, fragt das Dashboard einmal
 * am Tag (`core:rollen-abgleich`, `apps/dashboard/helpers/RollenAbgleich.js`).
 *
 * Je Guild dieses Shards, die das Dashboard nennt: Mitgliederliste holen
 * (`Mitglieder.holen`). Ist sie **vollständig**, gehen Einträge zu Rollen, die
 * es nicht mehr gibt, zu Mitgliedern, die nicht mehr da sind, und zu Rollen,
 * die das Mitglied nicht mehr trägt. Ist sie halb, wird in dieser Guild nichts
 * gelöscht (eine halbe Liste sieht aus wie lauter Gegangene).
 *
 * Guilds anderer Shards stehen unter `fremd`, nicht unter `fehler`.
 *
 * @param {{ guildIds: string[] }} payload Guilds mit Einträgen
 * @param {import('discord.js').Client} client
 */
const Mitglieder = require('../helpers/Mitglieder');
const { ServiceManager } = require('dunebot-core');

module.exports = async (payload, client) => {
    const db = ServiceManager.get('dbService');
    const logger = ServiceManager.get('Logger');
    const bericht = { guilds: 0, geloescht: 0, uebersprungen: [], fremd: 0 };

    for (const guildId of (payload?.guildIds || []).map(String)) {
        const guild = client.guilds.cache.get(guildId);
        if (!guild) { bericht.fremd++; continue; }
        bericht.guilds++;

        const { mitglieder, vollstaendig, grund } = await Mitglieder.holen(guild, logger);
        if (!vollstaendig) { bericht.uebersprungen.push({ guildId, grund: grund || 'Liste unvollständig' }); continue; }

        const zeilen = await db.query('SELECT mitglied_id, rolle_id, besitzer FROM rollen_vergaben WHERE guild_id = ?', [guildId]);
        for (const z of zeilen || []) {
            const m = mitglieder.get(String(z.mitglied_id));
            const rolleDa = guild.roles.cache.has(String(z.rolle_id));
            if (m && rolleDa && m.roles.cache.has(String(z.rolle_id))) continue;
            const erg = await db.query(
                'DELETE FROM rollen_vergaben WHERE guild_id = ? AND mitglied_id = ? AND rolle_id = ? AND besitzer = ?',
                [guildId, z.mitglied_id, z.rolle_id, z.besitzer]);
            if (erg?.affectedRows) {
                bericht.geloescht++;
                const warum = !rolleDa ? 'Rolle gelöscht' : !m ? 'Mitglied nicht mehr da' : 'trägt sie nicht mehr';
                logger.info(`[Rollen] Abgleich ${guildId}: Eintrag ${z.besitzer} Rolle ${z.rolle_id} Mitglied ${z.mitglied_id} gelöscht (${warum})`);
            }
        }
    }
    return { success: true, ...bericht };
};
