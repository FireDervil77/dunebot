'use strict';

/**
 * Streaming - der Takt.
 *
 * Der Eingang schreibt nur weg und antwortet; **hier** wird gearbeitet. Diese
 * Trennung ist keine Eleganz, sondern Pflicht: Twitch widerruft bei zu
 * langsamen Antworten das Abo, und daran haengen alle Guilds.
 *
 * Ein Neustart mitten in der Verarbeitung verliert nichts - was `neu` ist,
 * bleibt `neu`. Der Preis sind bis zu fuenf Sekunden Verzoegerung; die
 * Abfrage-Bots am Markt brauchen Minuten.
 *
 * Zwei Laeufe:
 *
 *   - **Posteingang** (5 s): uebersetzen, Zustand fortschreiben, entscheiden,
 *     auffaechern, Auftraege schreiben.
 *   - **Anreicherung** (30 s): Titel, Kategorie, Zuschauer, Vorschaubild in
 *     **einem** Zug fuer alle frisch gestarteten Kanaele nachholen.
 *     `stream.online` bringt davon nichts mit.
 *
 * Die Reihenfolge ist Absicht: **erst melden, dann verschoenern.** Wer auf die
 * Anreicherung wartet, haengt die Ankuendigung an eine zweite Schnittstelle,
 * die ausfallen kann. Eine Ankuendigung ohne Vorschaubild ist ein
 * Schoenheitsfehler - eine ausbleibende ist der Ausfall.
 *
 * @module streaming/dashboard/kern/takt
 */

const { ServiceManager } = require('dunebot-core');
const entscheidung = require('./entscheidung');
const abos = require('./abos');

const TAKT_MS = 5_000;
const ANREICHERN_MS = 30_000;

/** Abgleich und Aufraeumen: einmal am Tag reicht - beide reden mit der Plattform. */
const TAG_MS = 24 * 60 * 60 * 1000;

/**
 * Warten, bevor der erste Abgleich laeuft.
 *
 * Ein Abgleich in der ersten Sekunde nach dem Start traefe auf ein Dashboard,
 * das seine Verbindungen noch aufbaut. Scheitert er, sieht das aus wie "alle
 * Abos sind weg" - und der Lauf handelt danach.
 */
const START_VERZOEGERUNG_MS = 60_000;

let laeuftGerade = false;
let anreicherungLaeuft = false;
let tagLaeuft = false;
let uhren = [];

/**
 * @returns {Object} Datenbankdienst
 */
function db() {
    return ServiceManager.get('dbService');
}

/**
 * @returns {Object} Logger
 */
function log() {
    return ServiceManager.get('Logger');
}

/**
 * Zeitstempel der Plattform in etwas verwandeln, das MySQL annimmt.
 *
 * Twitch liefert ISO-8601 mit `T` und `Z` ("2026-08-24T09:20:55.496Z").
 * Eine DATETIME-Spalte weist das zurueck:
 *
 *     Incorrect datetime value: '2026-08-24T09:20:55.496Z'
 *
 * Ein `Date`-Objekt serialisiert der Treiber dagegen richtig. Gefunden am
 * 2026-08-24 mit `scripts/streaming-probe.js`, bevor je ein echter Stream
 * lief - das Ereignis waere sonst im Posteingang auf "fehler" gelaufen und
 * keine Ankuendigung entstanden.
 *
 * @param {string|Date|null} wert Zeitstempel
 * @param {Date|null} [ersatz] Wert, wenn nichts Brauchbares kommt
 * @returns {Date|null} Datum oder Ersatz
 */
function alsDatum(wert, ersatz = null) {
    if (!wert) return ersatz;
    const d = wert instanceof Date ? wert : new Date(wert);
    return Number.isNaN(d.getTime()) ? ersatz : d;
}

/**
 * Einstellungen einer Guild - heute die Vorgaben, ab Stufe 5 je Guild.
 *
 * @param {string} guildId Guild
 * @returns {Object} { abklingzeitMinuten, karenzMinuten }
 */
