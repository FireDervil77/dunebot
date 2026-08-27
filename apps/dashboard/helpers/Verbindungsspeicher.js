'use strict';

/**
 * Der Speicher fuer **Zusagen**: erteilte Berechtigungen samt Schluessel.
 *
 * Hintergrund in `docs/streamer-plugin/12-Anmeldung-und-Chat.md`. Der Kern
 * haelt seit dem 2026-08-26 den Nachweis (`user_connections`); hier kommt
 * dazu, was ein Benutzer uns darueber hinaus **erlaubt** hat.
 *
 * ## Warum im Kern und nicht im Plugin
 *
 * Dieselbe Begruendung wie beim Nachweis - Widerruf, Loeschung und Auskunft an
 * einer Stelle - und eine zweite, die staerker ist: Twitch verlangt
 *
 * > *„Your app must validate the OAuth token when it starts and on an hourly
 * > basis thereafter."*
 *
 * samt Audits und angedrohtem Entzug des API-Schluessels. Eine **Pflicht mit
 * Pruefung** gehoert nicht in ein Plugin, das jederzeit abgeschaltet werden
 * kann. Wird `streaming` deaktiviert, laeuft die Pruefung hier weiter - sie
 * ueberspringt dann nur die Anbieter, die gerade niemand vertritt.
 *
 * ## Es gibt keinen Weg an `mitZugang` vorbei
 *
 * Der Speicher gibt **keinen rohen Token heraus**. Wer etwas im Namen eines
 * Benutzers tun will, uebergibt eine Funktion; der Speicher steckt den Token
 * hinein und faengt den Fehlschlag ab. Der Grund ist Erfahrung aus diesem
 * Projekt: Ein `zugangHolen()` waere bequemer, und der erste Aufrufer haette
 * die Erneuerung noch bedacht. Der fuenfte nicht mehr - und sein Fehler faellt
 * erst auf, wenn der Token nach Wochen ablaeuft
 * (`vorhanden-heisst-nicht-funktioniert`).
 *
 * ## Reaktiv erneuern, nicht vorsorglich
 *
 * Twitch empfiehlt ausdruecklich, auf **HTTP 401** zu reagieren statt nach
 * `expires_in` zu rechnen. Das ist hier keine Geschmacksfrage: Ein
 * Erneuerungs-Token stirbt nach **50 ausgegebenen Zugaengen**. Wer vorsorglich
 * erneuert, verbrennt dieses Kontingent und steht Wochen spaeter ohne Zugang
 * da, ohne dass je ein Fehler zu sehen war.
 *
 * @module dashboard/helpers/Verbindungsspeicher
 */

const { ServiceManager } = require('dunebot-core');
const { VerbindungsRegistry } = require('dunebot-sdk');
const { encrypt, decrypt } = require('./utils');

/**
 * Wie oft geprueft wird. Twitch schreibt stuendlich vor - knapper zu takten
 * bringt nichts und kostet nur Aufrufe.
 */
const PRUEF_TAKT_MS = 60 * 60 * 1000;

let uhr = null;
let laeuftGerade = false;

/** @returns {Object} Datenbankdienst */
function db() {
    return ServiceManager.get('dbService');
}

/** @returns {Object} Logger */
function log() {
    return ServiceManager.get('Logger');
}

/**
 * Die Zusage eines Benutzers lesen - mitsamt der Verknuepfung, an der sie haengt.
 *
 * @param {string} userId Discord-Benutzer
 * @param {string} plattform Anbieter
 * @returns {Promise<Object|null>} Zeile oder null
 */
async function zusageLesen(userId, plattform) {
    const zeilen = await db().query(`
        SELECT g.*, v.id AS verbindung, v.konto_id, v.konto_name
          FROM user_connection_grants g
          JOIN user_connections v ON v.id = g.verbindung_id
         WHERE v.user_id = ? AND v.plattform = ?
         LIMIT 1
    `, [userId, plattform]);
    return zeilen[0] || null;
}

