'use strict';

/**
 * Streaming - Datenzugriff.
 *
 * Eine Stelle fuer alle Abfragen, damit die Router nichts ueber das Schema
 * wissen muessen.
 *
 * Zwei Regeln, die hier zwingend gelten:
 *
 *   1. `dbService.query()` liefert die Zeilen **direkt** zurueck, nicht
 *      `[rows, fields]`. Ein `const [x] = await query(...)` ist deshalb die
 *      erste ZEILE - und bei INSERT ein Absturz, weil das ResultSetHeader
 *      kein Array ist. Genau dieser Fehler steht dreimal im Stripe-Webhook
 *      (Baustelle 63a).
 *
 *   2. Globale Konfiguration wird mit `guildId = ''` geschrieben, nie mit
 *      `null`. Der eindeutige Schluessel der Tabelle `configs` schliesst
 *      `guild_id` ein, und in MySQL ist NULL nie gleich NULL - mit `null`
 *      greift `ON DUPLICATE KEY UPDATE` nicht und jedes Speichern legt eine
 *      neue Zeile an (Baustelle 63f).
 *
 * @module streaming/shared/models
 */

const { ServiceManager } = require('dunebot-core');

const { VORGABE_LIVE, VORGABE_RUECKSCHAU, vorlageWaehlen } = require('./vorlagen');

const PLUGIN = 'streaming';

/** @returns {Object} Datenbankdienst */
function db() {
    return ServiceManager.get('dbService');
}

// =====================================================
// Streamer und Ziele
// =====================================================

/**
 * Alle Kanaele, die diese Guild beobachtet - mit Zustand und Anzahl Ziele.
 *
 * @param {string} guildId Discord-Guild-ID
 * @returns {Promise<Array>} Zeilen
 */
async function streamerDerGuild(guildId) {
    return await db().query(`
        SELECT  s.id, s.plattform, s.login, s.anzeigename, s.avatar_url,
                z.ist_live, z.titel, z.kategorie, z.begonnen_am,
                COUNT(t.id)            AS ziele,
                MIN(t.id)              AS erstes_ziel,
                MAX(a.letzte_meldung_am) AS letzte_meldung_am,
                MIN(a.zustand)         AS abo_zustand
        FROM streaming_targets  t
        JOIN streaming_streamers s ON s.id = t.streamer_id
        LEFT JOIN streaming_state z ON z.streamer_id = s.id
        LEFT JOIN streaming_subscriptions a ON a.streamer_id = s.id
        WHERE t.guild_id = ?
        GROUP BY s.id, z.ist_live, z.titel, z.kategorie, z.begonnen_am
        ORDER BY z.ist_live DESC, s.login ASC
    `, [guildId]);
}

/**
 * Alle Ziele dieser Guild, mit dem Kanal dahinter.
 *
 * @param {string} guildId Discord-Guild-ID
 * @returns {Promise<Array>} Zeilen
 */
async function zieleDerGuild(guildId) {
    return await db().query(`
        SELECT  t.*, s.plattform, s.login, s.anzeigename
        FROM streaming_targets t
        JOIN streaming_streamers s ON s.id = t.streamer_id
        WHERE t.guild_id = ?
        ORDER BY s.login ASC, t.channel_id ASC
    `, [guildId]);
}

/**
 * Zaehlt die Kanaele, die diese Guild beobachtet - fuer die Mengengrenze.
 *
 * Gezaehlt werden **eigene** Ziele, nicht Abos: Ein Kanal, den zehn andere
 * Guilds schon beobachten, kostet uns nichts extra.
 *
 * @param {string} guildId Discord-Guild-ID
 * @returns {Promise<number>} Anzahl
 */
async function anzahlStreamer(guildId) {
    const zeilen = await db().query(
        'SELECT COUNT(DISTINCT streamer_id) AS anzahl FROM streaming_targets WHERE guild_id = ?',
        [guildId]
    );
    return Number(zeilen[0]?.anzahl || 0);
}

