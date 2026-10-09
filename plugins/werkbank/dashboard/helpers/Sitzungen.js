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
const Paketfassung = require('../../../gameserver/dashboard/helpers/Paketfassung');
// Die Tags eines Spiels gehören dem Spiel im Panel, nicht dem Paket (2026-10-08) —
// die Werkbank reicht sie beim Veröffentlichen weiter, wie Symbol und Banner.
const Tags = require('../../../../apps/dashboard/helpers/Tags');

// ── Durchreichen (2026-10-07) ───────────────────────────────────────────────
//
// Die fünf Bestandspakete (Valheim, Minecraft, Astro Colony, Factorio) tragen
// Teile, für die die Werkbank keine Karte hat: Abfrage und Fernsteuerung
// (`management`), Mod-Verwaltung (`content`), Befehle, Sperrliste, feste Zeilen
// in Dateien, Konsolenfilter, Systempakete. Eine Sitzung „Valheim", als
// `valheim` veröffentlicht, hätte das volle Paket durch ein abgespecktes
// ersetzt.
//
// Betreiber (2026-10-07): *„die werkbank muss genau das liefern können … wenn
// das fehlt muss es rein"* — und als Weg: **erst durchreichen, dann Karte für
// Karte.** Durchreichen heisst: Öffnet die Werkbank ein fertiges Paket, nimmt
// sie diese Teile UNVERÄNDERT mit (`entwurf.durchgereicht`), zeigt sie und
// liefert sie wieder ein. Bekommt ein Teil seine Karte, verlässt er diese Liste.
//
// Dieselbe Haltung wie bei den Startzeilen: Was sich nicht ausdrücken lässt,
// wird nie still umgebaut oder verworfen.
const DURCHGEREICHT = ['management', 'content', 'commands', 'files', 'config', 'console', 'requirements'];
/** Vom `install`-Block trägt die Werkbank nur `steps` selbst; der Rest reist mit. */
const INSTALL_DURCHGEREICHT = ['cache', 'entfernen'];

// Ein Schritt gehört zum Entwurf, wenn er in dieser Sitzung gelaufen ist (`ok`)
// oder aus einem geöffneten Paket stammt (`uebernommen` — dort hat er sich
// längst bewährt, im Volume DIESER Sitzung lief er noch nicht).
//
// Ein übernommener Schritt bleibt auch im Entwurf, WÄHREND er läuft
// (2026-10-08): Er gehört zum Paket, ob er hier gerade durch ist oder nicht —
// der Entwurf darf nicht für die Dauer eines SteamCMD-Laufs einen Schritt
// weniger haben. Ein von Hand angelegter kommt erst hinein, wenn er gelungen ist.
const IM_ENTWURF = ['ok', 'uebernommen'];
const imEntwurf = (s) => IM_ENTWURF.includes(s.status) || (s.status === 'laeuft' && Boolean(s.uebernommen_aus));

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

// ── Der neueste Bau (2026-10-09) ─────────────────────────────────────────────
//
// `images/bauen.sh` vergibt die Fassung nach dem Datum: Ein Bau im Oktober
// heisst 2026.10. Sitzungen und Pakete nannten bis dahin den Monat, in dem sie
// entstanden — und der erste Bau im neuen Monat erreichte niemanden: Die
// Sitzung fragte weiter 2026.09, und angeboten wurde nur, was ein Paket schon
// benutzte.
//
// Abgesprochen mit dem Betreiber (2026-10-09): Eine Sitzung nimmt IMMER den
// neuesten Bau ihres Images. Den zeigt der Tag `latest` bzw.
// `latest-<variante>`, den bauen.sh bei jedem Bau mitschiebt — kein Monat,
// keine Liste. Der Daemon löst ihn je Lauf zum Digest auf (festesImage), und
// der Prüfdurchlauf meldet Digest UND Kalenderfassung des Images zurück
// (`image_digest`, `image_tag`); genau die stehen danach im Paket.
//
// Die Ausprägung bleibt Teil der Wahl: proton GE-Proton10-32 und GE-Proton11-5
// sind zwei Images, nicht zwei Stände von einem.
const { imageVariante, neuesterTag, istKalendertag, imageName } = require('../../../../packages/fbpkg/lib/imagetag');

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
    // Was die Sitzung gespeichert hat, kann noch ein Monat sein (2026.09) —
    // gefragt wird immer der neueste Bau derselben Ausprägung.
    return { ref: i.ref, ...(i.tag ? { tag: neuesterTag(i.tag) } : {}), ...(i.platform ? { platform: i.platform } : {}) };
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
        // Angeboten wird das Image in seiner Ausprägung, nicht ein Monat davon:
        // Zwei Pakete auf 2026.09 und 2026.10 nennen dasselbe Image.
        const tag = neuesterTag(img.tag);
        const schluessel = `${img.ref}:${tag}`;
        if (!gesehen.has(schluessel)) gesehen.set(schluessel, { ref: img.ref, tag, variante: imageVariante(img.tag) || '' });
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
               (SELECT COUNT(*) FROM werkbank_schritte x WHERE x.sitzung_id = s.id
                   AND (x.status IN ('ok', 'uebernommen') OR (x.status = 'laeuft' AND x.uebernommen_aus IS NOT NULL))) AS schritte_ok,
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
    // Geordnet: Eine Sitzung, die vor einer neuen Karte geöffnet wurde, trägt
    // deren Stück noch im Durchgereichten (siehe EIGENE).
    s.entwurf = ordne(json(s.entwurf, {}));
    return s;
}

