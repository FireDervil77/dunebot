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
 * Stufe 2 (2026-09-24): Probestart. Der Startteil steht im Entwurf
 * (`start`, `ports`), dazu unter `werkbank` was nur diese Sitzung angeht und
 * nie ins Paket gehört — die Portnummern (I2: ein Paket nennt Zwecke, keine
 * Nummern) und die zuletzt gewählten RAM/CPU-Werte. Ein Lauf steht in
 * `werkbank_laeufe`; seine Ereignisse kommen ebenfalls über Ereignisse.js.
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

/** Wie im Schema: `definitions.port.purpose`. */
const RE_ZWECK = /^[a-z][a-z0-9_]*$/;

/** Die Grenzen des Daemons (werkbank_start.go) — hier nur, um früh zu sagen, was er abweist. */
const GRENZEN = { memory_mb: [128, 262144], cpu_prozent: [10, 12800] };

/**
 * Platzhalter-Bereitschaft für einen Erkundungsstart.
 *
 * Der Auftrag (Job.Validate, in Daemon UND fb-init) verlangt Port oder
 * Logzeile. Ein erster Probestart kennt beides noch nicht — er ist ja dazu da,
 * sie zu finden. Diese Zeile geht NUR in diesen einen Start, nie in den
 * Entwurf: Ohne Port meldet fb-init dann ehrlich nur „Prozess läuft", und der
 * Prüfdurchlauf (Stufe 3) weist den Entwurf weiter ab, bis er eine echte
 * Bedingung hat. Gemessen am 2026-09-24: ohne sie „Beendet mit Code -1".
 */
const ERKUNDUNG = '[Werkbank] Erkundungsstart ohne Bereitschaftsbedingung';

/** Hat der Startteil eine Bereitschaftsbedingung, die der Auftrag annimmt? */
function hatBereitschaft(start) {
    const r = start?.ready_when || {};
    const zeile = Array.isArray(r.log_line) ? r.log_line.length : Boolean(r.log_line);
    return Boolean(r.port || zeile || r.query);
}

/** Vorbelegung eines ersten Starts. Frei änderbar (Betreiber, 2026-09-24). */
const VORGABE = { memory_mb: 4096, cpu_prozent: 200 };

function db() { return ServiceManager.get('dbService'); }

function json(wert, ersatz = null) {
    if (wert === null || wert === undefined) return ersatz;
    if (typeof wert === 'object') return wert;
    try { return JSON.parse(wert); } catch { return ersatz; }
}

/** Der Daemon der Maschine einer Sitzung — oder ein Fehler, der sagt, warum nicht. */
async function daemonFuer(sitzung, zusatz = '') {
    const [maschine] = await db().query('SELECT daemon_id FROM rootserver WHERE id = ?', [sitzung.rootserver_id]);
    const ipm = ServiceManager.has('ipmServer') ? ServiceManager.get('ipmServer') : null;
    if (!maschine?.daemon_id || !ipm?.isDaemonOnline(maschine.daemon_id)) {
        throw new Error('Der Daemon der Maschine ist nicht erreichbar' + zusatz + '.');
    }
    return {
        senden: (befehl, nutzlast, frist = 30000) => ipm.sendCommand(maschine.daemon_id, befehl,
            { sitzung_id: sitzung.kennung, ...nutzlast }, frist)
            .catch(fehler => ({ success: false, error: fehler.message })),
    };
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
    await pruefeFrei(sitzung);
    const daemon = await daemonFuer(sitzung);

    const [{ naechste }] = await db().query(
        'SELECT COALESCE(MAX(nr), 0) + 1 AS naechste FROM werkbank_schritte WHERE sitzung_id = ?', [sitzung.id]);
    const r = await db().query(
        "INSERT INTO werkbank_schritte (sitzung_id, nr, schritt, status) VALUES (?, ?, ?, 'laeuft')",
        [sitzung.id, naechste, JSON.stringify(schritt)]);
    const schrittId = r.insertId;
    require('./Ereignisse').merke(sitzung.kennung, { schrittId, guildId: sitzung.guild_id });

    const antwort = await daemon.senden('werkbank.schritt', {
        guild_id: sitzung.guild_id,
        image: sitzung.image,
        schritt,
        settings: {},
        // Seit Stufe 2 hat die Sitzung Portnummern — ein template-Schritt mit
        // {{port:game}} bekommt dieselbe Zahl wie der Probestart.
        ports: werkbankTeil(sitzung).portnummern,
    });

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
    if (await laufenderLauf(sitzung.kennung)) {
        throw new Error('Das Spiel der Sitzung läuft — erst stoppen, dann verwerfen.');
    }
    const daemon = await daemonFuer(sitzung, ' — das Volume bliebe liegen');
    const antwort = await daemon.senden('werkbank.verwerfen', {});
    if (!antwort?.success) throw new Error(antwort?.error || 'Der Daemon hat nicht geantwortet');
    await db().query("UPDATE werkbank_sitzungen SET status = 'verworfen' WHERE id = ?", [sitzung.id]);
}

