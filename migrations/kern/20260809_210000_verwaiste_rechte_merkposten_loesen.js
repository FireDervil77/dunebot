'use strict';

/**
 * Schäden des kaputten Abschalt-Pfads beheben.
 *
 * `PermissionManager.unregisterPluginPermissions()` hat bis zum 2026-08-09
 * beim Abschalten eines Plugins in **einer** Guild dessen Rechtedefinitionen
 * global aus `permission_definitions` gelöscht — die Tabelle hat keine
 * `guild_id`, der DELETE hatte keinen Filter. Gleichzeitig wurde
 * `guild_permission_seeds` beim Abschalten nie geleert.
 *
 * Der Code ist repariert. Was in der Datenbank zurückblieb, ist dies:
 * Schlüssel, die einer Guild laut Merkposten „schon angeboten" wurden, die
 * aber in **keiner** ihrer Gruppen mehr stehen. `registerPluginPermissionsForGuild`
 * verteilt nur, was noch nicht vermerkt ist — solche Schlüssel bekommt also nie
 * wieder jemand, obwohl das Plugin läuft.
 *
 * Diese Migration löscht genau diese Merkposten. Verteilt wird nichts: beim
 * nächsten Start bietet der normale Weg die Rechte erneut an und trägt sie
 * wieder in die Administrator-Gruppe ein.
 *
 * **Abwägung, bewusst getroffen:** Ein Schlüssel, den jemand absichtlich aus
 * *allen* Gruppen entfernt hat, sieht genauso aus und käme damit zurück. Das
 * ist in Kauf genommen, weil der andere Fall — ein Plugin, das läuft und das
 * niemand öffnen kann — deutlich häufiger und deutlich schädlicher ist. Wer
 * ein Recht dauerhaft loswerden will, entfernt es aus einzelnen Gruppen; dann
 * bleibt es in der Administrator-Gruppe stehen und diese Migration fasst es
 * nicht an.
 *
 * Nur Guilds mit eingeschaltetem Plugin werden betrachtet. Merkposten von
 * abgeschalteten Plugins sind kein Schaden, sondern der gewollte Zustand —
 * der reparierte Code räumt sie künftig beim Abschalten selbst weg.
 */
module.exports = {
    description: 'Verwaiste Rechte-Merkposten lösen, die der alte Abschalt-Pfad hinterlassen hat',

    async up(db) {
        // Vermerkte Schlüssel, deren Plugin in dieser Guild eingeschaltet ist.
        // Die Gruppenprüfung folgt in JavaScript: `guild_groups.permissions`
        // wird im Projekt mal als Text, mal als JSON gelesen
        // (`typeof … === 'string' ? JSON.parse(…) : …`). Eine SQL-JSON-Funktion
        // würde bei der Textform über ungültigem Inhalt stolpern, und ein
        // LIKE über den Rohtext träfe auch Teilzeichenketten anderer Schlüssel.
        const vermerkt = await db.query(`
            SELECT s.guild_id, s.permission_key
            FROM guild_permission_seeds s
            JOIN permission_definitions d
              ON d.permission_key = s.permission_key
            JOIN guild_plugins p
              ON p.guild_id     = s.guild_id
             AND p.plugin_name  = d.plugin_name
             AND p.is_enabled   = 1
        `);

        if (!vermerkt || vermerkt.length === 0) return;

        // Je Guild einmal die Gruppen laden und zu einer Menge aller
        // zugewiesenen Schlüssel zusammenziehen.
        const zugewiesenJeGuild = new Map();

        const schluesselDerGuild = async (guildId) => {
            if (zugewiesenJeGuild.has(guildId)) return zugewiesenJeGuild.get(guildId);

            const gruppen = await db.query(
                'SELECT permissions FROM guild_groups WHERE guild_id = ?',
                [guildId]
            );

            const menge = new Set();
            for (const gruppe of gruppen || []) {
                let rechte;
                try {
                    rechte = typeof gruppe.permissions === 'string'
                        ? JSON.parse(gruppe.permissions || '{}')
                        : (gruppe.permissions || {});
                } catch {
                    // Unlesbare Gruppe: lieber nichts anfassen, als auf Verdacht
                    // Merkposten zu löschen. Wir tun so, als enthielte sie alles.
                    return null;
                }
                Object.keys(rechte).forEach(k => menge.add(k));
            }

            zugewiesenJeGuild.set(guildId, menge);
            return menge;
        };

        let geloest = 0;
        for (const { guild_id, permission_key } of vermerkt) {
            const zugewiesen = await schluesselDerGuild(guild_id);
            if (zugewiesen === null) continue;          // unlesbare Gruppe, Guild überspringen
            if (zugewiesen.has(permission_key)) continue; // jemand hat das Recht — kein Schaden

            await db.query(
                'DELETE FROM guild_permission_seeds WHERE guild_id = ? AND permission_key = ?',
                [guild_id, permission_key]
            );
            geloest++;
        }

        if (geloest > 0) {
            // Ohne Logger-Dienst in Migrationen: die Zahl gehört trotzdem sichtbar.
            console.log(`[Migration] ${geloest} verwaiste Rechte-Merkposten gelöst`);
        }
    },

    /**
     * Keine Rücknahme.
     *
     * Die gelöschten Merkposten wieder einzutragen hiesse, den kaputten Zustand
     * absichtlich herzustellen — Rechte, die niemand hat und niemand mehr
     * bekommen kann. Es gibt nichts, das eine Rücknahme retten würde.
     */
    async down() {
        return;
    }
};
