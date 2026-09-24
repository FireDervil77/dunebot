'use strict';
/**
 * Sitzungen der Werkbank — Datenhaltung und der Weg zum Daemon.
 *
 * Eine Sitzung ist ein Volume auf einer Maschine (`.werkbank/<kennung>/`,
 * W-13 im Daemon) plus ein Paket-Entwurf. Jeder Schritt läuft SOFORT: Er wird
 * hier als `laeuft` eingetragen, an den Daemon geschickt, und die Ereignisse
 * `werkbank.output|fertig|fehlgeschlagen` (helpers/Ereignisse.js) schreiben
 * Ausgabe und Ergebnis zurück.
 *
 * @module werkbank/helpers/Sitzungen
 */

const crypto = require('crypto');
const { ServiceManager } = require('dunebot-core');

/** Dieselbe Regel wie `reSitzung` im Daemon (internal/gameserver/werkbank.go). */
const RE_KENNUNG = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** Die Schritttypen, die der Daemon ausführt (check-schritttypen.js hält den Stand). */
const SCHRITTTYPEN = ['script', 'mkdir', 'download', 'extract', 'template', 'steamcmd'];

/** Obergrenze der gespeicherten Ausgabe je Schritt. */
const MAX_AUSGABE = 200000;

function db() { return ServiceManager.get('dbService'); }

function json(wert, ersatz = null) {
    if (wert === null || wert === undefined) return ersatz;
    if (typeof wert === 'object') return wert;
    try { return JSON.parse(wert); } catch { return ersatz; }
}

function neueKennung() {
    return 'wb' + crypto.randomBytes(5).toString('hex');
}

/**
 * Die Images, aus denen eine Sitzung wählen kann.
 *
 * Genommen wird, was die eingelieferten Pakete tatsächlich benutzen — mit dem
 * Digest, auf den sie angeheftet sind. Keine eigene Liste: Ein Image, das kein
 * geprüftes Paket trägt, ist für die Werkbank keine Grundlage, und eine zweite
 * Liste wäre beim nächsten Image veraltet.
 */
async function waehlbareImages() {
    const zeilen = await db().query(`
        SELECT v.fbpkg
          FROM package_versions v
          JOIN (SELECT package_id, MAX(id) AS id FROM package_versions GROUP BY package_id) neu
            ON neu.id = v.id`);
    const gesehen = new Map();
    for (const z of zeilen) {
        const img = json(z.fbpkg, {})?.image;
        if (!img?.ref || !img?.digest) continue;
        const schluessel = `${img.ref}@${img.digest}`;
        if (!gesehen.has(schluessel)) {
            gesehen.set(schluessel, { ref: img.ref, tag: img.tag || null, digest: img.digest });
        }
    }
    return [...gesehen.values()].sort((a, b) => (a.ref + a.tag).localeCompare(b.ref + b.tag));
}

/** Die Maschinen dieser Guild, mit Daemon-Stand. */
async function maschinen(guildId) {
    const ipm = ServiceManager.has('ipmServer') ? ServiceManager.get('ipmServer') : null;
    const zeilen = await db().query(
        'SELECT id, name, daemon_id FROM rootserver WHERE guild_id = ? ORDER BY name', [guildId]);
    return zeilen.map(z => ({
        id: z.id, name: z.name, daemon_id: z.daemon_id,
        online: Boolean(z.daemon_id && ipm?.isDaemonOnline(z.daemon_id)),
    }));
}

async function liste(guildId) {
    return db().query(`
        SELECT s.id, s.kennung, s.name, s.rootserver_id, s.status, s.created_at, s.updated_at,
               (SELECT COUNT(*) FROM werkbank_schritte x WHERE x.sitzung_id = s.id AND x.status = 'ok') AS schritte_ok,
               (SELECT COUNT(*) FROM werkbank_schritte x WHERE x.sitzung_id = s.id AND x.status = 'laeuft') AS laeuft
          FROM werkbank_sitzungen s
         WHERE s.guild_id = ? AND s.status = 'offen'
         ORDER BY s.updated_at DESC`, [guildId]);
}