async function schritte(sitzungId) {
    const zeilen = await db().query(
        'SELECT * FROM werkbank_schritte WHERE sitzung_id = ? ORDER BY nr, id', [sitzungId]);
    return zeilen.map(z => ({ ...z, schritt: json(z.schritt, {}), dateien: json(z.dateien, null) }));
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
        [kennung, guildId, userId || null, name2, maschine.id, JSON.stringify({ ref: img.ref, tag: img.tag }),
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
    return schickeSchritt(sitzung, daemon, r.insertId, schritt, {});
}

/**
 * Einen Schritt, der schon als `laeuft` in der Liste steht, an den Daemon geben.
 * Der eine Weg für beide Arten: von Hand angelegt und aus einem Paket übernommen.
 */
async function schickeSchritt(sitzung, daemon, schrittId, schritt, settings) {
    require('./Ereignisse').merke(sitzung.kennung, { schrittId, guildId: sitzung.guild_id });

    const antwort = await daemon.senden('werkbank.schritt', {
        guild_id: sitzung.guild_id,
        image: sitzungsImage(sitzung),
        schritt,
        settings,
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

/**
 * Die übernommenen Schritte einer geöffneten Sitzung im Volume ausführen
 * (2026-10-08) — den nächsten in der Reihe; `nachSchritt` setzt die Kette fort.
 *
 * Bis dahin standen sie nur in der Liste. Das Volume einer Sitzung entsteht
 * aber mit dem ersten Schritt, der dort LÄUFT: Eine geöffnete Sitzung hatte
 * keins, und der Probestart scheiterte mit „die Sitzung hat noch kein Volume"
 * (Betreiber, Astro Colony). Die Annahme dahinter — „der Prüfdurchlauf fährt
 * sie ohnehin" — übersah, dass vor dem Durchlauf probiert wird.
 *
 * Anders als ein von Hand angelegter Schritt bekommt ein übernommener die
 * Probewerte der Sitzung mit: Schritte fertiger Pakete setzen Einstellungen
 * ein (Astro Colony schreibt elf davon in seine Datei, Valheim wählt den
 * Zweig), und der Prüfdurchlauf gibt ihnen dieselben.
 *
 * @returns {Promise<{schrittId: number|null, angenommen: boolean, fehler?: string}>}
 *          `schrittId: null` — es gibt keinen übernommenen Schritt mehr
 */
async function uebernommeneAusfuehren(sitzung) {
    await pruefeFrei(sitzung);
    const [z] = await db().query(
        "SELECT id, schritt FROM werkbank_schritte WHERE sitzung_id = ? AND status = 'uebernommen' ORDER BY nr, id LIMIT 1",
        [sitzung.id]);
    if (!z) return { schrittId: null, angenommen: false };
    const schritt = json(z.schritt, null);
    if (!schritt || !SCHRITTTYPEN.includes(schritt.type)) {
        throw new Error(`Der übernommene Schritt #${z.id} hat einen Typ, den die Werkbank nicht ausführt („${schritt?.type || ''}").`);
    }
    const daemon = await daemonFuer(sitzung);
    // Erst jetzt umstellen — ohne Daemon bleibt der Schritt, wie er war.
    const r = await db().query(
        `UPDATE werkbank_schritte
            SET status = 'laeuft', fehler = NULL, dateien = NULL, begonnen_am = NOW(), beendet_am = NULL,
                ausgabe = CONCAT(COALESCE(ausgabe, ''), '==> Läuft jetzt im Volume dieser Sitzung.\n')
          WHERE id = ? AND status = 'uebernommen'`, [z.id]);
    if (!r?.affectedRows) throw new Error('Der Schritt wurde gerade von anderer Stelle gestartet oder herausgenommen.');
    return schickeSchritt(sitzung, daemon, z.id, schritt, probewerte(sitzung));
}

/**
 * Nach dem Ende eines Schritts: War er übernommen und ist gelungen, läuft der
 * nächste übernommene an. Aus der Datenbank abgelesen, nicht aus dem Speicher —
 * die Kette übersteht so einen Neustart des Dashboards mitten im Lauf.
 *
 * @returns {Promise<object|null>} das Ergebnis des nächsten Starts, oder null
 */
async function ketteFortsetzen(guildId, kennung, schrittId) {
    const [z] = await db().query(
        'SELECT status, uebernommen_aus FROM werkbank_schritte WHERE id = ?', [schrittId]);
    if (!z || z.status !== 'ok' || !z.uebernommen_aus) return null;
    const sitzung = await laden(guildId, kennung);
    if (!sitzung || sitzung.status !== 'offen') return null;
    const ergebnis = await uebernommeneAusfuehren(sitzung);
    return ergebnis.schrittId ? ergebnis : null;
}

/** Wie viele übernommene Schritte in dieser Sitzung noch nicht gelaufen sind. */
function offeneUebernommene(liste) {
    return (liste || []).filter(s => s.status === 'uebernommen').length;
}

/** Ausgabe anhängen — begrenzt auf die letzten MAX_AUSGABE Zeichen. */
async function ausgabeAnhaengen(schrittId, text) {
    await db().query(
        `UPDATE werkbank_schritte
            SET ausgabe = RIGHT(CONCAT(COALESCE(ausgabe, ''), ?), ?)
          WHERE id = ?`, [text, MAX_AUSGABE, schrittId]);
}

/**
 * Einen laufenden Schritt beenden.
 *
 * Ein Schritt aus einem geöffneten Paket (`uebernommen_aus`), der scheitert,
 * fällt auf `uebernommen` zurück statt auf `fehler`: Er gehört weiter zum
 * Entwurf und lässt sich wiederholen. Als `fehler` fiele er heraus, und das
 * nächste veröffentlichte Paket hätte einen Schritt weniger — wegen eines
 * Netzwerkfehlers. Der Grund steht trotzdem am Schritt.
 */
async function beenden(schrittId, { status, fehler = null, bytes = null, dateien = null }) {
    await db().query(
        `UPDATE werkbank_schritte
            SET status = IF(? = 'fehler' AND uebernommen_aus IS NOT NULL, 'uebernommen', ?),
                fehler = ?, bytes = ?, dateien = ?, beendet_am = NOW()
          WHERE id = ? AND status = 'laeuft'`,
        [status, status, fehler, bytes, dateien ? JSON.stringify(dateien) : null, schrittId]);
}

const RE_SUMME = /^(sha256:[0-9a-f]{64}|sha1:[0-9a-f]{40})$/;

/**
 * Die vom Daemon gerechnete Prüfsumme in einen download-Schritt eintragen (W2).
 *
 * Nur, wenn der Schritt ein download OHNE Summe ist — eine angegebene wird nie
 * überschrieben. Ab hier prüfen Prüfdurchlauf und jede Installation gegen sie.
 * @returns {Promise<boolean>} ob eingetragen wurde
 */
async function pruefsummeEintragen(schrittId, summe) {
    if (!RE_SUMME.test(String(summe || ''))) return false;
    const [z] = await db().query('SELECT schritt FROM werkbank_schritte WHERE id = ?', [schrittId]);
    const s = json(z?.schritt, null);
    if (!s || s.type !== 'download' || s.checksum) return false;
    s.checksum = summe;
    await db().query('UPDATE werkbank_schritte SET schritt = ? WHERE id = ?', [JSON.stringify(s), schrittId]);
    return true;
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
        "UPDATE werkbank_schritte SET status = 'herausgenommen' WHERE id = ? AND sitzung_id = ? AND status IN ('ok','fehler','uebernommen')",
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
        install: { steps: liste.filter(imEntwurf).map(s => s.schritt) },
    };
    // Durchgereichtes aus einem geöffneten Paket: unverändert zurück ins Paket.
    const d = e.durchgereicht || {};
    for (const k of INSTALL_DURCHGEREICHT) if (d.install && d.install[k] !== undefined) paket.install[k] = d.install[k];
    for (const k of DURCHGEREICHT) if (d[k] !== undefined) paket[k] = d[k];
    // Was eine eigene Karte hat, liegt im Entwurf und kommt hier dazu (EIGENE).
    for (const teil of Object.keys(EIGENE)) {
        if (Array.isArray(e[teil])) {
            if (e[teil].length) paket[teil] = e[teil];
            continue;
        }
        const eigen = {};
        for (const f of eigeneFelder(teil, e[teil])) if (e[teil]?.[f] !== undefined) eigen[f] = e[teil][f];
        if (Object.keys(eigen).length) paket[teil] = { ...(paket[teil] || {}), ...eigen };
    }
    if (e.start) paket.start = e.start;
    const settings = Array.isArray(e.settings) ? e.settings : [];
    const env = { ...(e.env || {}), ...umgebungAusEinstellungen(settings, e.env || {}, uebernommeneZiele(sitzung)) };
    if (Object.keys(env).length) paket.env = env;
    if (settings.length) paket.settings = settings;
    // Hinweise sind Text für Menschen — sie reisen mit, zählen aber nicht zum
    // technischen Teil (`technisch`): Wer einen Satz verbessert, prüft nicht neu.
    if (Array.isArray(e.hints) && e.hints.length) paket.hints = e.hints;
    return paket;
}

// ── Hinweise für Betreiber (2026-10-06) ─────────────────────────────────────
//
// Was sich nicht einstellen lässt und was man trotzdem wissen muss. Anlass war
// StarRupture: Der erste Start braucht „neue Welt", danach muss auf „laden"
// umgestellt werden; beitreten geht nur über die IP; ein Passwort gibt es nur
// über zwei Dateien. Bis dahin stand das in einem Papier, das kein Betreiber
// eines Servers je sieht.
//
// Fester Text aus dem Paket (de/en), mit einem Zeitpunkt. KEIN Auswerten der
// Spielausgabe (Betreiber, 2026-09-30: Spiel-Internes und Externes nicht
// mischen). Der Daemon liest das Feld nicht — es gehört dem Dashboard.
const HINWEIS = {
    wann: ['create', 'install', 'run'],
    max: 600,
};

function hinweisAusFormular(b) {
    const text = (k) => (typeof b?.[k] === 'string' ? b[k].trim() : '');
    const key = text('key');
    if (!RE_SCHLUESSEL.test(key)) throw new Error('Schlüssel: Kleinbuchstaben, Ziffern und _, beginnend mit einem Buchstaben — etwa „erste_einrichtung".');
    if (!HINWEIS.wann.includes(text('when'))) throw new Error(`Zeitpunkt: ${HINWEIS.wann.join(', ')}.`);
    const de = text('text_de'), en = text('text_en');
    if (!de && !en) throw new Error('Der Hinweis braucht einen Text — deutsch, englisch oder beides.');
    for (const [sprache, t] of [['deutsch', de], ['englisch', en]]) {
        if (t.length > HINWEIS.max) throw new Error(`Der Text (${sprache}) hat ${t.length} Zeichen — höchstens ${HINWEIS.max}. Ein Hinweis ist ein Absatz, keine Anleitung.`);
    }
    const h = { key, when: text('when'), text: {} };
    if (de) h.text.de = de;
    if (en) h.text.en = en;
    return h;
}

/** Anlegen oder ersetzen. `alt` ist der bisherige Schlüssel, wenn umbenannt wird. */
async function hinweisSpeichern(sitzung, formular) {
    const neu = hinweisAusFormular(formular);
    const alt = typeof formular?.alt === 'string' ? formular.alt.trim() : '';
    return entwurfSchreiben(sitzung, (e) => {
        const liste = Array.isArray(e.hints) ? e.hints : [];
        if (liste.find(x => x.key === neu.key && x.key !== alt)) throw new Error(`Den Hinweis „${neu.key}" gibt es schon.`);
        const i = liste.findIndex(x => x.key === (alt || neu.key));
        if (i >= 0) liste[i] = neu; else liste.push(neu);
        e.hints = liste;
    });
}

async function hinweisEntfernen(sitzung, key) {
    return entwurfSchreiben(sitzung, (e) => {
        e.hints = (e.hints || []).filter(x => x.key !== key);
        if (!e.hints.length) delete e.hints;
    });
}

// Welche Felder die Formulare der Werkbank selbst schreiben. Alles andere an
// demselben Gegenstand gehört einem geöffneten Paket und bleibt beim Speichern
// stehen (`behalteUnbekanntes`).
const START_FELDER = ['program', 'workdir', 'args', 'stop', 'ready_when'];
const BEREIT_FELDER = ['port', 'log_line', 'without_port', 'timeout_sec'];
const EINSTELLUNG_FELDER = ['key', 'group', 'name', 'description', 'type', 'default', 'min', 'max',
    'choices', 'apply', 'takes_effect', 'risk', 'role', 'required'];

/**
 * `neu` ersetzt in `vorher` genau die Felder, die das Formular kennt — ein
 * bekanntes Feld, das `neu` nicht mehr trägt, ist damit weg (geleert). Jedes
 * andere Feld von `vorher` bleibt.
 */
function behalteUnbekanntes(vorher, neu, bekannt) {
    const aus = {};
    for (const [k, v] of Object.entries(vorher || {})) if (!bekannt.includes(k)) aus[k] = v;
    return { ...aus, ...(neu || {}) };
}

/**
 * Die Ziele der Einstellungen, wie sie im geöffneten Paket standen: Schlüssel →
 * Liste der Ziele als stabiler Text. Leer bei einer Sitzung, die nichts geöffnet hat.
 */
function uebernommeneZiele(sitzung) {
    return sitzung?.entwurf?.werkbank?.geoeffnet?.ziele || {};
}

/** Stand genau dieses Ziel unter diesem Schlüssel schon im geöffneten Paket? */
function istUebernommen(uebernommen, key, ziel) {
    const liste = uebernommen?.[key];
    return Array.isArray(liste) && liste.includes(stabil(ziel));
}

/** Aus einem Paket: Schlüssel → seine Ziele als stabiler Text (für `geoeffnet.ziele`). */
function zieleAusPaket(paket) {
    const aus = {};
    // Auch Einstellungen OHNE Ziel stehen drin (leere Liste): Minecrafts `loader`
    // wirkt über Bedingungen der Startzeile, `modpack` verwaltet die Mod-Karte.
    for (const s of paket?.settings || []) aus[s.key] = (Array.isArray(s.apply) ? s.apply : []).map(stabil);
    return aus;
}

/** Der Startteil aus dem Formular, über den vorhandenen gelegt — Unbekanntes bleibt. */
function mischeStart(vorher, neu) {
    const bereitVorher = vorher?.ready_when;
    const aus = behalteUnbekanntes(vorher, neu, START_FELDER);
    if (neu?.ready_when || bereitVorher) {
        aus.ready_when = behalteUnbekanntes(bereitVorher, neu?.ready_when || {}, BEREIT_FELDER);
        if (!Object.keys(aus.ready_when).length) delete aus.ready_when;
    }
    return aus;
}

/**
 * Eine Einstellung aus dem Formular, über die vorhandene gelegt. Unbekannte
 * Felder bleiben — auch an den Auswahlmöglichkeiten: Der Typ eines Werts (Zahl,
 * Wahrheitswert), der englische Name und ein Hinweistext gehören dem Paket, das
 * Formular kennt davon nur Wert und deutschen Namen.
 */
function mischeEinstellung(vorher, neu) {
    const aus = behalteUnbekanntes(vorher, neu, EINSTELLUNG_FELDER);
    // Zwei Dinge, die das Formular nicht unterscheiden kann und die das Paket
    // unterscheidet (gemessen an den Bestandspaketen, 2026-10-07):
    //
    //   - Eine LEERE Vorgabe (`""`, `null`) ist ein Wert — Valheims `beta_branch`
    //     heisst mit "" „kein Beta-Zweig". Ein leeres Feld im Formular heisst
    //     dagegen „keine Vorgabe" und liesse sie verschwinden; der Start schickte
    //     die Einstellung dann gar nicht mehr.
    //   - Kein `risk` und `risk: none` sind dasselbe; das Formular schreibt immer eins.
    if (vorher && aus.default === undefined && (vorher.default === '' || vorher.default === null)) aus.default = vorher.default;
    if (vorher && vorher.risk === undefined && aus.risk === 'none') delete aus.risk;
    if (Array.isArray(aus.choices) && Array.isArray(vorher?.choices)) {
        aus.choices = aus.choices.map((c) => {
            const alt = vorher.choices.find(v => String(v.value) === String(c.value));
            if (!alt) return c;
            const name = (c.name || alt.name) ? { ...(alt.name || {}), ...(c.name || {}) } : undefined;
            return { ...alt, ...c, value: alt.value, ...(name ? { name } : {}) };
        });
    }
    return aus;
}

/**
 * Welche Stücke eines sonst durchgereichten Teils eine EIGENE Karte haben.
 *
 * Mit jeder neuen Karte wandert ein Stück aus „Unverändert übernommen" in den
 * bearbeitbaren Entwurf. Es liegt dann unter demselben Namen wie im Paket
 * (`entwurf.management.query`), der Rest des Teils bleibt in
 * `entwurf.durchgereicht.management`; `entwurfAlsPaket` legt beides wieder
 * zusammen. Eine Karte mehr heisst: hier einen Namen dazuschreiben — offene
 * Sitzungen ziehen beim nächsten Laden nach (`ordne`).
 *
 *   management.query   Karte „Ports und Abfrage" (2026-10-07)
 *   management.rcon    Karte „Fernsteuerung" (2026-10-08)
 *   commands           Karte „Fernsteuerung" — der GANZE Teil: Jeder Schlüssel
 *                      darin ist ein Befehl, und jeder ist bearbeitbar.
 *   config             Karte „Feste Zeilen in Dateien" (2026-10-08) — der ganze
 *                      Teil. Im Paket eine LISTE (je Datei ein Eintrag), kein
 *                      Objekt: Sie zieht als Ganzes um, nie stückweise.
 *   requirements       Karte „Voraussetzungen" (2026-10-09) — der ganze Teil.
 *                      Die Karte bearbeitet `os_packages` und `display`; was ein
 *                      Paket sonst darin trägt, bleibt stehen und wird gezeigt.
 */
const GANZ = '*';
const EIGENE = { management: ['query', 'rcon'], commands: GANZ, config: GANZ, requirements: GANZ };
/** Die Stücke eines Teils, die eine Karte haben — bei GANZ alle, die `objekt` trägt. */
const eigeneFelder = (teil, objekt) => (EIGENE[teil] === GANZ ? Object.keys(objekt || {}) : EIGENE[teil]);
/** Hat dieses Stück eine Karte? */
const hatKarte = (teil, feld) => EIGENE[teil] === GANZ || (EIGENE[teil] || []).includes(feld);

/**
 * Den Entwurf ordnen: Was eine Karte hat, raus aus dem Durchgereichten. Rein —
 * das Paket, aus dem ein Entwurf entsteht, wird nicht angefasst. Läuft beim
 * Zerlegen eines Pakets UND beim Laden einer Sitzung, damit es genau eine
 * Stelle gibt, an der ein Stück liegt.
 */
function ordne(entwurf) {
    const e = entwurf || {};
    if (!e.durchgereicht) return e;
    const d = { ...e.durchgereicht };
    for (const teil of Object.keys(EIGENE)) {
        if (!d[teil] || typeof d[teil] !== 'object') continue;
        if (Array.isArray(d[teil])) {
            // Eine Liste hat keine Stücke: ganz in den Entwurf, oder — steht dort
            // schon eine — die aus dem Durchgereichten ist der ältere Stand.
            if (e[teil] === undefined && d[teil].length) e[teil] = d[teil];
            delete d[teil];
            continue;
        }
        const rest = { ...d[teil] };
        const eigen = { ...(e[teil] || {}) };
        for (const f of eigeneFelder(teil, d[teil])) {
            if (rest[f] === undefined) continue;
            if (eigen[f] === undefined) eigen[f] = rest[f];
            delete rest[f];
        }
        if (Object.keys(eigen).length) e[teil] = eigen;
        if (Object.keys(rest).length) d[teil] = rest; else delete d[teil];
    }
    if (Object.keys(d).length) e.durchgereicht = d; else delete e.durchgereicht;
    return e;
}

/**
 * Die durchgereichten Teile eines Pakets, wie sie im Paket benannt werden —
 * ohne die Stücke, die eine Karte haben: `management (saves, update)`.
 */
function durchgereichteTeile(paket) {
    const aus = [];
    for (const k of DURCHGEREICHT) {
        if (paket?.[k] === undefined) continue;
        if (!EIGENE[k]) { aus.push(k); continue; }
        if (Array.isArray(paket[k])) continue;
        const rest = Object.keys(paket[k] || {}).filter(f => !hatKarte(k, f));
        if (rest.length) aus.push(`${k} (${rest.join(', ')})`);
    }
    return aus;
}

/** Die nächste Fassung nach `1.2.3` → `1.2.4` — der Vorschlag beim Öffnen. */
function naechsteFassung(version) {
    const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version || ''));
    return m ? `${m[1]}.${m[2]}.${Number(m[3]) + 1}` : '1.0.0';
}

/**
 * Ein fertiges Paket in einen Entwurf zerlegen — die Gegenrichtung von
 * `entwurfAlsPaket`. Reine Funktion; `paketOeffnen` legt daraus die Sitzung an.
 *
 * Die Probe, an der das hängt (`scripts/check-werkbank-oeffnen.js`): Jedes
 * eingelieferte Paket, so zerlegt und wieder zusammengesetzt, ergibt in seinem
 * technischen Teil DASSELBE Paket. Was diese Funktion nicht kennt, landet in
 * `rest` und hält das Öffnen an — lieber kein Öffnen als ein stiller Verlust.
 *
 * @returns {{entwurf: object, image: object, schritte: object[], rest: string[]}}
 */
function entwurfAusPaket(paket) {
    const p = paket || {};
    const id = p.identity || {};
    const entwurf = {
        identity: {
            ...(id.slug ? { slug: id.slug } : {}),
            name: id.name || id.slug || '',
            version: naechsteFassung(id.version),
            ...(id.description ? { description: id.description } : {}),
            ...(id.category ? { category: id.category } : {}),
        },
        ports: Array.isArray(p.ports) ? p.ports : [],
    };
    if (p.start) entwurf.start = p.start;
    if (p.env && Object.keys(p.env).length) entwurf.env = p.env;
    if (Array.isArray(p.settings) && p.settings.length) entwurf.settings = p.settings;
    if (Array.isArray(p.hints) && p.hints.length) entwurf.hints = p.hints;

    const d = {};
    for (const k of DURCHGEREICHT) if (p[k] !== undefined) d[k] = p[k];
    const inst = {};
    for (const k of INSTALL_DURCHGEREICHT) if (p.install && p.install[k] !== undefined) inst[k] = p.install[k];
    if (Object.keys(inst).length) d.install = inst;
    if (Object.keys(d).length) entwurf.durchgereicht = d;
    ordne(entwurf);

    // Alles, wofür es weder eine Karte noch einen Platz im Durchgereichten gibt.
    const bekannt = ['format', 'identity', 'image', 'ports', 'install', 'start', 'env', 'settings', 'hints', 'status', ...DURCHGEREICHT];
    const rest = Object.keys(p).filter(k => !bekannt.includes(k));
    for (const k of Object.keys(p.install || {})) {
        if (k !== 'steps' && !INSTALL_DURCHGEREICHT.includes(k)) rest.push(`install.${k}`);
    }
    return {
        entwurf,
        image: { ref: p.image?.ref, tag: p.image?.tag },
        schritte: Array.isArray(p.install?.steps) ? p.install.steps : [],
        rest,
    };
}

/**
 * Ein fertiges Paket als Sitzung öffnen (S3, 2026-10-07).
 *
 * Geöffnet wird die NEUESTE Fassung — der Arbeitsstand, den auch ein Server auf
 * `test` bekommt. Die Schritte kommen als `uebernommen` in die Liste: Sie
 * gehören zum Entwurf, sind im Volume dieser Sitzung aber noch nicht gelaufen.
 * Das holt der Aufrufer gleich nach (`uebernommeneAusfuehren`, seit 2026-10-08)
 * — ohne sie hat die Sitzung kein Volume und nichts lässt sich probieren.
 * Symbol und Banner des Spiels gehen mit, damit das nächste Veröffentlichen sie
 * nicht leert.
 */
async function paketOeffnen({ guildId, userId, paketId, rootserverId }) {
    const zeile = await Paketfassung.ladeNeuesteFassung(db(), { paketId });
    if (!zeile) throw new Error('Dieses Paket gibt es nicht.');
    const paket = json(zeile.fbpkg, null);
    if (!paket) throw new Error(`Das Paket „${zeile.slug}" ${zeile.version} lässt sich nicht lesen.`);

    const { entwurf, image, schritte: stufen, rest } = entwurfAusPaket(paket);
    if (rest.length) {
        throw new Error(`„${zeile.slug}" trägt Teile, die die Werkbank weder bearbeiten noch durchreichen kann: ${rest.join(', ')}. `
            + 'Geöffnet wird erst, wenn nichts davon verloren ginge.');
    }
    const erlaubt = await waehlbareImages();
    // Geöffnet wird auf dem neuesten Bau desselben Images — das ist der Weg,
    // auf dem ein Paket auf einen neuen Bau umzieht (Prüfdurchlauf, dann
    // veröffentlichen: neue Fassung, neuer Tag, neuer Digest).
    const img = erlaubt.find(i => i.ref === image.ref && i.tag === neuesterTag(image.tag));
    if (!img) throw new Error(`Das Image des Pakets (${image.ref}:${image.tag}) ist nicht wählbar.`);
    const maschine = (await maschinen(guildId)).find(m => String(m.id) === String(rootserverId));
    if (!maschine) throw new Error('Diese Maschine gehört nicht zu dieser Guild.');

    const [anker] = await db().query('SELECT icon_url, banner_url FROM addon_marketplace WHERE id = ?', [zeile.paket_id]);
    entwurf.werkbank = {
        // Vorläufige Nummern, damit der Prüfdurchlauf ohne vorherigen Probestart
        // laufen kann — eine frische Sitzung bekommt ihre aus der Beobachtung.
        portnummern: vorlaeufigePortnummern(entwurf.ports),
        geoeffnet: {
            slug: zeile.slug, version: zeile.version, paket_id: zeile.paket_id, am: new Date().toISOString(),
            // Woran später erkannt wird, was unverändert mitreist (siehe belegteEinstellungen).
            ziele: zieleAusPaket(paket),
        },
        // Auch die Tags: Sie gehören dem Spiel im Panel, und das nächste
        // Veröffentlichen setzt genau diese Liste.
        praesentation: { icon_url: anker?.icon_url || '', banner_url: anker?.banner_url || '',
            tags: await Tags.fuer(db(), 'spiel', zeile.paket_id) },
    };

    const kennung = neueKennung();
    const name = String(paket.identity?.name || zeile.slug).slice(0, 100);
    const r = await db().query(
        `INSERT INTO werkbank_sitzungen (kennung, guild_id, angelegt_von, name, rootserver_id, image, entwurf)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [kennung, guildId, userId || null, name, maschine.id, JSON.stringify({ ref: img.ref, tag: img.tag }), JSON.stringify(entwurf)]);
    let nr = 0;
    for (const schritt of stufen) {
        nr++;
        await db().query(
            `INSERT INTO werkbank_schritte (sitzung_id, nr, schritt, status, uebernommen_aus, ausgabe, beendet_am)
             VALUES (?, ?, ?, 'uebernommen', ?, ?, NOW())`,
            [r.insertId, nr, JSON.stringify(schritt), `${zeile.slug} ${zeile.version}`.slice(0, 120),
             `Aus ${zeile.slug} ${zeile.version} übernommen — in dieser Sitzung noch nicht gelaufen.\n`]);
    }
    return { kennung, slug: zeile.slug, version: zeile.version, schritte: nr, durchgereicht: Object.keys(entwurf.durchgereicht || {}) };
}

/**
 * Portnummern für eine Sitzung, die ein Paket geöffnet hat: je Pool-Port eine
 * eigene, gekoppelte (`game+1`) daneben. Im Container der Werkbank ist jede
 * Nummer frei — nach aussen wird dort nichts veröffentlicht.
 */
function vorlaeufigePortnummern(ports) {
    const nr = {};
    let naechste = 28000;
    for (const p of ports || []) {
        if (!p.assign || p.assign === 'pool') { nr[p.purpose] = naechste; naechste += 10; }
    }
    for (const p of ports || []) {
        const m = /^([a-z][a-z0-9_]*)\+(\d+)$/.exec(p.assign || '');
        if (m && nr[m[1]] !== undefined) nr[p.purpose] = nr[m[1]] + Number(m[2]);
    }
    return nr;
}

/** Die Pakete, die sich öffnen lassen — je mit ihrer neuesten Fassung. */
async function oeffenbarePakete() {
    return Paketfassung.ladeNeuesteFassungen(db());
}

/**
 * Die durchgereichten Teile, die der DAEMON zum Laufen braucht — er kennt genau
 * diese fünf (pkgspec.Paket). Befehle und Sperrliste liest nur das Dashboard.
 *
 * `requirements` seit 2026-10-09: Der Daemon liest daraus `display` und lässt
 * fb-init vor dem Spiel einen virtuellen Bildschirm aufstellen. Ein Daemon vor
 * 1.0.115 kennt das Feld nicht und übergeht es.
 */
const LAUFZEIT_TEILE = ['management', 'content', 'config', 'console', 'requirements'];
function laufzeitTeile(paket) {
    const aus = {};
    for (const k of LAUFZEIT_TEILE) if (paket?.[k] !== undefined) aus[k] = paket[k];
    return aus;
}

/** Was eine Sitzung unverändert mitträgt — für die Karte, die es zeigt. */
function durchgereichtes(sitzung) {
    const d = sitzung.entwurf?.durchgereicht || {};
    return Object.keys(d).map(k => ({ teil: k, inhalt: d[k] }));
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

/**
 * Die Verdrahtung für `apply: env` — nur, was im Wurzelfeld noch fehlt.
 *
 * Ein Ziel, das unverändert aus einem geöffneten Paket stammt (`uebernommen`),
 * wird NICHT nachträglich verdrahtet: Stand die Variable dort nicht im
 * Wurzelfeld, soll sie es nach dem Öffnen auch nicht — Valheims `AUTO_UPDATE`
 * liest die Installation, nicht das Spiel. Verdrahten hiesse, das Paket beim
 * blossen Öffnen zu ändern.
 */
function umgebungAusEinstellungen(settings, env, uebernommen = {}) {
    const aus = {};
    for (const s of settings) {
        for (const z of s.apply || []) {
            if (istUebernommen(uebernommen, s.key, z)) continue;
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
        // An/Aus in einer Datei: Jedes Spiel schreibt es anders, und nur der
        // Paketbauer weiß, wie. Bis zum 2026-10-06 war das Feld unbeschriftet und
        // still mit „1/0" vorbelegt — bei StarRupture stand danach
        // `"StartNewGame": 1` als Zahl in DSSettings.txt, und das Spiel legte
        // keine Welt an. Deshalb wird gewählt, nicht angenommen. Der Daemon
        // übersetzt nur bei Datei-Zielen (auftrag/baue.go), also gilt es nur dort.
        if (ziel.target === 'file' && e.type === 'boolean') {
            if (!t('as')) {
                throw new Error(`${nr}: Wie steht An/Aus in ${t('file')}? Wähl am Ziel die Schreibweise — `
                    + 'true/false, 1/0, yes/no … Jedes Spiel will es anders.');
            }
            if (!EINSTELLUNG.als.includes(t('as'))) throw new Error(`${nr}: Schreibweise für An/Aus — ${EINSTELLUNG.als.join(', ')}.`);
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
        // Felder, die das Formular nicht kennt (`managed_by`, `warn_text`,
        // `required_when` … an einer Einstellung aus einem geöffneten Paket),
        // bleiben beim Bearbeiten stehen — ebenso an den Auswahlmöglichkeiten.
        if (i >= 0) liste[i] = mischeEinstellung(liste[i], neu);
        else liste.push(neu);
        e.settings = liste;
        // Der Probewert zieht beim Umbenennen mit.
        const w = e.werkbank?.werte;
        if (w && alt && alt !== neu.key && alt in w) { w[neu.key] = w[alt]; delete w[alt]; }
    });
}

async function einstellungEntfernen(sitzung, key) {
    await pruefeFrei(sitzung);
    return entwurfSchreiben(sitzung, (e) => {
        // Der Daemon überspringt einen Schlüssel, dessen Verweis ins Leere geht —
        // die Zeile fehlte dann still in der Datei.
        const haengt = festzeilenFlach(e).filter(z => z.value.includes(`{{setting:${key}}}`));
        if (haengt.length) {
            throw new Error(`Die feste Zeile ${haengt.map(z => `${z.file} → ${z.key}`).join(', ')} verweist auf „${key}" — erst dort ändern oder entfernen.`);
        }
        e.settings = (e.settings || []).filter(x => x.key !== key);
        if (e.werkbank?.werte) delete e.werkbank.werte[key];
    });
}

