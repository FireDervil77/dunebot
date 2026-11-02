'use strict';

const { ServiceManager } = require('dunebot-core');
const Datenbanken = require('./Datenbanken');

/**
 * Sicherungen und Wiederherstellungen gehören dem Daemon.
 *
 * Das Panel schloss aus einer wartenden Anfrage, ob eine Sicherung läuft: Lief die Frist
 * ab oder starb das Dashboard, stand sie als fehlgeschlagen in der Liste, während der
 * Daemon weiterschrieb (Sicherung 148, 149, 2026-11-02). Betreiber: Der Daemon muss
 * wissen, wann eine Sicherung läuft, wie bei den Gameservern.
 *
 * Darum antwortet der Daemon auf den Befehl nur noch „angenommen". Wie es ausging, kommt
 * als Ereignis (`backup_fertig`, `restore_fertig`), das bei getrennter Leitung in seinem
 * Puffer wartet. Woran er gerade arbeitet, steht in jedem Herzschlag. Die Zeile in der
 * Datenbank ist die Sicht des Panels darauf, mehr nicht.
 */

/** Wie lange `running` ohne Herzschlag des Daemons gilt, und wie lange ein Cronjob wartet. */
const FRIST_MS = 60 * 60 * 1000;

/**
 * Das Herzschlag-Bild kann eine Sicherung noch nicht kennen, die eben gestartet wurde.
 * Zwei Takte, dann zählt es.
 */
const ANLAUF_MS = 2 * 60 * 1000;

/** Sicherungen dieses Prozesses im Anlauf, Kennung → Startzeit. */
const anlauf = new Map();
/** Wer auf das Ende wartet (Cronjob), Kennung → Rückruf. */
const wartende = new Map();

/** Vor dem Befehl an den Daemon: Der Abgleich lässt sie in Ruhe. */
function beginne(id, jetzt = Date.now()) {
    anlauf.set(String(id), jetzt);
}

/**
 * Arbeitet gerade jemand an dieser Sicherung? Dann darf sie niemand löschen: Der Daemon
 * schreibt oder liest das Archiv noch, und das Panel kennt keinen Abbruch.
 *
 * Nach der Frist gilt `running` nicht mehr, falls der Daemon keinen Herzschlag mehr
 * liefert. `restoring` hat kein eigenes Datum, `created_at` nennt nur den Tag der Sicherung.
 *
 * @param {{status: string, created_at?: Date|string}} zeile
 * @returns {boolean}
 */
function laeuft(zeile, jetzt = Date.now()) {
    if (zeile?.status === 'restoring') return true;
    if (zeile?.status !== 'running' && zeile?.status !== 'pending') return false;
    return jetzt - new Date(zeile.created_at).getTime() < FRIST_MS;
}

function sende(guildId, daten) {
    if (ServiceManager.has('sseManager')) ServiceManager.get('sseManager').broadcast(String(guildId), 'gameserver', daten);
}

function melde(zeile, id, zusatz) {
    sende(zeile.guild_id, { action: 'backup_completed', server_id: zeile.server_id, backup_id: id, backup_name: zeile.name, ...zusatz });
}

function erledigt(id, ergebnis) {
    anlauf.delete(String(id));
    wartende.get(String(id))?.(ergebnis);
    wartende.delete(String(id));
}

/**
 * Der Daemon meldet das Ende einer Sicherung. Eine schon als gescheitert geführte Zeile
 * wird dabei richtiggestellt: Der Daemon weiß es besser.
 */
async function fertig(payload) {
    const db = ServiceManager.get('dbService');
    const id = Number(payload?.backup_id);
    const [zeile] = await db.query('SELECT guild_id, server_id, name FROM gameserver_backups WHERE id = ?', [id]);
    if (!zeile) return erledigt(id, payload);
    if (payload.success) {
        await db.query(
            "UPDATE gameserver_backups SET status = 'completed', size_bytes = ?, datenbanken = ?, completed_at = NOW() WHERE id = ?",
            [payload.size_bytes || 0, Datenbanken.sicherungsSpalte(payload), id]);
    } else {
        await db.query(
            "UPDATE gameserver_backups SET status = 'failed', error_message = ? WHERE id = ?",
            [payload.error || 'Sicherung fehlgeschlagen', id]);
        ServiceManager.get('Logger').error(`[Gameserver/Backups] Sicherung ${id} fehlgeschlagen: ${payload.error}`);
    }
    melde(zeile, id, payload.success ? {} : { fehler: true });
    erledigt(id, payload);
}

/** Der Daemon meldet das Ende einer Wiederherstellung. */
async function wiederhergestellt(payload) {
    const db = ServiceManager.get('dbService');
    const id = Number(payload?.backup_id);
    const [zeile] = await db.query('SELECT guild_id, server_id, name FROM gameserver_backups WHERE id = ?', [id]);
    erledigt(id, payload);
    if (!zeile) return;
    const text = payload.success
        ? Datenbanken.wiederherstellungsText(payload)
        : `Wiederherstellung gescheitert: ${payload.error || 'unbekannt'}`;
    await db.query("UPDATE gameserver_backups SET status = 'completed', wiederhergestellt = ? WHERE id = ?", [text, id]);
    sende(zeile.guild_id, { action: 'restore_completed', server_id: zeile.server_id, backup_id: id });
    melde(zeile, id, {});
}

/**
 * Der Herzschlag sagt, woran der Daemon arbeitet. Was das Panel als laufend führt und
 * der Daemon nicht nennt, wird nie mehr fertig: Er wurde neu gestartet, und `tar` mit ihm.
 *
 * @param {string} daemonId
 * @param {Array<string|number>} laufende Kennungen aus dem Herzschlag
 */
async function abgleich(daemonId, laufende, jetzt = Date.now()) {
    const db = ServiceManager.get('dbService');
    const zeilen = await db.query(
        `SELECT b.id, b.status FROM gameserver_backups b
           JOIN gameservers gs ON gs.id = b.server_id
           JOIN rootserver r ON r.id = gs.rootserver_id
          WHERE r.daemon_id = ? AND b.status IN ('running', 'pending', 'restoring')`, [daemonId]);
    const beimDaemon = new Set(laufende.map(String));
    for (const zeile of zeilen) {
        const seit = anlauf.get(String(zeile.id));
        if (beimDaemon.has(String(zeile.id))) { anlauf.delete(String(zeile.id)); continue; }
        if (seit && jetzt - seit < ANLAUF_MS) continue;
        const grund = 'Der Daemon arbeitet nicht mehr daran, er wurde vermutlich neu gestartet.';
        if (zeile.status === 'restoring') {
            await wiederhergestellt({ backup_id: zeile.id, success: false, error: grund });
        } else {
            await fertig({ backup_id: zeile.id, success: false, error: grund });
        }
    }
}

/** Für den Cronjob: wartet auf das Ende einer Sicherung. */
function warte(id, fristMs = FRIST_MS) {
    return new Promise((fertigGeworden, gescheitert) => {
        const zeitnehmer = setTimeout(() => {
            wartende.delete(String(id));
            gescheitert(new Error('Keine Meldung des Daemons innerhalb der Frist'));
        }, fristMs);
        wartende.set(String(id), (ergebnis) => {
            clearTimeout(zeitnehmer);
            if (ergebnis?.success) fertigGeworden(ergebnis);
            else gescheitert(new Error(ergebnis?.error || 'Sicherung fehlgeschlagen'));
        });
    });
}

module.exports = { FRIST_MS, ANLAUF_MS, beginne, laeuft, fertig, wiederhergestellt, abgleich, warte };
