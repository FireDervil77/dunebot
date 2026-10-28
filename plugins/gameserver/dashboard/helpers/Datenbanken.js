'use strict';

/**
 * Datenbanken der Spiele (Stufe 11 S3, 2026-10-27).
 *
 * Die Datenbank selbst legt der Daemon im Container fb-datenbank an (S2:
 * db.anlegen / db.kennwort / db.loeschen / db.liste). Hier steht, was das Panel
 * darüber weiß: welche es gibt, das Kennwort (verschlüsselt, D4 = a), die
 * zuletzt gemessene Größe — und die Regeln, wann man eine anlegen darf.
 *
 * Der Name kommt vom Daemon (`s<server>_<nr>`), das Panel bildet ihn nie
 * selbst nach: eine Regel an einer Stelle.
 */
const { ServiceManager } = require('dunebot-core');
const { encrypt, decrypt } = require('../../../../apps/dashboard/helpers/utils');

const HOST = 'fb-datenbank';
const PORT = 3306;

/**
 * Die Namen hinter `{{db:…}}` (S5). Dieselbe Liste steht im Daemon
 * (`pkgspec.DbSchluessel`); `scripts/check-db-platzhalter.js` hält beide zusammen.
 */
const DB_SCHLUESSEL = ['host', 'port', 'name', 'user', 'password'];

/** Server samt Rootserver-Angaben zu Datenbanken — nur in seiner Guild. */
async function ladeServer(serverId, guildId) {
    const db = ServiceManager.get('dbService');
    const [s] = await db.query(
        `SELECT gs.id, gs.guild_id, gs.name, r.daemon_id,
                r.db_gewuenscht, r.db_moeglich, r.db_grund, r.db_je_server
           FROM gameservers gs
           LEFT JOIN rootserver r ON gs.rootserver_id = r.id
          WHERE gs.id = ? AND gs.guild_id = ?`,
        [serverId, guildId]);
    return s || null;
}

/** Die Datenbanken eines Servers, ohne Kennwort. */
async function liste(serverId) {
    const db = ServiceManager.get('dbService');
    const zeilen = await db.query(
        `SELECT nr, name, bytes, groesse_am, created_at
           FROM gameserver_datenbanken WHERE server_id = ? ORDER BY nr`, [serverId]);
    return (zeilen || []).map(z => ({
        nr: Number(z.nr), name: z.name,
        // BIGINT kann als Text kommen — gezeigt wird eine Zahl.
        bytes: z.bytes === null || z.bytes === undefined ? null : Number(z.bytes),
        groesse: groesseText(z.bytes === null || z.bytes === undefined ? null : Number(z.bytes)),
        groesse_am: z.groesse_am, created_at: z.created_at,
    }));
}

/**
 * Darf hier eine Datenbank angelegt werden — und wenn nicht, warum nicht?
 *
 * @returns {{moeglich: boolean, grund: string|null, grenze: number, anzahl: number, frei: boolean}}
 */
function stand(server, anzahl) {
    const grenze = Number(server.db_je_server) || 0;
    if (!server.daemon_id) return { moeglich: false, grund: 'Der Server hängt an keinem Rootserver.', grenze, anzahl, frei: false };
    if (!server.db_gewuenscht) {
        return { moeglich: false, grund: 'Der Rootserver bietet keine Datenbanken an (Häkchen „Datenbanken" am Rootserver).', grenze, anzahl, frei: false };
    }
    if (!server.db_moeglich) {
        return { moeglich: false, grund: server.db_grund || 'Der Datenbank-Container läuft nicht.', grenze, anzahl, frei: false };
    }
    const frei = anzahl < grenze;
    return {
        moeglich: true,
        grund: frei ? null : `Die Grenze ist erreicht: ${grenze} je Gameserver (am Rootserver einstellbar).`,
        grenze, anzahl, frei,
    };
}

/** Der Befehl an den Daemon des Servers; die Antwort ohne Hülle. */
async function befehl(server, aktion, nutzlast, frist = 90000) {
    const ipm = ServiceManager.has('ipmServer') ? ServiceManager.get('ipmServer') : null;
    if (!ipm || !server.daemon_id || !ipm.isDaemonOnline(server.daemon_id)) {
        const e = new Error('Der Rootserver ist gerade nicht verbunden.');
        e.status = 503;
        throw e;
    }
    const a = await ipm.sendCommand(server.daemon_id, aktion, nutzlast, frist);
    return a?.data && typeof a.data === 'object' ? a.data : (a || {});
}

function fehler(text, status) {
    const e = new Error(text);
    e.status = status;
    return e;
}

/** Erste freie Nummer 1-99. */
function freieNummer(vorhanden) {
    const belegt = new Set(vorhanden.map(z => z.nr));
    for (let n = 1; n <= 99; n++) if (!belegt.has(n)) return n;
    return null;
}

/**
 * Legt eine Datenbank an und gibt den Zugang mit Kennwort zurück.
 */
