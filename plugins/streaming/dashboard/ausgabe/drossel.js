'use strict';

/**
 * Streaming - der Ausgang.
 *
 * Ein grosser Streamer geht live, 300 Guilds wollen im selben Augenblick
 * posten. Discord laesst **50 Anfragen je Sekunde je Bot-Token** zu und
 * **5 Nachrichten je 5 Sekunden je Kanal**. Beim Streamende kommt derselbe
 * Schwall ein zweites Mal, weil alle Nachrichten bearbeitet werden.
 *
 * Zwei Zahlen halten die Grenze ein:
 *
 *   - hoechstens 20 Auftraege je 500 ms = 40/s, unter den 50/s des Tokens
 *   - je Kanal hoechstens **einer** gleichzeitig - das haelt die Kanalgrenze,
 *     ohne sie nachzaehlen zu muessen
 *
 * Die Warteschlange ist eine **Tabelle**, kein Objekt im Speicher: Ein
 * Neustart mitten im Schwall darf keine Ankuendigung verschlucken.
 *
 * **Aufgeben ist eine Antwort, kein Verschwinden.** Ein Ziel, dessen Kanal
 * geloescht wurde, steht mit Grund auf der Zustandsseite. Stilles Fallenlassen
 * ist genau der Zustand, den die Marktanalyse als Marktluecke benennt.
 *
 * @module streaming/dashboard/ausgabe/drossel
 */

const { ServiceManager } = require('dunebot-core');
const nachricht = require('./nachricht');
const modelle = require('../../shared/models');
const { vorlageWaehlen, VORGABE_LIVE, VORGABE_RUECKSCHAU } = require('../../shared/vorlagen');
const { inhaltsStand } = require('../kern/entscheidung');
const { melden } = require('../../shared/signale');

const TAKT_MS = 500;
const JE_LAUF = 20;
const HOECHSTVERSUCHE = 5;

/**
 * Ab wann ein verspaeteter Auftrag ins Protokoll gehoert.
 *
 * Der Takt ist 500 ms; eine Minute Verzug ist also nicht Schwankung, sondern
 * Stillstand. Grosszuegig genug, dass ein kurzer Neustart nichts meldet.
 */
const VERZUG_WARNEN_MS = 60_000;

let laeuftGerade = false;
let uhr = null;

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
 * Auftrag an den Bot geben.
 *
 * Der Ereignisname ist der **Dateiname** des Handlers unter
 * `bot/events/ipc/` (`BotPlugin.js:183`) - deshalb `streaming:post` und nicht
 * `streaming:POST`.
 *
 * **Doppelte Huelle beachten:** Plugin-Ereignisse antworten
 * `{ success, data: { … } }`. Wer nur die aeussere Huelle liest, bekommt leere
 * Daten und haelt einen Fehler fuer einen Erfolg.
 *
 * @param {string} ereignis IPC-Ereignis
 * @param {Object} nutzlast Nutzlast
 * @returns {Promise<{ok: boolean, daten: Object, fehler: string|null, code: number|null}>} Ergebnis
 */
async function anDenBot(ereignis, nutzlast) {
    const ipcServer = ServiceManager.get('ipcServer');
    if (!ipcServer) return { ok: false, daten: {}, fehler: 'IPC nicht verfuegbar', code: null };

    const antwort = await ipcServer.broadcastOne(ereignis, nutzlast);
    const aeussere = Array.isArray(antwort) ? antwort[0] : antwort;

    if (!aeussere?.success) {
        return { ok: false, daten: {}, fehler: aeussere?.error || 'unbekannter Fehler', code: aeussere?.code ?? null };
    }

    const innere = aeussere.data || {};
    if (innere.success === false) {
        return { ok: false, daten: innere, fehler: innere.error || 'unbekannter Fehler', code: innere.code ?? null };
    }

    return { ok: true, daten: innere, fehler: null, code: null };
}

/**
 * Die Live-Rolle geben oder nehmen.
 *
 * @param {Object} auftrag Outbox-Zeile
 * @returns {Promise<{ok: boolean, fehler: string|null, endgueltig: boolean, hinweis?: string}>} Ergebnis
 */
