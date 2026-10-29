'use strict';

/**
 * Vier Greeting-Rechte ohne Gegenstand entfernen (Baustelle 19b, 2026-10-29).
 *
 * `GREETING.TEMPLATES.CREATE/EDIT/DELETE` und `GREETING.TEST.EXECUTE` standen
 * im Katalog, aber das Plugin hat weder Vorlagen noch einen Testversand: keine
 * Route, kein Knopf, kein Aufruf (nachgesehen in routes/ und views/). Die Rechte
 * ließen sich vergeben und taten nichts — eine Auswahl, die etwas verspricht.
 * Betreiber: „bitte nachziehen und ggf. beheben".
 *
 * Aus `dashboard/permissions.json` sind sie im selben Commit raus. In der
 * Datenbank stehen sie weiter (gemessen 2026-10-29): 4 Zeilen im globalen
 * Katalog, 36 Merkposten, je 10 Gruppen. Muster wie
 * `migrations/kern/20261029_120000_rechtematrix_entfernen.js`: Gruppen
 * zeilenweise, damit eine kaputte Zeile nicht alles aufhält.
 *
 * `down` stellt nichts wieder her — es gäbe wieder vier Rechte ohne Gegenstand.
 */

const SCHLUESSEL = [
    'GREETING.TEMPLATES.CREATE',
    'GREETING.TEMPLATES.EDIT',
    'GREETING.TEMPLATES.DELETE',
    'GREETING.TEST.EXECUTE',
];

module.exports = {
    description: 'Greeting: vier Rechte ohne Route entfernen (Vorlagen, Testversand) — Baustelle 19b',

    async up(db) {
        await db.query('DELETE FROM permission_definitions WHERE permission_key IN (?)', [SCHLUESSEL]);
        await db.query('DELETE FROM guild_permission_seeds WHERE permission_key IN (?)', [SCHLUESSEL]);

        const gruppen = await db.query(
            "SELECT id, permissions FROM guild_groups WHERE permissions LIKE '%GREETING.TEMPLATES.%' OR permissions LIKE '%GREETING.TEST.EXECUTE%'") || [];

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
            if (!rechte || typeof rechte !== 'object') continue;
            let geaendert = false;
            for (const k of SCHLUESSEL) {
                if (k in rechte) { delete rechte[k]; geaendert = true; }
            }
            if (!geaendert) continue;
            const neu = Object.keys(rechte).length ? JSON.stringify(rechte) : null;
            await db.query('UPDATE guild_groups SET permissions = ? WHERE id = ?', [neu, g.id]);
            bereinigt++;
        }

        console.log(`[Migration] Greeting-Rechte: ${bereinigt} Gruppe(n) bereinigt` +
            (uebersprungen ? `, ${uebersprungen} übersprungen (kein lesbares JSON)` : ''));
    },

    async down() {
        // Absichtlich leer, siehe Kopf.
    }
};