/**
 * Alle beobachteten Kanaele ueber ALLE Guilds - fuer die Betriebsseite.
 *
 * Bewusst getrennt von `streamerDerGuild`: Die eine Abfrage beantwortet „was
 * beobachtet dieser Server", die andere „was haelt diese Anlage". Wer beides
 * in eine Funktion mit Schalter presst, verwechselt sie irgendwann - und dann
 * sieht eine Guild die Kanaele aller anderen.
 *
 * @returns {Promise<Array>} Zeilen mit Anzahl Guilds und Abos
 */
async function alleStreamer() {
    return await db().query(`
        SELECT  s.id, s.plattform, s.login, s.anzeigename, s.angelegt_am,
                z.ist_live,
                COUNT(DISTINCT t.guild_id) AS guilds,
                COUNT(DISTINCT a.id)       AS abos,
                MAX(a.letzte_meldung_am)   AS letzte_meldung_am
        FROM streaming_streamers s
        LEFT JOIN streaming_targets       t ON t.streamer_id = s.id
        LEFT JOIN streaming_subscriptions a ON a.streamer_id = s.id
        LEFT JOIN streaming_state         z ON z.streamer_id = s.id
        GROUP BY s.id, z.ist_live
        ORDER BY s.login ASC
    `);
}

// =====================================================
// Betriebszustand
// =====================================================

/**
 * Die Zahlen fuer die Zustandsseite einer Guild.
 *
 * Bewusst ohne Ampel-Logik: Die Bewertung gehoert nicht in die Abfrage,
 * sondern an eine Stelle, die man ohne Datenbank durchspielen kann.
 *
 * @param {string} guildId Discord-Guild-ID
 * @returns {Promise<Object>} { ueberwacht, live, letzteMeldungAm, offeneAuftraege, gescheitert, kaputteAbos }
 */
async function zustandDerGuild(guildId) {
    const [ueberblick] = await db().query(`
        SELECT  COUNT(DISTINCT t.streamer_id)                      AS ueberwacht,
                SUM(CASE WHEN z.ist_live = 1 THEN 1 ELSE 0 END)    AS live,
                MAX(a.letzte_meldung_am)                           AS letzte_meldung_am
        FROM streaming_targets t
        LEFT JOIN streaming_state z ON z.streamer_id = t.streamer_id
        LEFT JOIN streaming_subscriptions a ON a.streamer_id = t.streamer_id
        WHERE t.guild_id = ?
    `, [guildId]);

    const [auftraege] = await db().query(`
        SELECT  SUM(CASE WHEN zustand = 'offen'      THEN 1 ELSE 0 END) AS offen,
                SUM(CASE WHEN zustand = 'aufgegeben' THEN 1 ELSE 0 END) AS aufgegeben
        FROM streaming_outbox
        WHERE guild_id = ?
    `, [guildId]);

    const kaputteAbos = await db().query(`
        SELECT DISTINCT s.login, a.zustand, a.fehlertext
        FROM streaming_targets t
        JOIN streaming_streamers s ON s.id = t.streamer_id
        JOIN streaming_subscriptions a ON a.streamer_id = t.streamer_id
        WHERE t.guild_id = ? AND a.zustand IN ('widerrufen', 'fehler')
    `, [guildId]);

    return {
        ueberwacht:      Number(ueberblick?.ueberwacht || 0),
        live:            Number(ueberblick?.live || 0),
        letzteMeldungAm: ueberblick?.letzte_meldung_am || null,
        offeneAuftraege: Number(auftraege?.offen || 0),
        gescheitert:     Number(auftraege?.aufgegeben || 0),
        kaputteAbos
    };
}

