'use strict';

/**
 * Gruppen flach klopfen
 *
 * Bereitet den Umstieg vom vererbenden auf das flache Rechtemodell vor
 * (WordPress-Linie: eine Gruppe zeigt, was in ihr eingetragen ist – Punkt).
 *
 * Heute lädt `PermissionManager._buildAndCachePermissions()` alle Gruppen mit
 * `priority <= max_priority` des Nutzers und legt sie übereinander. Schaltet man
 * das ohne Vorbereitung ab, verlieren Nutzer genau die Rechte, die sie bisher
 * durch die Hintertür bekamen: In Guild …604584 stehen in „Moderator" 42 Rechte,
 * effektiv hat das Mitglied aber 47 – fünf kommen von „Support".
 *
 * Deshalb schreibt dieser Schritt einmalig auf, was heute tatsächlich gilt.
 * Danach nie wieder.
 *
 * ── Die Regel, und warum sie nicht „alles flach" lautet ───────────────────
 *
 * Geklopft wird nur entlang der **Standardleiter** (user → support → moderator
 * → administrator). Selbst angelegte Gruppen erben weiterhin die Leiter unter
 * sich, **spenden aber nichts mehr nach oben**.
 *
 * Der Grund steht in Guild …643393: Dort liegt eine eigene Gruppe „Gameserver"
 * auf Priorität 0, also unter der Standardgruppe, und vererbt ihre 28 Rechte an
 * alle. Würde man das mit flach klopfen, stünde `GAMESERVER.START` danach
 * dauerhaft in der Gruppe „User" – völlig legitim aussehend, und jeder künftig
 * eingeladene Nutzer hätte es. Der Unfall wäre einbetoniert.
 *
 * Dass dabei niemand etwas verliert, ist nachgerechnet und nicht angenommen:
 * Alle vier Betroffenen sind ausdrücklich Mitglied der Gameserver-Gruppe.
 * `scripts/check-permissions-model.js` meldet für diese Regel null Abweichungen.
 *
 * ── SYSTEM/SUPERADMIN ─────────────────────────────────────────────────────
 *
 * Diese Rechte gehören ausschließlich in die Control-Guild. Beim Schreiben
 * werden sie für alle anderen Guilds entfernt – falls je etwas durchgerutscht
 * ist, endet es hier.
 *
 * ── Ablageort ─────────────────────────────────────────────────────────────
 *
 * Diese Datei gehoert nach `plugins/core/migrations/`. Der erste Anlauf lag in
 * `plugins/core/dashboard/migrations/` – dort liegen zwar die alten
 * 6.6.x/6.7.x/6.8.0-Dateien, aber `MigrationRunner.runPlugin()` liest
 * ausschliesslich `plugins/<name>/migrations/`. Der Ordner wird vom aktuellen
 * Runner nicht mehr angefasst; ein Neustart fuehrte die Migration schlicht nicht
 * aus, ohne dass irgendwo etwas gemeldet wurde.
 */

/** Slugs der mitgelieferten Standardgruppen – nur sie bilden die Leiter. */
const STANDARD_SLUGS = ['administrator', 'moderator', 'support', 'user'];

/** Nur in der Control-Guild zulässig. */
const isRestrictedKey = (key) => /^SYSTEM\./i.test(key) || /^SUPERADMIN/i.test(key);

const parsePerms = (value) => {
    if (!value) return {};
    if (typeof value === 'string') {
        try { return JSON.parse(value); } catch (_) { return {}; }
    }
    return typeof value === 'object' ? value : {};
};

