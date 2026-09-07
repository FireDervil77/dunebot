'use strict';

/**
 * Musikwuensche aus dem Twitch-Chat.
 *
 * Liegt in `shared/` aus demselben Grund wie `lose.js`: Das **Dashboard**
 * schreibt (dort kommt `!wunsch` an und dort liegt der Player), und wenn der
 * Bot je mitreden soll, liest er aus derselben Datenbank. Eine Leitung
 * zwischen beiden braucht es dafuer nicht.
 *
 * ## Der Zeiger, nicht die Schlange
 *
 * Eine gespielte Zeile wird **nicht geloescht**. `streaming_music_state`
 * .`aktuelle_id` zeigt auf die laufende, `position` gibt die Reihenfolge.
 * Damit ist `!prev` eine Abfrage und kein zweiter Mechanismus - und die Liste
 * kann zeigen, was schon lief.
 *
 * Der Preis ist eine wachsende Tabelle. Den zahlt `aufraeumen()`: Was aelter
 * als `AUFBEWAHRUNG_TAGE` ist und nicht laeuft, faellt weg.
 *
 * ## Wie die Datei gefunden wird
 *
 * **Nie direkt.** Es gibt kein `require` auf das music-Plugin; gefragt wird
 * ueber `MusikablageRegistry` (siehe dort, warum). Fehlt die Ablage - weil das
 * Musik-Plugin nicht installiert oder abgeschaltet ist -, sagt das jede
 * Funktion ehrlich, statt eine leere Liste zu liefern, die wie "nichts
 * gefunden" aussieht.
 *
 * @module streaming/shared/musikwunsch
 */

const crypto = require('crypto');
const { ServiceManager } = require('dunebot-core');
const { MusikablageRegistry } = require('dunebot-sdk');

/**
 * Wie lange eine gespielte Zeile aufgehoben wird.
 *
 * Kuerzer als bei den Losen (30 Tage): Ein Musikwunsch von vorgestern
 * interessiert niemanden, und `gewuenscht_von` traegt einen Namen - was nicht
 * gebraucht wird, soll nicht liegen bleiben.
 */
const AUFBEWAHRUNG_TAGE = 7;

/**
 * Wie viele Stimmen einen Titel ueberspringen.
 *
 * **Eine Konstante, kein Einstellungswert - und das ist Absicht, nicht
 * Bequemlichkeit.** Es gibt heute keine Einstellungsseite fuer den
 * Musikwunsch; eine Spalte ohne Bedienoberflaeche waere eine tote Spalte, und
 * die Hausregel dazu ist eindeutig ("jede Tabelle hat eine Ansicht, sonst
 * waere sie tot"). Kommt die Seite, wird hieraus eine Vorgabe.
 */
const NOETIGE_STIMMEN = 3;

/** @returns {Object} Datenbankdienst */
function db() {
    return ServiceManager.get('dbService');
}

/** @returns {Object} Protokoll */
function log() {
    return ServiceManager.get('Logger');
}

/**
 * Die Ablage, aus der gespielt werden darf.
 *
 * @returns {Object|null} Die eingetragene Ablage oder null
 */
function ablage() {
    return MusikablageRegistry.fuerStream();
}

/* ======================================================================
 * Zustand
 * ==================================================================== */

/**
 * Den Zustand einer Guild holen - und anlegen, wenn es ihn nicht gibt.
 *
 * @param {string} guildId Guild
 * @returns {Promise<Object>} Die Zustandszeile
 */
async function zustand(guildId) {
    const zeilen = await db().query(
        'SELECT * FROM streaming_music_state WHERE guild_id = ? LIMIT 1', [guildId]);

    if (zeilen?.[0]) return zeilen[0];

    // `INSERT IGNORE`, nicht `INSERT`: Zwei gleichzeitige Anfragen kaemen sonst
    // beide hier an und die zweite liefe in den Schluesselkonflikt.
    // `aktiv = 1` ausdruecklich und nicht ueber die Spaltenvorgabe: Eine neue
    // Guild soll spielen, sobald etwas gewuenscht wird. Angehalten wird mit
    // `!pause`, und das ist ein bewusster Griff.
    await db().query(
        'INSERT IGNORE INTO streaming_music_state (guild_id, schluessel, aktiv) VALUES (?, ?, 1)',
        [guildId, neuerSchluessel()]);

    const nochmal = await db().query(
        'SELECT * FROM streaming_music_state WHERE guild_id = ? LIMIT 1', [guildId]);
    return nochmal?.[0] || null;
}