/**
 * Wie puenktlich lief der Ausgang zuletzt?
 *
 * Die Frage, die sich nach einer verspaeteten Rueckschau als Erstes stellt -
 * und die bis zum 2026-08-25 niemand beantworten konnte, weil der Ausgang zwar
 * `fertig` vermerkte, aber nicht wann.
 *
 * @param {number} [stunden=48] Zeitraum
 * @returns {Promise<{auftraege: number, schlimmsterVerzugS: number|null, mittlererVerzugS: number|null, spaete: Array}>} Zahlen
 */
async function verzugStatistik(stunden = 48) {
    const zeilen = await db().query(`
        SELECT id, aktion, guild_id, faellig_ab, erledigt_am,
               TIMESTAMPDIFF(SECOND, faellig_ab, erledigt_am) AS verzug_s
          FROM streaming_outbox
         WHERE erledigt_am IS NOT NULL
           AND erledigt_am >= DATE_SUB(NOW(), INTERVAL ? HOUR)
    `, [stunden]);

    if (!zeilen.length) {
        return { auftraege: 0, schlimmsterVerzugS: null, mittlererVerzugS: null, spaete: [] };
    }

    const werte = zeilen.map(z => Math.max(0, Number(z.verzug_s || 0)));
    return {
        auftraege: zeilen.length,
        schlimmsterVerzugS: Math.max(...werte),
        mittlererVerzugS: Math.round(werte.reduce((a, b) => a + b, 0) / werte.length),
        // Nur die auffaelligen zeigen - eine Liste aller Auftraege waere eine
        // Tabelle, die niemand liest.
        spaete: zeilen.filter(z => Number(z.verzug_s || 0) > 60)
                      .sort((a, b) => b.verzug_s - a.verzug_s).slice(0, 10)
    };
}

// =====================================================
// Zugangsdaten (global, Betreiber-Ebene)
// =====================================================

/**
 * Zugangsdaten einer Plattform lesen.
 *
 * Reihenfolge: erst die Datenbank, dann die Umgebung. So kann eine
 * bestehende Einrichtung ueber `.env` weiterlaufen, eine neue braucht aber
 * keine Datei - und niemand muss fuer einen Schluesselwechsel den Dienst
 * neu starten.
 *
 * @param {string} [plattform='TWITCH'] Plattform-Kuerzel
 * @returns {Promise<{clientId: string|null, clientSecret: string|null, quelle: string}>} Zugangsdaten
 */
async function zugangsdaten(plattform = 'TWITCH') {
    const { decrypt } = require('../../../apps/dashboard/helpers/utils');
    const Logger = ServiceManager.get('Logger');

    const id     = await db().getConfig(PLUGIN, `${plattform}_CLIENT_ID`, 'shared', null);
    const secret = await db().getConfig(PLUGIN, `${plattform}_CLIENT_SECRET`, 'shared', null);

    if (id && secret) {
        try {
            return { clientId: id, clientSecret: decrypt(secret), quelle: 'dashboard' };
        } catch (err) {
            // Ein nicht entschluesselbares Geheimnis ist ein Fehler, kein
            // Grund stillschweigend auf die Umgebung auszuweichen.
            Logger.error(`[Streaming] ${plattform}-Secret nicht entschluesselbar - falscher TOKEN_ENCRYPTION_KEY?`, err);
            return { clientId: id, clientSecret: null, quelle: 'defekt' };
        }
    }

    const envId     = process.env[`${plattform}_CLIENT_ID`] || null;
    const envSecret = process.env[`${plattform}_CLIENT_SECRET`] || null;
    if (envId && envSecret) return { clientId: envId, clientSecret: envSecret, quelle: 'env' };

    return { clientId: null, clientSecret: null, quelle: 'fehlt' };
}

/**
 * Zugangsdaten setzen. Das Geheimnis wird verschluesselt abgelegt.
 *
 * @param {string} plattform Plattform-Kuerzel
 * @param {string} clientId Client-ID
 * @param {string|null} clientSecret Client-Secret; null laesst das vorhandene stehen
 * @returns {Promise<void>}
 */