function einstellungen(guildId) {
    const config = require('../../config.json');
    return {
        abklingzeitMinuten: Number(config.ABKLINGZEIT_MINUTEN || 15),
        karenzMinuten: Number(config.KARENZ_MINUTEN || 2)
    };
}

/**
 * Ein Hausereignis verarbeiten.
 *
 * @param {Object} ereignis Hausereignis aus dem Adapter
 * @returns {Promise<string>} Was geschehen ist
 */
async function verarbeiten(ereignis) {
    const streamerZeilen = await db().query(
        'SELECT * FROM streaming_streamers WHERE plattform = ? AND kanal_id = ? LIMIT 1',
        [ereignis.plattform, String(ereignis.kanal_id)]);

    if (!streamerZeilen.length) {
        // Kommt vor, wenn ein Abo bei der Plattform lebt, der Streamer bei uns
        // aber schon geloescht ist. Der Abgleich raeumt das ab; hier ist es
        // kein Fehler, sondern nichts zu tun.
        return 'kein Streamer zu diesem Kanal';
    }

    const streamer = streamerZeilen[0];

    // Der Kanalname kann sich jederzeit aendern. Die Kennung bleibt - deshalb
    // laeuft das Abo weiter -, aber unser gespeicherter Name veraltet still,
    // und aus ihm wird der Link der Ankuendigung gebaut. Twitch gibt alte
    // Namen wieder frei; ein veralteter Link kann irgendwann auf einen
    // FREMDEN Kanal zeigen.
    if (ereignis.login && ereignis.login !== streamer.login) {
        await db().query(
            'UPDATE streaming_streamers SET login = ?, geprueft_am = NOW() WHERE id = ?',
            [ereignis.login, streamer.id]);
        log().info(`[Streaming] Kanal ${streamer.kanal_id} heisst jetzt "${ereignis.login}" (vorher "${streamer.login}")`);
        streamer.login = ereignis.login;
    }
    const zustandZeilen = await db().query(
        'SELECT * FROM streaming_state WHERE streamer_id = ?', [streamer.id]);
    const zustand = zustandZeilen[0] || null;

    switch (ereignis.art) {
        case 'ging_live':   return await gingLive(streamer, zustand, ereignis);
        case 'beendet':     return await beendet(streamer, zustand, ereignis);
        case 'geaendert':   return await geaendert(streamer, zustand, ereignis);
        default:            return `Ereignisart "${ereignis.art}" wird nicht behandelt`;
    }
}

/**
 * @param {Object} streamer Streamer
 * @param {Object|null} zustand Zustand
 * @param {Object} ereignis Ereignis
 * @returns {Promise<string>} Ergebnis
 */
async function gingLive(streamer, zustand, ereignis) {
    const wahl = entscheidung.beiGingLive(ereignis, zustand, einstellungen(), Date.now());

    await db().query(`
        INSERT INTO streaming_state (streamer_id, ist_live, sendung_id, begonnen_am, beendet_am)
        VALUES (?, 1, ?, ?, NULL)
        ON DUPLICATE KEY UPDATE
            ist_live = 1,
            sendung_id = VALUES(sendung_id),
            begonnen_am = COALESCE(VALUES(begonnen_am), begonnen_am),
            beendet_am = NULL
    `, [streamer.id, ereignis.sendung_id || null, alsDatum(ereignis.begonnen_am, new Date())]);

    // Die Rolle haengt am Livezustand, nicht an der Ankuendigung: Auch wenn
    // wegen Abklingzeit oder Filter nichts gemeldet wird, sendet die Person.
    // Deshalb steht das VOR den beiden Abbruechen darunter.
    const rollen = await rollenAuffaechern(streamer.id, 'geben');

    if (wahl.handlung === 'nichts') return `keine Meldung: ${wahl.grund}` + (rollen ? `, ${rollen} Rolle(n) vorgemerkt` : '');
    if (wahl.handlung === 'aktualisieren') return `keine zweite Ankuendigung: ${wahl.grund}`;

    const anzahl = await auffaechern(streamer.id, 'posten');

    // `zuletzt_gemeldet_am` wird hier BEWUSST nicht gesetzt. Es steuert die
    // Abklingzeit, und die darf sich nur auf tatsaechlich gesendete
    // Ankuendigungen stuetzen. Vorher stand hier ein NOW() direkt nach dem
    // Auffaechern - scheiterte der Versand danach, behauptete der Zustand
    // trotzdem "gemeldet" und sperrte 15 Minuten lang jeden neuen Versuch.
    // Gesetzt wird es jetzt von der Drossel, wenn eine Nachricht wirklich steht.
    return `${anzahl} Auftrag/Auftraege geschrieben`;
}

