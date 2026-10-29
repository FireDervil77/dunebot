'use strict';

/**
 * Zwei nachträglich geänderte Migrationen anerkennen (Baustelle 70/80, 2026-10-29).
 *
 * Bei jedem Start stand für zwei schon gelaufene Migrationen „Checksum
 * geändert" im Log. Betreiber (F21): „Empfehlung" — anerkennen, vorher den
 * Unterschied aufschreiben. Nachgesehen im Git, welche Fassung lief (ihre
 * sha256 steht in `migrations.checksum`) und was danach kam:
 *
 * - `core/20260731_130000_flatten_group_permissions.js` — gelaufen in der
 *   Fassung 2847bc0b, geändert in 4acb750b („Legacy-Migrationsordner
 *   gelöscht"). Nur ein **Kommentar**: Der Satz über den alten Ordner
 *   `plugins/core/dashboard/migrations/` sagt jetzt, dass er gelöscht ist.
 * - `streaming/20260907_130000_lose.js` — gelaufen in 35379ea4, geändert in
 *   98f43b37. Kommentar zur Kollation **und** `guild_id` mit
 *   `COLLATE utf8mb4_unicode_ci` im CREATE TABLE. Die gelaufene Fassung legte
 *   die Spalte ohne an; nachgezogen hat sie die Folge-Migration
 *   `20260907_160000_lose_kollation.js`. Gemessen am 2026-10-29:
 *   `streaming_lose.guild_id` ist `utf8mb4_unicode_ci`. Die heutige Fassung
 *   beschreibt also den echten Stand.
 *
 * Nachgetragen wird die Prüfsumme der heutigen Datei, berechnet wie im
 * MigrationRunner (sha256 über den Inhalt, utf8) — und nur, wenn in der Zeile
 * noch die alte steht. Steht dort etwas anderes, ist etwas geschehen, das
 * diese Migration nicht kennt; dann bleibt die Warnung, wie sie ist.
 *
 * Danach fällt eine Warnung „Checksum geändert" wieder auf, statt im Rauschen
 * zweier bekannter unterzugehen.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const WURZEL = path.join(__dirname, '..', '..');

const ANERKANNT = [
    {
        source: 'core',
        filename: '20260731_130000_flatten_group_permissions.js',
        datei: 'plugins/core/migrations/20260731_130000_flatten_group_permissions.js',
        alt: 'ec48003033eaa248e0a59873c7e422cd4ab0c89cceb807bc9c133d968d6ac0c3',
    },
    {
        source: 'streaming',
        filename: '20260907_130000_lose.js',
        datei: 'plugins/streaming/migrations/20260907_130000_lose.js',
        alt: 'cf3a9d88dd47cea7633d3215e637d214e2e0b7a0dfdfb54cfc173b614fc8ac9f',
    },
];

module.exports = {
    description: 'Prüfsummen zweier geänderter Migrationen anerkennen (Baustelle 70/80)',

    async up(db) {
        for (const m of ANERKANNT) {
            const pfad = path.join(WURZEL, m.datei);
            if (!fs.existsSync(pfad)) continue;
            const neu = crypto.createHash('sha256').update(fs.readFileSync(pfad, 'utf8')).digest('hex');
            await db.query(
                `UPDATE migrations SET checksum = ?
                  WHERE scope = 'plugin' AND source = ? AND filename = ? AND checksum = ?`,
                [neu, m.source, m.filename, m.alt]);
        }
    },

    async down(db) {
        for (const m of ANERKANNT) {
            await db.query(
                `UPDATE migrations SET checksum = ?
                  WHERE scope = 'plugin' AND source = ? AND filename = ?`,
                [m.alt, m.source, m.filename]);
        }
    }
};
