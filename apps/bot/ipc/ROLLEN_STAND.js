'use strict';

/**
 * Kern-IPC-Handler: ROLLEN_STAND (G-07, K382, 2026-11-14)
 *
 * Für die Kern-Seite „Rollenvergabe“ und den Hinweis am Rollenfeld: je Rolle
 * Name, Farbe, ob der Bot sie vergeben darf (`Rollen.pruefe`) und, wenn
 * `traeger` verlangt ist, wer sie trägt. Die Träger kommen über
 * `Mitglieder.holen` (Frist 15 s); eine halbe Liste sagt
 * `vollstaendig: false` mit Grund, die Seite zeigt dann keine Zahlen.
 *
 * Schreibt nichts.
 *
 * @param {{ guildId: string, rollen: string[], traeger?: boolean }} payload
 * @param {import('discord.js').Client} client
 */
const Rollen = require('dunebot-sdk/lib/Rollen');
const Mitglieder = require('../helpers/Mitglieder');
const { ServiceManager } = require('dunebot-core');

const ID = /^\d{5,32}$/;
const HOECHSTENS = 250;

module.exports = async (payload, client) => {
    const guildId = String(payload?.guildId ?? '');
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return { success: false, error: 'Guild nicht gefunden', code: 10004 };

    const rollen = [...new Set((payload?.rollen || []).map(String).filter((r) => ID.test(r)))].slice(0, HOECHSTENS);
    const ich = guild.members.me;

    let traeger = null;
    let vollstaendig = null;
    let grund = null;
    if (payload?.traeger) {
        const geholt = await Mitglieder.holen(guild, ServiceManager.get('Logger'));
        vollstaendig = geholt.vollstaendig;
        grund = geholt.grund;
        if (vollstaendig) {
            traeger = {};
            for (const r of rollen) traeger[r] = [];
            for (const m of geholt.mitglieder.values()) {
                for (const r of rollen) if (m.roles.cache.has(r)) traeger[r].push(String(m.id));
            }
        }
    }

    const stand = rollen.map((id) => {
        const { rolle, grund: problem } = Rollen.pruefe(guild, id);
        return {
            id,
            name: rolle?.name ?? null,
            farbe: rolle ? rolle.hexColor : null,
            position: rolle ? rolle.position : null,
            problem,
            traeger: traeger ? traeger[id] : null,
        };
    });

    return {
        success: true,
        bot: { name: ich?.displayName ?? null, rolle: ich?.roles?.highest?.name ?? null },
        rollen: stand,
        vollstaendig,
        grund,
    };
};
