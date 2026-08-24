'use strict';

/**
 * Streaming - der Abgleich gegen die Plattform.
 *
 * **Das ist die Stelle, an der dieses Plugin sonst lautlos verstummt.**
 *
 * Twitch widerruft Abos, wenn unser Eingang zu oft nicht antwortet
 * (`notification_failures_exceeded`). Ein paar Stunden Ausfall reissen also
 * Abos mit — und danach passiert einfach nichts mehr. Keine Fehlermeldung,
 * keine leere Seite, kein Absturz: Es kommt nur nie wieder eine Ankuendigung,
 * und niemand merkt es, bis jemand fragt "warum meldet der Bot mich nicht mehr".
 *
 * Vier Faelle, und jeder braucht eine eigene Antwort:
 *
 *   bei ihnen, nicht bei uns   -> abbestellen   (Leck: kostet Kontingent)
 *   bei uns, nicht bei ihnen   -> neu anlegen   (verloren: kostet Meldungen)
 *   Zustand weicht ab          -> uebernehmen   (wir lagen falsch)
 *   niemand beobachtet mehr    -> abbestellen   (Referenzzaehlung)
 *
 * **Eine Sicherung ist wichtiger als alle vier:** Wenn die Liste von Twitch
 * unvollstaendig ankommt, sieht das aus wie "die Haelfte der Abos ist weg" —
 * und ein Abgleich, der darauf handelt, raeumt genau das ab, was er schuetzen
 * soll. Deshalb bricht er ab, statt aufzuraeumen.
 *
 * @module streaming/dashboard/kern/abgleich
 */

const { ServiceManager } = require('dunebot-core');
const abos = require('./abos');

/** Wie viele Abos hoechstens in einem Lauf neu angelegt werden. */
const HOECHSTENS_NEU = 25;

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
 * Unser Bestand: jede Abo-Zeile mit dem Kanal dahinter.
 *
 * @returns {Promise<Array>} Zeilen
 */
async function eigenerBestand() {
    return await db().query(`
        SELECT a.id, a.streamer_id, a.ereignis, a.anbieter_abo_id, a.zustand,
               s.plattform, s.kanal_id, s.login,
               (SELECT COUNT(*) FROM streaming_targets t
                 WHERE t.streamer_id = s.id AND t.aktiv = 1) AS zuschauer
          FROM streaming_subscriptions a
          JOIN streaming_streamers s ON s.id = a.streamer_id
    `);
}

/**
 * Ein Abo neu anlegen, das bei der Plattform verlorengegangen ist.
 *
 * `abosSichern` allein genuegt nicht: Es ueberspringt Ereignisse, die bei uns
 * auf `bestaetigt` oder `angefragt` stehen — und genau das ist hier der Fall.
 * Die Zeile muss vorher zurueckgesetzt werden, sonst passiert nichts und der
 * Lauf meldet trotzdem Erfolg.
 *
 * @param {Object} zeile Bestandszeile
 * @returns {Promise<boolean>} ob es geklappt hat
 */
async function neuAnlegen(zeile) {
    await db().query(
        "UPDATE streaming_subscriptions SET zustand = 'verloren', anbieter_abo_id = NULL WHERE id = ?",
        [zeile.id]);

    const ergebnisse = await abos.abosSichern(zeile.streamer_id, zeile.plattform, zeile.kanal_id);
    const dieses = ergebnisse.find(e => e.ereignis === zeile.ereignis);
    return Boolean(dieses && dieses.ok !== false && !dieses.uebersprungen);
}

/**
 * **Die Entscheidung, getrennt von der Ausfuehrung.**
 *
 * Reine Funktion: zwei Listen herein, vier Stapel heraus. Kein Datenbank-
 * zugriff, kein Netz - damit laesst sich jeder Fall durchspielen, auch die,
 * die im Betrieb selten sind und dann wehtun. `scripts/check-streaming-abgleich.js`
 * setzt hier an.
 *
 * @param {Array} bestand unsere Abo-Zeilen (mit `zuschauer`)
 * @param {Array} fremde Abos der Plattform (uebersetzt vom Adapter)
 * @returns {{lecks: Array, verloren: Array, zustaende: Array, unbekannt: Array}} vier Stapel
 */
