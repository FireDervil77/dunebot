/**
 * Datei-Sperrliste eines Gameservers — `files.denylist` aus seinem PAKET.
 *
 * Bis zum 2026-09-26 las der Dateimanager die Liste aus
 * `frozen_game_data.file_denylist`, also aus dem Egg. Kein Server hatte dort
 * eine; die Liste, die jedes Paket trägt, wirkte bei keinem (Egg-Rückbau C3).
 *
 * Auslegung der Einträge — wie gitignore, weil die Pakete Namen tragen und keine
 * Pfade ab der Volume-Wurzel (Factorio: `bin`, Minecraft: `server.jar`):
 *
 *   `name`, `*.log`   ohne `/` → trifft jeden Pfadteil in jeder Tiefe
 *   `name/`           dasselbe; der Schrägstrich am Ende ändert hier nichts,
 *                     weil nicht jede Route weiß, ob ein Ordner gemeint ist
 *   `game/bin`        mit `/` darin → verankert ab der Volume-Wurzel
 *
 * Gesperrt ist ein Pfad, wenn er selbst ODER einer seiner Elternordner
 * getroffen wird — sonst bliebe `game/bin/x64/factorio` über den direkten Pfad
 * lesbar, obwohl `bin` in der Liste nicht angezeigt wird.
 *
 * Grenze, bewusst benannt: Gesperrte Einträge UNTER einem Ordner, den jemand
 * als Ganzes löscht oder verschiebt, werden nicht gesucht (`game` löschen nimmt
 * `game/bin` mit). Und SFTP kennt die Liste nicht — sie gilt nur für den
 * Dateimanager des Panels.
 *
 * @module helpers/Sperrliste
 */

'use strict';

const path = require('path');
const { ladePaketFuerServer } = require('./StartPayload');

/** Pfad aus einer Anfrage → Teile ab der Volume-Wurzel; `null`, wenn er hinausführt. */
function pfadTeile(pfad) {
    const norm = path.posix.normalize('/' + String(pfad || '').replace(/\\/g, '/'));
    const teile = norm.split('/').filter(Boolean);
    return teile.includes('..') ? null : teile;
}

function alsRegex(muster) {
    const quelle = muster.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]');
    return new RegExp('^' + quelle + '$');
}

/**
 * Ist der Pfad gesperrt?
 * @param {string} pfad - wie der Dateimanager ihn schickt (`/game/bin`, `game/bin`)
 * @param {string[]} liste - `files.denylist` des Pakets
 */
function gesperrt(pfad, liste) {
    if (!Array.isArray(liste) || liste.length === 0) return false;
    const teile = pfadTeile(pfad);
    if (teile === null) return true;
    for (const roh of liste) {
        const muster = String(roh || '').trim().replace(/^\/+/, '').replace(/\/+$/, '');
        if (!muster) continue;
        if (muster.includes('/')) {
            const stuecke = muster.split('/').map(alsRegex);
            if (stuecke.length <= teile.length && stuecke.every((re, i) => re.test(teile[i]))) return true;
        } else {
            const re = alsRegex(muster);
            if (teile.some(t => re.test(t))) return true;
        }
    }
    return false;
}

/**
 * Die Sperrliste des Servers — aus derselben Paketfassung, mit der er startet
 * (`ladePaketFuerServer`, wie `buildStartPayload`). Ohne Paket: keine Liste.
 * Ein Fehler beim Laden geht weiter nach oben: lieber eine Fehlermeldung als
 * ein Dateimanager, der still alles freigibt.
 */
async function ladeSperrliste(dbService, server) {
    const eintrag = await ladePaketFuerServer(dbService, server.id);
    if (!eintrag) return [];
    const paket = typeof eintrag.paket_json === 'string' ? JSON.parse(eintrag.paket_json) : eintrag.paket_json;
    const liste = paket?.files?.denylist;
    return Array.isArray(liste) ? liste.map(String) : [];
}

module.exports = { gesperrt, ladeSperrliste };
