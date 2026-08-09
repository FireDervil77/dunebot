'use strict';

/**
 * Drei Wege, einen Kanal von AutoMod auszunehmen, werden zu einem.
 *
 * Gefunden bei der Bestandsaufnahme am 2026-08-09
 * (`docs/AutoMod-Bestandsaufnahme.md`, Befunde 3 und 1b):
 *
 * | Weg | wirkte |
 * |---|---|
 * | `automod_settings.whitelisted_channels` (JSON-Spalte) | ja |
 * | `automod_exemptions` (Typ `channel`) | ja |
 * | `moderation_channel_rules.automod_exempt` | **nein** |
 *
 * Die ersten beiden prüfte `messageCreate` nacheinander und taten exakt
 * dasselbe; im Dashboard standen sie sogar auf **derselben Seite** in zwei
 * Karten. Wer einen Kanal ausnehmen wollte, hatte zwei Wege und keinen Hinweis,
 * welcher der richtige ist.
 *
 * Der dritte stand auf der Moderationsseite „Channel-spezifische Regeln", deren
 * Text ausdrücklich versprach, man könne dort „Channels vom AutoMod ausnehmen".
 * **Kein Bot-Prozess hat diese Tabelle je gelesen.** Wer die Ausnahme dort
 * setzte, bekam nichts — ohne jede Rückmeldung.
 *
 * `automod_exemptions` gewinnt: eigene Tabelle statt JSON-Spalte, kann Rollen
 * mit, und die Ausnahmeseite ist der Ort, an dem man danach sucht.
 *
 * ## Warum als Kern-Migration
 *
 * Die Daten fliessen von `moderation` nach `automod`. Läge das in den
 * Plugin-Migrationen, müsste die eine vor der anderen laufen — und zwischen
 * Plugins ist die Reihenfolge nicht zugesichert. Kern-Migrationen laufen vor
 * allen Plugin-Migrationen (`apps/dashboard/app.js`, Zeile 207), damit ist es
 * eindeutig.
 *
 * ## Was mit vorhandenen Einträgen geschieht
 *
 * **Beides wird übernommen, nichts verschwindet.** Besonders bei
 * `automod_exempt`: Das sind Absichtserklärungen von Nutzern, die nie gewirkt
 * haben. Sie stillschweigend zu löschen hiesse, jemandem eine Einstellung
 * wegzunehmen, die er gesetzt hat. Sie werden übernommen — und wirken damit
 * zum ersten Mal.
 */
module.exports = {
    description: 'Kanalausnahmen von AutoMod auf eine Stelle zusammenlegen',

    async up(db) {
        // ── 1. whitelisted_channels → automod_exemptions ────────────────
        if (await spalteExistiert(db, 'automod_settings', 'whitelisted_channels')) {
            const zeilen = await db.query(
                'SELECT guild_id, whitelisted_channels FROM automod_settings WHERE whitelisted_channels IS NOT NULL'
            );

            for (const { guild_id, whitelisted_channels } of zeilen || []) {
                for (const kanalId of leseListe(whitelisted_channels)) {
                    await db.query(
                        `INSERT IGNORE INTO automod_exemptions (guild_id, type, target_id)
                         VALUES (?, 'channel', ?)`,
                        [guild_id, String(kanalId)]
                    );
                }
            }

            await db.query('ALTER TABLE automod_settings DROP COLUMN IF EXISTS whitelisted_channels');
        }

        // ── 2. moderation_channel_rules.automod_exempt → automod_exemptions ──
        //
        // Beide Tabellen können fehlen, wenn eines der Plugins nie installiert
        // war. Dann gibt es hier nichts zu tun.
        if (await spalteExistiert(db, 'moderation_channel_rules', 'automod_exempt')
            && await tabelleExistiert(db, 'automod_exemptions')) {

            const zeilen = await db.query(
                'SELECT guild_id, channel_id FROM moderation_channel_rules WHERE automod_exempt = 1'
            );

            for (const { guild_id, channel_id } of zeilen || []) {
                await db.query(
                    `INSERT IGNORE INTO automod_exemptions (guild_id, type, target_id)
                     VALUES (?, 'channel', ?)`,
                    [guild_id, String(channel_id)]
                );
            }
        }

        if (await spalteExistiert(db, 'moderation_channel_rules', 'automod_exempt')) {
            await db.query('ALTER TABLE moderation_channel_rules DROP COLUMN IF EXISTS automod_exempt');
        }
    },

    /**
     * Zurück: die beiden Spalten wieder anlegen und aus den Ausnahmen füllen.
     *
     * Das ist nicht verlustfrei und kann es nicht sein — nach dem
     * Zusammenlegen lässt sich nicht mehr sagen, welche Ausnahme ursprünglich
     * aus welchem der drei Wege kam. Die Rücknahme trägt deshalb **alle**
     * Kanalausnahmen in `whitelisted_channels` ein und lässt `automod_exempt`
     * leer: der Weg, der ohnehin nie gewirkt hat, muss nicht rekonstruiert
     * werden.
     */
    async down(db) {
        await db.query(`
            ALTER TABLE automod_settings
            ADD COLUMN IF NOT EXISTS whitelisted_channels JSON DEFAULT NULL
        `);

        if (await tabelleExistiert(db, 'moderation_channel_rules')) {
            await db.query(`
                ALTER TABLE moderation_channel_rules
                ADD COLUMN IF NOT EXISTS automod_exempt TINYINT(1) DEFAULT 0
            `);
        }

        const zeilen = await db.query(
            "SELECT guild_id, target_id FROM automod_exemptions WHERE type = 'channel'"
        );

        const jeGuild = new Map();
        for (const { guild_id, target_id } of zeilen || []) {
            if (!jeGuild.has(guild_id)) jeGuild.set(guild_id, []);
            jeGuild.get(guild_id).push(target_id);
        }

        for (const [guildId, ids] of jeGuild) {
            await db.query(
                'UPDATE automod_settings SET whitelisted_channels = ? WHERE guild_id = ?',
                [JSON.stringify(ids), guildId]
            );
        }
    }
};

/**
 * @param {Object} db
 * @param {string} tabelle
 * @returns {Promise<boolean>}
 */
async function tabelleExistiert(db, tabelle) {
    const [treffer] = await db.query(`
        SELECT 1 AS da FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
    `, [tabelle]) || [];
    return Boolean(treffer);
}

/**
 * @param {Object} db
 * @param {string} tabelle
 * @param {string} spalte
 * @returns {Promise<boolean>}
 */
async function spalteExistiert(db, tabelle, spalte) {
    const [treffer] = await db.query(`
        SELECT 1 AS da FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
    `, [tabelle, spalte]) || [];
    return Boolean(treffer);
}

/**
 * `whitelisted_channels` liegt je nach Herkunft als JSON-Text oder als Array vor.
 *
 * @param {string|Array|null} wert
 * @returns {string[]}
 */
function leseListe(wert) {
    if (!wert) return [];
    if (Array.isArray(wert)) return wert;
    try {
        const gelesen = JSON.parse(wert);
        return Array.isArray(gelesen) ? gelesen : [];
    } catch {
        return [];
    }
}