function vergleichen(bestand, fremde) {
    const lecks = [], verloren = [], zustaende = [], unbekannt = [];

    const beiIhnen = new Map(fremde.map(a => [a.anbieter_abo_id, a]));
    const unsereIds = new Set(bestand.map(z => z.anbieter_abo_id).filter(Boolean));

    for (const f of fremde) {
        if (!unsereIds.has(f.anbieter_abo_id)) {
            lecks.push({ id: f.anbieter_abo_id, ereignis: f.ereignis, kanal_id: f.kanal_id });
        }
    }

    for (const z of bestand) {
        // Wen niemand mehr beobachtet, braucht kein neues Abo - der faellt
        // unter die Referenzzaehlung und wuerde hier sonst gerade wieder
        // angelegt, um gleich danach abbestellt zu werden.
        if (Number(z.zuschauer) === 0) continue;

        const f = z.anbieter_abo_id ? beiIhnen.get(z.anbieter_abo_id) : null;

        if (!f) {
            verloren.push({ id: z.id, streamer_id: z.streamer_id, plattform: z.plattform,
                            kanal_id: z.kanal_id, login: z.login, ereignis: z.ereignis });
            continue;
        }

        // Ein Zustand, den der Adapter nicht kennt: nichts aendern, aber
        // sichtbar machen. Ihn auf "fehler" zu legen waere ein Fehler, den es
        // nicht gibt.
        if (f.unbekannt) {
            unbekannt.push({ login: z.login, ereignis: z.ereignis, status: f.unbekannt });
            continue;
        }

        if (f.zustand && f.zustand !== z.zustand) {
            zustaende.push({ id: z.id, login: z.login, ereignis: z.ereignis, war: z.zustand, ist: f.zustand });
        }
    }

    return { lecks, verloren, zustaende, unbekannt };
}

/**
 * Ein Lauf.
 *
 * @param {Object} [optionen] Optionen
 * @param {boolean} [optionen.trocken=false] nur zeigen, nichts aendern
 * @returns {Promise<Object>} Bericht
 */
