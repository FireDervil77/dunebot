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

module.exports = {
    PLUGIN,
    streamerDerGuild,
    zieleDerGuild,
    anzahlStreamer,
    zustandDerGuild,
    zugangsdaten,
    zugangsdatenSetzen
};
