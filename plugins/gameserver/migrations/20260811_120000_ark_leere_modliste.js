'use strict';

/**
 * ARK: leere Optionen erzeugen keine leeren Parameter mehr.
 *
 * Aus dem Serverprotokoll von Server 159, waehrend des Starts:
 *
 *     ERROR! Failed to start downloading item 0.
 *
 * Der Startbefehl setzte `?GameModIds={{MOD_ID}}` und `-automanagedmods`
 * **immer**. Ist keine Mod gesetzt — der Normalfall — steht dort
 * `?GameModIds=` ohne Wert, und ARK versucht daraufhin, den Mod mit der ID 0
 * zu laden. Der Versuch schlaegt fehl, kostet beim Start Zeit und schreibt
 * eine echte Fehlerzeile in die Konsole.
 *
 * Dieselbe Bauart hat `?ServerPassword={{ARK_PASSWORD}}`: Wer das
 * Beitrittspasswort im Dashboard leert, bekommt `?ServerPassword=` mit leerem
 * Wert direkt vor der naechsten Option. Das ist heute noch nicht aufgefallen,
 * weil bei allen Bestandsservern ein Passwort gesetzt ist — es faellt genau in
 * dem Moment auf, in dem jemand seinen Server oeffentlich machen will.
 *
 * Beide werden jetzt bedingt gesetzt, mit demselben Kniff, den `-NoBattlEye`
 * in dieser Zeile schon benutzt: `$( [ -n "$VAR" ] && printf %s … )`. Die
 * Variablen stehen im Container zur Verfuegung, `$BATTLE_EYE` wird dort
 * unveraendert genauso gelesen.
 *
 * Angefasst werden drei Orte, weil ein laufender Server seine eigene Kopie
 * traegt:
 *   1. `addon_marketplace.game_data`  — gilt fuer neu angelegte Server
 *   2. `gameservers.frozen_game_data` — die eingefrorene Kopie je Server
 *   3. `gameservers.launch_params`    — was beim Start wirklich ausgefuehrt
 *      wird (`StartPayload` liest von dort, nicht aus dem Addon)
 *
 * Wirksam wird es fuer bestehende Server erst beim naechsten **Neustart** —
 * die Ports und Optionen werden beim Start in die Kommandozeile eingesetzt.
 */

const ALT_MODS = '?GameModIds={{MOD_ID}}';
const NEU_MODS = '$( [ -n "$MOD_ID" ] && printf %s "?GameModIds=$MOD_ID" )';

const ALT_AUTO = ' -server -automanagedmods ';
const NEU_AUTO = ' -server$( [ -n "$MOD_ID" ] && printf %s \' -automanagedmods\' ) ';

const ALT_PASS = '?ServerPassword={{ARK_PASSWORD}}';
const NEU_PASS = '$( [ -n "$ARK_PASSWORD" ] && printf %s "?ServerPassword=$ARK_PASSWORD" )';

/**
 * Ersetzt die drei Stellen, sofern sie in ihrer alten Form vorliegen.
 * Laeuft mehrfach durch: was schon umgestellt ist, wird nicht erneut angefasst.
 */
function stelleUm(befehl) {
    if (typeof befehl !== 'string' || !befehl) return null;

    let neu = befehl;
    if (neu.includes(ALT_MODS)) neu = neu.split(ALT_MODS).join(NEU_MODS);
    if (neu.includes(ALT_AUTO)) neu = neu.split(ALT_AUTO).join(NEU_AUTO);
    if (neu.includes(ALT_PASS)) neu = neu.split(ALT_PASS).join(NEU_PASS);

    return neu === befehl ? null : neu;
}

