'use strict';

/**
 * Fertige Befehle auf ihre englischen Hauptnamen (Kassensturz K321, 2026-11-07).
 *
 * Betreiber: „Englisch, Deutsch bleibt". In `kern/befehle.js` heißen
 * `spiel`, `befehle`, `umfrage` und `los` jetzt `game`, `commands`, `poll` und
 * `ticket`; die deutschen Wörter lösen als Zweitname weiter aus. Gespeichert
 * wird der Hauptname — `streaming_commands.wort` hält, welche fertigen Befehle
 * ein Streamer eingeschaltet hat und mit welchen Rechten. Ohne diese Migration
 * zeigten seine Einstellungen ins Leere.
 *
 * Gemessen vor dem Umbau: je eine Zeile `spiel`, `befehle`, `umfrage`, `los`
 * (art 'fertig', Heim-Guild), keine Zeile mit einem der neuen Namen.
 *
 * Nur `art = 'fertig'`: Ein eigener Befehl behält sein Wort. Gibt es den
 * Hauptnamen schon (der eindeutige Schlüssel guild/streamer/wort), bleibt die
 * vorhandene Zeile, und die alte fertige wird entfernt — sonst stünde eine
 * Zeile `spiel` da, zu der es keinen fertigen Befehl mehr gibt.
 */
const NAMEN = [['spiel', 'game'], ['befehle', 'commands'], ['umfrage', 'poll'], ['los', 'ticket']];

module.exports = {
    description: 'Streaming: fertige Befehle auf englische Hauptnamen (K321)',

    async up(db) {
        for (const [alt, neu] of NAMEN) {
            await db.query("UPDATE IGNORE streaming_commands SET wort = ? WHERE art = 'fertig' AND wort = ?", [neu, alt]);
            await db.query("DELETE FROM streaming_commands WHERE art = 'fertig' AND wort = ?", [alt]);
        }
    },

    async down(db) {
        for (const [alt, neu] of NAMEN) {
            await db.query("UPDATE IGNORE streaming_commands SET wort = ? WHERE art = 'fertig' AND wort = ?", [alt, neu]);
        }
    }
};