async function rolleSetzen(auftrag) {
    const nutzlast = typeof auftrag.nutzlast === 'string'
        ? JSON.parse(auftrag.nutzlast) : (auftrag.nutzlast || {});

    const { mitglied_id: mitgliedId, rolle_id: rolleId } = nutzlast;
    const richtung = auftrag.aktion === 'rolle_geben' ? 'geben' : 'nehmen';

    // Ohne Mitglied oder Rolle ist der Auftrag nicht ausfuehrbar und wird es
    // auch nie - also endgueltig, statt fuenfmal zu wiederholen.
    if (!mitgliedId || !rolleId) {
        return { ok: false, fehler: 'Auftrag ohne Mitglied oder Rolle', endgueltig: true };
    }

    // Beim Geben wird noch einmal nachgesehen, ob die Person ueberhaupt (noch)
    // live ist. Zwischen Vormerken und Ausfuehren koennen Minuten liegen, und
    // eine Rolle "ist live" an jemandem, der nicht mehr sendet, ist genau die
    // Art Fehler, die niemand meldet.
    if (richtung === 'geben' && nutzlast.streamer_id) {
        const zeilen = await db().query(
            'SELECT ist_live FROM streaming_state WHERE streamer_id = ?', [nutzlast.streamer_id]);
        if (zeilen.length && !zeilen[0].ist_live) {
            return { ok: true, fehler: null, endgueltig: true, hinweis: 'nicht mehr live' };
        }
    }

    // Beim Nehmen umgekehrt: Kam die Person innerhalb der Karenz zurueck, darf
    // die Rolle bleiben.
    if (richtung === 'nehmen' && nutzlast.streamer_id) {
        const zeilen = await db().query(
            'SELECT ist_live FROM streaming_state WHERE streamer_id = ?', [nutzlast.streamer_id]);
        if (zeilen.length && zeilen[0].ist_live) {
            return { ok: true, fehler: null, endgueltig: true, hinweis: 'wieder live' };
        }
    }

    const antwort = await anDenBot('streaming:role', {
        guildId: auftrag.guild_id, userId: mitgliedId, roleId: rolleId, aktion: richtung
    });

    if (!antwort.ok) return { ok: false, fehler: antwort.fehler, endgueltig: istEndgueltig(antwort) };

    // **Buch fuehren, sonst nimmt der Abgleich spaeter Fremdes weg.**
    // Ohne diese beiden Zeilen weiss das Plugin nicht, welche Rolle es selbst
    // vergeben hat — und der taegliche Lauf raeumt dann bei jedem ab, der sie
    // aus einem anderen Grund traegt. Genau das ist am 2026-08-25 passiert.
    try {
        if (richtung === 'geben') {
            await db().query(`
                INSERT INTO streaming_role_grants (guild_id, mitglied_id, rolle_id)
                VALUES (?, ?, ?)
                ON DUPLICATE KEY UPDATE vergeben_am = vergeben_am
            `, [auftrag.guild_id, mitgliedId, rolleId]);
        } else {
            await db().query(
                'DELETE FROM streaming_role_grants WHERE guild_id = ? AND mitglied_id = ? AND rolle_id = ?',
                [auftrag.guild_id, mitgliedId, rolleId]);
        }
    } catch (err) {
        // Die Rolle ist gesetzt - das Buch ist zweitrangig. Aber es gehoert
        // gemeldet, denn ohne Eintrag holt der Abgleich sie nie zurueck.
        log().warn(`[Streaming] Rollenvergabe nicht notiert (${richtung}): ${err.message}`);
    }

    return {
        ok: true, fehler: null, endgueltig: false,
        hinweis: antwort.daten?.hinweis || (antwort.daten?.geaendert ? undefined : 'unveraendert')
    };
}

/**
 * Alles laden, was fuer eine Nachricht gebraucht wird.
 *
 * @param {Object} auftrag Outbox-Zeile
 * @returns {Promise<Object|null>} { ziel, streamer, zustand } oder null
 */