/**
 * Eine erteilte Zusage wegschreiben.
 *
 * **Scopes werden zusammengefuehrt, nicht ersetzt.** Wer spaeter eine zweite
 * Zusage erteilt, soll die erste nicht verlieren - Twitch gibt im neuen Token
 * ohnehin die Gesamtmenge zurueck, aber wir verlassen uns nicht darauf.
 *
 * @param {Object} opt Angaben
 * @param {string} opt.userId Discord-Benutzer
 * @param {string} opt.plattform Anbieter
 * @param {Array<string>} opt.scopes Erteilte Scopes
 * @param {string} opt.zugang Zugangsschluessel im Klartext
 * @param {string|null} opt.erneuerung Erneuerungsschluessel im Klartext
 * @param {number|null} opt.laeuftAbSek Gueltigkeit in Sekunden
 * @returns {Promise<boolean>} true bei Erfolg
 */
async function zusageSpeichern({ userId, plattform, scopes, zugang, erneuerung, laeuftAbSek }) {
    const verbindung = await db().query(
        'SELECT id FROM user_connections WHERE user_id = ? AND plattform = ? LIMIT 1',
        [userId, plattform]);

    // **Ohne Nachweis keine Zusage.** Der Fremdschluessel wuerde es ohnehin
    // ablehnen; hier steht es als Klartext-Fehler statt als SQL-Fehler.
    if (!verbindung[0]) {
        log().warn(`[Verbindungen] Zusage fuer ${plattform} ohne Verknuepfung von ${userId} - verworfen`);
        return false;
    }

    // **Was hier steht, muss der Schluessel auch koennen.**
    //
    // Bis zum 2026-08-27 wurden die Scopes blind zusammengefuehrt: Wer eine
    // zweite Zusage erteilte, behielt die erste in der Spalte — aber nicht im
    // Schluessel. Twitch gibt einen Schluessel genau ueber das, wonach der
    // Dialog gefragt hat. Gemessen: Spalte drei Scopes, `/validate` einer,
    // Helix `401 Missing scope`. Die Datenbank behauptete eine Berechtigung,
    // die es nicht mehr gab — die schlimmste Sorte Auskunft.
    //
    // Jetzt gilt, was der Anbieter zum Schluessel meldet. Damit dabei nichts
    // verlorengeht, bittet die Startroute schon um die **Vereinigung** aus
    // alten und neuen Scopes; die Antwort enthaelt dann ohnehin beides.
    //
    // Meldet der Anbieter gar nichts (manche liefern bei der Erneuerung kein
    // `scope`), bleibt der bisherige Stand stehen — eine leere Spalte waere
    // eine andere Luege, nur in die andere Richtung.
    const vorher = await zusageLesen(userId, plattform);
    const gemeldet = [...new Set((scopes || []).map(String).filter(Boolean))].sort();
    const bisher = vorher ? String(vorher.scopes || '').split(' ').filter(Boolean).sort() : [];
    const zusammen = gemeldet.length ? gemeldet : bisher;

    const verloren = bisher.filter(x => !zusammen.includes(x));
    if (verloren.length) {
        // Laut, nicht still: Eine Berechtigung, die weg ist, muss der Benutzer
        // neu erteilen — und der Betreiber muss wissen, warum etwas aufhoert
        // zu funktionieren.
        log().warn(`[Verbindungen] ${plattform}/${userId}: Zusage verliert ${verloren.join(' ')} - `
                 + 'der neue Schluessel deckt sie nicht mehr ab');
    }

    await db().query(`
        INSERT INTO user_connection_grants
            (verbindung_id, scopes, zugang_ver, erneuerung_ver, laeuft_ab_am, geprueft_am, fehlertext)
        VALUES (?, ?, ?, ?, ${laeuftAbSek ? 'DATE_ADD(NOW(), INTERVAL ? SECOND)' : 'NULL'}, NOW(), NULL)
        ON DUPLICATE KEY UPDATE
            scopes = VALUES(scopes),
            zugang_ver = VALUES(zugang_ver),
            erneuerung_ver = VALUES(erneuerung_ver),
            laeuft_ab_am = VALUES(laeuft_ab_am),
            geprueft_am = NOW(),
            fehlertext = NULL
    `, laeuftAbSek
        ? [verbindung[0].id, zusammen.join(' '), encrypt(zugang), erneuerung ? encrypt(erneuerung) : null, laeuftAbSek]
        : [verbindung[0].id, zusammen.join(' '), encrypt(zugang), erneuerung ? encrypt(erneuerung) : null]);

    log().info(`[Verbindungen] Zusage ${plattform} von ${userId}: ${zusammen.join(' ') || '(keine)'}`);
    return true;
}