/**
 * Der Paket-Entwurf, wie er gerade steht: der gespeicherte Teil plus die
 * erfolgreichen Schritte in ihrer Reihenfolge. `werkbank` bleibt draußen —
 * Portnummern und RAM/CPU gehören der Sitzung, nicht dem Paket.
 */
function entwurfAlsPaket(sitzung, liste) {
    const e = sitzung.entwurf || {};
    const paket = {
        format: 'FBPKG_v1',
        identity: { slug: '', version: '0.1.0', ...(e.identity || {}) },
        image: sitzung.image,
        ports: e.ports || [],
        install: { steps: liste.filter(s => s.status === 'ok').map(s => s.schritt) },
    };
    if (e.start) paket.start = e.start;
    if (e.env && Object.keys(e.env).length) paket.env = e.env;
    return paket;
}

// ── Stufe 2: Probestart ──────────────────────────────────────────────────────

/**
 * Übernommene Ports, auf die nichts verweist.
 *
 * Ins Paket kommt nur der Zweck; ein echter Server bekommt seine Nummer aus
 * dem Pool. Erfährt das Spiel sie nirgends — kein `{{port:zweck}}` in
 * Argumenten, Umgebung oder Schritten, keine `variable` am Port —, lauscht es
 * auf seinem eigenen Standard, und auf jedem Server mit anderer Nummer kommt
 * niemand herein. In der Werkbank fällt das nicht auf, wenn die beobachtete
 * Nummer der Standard des Spiels ist (Factorio: 34197, 2026-09-24).
 */
function ungenutztePorts(paket) {
    // Alles außer den Ports selbst und den Beschreibungen: Verweise stehen in
    // start, env, install, aber auch im `config`-Abschnitt (Minecraft schreibt
    // Spiel- und RCON-Port so nach server.properties).
    const { ports, identity, status, ...rest } = paket;
    const text = JSON.stringify(rest);
    return (ports || [])
        // `assign: game+1` leitet das Spiel selbst ab (Valheims Query) — dem
        // muss niemand etwas sagen.
        .filter(p => (p.assign || 'pool') === 'pool')
        .filter(p => !p.variable && !text.includes(`{{port:${p.purpose}}}`)
            // `form` + `from: port:x` ist die zweite Schreibweise (Handpakete).
            && !text.includes(`"from":"port:${p.purpose}"`))
        .map(p => p.purpose);
}

/** Was nur der Sitzung gehört: Portnummern und die zuletzt gewählten Werte. */
function werkbankTeil(sitzung) {
    const w = sitzung.entwurf?.werkbank || {};
    return {
        portnummern: w.portnummern || {},
        memory_mb: Number(w.memory_mb) || VORGABE.memory_mb,
        cpu_prozent: Number(w.cpu_prozent) || VORGABE.cpu_prozent,
    };
}

async function entwurfSchreiben(sitzung, aendern) {
    const e = JSON.parse(JSON.stringify(sitzung.entwurf || {}));
    aendern(e);
    await db().query('UPDATE werkbank_sitzungen SET entwurf = ? WHERE id = ?', [JSON.stringify(e), sitzung.id]);
    sitzung.entwurf = e;
    return e;
}

/** Läuft ein Schritt, ein Probestart oder ein Durchlauf? Dann geht nichts davon. */
async function pruefeFrei(sitzung) {
    if (await laufendePruefung(sitzung.kennung)) {
        throw new Error('Der Prüfdurchlauf läuft — erst nach seinem Urteil.');
    }
    const [schritt] = await db().query(
        "SELECT id FROM werkbank_schritte WHERE sitzung_id = ? AND status = 'laeuft' LIMIT 1", [sitzung.id]);
    if (schritt) throw new Error('In dieser Sitzung läuft schon ein Schritt — erst nach seinem Ende.');
    if (await laufenderLauf(sitzung.kennung)) {
        throw new Error('Das Spiel der Sitzung läuft — erst stoppen.');
    }
}