/**
 * @param {Object} streamer Streamer
 * @param {Object|null} zustand Zustand
 * @param {Object} ereignis Ereignis
 * @returns {Promise<string>} Ergebnis
 */
async function beendet(streamer, zustand, ereignis) {
    const wahl = entscheidung.beiBeendet(ereignis, zustand);

    await db().query(`
        INSERT INTO streaming_state (streamer_id, ist_live, beendet_am)
        VALUES (?, 0, ?)
        ON DUPLICATE KEY UPDATE ist_live = 0, beendet_am = VALUES(beendet_am)
    `, [streamer.id, alsDatum(ereignis.beendet_am, new Date())]);

    // Karenz: erst nach Ablauf aufraeumen. Kommt der Streamer vorher zurueck,
    // hebt `gingLive` den Zustand wieder auf, und der Auftrag findet beim
    // Ausfuehren eine laufende Sendung vor.
    const karenzMs = einstellungen().karenzMinuten * 60_000;

    // **Die Rolle bekommt dieselbe Karenz.** Twitch meldet nach kurzen
    // Verbindungsabrissen erneut `stream.online`; ohne Karenz waere die Rolle
    // in der Zwischenzeit weg und kaeme sofort wieder - mit allem, was daran
    // haengt (Sortierung der Mitgliederliste, Benachrichtigungen). Sie wird
    // auch dann genommen, wenn gar nichts angekuendigt wurde: Die Rolle haengt
    // am Livezustand, nicht an der Nachricht.
    const rollen = await rollenAuffaechern(streamer.id, 'nehmen', karenzMs);

    if (wahl.handlung === 'nichts') {
        return wahl.grund + (rollen ? `, ${rollen} Rolle(n) zum Entziehen vorgemerkt` : '');
    }

    const anzahl = await auffaechern(streamer.id, 'aufraeumen', karenzMs);

    return `Aufraeumen fuer ${anzahl} Ziel(e) in ${Math.round(karenzMs / 1000)} s vorgemerkt` +
           (rollen ? `, dazu ${rollen} Rolle(n)` : '');
}

/**
 * @param {Object} streamer Streamer
 * @param {Object|null} zustand Zustand
 * @param {Object} ereignis Ereignis
 * @returns {Promise<string>} Ergebnis
 */
async function geaendert(streamer, zustand, ereignis) {
    await db().query(`
        INSERT INTO streaming_state (streamer_id, titel, kategorie)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE
            titel = COALESCE(VALUES(titel), titel),
            kategorie = COALESCE(VALUES(kategorie), kategorie)
    `, [streamer.id, ereignis.titel || null, ereignis.kategorie || null]);

    // Nur solange gesendet wird, hat eine Aenderung eine Nachricht, die
    // nachziehen koennte.
    if (!zustand?.ist_live) return 'Angaben gemerkt (nicht live)';

    const anzahl = await auffaechern(streamer.id, 'bearbeiten');
    return `${anzahl} Nachricht(en) ziehen nach`;
}

/**
 * Ein Ereignis auf alle Ziele auffaechern.
 *
 * @param {number} streamerId Streamer
 * @param {string} aktion 'posten' | 'bearbeiten' | 'aufraeumen'
 * @param {number} [verzoegerungMs] Wartezeit
 * @returns {Promise<number>} Anzahl geschriebener Auftraege
 */
