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
const abonnenten = require('./abonnenten');
const entscheidung = require('./entscheidung');
const { melden } = require('../../shared/signale');
const abos = require('./abos');
const melder = require('./melder');

const TAKT_MS = 5_000;
const ANREICHERN_MS = 30_000;

/**
 * Wie lange eine frisch begonnene Sendung vor der Selbstheilung geschuetzt ist.
 *
 * Twitch meldet `stream.online` frueher, als der Stream in `/helix/streams`
 * auftaucht. Ohne diese Frist erklaerte der Anreicherungslauf eine gerade
 * begonnene Sendung fuer beendet - und zwar genau die, die man gerade
 * ankuendigen wollte.
 */
const SCHONFRIST_MS = 10 * 60 * 1000;

/**
 * Zeitzone, in der Ruhezeiten gelten, solange die Guild nichts anderes sagt.
 *
 * Ohne Vorgabe waere es die Zeitzone des Servers - und die kennt niemand, der
 * "23:00 bis 08:00" in ein Formular tippt. `dunemap` macht es genauso.
 */
const VORGABE_ZEITZONE = 'Europe/Berlin';

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
 * Abonnentenlisten auffrischen und Rollen abgleichen.
 *
 * **Nur fuer Kanaele, die es brauchen** — also solche, bei denen mindestens
 * eine Guild eine Abonnenten-Rolle vergibt. Alle anderen kosten hier nichts.
 *
 * Die Liste kommt vom Kanalinhaber, nicht von uns: `channel:read:subscriptions`
 * ist eine Auskunft ueber SEINEN Kanal. Fehlt seine Zusage oder ist sie
 * abgelaufen, wird der Kanal **uebersprungen** und NICHT als "keine
 * Abonnenten" gelesen — sonst naehme der Abgleich allen die Rolle weg.
 *
 * @returns {Promise<void>}
 */
