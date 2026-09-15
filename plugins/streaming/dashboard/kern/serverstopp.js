'use strict';

/**
 * Zusatz „Streamserver" - Lesen, Schreiben und der Ablauf (Baustelle 118).
 *
 * Bauplan: `docs/streamer-plugin/17-Streamserver.md`. Was entschieden wird, steht
 * in `./serverstoppEntscheidung.js`; hier wird nur zusammengesetzt.
 *
 * ── Der Ablauf ──────────────────────────────────────────────────────────────
 *
 *   Streamende        vormerken()        Auftrag `serverstopp`, faellig nach
 *                                        dem Nachlauf; im Modus `stoppen` dazu
 *                                        ein `serverhinweis` „wird gestoppt"
 *   Stream beginnt    beiStreambeginn()  wartende Auftraege abbrechen, im Modus
 *                                        `stoppen` Hinweis „abgebrochen"
 *   faellig           ausfuehren()       neu entscheiden, dann stoppen, nur
 *                                        vermerken oder abbrechen
 *
 * **Zwei Stellen rufen `vormerken`**, und das ist Absicht: `beendet()` (die
 * Meldung `stream.offline`) und `nachStreamende()` (die Selbstheilung). Die
 * erste ruft die zweite nicht. Laufen beide fuer dasselbe Streamende, verhindert
 * die Pruefung auf einen schon wartenden Auftrag den zweiten.
 *
 * **Gestoppt wird ueber den Anbieter** in `ServersteuerungRegistry` - kein
 * `require` ins Gameserver-Plugin. Das SDK wird erst beim Gebrauch geladen, damit
 * die Pruefskripte des Ausgangs dieses Modul ohne Dashboard laden koennen.
 *
 * @module streaming/kern/serverstopp
 */

const { ServiceManager } = require('dunebot-core');
const entscheidung = require('./serverstoppEntscheidung');

/** Name des Anbieters in `ServersteuerungRegistry`. */
const ANBIETER = 'gameserver';

/** @returns {Object} Datenbankdienst */
const db = () => ServiceManager.get('dbService');

/** @returns {Object} Logger */
const log = () => ServiceManager.get('Logger');

/** @returns {Object|null} Der eingetragene Anbieter */
function anbieter() {
    return require('dunebot-sdk').ServersteuerungRegistry.get(ANBIETER);
}

/** @param {*} nutzlast @returns {Object} */
const lies = (nutzlast) => {
    if (!nutzlast) return {};
    if (typeof nutzlast === 'object') return nutzlast;
    try { return JSON.parse(nutzlast); } catch { return {}; }
};

// =====================================================
// Lesen und Schreiben
// =====================================================

/**
 * Wer auswaehlbar ist: Streamer mit einem Ziel in dieser Guild, an dem ein
 * Mitglied haengt (Entscheidung des Betreibers, 2026-09-15). Keine Uebernahme
 * aus `user_connections` - die Guild-Datengrenze.
 *
 * @param {string} guildId Guild
 * @returns {Promise<{mit: Array<Object>, ohne: Array<Object>}>}
 */
async function kandidaten(guildId) {
    const zeilen = await db().query(`
        SELECT t.id AS ziel_id, t.mitglied_id, s.id AS streamer_id, s.login, s.anzeigename
          FROM streaming_targets t
          JOIN streaming_streamers s ON s.id = t.streamer_id
         WHERE t.guild_id = ?
         ORDER BY s.login ASC, t.id ASC
    `, [guildId]);

    const je = new Map();
    for (const z of zeilen || []) {
        const bisher = je.get(z.streamer_id) || {
            streamer_id: Number(z.streamer_id), login: z.login, anzeigename: z.anzeigename, mitMitglied: false
        };
        if (z.mitglied_id) bisher.mitMitglied = true;
        je.set(z.streamer_id, bisher);
    }

    const alle = [...je.values()];
    return { mit: alle.filter(k => k.mitMitglied), ohne: alle.filter(k => !k.mitMitglied) };
}

/**
 * Die Einstellungen dieser Guild, nach Server.
 *
 * @param {string} guildId Guild
 * @returns {Promise<Object<string, {aktiv: number, modus: string, nachlauf_min: number, streamer_ids: number[], geaendert_am: *}>>}
 */