function grenze(name, wert) {
    const [min, max] = GRENZEN[name];
    const n = Number(wert);
    if (!Number.isInteger(n) || n < min || n > max) {
        throw new Error(`${name === 'memory_mb' ? 'Arbeitsspeicher' : 'CPU'}: erlaubt sind ${min} bis ${max}${name === 'memory_mb' ? ' MB' : ' % (100 = ein Kern)'}.`);
    }
    return n;
}

/** Startteil und Werte speichern. `start` kommt fertig aus dem Formular (Router). */
async function startSpeichern(sitzung, { start, memory_mb, cpu_prozent }) {
    if (!String(start?.program || '').trim()) throw new Error('Ohne Programm gibt es nichts zu starten.');
    const mb = grenze('memory_mb', memory_mb);
    const cpu = grenze('cpu_prozent', cpu_prozent);
    return entwurfSchreiben(sitzung, (e) => {
        // Ganz ersetzt: Das Formular trägt jedes Feld des Startteils, auch die
        // per Klick übernommene Bereitschaftszeile (vorbelegt).
        e.start = start;
        e.werkbank = { ...(e.werkbank || {}), memory_mb: mb, cpu_prozent: cpu };
    });
}

async function laufenderLauf(kennung) {
    const [z] = await db().query(`
        SELECT l.id AS laufId, s.guild_id AS guildId, l.status
          FROM werkbank_laeufe l JOIN werkbank_sitzungen s ON s.id = l.sitzung_id
         WHERE s.kennung = ? AND l.status <> 'beendet'
         ORDER BY l.id DESC LIMIT 1`, [kennung]);
    return z || null;
}

async function laeufe(sitzungId, anzahl = 5) {
    const zeilen = await db().query(
        'SELECT * FROM werkbank_laeufe WHERE sitzung_id = ? ORDER BY id DESC LIMIT ?', [sitzungId, anzahl]);
    return zeilen.map(z => ({
        ...z, start: json(z.start, {}), ports: json(z.ports, []),
        bereitschaft: json(z.bereitschaft, null), luecken: json(z.luecken, []),
        dateien: json(z.dateien, null),
    }));
}

/** Das Spiel der Sitzung starten — mit dem gespeicherten Startteil. */
async function starten(sitzung, liste) {
    const start = sitzung.entwurf?.start;
    if (!start?.program) throw new Error('Erst den Startteil speichern — ohne Programm gibt es nichts zu starten.');
    await pruefeFrei(sitzung);
    const daemon = await daemonFuer(sitzung);
    const w = werkbankTeil(sitzung);

    const r = await db().query(
        "INSERT INTO werkbank_laeufe (sitzung_id, status, memory_mb, cpu_prozent, start) VALUES (?, 'startet', ?, ?, ?)",
        [sitzung.id, w.memory_mb, w.cpu_prozent, JSON.stringify(start)]);
    const laufId = r.insertId;
    require('./Ereignisse').merkeLauf(sitzung.kennung, { laufId, guildId: sitzung.guild_id });

    const antwort = await daemon.senden('werkbank.starten', {
        guild_id: sitzung.guild_id,
        image: sitzung.image,
        start: hatBereitschaft(start) ? start
            : { ...start, ready_when: { ...(start.ready_when || {}), log_line: ERKUNDUNG } },
        env: sitzung.entwurf?.env || {},
        ports: sitzung.entwurf?.ports || [],
        portnummern: w.portnummern,
        settings: {},
        // Nur, damit der Daemon Proton erkennt wie beim echten Start.
        install: { steps: liste.filter(s => s.status === 'ok').map(s => s.schritt) },
        memory_mb: w.memory_mb,
        cpu_prozent: w.cpu_prozent,
    });
    if (!antwort?.success) {
        const grund = antwort?.error || 'Der Daemon hat nicht geantwortet';
        await laufBeenden(laufId, { fehler: grund });
        require('./Ereignisse').vergissLauf(sitzung.kennung);
        throw new Error(grund);
    }
    await db().query('UPDATE werkbank_sitzungen SET updated_at = NOW() WHERE id = ?', [sitzung.id]);
    return { laufId };
}

