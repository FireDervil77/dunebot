'use strict';

/**
 * Astro Colony: `-Port` aus dem Startbefehl bestehender Server nehmen.
 *
 * ## Warum
 *
 * Das Paket hat den Schalter am 2026-09-02 abgelegt (Fassung 1.0.10, gleiche
 * Aenderung wie im Windows-Paket 1.0.7). Die Begruendung steht im Paket selbst
 * und ist gemessen, nicht vermutet:
 *
 *   - Der Pelican-Egg und die AMP-Vorlage uebergeben KEINEN Spielport; beide
 *     oeffnen ausschliesslich den Steam-Abfrageport.
 *   - Am Windows-Server gemessen: Auf dem uebergebenen Spielport lauscht kein
 *     Socket, waehrend Steam ihn als Spieladresse bewirbt.
 *   - ✅ Belegt am 2026-09-02 am Linux-Server 181: ohne `-Port` steht vier
 *     Sekunden nach "Adding P2P connection information" ein
 *     "Join succeeded"; vorher 82 s Leerlauf und Abbruch. Der Port ist eine
 *     Kennung INNERHALB von Steam, keine Netzadresse — mit `-Port=25002`
 *     nannte der Server dort die 25002, waehrend der Client die Vorgabe 7777
 *     ansprach.
 *
 * ## Warum eine Migration und kein Nebeneffekt
 *
 * `gameservers.launch_params` ist, was beim Start wirklich ausgefuehrt wird —
 * eingefroren beim Anlegen. Eine Paketaenderung erreicht bestehende Server
 * nicht von selbst; genau dafuer gab es schon einmal eine Migration
 * (`20260811_120000_ark_leere_modliste.js`), und dies ist dieselbe Lage.
 *
 * Am 2026-09-05 gemessen: **ein** Server traegt den Schalter noch (182,
 * "Fires Astro Bude"), in `launch_params` und in `frozen_game_data`.
 *
 * ## Was diese Migration NICHT behauptet
 *
 * Server 182 ist zweimal mit **Code 139 (SIGSEGV)** ausgefallen. Dass `-Port`
 * die Ursache dafuer ist, ist **nicht belegt** — belegt ist nur, dass er das
 * Beitreten verhindert. Hier wird eine bekannte Abweichung zwischen Paket und
 * laufendem Server geradegezogen, mehr nicht. Was danach noch abstuerzt, ist
 * ein eigener Befund.
 */

/** Der Schalter samt Platzhalter, mit dem umgebenden Leerzeichen. */
const MUSTER = /\s*-Port=\{\{port:game\}\}/g;

/**
 * Den Schalter aus einem Startbefehl nehmen.
 *
 * @param {string} befehl Startbefehl
 * @returns {string|null} neuer Befehl, oder null wenn nichts zu tun war
 */
function ohnePort(befehl) {
    if (typeof befehl !== 'string' || !befehl) return null;
    const neu = befehl.replace(MUSTER, '');
    return neu === befehl ? null : neu;
}

module.exports = {
    name: '20260905_140000_astro_colony_port',
    description: 'Astro Colony: -Port aus launch_params und frozen_game_data',

    async up(db) {
        // **Nicht destrukturieren.** `db.query()` liefert die Zeilen direkt.
        const server = await db.query(
            "SELECT id, frozen_game_data, launch_params FROM gameservers " +
            "WHERE launch_params LIKE '%-Port={{port:game}}%' " +
            "   OR frozen_game_data LIKE '%-Port={{port:game}}%'"
        );

        for (const s of server || []) {
            const felder = [];
            const werte = [];

            const neuStart = ohnePort(s.launch_params);
            if (neuStart) {
                felder.push('launch_params = ?');
                werte.push(neuStart);
            }

            // Die eingefrorene Kopie mit — sonst faellt der Startbefehl beim
            // naechsten Umbau wieder auf den alten Stand zurueck.
            if (s.frozen_game_data) {
                let frozen;
                try {
                    frozen = typeof s.frozen_game_data === 'string'
                        ? JSON.parse(s.frozen_game_data)
                        : s.frozen_game_data;
                } catch {
                    frozen = null;   // kein lesbares JSON — nicht anfassen
                }

                const neuFrozen = frozen && ohnePort(frozen?.startup?.command);
                if (neuFrozen) {
                    frozen.startup.command = neuFrozen;
                    felder.push('frozen_game_data = ?');
                    werte.push(JSON.stringify(frozen));
                }
            }

            if (felder.length === 0) continue;

            werte.push(s.id);
            await db.query(`UPDATE gameservers SET ${felder.join(', ')} WHERE id = ?`, werte);
        }

        // ── Die Absturzzeiten geradeziehen ────────────────────────────────
        //
        // `gameserver_crash_logs.timestamp` stand bei jedem Eintrag im Januar
        // 1970: Der Daemon schickt Sekunden, das Dashboard teilte nochmals
        // durch 1000. Der Fehler ist im Code behoben; die vorhandenen Zeilen
        // sind rechenbar, weil der Wert nur um denselben Faktor daneben liegt.
        //
        // Angefasst wird nur, was VOR 2000 datiert — ein richtiger Zeitstempel
        // liegt niemals dort, und so kann die Migration nichts Gutes kaputt
        // machen, wenn sie ein zweites Mal laeuft.
        await db.query(`
            UPDATE gameserver_crash_logs
               SET timestamp = FROM_UNIXTIME(UNIX_TIMESTAMP(timestamp) * 1000)
             WHERE timestamp IS NOT NULL
               AND timestamp < '2000-01-01'
               AND UNIX_TIMESTAMP(timestamp) * 1000 < UNIX_TIMESTAMP('2100-01-01')
        `);
    },

    /**
     * Zurueck auf die alte Form — samt des Fehlers, den die Migration behebt.
     *
     * Eingesetzt wird hinter `-log`, weil der Schalter dort stand. Wer nichts
     * findet, hinter das Programm — beides ist gleichwertig, Unreal wertet die
     * Reihenfolge nicht aus.
     */
    async down(db) {
        const server = await db.query(
            "SELECT id, frozen_game_data, launch_params FROM gameservers " +
            "WHERE launch_params LIKE '%AstroColonyServer%' " +
            "  AND launch_params NOT LIKE '%-Port=%'"
        );

        const zurueck = (befehl) => {
            if (typeof befehl !== 'string' || !befehl) return null;
            if (befehl.includes('-Port=')) return null;
            return befehl.includes(' -log')
                ? befehl.replace(' -log', ' -log -Port={{port:game}}')
                : `${befehl} -Port={{port:game}}`;
        };

        for (const s of server || []) {
            const felder = [];
            const werte = [];

            const alt = zurueck(s.launch_params);
            if (alt) { felder.push('launch_params = ?'); werte.push(alt); }

            if (s.frozen_game_data) {
                let frozen;
                try {
                    frozen = typeof s.frozen_game_data === 'string'
                        ? JSON.parse(s.frozen_game_data) : s.frozen_game_data;
                } catch { frozen = null; }

                const altFrozen = frozen && zurueck(frozen?.startup?.command);
                if (altFrozen) {
                    frozen.startup.command = altFrozen;
                    felder.push('frozen_game_data = ?');
                    werte.push(JSON.stringify(frozen));
                }
            }

            if (!felder.length) continue;
            werte.push(s.id);
            await db.query(`UPDATE gameservers SET ${felder.join(', ')} WHERE id = ?`, werte);
        }
    }
};