async function auffaechern(streamerId, aktion, verzoegerungMs = 0) {
    const ziele = await db().query(
        'SELECT * FROM streaming_targets WHERE streamer_id = ? AND aktiv = 1', [streamerId]);

    const zustandZeilen = await db().query(
        'SELECT * FROM streaming_state WHERE streamer_id = ?', [streamerId]);
    const zustand = zustandZeilen[0] || {};

    let geschrieben = 0;

    for (const ziel of ziele) {
        // Beim Aufraeumen und Bearbeiten zaehlt der Filter nicht mehr: Was
        // gepostet wurde, muss auch aufgeraeumt werden - selbst wenn sich die
        // Kategorie zwischendurch geaendert hat.
        if (aktion === 'posten') {
            const passt = entscheidung.zielPasst(ziel, zustand);
            if (!passt.passt) {
                if (passt.wartetAufAnreicherung) {
                    // Nicht verwerfen: Der Anreicherungslauf entscheidet gleich
                    // erneut, dann mit Titel und Kategorie.
                    log().debug(`[Streaming] Ziel ${ziel.id} wartet auf Anreicherung`);
                }
                continue;
            }
        }

        await db().query(`
            INSERT INTO streaming_outbox (target_id, guild_id, aktion, nutzlast, faellig_ab)
            VALUES (?, ?, ?, ?, DATE_ADD(NOW(3), INTERVAL ? MICROSECOND))
        `, [ziel.id, ziel.guild_id, aktion, JSON.stringify({ streamer_id: streamerId }), verzoegerungMs * 1000]);

        geschrieben++;
    }

    return geschrieben;
}

/**
 * Live-Rolle auffaechern.
 *
 * Getrennt von `auffaechern()`, weil hier andere Regeln gelten:
 *
 * **1. Der Ankuendigungsfilter zaehlt NICHT.** Wer sendet, sendet — auch wenn
 * die Guild nur bei einem bestimmten Spiel meldet. Haengte man die Rolle an
 * den Filter, ginge sie mitten im Stream an und aus, sobald jemand die
 * Kategorie wechselt. Ein Mitglied, dem der Bot im Minutentakt eine Rolle gibt
 * und nimmt, ist ein Aergernis mit Benachrichtigung.
 *
 * **2. Ohne Zuordnung passiert nichts.** `mitglied_id` leer heisst: Wir wissen
 * nicht, wem der Kanal gehoert. Das ist der Normalfall, kein Fehler.
 *
 * **3. Die Rolle wird in die Nutzlast geschrieben, nicht spaeter gelesen.**
 * Sonst nimmt ein „nehmen" nach einer Umstellung die falsche Rolle weg — und
 * die alte bleibt fuer immer haengen.
 *
 * @param {number} streamerId Streamer
 * @param {string} aktion 'geben' | 'nehmen'
 * @param {number} [verzoegerungMs=0] Verzoegerung
 * @returns {Promise<number>} Anzahl geschriebener Auftraege
 */
async function rollenAuffaechern(streamerId, aktion, verzoegerungMs = 0) {
    const ziele = await db().query(
        'SELECT id, guild_id, mitglied_id FROM streaming_targets WHERE streamer_id = ? AND aktiv = 1 AND mitglied_id IS NOT NULL',
        [streamerId]);
    if (!ziele.length) return 0;

    // Die Rollen aller betroffenen Guilds in EINEM Zug - nicht je Ziel eine
    // Abfrage. Bei 200 Guilds waere das sonst der teuerste Teil des Laufs.
    const guilds = [...new Set(ziele.map(z => z.guild_id))];
    const rollen = new Map();
    for (const guildId of guilds) {
        const wert = await db().getConfig('streaming', 'LIVE_ROLLE_ID', 'shared', guildId);
        if (typeof wert === 'string' && wert.trim()) rollen.set(guildId, wert.trim());
    }

    let geschrieben = 0;

    // Ein Mitglied kann in derselben Guild mehrere Ziele haben (zwei Kanaele).
    // Die Rolle ist trotzdem eine - sonst schreiben wir zwei Auftraege, die
    // dasselbe tun, und der zweite meldet "hatte die Rolle schon".
    const gesehen = new Set();

    for (const ziel of ziele) {
        const rolleId = rollen.get(ziel.guild_id);
        if (!rolleId) continue;

        const schluessel = `${ziel.guild_id}/${ziel.mitglied_id}/${rolleId}`;
        if (gesehen.has(schluessel)) continue;
        gesehen.add(schluessel);

        await db().query(`
            INSERT INTO streaming_outbox (target_id, guild_id, aktion, nutzlast, faellig_ab)
            VALUES (?, ?, ?, ?, DATE_ADD(NOW(3), INTERVAL ? MICROSECOND))
        `, [ziel.id, ziel.guild_id, `rolle_${aktion}`,
            JSON.stringify({ streamer_id: streamerId, mitglied_id: ziel.mitglied_id, rolle_id: rolleId }),
            verzoegerungMs * 1000]);

        geschrieben++;
    }

    return geschrieben;
}