async function stoppen(sitzung) {
    const lauf = await laufenderLauf(sitzung.kennung);
    if (!lauf) throw new Error('Es läuft kein Probestart.');
    const daemon = await daemonFuer(sitzung);
    await db().query("UPDATE werkbank_laeufe SET status = 'stoppt' WHERE id = ? AND status <> 'beendet'", [lauf.laufId]);
    const antwort = await daemon.senden('werkbank.stoppen', {});
    if (!antwort?.success) throw new Error(antwort?.error || 'Der Daemon hat nicht geantwortet');
}

async function eingabe(sitzung, zeile) {
    const text = String(zeile || '').replace(/[\r\n]+/g, ' ').trim();
    if (!text) throw new Error('Leere Eingabe.');
    if (!(await laufenderLauf(sitzung.kennung))) throw new Error('Es läuft kein Probestart.');
    const daemon = await daemonFuer(sitzung);
    const antwort = await daemon.senden('werkbank.eingabe', { zeile: text.slice(0, 1000) });
    if (!antwort?.success) throw new Error(antwort?.error || 'Der Daemon hat nicht geantwortet');
}

/**
 * Einen beobachteten Port in den Entwurf nehmen. Ins Paket kommt der ZWECK
 * (I2), die Nummer bleibt bei der Sitzung — sie ist die, mit der das Spiel hier
 * gestartet wurde, und wird beim nächsten Start für `{{port:zweck}}` eingesetzt.
 */
async function portUebernehmen(sitzung, { zweck, protocol, port }) {
    const z = String(zweck || '').trim();
    if (!RE_ZWECK.test(z)) throw new Error('Zweck: Kleinbuchstaben, Ziffern und _, beginnend mit einem Buchstaben (game, query, rcon …).');
    if (!['tcp', 'udp', 'both'].includes(protocol)) throw new Error('Protokoll: tcp, udp oder both.');
    const n = Number(port);
    if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error('Keine gültige Portnummer.');
    return entwurfSchreiben(sitzung, (e) => {
        e.ports = (e.ports || []).filter(p => p.purpose !== z);
        e.ports.push({ purpose: z, protocol, assign: 'pool' });
        e.werkbank = { ...(e.werkbank || {}) };
        e.werkbank.portnummern = { ...(e.werkbank.portnummern || {}), [z]: n };
    });
}

async function portEntfernen(sitzung, zweck) {
    return entwurfSchreiben(sitzung, (e) => {
        e.ports = (e.ports || []).filter(p => p.purpose !== zweck);
        if (e.werkbank?.portnummern) delete e.werkbank.portnummern[zweck];
        if (e.start?.ready_when?.port === zweck) delete e.start.ready_when.port;
    });
}

/** Eine Konsolenzeile als Bereitschaftszeile übernehmen. */
async function bereitschaftszeile(sitzung, zeile) {
    const text = String(zeile || '').trim().slice(0, 300);
    if (!text) throw new Error('Leere Zeile.');
    if (!sitzung.entwurf?.start?.program) throw new Error('Erst den Startteil speichern.');
    return entwurfSchreiben(sitzung, (e) => {
        e.start.ready_when = { ...(e.start.ready_when || {}), log_line: text };
    });
}

// ── Stufe 3: Prüfdurchlauf ───────────────────────────────────────────────────

/** Der Suffix des Daemons (werkbank_pruefung.go, PruefSuffix). */
const PRUEF_SUFFIX = '-pruefung';

/** JSON mit sortierten Schlüsseln — derselbe Entwurf ergibt denselben Fingerabdruck. */
function stabil(wert) {
    if (Array.isArray(wert)) return '[' + wert.map(stabil).join(',') + ']';
    if (wert && typeof wert === 'object') {
        return '{' + Object.keys(wert).sort().filter(k => wert[k] !== undefined)
            .map(k => JSON.stringify(k) + ':' + stabil(wert[k])).join(',') + '}';
    }
    return JSON.stringify(wert);
}

function fingerabdruck(paket) {
    return crypto.createHash('sha256').update(stabil(paket)).digest('hex');
}

async function laufendePruefung(kennung) {
    const [z] = await db().query(`
        SELECT p.id AS pruefId, s.guild_id AS guildId
          FROM werkbank_pruefungen p JOIN werkbank_sitzungen s ON s.id = p.sitzung_id
         WHERE s.kennung = ? AND p.status = 'laeuft'
         ORDER BY p.id DESC LIMIT 1`, [kennung]);
    return z || null;
}