module.exports = {
    description: 'flatten-group-permissions',

    /**
     * @param {object} db - dbService, vom MigrationRunner uebergeben
     */
    async up(db) {
        const { ServiceManager } = require('dunebot-core');
        const Logger = ServiceManager.has('Logger') ? ServiceManager.get('Logger') : console;

        Logger.info('[Migration] Klopfe Gruppen-Rechte flach (Standardleiter)...');

        // Ohne Sicherung wäre der Schritt nicht umkehrbar: Aus dem flachen
        // Zustand lässt sich nicht mehr ablesen, was eine Gruppe selbst
        // mitbrachte und was sie geerbt hat.
        await db.query(`
            CREATE TABLE IF NOT EXISTS guild_groups_permissions_backup (
                group_id    INT UNSIGNED NOT NULL PRIMARY KEY,
                guild_id    VARCHAR(20) NOT NULL,
                permissions JSON NULL COMMENT 'Rechte vor dem Flachklopfen',
                migrated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_guild (guild_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        const controlGuildId = process.env.CONTROL_GUILD_ID || null;
        const guilds = await db.query('SELECT DISTINCT guild_id FROM guild_groups');

        let gruppen = 0, ergaenzt = 0, geerbt = 0, entfernt = 0;

        for (const { guild_id: gid } of guilds) {
            const groups = await db.query(
                'SELECT id, name, slug, priority, permissions FROM guild_groups WHERE guild_id = ? ORDER BY priority ASC',
                [gid]
            );

            // Der kumulative Stand der Standardleiter, aufsteigend aufgebaut.
            let leiter = {};

            for (const group of groups) {
                gruppen++;
                const eigene = parsePerms(group.permissions);
                const istStandard = STANDARD_SLUGS.includes(String(group.slug || '').toLowerCase());

                // INSERT IGNORE: Ein zweiter Lauf darf den bereits flachen
                // Zustand nicht als "Original" festschreiben.
                await db.query(
                    `INSERT IGNORE INTO guild_groups_permissions_backup (group_id, guild_id, permissions)
                     VALUES (?, ?, ?)`,
                    [group.id, gid, JSON.stringify(eigene)]
                );

                let neu;
                if (istStandard) {
                    leiter = { ...leiter, ...eigene };
                    neu = { ...leiter };
                } else {
                    // Eigene Gruppe: erbt die Leiter unter sich, gibt aber nichts
                    // an sie zurück – sie bleibt für die anderen unsichtbar.
                    neu = { ...leiter, ...eigene };
                }

                if (gid !== controlGuildId) {
                    for (const key of Object.keys(neu)) {
                        if (isRestrictedKey(key)) {
                            delete neu[key];
                            entfernt++;
                            Logger.warn(`[Migration] ${gid} · "${group.name}": ${key} entfernt (nur Control-Guild)`);
                        }
                    }
                }

                const dazu = Object.keys(neu).filter(k => !(k in eigene)).length;
                if (dazu > 0) {
                    ergaenzt++;
                    geerbt += dazu;
                    Logger.info(`[Migration] ${gid} · "${group.name}" (Prio ${group.priority}, `
                        + `${istStandard ? 'Standard' : 'eigene'}): `
                        + `${Object.keys(eigene).length} → ${Object.keys(neu).length} Rechte (+${dazu})`);
                }

                await db.query(
                    'UPDATE guild_groups SET permissions = ? WHERE id = ?',
                    [JSON.stringify(neu), group.id]
                );
            }
        }

        Logger.success(`[Migration] Fertig: ${gruppen} Gruppen, ${ergaenzt} ergänzt, `
            + `${geerbt} geerbte Rechte eingeschrieben, ${entfernt} SYSTEM/SUPERADMIN entfernt.`);

        return { success: true, gruppen, ergaenzt, geerbt, entfernt };
    },

    /**
     * Stellt die Rechte aus der Sicherung wieder her.
     */
    async down(db) {
        const { ServiceManager } = require('dunebot-core');
        const Logger = ServiceManager.has('Logger') ? ServiceManager.get('Logger') : console;

        const [vorhanden] = await db.query(`
            SELECT COUNT(*) AS n FROM information_schema.TABLES
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'guild_groups_permissions_backup'
        `);
        if (!Number(vorhanden?.n)) {
            Logger.warn('[Migration] Keine Sicherung vorhanden – nichts wiederherzustellen.');
            return { success: true };
        }

        const rows = await db.query('SELECT group_id, permissions FROM guild_groups_permissions_backup');
        for (const row of rows) {
            await db.query(
                'UPDATE guild_groups SET permissions = ? WHERE id = ?',
                [typeof row.permissions === 'string' ? row.permissions : JSON.stringify(row.permissions), row.group_id]
            );
        }

        Logger.success(`[Migration] ${rows.length} Gruppen aus der Sicherung wiederhergestellt.`);
        return { success: true, wiederhergestellt: rows.length };
    }
};