/**
 * Etwas im Namen eines Benutzers tun - **der einzige Weg an den Schluessel**.
 *
 * Der Aufrufer bekommt den Token als Argument und gibt zurueck, was seine
 * Anfrage ergab. Meldet er `abgelehnt: true` (also HTTP 401), wird **einmal**
 * erneuert und **einmal** wiederholt. Ein zweites Scheitern ist ein echtes
 * Ende: Dann hat der Benutzer sein Passwort geaendert oder uns getrennt, und
 * weiteres Erneuern verbrennt nur das 50er-Kontingent.
 *
 * @param {Object} opt { userId, plattform }
 * @param {Function} tun `async (zugang) => ({ abgelehnt?: boolean, … })`
 * @returns {Promise<Object|null>} Ergebnis von `tun`, oder null ohne Zusage
 */
async function mitZugang({ userId, plattform }, tun) {
    const zusage = await zusageLesen(userId, plattform);
    if (!zusage) return null;

    let zugang;
    try {
        zugang = decrypt(zusage.zugang_ver);
    } catch (err) {
        // Ein nicht entschluesselbarer Schluessel ist ein Fehler, kein Grund
        // stillschweigend weiterzumachen - vermutlich falscher
        // TOKEN_ENCRYPTION_KEY.
        log().error(`[Verbindungen] Zusage ${plattform}/${userId} nicht entschluesselbar`, err);
        return null;
    }

    const ergebnis = await tun(zugang);
    if (!ergebnis?.abgelehnt) return ergebnis;

    const anbieter = VerbindungsRegistry.get(plattform);
    if (!anbieter?.erneuern || !zusage.erneuerung_ver) {
        log().warn(`[Verbindungen] ${plattform}/${userId} abgelehnt und nicht erneuerbar`);
        return ergebnis;
    }

    let frisch = null;
    try {
        frisch = await anbieter.erneuern({ erneuerung: decrypt(zusage.erneuerung_ver) });
    } catch (err) {
        log().error(`[Verbindungen] Erneuern ${plattform}/${userId} fehlgeschlagen`, err);
    }

    if (!frisch?.zugang) {
        await vermerken(zusage.id, 'Erneuern fehlgeschlagen');
        return ergebnis;
    }

    await zusageSpeichern({
        userId, plattform,
        scopes: frisch.scopes || String(zusage.scopes || '').split(' ').filter(Boolean),
        zugang: frisch.zugang,
        erneuerung: frisch.erneuerung || decrypt(zusage.erneuerung_ver),
        laeuftAbSek: frisch.laeuftAbSek || null
    });

    return await tun(frisch.zugang);
}

/**
 * Einen Fehler an der Zusage vermerken, ohne sie zu loeschen.
 *
 * **Nicht loeschen ist Absicht.** Ein abgelaufener Schluessel heisst nicht,
 * dass der Benutzer widerrufen hat - er kann auch nur sein Passwort geaendert
 * haben. Die Zeile bleibt sichtbar, damit man ihm sagen kann, dass er neu
 * zustimmen muss (`melden-statt-ausweichen`).
 *
 * @param {number} id Zusage
 * @param {string} text Grund
 * @returns {Promise<void>}
 */
async function vermerken(id, text) {
    await db().query(
        'UPDATE user_connection_grants SET fehlertext = ?, geprueft_am = NOW() WHERE id = ?',
        [String(text).slice(0, 512), id]);
}