async function pruefungen(sitzungId, anzahl = 5) {
    const zeilen = await db().query(
        'SELECT * FROM werkbank_pruefungen WHERE sitzung_id = ? ORDER BY id DESC LIMIT ?', [sitzungId, anzahl]);
    return zeilen.map(z => ({ ...z, ergebnis: json(z.ergebnis, null), entwurf: json(z.entwurf, null) }));
}

/**
 * Was vor einem Durchlauf sicher scheitern würde — hier gesagt statt nach
 * einer halben Stunde SteamCMD. Dieselben Regeln wie das Urteil im Daemon.
 */
function durchlaufMaengel(paket) {
    const m = [];
    if (!paket.install?.steps?.length) m.push('Der Entwurf hat keinen Schritt.');
    if (!paket.start?.program) m.push('Der Startteil fehlt.');
    if (!paket.start?.ready_when?.port) {
        m.push('„Bereit, wenn Port" fehlt — die Zeile allein prüft fb-init nicht, grün gibt es nur über einen Port.');
    }
    const seq = paket.start?.stop?.sequence || [];
    if (seq.length < 2) m.push('Die Stoppfolge hat nur sigkill — grün verlangt, dass das Spiel VORHER endet (etwa „command:/quit 30 beendet").');
    for (const z of ungenutztePorts(paket)) m.push(`Auf den Port „${z}" verweist nichts — das Spiel erführe seine Nummer nicht.`);
    return m;
}

async function pruefen(sitzung, liste) {
    await pruefeFrei(sitzung);
    const paket = entwurfAlsPaket(sitzung, liste);
    const maengel = durchlaufMaengel(paket);
    if (maengel.length) throw new Error(maengel.join(' '));
    const w = werkbankTeil(sitzung);
    // Ohne Nummer für den Bereitschaftsport entstünde kein Auftrag (Job.Validate).
    if (!w.portnummern[paket.start.ready_when.port]) {
        throw new Error(`Der Port „${paket.start.ready_when.port}" hat in dieser Sitzung keine Nummer — erst beobachten und übernehmen.`);
    }
    const daemon = await daemonFuer(sitzung);

    const r = await db().query(
        "INSERT INTO werkbank_pruefungen (sitzung_id, status, entwurf, entwurf_hash) VALUES (?, 'laeuft', ?, ?)",
        [sitzung.id, JSON.stringify(paket), fingerabdruck(paket)]);
    const pruefId = r.insertId;
    require('./Ereignisse').merkePruefung(sitzung.kennung, { pruefId, guildId: sitzung.guild_id });

    const antwort = await daemon.senden('werkbank.pruefen', {
        guild_id: sitzung.guild_id, image: sitzung.image,
        start: paket.start, env: paket.env || {}, ports: paket.ports,
        portnummern: w.portnummern, settings: {}, install: paket.install,
        memory_mb: w.memory_mb, cpu_prozent: w.cpu_prozent,
    });
    if (!antwort?.success) {
        const grund = antwort?.error || 'Der Daemon hat nicht geantwortet';
        await pruefungBeenden(pruefId, { gruen: false, gruende: [grund], installation: 'nicht begonnen' });
        require('./Ereignisse').vergissPruefung(sitzung.kennung);
        throw new Error(grund);
    }
    return { pruefId };
}

/** Hängt fest (Daemon weg, Dashboard neu gestartet)? Von Hand rot setzen. */
async function pruefungAbbrechen(sitzung) {
    const p = await laufendePruefung(sitzung.kennung);
    if (!p) throw new Error('Es läuft kein Prüfdurchlauf.');
    await pruefungBeenden(p.pruefId, { gruen: false, gruende: ['von Hand abgebrochen — das Urteil des Daemons kam nicht'] });
    require('./Ereignisse').vergissPruefung(sitzung.kennung);
}

async function pruefProtokoll(pruefId, text) {
    await db().query(
        `UPDATE werkbank_pruefungen SET protokoll = RIGHT(CONCAT(COALESCE(protokoll, ''), ?), ?) WHERE id = ?`,
        [text, MAX_AUSGABE, pruefId]);
}

async function pruefungBeenden(pruefId, ergebnis) {
    await db().query(
        `UPDATE werkbank_pruefungen SET status = ?, ergebnis = ?, beendet_am = NOW() WHERE id = ? AND status = 'laeuft'`,
        [ergebnis?.gruen ? 'gruen' : 'rot', JSON.stringify(ergebnis || {}), pruefId]);
}

// ── Ereignisse eines Laufs (aufgerufen aus Ereignisse.js) ────────────────────