async function laden(guildId, kennung) {
    if (!RE_KENNUNG.test(String(kennung || ''))) return null;
    const [s] = await db().query(
        'SELECT * FROM werkbank_sitzungen WHERE guild_id = ? AND kennung = ?', [guildId, kennung]);
    if (!s) return null;
    s.image = json(s.image, {});
    s.entwurf = json(s.entwurf, {});
    return s;
}

async function schritte(sitzungId) {
    const zeilen = await db().query(
        'SELECT * FROM werkbank_schritte WHERE sitzung_id = ? ORDER BY nr, id', [sitzungId]);
    return zeilen.map(z => ({ ...z, schritt: json(z.schritt, {}) }));
}

/**
 * Eine Sitzung anlegen. Das Volume entsteht beim Daemon mit dem ersten
 * Schritt — vorher gibt es nichts, was es tragen müsste.
 */
async function anlegen({ guildId, userId, name, rootserverId, image }) {
    const name2 = String(name || '').trim().slice(0, 100);
    if (!name2) throw new Error('Die Sitzung braucht einen Namen — meist das Spiel, das entstehen soll.');
    const erlaubt = await waehlbareImages();
    const img = erlaubt.find(i => `${i.ref}@${i.digest}` === image);
    if (!img) throw new Error('Dieses Image ist nicht wählbar.');
    const maschine = (await maschinen(guildId)).find(m => String(m.id) === String(rootserverId));
    if (!maschine) throw new Error('Diese Maschine gehört nicht zu dieser Guild.');

    const kennung = neueKennung();
    await db().query(
        `INSERT INTO werkbank_sitzungen (kennung, guild_id, angelegt_von, name, rootserver_id, image, entwurf)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [kennung, guildId, userId || null, name2, maschine.id, JSON.stringify(img),
         JSON.stringify({ identity: { name: name2 } })]);
    return kennung;
}

/**
 * Einen Schritt prüfen, eintragen und an den Daemon schicken.
 *
 * Geprüft wird hier nur, was ohne Daemon sicher falsch ist (Typ unbekannt,
 * Sitzung beschäftigt). Die eigentliche Prüfung macht der Daemon mit
 * `Install.Pruefe` — dieselbe wie bei jeder Installation, ein zweites Regelwerk
 * hier liefe auseinander. Er antwortet mit dem Mangel, bevor er „angenommen"
 * sagt, und der Schritt steht dann als `fehler` da.
 */
async function schrittAusfuehren({ sitzung, schritt }) {
    if (!schritt || !SCHRITTTYPEN.includes(schritt.type)) {
        throw new Error(`Unbekannter Schritttyp „${schritt?.type || ''}".`);
    }
    const [beschaeftigt] = await db().query(
        "SELECT id FROM werkbank_schritte WHERE sitzung_id = ? AND status = 'laeuft' LIMIT 1", [sitzung.id]);
    if (beschaeftigt) throw new Error('In dieser Sitzung läuft schon ein Schritt — erst nach seinem Ende.');

    const [maschine] = await db().query('SELECT daemon_id FROM rootserver WHERE id = ?', [sitzung.rootserver_id]);
    const ipm = ServiceManager.has('ipmServer') ? ServiceManager.get('ipmServer') : null;
    if (!maschine?.daemon_id || !ipm?.isDaemonOnline(maschine.daemon_id)) {
        throw new Error('Der Daemon der Maschine ist nicht erreichbar.');
    }

    const [{ naechste }] = await db().query(
        'SELECT COALESCE(MAX(nr), 0) + 1 AS naechste FROM werkbank_schritte WHERE sitzung_id = ?', [sitzung.id]);
    const r = await db().query(
        "INSERT INTO werkbank_schritte (sitzung_id, nr, schritt, status) VALUES (?, ?, ?, 'laeuft')",
        [sitzung.id, naechste, JSON.stringify(schritt)]);
    const schrittId = r.insertId;
    require('./Ereignisse').merke(sitzung.kennung, { schrittId, guildId: sitzung.guild_id });

    const antwort = await ipm.sendCommand(maschine.daemon_id, 'werkbank.schritt', {
        sitzung_id: sitzung.kennung,
        guild_id: sitzung.guild_id,
        image: sitzung.image,
        schritt,
        settings: {},
        ports: {},
    }, 30000).catch(fehler => ({ success: false, error: fehler.message }));

    if (!antwort?.success) {
        const grund = antwort?.error || 'Der Daemon hat nicht geantwortet';
        await beenden(schrittId, { status: 'fehler', fehler: grund });
        require('./Ereignisse').vergiss(sitzung.kennung);
        return { schrittId, angenommen: false, fehler: grund };
    }
    await db().query('UPDATE werkbank_sitzungen SET updated_at = NOW() WHERE id = ?', [sitzung.id]);
    return { schrittId, angenommen: true };
}

