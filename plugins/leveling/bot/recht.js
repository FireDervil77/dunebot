'use strict';

/**
 * Leveling: Rechte der Befehle (LV-1e, LV-1h, 2026-11-15).
 *
 * Die Verwaltungsbefehle (`/levels sync`, `/xp …`) fragen ein Recht aus dem
 * Rechtesystem, nicht eine Discord-Berechtigung (Konzept §11). Entschieden
 * wird im Dashboard über die Kern-Aktion `core:RECHT_PRUEFEN` (derselbe
 * PermissionManager wie im Web). Ohne Antwort von dort läuft nichts.
 *
 * @module leveling/bot/recht
 */

const { ServiceManager } = require('dunebot-core');

const FRIST_MS = 15_000;

/**
 * @param {import('discord.js').Guild} guild
 * @param {import('discord.js').User} user
 * @param {string} recht z. B. `LEVELING.XP.MANAGE`
 * @returns {Promise<{darf: boolean, fehler: string|null}>}
 */
async function darf(guild, user, recht) {
    const ipc = ServiceManager.get('ipcClient');
    if (!ipc) return { darf: false, fehler: 'keine Verbindung zum Dashboard' };
    const a = await ipc.sendToDashboard('core:RECHT_PRUEFEN', { guild_id: guild.id, actor_user_id: user.id, recht }, FRIST_MS);
    if (!a?.success) return { darf: false, fehler: a?.error || 'keine Antwort' };
    return { darf: a.data?.darf === true, fehler: null };
}

module.exports = { darf };
