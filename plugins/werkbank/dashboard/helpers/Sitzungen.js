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
 * Der Auftrag (Job.Validate, in Daemon UND fb-init) verlangt einen Port —
 * oder die begründete Ausnahme `without_port` samt Logzeile (Baustelle 158,
 * 2026-09-25). Ein erster Probestart kennt den Port noch nicht; er ist ja dazu
 * da, ihn zu finden. Er läuft deshalb als Ausnahme mit dieser Begründung. Das
 * geht NUR in diesen einen Start, nie in den Entwurf, und der Prüfdurchlauf
 * (Stufe 3) weist den Entwurf weiter ab, bis er eine echte Bedingung hat.
 *
 * Seit fb-init die Zeile wirklich prüft, meldet ein Erkundungsstart nicht mehr
 * sofort „process": Steht im Formular schon eine Zeile, wird genau sie
 * geprüft — die Erkundung zeigt dann, ob sie trägt. Sonst wartet er auf
 * ERKUNDUNG, die nie kommt, und fb-init sagt nach der Frist, dass sie ausblieb.
 * Gemessen am 2026-09-24: ganz ohne Bedingung „Beendet mit Code -1".
 */
const ERKUNDUNG = '[Werkbank] Erkundungsstart ohne Bereitschaftsbedingung';

/** Hat der Startteil eine Bereitschaftsbedingung, die der Auftrag annimmt? */
function hatBereitschaft(start) {
    const r = start?.ready_when || {};
    const zeile = Array.isArray(r.log_line) ? r.log_line.length : Boolean(String(r.log_line || '').trim());
    return Boolean(r.port || (String(r.without_port || '').trim() && zeile));
}