// =====================================================
// Die Laeufe
// =====================================================

/**
 * Posteingang abarbeiten.
 *
 * @returns {Promise<void>}
 */
async function posteingangLauf() {
    if (laeuftGerade) return;
    laeuftGerade = true;

    try {
        const offen = await db().query(
            "SELECT * FROM streaming_events WHERE zustand = 'neu' ORDER BY id ASC LIMIT 50");

        for (const zeile of offen) {
            try {
                const adapter = abos.ADAPTER[zeile.plattform];
                if (!adapter) throw new Error(`Kein Adapter fuer "${zeile.plattform}"`);

                const nutzlast = typeof zeile.nutzlast === 'string'
                    ? JSON.parse(zeile.nutzlast) : zeile.nutzlast;

                // Kein nachgebauter Kopfzeilen-Satz: Der Adapter liest den Typ
                // notfalls aus der Nutzlast. Der Kern kennt keine Kopfzeilen.
                const ereignis = adapter.uebersetzen({}, nutzlast);

                if (!ereignis) {
                    await db().query(
                        "UPDATE streaming_events SET zustand = 'fertig', verarbeitet_am = NOW(3), fehlertext = ? WHERE id = ?",
                        ['nicht uebersetzbar - Ereignisart wird nicht behandelt', zeile.id]);
                    continue;
                }

                const ergebnis = await verarbeiten(ereignis);

                await db().query(
                    "UPDATE streaming_events SET zustand = 'fertig', verarbeitet_am = NOW(3), fehlertext = ? WHERE id = ?",
                    [String(ergebnis).slice(0, 512), zeile.id]);

                log().info(`[Streaming] ${zeile.ereignis} verarbeitet: ${ergebnis}`);
            } catch (err) {
                // Ein kaputtes Ereignis darf den Lauf nicht anhalten - sonst
                // steht die ganze Warteschlange wegen einer Zeile.
                await db().query(
                    "UPDATE streaming_events SET zustand = 'fehler', versuche = versuche + 1, fehlertext = ?, verarbeitet_am = NOW(3) WHERE id = ?",
                    [String(err.message).slice(0, 512), zeile.id]);
                log().error(`[Streaming] Ereignis ${zeile.id} fehlgeschlagen:`, err);
            }
        }
    } catch (err) {
        log().error('[Streaming] Posteingang-Lauf fehlgeschlagen:', err);
    } finally {
        laeuftGerade = false;
    }
}

/**
 * Anreicherung: Titel, Kategorie, Zuschauer, Bild - in Stapeln.
 *
 * @returns {Promise<void>}
 */
