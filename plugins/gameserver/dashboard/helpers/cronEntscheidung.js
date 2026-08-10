'use strict';

/**
 * Soll dieser Cronjob jetzt laufen? — reine Rechnung, ohne Datenbank und ohne
 * Daemon.
 *
 * Baustellen-Punkt 7: "die cronjobs sollten nur laufen wenn der gameserver auch
 * genutzt wird". Eine pauschale Regel waere hier falsch — **`start` ist genau
 * dann sinnvoll, wenn der Server NICHT laeuft.** Wer stumpf alles aussetzt,
 * solange der Server gestoppt ist, schaltet den naechtlichen Start ab und
 * merkt es erst am naechsten Morgen.
 *
 * Deshalb entscheidet die Aktion, nicht der Status allein.
 *
 * Ausgelagert, weil es fuenf Aktionen mal acht Statuswerte sind — 40 Faelle,
 * die sich gegen eine laufende Anlage nicht durchprobieren lassen. Als reine
 * Funktion deckt `scripts/check-cronjob-lauf.js` sie ab.
 */

/** Status, in denen der Server bedienbar ist. */
const LAEUFT = 'online';

/** Status, in denen ueberhaupt nichts angefasst werden darf. */
const BESCHAEFTIGT = ['installing', 'updating', 'starting', 'stopping'];

/**
 * @param {object} lage
 * @param {'start'|'stop'|'restart'|'backup'|'command'} lage.aktion
 * @param {string} lage.serverStatus  Wert aus gameservers.status
 * @param {boolean} lage.daemonOnline
 * @returns {{ausfuehren: boolean, grund: string}}
 */
function entscheide({ aktion, serverStatus, daemonOnline }) {
    if (!daemonOnline) {
        return { ausfuehren: false, grund: 'Daemon ist offline' };
    }

    // Waehrend Installation, Update oder eines laufenden Wechsels wird nichts
    // angestossen — auch kein Start. Sonst faehrt ein Cronjob mitten in eine
    // Migration, und das war schon einmal die Ursache kaputter Umzuege.
    if (BESCHAEFTIGT.includes(serverStatus)) {
        return { ausfuehren: false, grund: `Server ist gerade beschäftigt (${serverStatus})` };
    }

    const laeuft = serverStatus === LAEUFT;

    switch (aktion) {
        case 'start':
            // Der einzige Fall, der einen gestoppten Server BRAUCHT.
            return laeuft
                ? { ausfuehren: false, grund: 'Server läuft bereits' }
                : { ausfuehren: true, grund: '' };

        case 'stop':
            return laeuft
                ? { ausfuehren: true, grund: '' }
                : { ausfuehren: false, grund: 'Server ist bereits gestoppt' };

        case 'restart':
        case 'command':
            return laeuft
                ? { ausfuehren: true, grund: '' }
                : { ausfuehren: false, grund: 'Server ist gestoppt' };

        case 'backup':
            // Technisch ginge ein Backup auch im Stillstand. Ausgesetzt wird es
            // trotzdem: ein Server, den niemand nutzt, soll nicht jede Nacht
            // eine neue Kopie auf die Zielplatte legen (Punkt 7.1).
            return laeuft
                ? { ausfuehren: true, grund: '' }
                : { ausfuehren: false, grund: 'Server ist gestoppt – kein Backup nötig' };

        default:
            return { ausfuehren: false, grund: `Unbekannte Aktion: ${aktion}` };
    }
}

/**
 * Welche Backups eines Cronjobs muessen weg? — ebenfalls reine Rechnung.
 *
 * Zwei Grenzen, die zusammen wirken: `keep` (Anzahl) und `keepDays` (Alter).
 * Beide 0 heisst unbegrenzt, also der Zustand von vorher.
 *
 * @param {Array<{id:number, created_at:Date|string}>} backups  neueste zuerst
 * @param {{keep:number, keepDays:number, jetzt?:Date}} grenzen
 * @returns {Array<number>} IDs, die entfernt werden sollen
 */
function zuEntfernen(backups, { keep = 0, keepDays = 0, jetzt = new Date() } = {}) {
    if (!Array.isArray(backups) || !backups.length) return [];
    if (!keep && !keepDays) return [];

    const sortiert = [...backups].sort(
        (a, b) => new Date(b.created_at) - new Date(a.created_at)
    );

    const raus = new Set();

    if (keep > 0) {
        for (const b of sortiert.slice(keep)) raus.add(b.id);
    }

    if (keepDays > 0) {
        const grenze = new Date(jetzt.getTime() - keepDays * 24 * 60 * 60 * 1000);
        for (const b of sortiert) {
            if (new Date(b.created_at) < grenze) raus.add(b.id);
        }
        // Das juengste Backup bleibt immer stehen, auch wenn es aelter als die
        // Altersgrenze ist. Sonst raeumt eine kurz eingestellte Frist den
        // letzten Stand weg, und der Server steht ohne jede Kopie da.
        raus.delete(sortiert[0].id);
    }

    return [...raus];
}

module.exports = { entscheide, zuEntfernen, LAEUFT, BESCHAEFTIGT };