/**
 * Eine Zusage zuruecknehmen - **ohne** den Nachweis anzutasten.
 *
 * Wer die Berechtigung entzieht, sagt nicht "das Konto gehoert mir nicht
 * mehr". Der Nachweis bleibt, die Schluessel gehen.
 *
 * @param {string} userId Discord-Benutzer
 * @param {string} plattform Anbieter
 * @returns {Promise<void>}
 */
async function widerrufen(userId, plattform) {
    await db().query(`
        DELETE g FROM user_connection_grants g
          JOIN user_connections v ON v.id = g.verbindung_id
         WHERE v.user_id = ? AND v.plattform = ?
    `, [userId, plattform]);
    log().info(`[Verbindungen] Zusage ${plattform} von ${userId} widerrufen`);
}

/**
 * Die stuendliche Pflichtpruefung.
 *
 * Geprueft wird bei der Plattform, nicht bei uns: Nur sie weiss, ob ein
 * Benutzer inzwischen widerrufen hat. Ein ungueltiger Schluessel wird
 * **vermerkt, nicht geloescht** - siehe `vermerken`.
 *
 * ## Abgelaufen ist nicht widerrufen
 *
 * Ein Zugangsschluessel von Twitch lebt Stunden, nicht Tage. Ist er abgelaufen,
 * antwortet `/validate` mit demselben 401 wie bei einem echten Widerruf - und
 * eine Pruefung, die beides gleich behandelt, meldet **nach jeder Zustimmung
 * verlaesslich Fehlalarm**, sobald der erste Ablauf vorbei ist.
 *
 * Deshalb wird ein Schluessel, von dem wir wissen, dass er abgelaufen ist, gar
 * nicht erst gefragt: Der Aufruf koennte nichts beweisen. Erneuern ist hier
 * ebenfalls falsch - ein Erneuerungsschluessel stirbt nach 50 ausgegebenen
 * Zugaengen, und stuendlich erneuern hiesse, das Kontingent in gut einer Woche
 * zu verbrennen (siehe Modulkopf).
 *
 * **Der Preis, offen benannt:** Wer widerruft und dessen Zusage danach
 * ungenutzt bleibt, faellt nicht mehr stuendlich auf, sondern beim naechsten
 * Gebrauch - dort erneuert `mitZugang`, das Erneuern scheitert, und der
 * Vermerk steht. Genau dann ist es auch relevant: Ohne Gebrauch handeln wir
 * nicht in seinem Namen.
 *
 * @returns {Promise<{geprueft: number, ungueltig: number, abgelaufen: number, uebersprungen: number}>} Bilanz
 */