async function anreicherungsLauf() {
    if (anreicherungLaeuft) return;
    anreicherungLaeuft = true;

    try {
        const offen = await db().query(`
            SELECT s.id, s.plattform, s.kanal_id, s.login
              FROM streaming_state z
              JOIN streaming_streamers s ON s.id = z.streamer_id
             WHERE z.ist_live = 1
               AND (z.angereichert_am IS NULL OR z.angereichert_am < DATE_SUB(NOW(), INTERVAL 5 MINUTE))
             LIMIT 100
        `);
        if (!offen.length) return;

        // Nach Plattform gruppieren: jeder Adapter holt seinen Stapel in EINEM
        // Zug. Eine Schleife je Kanal waere bei 200 Guilds sofort tot.
        const nachPlattform = new Map();
        for (const zeile of offen) {
            if (!nachPlattform.has(zeile.plattform)) nachPlattform.set(zeile.plattform, []);
            nachPlattform.get(zeile.plattform).push(zeile);
        }

        for (const [plattform, zeilen] of nachPlattform) {
            const adapter = abos.ADAPTER[plattform];
            if (!adapter) continue;

            const { angaben, vollstaendig } = await adapter.anreichern(zeilen.map(z => z.kanal_id));

            for (const zeile of zeilen) {
                const a = angaben.get(String(zeile.kanal_id));

                // **Fehlt die Angabe, weil der Stream vorbei ist - oder weil
                // die Abfrage scheiterte?** Der Unterschied entscheidet alles:
                // Beim Fehlschlag wuerden hier ALLE laufenden Streams auf
                // offline gesetzt und mitten in der Sendung zur Rueckschau
                // umgebaut. Im Zweifel nichts tun.
                if (!a && !vollstaendig) {
                    log().warn(`[Streaming] Anreicherung unvollstaendig - Zustand von ${zeile.login} bleibt unberuehrt`);
                    continue;
                }

                if (!a) {
                    // Nicht in `/streams` gefunden: Der Stream ist vorbei, und
                    // `stream.offline` ist verlorengegangen. Sonst stuende der
                    // Kanal fuer immer als live in der Liste - und beim
                    // naechsten echten Start kaeme keine Ankuendigung.
                    await db().query(
                        'UPDATE streaming_state SET ist_live = 0, beendet_am = COALESCE(beendet_am, NOW()), angereichert_am = NOW() WHERE streamer_id = ?',
                        [zeile.id]);
                    log().warn(`[Streaming] Kanal ${zeile.kanal_id} ist laut Plattform nicht live - Zustand zurueckgesetzt`);
                    continue;
                }

                await db().query(`
                    UPDATE streaming_state
                       SET titel = ?, kategorie = ?, zuschauer = ?, vorschaubild = ?,
                           begonnen_am = COALESCE(begonnen_am, ?), angereichert_am = NOW()
                     WHERE streamer_id = ?
                `, [a.titel, a.kategorie, a.zuschauer, a.vorschaubild, alsDatum(a.begonnen_am), zeile.id]);

                // Zweiter Weg, auf dem eine Umbenennung auffaellt: Die
                // Anreicherung liefert den aktuellen Namen ohnehin mit.
                if (a.login && a.login !== zeile.login) {
                    await db().query(
                        'UPDATE streaming_streamers SET login = ?, anzeigename = COALESCE(?, anzeigename), geprueft_am = NOW() WHERE id = ?',
                        [a.login, a.anzeigename, zeile.id]);
                    log().info(`[Streaming] Kanal ${zeile.kanal_id} heisst jetzt "${a.login}" (vorher "${zeile.login}")`);
                }

                // Jetzt sind Titel und Kategorie da - Ziele mit Filter koennen
                // erst hier entschieden werden.
                await nachtragen(zeile.id);
            }
        }
    } catch (err) {
        log().error('[Streaming] Anreicherung fehlgeschlagen:', err);
    } finally {
        anreicherungLaeuft = false;
    }
}

/**
 * Ziele bedienen, die auf die Anreicherung gewartet haben - und die
 * bestehenden Nachrichten nachziehen.
 *
 * @param {number} streamerId Streamer
 * @returns {Promise<void>}
 */
