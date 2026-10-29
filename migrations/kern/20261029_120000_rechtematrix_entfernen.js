'use strict';

/**
 * Die Berechtigungsmatrix ist weg (Baustelle 2, 2026-10-29).
 *
 * Betreiber in Baustelle 2: „Die Berechtigungs Matrix macht gar keinen Sinn
 * mehr … Kann also entfernt werden." Am 2026-10-29 bestätigt: „wenn wir sie
 * noch in einer der *.md-Dateien finden mit Erklärung gut, sonst raus." Eine
 * andere Erklärung stand in keinem Dokument.
 *
 * Route, Vorlage, Navigationspunkt und das Recht im Katalog
 * (`packages/dunebot-core/config/permissions.json`) sind im selben Commit raus.
 * Das reinigt aber nur die Zukunft — in der Datenbank steht es weiter:
 *
 *   guild_nav_items          11 Zeilen   `registerNavigation` löscht nie; der
 *                                         Punkt stünde weiter im Menü und
 *                                         führte auf 404
 *   permission_definitions    1 Zeile    der globale Katalog
 *   guild_groups.permissions 11 Gruppen  der Schlüssel im JSON
 *   guild_permission_seeds    9 Zeilen   der Merkposten je Guild
 *
 * (gemessen 2026-10-29). `guild_groups_permissions_backup` bleibt unberührt:
 * Das ist die Sicherung vom Rechte-Umbau, sie soll zeigen, was damals galt.
 *
 * ## Warum die Gruppen in JavaScript
 *
 * Wie in `20260826_150000_discord_token_entfernen`: `JSON_REMOVE` scheitert an
 * einer einzigen kaputten Zeile, und dann bliebe der Schlüssel überall stehen.
 * Zeilenweise überspringt Kaputtes und räumt den Rest.
 *
 * ## down
 *
 * Stellt nichts wieder her. Die Seite gibt es nicht mehr; ein Recht oder ein
 * Menüpunkt dafür wäre wieder genau der tote Rest, den diese Migration räumt.
 */

const SCHLUESSEL = 'PERMISSIONS.MATRIX.VIEW';

module.exports = {
    description: 'Berechtigungsmatrix entfernen: Menüpunkt, Recht, Merkposten (Baustelle 2)',

    async up(db) {
        await db.query("DELETE FROM guild_nav_items WHERE url LIKE '/guild/%/permissions/matrix'");
        await db.query('DELETE FROM permission_definitions WHERE permission_key = ?', [SCHLUESSEL]);
        await db.query('DELETE FROM guild_permission_seeds WHERE permission_key = ?', [SCHLUESSEL]);

        const gruppen = await db.query(
            'SELECT id, permissions FROM guild_groups WHERE permissions LIKE ?', [`%${SCHLUESSEL}%`]) || [];

        let bereinigt = 0;
        let uebersprungen = 0;
        for (const g of gruppen) {
            let rechte;
            try {
                rechte = typeof g.permissions === 'string' ? JSON.parse(g.permissions) : g.permissions;
            } catch {
                uebersprungen++;
                continue;
            }
            if (!rechte || typeof rechte !== 'object' || !(SCHLUESSEL in rechte)) continue;
            delete rechte[SCHLUESSEL];
            // Leer heißt NULL, wie beim Speichern einer Gruppe (Rechte-Umbau).
            const neu = Object.keys(rechte).length ? JSON.stringify(rechte) : null;
            await db.query('UPDATE guild_groups SET permissions = ? WHERE id = ?', [neu, g.id]);
            bereinigt++;
        }

        console.log(`[Migration] Rechtematrix: ${bereinigt} Gruppe(n) bereinigt` +
            (uebersprungen ? `, ${uebersprungen} übersprungen (kein lesbares JSON)` : ''));
    },

    async down() {
        // Absichtlich leer, siehe Kopf.
    }
};