async function anlegen(server) {
    const db = ServiceManager.get('dbService');
    const vorhanden = await liste(server.id);
    const s = stand(server, vorhanden.length);
    if (!s.moeglich) throw fehler(s.grund, 409);
    if (!s.frei) throw fehler(s.grund, 409);
    const nr = freieNummer(vorhanden);
    if (!nr) throw fehler('Keine freie Nummer mehr (1-99).', 409);

    const antwort = await befehl(server, 'db.anlegen', { server_id: Number(server.id), nr });
    const z = antwort.zugang;
    if (!z || !z.name || !z.kennwort) throw fehler('Der Daemon hat keinen Zugang zurückgegeben.', 502);
    try {
        await db.query(
            `INSERT INTO gameserver_datenbanken (server_id, guild_id, nr, name, kennwort_ver)
             VALUES (?, ?, ?, ?, ?)`,
            [server.id, server.guild_id, nr, z.name, encrypt(z.kennwort)]);
    } catch (e) {
        // Ohne Zeile wüsste niemand mehr von ihr: im Container wieder abbauen.
        // Scheitert auch das, steht es im Log und in der Meldung — `db.liste`
        // findet sie dann als „fremd".
        try {
            await befehl(server, 'db.loeschen', { server_id: Number(server.id), nr });
        } catch (rueck) {
            ServiceManager.get('Logger').warn(`[Gameserver] Datenbank ${z.name} angelegt, aber nicht gespeichert und nicht wieder entfernt: ${rueck.message}`);
            e.message += ` — ${z.name} bleibt im Container, Abbau gescheitert: ${rueck.message}`;
        }
        throw e;
    }
    return zugangAus(z.name, z.kennwort);
}

/** Der Zugang mit Kennwort (entschlüsselt). */
async function zugang(server, nr) {
    const db = ServiceManager.get('dbService');
    const [z] = await db.query(
        'SELECT name, kennwort_ver FROM gameserver_datenbanken WHERE server_id = ? AND nr = ?', [server.id, nr]);
    if (!z) throw fehler('Diese Datenbank gibt es nicht.', 404);
    return zugangAus(z.name, decrypt(z.kennwort_ver));
}

/**
 * Der Zugang für den Startbefehl (Stufe 11 S5) — in der Form, die der Daemon
 * für `{{db:…}}` liest: host, port, name, user, password.
 *
 * Es gilt die erste Datenbank des Servers (`s<id>_1`; bei mehreren die mit der
 * kleinsten Nummer). null, wenn er keine hat. Ein Kennwort, das sich nicht
 * entschlüsseln lässt, wirft — der Aufrufer entscheidet, ob der Start daran
 * scheitert (pflicht) oder ohne Datenbank läuft.
 */
async function zugangFuerStart(serverId) {
    const db = ServiceManager.get('dbService');
    const [z] = await db.query(
        'SELECT name, kennwort_ver FROM gameserver_datenbanken WHERE server_id = ? ORDER BY nr LIMIT 1', [serverId]);
    if (!z) return null;
    return { host: HOST, port: PORT, name: z.name, user: z.name, password: decrypt(z.kennwort_ver) };
}

/** Neues Kennwort: im Container setzen, dann speichern. */
async function neuesKennwort(server, nr) {
    const db = ServiceManager.get('dbService');
    const [z] = await db.query('SELECT name FROM gameserver_datenbanken WHERE server_id = ? AND nr = ?', [server.id, nr]);
    if (!z) throw fehler('Diese Datenbank gibt es nicht.', 404);
    const antwort = await befehl(server, 'db.kennwort', { server_id: Number(server.id), nr });
    const neu = antwort.zugang;
    if (!neu || !neu.kennwort) throw fehler('Der Daemon hat kein Kennwort zurückgegeben.', 502);
    await db.query('UPDATE gameserver_datenbanken SET kennwort_ver = ? WHERE server_id = ? AND nr = ?',
        [encrypt(neu.kennwort), server.id, nr]);
    return zugangAus(z.name, neu.kennwort);
}

/**
 * Löscht im Container, dann die Zeile. Meldet der Daemon „gibt es nicht",
 * ist sie im Container schon weg — dann geht auch die Zeile. Jeder andere
 * Fehler lässt die Zeile stehen: Sonst wüsste niemand mehr von ihr.
 */
async function loeschen(server, nr) {
    const db = ServiceManager.get('dbService');
    const [z] = await db.query('SELECT name FROM gameserver_datenbanken WHERE server_id = ? AND nr = ?', [server.id, nr]);
    if (!z) throw fehler('Diese Datenbank gibt es nicht.', 404);
    let schonWeg = false;
    try {
        await befehl(server, 'db.loeschen', { server_id: Number(server.id), nr });
    } catch (e) {
        if (!/gibt es nicht/.test(String(e.message))) throw e;
        schonWeg = true;
    }
    await db.query('DELETE FROM gameserver_datenbanken WHERE server_id = ? AND nr = ?', [server.id, nr]);
    return { name: z.name, schonWeg };
}

/**
 * Größen vom Daemon holen und speichern. Was der Container nicht (mehr) kennt,
 * kommt als `fehlt` zurück; was er kennt, das Panel aber nicht, als `fremd`.
 */