async function nachtragen(streamerId) {
    const ziele = await db().query(
        'SELECT * FROM streaming_targets WHERE streamer_id = ? AND aktiv = 1', [streamerId]);
    const zustandZeilen = await db().query('SELECT * FROM streaming_state WHERE streamer_id = ?', [streamerId]);
    const zustand = zustandZeilen[0] || {};
    if (!zustand.ist_live || !zustand.sendung_id) return;

    for (const ziel of ziele) {
        const schonGesendet = await db().query(
            'SELECT id FROM streaming_messages WHERE target_id = ? AND sendung_id = ? LIMIT 1',
            [ziel.id, zustand.sendung_id]);

        const passt = entscheidung.zielPasst(ziel, zustand);

        if (schonGesendet.length) {
            // Steht schon: Titel oder Kategorie koennten sich geaendert haben.
            await db().query(
                `INSERT INTO streaming_outbox (target_id, guild_id, aktion, nutzlast)
                 VALUES (?, ?, 'bearbeiten', ?)`,
                [ziel.id, ziel.guild_id, JSON.stringify({ streamer_id: streamerId })]);
        } else if (passt.passt) {
            // Hat gewartet und passt jetzt.
            await db().query(
                `INSERT INTO streaming_outbox (target_id, guild_id, aktion, nutzlast)
                 VALUES (?, ?, 'posten', ?)`,
                [ziel.id, ziel.guild_id, JSON.stringify({ streamer_id: streamerId })]);
            log().info(`[Streaming] Ziel ${ziel.id} nach Anreicherung nachgetragen`);
        }
    }
}

/**
 * Takt starten.
 *
 * @returns {void}
 */
function starten() {
    if (uhren.length) return;

    // `node-cron` kann keine Sekunden - deshalb setInterval mit
    // Ueberlappungsschutz, wie es der Aufraeumer im Musik-Plugin vormacht.
    uhren.push(setInterval(() => posteingangLauf().catch(() => {}), TAKT_MS));
    uhren.push(setInterval(() => anreicherungsLauf().catch(() => {}), ANREICHERN_MS));
    uhren.push(setInterval(() => tagesLauf().catch(() => {}), TAG_MS));
    uhren.forEach(u => u.unref?.());

    // **Einmal beim Start, aber nicht sofort.** Ein Abgleich in der ersten
    // Sekunde traefe auf ein Dashboard, das seine Verbindungen noch aufbaut -
    // und ein gescheiterter Abgleich sieht aus wie "alle Abos weg". Die
    // Verzoegerung ist kein Schoenheitsfehler, sie ist der Punkt.
    const ersterLauf = setTimeout(() => tagesLauf().catch(() => {}), START_VERZOEGERUNG_MS);
    ersterLauf.unref?.();
    uhren.push(ersterLauf);

    log().info(`[Streaming] Takt gestartet (Posteingang ${TAKT_MS / 1000} s, ` +
        `Anreicherung ${ANREICHERN_MS / 1000} s, Abgleich alle ${TAG_MS / 3600000} h)`);
}

/**
 * Der taegliche Lauf: erst abgleichen, dann aufraeumen.
 *
 * **Die Reihenfolge zaehlt.** Der Abgleich bestellt Abos ab, die niemand mehr
 * liest; erst danach darf der Aufraeumer Streamer loeschen, die weder Ziel noch
 * Abo haben. Andersherum verschwaende der Streamer mitsamt seiner Abo-Zeile -
 * und das Abo bei der Plattform lebte weiter, ohne dass noch jemand davon
 * weiss. Genau dieser Fall ist im Aufraeumer als zweite Bedingung vermerkt.
 *
 * @returns {Promise<void>}
 */
async function tagesLauf() {
    if (tagLaeuft) return;
    tagLaeuft = true;

    try {
        await require('./abgleich').lauf();
    } catch (err) {
        log().error('[Streaming] Abgleich fehlgeschlagen:', err);
    }

    try {
        await require('./aufraeumen').lauf();
    } catch (err) {
        log().error('[Streaming] Aufraeumen fehlgeschlagen:', err);
    }

    try {
        // Der Rollenabgleich zum Schluss: Er stuetzt sich auf `streaming_state`,
        // und das ist nach Abgleich und Aufraeumen am ehesten richtig.
        await require('../ausgabe/liverolle').lauf();
    } catch (err) {
        log().error('[Streaming] Rollenabgleich fehlgeschlagen:', err);
    } finally {
        tagLaeuft = false;
    }
}

/**
 * Takt anhalten.
 *
 * @returns {void}
 */
function anhalten() {
    uhren.forEach(u => clearInterval(u));
    uhren = [];
}

module.exports = { TAKT_MS, ANREICHERN_MS, TAG_MS, alsDatum, starten, anhalten, posteingangLauf, anreicherungsLauf, tagesLauf, rollenAuffaechern, verarbeiten };
