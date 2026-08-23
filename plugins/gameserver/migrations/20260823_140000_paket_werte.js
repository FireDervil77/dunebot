'use strict';

/**
 * Stufe 5a: Ein Server speichert seine Werte unter PAKETSCHLÜSSELN.
 *
 * ── Was bisher galt ─────────────────────────────────────────────────────────
 *
 * Die Werte lagen in `env_variables` unter den EGG-Namen — `SERVER_NAME`,
 * `PASSWORD`, `WORLD`. Das Paket kennt diese Namen nicht; es sagt `name`,
 * `password`, `world_name`. Übersetzt wurde bei jedem Start über die
 * Übergangsdatei (`packages/fbpkg/uebergang/<slug>.json`, Abschnitt
 * `zuordnung`).
 *
 * Diese Brücke trägt seit dem 2026-08-18 und hat einmal einen Weltstand
 * gerettet: Ohne sie hätte der Daemon die PAKETVORGABE für `world_name`
 * genommen — „Dedicated" — während der laufende Server „BoomTown" spielt.
 * Valheim erzeugt bei unbekanntem Weltnamen eine neue, leere Welt.
 *
 * ── Warum sie jetzt fällt ───────────────────────────────────────────────────
 *
 * Solange die Werte nur über Egg-Namen adressierbar sind, kann keine Ansicht
 * aufhören, `game_data` zu lesen — sie bräuchte sonst eine dritte Übersetzung.
 * Die Brücke ist damit nicht bloss Altlast, sie ist der Pflock, an dem die
 * ganze Egg-Welt festhängt.
 *
 * ── Warum HEUTE und nicht später ────────────────────────────────────────────
 *
 * Gemessen am 2026-08-23: **ein** Gameserver. Mit einem ist die Übersetzung
 * vollständig prüfbar. Mit zwanzig ist sie ein Risiko — und wer einen Wert
 * trägt, den die `zuordnung` nicht kennt, verlöre ihn still. Genau die Falle,
 * wegen der die Brücke überhaupt entstanden ist.
 *
 * ── Was diese Migration NICHT tut ───────────────────────────────────────────
 *
 * Sie löscht `env_variables` nicht. Die Werte bleiben doppelt stehen, bis der
 * letzte Leser umgestellt ist. Eine Migration, die die alte Quelle im selben
 * Zug wegnimmt, macht jeden Fehler unumkehrbar — und der teuerste Fehler hier
 * heisst „leere Welt".
 */
module.exports = {
    description: 'Stufe 5a: gameservers.paket_werte — Werte unter Paketschlüsseln',

    async up(db) {
        await db.query(`
            ALTER TABLE gameservers
                ADD COLUMN IF NOT EXISTS paket_werte JSON DEFAULT NULL
                    COMMENT 'Einstellungen unter den Schluesseln des Pakets (Stufe 5a)'
        `);

        // ── Vorhandene Server übersetzen ────────────────────────────────────
        //
        // Nur wo es eine Übergangsdatei gibt und der Server ein Paket hat. Was
        // sich nicht zuordnen lässt, bleibt LEER statt geraten — ein fehlender
        // Wert ist sichtbar, ein falscher nicht.
        const fs = require('fs');
        const path = require('path');
        const ordner = path.join(__dirname, '../../../packages/fbpkg/uebergang');

        const zeilen = await db.query(`
            SELECT gs.id, gs.env_variables, pk.slug
              FROM gameservers gs
              JOIN packages pk ON pk.id = gs.addon_marketplace_id
             WHERE gs.paket_werte IS NULL`);

        for (const z of (zeilen || [])) {
            const datei = path.join(ordner, `${z.slug}.json`);
            if (!fs.existsSync(datei)) continue;

            let zuordnung;
            try {
                zuordnung = JSON.parse(fs.readFileSync(datei, 'utf8')).zuordnung || {};
            } catch { continue; }

            let env = {};
            try {
                env = typeof z.env_variables === 'string'
                    ? JSON.parse(z.env_variables) : (z.env_variables || {});
            } catch { env = {}; }

            const werte = {};
            for (const [paketSchluessel, eggName] of Object.entries(zuordnung)) {
                // Ein leerer String ist ein WERT (SRCDS_BETAID="" heisst „kein
                // Beta-Zweig"). Nur `undefined` heisst „nicht vorhanden".
                if (env[eggName] !== undefined) werte[paketSchluessel] = String(env[eggName]);
            }

            await db.query('UPDATE gameservers SET paket_werte = ? WHERE id = ?',
                [JSON.stringify(werte), z.id]);
        }
    },

    async down(db) {
        await db.query('ALTER TABLE gameservers DROP COLUMN IF EXISTS paket_werte');
    }
};