/** Ausgabe anhängen — begrenzt auf die letzten MAX_AUSGABE Zeichen. */
async function ausgabeAnhaengen(schrittId, text) {
    await db().query(
        `UPDATE werkbank_schritte
            SET ausgabe = RIGHT(CONCAT(COALESCE(ausgabe, ''), ?), ?)
          WHERE id = ?`, [text, MAX_AUSGABE, schrittId]);
}

async function beenden(schrittId, { status, fehler = null, bytes = null }) {
    await db().query(
        `UPDATE werkbank_schritte SET status = ?, fehler = ?, bytes = ?, beendet_am = NOW()
          WHERE id = ? AND status = 'laeuft'`, [status, fehler, bytes, schrittId]);
}

/** Den laufenden Schritt einer Sitzung finden (nach einem Neustart des Dashboards). */
async function laufenderSchritt(kennung) {
    const [z] = await db().query(`
        SELECT x.id AS schrittId, s.guild_id AS guildId
          FROM werkbank_schritte x JOIN werkbank_sitzungen s ON s.id = x.sitzung_id
         WHERE s.kennung = ? AND x.status = 'laeuft'
         ORDER BY x.id DESC LIMIT 1`, [kennung]);
    return z || null;
}

/**
 * Einen Schritt aus dem Entwurf nehmen. Er bleibt in der Liste stehen
 * (umetikettiert, nicht gelöscht) — und was er im Volume angerichtet hat,
 * bleibt dort. Das sagt die Oberfläche dazu.
 */
async function herausnehmen(sitzung, schrittId) {
    await db().query(
        "UPDATE werkbank_schritte SET status = 'herausgenommen' WHERE id = ? AND sitzung_id = ? AND status IN ('ok','fehler')",
        [schrittId, sitzung.id]);
}

/** Verwerfen: Volume beim Daemon löschen, dann die Sitzung als verworfen führen. */
async function verwerfen(sitzung) {
    const [maschine] = await db().query('SELECT daemon_id FROM rootserver WHERE id = ?', [sitzung.rootserver_id]);
    const ipm = ServiceManager.has('ipmServer') ? ServiceManager.get('ipmServer') : null;
    if (!maschine?.daemon_id || !ipm?.isDaemonOnline(maschine.daemon_id)) {
        throw new Error('Der Daemon der Maschine ist nicht erreichbar — das Volume bliebe liegen.');
    }
    const antwort = await ipm.sendCommand(maschine.daemon_id, 'werkbank.verwerfen',
        { sitzung_id: sitzung.kennung }, 30000).catch(fehler => ({ success: false, error: fehler.message }));
    if (!antwort?.success) throw new Error(antwort?.error || 'Der Daemon hat nicht geantwortet');
    await db().query("UPDATE werkbank_sitzungen SET status = 'verworfen' WHERE id = ?", [sitzung.id]);
}

/**
 * Der Paket-Entwurf, wie er gerade steht: der gespeicherte Teil plus die
 * erfolgreichen Schritte in ihrer Reihenfolge. Nur das — `status.open` und der
 * Rest kommen in späteren Stufen dazu.
 */
function entwurfAlsPaket(sitzung, liste) {
    const e = sitzung.entwurf || {};
    return {
        format: 'FBPKG_v1',
        identity: { slug: '', version: '0.1.0', ...(e.identity || {}) },
        image: sitzung.image,
        install: { steps: liste.filter(s => s.status === 'ok').map(s => s.schritt) },
    };
}

module.exports = {
    RE_KENNUNG, SCHRITTTYPEN, MAX_AUSGABE,
    waehlbareImages, maschinen, liste, laden, schritte, anlegen,
    schrittAusfuehren, ausgabeAnhaengen, beenden, laufenderSchritt,
    herausnehmen, verwerfen, entwurfAlsPaket,
};