async function abonnentenLauf() {
    const abonnenten = require('./abonnenten');
    const speicher = require('../../../../apps/dashboard/helpers/Verbindungsspeicher');
    const twitch = require('../plattformen/twitch');

    const streamer = await db().query(`
        SELECT DISTINCT s.* FROM streaming_streamers s
          JOIN streaming_targets t ON t.streamer_id = s.id
         WHERE t.aktiv = 1 AND t.abo_rolle_id IS NOT NULL AND t.abo_rolle_id <> ''
    `);

    for (const s of streamer) {
        const inhaber = await abonnenten.kanalInhaber(s);
        if (!inhaber) {
            log().warn(`[Streaming/Abos] ${s.login}: niemand hat den Kanal verknuepft - keine Abonnentenliste`);
            continue;
        }

        const ergebnis = await speicher.mitZugang({ userId: inhaber, plattform: s.plattform },
            async (zugang) => await twitch.abonnentenLesen(s.kanal_id, zugang));

        if (!ergebnis) {
            log().warn(`[Streaming/Abos] ${s.login}: keine Zusage des Kanalinhabers - uebersprungen`);
            continue;
        }
        if (!ergebnis.ok) {
            log().warn(`[Streaming/Abos] ${s.login}: Abonnentenliste nicht lesbar - uebersprungen, nichts geaendert`);
            continue;
        }

        // Erst die Liste auffrischen, dann urteilen. Andersherum urteilte man
        // ueber einen veralteten Stand.
        const kennungen = ergebnis.abonnenten.map(a => a.kontoId);
        for (const a of ergebnis.abonnenten) {
            await db().query(`
                INSERT INTO streaming_subscribers (streamer_id, konto_id, konto_name, stufe, geschenkt, gesehen_am)
                VALUES (?, ?, ?, ?, ?, NOW())
                ON DUPLICATE KEY UPDATE konto_name = VALUES(konto_name), stufe = VALUES(stufe),
                                        geschenkt = VALUES(geschenkt), gesehen_am = NOW()
            `, [s.id, a.kontoId, a.kontoName, a.stufe, a.geschenkt ? 1 : 0]);
        }

        // Wer nicht mehr in der Liste steht, hat aufgehoert. Das ist die
        // Stelle, an der ein verlorenes `subscription.end` doch noch wirkt.
        if (kennungen.length) {
            await db().query(
                `DELETE FROM streaming_subscribers
                  WHERE streamer_id = ? AND konto_id NOT IN (${kennungen.map(() => '?').join(',')})`,
                [s.id, ...kennungen]);
        } else {
            await db().query('DELETE FROM streaming_subscribers WHERE streamer_id = ?', [s.id]);
        }

        await abonnenten.abgleichen(s);
    }
}

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

    let ergebnis;
    switch (ereignis.art) {
        case 'ging_live':   ergebnis = await gingLive(streamer, zustand, ereignis); break;
        case 'beendet':     ergebnis = await beendet(streamer, zustand, ereignis); break;
        case 'geaendert':   ergebnis = await geaendert(streamer, zustand, ereignis); break;

        // Abonnements ruehren den Sendezustand NICHT an. Sie laufen deshalb
        // an `zustand` vorbei — ein Abonnement waehrend einer laufenden
        // Sendung darf die Ankuendigung nicht anfassen.
        case 'abonniert':   ergebnis = await abonnenten.aufnehmen(streamer, ereignis.abonnent); break;
        case 'abo_beendet': ergebnis = await abonnenten.entfernen(streamer, ereignis.abonnent); break;

        // **Reine Meldungen (Stufe 12c).** Raid, Geschenk-Abo, Bits, Follow.
        // Sie ruehren nichts an, was der Zustand kennt — deshalb laufen sie
        // wie die Abonnements an `zustand` vorbei.
        case 'melden':      ergebnis = await melder.melden(streamer, ereignis.melder); break;

        default:            return `Ereignisart "${ereignis.art}" wird nicht behandelt`;
    }

    // **Die Meldung kommt obendrauf, sie ersetzt nichts.** `channel.subscribe`
    // und `channel.subscription.message` tragen beides: die Rolle (`art`) und
    // eine Melde-Angabe. Wer daraus `art: 'melden'` gemacht haette, naehme dem
    // Abonnenten seine Rolle weg — deshalb laeuft die Meldung hier als
    // zweiter Schritt und nicht als anderer Zweig.
    //
    // Ein Fehlschlag hier darf die Rolle nicht mitreissen: Sie ist die
    // Hauptsache, die Nachricht die Zugabe.
    if ((ereignis.art === 'abonniert') && ereignis.melder) {
        try {
            const dazu = await melder.melden(streamer, ereignis.melder);
            ergebnis = `${ergebnis}; ${dazu}`;
        } catch (err) {
            log().warn(`[Streaming] Meldung zum Abonnement fehlgeschlagen: ${err.message}`);
        }
    }

    // Offene Zustandsseiten anstupsen. Bewusst **eine** Stelle statt drei in
    // den Handlern darunter: Wer den Melder je Zweig einbaut, vergisst ihn beim
    // vierten - und der fehlende Anstupser faellt nie auf, weil die Seite ja
    // aussieht wie immer. Nur die unbehandelte Ereignisart oben kommt hier
    // nicht vorbei, und die hat auch nichts geaendert.
    melden({ streamerId: streamer.id, grund: ereignis.art });

    return ergebnis;
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

    // Die Ruhezeit gilt in der Zeitzone der Guild. Einmal je Guild ermitteln,
    // nicht je Ziel - und nur, wenn ueberhaupt gepostet wird.
    const zonen = new Map();
    if (aktion === 'posten') {
        for (const guildId of new Set(ziele.map(z => z.guild_id))) {
            const zone = await db().getConfig('streaming', 'ZEITZONE', 'shared', guildId);
            zonen.set(guildId, entscheidung.minutenIn(
                typeof zone === 'string' && zone.trim() ? zone.trim() : VORGABE_ZEITZONE));
        }
    }

    for (const ziel of ziele) {
        // Beim Aufraeumen und Bearbeiten zaehlt der Filter nicht mehr: Was
        // gepostet wurde, muss auch aufgeraeumt werden - selbst wenn sich die
        // Kategorie zwischendurch geaendert hat. Dasselbe gilt fuer die
        // Ruhezeit: Eine Nachricht, die schon steht, wird auch nachts
        // aufgeraeumt - sonst bliebe sie bis zum Morgen falsch stehen.
        if (aktion === 'posten') {
            const passt = entscheidung.zielPasst(ziel, { ...zustand, minutenJetzt: zonen.get(ziel.guild_id) });
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

/**
 * Was nach einem Streamende zu tun ist - egal, woher wir davon wissen.
 *
 * Zwei Wege fuehren hierher: die Meldung `stream.offline` und die
 * Selbstheilung, die bei der Plattform nachfragt. Beide muessen dasselbe tun,
 * sonst raeumt der eine auf und der andere laesst eine Ankuendigung stehen,
 * die behauptet, jemand sende noch.
 *
 * @param {number} streamerId Streamer
 * @returns {Promise<number>} Anzahl vorgemerkter Auftraege
 */
async function nachStreamende(streamerId) {
    const karenzMs = einstellungen().karenzMinuten * 60_000;
    const auftraege = await auffaechern(streamerId, 'aufraeumen', karenzMs);
    const rollen = await rollenAuffaechern(streamerId, 'nehmen', karenzMs);
    return auftraege + rollen;
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
            SELECT s.id, s.plattform, s.kanal_id, s.login, z.begonnen_am
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
                    //
                    // **Aber nicht sofort.** Twitch schickt `stream.online`
                    // frueher, als `/helix/streams` den Stream kennt. Ein Lauf
                    // 30 Sekunden nach dem Start faende dort nichts und wuerde
                    // eine gerade begonnene Sendung fuer beendet erklaeren -
                    // Ankuendigung weg, Rolle weg, und beim naechsten Ereignis
                    // keine neue Meldung, weil der Zustand schon "offline" ist.
                    if (entscheidung.inSchonfrist(zeile.begonnen_am, Date.now(), SCHONFRIST_MS)) {
                        log().debug(`[Streaming] ${zeile.login} nicht in der Streamliste, aber gerade erst begonnen - Schonfrist`);
                        continue;
                    }

                    await db().query(
                        'UPDATE streaming_state SET ist_live = 0, beendet_am = COALESCE(beendet_am, NOW()), angereichert_am = NOW() WHERE streamer_id = ?',
                        [zeile.id]);

                    // **Und die Nachricht muss mit.** Bis zum 2026-08-25 heilte
                    // sich hier nur der Zustand: Die Ankuendigung im Discord
                    // blieb auf "ist jetzt live" stehen - fuer immer, weil das
                    // Aufraeumen nur am `stream.offline`-Ereignis hing, und das
                    // war ja gerade verlorengegangen. Aufgefallen ist es dem
                    // Betreiber beim Proben.
                    const nachbereitet = await nachStreamende(zeile.id);
                    log().warn(`[Streaming] ${zeile.login} ist laut Plattform nicht live - Zustand zurueckgesetzt, ${nachbereitet} Nachbereitung(en) vorgemerkt`);
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

    // Auch beim Nachtragen gilt die Ruhezeit - sonst kaeme die Meldung, die
    // um 3 Uhr unterdrueckt wurde, dreissig Sekunden spaeter doch.
    const zonen = new Map();
    for (const guildId of new Set(ziele.map(z => z.guild_id))) {
        const zone = await db().getConfig('streaming', 'ZEITZONE', 'shared', guildId);
        zonen.set(guildId, entscheidung.minutenIn(
            typeof zone === 'string' && zone.trim() ? zone.trim() : VORGABE_ZEITZONE));
    }
    if (!zustand.ist_live || !zustand.sendung_id) return;

    // Was zeigt die Nachricht jetzt? Einmal rechnen, nicht je Ziel.
    const stand = entscheidung.inhaltsStand(zustand);

    for (const ziel of ziele) {
        const schonGesendet = await db().query(
            'SELECT id, inhalt_stand FROM streaming_messages WHERE target_id = ? AND sendung_id = ? LIMIT 1',
            [ziel.id, zustand.sendung_id]);

        const passt = entscheidung.zielPasst(ziel, { ...zustand, minutenJetzt: zonen.get(ziel.guild_id) });

        if (schonGesendet.length) {
            // **Nur, wenn sich wirklich etwas geaendert hat.**
            //
            // Hier stand bis zum 2026-08-25 ein bedingungsloses Einreihen mit
            // der Begruendung "Titel oder Kategorie koennten sich geaendert
            // haben". Das `koennten` wurde nie geprueft - und weil dieser Lauf
            // alle fuenf Minuten je laufendem Streamer kommt, entstand eine
            // Discord-Bearbeitung alle fuenf Minuten, dauerhaft, ohne
            // Unterschied. In einer Nacht 32 Stueck fuer zwei Kanaele.
            //
            // Es faellt nicht auf, weil das Ergebnis richtig aussieht: Die
            // Nachricht stimmt ja. Es kostet nur Kontingent, das sich alle
            // Guilds teilen.
            //
            // Der Vergleich umfasst auch die Zuschauerzahl. Waehrend jemand
            // sendet, aendert sie sich - dann wird bearbeitet, und das ist
            // richtig so. Unterdrueckt wird nur, was sich in keinem Feld
            // unterscheidet.
            if (schonGesendet[0].inhalt_stand === stand) continue;

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
    }

    try {
        // **Abonnenten frisch von Twitch holen, dann Rollen abgleichen.**
        // Zwei Vorsichtsmassnahmen in einem Lauf: Ein verlorenes
        // `channel.subscription.end` liesse die Rolle sonst fuer immer stehen,
        // und wer sein Discord-Konto erst NACH dem Abonnieren verknuepft hat,
        // bekaeme sie ohne diesen Lauf nie.
        await abonnentenLauf();
    } catch (err) {
        log().error('[Streaming] Abonnenten-Abgleich fehlgeschlagen:', err);
    }

    try {
        // Und ganz zum Schluss: Ist etwas zu melden? Erst jetzt, weil der
        // Abgleich davor kaputte Abos vielleicht schon repariert hat - eine
        // Meldung ueber eine Stoerung, die es nicht mehr gibt, ist schlimmer
        // als keine.
        await require('../ausgabe/meldung').lauf();
    } catch (err) {
        log().error('[Streaming] Meldelauf fehlgeschlagen:', err);
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
