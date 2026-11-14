'use strict';

/**
 * Das Buch der vergebenen Rollen zieht in den Kern (G-07, F-G12, 2026-11-14).
 *
 * `streaming_role_grants` (seit 2026-08-25) kannte keinen Besitzer: Live- und
 * Abo-Rolle standen ohne Unterschied darin. Jetzt führt der Kern ein Buch für
 * alle Systeme, `rollen_vergaben` (Kern-Migration
 * `20261114_230000_rollen_vergaben.js`, läuft vor den Plugins).
 *
 * Jede Zeile wird übernommen, mit dem Besitzer nach der eingestellten Rolle:
 *   - `streaming:abo`, wenn sie die Abo-Rolle eines Ziels dieser Guild ist
 *     oder die Abo-Vorgabe der Guild (`ABO_ROLLE_ID`),
 *   - `streaming:live`, wenn sie die Live-Rolle der Guild ist (`LIVE_ROLLE_ID`),
 *   - beides, wenn beides zutrifft (eine Rolle, zwei Besitzer),
 *   - `streaming:live` sonst (eine alte, abgelöste Rolle: Bis zur Abo-Rolle
 *     am 2026-08-26 gab es nur die Live-Rolle).
 * Gemessen am 2026-11-14: eine Zeile, Abo-Rolle von Ziel 5.
 *
 * Danach geht die Tabelle. `down` legt sie leer wieder an; zurückkopiert wird
 * nicht (der Kern behält das Buch).
 */
/**
 * Besitzer je Zeile, in JS entschieden: Die Tabellen haben verschiedene
 * Kollationen (streaming_role_grants.rolle_id utf8mb4_general_ci), ein
 * Vergleich über Tabellen hinweg wirft „Illegal mix of collations“.
 *
 * @param {Object} db
 * @returns {Promise<Array<{guild_id: string, mitglied_id: string, rolle_id: string, vergeben_am: Date, besitzer: string[]}>>}
 */
async function zeilenMitBesitzer(db) {
    const zeilen = await db.query('SELECT guild_id, mitglied_id, rolle_id, vergeben_am FROM streaming_role_grants');
    const abo = new Set();
    const live = new Set();
    for (const t of await db.query("SELECT guild_id, abo_rolle_id FROM streaming_targets WHERE abo_rolle_id IS NOT NULL AND abo_rolle_id <> ''") || []) {
        abo.add(`${t.guild_id}:${String(t.abo_rolle_id).trim()}`);
    }
    for (const c of await db.query(`SELECT guild_id, config_key, config_value FROM configs
                                     WHERE plugin_name = 'streaming' AND config_key IN ('ABO_ROLLE_ID', 'LIVE_ROLLE_ID')
                                       AND guild_id IS NOT NULL AND config_value IS NOT NULL AND config_value <> ''`) || []) {
        (c.config_key === 'ABO_ROLLE_ID' ? abo : live).add(`${c.guild_id}:${String(c.config_value).trim()}`);
    }
    return (zeilen || []).map((z) => {
        const k = `${z.guild_id}:${z.rolle_id}`;
        const besitzer = [];
        if (abo.has(k)) besitzer.push('streaming:abo');
        if (live.has(k) || !besitzer.length) besitzer.push('streaming:live');
        return { guild_id: String(z.guild_id), mitglied_id: String(z.mitglied_id), rolle_id: String(z.rolle_id), vergeben_am: z.vergeben_am, besitzer };
    });
}

module.exports = {
    description: 'streaming_role_grants geht in rollen_vergaben auf (G-07)',
    zeilenMitBesitzer,

    async up(db) {
        const da = await db.query("SHOW TABLES LIKE 'streaming_role_grants'");
        if (!da?.length) return;

        for (const z of await zeilenMitBesitzer(db)) {
            for (const b of z.besitzer) {
                await db.query(
                    `INSERT IGNORE INTO rollen_vergaben (guild_id, mitglied_id, rolle_id, besitzer, seit)
                     VALUES (?, ?, ?, ?, ?)`,
                    [z.guild_id, z.mitglied_id, z.rolle_id, b, z.vergeben_am]);
            }
        }
        await db.query('DROP TABLE streaming_role_grants');
    },

    async down(db) {
        await db.query(`
            CREATE TABLE IF NOT EXISTS streaming_role_grants (
                id          BIGINT AUTO_INCREMENT PRIMARY KEY,
                guild_id    VARCHAR(32) NOT NULL,
                mitglied_id VARCHAR(32) NOT NULL,
                rolle_id    VARCHAR(32) NOT NULL,
                vergeben_am DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uniq_vergabe (guild_id, mitglied_id, rolle_id),
                KEY idx_rolle (guild_id, rolle_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
    }
};