async function umfeldLaden(auftrag) {
    const zeilen = await db().query(`
        SELECT t.*, s.plattform, s.login, s.anzeigename, s.avatar_url, s.id AS streamer_id,
               z.titel, z.kategorie, z.zuschauer, z.vorschaubild, z.begonnen_am, z.beendet_am,
               z.sendung_id, z.ist_live
          FROM streaming_targets t
          JOIN streaming_streamers s ON s.id = t.streamer_id
          LEFT JOIN streaming_state z ON z.streamer_id = s.id
         WHERE t.id = ?
    `, [auftrag.target_id]);

    if (!zeilen.length) return null;
    const r = zeilen[0];

    // Welche Vorlage gilt, wird HIER entschieden und nicht im Nachrichtenbau:
    // eigener Text des Ziels, sonst der Standard der Guild, sonst die Vorgabe.
    // `nachricht.js` bleibt dadurch eine reine Funktion - sie bekommt einen
    // fertigen Text und fragt nichts nach.
    const guildVorlagen = await modelle.vorlagenLesen(r.guild_id);

    return {
        ziel: {
            id: r.id, guild_id: r.guild_id, channel_id: r.channel_id, rolle_id: r.rolle_id,
            onair_channel: r.onair_channel, eigenes_bild: r.eigenes_bild,
            aufraeumen: r.aufraeumen, veroeffentlichen: r.veroeffentlichen,
            vorlage: vorlageWaehlen(r.vorlage, guildVorlagen.live, VORGABE_LIVE),
            vorlage_rueckschau: vorlageWaehlen(null, guildVorlagen.rueckschau, VORGABE_RUECKSCHAU)
        },
        streamer: {
            id: r.streamer_id, plattform: r.plattform, login: r.login,
            anzeigename: r.anzeigename, avatar_url: r.avatar_url
        },
        zustand: {
            titel: r.titel, kategorie: r.kategorie, zuschauer: r.zuschauer,
            vorschaubild: r.vorschaubild, begonnen_am: r.begonnen_am,
            beendet_am: r.beendet_am, sendung_id: r.sendung_id, ist_live: r.ist_live
        }
    };
}

/**
 * Einen Auftrag ausfuehren.
 *
 * @param {Object} auftrag Outbox-Zeile
 * @returns {Promise<{ok: boolean, fehler: string|null, endgueltig: boolean}>} Ergebnis
 */
