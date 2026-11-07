'use strict';

/**
 * `streaming_streamers.besitzer_id` entfernen (Kassensturz K101, Baustelle 72, 2026-11-07).
 *
 * Die Spalte stand seit der Baseline im Schema und war nie geschrieben und nie
 * gelesen — nachgemessen am 2026-11-07: leer bei allen drei Kanälen, kein
 * Treffer außerhalb der Baseline. Wem ein Kanal gehört, leitet das Plugin seit
 * Stufe 12 aus der Kontoverknüpfung ab (`kern/abonnenten.js`, `kanalInhaber()`
 * über `user_connections`); 13 Stellen bauen darauf.
 *
 * Betreiber am 2026-11-07: „Spalte löschen". Gefüllt wäre sie eine zweite
 * Quelle für dasselbe gewesen, an drei Stellen nachzuziehen (Verknüpfen, Kanal
 * anlegen, Lösen) — und beim ersten vergessenen Nachziehen hätte sie ein
 * Eigentum behauptet, das die Verknüpfung nicht mehr deckt.
 *
 * Die Baseline legt die Spalte weiter an (sie ist Geschichte); auf einer neuen
 * Anlage räumt diese Migration sie gleich danach wieder ab.
 *
 * `down` legt sie leer wieder an, wie die Baseline sie hatte.
 */
module.exports = {
    description: 'Streaming: streaming_streamers.besitzer_id entfernen — Inhaber kommt aus der Verknüpfung (K101)',

    async up(db) {
        const [spalte] = await db.query("SHOW COLUMNS FROM streaming_streamers LIKE 'besitzer_id'");
        if (spalte) await db.query('ALTER TABLE streaming_streamers DROP COLUMN besitzer_id');
    },

    async down(db) {
        const [spalte] = await db.query("SHOW COLUMNS FROM streaming_streamers LIKE 'besitzer_id'");
        if (!spalte) {
            await db.query('ALTER TABLE streaming_streamers ADD COLUMN besitzer_id VARCHAR(32) DEFAULT NULL AFTER avatar_url');
        }
    }
};
