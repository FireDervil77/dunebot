/**
 * Discord — Rollen
 *
 * Umzug am 2026-08-09 aus `apps/dashboard/routes/guild/settings.router.js`.
 * Die Seite ist kein Einstellungsbereich, sondern ein Spiegel der echten
 * Discord-Rollen: Anlegen, Ändern und Löschen wirken sofort auf dem Server.
 *
 * Rechte: früher `CORE.ROLES.VIEW` bzw. `CORE.ROLES.EDIT`, deklariert in
 * `packages/dunebot-core/config/permissions.json`. Der Menüpunkt trug dagegen
 * `CORE.SETTINGS.VIEW` — wer Einstellungen sehen durfte, bekam den Punkt
 * angezeigt und lief dann in die Rechteprüfung der Route.
 *
 * Jetzt `DISCORD.ROLES.*`, Menüpunkt und Route mit demselben Schlüssel.
 * Löschen hat einen eigenen bekommen: es lässt sich nicht rückgängig machen
 * und hing vorher am selben `EDIT` wie das Umbenennen.
 *
 * @module discord/routes/roles
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const { requirePermission } = require('../../../../apps/dashboard/middlewares/permissions.middleware');
const { renderView, fragBot, renderFehler, fehler } = require('./_shared');

/** Discord-Snowflakes sind 17 bis 20 Ziffern. */
const SNOWFLAKE = /^\d{17,20}$/;

// GET / → Rollenübersicht
router.get('/', requirePermission('DISCORD.ROLES.VIEW'), async (req, res) => {
    const guildId = res.locals.guildId;

    try {
        const antwort = await fragBot('dashboard:GET_GUILD_ROLES_DETAILED', { guildId });

        await renderView(res, 'guild/discord-roles', {
            title: 'Discord Rollen',
            activeMenu: `/guild/${guildId}/plugins/discord/roles`,
            guildId,
            roles: antwort?.roles || [],
            botHighestPosition: antwort?.botHighestPosition || 0,
            botHasManageRoles: antwort?.botHasManageRoles || false,
            permissionFlags: antwort?.permissionFlags || []
        });
    } catch (error) {
        return renderFehler(res, error, 'Rollen konnten nicht geladen werden');
    }
});

// POST / → Neue Rolle erstellen
router.post('/', requirePermission('DISCORD.ROLES.EDIT'), async (req, res) => {
    const guildId = res.locals.guildId;
    const { name, color, hoist, mentionable, permissions } = req.body;

    try {
        const ergebnis = await fragBot('dashboard:CREATE_GUILD_ROLE', {
            guildId,
            name,
            color: parseInt(color, 10) || 0,
            hoist,
            mentionable,
            permissions
        });

        if (!ergebnis) {
            return res.status(503).json({ success: false, message: 'Bot nicht verbunden' });
        }
        if (ergebnis.success) {
            return res.json({ success: true, role: ergebnis.role });
        }
        return res.status(400).json({ success: false, message: ergebnis.error || 'Fehler beim Erstellen' });
    } catch (error) {
        return fehler(res, error, 'Rolle konnte nicht erstellt werden');
    }
});

// PUT /:roleId → Rolle bearbeiten
router.put('/:roleId', requirePermission('DISCORD.ROLES.EDIT'), async (req, res) => {
    const guildId = res.locals.guildId;
    const { roleId } = req.params;
    const { name, color, hoist, mentionable, permissions } = req.body;

    if (!SNOWFLAKE.test(roleId || '')) {
        return res.status(400).json({ success: false, message: 'Ungültige Rollen-ID' });
    }

    try {
        const ergebnis = await fragBot('dashboard:UPDATE_GUILD_ROLE', {
            guildId,
            roleId,
            name,
            color: color !== undefined ? (parseInt(color, 10) || 0) : undefined,
            hoist,
            mentionable,
            permissions
        });

        if (!ergebnis) {
            return res.status(503).json({ success: false, message: 'Bot nicht verbunden' });
        }
        if (ergebnis.success) {
            return res.json({ success: true, role: ergebnis.role });
        }
        return res.status(400).json({ success: false, message: ergebnis.error || 'Fehler beim Aktualisieren' });
    } catch (error) {
        return fehler(res, error, 'Rolle konnte nicht aktualisiert werden');
    }
});

// DELETE /:roleId → Rolle löschen
router.delete('/:roleId', requirePermission('DISCORD.ROLES.DELETE'), async (req, res) => {
    const guildId = res.locals.guildId;
    const { roleId } = req.params;

    if (!SNOWFLAKE.test(roleId || '')) {
        return res.status(400).json({ success: false, message: 'Ungültige Rollen-ID' });
    }

    try {
        const ergebnis = await fragBot('dashboard:DELETE_GUILD_ROLE', { guildId, roleId });

        if (!ergebnis) {
            return res.status(503).json({ success: false, message: 'Bot nicht verbunden' });
        }
        if (ergebnis.success) {
            return res.json({ success: true, deletedRoleName: ergebnis.deletedRoleName });
        }
        return res.status(400).json({ success: false, message: ergebnis.error || 'Fehler beim Löschen' });
    } catch (error) {
        return fehler(res, error, 'Rolle konnte nicht gelöscht werden');
    }
});

module.exports = router;