/** Der Startteil eines Erkundungsstarts — nur für diesen einen Start. */
function alsErkundung(start) {
    const r = start.ready_when || {};
    const zeile = Array.isArray(r.log_line) ? r.log_line.length : Boolean(String(r.log_line || '').trim());
    return {
        ...start,
        ready_when: {
            ...r,
            without_port: ERKUNDUNG,
            log_line: zeile ? r.log_line : ERKUNDUNG,
        },
    };
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
 * Das Image einer Sitzung, wie es an den Daemon geht: Image und Tag, KEIN Digest.
 *
 * Baustelle 166 (2026-09-25): Eine Sitzung soll bei jedem Lauf den aktuellen
 * Stand nehmen — der Daemon löst den Tag auf und meldet, welcher Digest es war.
 * Angeheftet wird erst beim Veröffentlichen, und zwar der Digest des grünen
 * Durchlaufs. Ältere Sitzungen haben den Digest noch gespeichert; er wird hier
 * weggelassen, damit auch sie nachziehen.
 */
function sitzungsImage(sitzung) {
    const i = sitzung?.image || {};
    return { ref: i.ref, ...(i.tag ? { tag: i.tag } : {}), ...(i.platform ? { platform: i.platform } : {}) };
}

/**
 * Die Images, aus denen eine Sitzung wählen kann.
 *
 * Genommen wird, was die eingelieferten Pakete tatsächlich benutzen — als Image
 * und Tag (der Digest ist Sache des Laufs, siehe sitzungsImage). Keine eigene
 * Liste: Ein Image, das kein geprüftes Paket trägt, ist für die Werkbank keine
 * Grundlage, und eine zweite Liste wäre beim nächsten Image veraltet.
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
        if (!img?.ref || !img?.tag) continue;
        const schluessel = `${img.ref}:${img.tag}`;
        if (!gesehen.has(schluessel)) gesehen.set(schluessel, { ref: img.ref, tag: img.tag });
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
async function anlegen({ guildId, userId, name, rootserverId, image, iconUrl }) {
    const name2 = String(name || '').trim().slice(0, 100);
    if (!name2) throw new Error('Die Sitzung braucht einen Namen — meist das Spiel, das entstehen soll.');
    const erlaubt = await waehlbareImages();
    const img = erlaubt.find(i => `${i.ref}:${i.tag}` === image);
    if (!img) throw new Error('Dieses Image ist nicht wählbar.');
    const maschine = (await maschinen(guildId)).find(m => String(m.id) === String(rootserverId));
    if (!maschine) throw new Error('Diese Maschine gehört nicht zu dieser Guild.');

    const kennung = neueKennung();
    // Das Bild „von vornherein" (Betreiber, 2026-09-24) — es gehört der Sitzung,
    // ins Paket kommt es nicht; beim Veröffentlichen geht es an den Anker.
    const icon = pruefeBildAdresse(iconUrl, 'Symbol');
    const entwurf = { identity: { name: name2 } };
    if (icon) entwurf.werkbank = { praesentation: { icon_url: icon } };
    await db().query(
        `INSERT INTO werkbank_sitzungen (kennung, guild_id, angelegt_von, name, rootserver_id, image, entwurf)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [kennung, guildId, userId || null, name2, maschine.id, JSON.stringify(img),
         JSON.stringify(entwurf)]);
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
        image: sitzungsImage(sitzung),
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
        image: sitzungsImage(sitzung),
        ports: e.ports || [],
        install: { steps: liste.filter(s => s.status === 'ok').map(s => s.schritt) },
    };
    if (e.start) paket.start = e.start;
    const settings = Array.isArray(e.settings) ? e.settings : [];
    const env = { ...(e.env || {}), ...umgebungAusEinstellungen(settings, e.env || {}) };
    if (Object.keys(env).length) paket.env = env;
    if (settings.length) paket.settings = settings;
    return paket;
}

// ── Einstellungs-Baukasten (B1, 2026-09-26) ─────────────────────────────────
//
// Eine Einstellung wird in der Sitzung von Hand beschrieben — Schlüssel, Name,
// Typ, Vorgabe, wer sie wann sieht (`role`), wann sie greift, und wohin der
// Wert geht (`apply`). Was heißt „wohin":
//
//   file   fb-init schreibt die Datei vor dem Start und meldet je Schlüssel.
//   env    Wirksam NUR über das Wurzelfeld `env` — der Daemon setzt `apply: env`
//          nicht selbst um (Baustelle 169). Die Werkbank schreibt die Zeile
//          `VARIABLE: {{setting:key}}` deshalb selbst dazu; sonst erbte jedes
//          neue Paket die Lücke der alten.
//   arg    Wirksam nur, wenn die Startzeile `{{setting:key}}` enthält. Die
//          schreibt der Mensch in den Startteil; der Nachweis sagt, ob sie da ist.
//   rcon   wirkt im laufenden Spiel; im Durchlauf nicht prüfbar (B3).
//
// Veröffentlicht wird nur, was ein grüner Durchlauf als ANGEKOMMEN belegt
// (Absprache 2026-09-26) — der Rest bleibt als Entwurf in der Sitzung.

const EINSTELLUNG = {
    typen:   ['text', 'number', 'boolean', 'choice', 'password'],
    rollen:  ['player', 'owner', 'expert'],
    wirkung: ['instant', 'restart', 'new_world', 'reinstall'],
    risiko:  ['none', 'progress', 'world_reset'],
    ziele:   ['file', 'env', 'arg', 'rcon'],
    parser:  ['ini', 'json', 'yaml', 'properties', 'xml', 'text'],
    als:     ['true_false', 'True_False', 'TRUE_FALSE', 'one_zero', 'yes_no', 'Yes_No', 'on_off', 'enabled_disabled'],
};
const RE_SCHLUESSEL = /^[a-z][a-z0-9_]*$/;
const RE_VARIABLE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Die Verdrahtung für `apply: env` — nur, was im Wurzelfeld noch fehlt. */
function umgebungAusEinstellungen(settings, env) {
    const aus = {};
    for (const s of settings) {
        for (const z of s.apply || []) {
            if (z.target === 'env' && z.variable && !(z.variable in env) && !(z.variable in aus)) {
                aus[z.variable] = `{{setting:${s.key}}}`;
            }
        }
    }
    return aus;
}

/**
 * Formular → Einstellung im Format des Pakets. Wirft mit einem Satz, der sagt,
 * was fehlt — geprüft wird hier, wo getippt wird, nicht erst im Durchlauf.
 */
function einstellungAusFormular(b) {
    const text = (k) => (typeof b[k] === 'string' ? b[k].trim() : typeof b[k] === 'number' ? String(b[k]) : '');
    const key = text('key');
    if (!RE_SCHLUESSEL.test(key)) throw new Error('Schlüssel: klein, mit Buchstaben anfangen, nur a–z, 0–9 und _ (etwa max_players).');
    const name = text('name_de');
    if (!name) throw new Error('Name fehlt — er steht so im Panel.');
    const e = { key, name: { de: name } };
    if (text('name_en')) e.name.en = text('name_en');
    if (text('beschreibung_de') || text('beschreibung_en')) {
        e.description = {};
        if (text('beschreibung_de')) e.description.de = text('beschreibung_de');
        if (text('beschreibung_en')) e.description.en = text('beschreibung_en');
    }
    if (text('group')) {
        if (!RE_SCHLUESSEL.test(text('group'))) throw new Error('Gruppe: dieselbe Schreibweise wie der Schlüssel.');
        e.group = text('group');
    }
    const aus = (feld, liste, name) => {
        const v = text(feld);
        if (!liste.includes(v)) throw new Error(`${name}: „${v}" gibt es nicht — erlaubt: ${liste.join(', ')}.`);
        return v;
    };
    e.type = aus('type', EINSTELLUNG.typen, 'Typ');
    e.role = aus('role', EINSTELLUNG.rollen, 'Rolle');
    e.takes_effect = aus('takes_effect', EINSTELLUNG.wirkung, 'Wirkung');
    const risiko = text('risk') || 'none';
    if (!EINSTELLUNG.risiko.includes(risiko)) throw new Error(`Risiko: „${risiko}" gibt es nicht — erlaubt: ${EINSTELLUNG.risiko.join(', ')}.`);
    e.risk = risiko;

    if (e.type === 'choice') {
        const moeglich = text('choices').split(/\r?\n/).map(z => z.trim()).filter(Boolean).map((z) => {
            const [wert, ...rest] = z.split('=');
            const c = { value: wert.trim() };
            if (rest.length && rest.join('=').trim()) c.name = { de: rest.join('=').trim() };
            return c;
        });
        if (moeglich.length < 2) throw new Error('Auswahl: mindestens zwei Möglichkeiten, je Zeile „wert" oder „wert=Anzeigename".');
        e.choices = moeglich;
    }
    if (e.type === 'number') {
        for (const [feld, ziel] of [['min', 'min'], ['max', 'max']]) {
            if (text(feld) === '') continue;
            const n = Number(text(feld));
            if (!Number.isFinite(n)) throw new Error(`${feld}: keine Zahl.`);
            e[ziel] = n;
        }
    }
    const vorgabe = text('default');
    if (vorgabe !== '') {
        if (e.type === 'number' && !Number.isFinite(Number(vorgabe))) throw new Error('Vorgabe: keine Zahl.');
        if (e.type === 'choice' && !e.choices.some(c => c.value === vorgabe)) throw new Error('Vorgabe: keine der Möglichkeiten.');
        e.default = e.type === 'number' ? Number(vorgabe) : e.type === 'boolean' ? istWahr(vorgabe) : vorgabe;
    } else if (e.type === 'boolean') {
        e.default = false;
    }
    if (b.required === true || b.required === 'on' || b.required === '1') e.required = true;

    // Ziele: je Zeile eines. Das Formular schickt sie als Liste.
    const ziele = Array.isArray(b.apply) ? b.apply : [];
    e.apply = ziele.map((z, i) => {
        const t = (k) => (typeof z[k] === 'string' ? z[k].trim() : '');
        const ziel = { target: t('target') };
        const nr = `Ziel ${i + 1}`;
        if (!EINSTELLUNG.ziele.includes(ziel.target)) throw new Error(`${nr}: file, env, arg oder rcon.`);
        if (ziel.target === 'file') {
            if (!t('file') || !t('path')) throw new Error(`${nr}: Datei und Schlüssel darin gehören beide dazu.`);
            if (t('file').split('/').includes('..') || t('file').startsWith('/')) throw new Error(`${nr}: die Datei liegt relativ zu game/, ohne „..".`);
            if (!EINSTELLUNG.parser.includes(t('parser'))) throw new Error(`${nr}: Format der Datei — ${EINSTELLUNG.parser.join(', ')}.`);
            Object.assign(ziel, { file: t('file'), parser: t('parser'), path: t('path') });
        }
        if (ziel.target === 'env') {
            if (!RE_VARIABLE.test(t('variable'))) throw new Error(`${nr}: Name der Umgebungsvariable, etwa SERVER_NAME.`);
            ziel.variable = t('variable');
        }
        if (ziel.target === 'rcon') {
            if (!t('command')) throw new Error(`${nr}: der Befehl, etwa „/config set name {{value}}".`);
            ziel.command = t('command');
        }
        if (t('as')) {
            if (!EINSTELLUNG.als.includes(t('as'))) throw new Error(`${nr}: Schreibweise für Ja/Nein — ${EINSTELLUNG.als.join(', ')}.`);
            ziel.as = t('as');
        }
        return ziel;
    });
    if (!e.apply.length) throw new Error('Mindestens ein Ziel — sonst landet der Wert nirgends.');
    return e;
}

function istWahr(v) {
    return ['1', 'true', 'yes', 'on', 'enabled', 'ja'].includes(String(v).trim().toLowerCase());
}

/** Anlegen oder ersetzen. `alt` ist der bisherige Schlüssel, wenn umbenannt wird. */
async function einstellungSpeichern(sitzung, formular) {
    await pruefeFrei(sitzung);
    const neu = einstellungAusFormular(formular);
    const alt = typeof formular.alt === 'string' ? formular.alt.trim() : '';
    return entwurfSchreiben(sitzung, (e) => {
        const liste = Array.isArray(e.settings) ? e.settings : [];
        const doppelt = liste.find(x => x.key === neu.key && x.key !== alt);
        if (doppelt) throw new Error(`Den Schlüssel „${neu.key}" gibt es schon.`);
        const i = liste.findIndex(x => x.key === (alt || neu.key));
        if (i >= 0) liste[i] = neu; else liste.push(neu);
        e.settings = liste;
        // Der Probewert zieht beim Umbenennen mit.
        const w = e.werkbank?.werte;
        if (w && alt && alt !== neu.key && alt in w) { w[neu.key] = w[alt]; delete w[alt]; }
    });
}

async function einstellungEntfernen(sitzung, key) {
    await pruefeFrei(sitzung);
    return entwurfSchreiben(sitzung, (e) => {
        e.settings = (e.settings || []).filter(x => x.key !== key);
        if (e.werkbank?.werte) delete e.werkbank.werte[key];
    });
}

/** Der Wert, mit dem Probestart und Durchlauf laufen — leer heißt: die Vorgabe. */
async function probewertSetzen(sitzung, key, wert) {
    await pruefeFrei(sitzung);
    const s = (sitzung.entwurf?.settings || []).find(x => x.key === key);
    if (!s) throw new Error(`Keine Einstellung „${key}".`);
    return entwurfSchreiben(sitzung, (e) => {
        e.werkbank = e.werkbank || {};
        e.werkbank.werte = e.werkbank.werte || {};
        if (wert === '' || wert === null || wert === undefined) delete e.werkbank.werte[key];
        else e.werkbank.werte[key] = String(wert).slice(0, 2000);
    });
}

/**
 * Die Werte für den Daemon: Probewert, sonst Vorgabe, sonst leer. Ja/Nein als
 * 1/0 wie beim Anlegen eines Servers (paketWerteAnlegen). Anders als beim
 * echten Start (werteFuerDaemon) gilt die Vorgabe auch bei riskanten
 * Einstellungen: Die Werkbank läuft immer auf einem frischen Volume, es gibt
 * keinen Weltstand, den eine Vorgabe kosten könnte.
 */
function probewerte(sitzung) {
    const w = sitzung.entwurf?.werkbank?.werte || {};
    const aus = {};
    for (const s of sitzung.entwurf?.settings || []) {
        let v = s.key in w ? w[s.key] : s.default;
        if (v === undefined || v === null) v = '';
        aus[s.key] = s.type === 'boolean' ? (istWahr(v) ? '1' : '0') : String(v);
    }
    return aus;
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
        image: sitzungsImage(sitzung),
        start: hatBereitschaft(start) ? start : alsErkundung(start),
        env: entwurfAlsPaket(sitzung, liste).env || {},
        ports: sitzung.entwurf?.ports || [],
        portnummern: w.portnummern,
        settings: probewerte(sitzung),
        einstellungen: sitzung.entwurf?.settings || [],
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

/**
 * Der technische Teil eines Pakets — das, was ein Durchlauf prüft.
 *
 * Name, Beschreibung, Fassung und Bild gehören NICHT dazu: Sie ändern nichts
 * daran, ob das Spiel installiert und startet, und wer nach einem grünen
 * Durchlauf die Beschreibung verbessert, soll nicht neu prüfen müssen
 * (Stufe 4, 2026-09-24).
 */
function technisch(paket) {
    const p = paket || {};
    // `settings` zählt mit (B1): Wer nach einem grünen Durchlauf ein Ziel ändert,
    // hat einen Nachweis für etwas, das es nicht mehr gibt.
    const t = { image: p.image || null, ports: p.ports || [], install: p.install || {}, start: p.start || null, env: p.env || {} };
    if (Array.isArray(p.settings) && p.settings.length) t.settings = p.settings;
    return t;
}

function fingerabdruck(paket) {
    return crypto.createHash('sha256').update(stabil(technisch(paket))).digest('hex');
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
    const bereit = paket.start?.ready_when || {};
    if (!bereit.port && !String(bereit.without_port || '').trim()) {
        m.push('„Bereit, wenn Port" fehlt — grün gibt es über einen Port, oder für ein Spiel ohne prüfbaren Port über die begründete Ausnahme samt Zeile.');
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
    if (paket.start.ready_when.port && !w.portnummern[paket.start.ready_when.port]) {
        throw new Error(`Der Port „${paket.start.ready_when.port}" hat in dieser Sitzung keine Nummer — erst beobachten und übernehmen.`);
    }
    const daemon = await daemonFuer(sitzung);

    const r = await db().query(
        "INSERT INTO werkbank_pruefungen (sitzung_id, status, entwurf, entwurf_hash) VALUES (?, 'laeuft', ?, ?)",
        [sitzung.id, JSON.stringify(paket), fingerabdruck(paket)]);
    const pruefId = r.insertId;
    require('./Ereignisse').merkePruefung(sitzung.kennung, { pruefId, guildId: sitzung.guild_id });

    const antwort = await daemon.senden('werkbank.pruefen', {
        guild_id: sitzung.guild_id, image: sitzungsImage(sitzung),
        start: paket.start, env: paket.env || {}, ports: paket.ports,
        portnummern: w.portnummern, install: paket.install,
        settings: probewerte(sitzung), einstellungen: paket.settings || [],
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

// ── Stufe 4: Angaben, Präsentation, Veröffentlichen ──────────────────────────

const einlieferung = require('../../../../packages/fbpkg/lib/einlieferung');

const RE_SLUG = /^[a-z0-9][a-z0-9-]*$/;       // Schema: identity.slug
const RE_FASSUNG = /^[0-9]+\.[0-9]+\.[0-9]+$/; // Schema: identity.version

/**
 * Eine Bildadresse annehmen — aus der Medienablage (/uploads/…) oder https.
 * Alles andere (javascript:, data:, http:) landete sonst in einem img-src
 * auf jeder Seite, die das Spiel zeigt.
 */
function pruefeBildAdresse(wert, was) {
    const url = String(wert || '').trim();
    if (!url) return null;
    if (url.length > 500 || !(/^\/uploads\/[^\s"'<>]+$/.test(url) || /^https:\/\/[^\s"'<>]+$/.test(url))) {
        throw new Error(`${was}: nur ein Bild aus den Medien (/uploads/…) oder eine https-Adresse.`);
    }
    return url;
}

/** Die Angaben, wie sie im Formular stehen — mit Vorbelegung. */
function angaben(sitzung) {
    const id = sitzung.entwurf?.identity || {};
    const p = sitzung.entwurf?.werkbank?.praesentation || {};
    const b = id.description || {};
    return {
        slug: id.slug || '', name: id.name || sitzung.name || '', version: id.version || '1.0.0',
        beschreibung_de: typeof b === 'object' ? (b.de || '') : String(b || ''),
        beschreibung_en: typeof b === 'object' ? (b.en || '') : '',
        kategorie: id.category || 'other',
        icon_url: p.icon_url || '', banner_url: p.banner_url || '',
    };
}

async function angabenSpeichern(sitzung, f) {
    const slug = String(f.slug || '').trim().toLowerCase();
    if (slug && !RE_SLUG.test(slug)) throw new Error('Slug: Kleinbuchstaben, Ziffern und -, beginnend mit Buchstabe oder Ziffer.');
    const name = String(f.name || '').trim().slice(0, 100);
    if (!name) throw new Error('Name fehlt.');
    const version = String(f.version || '').trim();
    if (version && !RE_FASSUNG.test(version)) throw new Error('Fassung: drei Zahlen, etwa 1.0.0.');
    const kategorie = String(f.kategorie || 'other');
    if (!einlieferung.KATEGORIEN.has(kategorie)) throw new Error('Unbekannte Kategorie.');
    const icon = pruefeBildAdresse(f.icon_url, 'Symbol');
    const banner = pruefeBildAdresse(f.banner_url, 'Banner');
    const de = String(f.beschreibung_de || '').trim().slice(0, 2000);
    const en = String(f.beschreibung_en || '').trim().slice(0, 2000);
    return entwurfSchreiben(sitzung, (e) => {
        const id = { ...(e.identity || {}), name, category: kategorie };
        if (slug) id.slug = slug; else delete id.slug;
        if (version) id.version = version; else delete id.version;
        if (de || en) id.description = { ...(de ? { de } : {}), ...(en ? { en } : {}) }; else delete id.description;
        e.identity = id;
        e.werkbank = { ...(e.werkbank || {}), praesentation: { icon_url: icon, banner_url: banner } };
    });
}

function fassungGroesser(a, b) {
    const x = a.split('.').map(Number), y = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
    return false;
}

/**
 * Welche Einstellungen des geprüften Entwurfs belegt der Durchlauf?
 *
 * Behalten wird eine Einstellung mit genau den Zielen, deren Wert ANKAM
 * (Nachweis des Daemons, werkbank_nachweis.go). Ein Ziel ohne Beleg fällt
 * weg; eine Einstellung ohne belegtes Ziel ebenso — samt der Zeile im
 * Wurzelfeld `env`, die die Werkbank für sie geschrieben hat.
 *
 * `weg` nennt je Einstellung den Grund, so wie der Daemon ihn meldete.
 */
function belegteEinstellungen(entwurf, ergebnis) {
    const nachweis = Array.isArray(ergebnis?.einstellungen) ? ergebnis.einstellungen : null;
    const belegt = (s, z) => (nachweis || []).some(n => n.key === s.key && n.ziel === z.target
        && n.zustand === 'angekommen'
        && (z.target !== 'file' || n.wo === `${z.file}: ${z.path}`)
        && (z.target !== 'env' || n.wo === z.variable));
    const behalten = [];
    const weg = [];
    for (const s of entwurf?.settings || []) {
        const ziele = (s.apply || []).filter(z => belegt(s, z));
        if (ziele.length) {
            behalten.push({ ...s, apply: ziele });
            continue;
        }
        const gruende = (nachweis || []).filter(n => n.key === s.key)
            .map(n => `${n.ziel} ${n.wo || ''}: ${n.zustand}${n.hinweis ? ' — ' + n.hinweis : ''}`.replace(/ +:/, ':'));
        weg.push({
            key: s.key,
            grund: nachweis
                ? (gruende.join('; ') || 'im Durchlauf nicht vorgekommen')
                : 'der Durchlauf enthält keinen Nachweis (Daemon vor dem Einstellungs-Baukasten)',
        });
    }
    // Die von der Werkbank geschriebene env-Zeile geht mit ihrer Einstellung.
    const env = { ...(entwurf?.env || {}) };
    for (const [name, wert] of Object.entries(env)) {
        const m = /^\{\{setting:([a-z][a-z0-9_]*)\}\}$/.exec(wert);
        if (m && !behalten.some(s => s.key === m[1] && s.apply.some(z => z.target === 'env' && z.variable === name))) {
            delete env[name];
        }
    }
    return { behalten, weg, env };
}

/** Benutzt der Entwurf außerhalb von `env` eine Einstellung (`setting:key`)? */
function benutztEinstellung(entwurf, key) {
    const text = JSON.stringify({ start: entwurf?.start || {}, install: entwurf?.install || {} });
    return text.includes(`setting:${key}}`) || text.includes(`"setting:${key}"`);
}

/**
 * Darf veröffentlicht werden? Gründe statt Ja/Nein — die Seite zeigt sie.
 *
 * Verlangt (abgestimmt 2026-09-24): der LETZTE Durchlauf grün, und am
 * technischen Teil hat sich seither nichts geändert; Slug und Fassung
 * gesetzt; gibt es den Slug schon, eine HÖHERE Fassung (Fassungen sind
 * unveränderlich, siehe einlieferung.js).
 */
async function veroeffentlichungsStand(sitzung, liste, pruefListe) {
    const gruende = [];
    const paket = entwurfAlsPaket(sitzung, liste);
    const letzte = pruefListe[0] || null;
    if (!letzte) gruende.push('Noch kein Prüfdurchlauf.');
    else if (letzte.status === 'laeuft') gruende.push('Der Prüfdurchlauf läuft noch.');
    else if (letzte.status !== 'gruen') gruende.push('Der letzte Prüfdurchlauf war rot.');
    else if (fingerabdruck(letzte.entwurf) !== fingerabdruck(paket)) {
        gruende.push('Seit dem grünen Durchlauf hat sich der technische Teil geändert — neu prüfen.');
    }
    // Angeheftet wird der Digest DIESES Durchlaufs — ohne Aufzeichnung gibt es
    // nichts anzuheften (Durchläufe vor Baustelle 166).
    else if (!letzte.ergebnis?.image_digest) {
        gruende.push('Der grüne Durchlauf nennt sein Image nicht (älter als die Digest-Aufzeichnung) — neu prüfen.');
    }
    else {
        // Eine Einstellung ohne Beleg fällt beim Veröffentlichen weg. Benutzt
        // die Startzeile oder ein Schritt sie trotzdem, hinge dort ein Verweis
        // ins Leere — das Paket wäre kaputt, nicht bloß kleiner.
        for (const w of belegteEinstellungen(letzte.entwurf, letzte.ergebnis).weg) {
            if (benutztEinstellung(letzte.entwurf, w.key)) {
                gruende.push(`„${w.key}" wird in Startzeile oder Schritten benutzt, hat aber kein belegtes Ziel (${w.grund}).`);
            }
        }
    }
    const id = paket.identity || {};
    if (!id.slug) gruende.push('Slug fehlt.');
    if (!id.version) gruende.push('Fassung fehlt.');
    let neueste = null;
    if (id.slug) {
        const zeilen = await db().query(
            `SELECT pv.version FROM package_versions pv JOIN packages p ON p.id = pv.package_id WHERE p.slug = ?`, [id.slug]);
        for (const z of zeilen) if (!neueste || fassungGroesser(z.version, neueste)) neueste = z.version;
        if (neueste && id.version && !fassungGroesser(id.version, neueste)) {
            gruende.push(`„${id.slug}" gibt es schon bis ${neueste} — die Fassung muss höher sein.`);
        }
    }
    return { darf: gruende.length === 0, gruende, neueste, pruefung: letzte };
}

/** Das Paket, wie es eingeliefert wird. */
function veroeffentlichungsPaket(sitzung, liste, pruefung, autor) {
    const e = entwurfAlsPaket(sitzung, liste);
    const heute = new Date().toISOString().slice(0, 10);
    const am = pruefung.beendet_am ? new Date(pruefung.beendet_am).toISOString().slice(0, 16).replace('T', ' ') : heute;
    const identity = {
        slug: e.identity.slug, name: e.identity.name || e.identity.slug, version: e.identity.version,
        ...(autor ? { author: String(autor) } : {}),
        ...(e.identity.description ? { description: e.identity.description } : {}),
        category: e.identity.category || 'other',
        origin: { type: 'installer', source: `werkbank:${sitzung.kennung}`, imported_at: heute },
    };
    return {
        format: 'FBPKG_v1', identity,
        // Der technische Teil aus dem GEPRÜFTEN Entwurf — gleich per Fingerabdruck,
        // aber so steht außer Frage, was eingeliefert wird.
        ...technisch(pruefung.entwurf),
        // Nur belegte Einstellungen (B1) — die übrigen bleiben in der Sitzung.
        ...(() => {
            const b = belegteEinstellungen(pruefung.entwurf, pruefung.ergebnis);
            const teil = { settings: b.behalten, env: b.env };
            if (!teil.settings.length) delete teil.settings;
            if (!Object.keys(teil.env).length) delete teil.env;
            return teil;
        })(),
        // Angeheftet wird der Digest, auf dem der grüne Durchlauf WIRKLICH lief
        // (der Daemon meldet ihn) — nicht der, der beim Veröffentlichen gerade
        // hinter dem Tag steht (Baustelle 166).
        image: {
            ...(pruefung.entwurf?.image || {}),
            digest: pruefung.ergebnis?.image_digest,
            pinned_at: heute,
        },
        status: {
            complete: false,
            open: [
                `Aus der Werkbank (Sitzung ${sitzung.kennung}). Prüfdurchlauf #${pruefung.id} grün am ${am} UTC: `
                    + `ganzes Rezept auf leerem Volume, bereit über den Port, Stoppfolge endete vor sigkill.`,
                ...(() => {
                    const b = belegteEinstellungen(pruefung.entwurf, pruefung.ergebnis);
                    const zeilen = [];
                    if (!b.behalten.length && !b.weg.length) {
                        zeilen.push('Keine Einstellungen — der Server ist startbar, aber nicht einstellbar.');
                    }
                    if (b.behalten.length) {
                        zeilen.push(`Einstellungen: ${b.behalten.length} im Durchlauf #${pruefung.id} als angekommen belegt `
                            + '(Datei per fb-init-Meldung, Startzeile/Umgebung per Gegenwert). Ob das Spiel den Wert BEACHTET, '
                            + 'ist damit nicht gezeigt.');
                    }
                    for (const w of b.weg) zeilen.push(`Nicht aufgenommen: Einstellung „${w.key}" — ${w.grund}`);
                    return zeilen;
                })(),
                // Der Notausgang gehört genannt (check-pakete, BEFUND) — samt dem
                // Grund, den die Werkbank beim Anlegen des Schritts erfragt.
                ...(pruefung.entwurf?.install?.steps || []).map((x, i) => (x.type === 'script'
                    ? `Notausgang: install-Schritt ${i + 1} ist ein script — ${(x.reason && (x.reason.de || x.reason.en)) || 'ohne Begründung'}`
                    : null)).filter(Boolean),
            ],
        },
    };
}

async function veroeffentlichen(sitzung, liste, pruefListe, { autor } = {}) {
    const stand = await veroeffentlichungsStand(sitzung, liste, pruefListe);
    if (!stand.darf) throw new Error(stand.gruende.join(' '));
    const paket = veroeffentlichungsPaket(sitzung, liste, stand.pruefung, autor);
    // Dasselbe Tor wie die Kommandozeile: check-pakete.js über eine Datei.
    const fs = require('fs'), os = require('os'), path = require('path');
    const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'werkbank-'));
    const datei = path.join(ordner, `${paket.identity.slug}.json`);
    try {
        fs.writeFileSync(datei, JSON.stringify(paket, null, 2));
        const tor = einlieferung.bestehtPruefung(datei);
        if (!tor.ok) throw new Error('Die Paketprüfung lehnt ab: ' + einlieferung.grundZeilen(tor.text).join(' · '));
    } finally {
        fs.rmSync(ordner, { recursive: true, force: true });
    }
    const zeilen = [];
    const r = await einlieferung.liefereEin(einlieferung.fuerDbService(db()), paket, {
        wirklich: true, etikett: paket.identity.slug,
        testBestanden: stand.pruefung.beendet_am ? new Date(stand.pruefung.beendet_am) : new Date(),
        praesentation: sitzung.entwurf?.werkbank?.praesentation || null,
        log: (z) => zeilen.push(z),
    });
    if (r.art !== 'neu') throw new Error(r.grund || zeilen.join(' ') || 'nicht eingeliefert');
    await entwurfSchreiben(sitzung, (e) => {
        e.werkbank = { ...(e.werkbank || {}) };
        e.werkbank.veroeffentlicht = [...(e.werkbank.veroeffentlicht || []), {
            slug: paket.identity.slug, version: paket.identity.version, am: new Date().toISOString(),
            pruef_id: stand.pruefung.id, paket_id: r.paketId,
        }];
    });
    return { slug: paket.identity.slug, version: paket.identity.version, paketId: r.paketId, meldungen: zeilen };
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

// ── Vorschläge aus einer Datei (Einstellungs-Baukasten B2-1, 2026-09-29) ─────
//
// Der Daemon liest die Datei mit derselben Schlüsselschreibweise wie sein
// Schreiber (internal/parser/lesen.go) — hier wird NICHT zerlegt. Ein zweiter
// Leser in JavaScript wäre eine zweite Auslegung von „ServerSettings.Name".

/** Format aus der Endung — nur ein Vorschlag, im Formular änderbar. */
const FORMAT_NACH_ENDUNG = { json: 'json', ini: 'ini', yml: 'yaml', yaml: 'yaml', properties: 'properties', xml: 'xml' };
function formatVermuten(datei) {
    const endung = String(datei).split('.').pop().toLowerCase();
    return FORMAT_NACH_ENDUNG[endung] || '';
}

/**
 * Welche Dateien sich anbieten, relativ zu game/ — so steht es später in
 * `apply.file`. data/ fällt heraus: `apply: file` rechnet ab game/.
 *
 *   1. Ziele der template-Schritte. Gemessen an Factorio (2026-09-29): Die
 *      server-settings.json legt die Installation an, das Spiel ändert sie
 *      beim Start nicht — im Vorher/Nachher-Vergleich taucht die wichtigste
 *      Datei deshalb nie auf.
 *   2. Neu oder geändert unter game/ in den letzten Probestarts.
 *
 * Jeweils nur mit einer Endung, die ein Schreiber kennt.
 */
function vorschlagsDateien(laeufe, schritte = []) {
    const gesehen = new Set();
    const aus = [];
    for (const schritt of schritte || []) {
        const datei = schritt?.type === 'template' && typeof schritt.file === 'string' ? schritt.file.replace(/^game\//, '') : '';
        if (!datei || gesehen.has(datei) || !formatVermuten(datei)) continue;
        gesehen.add(datei);
        aus.push({ datei, format: formatVermuten(datei), herkunft: 'template' });
    }
    const vorn = aus.length;
    for (const lauf of laeufe || []) {
        const d = json(lauf.dateien, null);
        if (!d) continue;
        for (const x of [...(d.neu || []), ...(d.geaendert || [])]) {
            if (!x.pfad?.startsWith('game/')) continue;
            const datei = x.pfad.slice(5);
            if (gesehen.has(datei) || !formatVermuten(datei)) continue;
            gesehen.add(datei);
            aus.push({ datei, format: formatVermuten(datei), groesse: x.groesse, herkunft: 'probestart' });
        }
    }
    const nachName = (a, b) => a.datei.localeCompare(b.datei);
    return [...aus.slice(0, vorn).sort(nachName), ...aus.slice(vorn).sort(nachName)];
}

const RE_DATEI = /^(?!\/)(?!.*(^|\/)\.\.(\/|$))[^\0]{1,300}$/;

/** Vom Daemon lesen lassen — gibt Funde, Auslassungen und die Zuordnung zu Vorhandenem. */
async function schluesselLesen(sitzung, { datei, parser }) {
    datei = String(datei || '').trim().replace(/^game\//, '');
    if (!RE_DATEI.test(datei)) throw new Error('Datei relativ zu game/ angeben, ohne „..".');
    if (!EINSTELLUNG.parser.includes(parser) || parser === 'text') {
        throw new Error('Format: ini, json, yaml, properties oder xml.');
    }
    const daemon = await daemonFuer(sitzung);
    const antwort = await daemon.senden('werkbank.schluessel', { datei, parser });
    if (!antwort?.success) throw new Error(antwort?.error || 'Der Daemon hat nicht geantwortet');
    const d = antwort.data || {};
    const settings = sitzung.entwurf?.settings || [];
    const vergeben = new Set(settings.map(s => s.key));
    const funde = (d.funde || []).map((f) => {
        const da = settings.find(s => (s.apply || []).some(z => z.target === 'file' && z.file === datei && z.path === f.pfad));
        const key = da ? da.key : freierSchluessel(f.pfad, vergeben);
        if (!da) vergeben.add(key);
        return { ...f, vorhanden: da ? da.key : null, vorschlag: vorschlagAusFund(f, key) };
    });
    return { datei, parser, funde, ausgelassen: d.ausgelassen || [], anzahl_funde: d.anzahl_funde || funde.length };
}

/** Aus „ServerSettings.MaxPlayers" wird „max_players" — frei in dieser Sitzung. */
function freierSchluessel(pfad, vergeben) {
    const letzter = String(pfad).split('.').pop();
    let basis = letzter.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (!/^[a-z]/.test(basis)) basis = 'wert_' + basis;
    basis = basis.slice(0, 48) || 'wert';
    let key = basis;
    for (let n = 2; vergeben.has(key); n++) key = `${basis}_${n}`;
    return key;
}

const RE_GEHEIM = /(pass(wor[dt])?|secret|token|kennwort)/i;

/** Was beim Übernehmen angelegt würde — sichtbar, bevor angekreuzt wird. */
function vorschlagAusFund(f, key) {
    const name = String(f.pfad).split('.').pop().replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim();
    let type = f.art === 'janein' ? 'boolean' : f.art === 'zahl' ? 'number' : 'text';
    if (type === 'text' && RE_GEHEIM.test(f.pfad)) type = 'password';
    return { key, name_de: name.charAt(0).toUpperCase() + name.slice(1), type, as: f.as || '' };
}

/**
 * Angekreuztes als Einstellungen anlegen. Die Datei wird NOCH EINMAL gelesen:
 * Übernommen wird nur ein Pfad, den der Daemon jetzt anbietet — nicht, was
 * das Formular behauptet. Rolle „Experte", Wirkung „Neustart": sichtbar nur in
 * der fachlichen Ansicht, bis ein Mensch es anders entscheidet.
 */
async function vorschlaegeUebernehmen(sitzung, { datei, parser, auswahl }) {
    await pruefeFrei(sitzung);
    if (!Array.isArray(auswahl) || !auswahl.length) throw new Error('Nichts angekreuzt.');
    const lesung = await schluesselLesen(sitzung, { datei, parser });
    const neu = [];
    for (const a of auswahl) {
        const f = lesung.funde.find(x => x.pfad === a?.pfad);
        if (!f) throw new Error(`„${a?.pfad}" bietet die Datei nicht (mehr) an — neu lesen.`);
        if (f.vorhanden) throw new Error(`„${f.pfad}" ist schon als „${f.vorhanden}" angelegt.`);
        const v = f.vorschlag;
        const formular = {
            key: typeof a.key === 'string' && a.key.trim() ? a.key.trim() : v.key,
            name_de: typeof a.name_de === 'string' && a.name_de.trim() ? a.name_de.trim() : v.name_de,
            type: EINSTELLUNG.typen.includes(a.type) ? a.type : v.type,
            role: 'expert', takes_effect: 'restart', risk: 'none',
            apply: [{ target: 'file', file: lesung.datei, parser: lesung.parser, path: f.pfad, as: v.as }],
        };
        if (formular.type !== 'boolean') formular.apply[0].as = '';
        // Der Wert aus der Datei ist die Vorgabe — bei Kennwörtern nicht: Was
        // das Spiel beim ersten Start hineinschrieb, soll nicht in jedes Paket.
        if (formular.type === 'boolean') formular.default = ['true', 'yes', 'on', 'enabled'].includes(String(f.wert).toLowerCase()) ? '1' : '0';
        else if (formular.type === 'number') formular.default = Number.isFinite(Number(f.wert)) && f.wert !== '' ? f.wert : '';
        else if (formular.type === 'text') formular.default = f.wert;
        neu.push(einstellungAusFormular(formular));
    }
    const keys = neu.map(e => e.key);
    if (new Set(keys).size !== keys.length) throw new Error('Zwei angekreuzte Einträge haben denselben Schlüssel.');
    return entwurfSchreiben(sitzung, (e) => {
        const liste = Array.isArray(e.settings) ? e.settings : [];
        const doppelt = neu.find(n => liste.some(x => x.key === n.key));
        if (doppelt) throw new Error(`Den Schlüssel „${doppelt.key}" gibt es schon.`);
        e.settings = liste.concat(neu);
    });
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
    sitzungsImage,
    RE_KENNUNG, RE_ZWECK, SCHRITTTYPEN, MAX_AUSGABE, GRENZEN, VORGABE, ERKUNDUNG, hatBereitschaft,
    waehlbareImages, maschinen, liste, laden, schritte, anlegen,
    schrittAusfuehren, ausgabeAnhaengen, beenden, laufenderSchritt,
    herausnehmen, verwerfen, entwurfAlsPaket,
    PRUEF_SUFFIX, fingerabdruck, technisch,
    pruefeBildAdresse, angaben, angabenSpeichern, veroeffentlichungsStand, veroeffentlichungsPaket, veroeffentlichen, laufendePruefung, pruefungen, durchlaufMaengel, pruefen,
    pruefungAbbrechen, pruefProtokoll, pruefungBeenden,
    EINSTELLUNG, einstellungAusFormular, einstellungSpeichern, einstellungEntfernen, probewertSetzen, probewerte,
    umgebungAusEinstellungen, belegteEinstellungen,
    werkbankTeil, ungenutztePorts, startSpeichern, starten, stoppen, eingabe, laeufe, laufenderLauf,
    portUebernehmen, portEntfernen, bereitschaftszeile,
    laufSetzen, konsoleAnhaengen, laufBeenden, dateienJetzt, gruppiere,
    formatVermuten, vorschlagsDateien, schluesselLesen, vorschlaegeUebernehmen, freierSchluessel,
};
