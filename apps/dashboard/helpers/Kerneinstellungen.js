/**
 * Kerneinstellungen einer Guild: Präfix, Sprache und die zwei Befehlsschalter.
 *
 * Der eine Weg, auf dem diese Werte in `configs` landen (K372, Betreiber
 * 2026-11-11: „/setprefix bleibt erhalten, speichert aber über den
 * Dashboard-Weg“). Zwei Aufrufer:
 *
 *   - die Seite Einstellungen → Allgemein (PUT /guild/:id/settings/general)
 *   - der Discord-Befehl /setprefix, über IPC `core:PRAEFIX_SETZEN`
 *
 * Bis 2026-11-11 schrieb /setprefix im Bot selbst, mit eigener Grenze
 * (2 Zeichen), während die Seite gar nicht prüfte und das Eingabefeld 5
 * erlaubte. Ein Präfix aus dem Dashboard mit 4 Zeichen war in Discord nicht
 * wieder einzugeben.
 *
 * @author FireDervil
 */
'use strict';

/** Längste erlaubte Länge (Betreiber 2026-11-11). Das Eingabefeld hat dieselbe Zahl als maxlength. */
const PRAEFIX_MAX = 5;

/**
 * Prüft einen Präfix, wie er eingegeben wurde.
 *
 * Gezählt wird wie im Browser (`maxlength` zählt UTF-16-Einheiten), damit
 * Seite und Discord dieselbe Grenze ziehen. Leerzeichen sind nicht erlaubt:
 * Der Bot trennt Befehl und Argumente an Leerraum, ein Präfix mit Leerzeichen
 * fände seinen eigenen Befehl nicht.
 *
 * @param {*} roh
 * @returns {{ok: true, praefix: string} | {ok: false, code: 'LEER'|'LEERZEICHEN'|'ZU_LANG', grund: string, max: number}}
 */
function pruefePraefix(roh) {
    const praefix = typeof roh === 'string' ? roh.trim() : '';
    if (!praefix) {
        return { ok: false, code: 'LEER', max: PRAEFIX_MAX, grund: 'Der Präfix darf nicht leer sein.' };
    }
    if (/\s/.test(praefix)) {
        return { ok: false, code: 'LEERZEICHEN', max: PRAEFIX_MAX, grund: 'Der Präfix darf keine Leerzeichen enthalten.' };
    }
    if (praefix.length > PRAEFIX_MAX) {
        return { ok: false, code: 'ZU_LANG', max: PRAEFIX_MAX, grund: `Der Präfix darf höchstens ${PRAEFIX_MAX} Zeichen haben.` };
    }
    return { ok: true, praefix };
}

/**
 * Schreibt Kernwerte einer Guild. Prüft nicht — das tut der Aufrufer vorher,
 * damit ein ungültiger Wert nicht die Hälfte des Formulars speichert.
 *
 * @param {object} dbService
 * @param {string} guildId
 * @param {Object<string, string|number>} werte config_key → Wert
 * @returns {Promise<void>}
 */
async function schreibe(dbService, guildId, werte) {
    for (const [configKey, wert] of Object.entries(werte)) {
        const configValue = typeof wert === 'number' ? wert.toString() : wert;
        await dbService.query(`
            INSERT INTO configs (plugin_name, config_key, config_value, context, guild_id, is_global)
            VALUES ('core', ?, ?, 'shared', ?, 0)
            ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)
        `, [configKey, configValue, guildId]);
    }
}

/**
 * Nur den Präfix setzen — für /setprefix.
 *
 * @param {object} dbService
 * @param {string} guildId
 * @param {*} roh
 * @returns {Promise<ReturnType<typeof pruefePraefix>>}
 */
async function setzePraefix(dbService, guildId, roh) {
    const geprueft = pruefePraefix(roh);
    if (!geprueft.ok) return geprueft;
    await schreibe(dbService, guildId, { PREFIX_COMMANDS_PREFIX: geprueft.praefix });
    return geprueft;
}

module.exports = { PRAEFIX_MAX, pruefePraefix, schreibe, setzePraefix };