async function lauf({ trocken = false } = {}) {
    const bericht = {
        gelaufen_am: new Date().toISOString(),
        trocken,
        abgebrochen: null,
        kosten: null, grenze: null,
        bei_ihnen: 0, bei_uns: 0,
        lecks: [], verloren: [], zustaende: [], verwaist: [], unbekannt: []
    };

    const adapter = abos.ADAPTER.twitch;
    const bestand = await eigenerBestand();
    bericht.bei_uns = bestand.length;

    let antwort;
    try {
        antwort = await adapter.abosAuflisten();
    } catch (err) {
        bericht.abgebrochen = `Plattform nicht erreichbar: ${err.message}`;
        log().error('[Streaming/Abgleich] Plattform nicht erreichbar:', err);
        await berichtSichern(bericht);
        return bericht;
    }

    // Die wichtigste Zeile dieser Datei. Ohne sie raeumt ein halber
    // Netzwerkfehler das halbe Kontingent ab.
    if (!antwort.vollstaendig) {
        bericht.abgebrochen = 'Die Liste der Plattform kam unvollstaendig an — nichts geaendert.';
        log().warn('[Streaming/Abgleich] Liste unvollstaendig, Lauf abgebrochen');
        await berichtSichern(bericht);
        return bericht;
    }

    bericht.bei_ihnen = antwort.abos.length;
    bericht.kosten = antwort.kosten;
    bericht.grenze = antwort.grenze;

    const urteil = vergleichen(bestand, antwort.abos);
    bericht.lecks = urteil.lecks;
    bericht.verloren = urteil.verloren.map(v => ({ login: v.login, ereignis: v.ereignis }));
    bericht.zustaende = urteil.zustaende.map(z => ({ login: z.login, ereignis: z.ereignis, war: z.war, ist: z.ist }));
    bericht.unbekannt = urteil.unbekannt;

    for (const u of urteil.unbekannt) {
        log().warn(`[Streaming/Abgleich] Unbekannter Zustand "${u.status}" bei ${u.login}/${u.ereignis}`);
    }

    if (!trocken) {
        // ---------------------------------------------------------------
        // 1. Bei ihnen, nicht bei uns - ein Leck
        // ---------------------------------------------------------------
        for (const leck of urteil.lecks) {
            try {
                await adapter.abbestellen(leck.id);
                log().info(`[Streaming/Abgleich] Verwaistes Abo bei der Plattform abbestellt: ${leck.ereignis} (${leck.id})`);
            } catch (err) {
                log().warn(`[Streaming/Abgleich] Abbestellen fehlgeschlagen (${leck.id}): ${err.message}`);
            }
        }

        // ---------------------------------------------------------------
        // 2. Bei uns, nicht bei ihnen - verloren
        // ---------------------------------------------------------------
        // Gedeckelt: Ist die Anwendung bei Twitch gesperrt, scheitert jeder
        // Versuch - und ein ungedeckelter Lauf feuert dann hunderte Anfragen
        // gegen eine Wand.
        for (const v of urteil.verloren.slice(0, HOECHSTENS_NEU)) {
            if (await neuAnlegen(v)) {
                log().success(`[Streaming/Abgleich] Verlorenes Abo neu angelegt: ${v.ereignis} fuer ${v.login}`);
            }
        }

        // ---------------------------------------------------------------
        // 3. Zustand weicht ab - uebernehmen
        // ---------------------------------------------------------------
        for (const z of urteil.zustaende) {
            await db().query('UPDATE streaming_subscriptions SET zustand = ? WHERE id = ?', [z.ist, z.id]);
            log().info(`[Streaming/Abgleich] Zustand uebernommen: ${z.login}/${z.ereignis} ${z.war} -> ${z.ist}`);
        }
    }

    // ---------------------------------------------------------------
    // 4. Niemand beobachtet mehr — Referenzzaehlung
    // ---------------------------------------------------------------
    const ohneZiel = await db().query(`
        SELECT s.id, s.login
          FROM streaming_streamers s
         WHERE NOT EXISTS (SELECT 1 FROM streaming_targets t WHERE t.streamer_id = s.id AND t.aktiv = 1)
           AND EXISTS     (SELECT 1 FROM streaming_subscriptions a WHERE a.streamer_id = s.id)
    `);

    for (const s of ohneZiel) {
        bericht.verwaist.push({ login: s.login });
        if (trocken) continue;
        await abos.abosAufraeumen(s.id);
    }

    await berichtSichern(bericht);

    const summe = bericht.lecks.length + bericht.verloren.length + bericht.zustaende.length + bericht.verwaist.length;
    if (summe > 0) {
        log().info(`[Streaming/Abgleich] ${summe} Abweichung(en): ` +
            `${bericht.lecks.length} Leck, ${bericht.verloren.length} verloren, ` +
            `${bericht.zustaende.length} Zustand, ${bericht.verwaist.length} verwaist`);
    }

    return bericht;
}

/**
 * Den Bericht wegschreiben - er ist das, was die Betriebsseite zeigt.
 *
 * **Auch ein abgebrochener Lauf wird gesichert.** Sonst steht dort weiter das
 * Ergebnis von gestern, und die Seite behauptet Ruhe, wo seit Stunden nichts
 * mehr geht.
 *
 * @param {Object} bericht Bericht
 * @returns {Promise<void>}
 */
async function berichtSichern(bericht) {
    try {
        await db().setConfig('streaming', 'ABGLEICH_BERICHT', bericht, 'shared', '', true);
    } catch (err) {
        log().warn(`[Streaming/Abgleich] Bericht nicht speicherbar: ${err.message}`);
    }
}

/**
 * Den letzten Bericht lesen.
 *
 * @returns {Promise<Object|null>} Bericht oder null
 */
async function letzterBericht() {
    const wert = await db().getConfig('streaming', 'ABGLEICH_BERICHT', 'shared', null);
    return wert && typeof wert === 'object' ? wert : null;
}

module.exports = { HOECHSTENS_NEU, vergleichen, lauf, letzterBericht, eigenerBestand };