async function groessenMessen(server) {
    const db = ServiceManager.get('dbService');
    const antwort = await befehl(server, 'db.liste', { server_id: Number(server.id) }, 30000);
    const imContainer = new Map((antwort.datenbanken || []).map(d => [d.name, Number(d.bytes) || 0]));
    const panel = await liste(server.id);
    for (const d of panel) {
        if (imContainer.has(d.name)) {
            await db.query('UPDATE gameserver_datenbanken SET bytes = ?, groesse_am = NOW() WHERE server_id = ? AND nr = ?',
                [imContainer.get(d.name), server.id, d.nr]);
        }
    }
    const bekannt = new Set(panel.map(d => d.name));
    return {
        fehlt: panel.filter(d => !imContainer.has(d.name)).map(d => d.name),
        fremd: [...imContainer.keys()].filter(n => !bekannt.has(n)),
    };
}

// ── Beim Anlegen und Löschen eines Servers (S4) ─────────────────────────────

/** Sagt das Paket, dass das Spiel ohne Datenbank nicht läuft? */
function pflicht(paket) {
    return paket?.requirements?.database === 'required';
}

/**
 * Was Schritt 3 zeigt: ob es den Schalter gibt, ob er fest an ist, und warum
 * nicht, wenn der Rootserver keine Datenbanken anbietet.
 */
function wahlBeimAnlegen(paket, rootserver) {
    const s = stand(rootserver || {}, 0);
    return { pflicht: pflicht(paket), moeglich: s.moeglich && s.frei, grund: s.grund || null };
}

/**
 * Die Entscheidung der Anlegeroute — VOR dem Vergeben der Ports, damit eine
 * Ablehnung nichts zurückzunehmen hat.
 *
 * @param {*} angehakt  der Wert des Schalters (Formular: 'true'/'false')
 * @returns {{anlegen: boolean, fehler: string|null}}
 */
function entscheideBeimAnlegen(paket, rootserver, angehakt) {
    const w = wahlBeimAnlegen(paket, rootserver);
    // Verstecktes „false" vor dem Schalter: Mit Haken kommen beide, und
    // Express macht daraus ein Array — es gilt der letzte (der Schalter).
    const wert = Array.isArray(angehakt) ? angehakt[angehakt.length - 1] : angehakt;
    const gewollt = w.pflicht || wert === true || wert === 'true' || wert === 'on';
    if (!gewollt) return { anlegen: false, fehler: null };
    if (!w.moeglich) {
        const name = paket?.identity?.name || 'Dieses Spiel';
        return {
            anlegen: false,
            fehler: w.pflicht
                ? `${name} braucht eine Datenbank, dieser Rootserver bietet keine an: ${w.grund}`
                : `Eine Datenbank geht auf diesem Rootserver nicht: ${w.grund}`,
        };
    }
    return { anlegen: true, fehler: null };
}

/**
 * Alle Datenbanken eines Servers löschen — beim Löschen des Servers.
 *
 * Scheitert eine, bleibt ihre Zeile (und die Route bricht ab), es sei denn,
 * es wird erzwungen: Dann gehen die Zeilen trotzdem, und was im Container
 * bleibt, steht im Log (und taucht bei `db.liste` als fremd auf).
 *
 * @returns {Promise<{geloescht: string[], fehler: string[]}>}
 */
async function allesLoeschen(server, { erzwingen = false } = {}) {
    const db = ServiceManager.get('dbService');
    const geloescht = [], fehlerListe = [];
    for (const d of await liste(server.id)) {
        try {
            await loeschen(server, d.nr);
            geloescht.push(d.name);
        } catch (e) {
            fehlerListe.push(`${d.name}: ${e.message}`);
        }
    }
    if (fehlerListe.length && erzwingen) {
        await db.query('DELETE FROM gameserver_datenbanken WHERE server_id = ?', [server.id]);
        ServiceManager.get('Logger').warn(`[Gameserver] Server ${server.id} erzwungen gelöscht — im Container bleiben: ${fehlerListe.join('; ')}`);
    }
    return { geloescht, fehler: fehlerListe };
}

function zugangAus(name, kennwort) {
    return { name, benutzer: name, kennwort, host: HOST, port: PORT };
}

/** Bytes lesbar, ehrlich: null heißt „nie gemessen", nicht 0. */
function groesseText(bytes) {
    if (bytes === null || bytes === undefined) return 'nie gemessen';
    if (bytes < 1024) return `${bytes} B`;
    const einheiten = ['KB', 'MB', 'GB', 'TB'];
    let wert = bytes / 1024, i = 0;
    while (wert >= 1024 && i < einheiten.length - 1) { wert /= 1024; i++; }
    return `${wert.toLocaleString('de-DE', { maximumFractionDigits: wert < 10 ? 1 : 0 })} ${einheiten[i]}`;
}

module.exports = {
    HOST, PORT, DB_SCHLUESSEL,
    ladeServer, liste, stand, anlegen, zugang, zugangFuerStart, neuesKennwort, loeschen, groessenMessen,
    groesseText, freieNummer,
    pflicht, wahlBeimAnlegen, entscheideBeimAnlegen, allesLoeschen,
};
