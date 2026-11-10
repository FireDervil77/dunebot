'use strict';

/**
 * Drei korrigierte Migrationen anerkennen (K110, 2026-11-10).
 *
 * Vorbild: `20261029_150000_pruefsummen_anerkennen.js` (F21, Betreiber:
 * anerkennen, vorher den Unterschied aufschreiben).
 *
 * K110 hat alle 82 Stellen `const [x] = await db.query(…)` in Migrationen
 * durchgesehen. Der DBService liefert die Zeilen direkt, `[x]` ist also die
 * erste Zeile. 78 Stellen meinen genau das (`if (!x)`, `x.n`) und bleiben.
 * Vier Stellen in drei Dateien behandelten `x` als Liste und sind korrigiert:
 *
 * - `kern/20260327_111415_upgrade_notifications_multilang_delivery.js` — sah
 *   nur die erste Spalte; auf einer frischen Datenbank blieben `title` und
 *   `message` mit NOT NULL stehen, und /admin hätte keine Benachrichtigung
 *   mehr anlegen können.
 * - `gameserver/20260818_140000_pakete_ohne_sichtbarkeit.js` — `.length` an
 *   `undefined` warf, sobald die Spalte schon fehlte; `down()` warf immer.
 * - `streaming/20260826_200000_abonnenten.js` — `Number(Zeile)` ist NaN, ein
 *   Wiederholungslauf hätte die Spalte doppelt angelegt.
 *
 * Dazu eine vierte Datei, die richtig lief, aber einen toten Listenzweig trug:
 *
 * - `greeting/20260101_000001_verification_invite_tracking.js` — prüfte
 *   `existing[0]?.cnt === 0 || existing?.cnt === 0`; gegriffen hat immer der
 *   zweite Teil. Jetzt nur noch `Number(existing?.cnt) === 0`. Geändert, damit
 *   `check-migration-zeilen.js` ohne Ausnahme auskommt.
 *
 * Gemessen am 2026-11-10 vor der Änderung: Die gebuchten Prüfsummen (unten
 * `alt`) gleichen den damaligen Dateien. Die laufende Datenbank trägt keine
 * Spur der Fehler (`notifications` ohne `title`, `packages` ohne
 * `visibility`, `streaming_targets.abo_rolle_id` vorhanden). Geändert hat sich
 * also nur, was eine frische Datenbank oder ein Wiederholungslauf erlebt —
 * deshalb wird nichts erneut ausgeführt, nur die Prüfsumme nachgetragen.
 *
 * Nachgetragen wird die Prüfsumme der heutigen Datei, berechnet wie im
 * MigrationRunner, und nur, wenn in der Zeile noch die alte steht.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const WURZEL = path.join(__dirname, '..', '..');

const ANERKANNT = [
    {
        scope: 'kern',
        source: 'kern',
        filename: '20260327_111415_upgrade_notifications_multilang_delivery.js',
        datei: 'migrations/kern/20260327_111415_upgrade_notifications_multilang_delivery.js',
        alt: '84184220eff592011ed2a123c4c330102b9517480cc5afdc9476ef6125367e69',
    },
    {
        scope: 'plugin',
        source: 'gameserver',
        filename: '20260818_140000_pakete_ohne_sichtbarkeit.js',
        datei: 'plugins/gameserver/migrations/20260818_140000_pakete_ohne_sichtbarkeit.js',
        alt: '761c03fb31461c033731969a8a68571aa9057d6032975cc97e8a3053c43525b3',
    },
    {
        scope: 'plugin',
        source: 'streaming',
        filename: '20260826_200000_abonnenten.js',
        datei: 'plugins/streaming/migrations/20260826_200000_abonnenten.js',
        alt: 'eded002a065421619c8f4e6b72c17a02f76b4cdfae8d030eccc4c210b1efac56',
    },
    {
        scope: 'plugin',
        source: 'greeting',
        filename: '20260101_000001_verification_invite_tracking.js',
        datei: 'plugins/greeting/migrations/20260101_000001_verification_invite_tracking.js',
        alt: '072e90436a6dbe16ab8f936879bdd5bc939dbfd05e870eef90c99e9e33ef1b2e',
    },
];

module.exports = {
    description: 'Prüfsummen von vier korrigierten Migrationen anerkennen (K110)',
    ANERKANNT,

    async up(db) {
        for (const m of ANERKANNT) {
            const pfad = path.join(WURZEL, m.datei);
            if (!fs.existsSync(pfad)) continue;
            const neu = crypto.createHash('sha256').update(fs.readFileSync(pfad, 'utf8')).digest('hex');
            await db.query(
                `UPDATE migrations SET checksum = ?
                  WHERE scope = ? AND source = ? AND filename = ? AND checksum = ?`,
                [neu, m.scope, m.source, m.filename, m.alt]);
        }
    },

    async down(db) {
        for (const m of ANERKANNT) {
            await db.query(
                `UPDATE migrations SET checksum = ?
                  WHERE scope = ? AND source = ? AND filename = ?`,
                [m.alt, m.scope, m.source, m.filename]);
        }
    }
};