async function laufSetzen(laufId, felder) {
    const spalten = Object.keys(felder);
    if (!spalten.length) return;
    await db().query(
        `UPDATE werkbank_laeufe SET ${spalten.map(k => `${k} = ?`).join(', ')} WHERE id = ?`,
        [...spalten.map(k => (felder[k] !== null && typeof felder[k] === 'object' ? JSON.stringify(felder[k]) : felder[k])), laufId]);
}

async function konsoleAnhaengen(laufId, text) {
    await db().query(
        `UPDATE werkbank_laeufe SET konsole = RIGHT(CONCAT(COALESCE(konsole, ''), ?), ?) WHERE id = ?`,
        [text, MAX_AUSGABE, laufId]);
}

async function laufBeenden(laufId, { exit_code = null, gestoppt = null, fehler = null, dateien = null }) {
    await db().query(
        `UPDATE werkbank_laeufe SET status = 'beendet', exit_code = ?, gestoppt = ?, fehler = ?, dateien = ?, beendet_am = NOW()
          WHERE id = ? AND status <> 'beendet'`,
        [exit_code, gestoppt, fehler, dateien ? JSON.stringify(dateien) : null, laufId]);
}

/** Was das laufende Spiel bisher angelegt und geändert hat — beim Daemon nachgefragt. */
async function dateienJetzt(sitzung) {
    if (!(await laufenderLauf(sitzung.kennung))) throw new Error('Es läuft kein Probestart.');
    const daemon = await daemonFuer(sitzung);
    const antwort = await daemon.senden('werkbank.dateien', {});
    if (!antwort?.success) throw new Error(antwort?.error || 'Der Daemon hat nicht geantwortet');
    return antwort.data?.dateien || null;
}

/**
 * Viele Dateien im selben Ordner zu einer Zeile zusammenfassen.
 *
 * Gemessen an Factorio: 52 von 53 neuen Dateien während des Laufs lagen unter
 * temp/currently-playing/, 49 davon Übersetzungen. Einzeln aufgelistet
 * verdecken sie die eine Datei, um die es geht. Ab `ab` Einträgen in einem
 * Ordner (samt Unterordnern) steht der Ordner mit Anzahl und Summe da.
 */
function gruppiere(liste, ab = 6) {
    const eintraege = (liste || []).map(d => ({ ...d, teile: d.pfad.split('/') }));
    const aus = [];
    const erledigt = new Set();
    // Tiefste Ordner zuerst prüfen wäre zu fein — gesucht wird der OBERSTE
    // Ordner, unter dem sich viele sammeln, aber nicht game/ oder data/ selbst.
    for (const d of eintraege) {
        if (erledigt.has(d.pfad)) continue;
        let gruppe = null;
        for (let tiefe = 2; tiefe < d.teile.length; tiefe++) {
            const ordner = d.teile.slice(0, tiefe).join('/') + '/';
            const drin = eintraege.filter(x => !erledigt.has(x.pfad) && x.pfad.startsWith(ordner));
            if (drin.length >= ab) { gruppe = { ordner, drin }; break; }
        }
        if (gruppe) {
            gruppe.drin.forEach(x => erledigt.add(x.pfad));
            aus.push({ ordner: gruppe.ordner, anzahl: gruppe.drin.length,
                groesse: gruppe.drin.reduce((n, x) => n + (Number(x.groesse) || 0), 0) });
        } else {
            erledigt.add(d.pfad);
            aus.push({ pfad: d.pfad, groesse: d.groesse, vorher: d.vorher });
        }
    }
    return aus;
}

module.exports = {
    RE_KENNUNG, RE_ZWECK, SCHRITTTYPEN, MAX_AUSGABE, GRENZEN, VORGABE, ERKUNDUNG, hatBereitschaft,
    waehlbareImages, maschinen, liste, laden, schritte, anlegen,
    schrittAusfuehren, ausgabeAnhaengen, beenden, laufenderSchritt,
    herausnehmen, verwerfen, entwurfAlsPaket,
    PRUEF_SUFFIX, fingerabdruck, laufendePruefung, pruefungen, durchlaufMaengel, pruefen,
    pruefungAbbrechen, pruefProtokoll, pruefungBeenden,
    werkbankTeil, ungenutztePorts, startSpeichern, starten, stoppen, eingabe, laeufe, laufenderLauf,
    portUebernehmen, portEntfernen, bereitschaftszeile,
    laufSetzen, konsoleAnhaengen, laufBeenden, dateienJetzt, gruppiere,
};