module.exports = {
    async up(db) {
        // ── 1. Addon im Marktplatz ────────────────────────────────────────
        const addons = await db.query(
            "SELECT id, game_data FROM addon_marketplace WHERE game_data LIKE '%GameModIds%'"
        );

        for (const addon of addons || []) {
            let daten;
            try {
                daten = typeof addon.game_data === 'string'
                    ? JSON.parse(addon.game_data)
                    : addon.game_data;
            } catch {
                continue; // kein lesbares JSON — nicht anfassen
            }

            const neu = stelleUm(daten?.startup?.command);
            if (!neu) continue;

            daten.startup.command = neu;
            await db.query(
                'UPDATE addon_marketplace SET game_data = ? WHERE id = ?',
                [JSON.stringify(daten), addon.id]
            );
        }

        // ── 2./3. Bestehende Server: eingefrorene Kopie und Startbefehl ───
        const server = await db.query(
            "SELECT id, frozen_game_data, launch_params FROM gameservers " +
            "WHERE launch_params LIKE '%GameModIds%' OR frozen_game_data LIKE '%GameModIds%'"
        );

        for (const s of server || []) {
            const felder = [];
            const werte = [];

            // launch_params — das ist, was beim Start tatsaechlich laeuft
            const neuStart = stelleUm(s.launch_params);
            if (neuStart) {
                felder.push('launch_params = ?');
                werte.push(neuStart);
            }

            // frozen_game_data — damit die Kopie nicht wieder zurueckfaellt
            if (s.frozen_game_data) {
                let frozen;
                try {
                    frozen = typeof s.frozen_game_data === 'string'
                        ? JSON.parse(s.frozen_game_data)
                        : s.frozen_game_data;
                } catch {
                    frozen = null;
                }

                const neuFrozen = frozen && stelleUm(frozen?.startup?.command);
                if (neuFrozen) {
                    frozen.startup.command = neuFrozen;
                    felder.push('frozen_game_data = ?');
                    werte.push(JSON.stringify(frozen));
                }
            }

            if (felder.length === 0) continue;

            werte.push(s.id);
            await db.query(
                `UPDATE gameservers SET ${felder.join(', ')} WHERE id = ?`,
                werte
            );
        }
    },

    /**
     * Zurueck auf die alte, immer gesetzte Form.
     *
     * Bewusst vollstaendig: die Ruecknahme stellt denselben Wortlaut wieder her,
     * den die Migration vorgefunden hat — samt des Fehlers, den sie behebt.
     */
    async down(db) {
        const zurueck = (befehl) => {
            if (typeof befehl !== 'string' || !befehl) return null;
            let alt = befehl;
            if (alt.includes(NEU_MODS)) alt = alt.split(NEU_MODS).join(ALT_MODS);
            if (alt.includes(NEU_AUTO)) alt = alt.split(NEU_AUTO).join(ALT_AUTO);
            if (alt.includes(NEU_PASS)) alt = alt.split(NEU_PASS).join(ALT_PASS);
            return alt === befehl ? null : alt;
        };

        const addons = await db.query(
            "SELECT id, game_data FROM addon_marketplace WHERE game_data LIKE '%GameModIds%'"
        );
        for (const addon of addons || []) {
            let daten;
            try {
                daten = typeof addon.game_data === 'string'
                    ? JSON.parse(addon.game_data)
                    : addon.game_data;
            } catch { continue; }

            const alt = zurueck(daten?.startup?.command);
            if (!alt) continue;
            daten.startup.command = alt;
            await db.query('UPDATE addon_marketplace SET game_data = ? WHERE id = ?',
                [JSON.stringify(daten), addon.id]);
        }

        const server = await db.query(
            "SELECT id, frozen_game_data, launch_params FROM gameservers " +
            "WHERE launch_params LIKE '%GameModIds%' OR frozen_game_data LIKE '%GameModIds%'"
        );
        for (const s of server || []) {
            const felder = [];
            const werte = [];

            const altStart = zurueck(s.launch_params);
            if (altStart) { felder.push('launch_params = ?'); werte.push(altStart); }

            if (s.frozen_game_data) {
                let frozen;
                try {
                    frozen = typeof s.frozen_game_data === 'string'
                        ? JSON.parse(s.frozen_game_data)
                        : s.frozen_game_data;
                } catch { frozen = null; }

                const altFrozen = frozen && zurueck(frozen?.startup?.command);
                if (altFrozen) {
                    frozen.startup.command = altFrozen;
                    felder.push('frozen_game_data = ?');
                    werte.push(JSON.stringify(frozen));
                }
            }

            if (felder.length === 0) continue;
            werte.push(s.id);
            await db.query(`UPDATE gameservers SET ${felder.join(', ')} WHERE id = ?`, werte);
        }
    }
};