async function einstellungen(guildId) {
    const [zeilen, auswahl] = await Promise.all([
        db().query(
            'SELECT server_id, aktiv, modus, nachlauf_min, geaendert_am FROM streaming_serverstopp WHERE guild_id = ?',
            [guildId]),
        db().query(
            'SELECT server_id, streamer_id FROM streaming_serverstopp_streamer WHERE guild_id = ?',
            [guildId])
    ]);

    const ergebnis = {};
    for (const z of zeilen || []) {
        ergebnis[z.server_id] = {
            aktiv: Number(z.aktiv), modus: z.modus, nachlauf_min: Number(z.nachlauf_min),
            streamer_ids: [], geaendert_am: z.geaendert_am
        };
    }
    for (const a of auswahl || []) {
        if (ergebnis[a.server_id]) ergebnis[a.server_id].streamer_ids.push(Number(a.streamer_id));
    }
    return ergebnis;
}

/**
 * Eine Einstellung schreiben - mitsamt Auswahl.
 *
 * @param {string} guildId Guild
 * @param {number} serverId Server beim Anbieter
 * @param {{aktiv: boolean, modus: string, nachlaufMin: number, streamerIds: number[]}} werte Geprueft
 * @param {string|null} userId Wer speichert
 * @returns {Promise<void>}
 */
async function speichern(guildId, serverId, werte, userId) {
    await db().query(`
        INSERT INTO streaming_serverstopp (guild_id, server_id, aktiv, modus, nachlauf_min, geaendert_von)
        VALUES (?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
            aktiv = VALUES(aktiv), modus = VALUES(modus),
            nachlauf_min = VALUES(nachlauf_min), geaendert_von = VALUES(geaendert_von)
    `, [guildId, serverId, werte.aktiv ? 1 : 0, werte.modus, werte.nachlaufMin, userId || null]);

    await db().query(
        'DELETE FROM streaming_serverstopp_streamer WHERE guild_id = ? AND server_id = ?',
        [guildId, serverId]);

    for (const streamerId of werte.streamerIds) {
        await db().query(
            'INSERT INTO streaming_serverstopp_streamer (guild_id, server_id, streamer_id) VALUES (?, ?, ?)',
            [guildId, serverId, streamerId]);
    }
}

/**
 * Die letzten Entscheidungen dieser Guild - das ist die Testphase.
 *
 * @param {string} guildId Guild
 * @param {number} [anzahl] Wie viele
 * @returns {Promise<Array<Object>>}
 */
async function letzteEntscheidungen(guildId, anzahl = 20) {
    const zeilen = await db().query(`
        SELECT id, zustand, versuche, fehlertext, nutzlast, faellig_ab, erledigt_am
          FROM streaming_outbox
         WHERE guild_id = ? AND aktion = 'serverstopp'
         ORDER BY id DESC
         LIMIT ?
    `, [guildId, anzahl]);
    return (zeilen || []).map(z => ({ ...z, nutzlast: lies(z.nutzlast) }));
}

/**
 * Wie viele der ausgewaehlten Streamer sind gerade live?
 *
 * @param {string} guildId Guild
 * @param {number} serverId Server
 * @returns {Promise<number>}
 */
async function liveInAuswahl(guildId, serverId) {
    const zeilen = await db().query(`
        SELECT COUNT(*) AS anzahl
          FROM streaming_serverstopp_streamer w
          JOIN streaming_state z ON z.streamer_id = w.streamer_id
         WHERE w.guild_id = ? AND w.server_id = ? AND z.ist_live = 1
    `, [guildId, serverId]);
    return Number(zeilen?.[0]?.anzahl || 0);
}

/**
 * Einen Hinweis in den Ankuendigungskanal vormerken. Er laeuft ueber das Ziel,
 * damit die Kanalgrenze des Ausgangs (eine Nachricht je Kanal je Lauf) greift.
 *
 * @param {number} zielId Ziel, dessen Kanal die Nachricht bekommt
 * @param {string} guildId Guild
 * @param {Object} nutzlast Nutzlast fuer `hinweisText`
 * @returns {Promise<void>}
 */
async function hinweisVormerken(zielId, guildId, nutzlast) {
    await db().query(`
        INSERT INTO streaming_outbox (target_id, guild_id, aktion, nutzlast)
        VALUES (?, ?, 'serverhinweis', ?)
    `, [zielId, guildId, JSON.stringify(nutzlast)]);
}

// =====================================================
// Der Ablauf
// =====================================================