async function zugangsdatenSetzen(plattform, clientId, clientSecret) {
    const { encrypt } = require('../../../apps/dashboard/helpers/utils');

    // '' statt null - siehe Kopf dieser Datei (Baustelle 63f)
    await db().setConfig(PLUGIN, `${plattform}_CLIENT_ID`, clientId, 'shared', '', true);
    if (clientSecret) {
        await db().setConfig(PLUGIN, `${plattform}_CLIENT_SECRET`, encrypt(clientSecret), 'shared', '', true);
    }
}


// =====================================================
// Ein einzelnes Ziel bearbeiten
// =====================================================

/**
 * Ein Ziel dieser Guild laden.
 *
 * Die Guild steht **in der Bedingung**, nicht nur im Aufruf: Sonst koennte
 * eine fremde Guild mit einer geratenen Zahl in der Adresse ein Ziel
 * bearbeiten, das ihr nicht gehoert. Die Rechtepruefung der Route sagt nur,
 * ob jemand Ziele aendern darf - nicht, welche.
 *
 * @param {string} guildId Discord-Guild-ID
 * @param {number} zielId Ziel-ID
 * @returns {Promise<Object|null>} Zeile oder null
 */
async function zielLesen(guildId, zielId) {
    const zeilen = await db().query(`
        SELECT  t.*, s.plattform, s.login, s.anzeigename
        FROM streaming_targets t
        JOIN streaming_streamers s ON s.id = t.streamer_id
        WHERE t.id = ? AND t.guild_id = ?
    `, [zielId, guildId]);
    return zeilen[0] || null;
}

/**
 * Ein Ziel aendern.
 *
 * Nur die Felder, die die Oberflaeche wirklich anbietet - eine Schleife ueber
 * `req.body` waere kuerzer und wuerde `guild_id` oder `streamer_id`
 * mitschreiben lassen.
 *
 * @param {string} guildId Discord-Guild-ID
 * @param {number} zielId Ziel-ID
 * @param {Object} f Felder
 * @returns {Promise<number>} Anzahl geaenderter Zeilen
 */
async function zielSpeichern(guildId, zielId, f) {
    const ergebnis = await db().query(`
        UPDATE streaming_targets
           SET channel_id       = ?,
               rolle_id         = ?,
               onair_channel    = ?,
               filter_spiel     = ?,
               filter_titel     = ?,
               filter_spiel_aus = ?,
               filter_titel_aus = ?,
               ruhe_von         = ?,
               ruhe_bis         = ?,
               aufraeumen       = ?,
               eigenes_bild     = ?,
               veroeffentlichen = ?,
               aktiv            = ?,
               mitglied_id      = ?
         WHERE id = ? AND guild_id = ?
    `, [f.channel_id, f.rolle_id, f.onair_channel, f.filter_spiel, f.filter_titel,
        f.filter_spiel_aus, f.filter_titel_aus, f.ruhe_von, f.ruhe_bis,
        f.aufraeumen, f.eigenes_bild, f.veroeffentlichen, f.aktiv, f.mitglied_id, zielId, guildId]);
    return Number(ergebnis?.affectedRows || 0);
}

/**
 * Ein einzelnes Ziel entfernen.
 *
 * Abzugrenzen vom Entfernen auf der Streamer-Seite: Dort verschwindet der
 * Kanal ganz aus der Beobachtung dieser Guild (alle ihre Ziele). Hier faellt
 * nur **eine** Ankuendigung weg - ein Streamer kann in mehrere Kanaele melden.
 *
 * @param {string} guildId Discord-Guild-ID
 * @param {number} zielId Ziel-ID
 * @returns {Promise<{entfernt: boolean, streamerId: number|null, letztes: boolean}>} Ergebnis
 */
