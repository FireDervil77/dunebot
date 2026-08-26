'use strict';

/**
 * Die gespeicherten Discord-Zugangsschluessel aus `users.tokens` entfernen.
 *
 * Zum Befund siehe `docs/Baustellen.md`, Baustelle 74. Kurz: In `users.tokens`
 * lag je Benutzer das OAuth-Ergebnis seiner Discord-Anmeldung als blankes
 * JSON —
 *
 *     { "access_token": "…", "refresh_token": "…",
 *       "token_type": "Bearer", "expires_at": 1756… }
 *
 * — und beim Nachsehen ueber das ganze Projekt hatte **keiner der beiden
 * Schluessel einen Leser**. Die Guildliste wird beim Anmelden einmal geholt
 * und liegt danach in der Sitzung; danach spricht niemand mehr im Namen des
 * Benutzers mit Discord. Gemessen am 2026-08-26: 9 von 9 Zeilen trugen beide
 * Werte.
 *
 * Der Anmeldepfad schreibt sie seit demselben Tag nicht mehr
 * (`auth.controller.js`). Das reinigt aber nur die Zukunft — die vorhandenen
 * Zeilen behalten ihre Schluessel, bis jemand sie anfasst. Genau dafuer ist
 * diese Migration da.
 *
 * ## Warum umschreiben statt leeren
 *
 * `tokens` einfach auf `'{}'` zu setzen waere einfacher, wuerde aber `token_type`
 * und `expires_at` mitnehmen. Die zeigt das Profil an
 * (`routes/guild/profile.router.js`), und sie sind harmlos. Wer angemeldet ist,
 * saehe sonst bis zu seiner naechsten Anmeldung "keine Angaben" — eine
 * Verschlechterung ohne Sicherheitsgewinn.
 *
 * ## Warum in JavaScript und nicht in SQL
 *
 * MariaDB kann mit `JSON_REMOVE` dasselbe. Das setzt aber voraus, dass jede
 * Zeile gueltiges JSON enthaelt; eine einzige kaputte Zeile laesst die ganze
 * Anweisung scheitern, und dann bleiben ALLE Schluessel stehen. Zeilenweise
 * lesen und schreiben ueberspringt Kaputtes und raeumt den Rest.
 *
 * ## Umkehrbar ist das nicht
 *
 * Ein geloeschter Zugangsschluessel kommt nicht zurueck — und soll es auch
 * nicht. Wer ihn braeuchte, meldet sich neu an. `down` stellt deshalb nichts
 * wieder her; es waere gelogen.
 */

module.exports = {
    description: 'Discord-Zugangsschluessel aus users.tokens entfernen (Baustelle 74)',

    async up(db) {
        const zeilen = await db.query(
            "SELECT _id, tokens FROM users WHERE tokens IS NOT NULL AND tokens <> '{}'"
        ) || [];

        let bereinigt = 0;
        let uebersprungen = 0;

        for (const zeile of zeilen) {
            let inhalt;
            try {
                inhalt = typeof zeile.tokens === 'string' ? JSON.parse(zeile.tokens) : zeile.tokens;
            } catch {
                // Kaputtes JSON: nicht anfassen. Es enthaelt zwar
                // moeglicherweise einen Schluessel, aber blind zu ueberschreiben
                // hiesse, Daten zu verlieren, ueber die wir nichts wissen.
                uebersprungen++;
                continue;
            }
            if (!inhalt || typeof inhalt !== 'object') { uebersprungen++; continue; }
            if (!('access_token' in inhalt) && !('refresh_token' in inhalt)) continue;

            delete inhalt.access_token;
            delete inhalt.refresh_token;

            await db.query('UPDATE users SET tokens = ? WHERE _id = ?',
                [JSON.stringify(inhalt), zeile._id]);
            bereinigt++;
        }

        console.log(`[Migration] users.tokens: ${bereinigt} Zeile(n) bereinigt` +
            (uebersprungen ? `, ${uebersprungen} uebersprungen (kein lesbares JSON)` : ''));
    },

    async down() {
        // Absichtlich leer. Siehe Kopf: Ein entfernter Zugangsschluessel laesst
        // sich nicht wiederherstellen, und so zu tun waere schlimmer als nichts.
    }
};