async function ausfuehren(auftrag) {
    // **Rollen zuerst, und bewusst OHNE `umfeldLaden`.** Die Nutzlast traegt
    // Mitglied und Rolle schon; sie braucht das Ziel nicht mehr. Das ist kein
    // Umweg, sondern der Punkt: Wird ein Ziel geloescht, waehrend jemand live
    // ist, muss die Rolle trotzdem noch abgenommen werden koennen. Liefe der
    // Auftrag ueber `umfeldLaden`, endete er mit "Ziel existiert nicht mehr" —
    // und die Rolle bliebe fuer immer haengen.
    if (auftrag.aktion === 'rolle_geben' || auftrag.aktion === 'rolle_nehmen') {
        return await rolleSetzen(auftrag);
    }

    const umfeld = await umfeldLaden(auftrag);
    if (!umfeld) return { ok: false, fehler: 'Ziel existiert nicht mehr', endgueltig: true };

    const { ziel, streamer, zustand } = umfeld;
    const sendungId = zustand.sendung_id || 'ohne';

    if (auftrag.aktion === 'posten') {
        const inhalt = nachricht.live({ streamer, zustand, ziel });

        // Platz reservieren, BEVOR gesendet wird: Der eindeutige Schluessel
        // (target_id, sendung_id) verhindert, dass zwei Laeufe dieselbe
        // Ankuendigung zweimal posten.
        try {
            await db().query(
                `INSERT INTO streaming_messages (target_id, sendung_id, channel_id, zustand)
                 VALUES (?, ?, ?, 'offen')`,
                [ziel.id, sendungId, ziel.channel_id]);
        } catch (e) {
            if (e.code === 'ER_DUP_ENTRY') {
                // Es gibt schon eine Zeile - aber das heisst NICHT, dass die
                // Nachricht steht. Scheiterte ein frueherer Versuch, blockierte
                // die reservierte Zeile jeden weiteren, und der Auftrag galt als
                // erledigt, obwohl nie etwas gesendet wurde. Stilles
                // Fallenlassen, genau das, was hier nie passieren soll.
                const vorhanden = await db().query(
                    'SELECT zustand FROM streaming_messages WHERE target_id = ? AND sendung_id = ?',
                    [ziel.id, sendungId]);

                if (vorhanden[0]?.zustand === 'steht') {
                    return { ok: true, fehler: null, endgueltig: true, hinweis: 'stand schon' };
                }
                // 'offen' oder 'fehler' -> erneut versuchen
                log().info(`[Streaming] Ziel ${ziel.id}: vorheriger Versuch offen (${vorhanden[0]?.zustand}) - neuer Anlauf`);
            } else {
                throw e;
            }
        }

        const antwort = await anDenBot('streaming:post', {
            guildId: ziel.guild_id, channelId: ziel.channel_id,
            veroeffentlichen: Boolean(ziel.veroeffentlichen), ...inhalt
        });

        if (!antwort.ok) {
            await db().query(
                "UPDATE streaming_messages SET zustand = 'fehler' WHERE target_id = ? AND sendung_id = ?",
                [ziel.id, sendungId]);
            return { ok: false, fehler: antwort.fehler, endgueltig: istEndgueltig(antwort) };
        }

        await db().query(
            `UPDATE streaming_messages SET message_id = ?, gesendet_am = NOW(), zustand = 'steht',
                    inhalt_stand = ?
              WHERE target_id = ? AND sendung_id = ?`,
            [antwort.daten.messageId, inhaltsStand(zustand), ziel.id, sendungId]);

        // Erst JETZT gilt die Sendung als gemeldet. Daran haengt die
        // Abklingzeit - und die darf nur zaehlen, was wirklich im Discord steht.
        await db().query(
            'UPDATE streaming_state SET zuletzt_gemeldet_am = NOW() WHERE streamer_id = ?',
            [streamer.id]);

        return { ok: true, fehler: null, endgueltig: false };
    }

    // -----------------------------------------------------------------
    // Die Probe: derselbe Weg, aber ohne Spuren.
    //
    // **Warum ueberhaupt ueber den Ausgang und nicht direkt gesendet?** Weil
    // eine Probe, die einen anderen Weg nimmt, nichts beweist. Hier laeuft
    // dieselbe Vorlagenaufloesung, derselbe Nachrichtenbau, dieselbe
    // IPC-Strecke, dieselbe Fehlerbehandlung. Was hier klappt, klappt im
    // Ernstfall - und was hier scheitert, scheitert dort genauso, nur um
    // 20:00 Uhr vor Publikum.
    //
    // Drei Unterschiede, alle bewusst:
    //
    //   1. **Kein Eintrag in `streaming_messages`.** Sonst hielte ein spaeterer
    //      echter Stream die Probe fuer seine Ankuendigung und wuerde sie
    //      bearbeiten oder aufraeumen.
    //   2. **Nie veroeffentlichen.** Ein Crosspost geht an alle folgenden
    //      Server hinaus und laesst sich nicht zurueckholen.
    //   3. **Standardmaessig ohne Erwaehnung.** Eine Probe, die eine Rolle
    //      anpingt, ist eine Probe, die man genau einmal macht. Wer den
    //      Ernstfall vollstaendig sehen will, setzt `mit_erwaehnung` - dann
    //      pingt sie, wie sie soll.
    // -----------------------------------------------------------------
    if (auftrag.aktion === 'probe') {
        const nutzlast = typeof auftrag.nutzlast === 'string'
            ? JSON.parse(auftrag.nutzlast) : (auftrag.nutzlast || {});

        // Die Erwaehnung wird durch Weglassen der Rollen-ID unterdrueckt, nicht
        // durch `allowed_mentions`: Der Bot setzt es heute nicht, und ein
        // Verhalten, das erst nach einem Bot-Neustart stimmt, ist schlimmer als
        // keins - es klappt beim Ausprobieren und pingt beim naechsten Mal.
        const probeZiel = nutzlast.mit_erwaehnung ? ziel : { ...ziel, rolle_id: null };

        // **Beide Vorlagen sind probierbar.** Die erste Fassung kannte nur die
        // Ankuendigung - also genau die Haelfte. Der Betreiber fragte, wie er
        // den Text nach dem Stream zu sehen bekommt, und die ehrliche Antwort
        // war: gar nicht. Die Rueckschau rechnet ihre Dauer aus dem
        // gespeicherten Zustand, ist also eine echte Vorschau und keine
        // erfundene.
        const rueckschau = nutzlast.art === 'rueckschau';
        const inhalt = rueckschau
            ? nachricht.rueckschau({ streamer, zustand, ziel: probeZiel })
            : nachricht.live({ streamer, zustand, ziel: probeZiel });

        const antwort = await anDenBot('streaming:post', {
            guildId: ziel.guild_id, channelId: ziel.channel_id,
            veroeffentlichen: false, ...inhalt
        });

        if (!antwort.ok) return { ok: false, fehler: antwort.fehler, endgueltig: istEndgueltig(antwort) };

        // Ehrlich sagen, wenn die Probe duenn aussieht: Ohne je gemessenen
        // Zustand sind Titel, Kategorie und Bild leer. Das ist kein Fehler,
        // aber es erklaert, warum die Probe anders aussieht als erwartet.
        const duenn = rueckschau
            ? (!zustand.begonnen_am || !zustand.beendet_am)
            : (!zustand.titel && !zustand.kategorie && !zustand.vorschaubild);

        const fehlt = rueckschau
            ? ' (noch kein beendeter Stream - die Dauer bleibt leer)'
            : ' (noch keine Streamdaten - Titel und Bild bleiben leer)';

        return {
            ok: true, fehler: null, endgueltig: false,
            hinweis: `Probe gesendet (${rueckschau ? 'Rueckschau' : 'Ankuendigung'})` + (duenn ? fehlt : '')
        };
    }

    // Bearbeiten und Aufraeumen brauchen eine stehende Nachricht.
    const gesendet = await db().query(
        "SELECT * FROM streaming_messages WHERE target_id = ? AND sendung_id = ? AND zustand = 'steht' LIMIT 1",
        [ziel.id, sendungId]);

    if (!gesendet.length) {
        return { ok: true, fehler: null, endgueltig: true, hinweis: 'keine stehende Nachricht' };
    }
    const zeile = gesendet[0];

    if (auftrag.aktion === 'bearbeiten') {
        const inhalt = nachricht.live({ streamer, zustand, ziel });
        const antwort = await anDenBot('streaming:edit', {
            guildId: ziel.guild_id, channelId: zeile.channel_id, messageId: zeile.message_id, ...inhalt
        });
        if (!antwort.ok) return { ok: false, fehler: antwort.fehler, endgueltig: istEndgueltig(antwort) };

        // Den gezeigten Stand mitschreiben - er entscheidet, ob spaeter
        // ueberhaupt noch einmal bearbeitet werden muss.
        await db().query(
            'UPDATE streaming_messages SET geaendert_am = NOW(), inhalt_stand = ? WHERE id = ?',
            [inhaltsStand(zustand), zeile.id]);
        return { ok: true, fehler: null, endgueltig: false };
    }

    if (auftrag.aktion === 'aufraeumen') {
        // Kam der Streamer innerhalb der Karenz zurueck, ist er wieder live -
        // dann waere Aufraeumen falsch.
        if (zustand.ist_live) return { ok: true, fehler: null, endgueltig: true, hinweis: 'wieder live' };

        if (ziel.aufraeumen === 'stehenlassen') {
            return { ok: true, fehler: null, endgueltig: true, hinweis: 'stehenlassen' };
        }

        if (ziel.aufraeumen === 'loeschen') {
            const antwort = await anDenBot('streaming:remove', {
                guildId: ziel.guild_id, channelId: zeile.channel_id, messageId: zeile.message_id
            });
            if (!antwort.ok && !istWeg(antwort)) {
                return { ok: false, fehler: antwort.fehler, endgueltig: istEndgueltig(antwort) };
            }

            await db().query("UPDATE streaming_messages SET zustand = 'weg' WHERE id = ?", [zeile.id]);
            return { ok: true, fehler: null, endgueltig: false };
        }

        // Vorgabe: zur Rueckschau umbauen
        const inhalt = nachricht.rueckschau({ streamer, zustand, ziel, vodUrl: null });
        const antwort = await anDenBot('streaming:edit', {
            guildId: ziel.guild_id, channelId: zeile.channel_id, messageId: zeile.message_id, ...inhalt
        });

        if (!antwort.ok) {
            // Eine geloeschte Nachricht ist beim AUFRAEUMEN kein Fehler,
            // sondern der Zielzustand: Jemand hat von Hand weggeraeumt, was wir
            // wegraeumen wollten. Das gehoert nicht unter "Was klemmt".
            if (istWeg(antwort)) {
                await db().query("UPDATE streaming_messages SET zustand = 'weg' WHERE id = ?", [zeile.id]);
                return { ok: true, fehler: null, endgueltig: true, hinweis: 'Nachricht war schon geloescht' };
            }
            return { ok: false, fehler: antwort.fehler, endgueltig: istEndgueltig(antwort) };
        }

        await db().query('UPDATE streaming_messages SET geaendert_am = NOW() WHERE id = ?', [zeile.id]);
        return { ok: true, fehler: null, endgueltig: false };
    }

    return { ok: false, fehler: `unbekannte Aktion "${auftrag.aktion}"`, endgueltig: true };
}

