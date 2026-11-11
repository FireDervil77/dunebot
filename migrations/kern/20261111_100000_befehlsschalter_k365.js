'use strict';

/**
 * Drei Schlüssel des Kerns entfernen, die nie etwas bewirkten (K365, 2026-11-11).
 *
 *   DISABLED_PREFIX, DISABLED_SLASH  Listen einzeln abgeschalteter Befehle.
 *       Geschrieben hat sie nur eine nie eingebundene Middleware (mit K340
 *       entfernt); keine Seite in der ganzen Geschichte schickte die Anfrage.
 *       Der Bot las sie an vier Stellen, zwei davon kleingeschrieben, also
 *       immer leer. Einzelne Slash-Befehle schaltet Discord selbst ab
 *       (Servereinstellungen → Integrationen).
 *   INTERACTIONS_CONTEXT  eigener Schalter für Kontextmenüs, ohne Oberfläche.
 *       "0" galt als wahr, die Menüs waren also immer angemeldet. Jetzt
 *       folgen sie dem Schalter für Slash-Befehle (Entscheidung Betreiber
 *       2026-11-11: zwei Hauptschalter, Slash und Präfix).
 *
 * Gemessen vor dem Löschen: 36 Zeilen, 12 Guilds mit je "[]", "[]" und "0".
 * Gesichert lokal in `docs_bak/datenbank-abriss/configs-befehlsschalter-k365-2026-11-11.json`.
 * `down` legt die Zeilen mit diesen Werten für jede Guild wieder an, die den
 * Slash-Schalter hat.
 */
const SCHLUESSEL = ['DISABLED_PREFIX', 'DISABLED_SLASH', 'INTERACTIONS_CONTEXT'];

module.exports = {
    async up(db) {
        await db.query(
            `DELETE FROM configs WHERE plugin_name = 'core' AND config_key IN (?, ?, ?)`,
            SCHLUESSEL
        );
    },

    async down(db) {
        for (const [schluessel, wert] of [['DISABLED_PREFIX', '[]'], ['DISABLED_SLASH', '[]'], ['INTERACTIONS_CONTEXT', '0']]) {
            await db.query(
                `INSERT IGNORE INTO configs (plugin_name, config_key, config_value, context, guild_id, is_global)
                 SELECT 'core', ?, ?, context, guild_id, is_global FROM configs
                  WHERE plugin_name = 'core' AND config_key = 'INTERACTIONS_SLASH'`,
                [schluessel, wert]
            );
        }
    }
};