async function zielEntfernen(guildId, zielId) {
    const ziel = await zielLesen(guildId, zielId);
    if (!ziel) return { entfernt: false, streamerId: null, letztes: false };

    await db().query('DELETE FROM streaming_targets WHERE id = ? AND guild_id = ?', [zielId, guildId]);

    // War es das letzte Ziel dieser Guild fuer den Kanal, ist der Kanal aus
    // ihrer Sicht nicht mehr beobachtet. Ob das Abo weg muss, entscheidet die
    // Referenzzaehlung ueber ALLE Guilds - nicht diese Abfrage.
    const rest = await db().query(
        'SELECT COUNT(*) AS anzahl FROM streaming_targets WHERE guild_id = ? AND streamer_id = ?',
        [guildId, ziel.streamer_id]);

    return {
        entfernt: true,
        streamerId: ziel.streamer_id,
        letztes: Number(rest[0]?.anzahl || 0) === 0
    };
}

/**
 * Die eigene Vorlage eines Ziels setzen.
 *
 * Leerer Text heisst **"wieder den Standard nehmen"**, nicht "leere
 * Ankuendigung". Deshalb `null` statt `''` - `null` faellt in der Ausgabe auf
 * den Guild-Standard zurueck, `''` waere eine Vorlage, die nichts sagt.
 *
 * @param {string} guildId Discord-Guild-ID
 * @param {number} zielId Ziel-ID
 * @param {string} vorlage Text; leer setzt zurueck
 * @returns {Promise<number>} Anzahl geaenderter Zeilen
 */
async function zielVorlageSetzen(guildId, zielId, vorlage) {
    const wert = String(vorlage || '').trim() || null;
    const ergebnis = await db().query(
        'UPDATE streaming_targets SET vorlage = ? WHERE id = ? AND guild_id = ?',
        [wert, zielId, guildId]);
    return Number(ergebnis?.affectedRows || 0);
}

/**
 * Die Live-Rolle dieser Guild.
 *
 * Eine je Guild, nicht eine je Ziel: Wer zwanzig Kanaele beobachtet, soll
 * nicht zwanzigmal dieselbe Rolle einstellen muessen.
 *
 * @param {string} guildId Discord-Guild-ID
 * @returns {Promise<string|null>} Rollen-ID oder null
 */
async function liveRolle(guildId) {
    const wert = await db().getConfig(PLUGIN, 'LIVE_ROLLE_ID', 'shared', guildId);
    return typeof wert === 'string' && wert.trim() ? wert.trim() : null;
}

/**
 * Die Live-Rolle setzen. Leer schaltet sie ab.
 *
 * @param {string} guildId Discord-Guild-ID
 * @param {string} rolleId Rollen-ID; leer = aus
 * @returns {Promise<void>}
 */
async function liveRolleSetzen(guildId, rolleId) {
    await db().setConfig(PLUGIN, 'LIVE_ROLLE_ID', String(rolleId || '').trim(), 'shared', guildId, false);
}

/** Zeitzone, in der Ruhezeiten gelten, solange die Guild nichts anderes sagt. */
const VORGABE_ZEITZONE = 'Europe/Berlin';

/**
 * Die Zeitzone dieser Guild.
 *
 * @param {string} guildId Discord-Guild-ID
 * @returns {Promise<string>} Zeitzone
 */
async function zeitzone(guildId) {
    const wert = await db().getConfig(PLUGIN, 'ZEITZONE', 'shared', guildId);
    return typeof wert === 'string' && wert.trim() ? wert.trim() : VORGABE_ZEITZONE;
}

/**
 * Die Zeitzone setzen.
 *
 * @param {string} guildId Discord-Guild-ID
 * @param {string} zone Zeitzone
 * @returns {Promise<void>}
 */
async function zeitzoneSetzen(guildId, zone) {
    await db().setConfig(PLUGIN, 'ZEITZONE', String(zone || VORGABE_ZEITZONE).trim(), 'shared', guildId, false);
}