/**
 * Bedeutet der Fehler, dass Nachricht oder Kanal schlicht nicht mehr da sind?
 *
 * Beim Bearbeiten waehrend des Streams ist das ein Fehler. Beim **Aufraeumen**
 * ist es das Ziel - jemand hat von Hand weggeraeumt, was wir wegraeumen
 * wollten. Der Unterschied entscheidet, ob es unter "Was klemmt" auftaucht.
 *
 * @param {Object} antwort Antwort des Bots
 * @returns {boolean} true, wenn Nachricht oder Kanal fehlen
 */
function istWeg(antwort) {
    if (antwort.code === 10008 || antwort.code === 10003) return true;
    return /unknown message|unknown channel/i.test(String(antwort.fehler || ''));
}

/**
 * Ist der Fehler dauerhaft? Dann hilft kein zweiter Versuch.
 *
 * @param {Object} antwort Antwort des Bots
 * @returns {boolean} true bei dauerhaftem Fehler
 */
function istEndgueltig(antwort) {
    const text = String(antwort.fehler || '').toLowerCase();
    if (antwort.code === 50013 || antwort.code === 50001) return true;   // fehlende Rechte
    if (antwort.code === 10003 || antwort.code === 10008) return true;   // Kanal/Nachricht weg
    return /unknown channel|unknown message|missing (access|permissions)/.test(text);
}