/**
 * Nur die Rolle umstellen — direkt aus der Tabelle, ohne das ganze Formular.
 * Die Rolle entscheidet, wo die Einstellung später steht (Serverseite.js,
 * HOEHE): `player` im Anlegeformular und in der einfachen Ansicht, `owner`
 * und `expert` nur in der fachlichen.
 */
async function einstellungRolleSetzen(sitzung, key, rolle) {
    await pruefeFrei(sitzung);
    if (!EINSTELLUNG.rollen.includes(rolle)) throw new Error(`Rolle: ${EINSTELLUNG.rollen.join(', ')}.`);
    if (!(sitzung.entwurf?.settings || []).some(x => x.key === key)) throw new Error(`Keine Einstellung „${key}".`);
    return entwurfSchreiben(sitzung, (e) => {
        const s = (e.settings || []).find(x => x.key === key);
        if (s) s.role = rolle;
    });
}

/**
 * Die Werte, mit denen Probestart und Durchlauf laufen — leer heißt: die Vorgabe.
 * Mehrere auf einmal: Die Karte hat EINEN Knopf für alle geänderten Zeilen.
 *
 * Bis zum 2026-10-08 ging das nur je Zeile (ein Disketten-Symbol), und nur,
 * wenn nichts lief. Betreiber: „der Tab Einstellungen lässt mich nicht
 * speichern, weil in der Karte ein genereller Save-Button fehlt" — sein
 * Probestart lief, also war auch jedes Symbol gesperrt.
 *
 * Bewusst OHNE die Sperre der anderen Speicherwege (`pruefeFrei`): Probewerte
 * gehören der Sitzung, nicht dem Entwurf. Sie zählen nicht zum Fingerabdruck,
 * ein laufendes Spiel hat seine Werte beim Start bekommen, und ein Durchlauf
 * belegt mit denen, die er selbst mitbekam. Geändert wird, was der NÄCHSTE
 * Start bekommt — und gerade während das Spiel läuft, sieht man, was man
 * ändern will.
 *
 * Erst prüfen, dann schreiben: Ein unbekannter Schlüssel speichert nichts halb.
 *
 * @param {Object<string, string>} werte  Schlüssel → Wert; '' entfernt den Probewert
 * @returns {Promise<{gesetzt: number, entfernt: number}>}
 */