/**
 * Nach einem Streamende: fuer jede Einstellung, in deren Auswahl dieser Streamer
 * steht, einen Stopp vormerken - wenn niemand aus der Auswahl mehr live ist.
 *
 * @param {number} streamerId Streamer, dessen Stream endete
 * @returns {Promise<number>} Anzahl vorgemerkter Stopps
 */
async function vormerken(streamerId) {
    const betroffen = await db().query(`
        SELECT a.guild_id, a.server_id, a.aktiv, a.modus, a.nachlauf_min
          FROM streaming_serverstopp_streamer w
          JOIN streaming_serverstopp a ON a.guild_id = w.guild_id AND a.server_id = w.server_id
         WHERE w.streamer_id = ?
    `, [streamerId]);

    let vorgemerkt = 0;

    for (const e of betroffen || []) {
        const live = await liveInAuswahl(e.guild_id, e.server_id);
        const wahl = entscheidung.beimStreamende(e, live);
        if (!wahl.vormerken) continue;

        // Laufen `beendet()` und die Selbstheilung fuer dasselbe Ende, wartet
        // der erste Auftrag schon.
        const wartend = await db().query(`
            SELECT id FROM streaming_outbox
             WHERE aktion = 'serverstopp' AND zustand = 'offen' AND guild_id = ?
               AND JSON_VALUE(nutzlast, '$.server_id') = ?
             LIMIT 1
        `, [e.guild_id, String(e.server_id)]);
        if (wartend && wartend.length) continue;

        const a = anbieter();
        const server = a ? await a.zustand(e.guild_id, e.server_id).catch(() => null) : null;
        const serverName = server?.name || `Server ${e.server_id}`;

        const ziele = await db().query(
            'SELECT t.id, s.login FROM streaming_targets t JOIN streaming_streamers s ON s.id = t.streamer_id WHERE t.streamer_id = ? AND t.guild_id = ? AND t.aktiv = 1 ORDER BY t.id ASC LIMIT 1',
            [streamerId, e.guild_id]);
        const hinweisZiel = ziele?.[0]?.id || null;

        const nachlaufMin = Number(e.nachlauf_min) || entscheidung.NACHLAUF_VORGABE;
        const angekuendigt = e.modus === 'stoppen' && Boolean(hinweisZiel);

        await db().query(`
            INSERT INTO streaming_outbox (target_id, guild_id, aktion, nutzlast, faellig_ab)
            VALUES (NULL, ?, 'serverstopp', ?, DATE_ADD(NOW(3), INTERVAL ? MINUTE))
        `, [e.guild_id, JSON.stringify({
            server_id: Number(e.server_id), server_name: serverName, streamer_id: Number(streamerId),
            login: ziele?.[0]?.login || null, hinweis_ziel: hinweisZiel, nachlauf_min: nachlaufMin, angekuendigt
        }), nachlaufMin]);

        if (angekuendigt) {
            await hinweisVormerken(hinweisZiel, e.guild_id, {
                art: 'angekuendigt', server_name: serverName, nachlauf_min: nachlaufMin
            });
        }

        log().info(`[Streaming/Streamserver] ${serverName} (Guild ${e.guild_id}): Stopp in ${nachlaufMin} min vorgemerkt, Modus ${e.modus}`);
        vorgemerkt++;
    }

    return vorgemerkt;
}

/**
 * Ein ausgewaehlter Streamer ist wieder live: wartende Stopps abbrechen.
 *
 * Die Entscheidung beim Faelligwerden faende ihn ohnehin live. Der Abbruch steht
 * hier trotzdem, damit die Ankuendigung „wird gestoppt" nicht bis zum Ablauf des
 * Nachlaufs falsch im Kanal steht.
 *
 * @param {number} streamerId Streamer, der live ging
 * @returns {Promise<number>} Anzahl abgebrochener Stopps
 */