/**
 * Ein neuer Geheimschluessel fuer die OBS-Adresse.
 *
 * 32 Byte als Hex. Kuerzer waere ratbar, und die Adresse tippt niemand ab -
 * sie wird kopiert.
 *
 * @returns {string} Schluessel
 */
function neuerSchluessel() {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * Den Schluessel neu erzeugen.
 *
 * Danach spielt eine offene Browserquelle nicht mehr weiter - genau das ist
 * der Zweck.
 *
 * @param {string} guildId Guild
 * @returns {Promise<string>} Der neue Schluessel
 */
async function schluesselNeu(guildId) {
    const schluessel = neuerSchluessel();
    await zustand(guildId);
    await db().query(
        'UPDATE streaming_music_state SET schluessel = ? WHERE guild_id = ?',
        [schluessel, guildId]);
    return schluessel;
}

/**
 * Zu welcher Guild gehoert dieser Schluessel?
 *
 * **Der einzige Weg, mit dem der Player sich ausweist.** Deshalb wird hier
 * nichts geraten: Ein leerer oder zu kurzer Schluessel bekommt gar keine
 * Abfrage zu sehen.
 *
 * @param {string} schluessel Aus der Adresse
 * @returns {Promise<string|null>} Guild-Kennung oder null
 */
async function guildZuSchluessel(schluessel) {
    const s = String(schluessel || '');
    if (s.length !== 64) return null;

    const zeilen = await db().query(
        'SELECT guild_id FROM streaming_music_state WHERE schluessel = ? LIMIT 1', [s]);
    return zeilen?.[0]?.guild_id || null;
}

/**
 * Merken, dass der Player sich gemeldet hat.
 *
 * @param {string} guildId Guild
 * @returns {Promise<void>}
 */
async function playerGesehen(guildId) {
    try {
        await db().query(
            'UPDATE streaming_music_state SET player_gesehen = NOW() WHERE guild_id = ?',
            [guildId]);
    } catch {
        /* Ohne den Vermerk spielt die Musik trotzdem */
    }
}

/* ======================================================================
 * Warteschlange
 * ==================================================================== */

/**
 * Die Warteschlange einer Guild.
 *
 * @param {string} guildId Guild
 * @param {{nurOffene?: boolean, grenze?: number}} [wie] Zuschnitt
 * @returns {Promise<Array>} Zeilen
 */
async function warteschlange(guildId, wie = {}) {
    const z = await zustand(guildId);
    const werte = [guildId];
    let wo = 'guild_id = ?';

    // "Offen" heisst: steht hinter dem, was gerade laeuft. Ohne laufenden
    // Titel ist alles offen.
    //
    // **Die Position wird geholt, nicht als Unterabfrage eingesetzt.** Zeigt
    // `aktuelle_id` auf eine weggeraeumte Zeile, liefert eine Unterabfrage
    // NULL - und `position > NULL` ist NULL, also eine leere Liste ohne
    // Fehler. Der Player stuende still und niemand saehe, warum.
    if (wie.nurOffene && z?.aktuelle_id) {
        const jetzige = await db().query(
            'SELECT position FROM streaming_music_queue WHERE id = ? AND guild_id = ? LIMIT 1',
            [z.aktuelle_id, guildId]);

        if (jetzige?.[0]?.position !== undefined) {
            wo += ' AND position > ?';
            werte.push(jetzige[0].position);
        }
        // Kein `else`: Ist der Zeiger tot, gilt die ganze Schlange als offen -
        // das ist der Zustand, aus dem `springen()` wieder herausfindet.
    }

    const grenze = Number(wie.grenze) > 0 ? Math.min(Number(wie.grenze), 100) : 50;
    return await db().query(
        `SELECT * FROM streaming_music_queue WHERE ${wo} ORDER BY position ASC LIMIT ${grenze}`,
        werte);
}

/**
 * Der laufende Titel.
 *
 * @param {string} guildId Guild
 * @returns {Promise<Object|null>} Zeile oder null
 */
async function aktueller(guildId) {
    const z = await zustand(guildId);
    if (!z?.aktuelle_id) return null;

    const zeilen = await db().query(
        'SELECT * FROM streaming_music_queue WHERE id = ? AND guild_id = ? LIMIT 1',
        [z.aktuelle_id, guildId]);
    return zeilen?.[0] || null;
}

/**
 * Einen Titel wuenschen.
 *
 * Gesucht wird **ausschliesslich** ueber die eingetragene Ablage, und die
 * liefert nur Freigegebenes. Ein Rueckfall auf irgendeine andere Quelle waere
 * genau das Loch, gegen das der ganze Weg gebaut ist.
 *
 * @param {string} guildId Guild
 * @param {number|null} streamerId Kanal, soweit bekannt
 * @param {string} begriff Was der Zuschauer getippt hat
 * @param {string|null} wer Anzeigename des Wuenschenden
 * @returns {Promise<{ok: boolean, grund?: string, titel?: string, offen?: number}>} Ergebnis
 */
async function wuenschen(guildId, streamerId, begriff, wer) {
    const quelle = ablage();
    if (!quelle) return { ok: false, grund: 'keine_ablage' };

    const suche = String(begriff || '').trim();
    if (!suche) return { ok: false, grund: 'kein_begriff' };

    const treffer = await quelle.suchen(guildId, suche);
    if (!treffer.length) return { ok: false, grund: 'nicht_gefunden' };

    // **Der erste Treffer, nicht der beste.** Eine Rangfolge ueber Aehnlichkeit
    // waere ein eigenes Thema; solange die Ablage nach Namen sortiert ist, ist
    // der erste Treffer der vorhersehbare - und der Zuschauer sieht im Chat,
    // was er bekommen hat.
    const stueck = treffer[0];

    const naechste = await db().query(
        'SELECT COALESCE(MAX(position), 0) + 1 AS pos FROM streaming_music_queue WHERE guild_id = ?',
        [guildId]);
    const position = Number(naechste?.[0]?.pos || 1);

    await db().query(
        `INSERT INTO streaming_music_queue
            (guild_id, streamer_id, datei_id, titel, dauer_sek, position, gewuenscht_von)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [guildId, streamerId || null, stueck.id, stueck.titel,
         stueck.dauerSek || null, position, wer || null]);

    const offen = await warteschlange(guildId, { nurOffene: true });
    return { ok: true, titel: stueck.titel, offen: offen.length };
}

/**
 * Einen Schritt weiter (oder zurueck).
 *
 * **Ein Weg fuer beide Richtungen.** `skip`, `next` und `prev` unterscheiden
 * sich nur im Vorzeichen; zwei Funktionen waeren zwei Stellen, an denen der
 * Zeiger falsch gesetzt werden kann.
 *
 * @param {string} guildId Guild
 * @param {number} richtung +1 vorwaerts, -1 rueckwaerts
 * @returns {Promise<{ok: boolean, grund?: string, titel?: string}>} Ergebnis
 */
async function springen(guildId, richtung) {
    const z = await zustand(guildId);
    const vor = Number(richtung) >= 0;

    let zeilen;
    if (z?.aktuelle_id) {
        const jetzige = await db().query(
            'SELECT position FROM streaming_music_queue WHERE id = ? AND guild_id = ? LIMIT 1',
            [z.aktuelle_id, guildId]);
        const pos = jetzige?.[0]?.position;

        if (pos === undefined) {
            // Der Zeiger zeigt ins Leere - die Zeile wurde weggeraeumt. Nicht
            // raten, sondern von vorn anfangen.
            zeilen = await db().query(
                'SELECT * FROM streaming_music_queue WHERE guild_id = ? ORDER BY position ASC LIMIT 1',
                [guildId]);
        } else {
            zeilen = await db().query(
                `SELECT * FROM streaming_music_queue
                  WHERE guild_id = ? AND position ${vor ? '>' : '<'} ?
                  ORDER BY position ${vor ? 'ASC' : 'DESC'} LIMIT 1`,
                [guildId, pos]);
        }
    } else {
        zeilen = await db().query(
            'SELECT * FROM streaming_music_queue WHERE guild_id = ? ORDER BY position ASC LIMIT 1',
            [guildId]);
    }

    let ziel = zeilen?.[0];

    // **Endlosmodus sitzt HIER und nicht in `naechster`.** Er stand dort, und
    // damit gingen `!skip` und `!vote` an ihm vorbei: Beide rufen `springen`
    // direkt, bekamen "nichts mehr" und sagten das im Chat, obwohl der Schalter
    // an war. Zwei Wege, einen Titel weiterzugehen, von denen nur einer den
    // Endlosmodus kannte - derselbe Fehler wie zweimal zuvor an diesem Tag.
    //
    // Nur vorwaerts: Rueckwaerts etwas nachzulegen ergibt keinen Sinn, und
    // `!prev` soll ehrlich sagen, dass davor nichts war.
    if (!ziel && vor && z?.endlos) {
        if (await nachlegen(guildId, (await aktueller(guildId))?.datei_id || null)) {
            const nochmal = await db().query(
                'SELECT * FROM streaming_music_queue WHERE guild_id = ? ORDER BY position DESC LIMIT 1',
                [guildId]);
            ziel = nochmal?.[0] || null;
        }
    }

    if (!ziel) return { ok: false, grund: vor ? 'nichts_mehr' : 'nichts_davor' };

    await db().query(
        'UPDATE streaming_music_state SET aktuelle_id = ?, begonnen_am = NOW(), aktiv = 1 WHERE guild_id = ?',
        [ziel.id, guildId]);

    stimmenVergessen(guildId);
    return { ok: true, titel: ziel.titel, id: ziel.id };
}

/**
 * Wiedergabe anhalten oder fortsetzen.
 *
 * **`aktiv` ist der Schalter, den der Player liest, bevor er etwas holt.**
 * Bis hierher wurde das Feld nur geschrieben (in `springen` und `leeren`) und
 * nie gelesen - ein Blindgaenger, gefunden durch die Frage des Betreibers
 * „brauche ich als Admin nicht auch Befehle um das zu starten?".
 *
 * **Starten braucht keinen Befehl.** Der Player nimmt sich den naechsten
 * Titel, sobald einer da ist; ein `!start` waere ein Knopf, den man druecken
 * muss, damit etwas passiert, das ohnehin passieren soll. Gebraucht wird das
 * Gegenteil: **anhalten**, wenn der Streamer reden will. `fortsetzen` ist der
 * Rueckweg dazu und kein zweiter Startmechanismus.
 *
 * @param {string} guildId Guild
 * @param {boolean} an true = spielen, false = anhalten
 * @returns {Promise<{ok: boolean, aktiv: boolean, titel: string|null}>} Stand
 */
async function abspielen(guildId, an) {
    await zustand(guildId);
    await db().query(
        'UPDATE streaming_music_state SET aktiv = ? WHERE guild_id = ?',
        [an ? 1 : 0, guildId]);

    const laeuft = await aktueller(guildId);
    return { ok: true, aktiv: Boolean(an), titel: laeuft?.titel || null };
}

/**
 * Einen Titel aus der Ablage nachlegen, wenn niemand etwas wuenscht.
 *
 * **Nur im Endlosmodus**, und nur aus derselben freigegebenen Ablage, aus der
 * auch `!request` sucht - ein zweiter Weg an `fuerStream()` vorbei waere genau
 * das Loch, gegen das die ganze Ablage gebaut ist.
 *
 * **Zufaellig, aber nicht derselbe wie eben.** Bei sechs Titeln trifft reiner
 * Zufall im Schnitt jeden sechsten Griff denselben - und zweimal hintereinander
 * dasselbe Lied klingt nach Fehler, nicht nach Zufall. Bei nur einem
 * freigegebenen Titel bleibt es zwangslaeufig derselbe; dann ist die
 * Wiederholung die einzige moegliche Antwort und keine Panne.
 *
 * `gewuenscht_von` bleibt NULL: Das hat niemand gewuenscht, und ein erfundener
 * Name waere eine Behauptung ueber eine Person.
 *
 * @param {string} guildId Guild
 * @param {number|null} nichtDatei Datei, die gerade lief
 * @returns {Promise<boolean>} true, wenn etwas nachgelegt wurde
 */
async function nachlegen(guildId, nichtDatei) {
    const quelle = ablage();
    if (!quelle) return false;

    const alle = await quelle.suchen(guildId, null);
    if (!alle.length) return false;

    const auswahl = alle.length > 1 && nichtDatei
        ? alle.filter(t => String(t.id) !== String(nichtDatei))
        : alle;
    const stueck = auswahl[Math.floor(Math.random() * auswahl.length)];
    if (!stueck) return false;

    const naechste = await db().query(
        'SELECT COALESCE(MAX(position), 0) + 1 AS pos FROM streaming_music_queue WHERE guild_id = ?',
        [guildId]);

    await db().query(
        `INSERT INTO streaming_music_queue
            (guild_id, streamer_id, datei_id, titel, dauer_sek, position, gewuenscht_von)
         VALUES (?, NULL, ?, ?, ?, ?, NULL)`,
        [guildId, stueck.id, stueck.titel, stueck.dauerSek || null,
         Number(naechste?.[0]?.pos || 1)]);

    return true;
}

/**
 * Wie weit ist der laufende Titel schon?
 *
 * **Damit ein Szenenwechsel den Titel nicht von vorn anfangen laesst.** OBS
 * laedt die Browserquelle beim Wechsel neu; ohne Versatz begaenne jedes Mal
 * derselbe Anfang, und bei mehreren Wechseln kaeme man nie ans Ende.
 *
 * **Die Grenze steht hier, weil sie sonst niemand kennt:** Gerechnet wird ab
 * `begonnen_am`, und eine Pause verschiebt den Wert nicht. Wer zehn Minuten
 * pausiert, steigt danach zehn Minuten spaeter ein - oder, weil der Versatz
 * nie ueber die Laenge hinausgeht, am Ende. Den Zeitpunkt beim Pausieren
 * fortzuschreiben waere die genauere Loesung; sie braucht aber einen Player,
 * der seine Position meldet, und der meldet heute nur, dass er da ist.
 *
 * @param {Date|string|null} begonnenAm Wann der Titel gestartet wurde
 * @param {number|null} dauerSek Laenge, soweit bekannt
 * @returns {number} Sekunden ab Titelanfang, nie negativ
 */
function versatzAus(begonnenAm, dauerSek) {
    if (!begonnenAm) return 0;

    const sekunden = Math.floor((Date.now() - new Date(begonnenAm).getTime()) / 1000);
    if (!Number.isFinite(sekunden) || sekunden <= 0) return 0;

    // Ohne bekannte Dauer nicht raten: Ein Versatz hinter dem Titelende laesst
    // den Browser sofort `ended` melden, und der Titel waere uebersprungen.
    if (!dauerSek) return sekunden;

    // Zwei Sekunden Rand, damit der Einstieg nicht auf dem letzten Frame liegt.
    return Math.min(sekunden, Math.max(0, dauerSek - 2));
}

/**
 * Was soll der Player spielen?
 *
 * **Die einzige Stelle, die entscheidet, was zu hoeren ist.** Sie traegt
 * deshalb alle Bedingungen zusammen, statt sie auf den Player zu verteilen:
 * angehalten, nichts da, oder die Datei nicht mehr freigegeben.
 *
 * ## `weiter` - der Fehler, den der erste echte Lauf gefunden hat
 *
 * Bis zum 2026-09-07 rueckte diese Funktion **immer** vor. Beim ersten Lauf
 * wechselte der Betreiber die Szene, OBS lud die Browserquelle neu, sie fragte
 * nach - und bekam "nichts mehr", weil der einzige Titel schon der laufende
 * war. Gemessen: `aktuelle_id` stand auf ihm, `player_gesehen` war aktuell, und
 * es blieb still. **Ein neu geladener Player will wissen, was LAEUFT, nicht was
 * DANACH kommt.**
 *
 * Deshalb: `weiter = false` (die Vorgabe) nimmt den laufenden Titel, solange er
 * lieferbar ist. Nur `weiter = true` - nach `ended`, `!skip`, `!vote` - rueckt
 * vor. Laeuft noch gar nichts, faengt auch `false` vorn an; sonst muesste
 * irgendetwas anderes die Wiedergabe starten, und das waere der `!start`, den
 * es bewusst nicht gibt.
 *
 * **Ein nicht mehr lieferbarer Titel wird uebersprungen, nicht beklagt.**
 * Wurde eine Freigabe zurueckgenommen oder die Datei geloescht, liefert
 * `tonquelle()` null - dann geht es weiter, sonst stuende der Stream still,
 * weil eine einzelne Zeile nicht mehr aufloesbar ist. Genau dafuer gibt es
 * keinen Fremdschluessel. Die Schleife ist begrenzt, damit eine Warteschlange
 * aus lauter toten Kennungen nicht zur Endlosschleife wird.
 *
 * @param {string} guildId Guild
 * @param {{weiter?: boolean}} [wie] `weiter` rueckt vor, sonst gilt der laufende
 * @returns {Promise<{spielen: boolean, grund?: string, id?: number, titel?: string, dauerSek?: number|null, versatzSek?: number, uebersprungen?: number}>} Was zu tun ist
 */
async function naechster(guildId, wie = {}) {
    const z = await zustand(guildId);
    if (!z?.aktiv) return { spielen: false, grund: 'angehalten' };

    const quelle = ablage();
    if (!quelle) return { spielen: false, grund: 'keine_ablage' };

    // Der laufende Titel, wenn nicht ausdruecklich weitergerueckt werden soll.
    if (!wie.weiter && z.aktuelle_id) {
        const zeile = await aktueller(guildId);
        if (zeile && await quelle.tonquelle(guildId, zeile.datei_id)) {
            return {
                spielen: true,
                id: zeile.id,
                titel: zeile.titel,
                dauerSek: zeile.dauer_sek ?? null,
                versatzSek: versatzAus(z.begonnen_am, zeile.dauer_sek),
                uebersprungen: 0
            };
        }
        // Nicht mehr lieferbar - dann gilt dasselbe wie beim Weiterruecken.
    }

    let uebersprungen = 0;
    for (let versuch = 0; versuch < 25; versuch++) {
        // `springen` traegt den Endlosmodus selbst - hier steht er bewusst
        // nicht noch einmal.
        const e = await springen(guildId, +1);
        if (!e.ok) return { spielen: false, grund: 'nichts_mehr', uebersprungen };

        const zeile = await aktueller(guildId);
        if (!zeile) return { spielen: false, grund: 'nichts_mehr', uebersprungen };

        const ton = await quelle.tonquelle(guildId, zeile.datei_id);
        if (ton) {
            return {
                spielen: true,
                id: zeile.id,
                titel: zeile.titel,
                dauerSek: zeile.dauer_sek ?? null,
                versatzSek: 0,   // gerade erst begonnen
                uebersprungen
            };
        }

        uebersprungen++;
        log().warn(`[Streaming] Musikwunsch ${zeile.id} ("${zeile.titel}") ist nicht mehr `
                 + `lieferbar - Freigabe zurueckgenommen oder Datei weg. Wird uebersprungen.`);
    }

    // Melden statt ausweichen: 25 tote Zeilen hintereinander sind kein
    // Betriebszustand, sondern ein Befund.
    log().error(`[Streaming] 25 Musikwuensche in Folge nicht lieferbar (Guild ${guildId}) - `
              + 'die Warteschlange zeigt auf Dateien, die es nicht mehr gibt.');
    return { spielen: false, grund: 'nur_tote_zeilen', uebersprungen };
}

/**
 * Die freigegebene Ablage als Chatzeile - oder nur ihre Groesse.
 *
 * **Eine Liste, die nicht passt, wird nicht gekuerzt, sondern gezaehlt.** Eine
 * abgeschnittene Aufzaehlung sieht vollstaendig aus, und der Zuschauer haelt
 * fuer nicht vorhanden, was nur nicht mehr hineinpasste. Die Zahl ist in dem
 * Fall die ehrlichere Auskunft; gefunden wird ohnehin ueber die Suche.
 *
 * Die Grenze ist 380 Zeichen, nicht 500: Der Aufrufer setzt noch einen
 * Vorspann davor ("Das habe ich hier nicht. Da ist: ..."), und Twitch nimmt
 * insgesamt 500.
 *
 * @param {string} guildId Guild
 * @returns {Promise<{anzahl: number, text: string|null}>} Text nur, wenn er passt
 */
async function ablageAufzaehlen(guildId) {
    const quelle = ablage();
    if (!quelle) return { anzahl: 0, text: null };

    const alle = await quelle.suchen(guildId, null);
    if (!alle.length) return { anzahl: 0, text: null };

    const text = alle.map(t => t.titel).join(' · ');
    return { anzahl: alle.length, text: text.length <= 380 ? text : null };
}

/**
 * Die ganze freigegebene Ablage einreihen, in zufaelliger Reihenfolge.
 *
 * **Der Weg, eine Warteschlange zu fuellen, ohne sich sechsmal selbst etwas zu
 * wuenschen.** Der Endlosmodus legt je einen Titel nach, wenn nichts mehr da
 * ist - das haelt den Stream am Laufen, zeigt aber nie eine Liste. Wer sehen
 * will, was kommt, reiht einmal alles ein.
 *
 * Gemischt und nicht alphabetisch: Sonst liefe jede Sendung in derselben
 * Reihenfolge, und `!playlist` waere jedes Mal dieselbe Auskunft.
 *
 * **Ein Durchgang, kein Dauerzustand** - anders als der Endlosmodus. Ist die
 * Liste durch, ist sie durch; wer beides will, schaltet beides ein.
 *
 * @param {string} guildId Guild
 * @returns {Promise<{ok: boolean, grund?: string, anzahl?: number}>} Ergebnis
 */
async function ablageEinreihen(guildId) {
    const quelle = ablage();
    if (!quelle) return { ok: false, grund: 'keine_ablage' };

    const alle = await quelle.suchen(guildId, null);
    if (!alle.length) return { ok: false, grund: 'nichts_frei' };

    // Fisher-Yates auf einer Kopie: `sort(() => Math.random() - .5)` mischt
    // nachweislich schlecht und haengt vom Sortierverfahren ab.
    const gemischt = [...alle];
    for (let i = gemischt.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [gemischt[i], gemischt[j]] = [gemischt[j], gemischt[i]];
    }

    const naechste = await db().query(
        'SELECT COALESCE(MAX(position), 0) AS pos FROM streaming_music_queue WHERE guild_id = ?',
        [guildId]);
    let position = Number(naechste?.[0]?.pos || 0);

    for (const stueck of gemischt) {
        position++;
        await db().query(
            `INSERT INTO streaming_music_queue
                (guild_id, streamer_id, datei_id, titel, dauer_sek, position, gewuenscht_von)
             VALUES (?, NULL, ?, ?, ?, ?, NULL)`,
            [guildId, stueck.id, stueck.titel, stueck.dauerSek || null, position]);
    }

    return { ok: true, anzahl: gemischt.length };
}

/**
 * Den Endlosmodus schalten.
 *
 * @param {string} guildId Guild
 * @param {boolean} an true = weiterspielen, wenn niemand wuenscht
 * @returns {Promise<boolean>} Der neue Stand
 */
async function endlosSchalten(guildId, an) {
    await zustand(guildId);
    await db().query(
        'UPDATE streaming_music_state SET endlos = ? WHERE guild_id = ?',
        [an ? 1 : 0, guildId]);
    return Boolean(an);
}

/**
 * Alles aus der Warteschlange nehmen.
 *
 * @param {string} guildId Guild
 * @returns {Promise<number>} Wie viele Zeilen weg sind
 */
async function leeren(guildId) {
    const weg = await db().query('DELETE FROM streaming_music_queue WHERE guild_id = ?', [guildId]);
    await db().query(
        'UPDATE streaming_music_state SET aktuelle_id = NULL, begonnen_am = NULL, aktiv = 0 WHERE guild_id = ?',
        [guildId]);
    stimmenVergessen(guildId);
    return Number(weg?.affectedRows || 0);
}

/**
 * Gespielte Zeilen wegraeumen, die niemand mehr braucht.
 *
 * @returns {Promise<number>} Wie viele weg sind
 */
async function aufraeumen() {
    try {
        const weg = await db().query(
            `DELETE q FROM streaming_music_queue q
               LEFT JOIN streaming_music_state s
                      ON s.guild_id = q.guild_id AND s.aktuelle_id = q.id
              WHERE s.guild_id IS NULL
                AND q.angelegt_am < (NOW() - INTERVAL ? DAY)`,
            [AUFBEWAHRUNG_TAGE]);
        return Number(weg?.affectedRows || 0);
    } catch (fehler) {
        log().error('[Streaming] Musikwuensche konnten nicht aufgeraeumt werden:', fehler);
        return 0;
    }
}

/* ======================================================================
 * Voteskip - im Arbeitsspeicher, siehe Migration
 * ==================================================================== */

/**
 * @type {Map<string, Set<string>>} guildId -> Kennungen, die gestimmt haben
 *
 * **Setzt einen Dashboard-Prozess voraus.** Gemessen am 2026-09-07: pm2 fuehrt
 * `dashboard-prod` mit genau einer Instanz. Kaemen mehrere dazu, zaehlte jeder
 * Prozess seine eigenen Stimmen und die Abstimmung ginge nie durch - dieselbe
 * Annahme trifft die Abkuehlung im Befehlsbaukasten, also braeche beides
 * zusammen und nicht nur dies hier.
 */
const stimmen = new Map();

/**
 * Die Stimmen einer Guild verwerfen.
 *
 * Laeuft bei jedem Titelwechsel: Stimmen gelten fuer **einen** Titel.
 *
 * @param {string} guildId Guild
 * @returns {void}
 */
function stimmenVergessen(guildId) {
    stimmen.delete(String(guildId));
}

/**
 * Eine Stimme fuers Ueberspringen.
 *
 * @param {string} guildId Guild
 * @param {string} absenderId Kennung des Stimmenden
 * @returns {{schon: boolean, stimmen: number, noetig: number, reicht: boolean}} Stand
 */
function stimmeAbgeben(guildId, absenderId) {
    const schluessel = String(guildId);
    if (!stimmen.has(schluessel)) stimmen.set(schluessel, new Set());

    const menge = stimmen.get(schluessel);
    const kennung = String(absenderId || '');
    const schon = menge.has(kennung);

    if (!schon && kennung) menge.add(kennung);

    return {
        schon,
        stimmen: menge.size,
        noetig: NOETIGE_STIMMEN,
        reicht: menge.size >= NOETIGE_STIMMEN
    };
}

module.exports = {
    zustand, schluesselNeu, guildZuSchluessel, playerGesehen,
    warteschlange, aktueller, wuenschen, springen, leeren, aufraeumen,
    abspielen, naechster, nachlegen, endlosSchalten, ablageEinreihen, ablageAufzaehlen,
    stimmeAbgeben, stimmenVergessen,
    ablage,
    AUFBEWAHRUNG_TAGE, NOETIGE_STIMMEN
};