/**
 * Ein Durchlauf.
 *
 * @returns {Promise<void>}
 */
async function lauf() {
    if (laeuftGerade) return;
    laeuftGerade = true;

    try {
        const faellig = await db().query(`
            SELECT * FROM streaming_outbox
             WHERE zustand = 'offen' AND faellig_ab <= NOW(3)
             ORDER BY id ASC LIMIT ?
        `, [JE_LAUF]);

        const belegteKanaele = new Set();

        for (const auftrag of faellig) {
            // **Verzug messen, nicht vermuten.**
            //
            // Am 2026-08-24 kam die Rueckschau eines echten Streams rund drei
            // Stunden zu spaet: Die Auftraege waren um 21:37 und 21:51 faellig,
            // die Nachrichten wurden erst um 00:26 und 01:18 umgebaut - bei
            // `zustand = fertig` und NULL Versuchen. Es gab also keinen
            // Fehlschlag, der wiederholt wurde, und in den Tabellen stand
            // hinterher nichts, woraus sich der Verzug haette ablesen lassen.
            //
            // Ein Auftrag, der lange nach seiner Faelligkeit ausgefuehrt wird,
            // ist kein Fehler im Sinne des Ausgangs - er wird ja erledigt. Er
            // ist aber genau das, was der Betreiber als "dauerte sehr sehr
            // lange" bemerkt. Deshalb steht er ab jetzt im Protokoll, mit
            // Auftragsnummer, damit sich der Fall beim naechsten Mal
            // zurueckverfolgen laesst statt rekonstruiert werden zu muessen.
            const verzugMs = Date.now() - new Date(auftrag.faellig_ab).getTime();
            if (verzugMs > VERZUG_WARNEN_MS) {
                log().warn(`[Streaming/Ausgang] Auftrag #${auftrag.id} (${auftrag.aktion}) laeuft ` +
                    `${Math.round(verzugMs / 1000)} s nach Faelligkeit — Ausgang stand oder war ueberlastet`);
            }

            const ziel = await db().query('SELECT channel_id FROM streaming_targets WHERE id = ?', [auftrag.target_id]);
            const kanal = ziel[0]?.channel_id;

            // Je Kanal hoechstens einer je Lauf - das haelt die Grenze von
            // 5 Nachrichten je 5 Sekunden ohne Nachzaehlen.
            if (kanal && belegteKanaele.has(kanal)) continue;
            if (kanal) belegteKanaele.add(kanal);

            try {
                const ergebnis = await ausfuehren(auftrag);

                if (ergebnis.ok) {
                    await db().query(
                        "UPDATE streaming_outbox SET zustand = 'fertig', erledigt_am = NOW(3), fehlertext = ? WHERE id = ?",
                        [ergebnis.hinweis || null, auftrag.id]);

                    // Die Zustandsseite zaehlt offene Auftraege mit - ohne
                    // diesen Anstupser bliebe die Zahl stehen, bis jemand neu
                    // laedt. Der Strom sammelt 300 ms, ein Schwall von zwanzig
                    // erledigten Auftraegen ergibt also einen Anstupser.
                    melden({ guildId: auftrag.guild_id, grund: 'auftrag_fertig' });
                    continue;
                }

                const versuche = auftrag.versuche + 1;
                const aufgeben = ergebnis.endgueltig || versuche >= HOECHSTVERSUCHE;

                await db().query(`
                    UPDATE streaming_outbox
                       SET versuche = ?, fehlertext = ?,
                           zustand = ?,
                           faellig_ab = DATE_ADD(NOW(3), INTERVAL ? SECOND)
                     WHERE id = ?
                `, [versuche, String(ergebnis.fehler).slice(0, 512),
                    aufgeben ? 'aufgegeben' : 'offen', Math.min(60, 2 ** versuche), auftrag.id]);

                // Auch das Aufgeben ist ein Ende - sonst steht bei den
                // gescheiterten Auftraegen fuer immer "nie ausgefuehrt".
                if (aufgeben) {
                    await db().query('UPDATE streaming_outbox SET erledigt_am = NOW(3) WHERE id = ?', [auftrag.id]);

                    // Aufgeben ist der Fall, bei dem Zusehen am meisten wert
                    // ist: Es ist genau das, was auf der Zustandsseite unter
                    // "was klemmt" erscheinen soll - und zwar sofort, nicht
                    // beim naechsten Neuladen.
                    melden({ guildId: auftrag.guild_id, grund: 'auftrag_aufgegeben' });
                }

                // Jeder Fehlversuch gehoert ins Log, nicht nur das Aufgeben:
                // Sonst steht am Ende "aufgegeben" da, und warum es fuenfmal
                // scheiterte, weiss niemand mehr.
                if (aufgeben) {
                    log().error(`[Streaming] Auftrag ${auftrag.id} (${auftrag.aktion}) aufgegeben nach ${versuche} Versuch(en): ${ergebnis.fehler}`);
                } else {
                    log().warn(`[Streaming] Auftrag ${auftrag.id} (${auftrag.aktion}) Versuch ${versuche} fehlgeschlagen: ${ergebnis.fehler}`);
                }
            } catch (err) {
                await db().query(
                    "UPDATE streaming_outbox SET versuche = versuche + 1, fehlertext = ?, zustand = IF(versuche + 1 >= ?, 'aufgegeben', 'offen') WHERE id = ?",
                    [String(err.message).slice(0, 512), HOECHSTVERSUCHE, auftrag.id]);
                log().error(`[Streaming] Auftrag ${auftrag.id} fehlgeschlagen:`, err);
            }
        }
    } catch (err) {
        log().error('[Streaming] Ausgang-Lauf fehlgeschlagen:', err);
    } finally {
        laeuftGerade = false;
    }
}

/**
 * @returns {void}
 */
function starten() {
    if (uhr) return;
    uhr = setInterval(() => lauf().catch(() => {}), TAKT_MS);
    uhr.unref?.();
    log().info(`[Streaming] Ausgang gestartet (${JE_LAUF} Auftraege je ${TAKT_MS} ms)`);
}

/**
 * @returns {void}
 */
function anhalten() {
    if (uhr) clearInterval(uhr);
    uhr = null;
}

module.exports = { TAKT_MS, JE_LAUF, HOECHSTVERSUCHE, starten, anhalten, lauf, ausfuehren, istEndgueltig, istWeg };