async function beiStreambeginn(streamerId) {
    const wartend = await db().query(
        "SELECT id, guild_id, nutzlast FROM streaming_outbox WHERE aktion = 'serverstopp' AND zustand = 'offen'");

    let abgebrochen = 0;

    for (const auftrag of wartend || []) {
        const n = lies(auftrag.nutzlast);
        const gehoert = await db().query(
            'SELECT 1 AS da FROM streaming_serverstopp_streamer WHERE guild_id = ? AND server_id = ? AND streamer_id = ? LIMIT 1',
            [auftrag.guild_id, n.server_id, streamerId]);
        if (!gehoert || !gehoert.length) continue;

        const login = (await db().query('SELECT login FROM streaming_streamers WHERE id = ?', [streamerId]))?.[0]?.login || null;

        await db().query(`
            UPDATE streaming_outbox
               SET zustand = 'fertig', erledigt_am = NOW(3), fehlertext = ?
             WHERE id = ? AND zustand = 'offen'
        `, [`Abgebrochen: ${login || 'ein ausgewählter Streamer'} ist wieder live`, auftrag.id]);

        if (n.angekuendigt && n.hinweis_ziel) {
            await hinweisVormerken(n.hinweis_ziel, auftrag.guild_id, {
                art: 'abgebrochen', server_name: n.server_name, grund: 'wieder_live', login
            });
        }

        log().info(`[Streaming/Streamserver] ${n.server_name}: Stopp abgebrochen, ${login} ist wieder live`);
        abgebrochen++;
    }

    return abgebrochen;
}

/**
 * Einen faelligen Stopp ausfuehren - fuer den Ausgang (`ausgabe/drossel.js`).
 *
 * Neu entschieden wird hier und nicht beim Vormerken: Zwischen beidem liegt der
 * Nachlauf, und in dieser Zeit kann jemand live gehen, der Server leer werden
 * oder der Betreiber den Zusatz ausschalten.
 *
 * @param {Object} auftrag Zeile aus streaming_outbox
 * @returns {Promise<{ok: boolean, fehler: string|null, endgueltig: boolean, hinweis?: string}>}
 */
async function ausfuehren(auftrag) {
    const n = lies(auftrag.nutzlast);
    const guildId = auftrag.guild_id;
    const serverId = Number(n.server_id);

    const a = anbieter();
    const einstellungZeilen = await db().query(
        'SELECT aktiv, modus FROM streaming_serverstopp WHERE guild_id = ? AND server_id = ?',
        [guildId, serverId]);
    const live = await liveInAuswahl(guildId, serverId);
    const server = a ? await a.zustand(guildId, serverId) : null;

    const wahl = entscheidung.beimFaelligwerden({
        anbieterDa: Boolean(a), einstellung: einstellungZeilen?.[0] || null, liveInAuswahl: live, server
    });
    const name = server?.name || n.server_name || `Server ${serverId}`;

    if (wahl.handlung === 'stoppen') {
        const ergebnis = await a.stoppen(guildId, serverId, {
            grund: 'Streaming: der letzte ausgewählte Streamer ist offline'
        });
        if (!ergebnis.ok) {
            // Nicht endgueltig: Der Ausgang versucht es erneut und entscheidet
            // dabei jedes Mal neu (Daemon kurz weg, jemand kommt zurueck ...).
            return { ok: false, fehler: `Stopp gescheitert: ${ergebnis.grund || 'ohne Angabe'}`, endgueltig: false };
        }
        if (n.angekuendigt && n.hinweis_ziel) {
            await hinweisVormerken(n.hinweis_ziel, guildId, { art: 'gestoppt', server_name: name });
        }
        log().info(`[Streaming/Streamserver] ${name} (Guild ${guildId}): gestoppt${ergebnis.eingereiht ? ', beim Daemon eingereiht' : ''}`);
        return { ok: true, fehler: null, endgueltig: true, hinweis: `Gestoppt: ${entscheidung.grundKlartext(wahl.grund)}` };
    }

    if (wahl.handlung === 'wuerde_stoppen') {
        log().info(`[Streaming/Streamserver] ${name} (Guild ${guildId}): würde jetzt stoppen (Modus melden)`);
        return { ok: true, fehler: null, endgueltig: true, hinweis: `Würde stoppen (Testphase): ${entscheidung.grundKlartext(wahl.grund)}` };
    }

    if (n.angekuendigt && n.hinweis_ziel) {
        await hinweisVormerken(n.hinweis_ziel, guildId, { art: 'abgebrochen', server_name: name, grund: wahl.grund });
    }
    log().info(`[Streaming/Streamserver] ${name} (Guild ${guildId}): nicht gestoppt — ${entscheidung.grundKlartext(wahl.grund)}`);
    return { ok: true, fehler: null, endgueltig: true, hinweis: `Abgebrochen: ${entscheidung.grundKlartext(wahl.grund)}` };
}

module.exports = {
    ANBIETER, anbieter,
    kandidaten, einstellungen, speichern, letzteEntscheidungen,
    vormerken, beiStreambeginn, ausfuehren
};