/**
 * Wem hat das Plugin diese Rolle gegeben?
 *
 * Grundlage der Warnung auf der Ziele-Seite: Traegt eine Rolle mehr Mitglieder,
 * als das Plugin vergeben hat, bedeutet sie auf diesem Server noch etwas
 * anderes - und dann ist sie die falsche Wahl.
 *
 * @param {string} guildId Discord-Guild-ID
 * @param {string} rolleId Rolle
 * @returns {Promise<Array<string>>} Mitglieder-IDs
 */
async function vergebeneRolle(guildId, rolleId) {
    if (!rolleId) return [];
    const zeilen = await db().query(
        'SELECT mitglied_id FROM streaming_role_grants WHERE guild_id = ? AND rolle_id = ?',
        [guildId, rolleId]);
    return zeilen.map(z => String(z.mitglied_id));
}

// =====================================================
// Vorlagen der Guild
// =====================================================

/**
 * Die beiden Standardtexte einer Guild.
 *
 * Achtung, eine Falle in `getConfig`: Faengt ein Wert mit `{` an, versucht die
 * Datenbankschicht ihn als JSON zu lesen. Bei `{rolle} {streamer} ist live!`
 * scheitert das und der Rohtext kommt zurueck - richtig. Bei einem Text, der
 * zufaellig gueltiges JSON ist (`{}`), kaeme ein **Objekt** heraus. Deshalb
 * wird hier auf Text geprueft und sonst die Vorgabe genommen, statt einem
 * Objekt in den Nachrichtenbau zu folgen.
 *
 * @param {string} guildId Discord-Guild-ID
 * @returns {Promise<{live: string, rueckschau: string, eigeneLive: boolean, eigeneRueckschau: boolean}>} Texte
 */
async function vorlagenLesen(guildId) {
    const [live, rueck] = await Promise.all([
        db().getConfig(PLUGIN, 'VORLAGE_LIVE', 'shared', guildId),
        db().getConfig(PLUGIN, 'VORLAGE_RUECKSCHAU', 'shared', guildId)
    ]);

    return {
        live:             vorlageWaehlen(null, live,  VORGABE_LIVE),
        rueckschau:       vorlageWaehlen(null, rueck, VORGABE_RUECKSCHAU),
        eigeneLive:       typeof live === 'string' && Boolean(live.trim()),
        eigeneRueckschau: typeof rueck === 'string' && Boolean(rueck.trim())
    };
}

/**
 * Die Standardtexte einer Guild setzen.
 *
 * @param {string} guildId Discord-Guild-ID
 * @param {string} live Text der Live-Ankuendigung
 * @param {string} rueckschau Text nach dem Stream
 * @returns {Promise<void>}
 */
async function vorlagenSetzen(guildId, live, rueckschau) {
    // isGlobal ausdruecklich false: Ohne das Argument raet setConfig anhand
    // der guildId - und eine Guild-Vorlage waere ploetzlich die aller.
    await db().setConfig(PLUGIN, 'VORLAGE_LIVE', String(live || '').trim(), 'shared', guildId, false);
    await db().setConfig(PLUGIN, 'VORLAGE_RUECKSCHAU', String(rueckschau || '').trim(), 'shared', guildId, false);
}

module.exports = {
    PLUGIN,
    VORGABE_LIVE,
    VORGABE_RUECKSCHAU,
    streamerDerGuild,
    zieleDerGuild,
    alleStreamer,
    anzahlStreamer,
    zustandDerGuild,
    verzugStatistik,
    zielLesen,
    zielSpeichern,
    zielEntfernen,
    zielVorlageSetzen,
    liveRolle,
    liveRolleSetzen,
    vergebeneRolle,
    zeitzone,
    zeitzoneSetzen,
    VORGABE_ZEITZONE,
    vorlagenLesen,
    vorlagenSetzen,
    zugangsdaten,
    zugangsdatenSetzen
};
