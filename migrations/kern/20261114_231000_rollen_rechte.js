'use strict';

/**
 * Recht für die Kern-Seite „Rollenvergabe“ (G-07, F-G12 Punkt 4, K382, 2026-11-14).
 *
 * Ein Recht im globalen Katalog (`permission_definitions`):
 *   - `CORE.ROLLEN.VIEW`  sehen, welche Rollen der Bot für wen verwaltet
 *     (Besitzer, Träger je Besitzer, Rangfolge-Probleme). Ändern lässt sich
 *     dort nichts; eingestellt wird jede Rolle beim Plugin, das sie vergibt.
 *
 * Gleicher Weg wie `20261114_220000_mitglieder_rechte.js` (G-12):
 * Kern-Rechte erreichen bestehende Guilds nicht von selbst: Beim Start trägt
 * `loadKernelPermissions` nur den Katalog ein, `PluginManager` verteilt nur
 * Rechte aus `plugins/<p>/dashboard/permissions.json`, und `_seedDefaultGroups`
 * läuft nur beim Beitritt einer neuen Guild (dort bekommt die Administrator-
 * Gruppe ohnehin alles). Deshalb hier einmal: das Recht in die Gruppe
 * `administrator` jeder Guild, und als angeboten vermerkt
 * (`guild_permission_seeds`), damit niemand es später nachträgt, wenn ein
 * Admin es bewusst entfernt hat. Andere Gruppen bekommen nichts; weitergeben
 * kann es der Besitzer unter Berechtigungen.
 */
const RECHTE = [
    ['CORE.ROLLEN.VIEW', 'CORE.PERM_ROLLEN_VIEW', 'CORE.PERM_ROLLEN_VIEW_DESC', null, 65],
];

function rechteVon(spalte) {
    if (!spalte) return {};
    if (typeof spalte === 'object') return { ...spalte };
    try {
        const p = JSON.parse(spalte);
        return p && typeof p === 'object' ? p : {};
    } catch {
        return {};
    }
}

module.exports = {
    description: 'Recht CORE.ROLLEN.VIEW für die Seite Rollenvergabe, an die Administrator-Gruppe jeder Guild (G-07)',

    async up(db) {
        for (const [schluessel, name, beschreibung, braucht, reihe] of RECHTE) {
            await db.query(
                `INSERT INTO permission_definitions
                    (permission_key, category, name_translation_key, description_translation_key,
                     is_dangerous, requires_permissions, plugin_name, sort_order, is_active)
                 VALUES (?, 'core', ?, ?, 0, ?, 'kern', ?, 1)
                 ON DUPLICATE KEY UPDATE is_active = 1`,
                [schluessel, name, beschreibung, braucht, reihe]
            );
        }

        const gruppen = await db.query("SELECT id, guild_id, permissions FROM guild_groups WHERE LOWER(slug) = 'administrator'");
        for (const g of gruppen || []) {
            const bekannt = new Set((await db.query(
                'SELECT permission_key FROM guild_permission_seeds WHERE guild_id = ? AND permission_key LIKE ?',
                [g.guild_id, 'CORE.ROLLEN.%']
            ) || []).map((r) => r.permission_key));
            const rechte = rechteVon(g.permissions);
            let dazu = 0;
            for (const [schluessel] of RECHTE) {
                if (bekannt.has(schluessel) || rechte[schluessel] === true) continue;
                rechte[schluessel] = true;
                dazu++;
            }
            if (dazu) {
                await db.query('UPDATE guild_groups SET permissions = ?, updated_at = NOW() WHERE id = ?', [JSON.stringify(rechte), g.id]);
            }
            for (const [schluessel] of RECHTE) {
                await db.query('INSERT IGNORE INTO guild_permission_seeds (guild_id, permission_key) VALUES (?, ?)', [g.guild_id, schluessel]);
            }
        }
    },

    async down(db) {
        const gruppen = await db.query('SELECT id, permissions FROM guild_groups');
        for (const g of gruppen || []) {
            const rechte = rechteVon(g.permissions);
            let weg = 0;
            for (const [schluessel] of RECHTE) if (schluessel in rechte) { delete rechte[schluessel]; weg++; }
            if (weg) {
                const leer = Object.keys(rechte).length === 0;
                await db.query('UPDATE guild_groups SET permissions = ?, updated_at = NOW() WHERE id = ?', [leer ? null : JSON.stringify(rechte), g.id]);
            }
        }
        await db.query("DELETE FROM guild_permission_seeds WHERE permission_key = 'CORE.ROLLEN.VIEW'");
        await db.query("DELETE FROM permission_definitions WHERE permission_key = 'CORE.ROLLEN.VIEW'");
    }
};