async function pruefen() {
    const bilanz = { geprueft: 0, ungueltig: 0, abgelaufen: 0, uebersprungen: 0 };

    const zeilen = await db().query(`
        SELECT g.id, g.zugang_ver, g.laeuft_ab_am, g.scopes, v.plattform, v.user_id
          FROM user_connection_grants g
          JOIN user_connections v ON v.id = g.verbindung_id
    `);

    for (const zeile of zeilen) {
        const anbieter = VerbindungsRegistry.get(zeile.plattform);
        // Kein eingetragener Anbieter heisst: Das Plugin ist gerade aus. Das
        // ist kein Fehler und die Zusage bleibt gueltig - wir koennen sie nur
        // im Moment nicht pruefen.
        if (!anbieter?.pruefen) { bilanz.uebersprungen++; continue; }

        // Bekannt abgelaufen: nicht fragen, nicht alarmieren, und den
        // vorhandenen Vermerk **nicht** anfassen - dort koennte ein echter
        // Widerruf stehen, den `mitZugang` beim letzten Gebrauch gefunden hat.
        if (zeile.laeuft_ab_am && new Date(zeile.laeuft_ab_am).getTime() <= Date.now()) {
            bilanz.abgelaufen++;
            continue;
        }

        try {
            const ergebnis = await anbieter.pruefen({ zugang: decrypt(zeile.zugang_ver) });
            bilanz.geprueft++;

            if (ergebnis?.gueltig) {
                // **Die Pruefung weiss es besser als unsere Spalte.**
                // `/validate` nennt die Scopes, die der Schluessel wirklich
                // traegt. Sie wegzuwerfen war der Grund, warum die Luege vom
                // 2026-08-27 eine Stunde nach der anderen ueberlebte: Die
                // Pruefung sah den Schluessel, sagte "gueltig", und ruehrte die
                // falsche Spalte nicht an. Jetzt heilt sie sich stuendlich
                // selbst.
                const echt = Array.isArray(ergebnis.scopes) ? [...ergebnis.scopes].sort() : null;
                const stand = String(zeile.scopes || '').split(' ').filter(Boolean).sort();

                if (echt && echt.join(' ') !== stand.join(' ')) {
                    log().warn(`[Verbindungen] ${zeile.plattform}/${zeile.user_id}: Spalte und Schluessel `
                             + `weichen ab - vermerkt: "${stand.join(' ')}", wirklich: "${echt.join(' ')}"`);
                }

                await db().query(
                    'UPDATE user_connection_grants SET scopes = ?, geprueft_am = NOW(), fehlertext = NULL WHERE id = ?',
                    [echt ? echt.join(' ') : String(zeile.scopes || ''), zeile.id]);
            } else {
                // Der Schluessel haette noch leben muessen - abgelaufene sind
                // oben schon aussortiert. Bleibt: widerrufen, Passwort
                // geaendert, oder App getrennt. Das ist echt.
                bilanz.ungueltig++;
                await vermerken(zeile.id, 'von der Plattform als ungueltig gemeldet');
                log().warn(`[Verbindungen] ${zeile.plattform}/${zeile.user_id}: Zusage ungueltig - neue Zustimmung noetig`);
            }
        } catch (err) {
            await vermerken(zeile.id, err.message || 'Pruefung fehlgeschlagen');
            log().error(`[Verbindungen] Pruefung ${zeile.plattform}/${zeile.user_id} fehlgeschlagen`, err);
        }
    }

    return bilanz;
}

/**
 * Pruefung starten: **einmal sofort**, danach stuendlich.
 *
 * Das "sofort" steht so in Twitchs Auflage ("when it starts") und ist nicht
 * bloss Hoeflichkeit: Ein Dienst, der oefter als einmal die Stunde neu
 * startet, wuerde sonst nie pruefen.
 *
 * @returns {void}
 */
function starten() {
    if (uhr) return;

    const lauf = async () => {
        if (laeuftGerade) return;
        laeuftGerade = true;
        try {
            const b = await pruefen();
            if (b.geprueft || b.ungueltig || b.abgelaufen) {
                // `geprueft` zaehlt die **gefragten**, nicht die gueltigen - die
                // ungueltigen stecken darin. "1 gueltig geprueft, 1 ungueltig"
                // stand fuer EINE Zusage und las sich wie zwei.
                log().info(`[Verbindungen] Zusagen: ${b.geprueft} gefragt ` +
                    `(davon ${b.ungueltig} ungueltig), ` +
                    `${b.abgelaufen} abgelaufen (wird bei Gebrauch erneuert), ` +
                    `${b.uebersprungen} uebersprungen`);
            }
        } catch (err) {
            log().error('[Verbindungen] Stuendliche Pruefung fehlgeschlagen', err);
        } finally {
            laeuftGerade = false;
        }
    };

    lauf();
    uhr = setInterval(lauf, PRUEF_TAKT_MS);
    uhr.unref?.();
    log().info('[Verbindungen] Stuendliche Zusagen-Pruefung gestartet (Auflage von Twitch)');
}

/** @returns {void} */
function anhalten() {
    if (uhr) clearInterval(uhr);
    uhr = null;
}

module.exports = {
    PRUEF_TAKT_MS,
    zusageLesen, zusageSpeichern, mitZugang, widerrufen, vermerken, pruefen,
    starten, anhalten
};
