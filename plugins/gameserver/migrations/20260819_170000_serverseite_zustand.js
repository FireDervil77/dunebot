'use strict';

/**
 * Zwei Angaben, die die neue Serverseite braucht und die es nirgends gibt.
 *
 * Der Entwurf vom 2026-08-18 zeigt oben auf der Serverseite zwei Dinge, für die
 * bei der Bestandsaufnahme am 2026-08-19 keine Quelle zu finden war:
 *
 *   „Seit 4 Std. 12 Min. ohne Unterbrechung"   → es gibt kein `started_at`
 *   Umschalter „Einfach | Fachlich"            → es gibt keine Ablage dafür
 *
 * Alles andere auf dieser Seite hat eine: Spielerliste samt Ping kommt aus
 * `QueryService`, Einstellungen und ihr `takes_effect` aus dem Paket,
 * Sicherungen aus `gameserver_backups`, Kennzahlen aus `server_metrics`.
 *
 * ── Warum `laeuft_seit` und nicht eine Laufzeit in Sekunden ─────────────────
 *
 * Eine Dauer veraltet in dem Moment, in dem sie geschrieben wird, und müsste
 * fortgeschrieben werden. Ein Zeitpunkt nicht: Die Dauer rechnet die Anzeige
 * aus, und sie stimmt immer. Beim Stoppen wird der Zeitpunkt auf NULL gesetzt —
 * „läuft seit nichts" ist ehrlicher als eine eingefrorene Dauer.
 *
 * ── Warum die Höhe am SERVER hängt und nicht am Benutzer ────────────────────
 *
 * Der Betreiber hat das am 2026-08-18 entschieden und besser begründet, als der
 * Vorschlag war: Der Server ist der Punkt der Wahrheit. Sobald mehrere Leute
 * Rechte auf denselben Server haben, wäre eine Einstellung je Benutzer bloss ein
 * Zustand — zwei Personen sähen dieselbe Karte verschieden und redeten
 * aneinander vorbei.
 *
 * Vorgabe ist `einfach`. Wer mehr sehen will, sagt es; wer nichts sagt, soll
 * nicht mit `risk: world_reset` begrüsst werden.
 */

module.exports = {
    async up(db) {
        const [spalten] = await db.query('SHOW COLUMNS FROM gameservers');
        const hat = (name) => spalten.some(s => s.Field === name);

        if (!hat('laeuft_seit')) {
            await db.query(`
                ALTER TABLE gameservers
                ADD COLUMN laeuft_seit DATETIME NULL DEFAULT NULL
                COMMENT 'Zeitpunkt des letzten erfolgreichen Starts; NULL = laeuft nicht'
            `);
        }

        if (!hat('ansicht')) {
            await db.query(`
                ALTER TABLE gameservers
                ADD COLUMN ansicht ENUM('einfach','fachlich') NOT NULL DEFAULT 'einfach'
                COMMENT 'Hoehenstufe der Serverseite — gilt fuer den Server, nicht fuer den Betrachter'
            `);
        }
    },

    async down(db) {
        const [spalten] = await db.query('SHOW COLUMNS FROM gameservers');
        const hat = (name) => spalten.some(s => s.Field === name);
        if (hat('laeuft_seit')) await db.query('ALTER TABLE gameservers DROP COLUMN laeuft_seit');
        if (hat('ansicht'))     await db.query('ALTER TABLE gameservers DROP COLUMN ansicht');
    },
};
