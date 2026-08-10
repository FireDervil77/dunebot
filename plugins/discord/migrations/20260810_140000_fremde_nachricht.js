'use strict';

/**
 * Rollenmenüs an eine **bestehende** Nachricht hängen.
 *
 * Die Bauliste (`docs/Plugin-Lueckenanalyse.md`, Paket 2) verlangte
 * „Nachricht (eigene oder bestehende)". Gebaut war am 2026-08-10 zunächst nur
 * der erste Fall: der Bot schickt seine eigene Nachricht.
 *
 * Der zweite ist der häufigere Wunsch — ein Regelwerk oder ein
 * Willkommensposting steht längst im Kanal, und darunter sollen die Rollen.
 *
 * ## Warum eine eigene Spalte und nicht bloss `message_id`
 *
 * `message_id` sagt nur, **dass** eine Nachricht dazugehört, nicht **wem** sie
 * gehört. Der Unterschied hat drei handfeste Folgen:
 *
 * | | eigene Nachricht | fremde Nachricht |
 * |---|---|---|
 * | Inhalt ändern | ja | **nein** — Discord lässt nur eigene bearbeiten |
 * | Knöpfe/Auswahlliste | ja | **nein** — Bauteile gehören zur Nachricht |
 * | beim Löschen des Menüs | bleibt stehen, tut nichts | Reaktionen abräumen, Text unberührt |
 *
 * Ohne die Spalte müsste jeder dieser drei Wege bei jedem Aufruf erst eine
 * Nachricht von Discord holen, um zu erfahren, wer sie geschrieben hat. Das
 * wäre nicht nur langsam, sondern unzuverlässig: Die Oberfläche muss **vorher**
 * sagen, dass an einer fremden Nachricht keine Knöpfe möglich sind — nicht
 * hinterher, wenn das Senden fehlschlägt.
 */
module.exports = {
    description: 'Rollenmenüs können an eine bestehende fremde Nachricht gehängt werden',

    async up(db) {
        await db.query(`
            ALTER TABLE discord_role_menus
            ADD COLUMN IF NOT EXISTS fremde_nachricht TINYINT(1) NOT NULL DEFAULT 0
                COMMENT 'Die Nachricht stammt nicht vom Bot: nur Reaktionen, kein Bearbeiten'
        `);
    },

    async down(db) {
        // Verlustfrei: Menüs an fremden Nachrichten verlieren nur die
        // Kennzeichnung, nicht ihre Zuordnung. Sie verhalten sich danach wie
        // eigene — das Senden schlägt dann fehl, statt vorher zu warnen.
        await db.query(`
            ALTER TABLE discord_role_menus
            DROP COLUMN IF EXISTS fremde_nachricht
        `);
    }
};