async function probewerteSetzen(sitzung, werte) {
    if (!werte || typeof werte !== 'object' || Array.isArray(werte)) throw new Error('Probewerte: nichts zu speichern.');
    const bekannt = new Set((sitzung.entwurf?.settings || []).map(x => x.key));
    const eintraege = Object.entries(werte);
    if (!eintraege.length) throw new Error('Probewerte: nichts zu speichern.');
    for (const [key] of eintraege) if (!bekannt.has(key)) throw new Error(`Keine Einstellung „${key}".`);
    let gesetzt = 0, entfernt = 0;
    await entwurfSchreiben(sitzung, (e) => {
        e.werkbank = e.werkbank || {};
        e.werkbank.werte = e.werkbank.werte || {};
        for (const [key, wert] of eintraege) {
            if (wert === '' || wert === null || wert === undefined) { if (key in e.werkbank.werte) entfernt++; delete e.werkbank.werte[key]; }
            else { e.werkbank.werte[key] = String(wert).slice(0, 2000); gesetzt++; }
        }
    });
    return { gesetzt, entfernt };
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
        // Das Formular trägt jedes Feld des Startteils, das es KENNT — auch die
        // per Klick übernommene Bereitschaftszeile (vorbelegt). Was es nicht
        // kennt, bleibt stehen (2026-10-07): `ready_when.query` und
        // `extra_args` eines geöffneten Pakets gingen sonst mit dem ersten
        // „Speichern" verloren, ohne dass jemand sie angefasst hätte.
        e.start = mischeStart(e.start, start);
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

/**
 * Was in der Sitzung gerade läuft — für die Seite, nachdem ihr Live-Kanal
 * (wieder) steht. Ohne diese Abfrage blieb die Seite nach einem schnellen Ende
 * hängen: Nach „Starten" lädt sie neu und verbindet sich erst DANACH; ein
 * Programm, das nach einer Sekunde scheitert, hat sein `beendet` da schon
 * geschickt (Betreiber 2026-10-01: „nach einem exit immer die Seite neu laden").
 */
async function zustand(kennung) {
    const [schritt, spiel, pruefung] = await Promise.all([
        laufenderSchritt(kennung), laufenderLauf(kennung), laufendePruefung(kennung)]);
    return { schritt: Boolean(schritt), spiel: Boolean(spiel), pruefung: Boolean(pruefung) };
}

async function laeufe(sitzungId, anzahl = 5) {
    const zeilen = await db().query(
        'SELECT * FROM werkbank_laeufe WHERE sitzung_id = ? ORDER BY id DESC LIMIT ?', [sitzungId, anzahl]);
    return zeilen.map(z => ({
        ...z, start: json(z.start, {}), ports: json(z.ports, []), gesehen: json(z.gesehen, null),
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

    // Durchgereichtes aus einem geöffneten Paket geht mit (2026-10-07): Abfrage,
    // Fernsteuerung, feste Zeilen in Dateien bestimmen, wie der Server läuft.
    // Ohne sie startete hier ein anderes Paket als das, was eingeliefert wird.
    const ganz = entwurfAlsPaket(sitzung, liste);
    const antwort = await daemon.senden('werkbank.starten', {
        guild_id: sitzung.guild_id,
        image: sitzungsImage(sitzung),
        start: hatBereitschaft(start) ? start : alsErkundung(start),
        env: ganz.env || {},
        ...laufzeitTeile(ganz),
        ports: sitzung.entwurf?.ports || [],
        portnummern: w.portnummern,
        settings: probewerte(sitzung),
        einstellungen: sitzung.entwurf?.settings || [],
        // Nur, damit der Daemon Proton erkennt wie beim echten Start.
        install: { steps: liste.filter(imEntwurf).map(s => s.schritt) },
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

/**
 * Vorschau der Startzeile (S1, 2026-09-30): der Daemon rechnet sie mit
 * derselben Funktion wie beim Start, aus den Probewerten und den Portnummern
 * dieser Sitzung. Nichts wird gestartet.
 */
async function startzeile(sitzung, start) {
    const daemon = await daemonFuer(sitzung);
    const antwort = await daemon.senden('werkbank.startzeile', {
        start,
        settings: probewerte(sitzung),
        portnummern: werkbankTeil(sitzung).portnummern,
    }, 10000);
    if (!antwort?.success) throw new Error(antwort?.error || 'Der Daemon hat nicht geantwortet');
    const d = antwort.data || {};
    return { programm: d.programm || '', argumente: d.argumente || [], fehlend: d.fehlend || [] };
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
async function portUebernehmen(sitzung, { zweck, protocol, port, basis = '', abstand = null }) {
    const z = String(zweck || '').trim();
    if (!RE_ZWECK.test(z)) throw new Error('Zweck: Kleinbuchstaben, Ziffern und _, beginnend mit einem Buchstaben (game, query, rcon …).');
    if (!['tcp', 'udp', 'both'].includes(protocol)) throw new Error('Protokoll: tcp, udp oder both.');
    const n = Number(port);
    if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error('Keine gültige Portnummer.');
    // Kopplung gleich beim Übernehmen (2026-10-08): „dieser Port ist immer game + 2".
    // Bis dahin ging das nur in der Karte unter „Verbindung" — und die ist
    // gesperrt, solange das Spiel läuft, also genau dann, wenn man den Port sieht.
    const b = String(basis || '').trim();
    const d = Number(abstand);
    if (b) {
        if (!RE_ZWECK.test(b)) throw new Error('Kopplung: der Zweck des anderen Ports fehlt.');
        if (b === z) throw new Error('Kopplung: Ein Port kann nicht an sich selbst hängen.');
        if (!Number.isInteger(d) || d < PORT.abstand[0] || d > PORT.abstand[1]) {
            throw new Error(`Kopplung: der Abstand ist eine ganze Zahl von ${PORT.abstand[0]} bis ${PORT.abstand[1]}.`);
        }
    }
    return entwurfSchreiben(sitzung, (e) => {
        if (b) {
            const anker = (e.ports || []).find(p => p.purpose === b);
            if (!anker) throw new Error(`Kopplung: Den Port „${b}" gibt es im Entwurf nicht.`);
            if (kopplungVon(anker)) throw new Error(`Kopplung: „${b}" hängt selbst an einem anderen Port — gekoppelt wird an einen mit eigener Nummer.`);
        }
        // Dieselbe Nummer unter demselben Zweck, nur das andere Protokoll: Das
        // ist EIN Port auf beiden Protokollen, kein Ersatz. Ohne das machte
        // „7777/tcp als game" aus dem übernommenen 7777/udp ein reines tcp
        // (StarRupture, 2026-10-05) — das Spiel wäre von aussen nicht erreichbar.
        const vorher = (e.ports || []).find(p => p.purpose === z);
        const gleicheNummer = vorher && e.werkbank?.portnummern?.[z] === n;
        const beide = gleicheNummer && vorher.protocol !== protocol ? 'both' : protocol;
        // Ein vorhandener Port behält, was er sonst trägt (Kopplung `game+1`,
        // `needed_by`, Beschreibung) und seinen Platz in der Liste — neu ist nur
        // das Protokoll, das die Beobachtung zeigt.
        const liste = e.ports || [];
        const platz = liste.findIndex(p => p.purpose === z);
        const neu = { ...(vorher || {}), purpose: z, protocol: beide, assign: b ? `${b}+${d}` : (vorher?.assign || 'pool') };
        if (platz >= 0) liste[platz] = neu; else liste.push(neu);
        e.ports = liste;
        e.werkbank = { ...(e.werkbank || {}) };
        // Ein gekoppelter Port hat keine eigene Wahl: Lauscht er woanders, als
        // die Kopplung sagt, stimmt die Kopplung nicht — oder das Spiel lässt
        // sich den Port doch einzeln sagen, dann ist er nicht gekoppelt.
        const k = kopplungVon(neu);
        const basisNr = k && e.werkbank.portnummern?.[k.basis];
        if (k && basisNr !== undefined && basisNr + k.abstand !== n) {
            throw new Error(`„${z}" ist an „${k.basis}" gekoppelt (+${k.abstand}) und müsste auf ${basisNr + k.abstand} lauschen — `
                + `beobachtet ist ${n}. Entweder stimmt die Kopplung nicht, oder der Port bekommt eine eigene Nummer (Vergabe „eigene Nummer").`);
        }
        e.werkbank.portnummern = { ...(e.werkbank.portnummern || {}), [z]: n };
        e.werkbank.beobachtet = { ...(e.werkbank.beobachtet || {}), [z]: true };
        nummernNachziehen(e, z);
    });
}

// ── Was lauscht da? (Probestart, 2026-10-08) ─────────────────────────────────
//
// Betreiber, an 7 Days to Die: „einen Gameport zu sehen ist leicht, aber die
// anderen Ports … was da Query-Port ist und was nicht, lässt sich für mich auch
// nicht immer zweifelsfrei bestimmen." Beobachtet waren fünf Zeilen — 11000/udp,
// 26900/tcp, 26900/udp, 26902/udp, 51333/udp —, und übernommen hatte er den
// falschen als Spielport. Die Liste zeigte Nummern, sonst nichts.
//
// Das Bild ordnet ein, was sich OHNE Wissen über das Spiel sagen lässt:
//
//   - Dieselbe Nummer auf tcp und udp ist EIN Port auf beiden Protokollen.
//   - Liegt ein Port wenige Nummern über einem des Entwurfs, ist er vermutlich
//     an ihn gekoppelt (26902 = game + 2) — der Vorschlag steht gleich dabei.
//   - Sagt die Konsole etwas zu der Nummer („listening on 11000"), steht die
//     Zeile daneben. Das Spiel weiss es am besten.
//   - Eine Nummer aus dem Bereich, aus dem Linux ausgehende Ports vergibt, die
//     im vorigen Start nicht da war, ist vermutlich kein Dienst.
//
// Gerechnet wird hier, gezeichnet im Browser (wie bei der Live-Anzeige der
// Gameserver): dieselbe Funktion für den Seitenaufbau, die Meldung des Daemons
// und die Antwort nach dem Übernehmen — eine Regel, ein Bild.
const ZUFALL_VON = 32768, ZUFALL_BIS = 60999;   // net.ipv4.ip_local_port_range, Vorgabe von Linux
const KOPPEL_NAEHE = 10;                         // so weit über einem Port des Entwurfs gilt als „vermutlich gekoppelt"
const RE_KONSOLE_STARK = /listen|lausch|started|start(ed|ing)? .*on|bound|bind|serving|running on|opened|geöffnet/i;

/** Die Zeile der Konsole, in der das Spiel selbst etwas zu dieser Nummer sagt — oder null. */
function konsolenZeileZu(konsole, nummer) {
    // Die Nummer als eigene Zahl: nicht Teil einer längeren, kein Nachkommateil,
    // keine Uhrzeit. `10.0.0.1:26900` zählt — so nennen Spiele ihre Adresse.
    const re = new RegExp(`(^|[^0-9.])${nummer}(?![0-9]|:[0-9]|\\.[0-9])`);
    for (const roh of String(konsole || '').split('\n')) {
        // Was fb-init meldet, ist unsere eigene Auskunft, nicht die des Spiels.
        if (!roh || roh.startsWith('fb-init:') || !re.test(roh) || !RE_KONSOLE_STARK.test(roh)) continue;
        const zeile = roh.replace(/\x1b\[[0-?]*[ -\/]*[@-~]/g, '')
            .replace(/^\d{4}-\d\d-\d\dT[\d:.]+\s+[\d.]+\s+[A-Z]{3}\s+/, '').trim();
        return zeile.length > 160 ? zeile.slice(0, 157) + '…' : zeile;
    }
    return null;
}

/**
 * @param {object} sitzung
 * @param {Array}  liste   Schritte (für die Frage, worauf im Paket verwiesen wird)
 * @param {Array}  laeufe  Läufe der Sitzung, neuester zuerst
 * @returns {{laeuft: boolean, beobachtet: Array, entwurf: Array, ungenutzt: string[]}}
 */
function portBild(sitzung, liste, laeufe) {
    const e = sitzung.entwurf || {};
    const nummern = e.werkbank?.portnummern || {};
    const lauf = (laeufe || [])[0] || null;
    const laeuft = Boolean(lauf && lauf.status !== 'beendet');
    // Was ein Lauf gesehen hat — bei Läufen von vor dem 2026-10-08 nur, was am
    // Ende noch in `ports` stand (meist nichts).
    const gesehenIn = (l) => (Array.isArray(l?.gesehen) && l.gesehen.length ? l.gesehen : (Array.isArray(l?.ports) ? l.ports : []));
    // Läuft das Spiel: was JETZT lauscht. Danach: was der Lauf gesehen hat —
    // sonst wäre nach dem Stoppen nichts mehr zu übernehmen.
    const quelle = laeuft ? (lauf.ports || []) : gesehenIn(lauf);
    const frueher = (laeufe || []).slice(1).map(gesehenIn).filter(l => l.length);
    const frueherGesehen = new Set(frueher.flatMap(l => l.map(p => Number(p.port))));

    // Nach Nummer zusammenlegen: tcp und udp derselben Nummer sind ein Port.
    const jeNummer = new Map();
    for (const p of quelle) {
        const n = Number(p.port);
        if (!jeNummer.has(n)) jeNummer.set(n, new Set());
        jeNummer.get(n).add(p.protocol);
    }
    const eigene = (e.ports || []).filter(p => !kopplungVon(p) && Number.isInteger(nummern[p.purpose]));
    const beobachtet = [...jeNummer.keys()].sort((a, b) => a - b).map((n) => {
        const protokolle = ['tcp', 'udp'].filter(x => jeNummer.get(n).has(x));
        const imEntwurf = (e.ports || []).find(p => nummern[p.purpose] === n) || null;
        const gedeckt = imEntwurf ? (imEntwurf.protocol === 'both' ? ['tcp', 'udp'] : [imEntwurf.protocol]) : [];
        // Der nächste Port des Entwurfs darunter, in Reichweite.
        let vorschlag = null;
        if (!imEntwurf) {
            for (const p of eigene) {
                const abstand = n - nummern[p.purpose];
                if (abstand >= 1 && abstand <= KOPPEL_NAEHE && (!vorschlag || abstand < vorschlag.abstand)) vorschlag = { basis: p.purpose, abstand };
            }
        }
        const imBereich = n >= ZUFALL_VON && n <= ZUFALL_BIS;
        return {
            port: n, protokolle, protocol: protokolle.length === 2 ? 'both' : protokolle[0],
            zweck: imEntwurf ? imEntwurf.purpose : null,
            // Lauscht auf einem Protokoll, das der Entwurf für diesen Port noch nicht nennt.
            fehlt: imEntwurf ? protokolle.filter(x => !gedeckt.includes(x)) : [],
            vorschlag,
            konsole: konsolenZeileZu(lauf?.konsole, n),
            zufall: !imEntwurf && imBereich && !frueherGesehen.has(n)
                ? (frueher.length ? 'Im vorigen Start nicht dabei und aus dem Bereich, aus dem Linux ausgehende Ports vergibt — vermutlich kein Dienst. Nicht übernehmen.'
                                  : `Aus dem Bereich, aus dem Linux ausgehende Ports vergibt (${ZUFALL_VON}–${ZUFALL_BIS}) — vermutlich kein Dienst. Nach dem nächsten Start vergleichen: Ist die Nummer eine andere, war es keiner.`)
                : null,
        };
    });
    return {
        laeuft,
        // `gesehen`: Die Liste stammt vom letzten, beendeten Lauf.
        stand: laeuft ? 'laeuft' : (beobachtet.length ? 'gesehen' : 'leer'),
        beobachtet,
        entwurf: (e.ports || []).map((p) => {
            const k = kopplungVon(p);
            return { purpose: p.purpose, protocol: p.protocol, nummer: nummern[p.purpose] ?? null,
                kopplung: k ? { basis: k.basis, abstand: k.abstand } : null,
                lauscht: jeNummer.has(nummern[p.purpose]) };
        }),
        ungenutzt: ungenutztePorts(entwurfAlsPaket(sitzung, liste || [])),
    };
}

async function portEntfernen(sitzung, zweck) {
    return entwurfSchreiben(sitzung, (e) => {
        // Woran der Port hängt, bliebe als Verweis ins Leere stehen — die
        // Paketprüfung lehnte das erst beim Veröffentlichen ab.
        const haengt = (e.ports || []).filter(p => kopplungVon(p)?.basis === zweck).map(p => `der Port „${p.purpose}" (Kopplung)`);
        if (e.management?.query?.port === zweck) haengt.push('die Abfrage');
        if (e.management?.rcon?.port === zweck) haengt.push('die Fernsteuerung');
        for (const z of festzeilenFlach(e)) {
            if (z.value.includes(`{{port:${zweck}}}`)) haengt.push(`die feste Zeile ${z.file} → ${z.key}`);
        }
        if (haengt.length) throw new Error(`Am Port „${zweck}" hängt noch ${haengt.join(' und ')} — erst das umstellen oder entfernen.`);
        e.ports = (e.ports || []).filter(p => p.purpose !== zweck);
        if (e.werkbank?.portnummern) delete e.werkbank.portnummern[zweck];
        if (e.werkbank?.beobachtet) delete e.werkbank.beobachtet[zweck];
        if (e.start?.ready_when?.port === zweck) delete e.start.ready_when.port;
    });
}

// ── Ports und Abfrage (Karte, 2026-10-07) ────────────────────────────────────
//
// Was ein Port im Paket ausser Zweck und Protokoll trägt — gemessen an den acht
// eingelieferten Paketen: die Kopplung `game+1` (Valheim, Astro Colony), die
// Variable, über die das Spiel die Nummer erfährt (`SERVER_PORT`), „nur wenn
// diese Datei da ist" (Minecrafts Sprachchat) und eine Beschreibung. Bis zu
// dieser Karte reiste das bei geöffneten Paketen nur mit; ein in der Werkbank
// gebautes Spiel konnte es gar nicht bekommen.
//
// Zwei Regeln, abgesprochen am 2026-10-07:
//
//   - Ports entstehen aus der BEOBACHTUNG. Von Hand anlegen lässt sich nur ein
//     Port mit `needed_by` — den bringt ein Mod mit, ohne den Mod lauscht nichts.
//   - Die Abfrage kommt auch unbelegt ins Paket, dann mit Vermerk (`abfrageVermerk`).
const PORT_FELDER = ['purpose', 'protocol', 'assign', 'required', 'variable', 'description', 'needed_by'];
const RE_KOPPLUNG = /^([a-z][a-z0-9_]*)\+([0-9]+)$/;
const RE_NUR_WENN = /^[^/.][^\\]*$/; // Schema: port.needed_by
// Beschreibung: Die längste im Bestand hat 318 Zeichen (Minecrafts Sprachchat) —
// eine knappere Grenze liesse ein geöffnetes Paket nicht mehr speichern.
const PORT = { abstand: [1, 100], beschreibung: 600 };

/** `game+1` → { basis: 'game', abstand: 1 }; `pool` → null. */
function kopplungVon(port) {
    const m = RE_KOPPLUNG.exec(port?.assign || '');
    return m ? { basis: m[1], abstand: Number(m[2]) } : null;
}

/**
 * Gekoppelte Ports rechnen ihre Nummer aus der Basis — nach jeder Änderung.
 * `geaendert` ist der Zweck, dessen Nummer oder Vergabe sich gerade änderte:
 * Hängt jemand an ihm, ist dessen frühere Beobachtung damit überholt.
 */
function nummernNachziehen(e, geaendert) {
    e.werkbank = { ...(e.werkbank || {}) };
    const nr = { ...(e.werkbank.portnummern || {}) };
    const gesehen = { ...(e.werkbank.beobachtet || {}) };
    for (const p of e.ports || []) {
        const k = kopplungVon(p);
        if (!k || nr[k.basis] === undefined) continue;
        const soll = nr[k.basis] + k.abstand;
        if (nr[p.purpose] !== soll && k.basis === geaendert) delete gesehen[p.purpose];
        nr[p.purpose] = soll;
    }
    e.werkbank.portnummern = nr;
    if (Object.keys(gesehen).length) e.werkbank.beobachtet = gesehen; else delete e.werkbank.beobachtet;
}

/** Ein Port aus dem Formular — nur die Felder, die das Formular kennt. */
function portAusFormular(b, vorher) {
    const text = (k) => (typeof b?.[k] === 'string' ? b[k].trim() : '');
    const an = (k) => b?.[k] === true || b?.[k] === 'on' || b?.[k] === '1';
    const zweck = text('zweck');
    if (!RE_ZWECK.test(zweck)) throw new Error('Zweck: Kleinbuchstaben, Ziffern und _, beginnend mit einem Buchstaben (game, query, rcon …).');
    if (!['tcp', 'udp', 'both'].includes(text('protocol'))) throw new Error('Protokoll: tcp, udp oder both.');
    const p = { purpose: zweck, protocol: text('protocol'), assign: 'pool' };

    if (text('basis')) {
        const n = Number(text('abstand'));
        if (!RE_ZWECK.test(text('basis'))) throw new Error('Kopplung: der Zweck des anderen Ports fehlt.');
        if (!Number.isInteger(n) || n < PORT.abstand[0] || n > PORT.abstand[1]) {
            throw new Error(`Kopplung: der Abstand ist eine ganze Zahl von ${PORT.abstand[0]} bis ${PORT.abstand[1]}.`);
        }
        p.assign = `${text('basis')}+${n}`;
    }
    // Pflicht ist die Vorgabe des Schemas. Ein ausdrückliches `required: true`
    // aus einem geöffneten Paket bleibt stehen, geschrieben wird es sonst nicht.
    if (an('optional')) p.required = false;
    else if (vorher?.required === true) p.required = true;

    if (text('variable')) {
        if (!RE_VARIABLE.test(text('variable'))) throw new Error('Variable: Buchstaben, Ziffern und _, nicht mit einer Ziffer beginnend (SERVER_PORT).');
        p.variable = text('variable');
    }
    const de = text('beschreibung_de'), en = text('beschreibung_en');
    for (const t of [de, en]) if (t.length > PORT.beschreibung) throw new Error(`Beschreibung: höchstens ${PORT.beschreibung} Zeichen.`);
    if (de || en) p.description = { ...(de ? { de } : {}), ...(en ? { en } : {}) };

    if (text('needed_by')) {
        if (!RE_NUR_WENN.test(text('needed_by'))) {
            throw new Error('„Nur wenn Datei": ein Pfad ab der Wurzel des Volumes, etwa game/mods/voicechat-*.jar — ohne führenden Schrägstrich oder Punkt.');
        }
        // Dieselbe Bedingung wie im Schema: nachgebucht wird aus dem Pool, und
        // ein Pflichtport, der nur manchmal gebraucht wird, ist ein Widerspruch.
        if (p.assign !== 'pool' || p.required !== false) {
            throw new Error('„Nur wenn Datei" geht nur mit eigener Nummer und als optionaler Port — er wird erst gebucht, wenn die Datei da ist.');
        }
        p.needed_by = text('needed_by');
    }
    return p;
}

/**
 * Einen Port bearbeiten (`alt` = sein Zweck) oder von Hand anlegen (ohne `alt`,
 * nur mit „nur wenn Datei"). Der Zweck selbst ist nicht änderbar: An ihm hängen
 * Startzeile, Bereitschaft, Abfrage und die Nummern der Sitzung.
 */
async function portSpeichern(sitzung, b) {
    await pruefeFrei(sitzung);
    const alt = typeof b?.alt === 'string' ? b.alt.trim() : '';
    return entwurfSchreiben(sitzung, (e) => {
        const liste = e.ports || [];
        const platz = alt ? liste.findIndex(p => p.purpose === alt) : -1;
        if (alt && platz < 0) throw new Error(`Den Port „${alt}" gibt es im Entwurf nicht.`);
        const vorher = platz >= 0 ? liste[platz] : null;
        const neu = portAusFormular(b, vorher);
        if (vorher && neu.purpose !== vorher.purpose) {
            throw new Error('Der Zweck lässt sich nicht umbenennen — an ihm hängen Startzeile, Bereitschaft und Abfrage. Entfernen und neu übernehmen.');
        }
        if (!vorher) {
            if (liste.some(p => p.purpose === neu.purpose)) throw new Error(`Den Port „${neu.purpose}" gibt es schon.`);
            if (!neu.needed_by) {
                throw new Error('Von Hand anlegen lässt sich nur ein Port mit „nur wenn Datei" (den bringt ein Mod mit). '
                    + 'Jeder andere kommt aus der Beobachtung: Spiel starten, Port übernehmen.');
            }
        }
        const k = kopplungVon(neu);
        if (k) {
            const basis = liste.find(p => p.purpose === k.basis);
            if (!basis || k.basis === neu.purpose) throw new Error(`Kopplung: Den Port „${k.basis}" gibt es im Entwurf nicht.`);
            if (kopplungVon(basis)) throw new Error(`Kopplung: „${k.basis}" ist selbst gekoppelt — gekoppelt wird an einen Port mit eigener Nummer.`);
            if (liste.some(p => kopplungVon(p)?.basis === neu.purpose)) {
                throw new Error(`An „${neu.purpose}" ist schon ein anderer Port gekoppelt — er braucht deshalb eine eigene Nummer.`);
            }
            // Eine BEOBACHTETE Nummer, die der Kopplung widerspricht, ist ein
            // Befund und kein Rundungsfehler. Vorläufige Nummern (geöffnetes
            // Paket) rechnen einfach nach.
            const nr = e.werkbank?.portnummern || {};
            if (e.werkbank?.beobachtet?.[neu.purpose] && nr[k.basis] !== undefined && nr[neu.purpose] !== nr[k.basis] + k.abstand) {
                throw new Error(`„${neu.purpose}" wurde auf ${nr[neu.purpose]} beobachtet, „${k.basis}" auf ${nr[k.basis]} — `
                    + `das sind nicht ${k.abstand} Abstand. Die Kopplung stimmt so nicht.`);
            }
        }
        const fertig = behalteUnbekanntes(vorher, neu, PORT_FELDER);
        if (platz >= 0) liste[platz] = fertig; else liste.push(fertig);
        e.ports = liste;
        e.werkbank = { ...(e.werkbank || {}) };
        // Ein von Hand angelegter Port braucht eine Nummer, sonst entsteht kein
        // Auftrag — vorläufig, wie beim Öffnen.
        if (!vorher && !k) {
            const nr = e.werkbank.portnummern || {};
            e.werkbank.portnummern = { ...nr, [neu.purpose]: Math.max(27990, ...Object.values(nr).map(Number).filter(Number.isFinite)) + 10 };
        }
        nummernNachziehen(e, neu.purpose);
    });
}

/**
 * Die Kennungen, die eine Abfrage tragen darf — dieselbe Regel wie
 * `scripts/check-pakete.js`: GameDigs Katalog, dazu unser `a2s` für Spiele, die
 * Source Query sprechen und dort fehlen (Baustelle 160).
 *
 * `belegbar`: fb-init spricht genau GameDigs `valve`-Protokoll selbst — aus
 * derselben Tabelle erzeugt `scripts/erzeuge-a2s-kennungen.js` seine Liste.
 */
function abfrageKennungen() {
    const katalog = require('gamedig').games;
    const aus = [{ kennung: 'a2s', name: 'Source Query (Spiel steht nicht im Katalog)', belegbar: true }];
    for (const k of Object.keys(katalog).sort()) {
        aus.push({ kennung: k, name: katalog[k].name || k, belegbar: katalog[k].options?.protocol === 'valve' });
    }
    return aus;
}

/** Was die Karte über die Abfrage zeigt. */
function abfrageStand(sitzung) {
    const q = sitzung.entwurf?.management?.query || null;
    const eintrag = q ? abfrageKennungen().find(k => k.kennung === q.protocol) : null;
    return {
        query: q,
        bereit: sitzung.entwurf?.start?.ready_when?.query === true,
        belegbar: Boolean(eintrag?.belegbar),
        bekannt: Boolean(eintrag),
    };
}

async function abfrageSpeichern(sitzung, b) {
    await pruefeFrei(sitzung);
    const text = (k) => (typeof b?.[k] === 'string' ? b[k].trim() : '');
    const bereit = b?.bereit === true || b?.bereit === 'on' || b?.bereit === '1';
    const protocol = text('protocol').toLowerCase();
    if (!abfrageKennungen().some(k => k.kennung === protocol)) {
        throw new Error(`„${protocol || '(leer)'}" ist keine Kennung aus GameDigs Katalog und nicht „a2s" — damit könnte niemand fragen.`);
    }
    return entwurfSchreiben(sitzung, (e) => {
        if (!(e.ports || []).some(p => p.purpose === text('port'))) throw new Error('Abfrage: Diesen Port gibt es im Entwurf nicht.');
        const bereitTeil = e.start?.ready_when;
        if (bereit && !bereitTeil?.port) {
            throw new Error('„Erst bereit, wenn die Abfrage antwortet" braucht im Startteil „Bereit, wenn Port" — die Abfrage ist die Stufe danach.');
        }
        e.management = { ...(e.management || {}) };
        e.management.query = behalteUnbekanntes(e.management.query, { protocol, port: text('port') }, ['protocol', 'port']);
        // Der Schalter gehört zum Startteil (`ready_when.query`), sein Formular
        // kennt ihn aber nicht und lässt ihn stehen (BEREIT_FELDER).
        if (bereit) e.start = { ...e.start, ready_when: { ...bereitTeil, query: true } };
        else if (bereitTeil?.query === true) { const { query, ...ohne } = bereitTeil; e.start = { ...e.start, ready_when: ohne }; }
    });
}

async function abfrageEntfernen(sitzung) {
    await pruefeFrei(sitzung);
    return entwurfSchreiben(sitzung, (e) => {
        if (e.management) {
            delete e.management.query;
            if (!Object.keys(e.management).length) delete e.management;
        }
        // Ohne Abfrage kann die Bereitschaft nicht auf sie warten (check-pakete).
        if (e.start?.ready_when && 'query' in e.start.ready_when) {
            const { query, ...ohne } = e.start.ready_when;
            e.start = { ...e.start, ready_when: ohne };
        }
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
    // Durchgereichtes zählt mit — es bestimmt, wie der Server läuft (Abfrage,
    // feste Zeilen in Dateien). Nur wenn vorhanden: Eine Sitzung ohne diese
    // Teile behält ihren Fingerabdruck, und ihr grüner Durchlauf bleibt gültig.
    for (const k of DURCHGEREICHT) if (p[k] !== undefined) t[k] = p[k];
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
    for (const s of paket.install?.steps || []) {
        if (s.type === 'download' && !s.checksum) {
            m.push(`Der Download ${s.target || s.url} hat keine Prüfsumme — den Schritt einmal laufen lassen, die Werkbank trägt sie ein.`);
        }
    }
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
        ...laufzeitTeile(paket),
        portnummern: w.portnummern, install: paket.install,
        settings: probewerte(sitzung), einstellungen: paket.settings || [],
        memory_mb: w.memory_mb, cpu_prozent: w.cpu_prozent,
        // Belegt die Fernsteuerung (2026-10-08): anmelden, diesen Befehl senden,
        // Antwort lesen. Nur mit Fernsteuerung im Entwurf — der Daemon weist
        // einen Befehl ohne sie ab.
        ...(paket.management?.rcon && rconPruefbefehl(sitzung) ? { rcon_pruefbefehl: rconPruefbefehl(sitzung) } : {}),
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
        icon_url: p.icon_url || '', banner_url: p.banner_url || '',
        // null = diese Sitzung hat noch keine Tags gesetzt — das Formular belegt
        // dann mit dem vor, was das Spiel im Panel heute trägt (Route).
        tags: Array.isArray(p.tags) ? p.tags : null,
    };
}

/**
 * Die Tags für das Formular: was die Sitzung gesetzt hat — sonst, was das
 * Spiel unter diesem Slug im Panel heute trägt. So nimmt das erste Speichern
 * der Angaben einem vorhandenen Spiel nichts.
 */
async function angabenTags(sitzung) {
    const eigene = sitzung.entwurf?.werkbank?.praesentation?.tags;
    if (Array.isArray(eigene)) return eigene;
    const slug = sitzung.entwurf?.identity?.slug;
    if (!slug) return [];
    const [paket] = await db().query('SELECT id FROM packages WHERE slug = ?', [slug]);
    return paket ? Tags.fuer(db(), 'spiel', paket.id) : [];
}

async function angabenSpeichern(sitzung, f) {
    const slug = String(f.slug || '').trim().toLowerCase();
    if (slug && !RE_SLUG.test(slug)) throw new Error('Slug: Kleinbuchstaben, Ziffern und -, beginnend mit Buchstabe oder Ziffer.');
    const name = String(f.name || '').trim().slice(0, 100);
    if (!name) throw new Error('Name fehlt.');
    const version = String(f.version || '').trim();
    if (version && !RE_FASSUNG.test(version)) throw new Error('Fassung: drei Zahlen, etwa 1.0.0.');
    // Die Kategorie wird nicht mehr gefragt (2026-10-08) — Tags ersetzen sie.
    // Was ein geöffnetes Paket in `identity.category` trägt, bleibt stehen: Es
    // muss unverändert wieder herauskommen.
    //
    // `tags` fehlt in der Nutzlast = nicht anfassen (das Feld liess sich nicht
    // laden); eine leere Liste = keine Tags.
    const tags = f.tags === undefined ? undefined : Tags.bereinige(f.tags).map(x => x.name);
    const icon = pruefeBildAdresse(f.icon_url, 'Symbol');
    const banner = pruefeBildAdresse(f.banner_url, 'Banner');
    const de = String(f.beschreibung_de || '').trim().slice(0, 2000);
    const en = String(f.beschreibung_en || '').trim().slice(0, 2000);
    return entwurfSchreiben(sitzung, (e) => {
        const id = { ...(e.identity || {}), name };
        if (slug) id.slug = slug; else delete id.slug;
        if (version) id.version = version; else delete id.version;
        if (de || en) id.description = { ...(de ? { de } : {}), ...(en ? { en } : {}) }; else delete id.description;
        e.identity = id;
        const vorher = e.werkbank?.praesentation?.tags;
        const bleibt = tags !== undefined ? tags : vorher;
        e.werkbank = { ...(e.werkbank || {}), praesentation: {
            icon_url: icon, banner_url: banner, ...(Array.isArray(bleibt) ? { tags: bleibt } : {}) } };
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
function belegteEinstellungen(entwurf, ergebnis, uebernommen = {}) {
    const nachweis = Array.isArray(ergebnis?.einstellungen) ? ergebnis.einstellungen : null;
    const nachgewiesen = (s, z) => (nachweis || []).some(n => n.key === s.key && n.ziel === z.target
        && n.zustand === 'angekommen'
        && (z.target !== 'file' || n.wo === `${z.file}: ${z.path}`)
        && (z.target !== 'env' || n.wo === z.variable));
    // Ein Ziel, das unverändert aus einem geöffneten Paket stammt, bleibt auch
    // ohne Beleg (2026-10-07): „Ins Paket nur Nachgewiesenes" gilt für das, was
    // in der Werkbank ENTSTEHT oder geändert wird. Ein Bestandspaket zu öffnen
    // und wieder einzuliefern darf ihm keine Einstellung nehmen — sonst wäre
    // Durchreichen ein Abspecken auf Raten. Wie viele so mitreisen, steht in
    // `ohneBeleg` und im Paket unter `status.open`.
    let ohneBeleg = 0;
    const belegt = (s, z) => {
        if (nachgewiesen(s, z)) return true;
        if (istUebernommen(uebernommen, s.key, z)) { ohneBeleg++; return true; }
        return false;
    };
    const behalten = [];
    const weg = [];
    for (const s of entwurf?.settings || []) {
        // Eine Einstellung, die schon im geöffneten Paket kein Ziel hatte, wirkt
        // auf anderem Weg (Bedingung einer Startzeile, Mod-Karte). Sie bleibt.
        if (!(s.apply || []).length && Array.isArray(uebernommen?.[s.key]) && !uebernommen[s.key].length) {
            behalten.push(s);
            continue;
        }
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
    return { behalten, weg, env, ohneBeleg };
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
    // Die Sitzung fragt „den neuesten Bau"; welcher das war, sagt nur der
    // Durchlauf. Ohne den Namen stünde „latest" im Paket — ein Tag, der morgen
    // etwas anderes meint.
    else if (!paketTag(letzte)) {
        gruende.push('Der grüne Durchlauf nennt die Fassung seines Images nicht (Daemon vor 1.0.116) — nach dem Daemon-Update neu prüfen.');
    }
    else {
        // Eine Einstellung ohne Beleg fällt beim Veröffentlichen weg. Benutzt
        // die Startzeile oder ein Schritt sie trotzdem, hinge dort ein Verweis
        // ins Leere — das Paket wäre kaputt, nicht bloß kleiner.
        for (const w of belegteEinstellungen(letzte.entwurf, letzte.ergebnis, uebernommeneZiele(sitzung)).weg) {
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
        // Unter diesem Slug liegt schon ein Paket: Was es trägt und diese Sitzung
        // nicht, ginge mit dem Veröffentlichen verloren — beim nächsten Start
        // jedes Servers auf `test` (2026-10-07). Das trifft eine Sitzung, die ein
        // Bestandspaket NEU baut, statt es zu öffnen.
        if (neueste) {
            const vorhanden = await Paketfassung.ladeNeuesteFassung(db(), { slug: id.slug });
            const alt = json(vorhanden?.fbpkg, null) || {};
            // Stückweise: `management` kann da sein (die Abfrage hat eine Karte) und
            // trotzdem die Fernsteuerung verloren haben. Ein Stück MIT Karte zählt
            // nur, wenn die Sitzung das Paket nicht geöffnet hat — dort heisst
            // „fehlt": bewusst entfernt.
            const vonHier = sitzung.entwurf?.werkbank?.geoeffnet?.slug === id.slug;
            const fehlt = [];
            for (const k of DURCHGEREICHT) {
                if (alt[k] === undefined) continue;
                if (!EIGENE[k]) { if (paket[k] === undefined) fehlt.push(k); continue; }
                if (Array.isArray(alt[k])) {
                    // Eine Liste (config) fehlt ganz oder gar nicht — und in einer
                    // Sitzung, die das Paket geöffnet hat, heisst „fehlt": entfernt.
                    if (alt[k].length && paket[k] === undefined && !vonHier) fehlt.push(k);
                    continue;
                }
                for (const f of Object.keys(alt[k] || {})) {
                    if (paket[k]?.[f] !== undefined) continue;
                    if (hatKarte(k, f) && vonHier) continue;
                    fehlt.push(`${k}.${f}`);
                }
            }
            if (fehlt.length) {
                gruende.push(`„${id.slug}" ${vorhanden.version} trägt ${fehlt.join(', ')} — diese Sitzung nicht. `
                    + 'Veröffentlicht ginge das verloren (Abfrage, Mods, Sperrliste …). Öffne das Paket in der Werkbank, statt es neu zu bauen, '
                    + 'oder nimm einen eigenen Slug.');
            }
        }
    }
    return { darf: gruende.length === 0, gruende, neueste, pruefung: letzte };
}

/**
 * Was der Durchlauf über die Abfrage weiss (Absprache 2026-10-07: sie kommt
 * auch unbelegt ins Paket — dann steht es dabei).
 *
 * Belegt ist sie genau dann, wenn der Durchlauf die Stufe `query` erreichte.
 * Das geht nur mit dem Schalter „erst bereit, wenn die Abfrage antwortet", und
 * nur bei Protokollen, die fb-init selbst spricht (Source Query). Minecrafts
 * Abfrage etwa beantwortet erst das Dashboard über GameDig am laufenden Server.
 */
function abfrageVermerk(pruefung) {
    const q = pruefung.entwurf?.management?.query;
    if (!q) return [];
    const wo = `Abfrage (${q.protocol}, Port „${q.port}")`;
    if (pruefung.ergebnis?.bereitschaft === 'query') {
        return [`${wo}: im Durchlauf #${pruefung.id} belegt — das Spiel hat geantwortet.`];
    }
    return [pruefung.entwurf?.start?.ready_when?.query === true
        ? `${wo}: im Durchlauf NICHT belegt — fb-init spricht dieses Protokoll nicht selbst. Ob sie antwortet, zeigt erst der laufende Server im Dashboard.`
        : `${wo}: im Durchlauf NICHT belegt — die Bereitschaft wartet nicht auf sie (Schalter „erst bereit, wenn die Abfrage antwortet" ist aus).`];
}

// ── Fernsteuerung (Karte, 2026-10-08) ───────────────────────────────────────
//
// Zwei Stücke, gemessen an den acht eingelieferten Paketen:
//
//   management.rcon   Protokoll, Port, und die Umgebungsvariable, aus der das
//                     Kennwort gelesen wird (Factorio, Minecraft). Der Daemon
//                     braucht es für `rcon:` in der Stoppfolge, für Einstellungen
//                     mit Ziel rcon und für die Eingabe im Panel.
//   commands          Die Befehlsgruppen (Spielerliste, entfernen, sperren, Welt
//                     speichern, Servernachricht) mit ihrem Weg (Factorio,
//                     Minecraft, Valheim).
//
// Die Stoppfolge gehört NICHT hierher — sie steht im Startteil, und der kann
// `rcon:…` seit Stufe 2.
//
// ⚠ Befund beim Bau: Die Befehlsgruppen führt bisher NIEMAND aus. Die Serverseite
// zeigt sie in der fachlichen Ansicht an (`Serverseite.baueBefehle`); weder
// Dashboard noch Daemon senden daraus einen Befehl. Die Karte schreibt sie
// trotzdem — die Werkbank soll alles schreiben können, was ein Paket trägt —
// und sagt es dazu.
//
// Der Nachweis (Betreiber, 2026-10-08: „Mit Daemon-Bau"): Der Prüfdurchlauf
// meldet sich über die Fernsteuerung an, sendet einen harmlosen Befehl und
// liest die Antwort (`ergebnis.rcon`). Den Befehl nennt die Sitzung — was
// harmlos ist, weiss das Spiel, nicht das Protokoll.
const RCON = {
    // Was das Schema erlaubt …
    protokolle: ['source', 'webrcon', 'telnet', 'rest'],
    // … und was der Daemon spricht (internal/gameserver/rcon: srcds, palworld_rest;
    // check-werkbank-fernsteuerung.js liest die Liste dort nach).
    gebaut: ['source', 'rest'],
    befehl: 200,
};
const RCON_FELDER = ['protocol', 'port', 'password_variable'];
const RE_ENV = /^[A-Za-z_][A-Za-z0-9_]*$/; // Schema: envKey

/** Die Einstellungen, die einen Wert in die Umgebung schreiben — Kandidaten für das Kennwort. */
function umgebungsEinstellungen(entwurf) {
    const aus = [];
    for (const s of entwurf?.settings || []) {
        for (const z of s.apply || []) {
            if (z.target === 'env' && z.variable) aus.push({ key: s.key, variable: z.variable, kennwort: s.type === 'password' });
        }
    }
    return aus;
}

/** Was an der Fernsteuerung hängt — solange etwas davon da ist, bleibt sie. */
function rconAbhaengige(entwurf) {
    const aus = [];
    for (const s of entwurf?.start?.stop?.sequence || []) {
        if (String(s.step || '').startsWith('rcon:')) aus.push(`der Stoppschritt „${s.step}"`);
    }
    for (const s of entwurf?.settings || []) {
        if ((s.apply || []).some(z => z.target === 'rcon')) aus.push(`die Einstellung „${s.key}" (Ziel rcon)`);
    }
    for (const [key, c] of Object.entries(entwurf?.commands || {})) {
        if (c?.via === 'rcon') aus.push(`der Befehl „${key}"`);
    }
    return aus;
}

/** Ein harmloser Befehl aus dem Entwurf: die Spielerliste, wenn sie über rcon läuft. */
function rconVorschlag(entwurf) {
    const c = entwurf?.commands?.['players.list'];
    return c?.via === 'rcon' && c.command && !String(c.command).includes('{{') ? String(c.command) : '';
}

/**
 * Der Prüfbefehl, den der Durchlauf sendet — gehört der Sitzung, nicht dem Paket.
 *
 * Nennt die Sitzung keinen, gilt die Spielerliste des Entwurfs, wenn sie über
 * die Fernsteuerung läuft: Das Paket sagt damit selbst, welcher Befehl nur
 * liest. So ist ein geöffnetes Minecraft oder Factorio ohne einen Handgriff
 * belegbar. Gibt es beides nicht, wird nicht geprüft — geraten wird kein Befehl.
 */
function rconPruefbefehl(sitzung) {
    return String(sitzung.entwurf?.werkbank?.rcon_pruefbefehl || '').trim() || rconVorschlag(sitzung.entwurf);
}

/** Was die Karte über die Fernsteuerung zeigt. */
function rconStand(sitzung) {
    const e = sitzung.entwurf || {};
    const r = e.management?.rcon || null;
    const kandidaten = umgebungsEinstellungen(e);
    const port = r ? (e.ports || []).find(p => p.purpose === r.port) : null;
    const quelle = r ? kandidaten.find(k => k.variable === r.password_variable) : null;
    const warnungen = [];
    if (r) {
        if (!RCON.gebaut.includes(r.protocol)) warnungen.push(`Das Protokoll „${r.protocol}" spricht der Daemon nicht — bekannt sind ${RCON.gebaut.join(', ')}.`);
        if (!port) warnungen.push(`Den Port „${r.port}" gibt es im Entwurf nicht.`);
        else if (port.protocol === 'udp') warnungen.push(`Der Port „${r.port}" ist udp — die Fernsteuerung läuft über tcp.`);
        if (!r.password_variable) warnungen.push('Es ist keine Variable für das Kennwort genannt.');
        else if (!quelle) warnungen.push(`Keine Einstellung schreibt „${r.password_variable}" in die Umgebung — das Kennwort käme nie an.`);
        else if (probewerte(sitzung)[quelle.key] === '') {
            warnungen.push(`„${quelle.key}" hat keinen Probewert — ohne Kennwort scheitert die Anmeldung im Durchlauf. Unter „Einstellungen" einen setzen.`);
        }
    }
    return {
        rcon: r, kandidaten, quelle: quelle ? quelle.key : null, warnungen,
        // `eigener`: was die Sitzung selbst nennt; `pruefbefehl`: was der Durchlauf sendet.
        eigener: String(e.werkbank?.rcon_pruefbefehl || '').trim(),
        pruefbefehl: rconPruefbefehl(sitzung), vorschlag: rconVorschlag(e),
        abhaengige: rconAbhaengige(e),
    };
}

async function rconSpeichern(sitzung, b) {
    await pruefeFrei(sitzung);
    const text = (k) => (typeof b?.[k] === 'string' ? b[k].trim() : '');
    const protocol = text('protocol').toLowerCase();
    const befehl = text('pruefbefehl');
    return entwurfSchreiben(sitzung, (e) => {
        const vorher = e.management?.rcon || null;
        if (!RCON.protokolle.includes(protocol)) throw new Error(`Fernsteuerung: Protokoll ${RCON.protokolle.join(', ')}.`);
        // Ein Protokoll ohne Treiber nur, wenn es unverändert aus dem geöffneten
        // Paket kommt — neu wählen lässt sich, was der Daemon auch spricht.
        if (!RCON.gebaut.includes(protocol) && vorher?.protocol !== protocol) {
            throw new Error(`Das Protokoll „${protocol}" spricht der Daemon nicht (bekannt: ${RCON.gebaut.join(', ')}) — die Fernsteuerung bliebe stumm.`);
        }
        const port = (e.ports || []).find(p => p.purpose === text('port'));
        if (!port) throw new Error('Fernsteuerung: Diesen Port gibt es im Entwurf nicht.');
        if (port.protocol === 'udp') throw new Error(`Fernsteuerung: Der Port „${port.purpose}" ist udp — sie läuft über tcp. Unter „Ports" umstellen.`);
        const variable = text('password_variable');
        if (!RE_ENV.test(variable)) throw new Error('Fernsteuerung: Die Variable für das Kennwort fehlt oder ist kein gültiger Name.');
        // Wie beim Protokoll: Eine Variable, die keine Einstellung füllt, nur
        // unverändert aus dem geöffneten Paket — sonst sähe die Lücke vollständig aus.
        if (!umgebungsEinstellungen(e).some(k => k.variable === variable) && vorher?.password_variable !== variable) {
            throw new Error(`Keine Einstellung schreibt „${variable}" in die Umgebung. Erst eine Kennwort-Einstellung mit Ziel „Umgebungsvariable" anlegen.`);
        }
        if (befehl.length > RCON.befehl || /[\r\n]/.test(befehl)) throw new Error(`Prüfbefehl: eine Zeile, höchstens ${RCON.befehl} Zeichen.`);
        if (befehl.includes('{{')) throw new Error('Prüfbefehl: ohne Platzhalter — er wird so gesendet, wie er dasteht.');
        e.management = { ...(e.management || {}) };
        e.management.rcon = behalteUnbekanntes(vorher, { protocol, port: port.purpose, password_variable: variable }, RCON_FELDER);
        e.werkbank = { ...(e.werkbank || {}) };
        if (befehl) e.werkbank.rcon_pruefbefehl = befehl; else delete e.werkbank.rcon_pruefbefehl;
    });
}

async function rconEntfernen(sitzung) {
    await pruefeFrei(sitzung);
    return entwurfSchreiben(sitzung, (e) => {
        const haengt = rconAbhaengige(e);
        if (haengt.length) {
            throw new Error(`An der Fernsteuerung hängt noch ${haengt.join(', ')} — erst das umstellen oder entfernen.`);
        }
        if (e.management) {
            delete e.management.rcon;
            if (!Object.keys(e.management).length) delete e.management;
        }
        if (e.werkbank) delete e.werkbank.rcon_pruefbefehl;
    });
}

/**
 * Was der Durchlauf über die Fernsteuerung weiss — für die Vermerke im Paket.
 * Wie bei der Abfrage: Sie kommt auch unbelegt hinein, dann steht es dabei.
 * (Ein Durchlauf, der es versucht hat und scheiterte, ist rot — der kommt
 * hier nie an.)
 */
function rconVermerk(pruefung) {
    const r = pruefung.entwurf?.management?.rcon;
    if (!r) return [];
    const wo = `Fernsteuerung (${r.protocol}, Port „${r.port}")`;
    const n = pruefung.ergebnis?.rcon;
    if (n?.angemeldet) {
        return [`${wo}: im Durchlauf #${pruefung.id} belegt — angemeldet, „${n.befehl}" beantwortet.`];
    }
    return [`${wo}: im Durchlauf NICHT belegt — er hat sich nicht angemeldet (kein Prüfbefehl in der Sitzung, oder der Daemon ist älter als dieser Nachweis).`];
}

// Die Befehlsgruppen. Die fünf Namen kennt die Serverseite (BEFEHL_NAME); das
// Schema erlaubt weitere nach demselben Muster.
const BEFEHL = {
    gruppen: ['players.list', 'players.kick', 'players.ban', 'world.save', 'broadcast'],
    // `api` erlaubt das Schema, ausgeführt wird es nirgends und beschrieben ist es
    // nicht — wählbar ist es deshalb nicht, ein geöffnetes Paket behält es aber.
    wege: ['rcon', 'console', 'file', 'query', 'unsupported'],
    arten: ['append_line', 'remove_line', 'rewrite'],
    text: 300,
};
const BEFEHL_FELDER = ['via', 'command', 'parse', 'file', 'mode', 'value', 'reason'];
const RE_BEFEHL = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)?$/; // Schema: commands.propertyNames

function befehlAusFormular(b, vorher) {
    const text = (k) => (typeof b?.[k] === 'string' ? b[k].trim() : '');
    const kurz = (k, was) => {
        const v = text(k);
        if (v.length > BEFEHL.text || /[\r\n]/.test(v)) throw new Error(`${was}: eine Zeile, höchstens ${BEFEHL.text} Zeichen.`);
        return v;
    };
    const via = text('via');
    if (!BEFEHL.wege.includes(via) && !(via && vorher?.via === via)) {
        throw new Error(`Weg: ${BEFEHL.wege.join(', ')}.`);
    }
    const neu = { via };
    if (via === 'rcon' || via === 'console') {
        neu.command = kurz('command', 'Befehl');
        if (!neu.command) throw new Error(`Über ${via === 'rcon' ? 'die Fernsteuerung' : 'die Konsole'} braucht es den Befehl, der gesendet wird.`);
    }
    if (via === 'file') {
        neu.file = kurz('file', 'Datei');
        if (!neu.file || neu.file.startsWith('/') || neu.file.split('/').includes('..')) {
            throw new Error('Datei: ein Pfad im Spielordner, ohne „..“ und ohne führenden Schrägstrich.');
        }
        neu.mode = text('mode');
        if (!BEFEHL.arten.includes(neu.mode)) throw new Error(`Art: ${BEFEHL.arten.join(', ')}.`);
        const wert = kurz('value', 'Wert');
        if (wert) neu.value = wert;
    }
    if (via === 'rcon' || via === 'console' || via === 'query') {
        const lesen = kurz('parse', 'Auswertung');
        if (lesen) neu.parse = lesen;
    }
    if (via === 'unsupported') {
        const de = text('grund_de').slice(0, 600), en = text('grund_en').slice(0, 600);
        // Schema: Ein grauer Knopf mit Begründung ist besser als ein fehlender.
        if (!de && !en) throw new Error('„Nicht möglich" braucht eine Begründung — sie steht später am grauen Knopf.');
        neu.reason = { ...(de ? { de } : {}), ...(en ? { en } : {}) };
    }
    return neu;
}

async function befehlSpeichern(sitzung, b) {
    await pruefeFrei(sitzung);
    const key = typeof b?.key === 'string' ? b.key.trim() : '';
    if (!RE_BEFEHL.test(key) || key.length > 60) {
        throw new Error('Befehlsgruppe: Kleinbuchstaben, Ziffern, _, höchstens ein Punkt — etwa players.kick.');
    }
    return entwurfSchreiben(sitzung, (e) => {
        const vorher = e.commands?.[key] || null;
        const neu = befehlAusFormular(b, vorher);
        if (neu.via === 'rcon' && !e.management?.rcon) {
            throw new Error('Dieser Befehl soll über die Fernsteuerung laufen, der Entwurf hat aber keine — erst links die Fernsteuerung anlegen.');
        }
        e.commands = { ...(e.commands || {}), [key]: behalteUnbekanntes(vorher, neu, BEFEHL_FELDER) };
    });
}

async function befehlEntfernen(sitzung, key) {
    await pruefeFrei(sitzung);
    return entwurfSchreiben(sitzung, (e) => {
        if (!e.commands || e.commands[key] === undefined) throw new Error(`Den Befehl „${key}" gibt es im Entwurf nicht.`);
        delete e.commands[key];
        if (!Object.keys(e.commands).length) delete e.commands;
    });
}

// ── Feste Zeilen in Dateien (`config`, 2026-10-08) ───────────────────────────
//
// Was das PAKET in eine Datei schreibt — im Unterschied zu einer Einstellung,
// die der Betreiber wählt. Gebraucht für jedes Spiel, das einen Wert nur in
// seiner eigenen Datei erwartet: Craftopia liest den Port allein aus
// `ServerSetting.ini` ([Host] port) — kein Startparameter, keine Umgebung
// (im Programmcode nachgesehen, 2026-10-08). Mit der Nummer aus dem Probestart
// fiel das nicht auf: Sie war zufällig die Vorgabe des Spiels.
//
// Im Entwurf liegt der Teil in der Form des Pakets (`entwurf.config`: je Datei
// ein Eintrag mit `file`, `parser`, `set`). Der Daemon schreibt ihn bei jedem
// Start NACH den Einstellungen (auftrag/baue.go): Schreibt eine Einstellung
// denselben Schlüssel, gewinnt die feste Zeile — die Karte sagt das dazu.
//
// Ein Verweis, den der Daemon nicht auflösen kann, lässt ihn den Schlüssel
// ÜBERSPRINGEN. Deshalb hier beim Speichern: Port und Einstellung muss es im
// Entwurf geben.

const FESTZEILE = { parser: EINSTELLUNG.parser, max: { datei: 200, schluessel: 200, wert: 600 } };
const RE_FEST_VERWEIS = /^\{\{(setting|port|content|env):([A-Za-z][A-Za-z0-9_]*)\}\}$/;

/** `entwurf.config` als flache Liste — eine Zeile je Schlüssel. */
function festzeilenFlach(entwurf) {
    const aus = [];
    for (const d of Array.isArray(entwurf?.config) ? entwurf.config : []) {
        for (const [key, value] of Object.entries(d?.set || {})) {
            aus.push({ file: d.file, parser: d.parser, key, value: String(value ?? '') });
        }
    }
    return aus;
}

/**
 * Was die Karte zeigt: die Zeilen, und je Zeile die Einstellungen, die
 * denselben Schlüssel derselben Datei schreiben (sie verlieren).
 */
function festzeilenStand(sitzung) {
    const e = sitzung.entwurf || {};
    const einstellungen = Array.isArray(e.settings) ? e.settings : [];
    // Die Dateien, in die Einstellungen schreiben — meist aus der echten Datei
    // gelesen (Vorschläge) und damit richtig geschrieben.
    const bekannt = [...new Set(einstellungen.flatMap(s => (s.apply || []).filter(a => a.target === 'file' && a.file).map(a => a.file)))];
    return festzeilenFlach(e).map(z => ({
        ...z,
        ueberschreibt: einstellungen
            .filter(s => (s.apply || []).some(a => a.target === 'file' && a.file === z.file && a.path === z.key))
            .map(s => s.key),
        aehnlich: aehnlicheDatei(z.file, bekannt),
    }));
}

/** Wie viele Zeichen einzufügen, zu löschen oder zu tauschen sind (Levenshtein). */
function abstand(a, b) {
    let zeile = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const neu = [i];
        for (let k = 1; k <= b.length; k++) {
            neu[k] = Math.min(zeile[k] + 1, neu[k - 1] + 1, zeile[k - 1] + (a[i - 1] === b[k - 1] ? 0 : 1));
        }
        zeile = neu;
    }
    return zeile[b.length];
}

/**
 * Eine bekannte Datei, die fast so heisst wie diese — der Verdacht auf einen
 * Tippfehler. Betreiber am 2026-10-08, erste Zeile in der neuen Karte:
 * `ServerSettings.ini` statt `ServerSetting.ini`. Der Daemon legt eine fehlende
 * Datei an; das Spiel läse sie nie, und nichts meldete es.
 *
 * Nur ein HINWEIS, keine Sperre: `config.ini` neben `config2.ini` gibt es.
 */
function aehnlicheDatei(datei, bekannt) {
    if (bekannt.includes(datei)) return null;
    const klein = datei.toLowerCase();
    return bekannt.find(b => b.toLowerCase() === klein || abstand(b.toLowerCase(), klein) <= 2) || null;
}

function festzeileAusFormular(b, e) {
    const text = (k) => (typeof b?.[k] === 'string' ? b[k].trim() : '');
    const file = text('file'), parser = text('parser'), key = text('key');
    // Der Wert wird NICHT gestutzt, nur auf eine Zeile gebracht: Ein führendes
    // Leerzeichen kann gemeint sein.
    const value = typeof b?.value === 'string' ? b.value : '';
    if (!file || !key) throw new Error('Datei und Schlüssel gehören beide dazu.');
    if (file.startsWith('/') || file.split('/').includes('..')) throw new Error('Datei: ein Pfad relativ zu game/, ohne „.." und ohne führenden Schrägstrich.');
    if (file.length > FESTZEILE.max.datei) throw new Error(`Datei: höchstens ${FESTZEILE.max.datei} Zeichen.`);
    if (!FESTZEILE.parser.includes(parser)) throw new Error(`Format der Datei — ${FESTZEILE.parser.join(', ')}.`);
    if (key.length > FESTZEILE.max.schluessel || /[\r\n]/.test(key)) throw new Error(`Schlüssel: eine Zeile, höchstens ${FESTZEILE.max.schluessel} Zeichen.`);
    if (value.length > FESTZEILE.max.wert || /[\r\n]/.test(value)) throw new Error(`Wert: eine Zeile, höchstens ${FESTZEILE.max.wert} Zeichen.`);

    // Derselbe Verweis zweimal hintereinander ist ein Versehen (Auswahl doppelt
    // getroffen, 2026-10-08): `{{port:game}}{{port:game}}` ergäbe 65876587.
    const doppelt = /(\{\{[^}]*\}\})\1/.exec(value);
    if (doppelt) throw new Error(`${doppelt[1]} steht zweimal hintereinander — in der Datei stünde der Wert doppelt. Einmal genügt.`);
    for (const p of value.match(/\{\{[^}]*\}\}/g) || []) {
        const m = RE_FEST_VERWEIS.exec(p);
        if (!m) {
            throw new Error(`Den Platzhalter ${p} gibt es nicht — er stünde wörtlich in der Datei. `
                + 'Schreib {{port:zweck}} oder {{setting:schlüssel}}.');
        }
        if (m[1] === 'port' && !(e.ports || []).some(x => x.purpose === m[2])) {
            throw new Error(`${p}: Den Port „${m[2]}" gibt es im Entwurf nicht — der Daemon ließe die Zeile dann aus. Erst den Port übernehmen.`);
        }
        if (m[1] === 'setting' && !(e.settings || []).some(x => x.key === m[2])) {
            throw new Error(`${p}: Die Einstellung „${m[2]}" gibt es im Entwurf nicht — der Daemon ließe die Zeile dann aus.`);
        }
    }
    return { file, parser, key, value };
}

/** Eine Zeile herausnehmen; leere Einträge und eine leere Liste verschwinden. */
function festzeileLoesen(e, file, key) {
    let gefunden = false;
    e.config = (Array.isArray(e.config) ? e.config : []).filter((d) => {
        if (d.file !== file || !d.set || d.set[key] === undefined) return true;
        gefunden = true;
        delete d.set[key];
        return Object.keys(d.set).length > 0;
    });
    if (!e.config.length) delete e.config;
    return gefunden;
}

/** Anlegen oder ersetzen. `alt_file`/`alt_key` nennen die Zeile, die bearbeitet wird. */
async function festzeileSpeichern(sitzung, b) {
    await pruefeFrei(sitzung);
    return entwurfSchreiben(sitzung, (e) => {
        const neu = festzeileAusFormular(b, e);
        const altDatei = typeof b?.alt_file === 'string' ? b.alt_file.trim() : '';
        const altKey = typeof b?.alt_key === 'string' ? b.alt_key.trim() : '';
        const bearbeitet = altDatei && altKey;
        const selbe = bearbeitet && altDatei === neu.file && altKey === neu.key;
        if (!selbe && festzeilenFlach(e).some(z => z.file === neu.file && z.key === neu.key)) {
            throw new Error(`${neu.file} → ${neu.key} ist schon festgelegt — dort „Bearbeiten".`);
        }
        if (bearbeitet && !selbe) festzeileLoesen(e, altDatei, altKey);

        const liste = Array.isArray(e.config) ? e.config : [];
        const eintrag = liste.find(d => d.file === neu.file);
        if (eintrag && eintrag.parser !== neu.parser) {
            // Der Daemon nähme das Format des ersten Eintrags und meldete den
            // Widerspruch erst beim Start.
            throw new Error(`${neu.file} wird schon als „${eintrag.parser}" gelesen — eine Datei hat ein Format.`);
        }
        if (eintrag) eintrag.set = { ...(eintrag.set || {}), [neu.key]: neu.value };
        else liste.push({ file: neu.file, parser: neu.parser, set: { [neu.key]: neu.value } });
        e.config = liste;
    });
}

async function festzeileEntfernen(sitzung, b) {
    await pruefeFrei(sitzung);
    const file = typeof b?.file === 'string' ? b.file.trim() : '';
    const key = typeof b?.key === 'string' ? b.key.trim() : '';
    return entwurfSchreiben(sitzung, (e) => {
        if (!festzeileLoesen(e, file, key)) throw new Error(`Die feste Zeile ${file} → ${key} gibt es im Entwurf nicht.`);
    });
}

// ── Voraussetzungen (`requirements`, 2026-10-09) ─────────────────────────────
//
// Was das SPIEL vom Image verlangt. Anlass war Core Keeper: Der Server stürzte
// nach 35 s mit Signal 11 ab, im Panel stand „Exit 139" — dem Image fehlten
// `xvfb` und `libxi6`, und einen Bildschirm stellte niemand auf.
//
// Zwei Felder, und sie sind verschiedener Art:
//
//   os_packages   ERKLÄRT, was im Image sein muss. Installiert wird daraus
//                 nichts — der Container läuft als 1000. Der Daemon ZÄHLT am
//                 Image der Sitzung nach (`werkbank.voraussetzungen`), und der
//                 Prüfdurchlauf wird rot, bevor er installiert, wenn etwas fehlt.
//   display       WIRKT: `virtual` lässt fb-init vor dem Spiel einen Xvfb
//                 starten und DISPLAY setzen.
//
// Der Befund des Nachzählens liegt in `entwurf.werkbank.voraussetzungen` — er
// gehört der Sitzung, nicht dem Paket, und er gilt nur für die Frage, zu der
// er gehört (`frage`): andere Pakete, anderes Image, und er ist kein Befund
// mehr. Ein Tag wandert allerdings: Nach einem Image-Bau steht hier der alte
// Stand, bis jemand neu prüft. Der Prüfdurchlauf fragt deshalb immer frisch.

const VORAUSSETZUNG = {
    max: 40, bildschirm: 'virtual', bildschirmPaket: 'xvfb', frist: 120000,
    zuAlt: 'Der Daemon dieser Maschine kennt das Nachzählen noch nicht — es kommt mit 1.0.115.',
};
// Dieselbe Regel wie im Daemon (werkbank_voraussetzungen.go): Die Namen gehen
// als Argumente an dpkg-query, und was mit „-" beginnt, wäre dort ein Schalter.
const RE_OS_PAKET = /^[a-z0-9][a-z0-9+.-]{1,99}(:[a-z0-9-]{1,20})?$/;
const VORAUSSETZUNG_FELDER = ['os_packages', 'display'];

/** Was der Daemon gefragt würde — als Text, an dem ein gemerkter Befund hängt. */
function voraussetzungenFrage(sitzung) {
    const r = sitzung.entwurf?.requirements || {};
    const img = sitzungsImage(sitzung) || {};
    return stabil({
        image: `${img.ref || ''}:${img.tag || ''}`,
        pakete: [...(Array.isArray(r.os_packages) ? r.os_packages : [])].sort(),
        display: r.display || '',
    });
}

/** Gibt es überhaupt etwas nachzuzählen? */
function voraussetzungenGefragt(sitzung) {
    const r = sitzung.entwurf?.requirements || {};
    return (Array.isArray(r.os_packages) && r.os_packages.length > 0) || r.display === VORAUSSETZUNG.bildschirm;
}

/**
 * Was die Karte zeigt. `vorhanden` ist dreiwertig: true, false — oder null,
 * wenn es zu DIESER Liste an DIESEM Image keinen Befund gibt. „Nicht geprüft"
 * ist eine eigene Auskunft und wird nie als „fehlt" oder „da" gezeigt.
 */
function voraussetzungenStand(sitzung) {
    const r = sitzung.entwurf?.requirements || {};
    const gemerkt = sitzung.entwurf?.werkbank?.voraussetzungen || null;
    const gilt = !!gemerkt && gemerkt.frage === voraussetzungenFrage(sitzung);
    const befund = gilt && !gemerkt.fehler ? gemerkt : null;
    const je = new Map((befund?.pakete || []).map(p => [p.name, p.vorhanden === true]));
    const namen = Array.isArray(r.os_packages) ? r.os_packages : [];
    const bildschirm = r.display === VORAUSSETZUNG.bildschirm;
    return {
        pakete: namen.map(name => ({ name, vorhanden: je.has(name) ? je.get(name) : null })),
        bildschirm,
        // Der Bildschirm hängt am Paket xvfb — der Daemon fragt es mit.
        bildschirmVorhanden: bildschirm && befund ? befund.display_vorhanden === true : null,
        gefragt: voraussetzungenGefragt(sitzung),
        geprueftAm: befund ? gemerkt.am : null,
        geprueftAn: befund ? gemerkt.image : null,
        // Der Bau, an dem gezählt wurde (2026.10) — der Daemon nennt ihn ab 1.0.116.
        geprueftFassung: befund ? (gemerkt.fassung || '') : '',
        fehlt: befund ? (befund.fehlt || []) : [],
        // Warum es keinen Befund gibt, wenn es einen geben müsste.
        ungeprueft: befund ? null
            : !voraussetzungenGefragt(sitzung) ? null
            : gilt && gemerkt.fehler ? gemerkt.fehler
            : gemerkt ? 'Liste oder Image haben sich seit der letzten Prüfung geändert.'
            : 'Noch nicht am Image nachgezählt.',
        // Was ein geöffnetes Paket sonst noch trägt (min_ram_mb, glibc …):
        // bleibt stehen, die Karte hat dafür kein Feld.
        sonstiges: Object.keys(r).filter(k => !VORAUSSETZUNG_FELDER.includes(k)).map(k => ({ feld: k, wert: r[k] })),
    };
}

function voraussetzungenAusFormular(b) {
    const roh = typeof b?.os_packages === 'string' ? b.os_packages
        : Array.isArray(b?.os_packages) ? b.os_packages.join('\n') : '';
    const namen = [];
    for (const n of roh.split(/[\s,;]+/).map(x => x.trim()).filter(Boolean)) {
        if (!RE_OS_PAKET.test(n)) {
            throw new Error(`„${n}" ist kein Paketname — Kleinbuchstaben, Ziffern, „+", „." und „-", wie bei apt (etwa libxi6).`);
        }
        if (!namen.includes(n)) namen.push(n);
    }
    if (namen.length > VORAUSSETZUNG.max) throw new Error(`Höchstens ${VORAUSSETZUNG.max} Systempakete.`);
    return { os_packages: namen, display: istWahr(b?.display) ? VORAUSSETZUNG.bildschirm : '' };
}

/**
 * Die Karte speichern. Ein leeres Feld löscht den Schlüssel — ausser er stand
 * vorher leer da: Factorio und Minecraft tragen `os_packages: []`, und ein
 * geöffnetes Paket soll unverändert durchs Formular dasselbe Paket ergeben.
 */
async function voraussetzungenSpeichern(sitzung, b) {
    await pruefeFrei(sitzung);
    const neu = voraussetzungenAusFormular(b);
    await entwurfSchreiben(sitzung, (e) => {
        const gab = e.requirements !== undefined;
        const r = { ...(e.requirements || {}) };
        if (neu.os_packages.length || Array.isArray(r.os_packages)) r.os_packages = neu.os_packages;
        if (neu.display) r.display = neu.display; else delete r.display;
        if (Object.keys(r).length || gab) e.requirements = r; else delete e.requirements;
    });
    return voraussetzungenPruefen(sitzung);
}

/**
 * Am Image der Sitzung nachzählen und den Befund merken. Wirft nicht, wenn der
 * Daemon nicht antwortet: Die Liste ist dann trotzdem gespeichert, und der
 * Grund steht auf der Karte — als „nicht geprüft", nie als „in Ordnung".
 */
async function voraussetzungenPruefen(sitzung) {
    if (!voraussetzungenGefragt(sitzung)) {
        await entwurfSchreiben(sitzung, (e) => { if (e.werkbank) delete e.werkbank.voraussetzungen; });
        return { geprueft: false, grund: null, fehlt: [] };
    }
    const frage = voraussetzungenFrage(sitzung);
    let ergebnis = null, grund = null;
    try {
        const daemon = await daemonFuer(sitzung);
        const antwort = await daemon.senden('werkbank.voraussetzungen', {
            image: sitzungsImage(sitzung),
            requirements: sitzung.entwurf.requirements,
        }, VORAUSSETZUNG.frist);
        const daten = antwort?.data?.ergebnis || null;
        if (antwort?.success && daten && Array.isArray(daten.pakete)) ergebnis = daten;
        // Ein Daemon vor 1.0.115 kennt den Befehl nicht, hält ihn für einen
        // Gameserver-Befehl und antwortet „Gameserver nicht gefunden" (im
        // Verteiler nachgelesen, 2026-10-09). Wörtlich weitergereicht suchte
        // jemand einen Server, den es nie gab.
        else if (antwort?.error === 'Gameserver nicht gefunden') grund = VORAUSSETZUNG.zuAlt;
        else grund = antwort?.error || 'Der Daemon hat keinen Befund geliefert — kennt er den Befehl schon (ab 1.0.115)?';
    } catch (fehler) {
        grund = fehler.message;
    }
    const am = new Date().toISOString();
    await entwurfSchreiben(sitzung, (e) => {
        e.werkbank = e.werkbank || {};
        e.werkbank.voraussetzungen = ergebnis
            ? { frage, am, image: ergebnis.image, fassung: ergebnis.fassung || '', pakete: ergebnis.pakete, fehlt: ergebnis.fehlt || [],
                display_verlangt: !!ergebnis.display_verlangt, display_vorhanden: !!ergebnis.display_vorhanden }
            : { frage, am, fehler: grund };
    });
    return { geprueft: !!ergebnis, grund, fehlt: ergebnis ? (ergebnis.fehlt || []) : [] };
}

/** Die Stufe, mit der der Durchlauf grün wurde — so, wie sie im Paket stehen soll. */
function bereitUeber(stufe) {
    if (stufe === 'query') return 'bereit über die Abfrage (das Spiel hat geantwortet)';
    if (stufe === 'log_line') return 'bereit über die Logzeile (Ausnahme ohne Port)';
    return 'bereit über den Port';
}

/**
 * Was ein geöffnetes Paket am Image trägt, ohne dass die Werkbank es kennt —
 * alles außer Name, Tag und Anheftung. Nur solange es dasselbe Image ist: Ein
 * anderes Image hat seine eigene Plattform.
 */
function imageBeiwerk(vorher, jetzt) {
    if (!vorher || typeof vorher !== 'object') return {};
    // Dasselbe Image heisst: derselbe Name, dieselbe Ausprägung. Der Monat
    // darf wechseln — ein Umzug auf einen neuen Bau ist genau das, und
    // `platform`/`arch` gingen sonst bei jedem Umzug verloren (wie Valheim
    // 1.0.21 am 2026-10-07).
    if (jetzt && (vorher.ref !== jetzt.ref || imageVariante(vorher.tag) !== imageVariante(jetzt.tag))) return {};
    const { ref, tag, digest, pinned_at, ...beiwerk } = vorher;
    return beiwerk;
}

/** Das Image der Fassung, aus der diese Sitzung geöffnet wurde — oder null. */
async function imageDerGeoeffnetenFassung(sitzung) {
    const von = sitzung.entwurf?.werkbank?.geoeffnet;
    if (!von?.paket_id || !von?.version) return null;
    const [z] = await db().query(
        'SELECT fbpkg FROM package_versions WHERE package_id = ? AND version = ?', [von.paket_id, von.version]);
    return json(z?.fbpkg, null)?.image || null;
}

/**
 * Der Tag, der ins Paket kommt: die Kalenderfassung des Images, auf dem der
 * Durchlauf lief. Nennt der Durchlauf sie nicht (Daemon vor 1.0.116), gilt
 * der Tag des geprüften Entwurfs — aber nur, wenn DER eine Kalenderfassung
 * ist. „latest" kommt nie ins Paket: null, und das Veröffentlichen sagt es.
 */
function paketTag(pruefung) {
    const ausLauf = pruefung?.ergebnis?.image_tag;
    if (istKalendertag(ausLauf)) return ausLauf;
    const ausEntwurf = pruefung?.entwurf?.image?.tag;
    return istKalendertag(ausEntwurf) ? ausEntwurf : null;
}

/** Das Paket, wie es eingeliefert wird. */
function veroeffentlichungsPaket(sitzung, liste, pruefung, autor, imageVorher = null) {
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
            const b = belegteEinstellungen(pruefung.entwurf, pruefung.ergebnis, uebernommeneZiele(sitzung));
            const teil = { settings: b.behalten, env: b.env };
            if (!teil.settings.length) delete teil.settings;
            if (!Object.keys(teil.env).length) delete teil.env;
            return teil;
        })(),
        // Hinweise aus dem Entwurf von JETZT, wie Name und Beschreibung — sie
        // gehören nicht zum Geprüften und dürfen nach dem Durchlauf entstehen.
        ...(Array.isArray(e.hints) && e.hints.length ? { hints: e.hints } : {}),
        // Angeheftet wird der Digest, auf dem der grüne Durchlauf WIRKLICH lief
        // (der Daemon meldet ihn) — nicht der, der beim Veröffentlichen gerade
        // hinter dem Tag steht (Baustelle 166).
        //
        // Was das geöffnete Paket am Image sonst noch trug (`platform`, `arch`),
        // bleibt — die Sitzung kennt vom Image nur Name und Tag. Valheim 1.0.21
        // verlor beides am 2026-10-07; der Wächter verglich bis dahin nur `ref:tag`.
        //
        // Der TAG kommt seit 2026-10-09 ebenfalls aus dem Durchlauf: Die Sitzung
        // fragt nur noch „den neuesten Bau" (`latest…`), und ins Paket gehört
        // der Name des Standes, auf dem geprüft wurde (`image_tag`, aus dem
        // Etikett des Images).
        image: {
            ...imageBeiwerk(imageVorher, pruefung.entwurf?.image),
            ...(pruefung.entwurf?.image || {}),
            tag: paketTag(pruefung),
            digest: pruefung.ergebnis?.image_digest,
            pinned_at: heute,
        },
        status: {
            complete: false,
            open: [
                `Aus der Werkbank (Sitzung ${sitzung.kennung}). Prüfdurchlauf #${pruefung.id} grün am ${am} UTC: `
                    + `ganzes Rezept auf leerem Volume, ${bereitUeber(pruefung.ergebnis?.bereitschaft)}, Stoppfolge endete vor sigkill.`,
                ...(() => {
                    const b = belegteEinstellungen(pruefung.entwurf, pruefung.ergebnis, uebernommeneZiele(sitzung));
                    const zeilen = [];
                    if (!b.behalten.length && !b.weg.length) {
                        zeilen.push('Keine Einstellungen — der Server ist startbar, aber nicht einstellbar.');
                    }
                    if (b.behalten.length) {
                        zeilen.push(`Einstellungen: ${b.behalten.length} im Durchlauf #${pruefung.id} als angekommen belegt `
                            + '(Datei per fb-init-Meldung, Startzeile/Umgebung per Gegenwert). Ob das Spiel den Wert BEACHTET, '
                            + 'ist damit nicht gezeigt.');
                    }
                    if (b.ohneBeleg) {
                        zeilen.push(`Davon ${b.ohneBeleg} Ziel(e) unverändert aus dem geöffneten Paket übernommen — im Durchlauf nicht belegt.`);
                    }
                    for (const w of b.weg) zeilen.push(`Nicht aufgenommen: Einstellung „${w.key}" — ${w.grund}`);
                    return zeilen;
                })(),
                ...abfrageVermerk(pruefung),
                ...rconVermerk(pruefung),
                // Durchgereichtes steht im Paket, wie es war — die Werkbank hat es
                // weder gebaut noch im Durchlauf einzeln belegt. Das gehört gesagt.
                ...(() => {
                    const teile = durchgereichteTeile(pruefung.entwurf);
                    const von = sitzung.entwurf?.werkbank?.geoeffnet;
                    return teile.length
                        ? [`Unverändert übernommen${von ? ` aus ${von.slug} ${von.version}` : ''}: ${teile.join(', ')} — `
                            + 'von Hand gepflegt, in der Werkbank nicht bearbeitet und nicht einzeln geprüft.']
                        : [];
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

/**
 * Die Tags der Sitzung an das Spiel im Panel geben (packages.id =
 * addon_marketplace.id) — nur, wenn die Sitzung welche gesetzt hat; sonst
 * bleibt, was das Spiel trägt.
 *
 * Aufgerufen NACH dem Einliefern: Scheitert das Setzen, wird es gemeldet, nicht
 * verschwiegen — das Veröffentlichen ist an der Stelle nicht mehr ungeschehen
 * zu machen, und ein Paket ohne seine Tags ist besser als eine Meldung „nicht
 * veröffentlicht" über einem Paket, das längst im Kanal liegt.
 *
 * @returns {Promise<string[]|null>} die Tags am Spiel danach; null = nicht angefasst
 */
async function tagsUebergeben(sitzung, paketId, zeilen = []) {
    const eigeneTags = sitzung.entwurf?.werkbank?.praesentation?.tags;
    if (!Array.isArray(eigeneTags) || !paketId) return null;
    try {
        return await Tags.setze(db(), 'spiel', paketId, eigeneTags);
    } catch (fehler) {
        zeilen.push(`⚠ Eingeliefert, aber die Tags liessen sich nicht setzen: ${fehler.message}`);
        ServiceManager.get('Logger').error(`[Werkbank] Tags für Paket ${paketId} nicht gesetzt`, fehler);
        return null;
    }
}

async function veroeffentlichen(sitzung, liste, pruefListe, { autor } = {}) {
    const stand = await veroeffentlichungsStand(sitzung, liste, pruefListe);
    if (!stand.darf) throw new Error(stand.gruende.join(' '));
    const paket = veroeffentlichungsPaket(sitzung, liste, stand.pruefung, autor, await imageDerGeoeffnetenFassung(sitzung));
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
    await tagsUebergeben(sitzung, r.paketId, zeilen);
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

/**
 * Die Ports eines Laufs: was GERADE lauscht (`ports`) und, dazugerechnet, was
 * er je gesehen hat (`gesehen`). Das zweite bleibt nach dem Ende stehen — für
 * das Übernehmen nach dem Stoppen und den Vergleich mit dem nächsten Start.
 */
async function laufPortsMerken(laufId, ports) {
    const [z] = await db().query('SELECT gesehen, ports FROM werkbank_laeufe WHERE id = ?', [laufId]);
    const vereint = new Map();
    // Auch was bisher in `ports` stand: Ein Lauf, der schon lief, als diese
    // Spalte kam, hätte sonst am Ende nichts gesehen.
    for (const p of [...(json(z?.gesehen, null) || []), ...(json(z?.ports, null) || []), ...ports]) {
        const n = Number(p?.port);
        if (Number.isInteger(n) && (p.protocol === 'tcp' || p.protocol === 'udp')) vereint.set(n + '/' + p.protocol, { port: n, protocol: p.protocol });
    }
    const gesehen = [...vereint.values()].sort((a, b) => a.port - b.port || a.protocol.localeCompare(b.protocol));
    await db().query('UPDATE werkbank_laeufe SET ports = ?, gesehen = ? WHERE id = ?',
        [JSON.stringify(ports), JSON.stringify(gesehen), laufId]);
    return gesehen;
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
    uebernommeneAusfuehren, ketteFortsetzen, offeneUebernommene,
    angabenTags, tagsUebergeben, portBild, konsolenZeileZu, laufPortsMerken,
    FESTZEILE, festzeilenStand, festzeileSpeichern, festzeileEntfernen,
    VORAUSSETZUNG, voraussetzungenStand, voraussetzungenSpeichern, voraussetzungenPruefen,
    RCON, BEFEHL, GANZ, rconStand, rconSpeichern, rconEntfernen, rconVermerk, rconPruefbefehl, befehlSpeichern, befehlEntfernen,
    sitzungsImage, imageVariante, neuesterTag, istKalendertag, paketTag, imageName,
    RE_KENNUNG, RE_ZWECK, SCHRITTTYPEN, MAX_AUSGABE, GRENZEN, VORGABE, ERKUNDUNG, hatBereitschaft,
    waehlbareImages, maschinen, liste, laden, schritte, anlegen,
    schrittAusfuehren, ausgabeAnhaengen, beenden, pruefsummeEintragen, laufenderSchritt,
    herausnehmen, verwerfen, entwurfAlsPaket,
    PRUEF_SUFFIX, fingerabdruck, technisch,
    pruefeBildAdresse, angaben, angabenSpeichern, veroeffentlichungsStand, veroeffentlichungsPaket, veroeffentlichen, laufendePruefung, pruefungen, durchlaufMaengel, pruefen,
    pruefungAbbrechen, pruefProtokoll, pruefungBeenden,
    EINSTELLUNG, einstellungAusFormular, einstellungSpeichern, einstellungEntfernen, einstellungRolleSetzen, probewerteSetzen, probewerte,
    umgebungAusEinstellungen, belegteEinstellungen,
    HINWEIS, hinweisAusFormular, hinweisSpeichern, hinweisEntfernen,
    DURCHGEREICHT, IM_ENTWURF, imEntwurf, entwurfAusPaket, paketOeffnen, durchgereichtes, naechsteFassung, behalteUnbekanntes, mischeStart, mischeEinstellung, zieleAusPaket, uebernommeneZiele, vorlaeufigePortnummern, oeffenbarePakete, LAUFZEIT_TEILE,
    werkbankTeil, ungenutztePorts, startSpeichern, startzeile, zustand, starten, stoppen, eingabe, laeufe, laufenderLauf,
    portUebernehmen, portEntfernen, bereitschaftszeile,
    portSpeichern, portAusFormular, kopplungVon, abfrageKennungen, abfrageStand, abfrageSpeichern, abfrageEntfernen,
    EIGENE, ordne, durchgereichteTeile, PORT,
    laufSetzen, konsoleAnhaengen, laufBeenden, dateienJetzt, gruppiere,
    formatVermuten, vorschlagsDateien, schluesselLesen, vorschlaegeUebernehmen, freierSchluessel,
};
