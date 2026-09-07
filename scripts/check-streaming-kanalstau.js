#!/usr/bin/env node
/**
 * Prueft die zwei Bremsen gegen den Stau im Bearbeiten-Eimer eines Kanals.
 *
 * # Der Anlass
 *
 * Gemessen am 2026-09-07 (Baustelle 102). Kanal `1541361923570929735`,
 * vier Streamabende:
 *
 * ```
 * 18:23:34  Ziel 3  bearbeiten   fertig      <- letzter Erfolg
 * 18:29:04  Ziel 3  bearbeiten   aufgegeben  <- ab hier nie wieder
 * 18:33:04  Ziel 5  bearbeiten   aufgegeben
 * 18:33:04  Ziel 6  bearbeiten   fertig      (anderer Kanal, unbeeindruckt)
 * ```
 *
 * Der Kanal laeuft eine halbe Stunde, dann faellt er fuer **beide** Ziele
 * darin aus und erholt sich bis zum Streamende nicht. Seit dem 27.08. ist
 * dort keine einzige Rueckschau mehr zustande gekommen - bei keinem der drei
 * Streamer.
 *
 * # Was geprueft wird
 *
 * Zwei Dinge, die zusammen wirken muessen:
 *
 *   1. **Der Stau wird erkannt und die Bearbeitung ausgesetzt** - sonst legen
 *      die Wiederholungen immer neue Anfragen in einen Eimer, den niemand
 *      leert. Die Sperre gilt je Kanal; ein gesunder Kanal darf nie
 *      mitgesperrt werden (Ziel 6 oben).
 *   2. **Der Rueckbau laeuft weiter und gibt viel spaeter auf.** Er ist der
 *      einzige Auftrag, dessen Ausbleiben dauerhaft sichtbar bleibt: eine
 *      Ankuendigung, die fuer immer auf "ist live" steht.
 *
 * Geprueft wird an den **echten** Funktionen. Datenbank und Bot sind
 * Attrappen; die Attrappe des Bots zaehlt mit, wie oft sie ueberhaupt gerufen
 * wurde - denn genau das ist der Punkt: Ein ausgesetzter Auftrag darf den Bot
 * **gar nicht** erreichen.
 *
 *   node scripts/check-streaming-kanalstau.js
 *
 * Exitcode 1 bei jeder Abweichung.
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../apps/dashboard/.env'), quiet: true });

const { ServiceManager } = require('dunebot-core');

let faelle = 0;
let abweichungen = 0;

/**
 * @param {boolean} gut Bedingung
 * @param {string} text Beschreibung
 * @param {string} [zusatz] Ergaenzung
 * @returns {void}
 */
function pruefe(gut, text, zusatz = '') {
    faelle++;
    if (!gut) abweichungen++;
    console.log(`  ${gut ? '✓' : '✗'} ${text}${zusatz ? '  — ' + zusatz : ''}`);
}

const FRIST = 'streaming:edit hat die Frist von 25000 ms ueberschritten';
const KANAL_A = '1541361923570929735';   // der gestaute
const KANAL_B = '1412384441703202839';   // der gesunde

// ---------------------------------------------------------------------------
// Attrappen. Umgebung, nicht Pruefgegenstand.
// ---------------------------------------------------------------------------

const protokoll = [];
ServiceManager.register('Logger', {
    info: () => {}, debug: () => {}, success: () => {},
    warn: (...a) => protokoll.push(a.map(String).join(' ')),
    error: (...a) => protokoll.push(a.map(String).join(' '))
});

/** Wie der Bot antworten soll - je Kanal einstellbar. */
const bot = { antworten: new Map(), aufrufe: [] };

const unbekannteAbfragen = [];
const geschrieben = [];

/** Ziele, Nachrichten und Auftraege im Speicher. */
const daten = {
    ziele: new Map(),
    nachrichten: new Map(),
    auftraege: new Map()
};

ServiceManager.register('dbService', {
    async getConfig() { return null; },   // keine eigenen Vorlagen: Vorgabe gilt
    async query(sql, werte = []) {
        const s = String(sql).replace(/\s+/g, ' ').trim();

        if (s.startsWith('SELECT t.*, s.plattform')) {
            const z = daten.ziele.get(werte[0]);
            return z ? [z] : [];
        }
        if (s.startsWith("SELECT * FROM streaming_messages")) {
            const n = daten.nachrichten.get(`${werte[0]}|${werte[1]}`);
            return n ? [n] : [];
        }
        if (s.startsWith('UPDATE streaming_messages')) {
            geschrieben.push({ sql: s, werte });
            return [];
        }
        if (s.startsWith('UPDATE streaming_outbox')) {
            geschrieben.push({ sql: s, werte });
            const id = werte[werte.length - 1];
            const zeile = daten.auftraege.get(id);
            if (zeile) {
                if (s.includes("zustand = 'fertig'")) { zeile.zustand = 'fertig'; }
                else if (s.includes('SET versuche = ?')) {
                    zeile.versuche = werte[0]; zeile.fehlertext = werte[1];
                    zeile.zustand = werte[2]; zeile.abstand_s = werte[3];
                }
            }
            return [];
        }

        if (/^(SELECT|INSERT|UPDATE|DELETE)/i.test(s)) unbekannteAbfragen.push(s.slice(0, 90));
        return [];
    }
});

ServiceManager.register('ipcServer', {
    async broadcastOne(ereignis, nutzlast) {
        bot.aufrufe.push({ ereignis, kanal: nutzlast.channelId });
        const antwort = bot.antworten.get(nutzlast.channelId);
        if (antwort === 'frist') return [{ success: false, error: FRIST }];
        return [{ success: true, data: { success: true } }];
    }
});

const drossel = require('../plugins/streaming/dashboard/ausgabe/drossel');
const kanalstau = require('../plugins/streaming/dashboard/ausgabe/kanalstau');

/**
 * Ein Ziel mit stehender Nachricht anlegen.
 *
 * @param {number} id Zielkennung
 * @param {string} kanal Kanalkennung
 * @param {boolean} istLive Ob der Streamer sendet
 * @returns {void}
 */
function zielAnlegen(id, kanal, istLive) {
    daten.ziele.set(id, {
        id, guild_id: 'g1', channel_id: kanal, rolle_id: null,
        onair_channel: null, eigenes_bild: null, aufraeumen: 'rueckschau',
        veroeffentlichen: 0, vorlage: null,
        plattform: 'twitch', login: 'x', anzeigename: 'X', avatar_url: null, streamer_id: id,
        titel: 'T', kategorie: 'K', zuschauer: 1, vorschaubild: null,
        begonnen_am: new Date(Date.now() - 3600_000), beendet_am: null,
        sendung_id: 's1', ist_live: istLive ? 1 : 0
    });
    daten.nachrichten.set(`${id}|s1`, {
        id: id * 100, target_id: id, sendung_id: 's1',
        channel_id: kanal, message_id: `m${id}`, zustand: 'steht'
    });
}

/**
 * Einen Auftrag ausfuehren lassen.
 *
 * @param {number} zielId Zielkennung
 * @param {string} aktion Auftragsart
 * @returns {Promise<Object>} Ergebnis der echten Funktion
 */
function auftrag(zielId, aktion) {
    return drossel.ausfuehren({ id: 1, target_id: zielId, guild_id: 'g1', aktion, nutzlast: '{}', versuche: 0 });
}

(async () => {
    zielAnlegen(5, KANAL_A, true);
    zielAnlegen(6, KANAL_B, true);

    // -----------------------------------------------------------------------
    console.log('\nDer Stauzaehler selbst');
    // -----------------------------------------------------------------------
    kanalstau.leeren();

    kanalstau.fehlversuch(KANAL_A, FRIST);
    pruefe(!kanalstau.gestaut(KANAL_A), 'eine einzelne Frist sperrt nicht');

    for (let i = 2; i < kanalstau.SCHWELLE; i++) kanalstau.fehlversuch(KANAL_A, FRIST);
    pruefe(!kanalstau.gestaut(KANAL_A), `${kanalstau.SCHWELLE - 1} Fristen sperren noch nicht`);

    const ausgeloest = kanalstau.fehlversuch(KANAL_A, FRIST);
    pruefe(kanalstau.gestaut(KANAL_A), `die ${kanalstau.SCHWELLE}. Frist sperrt`);
    pruefe(ausgeloest === true, 'das Ausloesen wird zurueckgemeldet (fuer die Protokollzeile)');
    pruefe(!kanalstau.gestaut(KANAL_B), 'der gesunde Kanal bleibt frei — das ist der ganze Punkt');

    kanalstau.leeren();
    for (let i = 0; i < kanalstau.SCHWELLE + 3; i++) kanalstau.fehlversuch(KANAL_A, 'Nachricht nicht gefunden');
    pruefe(!kanalstau.gestaut(KANAL_A), 'andere Fehler zaehlen nicht mit — nur Fristen');

    kanalstau.leeren();
    for (let i = 0; i < kanalstau.SCHWELLE - 1; i++) kanalstau.fehlversuch(KANAL_A, FRIST);
    kanalstau.erfolg(KANAL_A);
    kanalstau.fehlversuch(KANAL_A, FRIST);
    pruefe(!kanalstau.gestaut(KANAL_A), 'ein Erfolg setzt den Zaehler zurueck');

    // Halb offen: nach Ablauf der Sperre darf einer durch, und die naechste
    // Frist schliesst sofort wieder. Geprueft mit vorgestellter Uhr, damit
    // nicht zehn Minuten gewartet werden muss.
    kanalstau.leeren();
    for (let i = 0; i < kanalstau.SCHWELLE; i++) kanalstau.fehlversuch(KANAL_A, FRIST);
    const echt = Date.now;
    Date.now = () => echt() + kanalstau.DAUER_MS + 1000;
    pruefe(!kanalstau.gestaut(KANAL_A), 'nach Ablauf der Dauer ist der Kanal wieder frei');
    const wieder = kanalstau.fehlversuch(KANAL_A, FRIST);
    pruefe(kanalstau.gestaut(KANAL_A), 'halb offen: eine Frist schliesst sofort wieder');
    pruefe(wieder === true, 'das erneute Schliessen wird auch gemeldet');
    Date.now = echt;

    // -----------------------------------------------------------------------
    console.log('\nDie Bearbeitung wird ausgesetzt — und erreicht den Bot nicht');
    // -----------------------------------------------------------------------
    kanalstau.leeren();
    bot.antworten.set(KANAL_A, 'ok');
    bot.antworten.set(KANAL_B, 'ok');
    bot.aufrufe.length = 0;

    let e = await auftrag(5, 'bearbeiten');
    pruefe(e.ok === true, 'bei freiem Kanal wird bearbeitet');
    pruefe(bot.aufrufe.length === 1, 'und der Bot wird gerufen');

    bot.antworten.set(KANAL_A, 'frist');
    for (let i = 0; i < kanalstau.SCHWELLE; i++) await auftrag(5, 'bearbeiten');
    pruefe(kanalstau.gestaut(KANAL_A), 'genug Fristen aus echten Laeufen sperren den Kanal');
    pruefe(protokoll.some(z => z.includes('gestaut')), 'das Sperren steht im Protokoll');

    bot.aufrufe.length = 0;
    e = await auftrag(5, 'bearbeiten');
    pruefe(bot.aufrufe.length === 0, 'der ausgesetzte Auftrag erreicht den Bot GAR NICHT');
    pruefe(e.ok === false, 'er gilt nicht als erledigt — das waere gelogen');
    pruefe(e.endgueltig === true, 'und er wird nicht noch fuenfmal wiederholt');
    pruefe(/gestaut/.test(String(e.fehler)), 'der Grund steht im Ausgang', String(e.fehler).slice(0, 60));

    bot.aufrufe.length = 0;
    e = await auftrag(6, 'bearbeiten');
    pruefe(bot.aufrufe.length === 1 && e.ok === true,
        'der gesunde Kanal wird weiter bearbeitet — keine Sippenhaft');

    // -----------------------------------------------------------------------
    console.log('\nDer Rueckbau laeuft trotz Sperre');
    // -----------------------------------------------------------------------
    daten.ziele.get(5).ist_live = 0;   // Stream ist zu Ende
    bot.aufrufe.length = 0;
    bot.antworten.set(KANAL_A, 'frist');

    pruefe(kanalstau.gestaut(KANAL_A), 'Vorbedingung: der Kanal ist noch gesperrt');
    e = await auftrag(5, 'aufraeumen');
    pruefe(bot.aufrufe.length === 1, 'der Rueckbau erreicht den Bot trotz Sperre');
    pruefe(e.ok === false && e.endgueltig === false, 'und er wird wiederholt, nicht aufgegeben');

    bot.antworten.set(KANAL_A, 'ok');
    bot.aufrufe.length = 0;
    e = await auftrag(5, 'aufraeumen');
    pruefe(e.ok === true, 'gelingt der Rueckbau, ist er fertig');
    pruefe(!kanalstau.gestaut(KANAL_A), 'und sein Erfolg hebt die Sperre auf');

    // -----------------------------------------------------------------------
    console.log('\nDer Rueckbau gibt viel spaeter auf als alles andere');
    // -----------------------------------------------------------------------
    pruefe(drossel.versuchsGrenze('aufraeumen') > drossel.versuchsGrenze('bearbeiten'),
        'er hat mehr Versuche als die Bearbeitung',
        `${drossel.versuchsGrenze('aufraeumen')} statt ${drossel.versuchsGrenze('bearbeiten')}`);

    let lebensdauerS = 0;
    for (let n = 1; n < drossel.versuchsGrenze('aufraeumen'); n++) lebensdauerS += drossel.abstandS('aufraeumen', n);
    pruefe(lebensdauerS >= 30 * 60,
        'er haelt mindestens eine halbe Stunde durch', `${Math.round(lebensdauerS / 60)} Minuten`);

    let kurzS = 0;
    for (let n = 1; n < drossel.versuchsGrenze('bearbeiten'); n++) kurzS += drossel.abstandS('bearbeiten', n);
    pruefe(kurzS < 5 * 60, 'die Bearbeitung dagegen nicht', `${kurzS} Sekunden`);

    pruefe(drossel.abstandS('aufraeumen', 10) > drossel.ABSTAND_HOECHST_S,
        'sein Abstand waechst ueber die alte Deckelung von 60 s hinaus',
        `${drossel.abstandS('aufraeumen', 10)} s`);

    // Und der Weg durch `abarbeiten` - die Grenze muss dort auch ankommen.
    daten.auftraege.set(77, { id: 77, target_id: 5, guild_id: 'g1', aktion: 'aufraeumen', nutzlast: '{}', versuche: 4, zustand: 'offen' });
    daten.auftraege.set(78, { id: 78, target_id: 5, guild_id: 'g1', aktion: 'bearbeiten', nutzlast: '{}', versuche: 4, zustand: 'offen' });
    bot.antworten.set(KANAL_A, 'frist');
    kanalstau.leeren();

    await drossel.abarbeiten(daten.auftraege.get(77));
    pruefe(daten.auftraege.get(77).zustand === 'offen',
        'nach dem 5. Versuch ist der Rueckbau noch offen', daten.auftraege.get(77).zustand);

    // Beim 5. Versuch betraegt der Abstand planmaessig erst 32 s - die alte
    // Deckelung von 60 s wird ab dem 7. ueberschritten. Deshalb wird hier ein
    // Auftrag geprueft, der schon weiter ist: Sonst prueft der Fall die
    // Deckelung gar nicht, sondern nur eine Zahl, die auch vorher galt.
    daten.auftraege.set(79, { id: 79, target_id: 5, guild_id: 'g1', aktion: 'aufraeumen', nutzlast: '{}', versuche: 7, zustand: 'offen' });
    await drossel.abarbeiten(daten.auftraege.get(79));
    pruefe(daten.auftraege.get(79).abstand_s > 60,
        'beim 8. Versuch wartet er laenger als die alte Deckelung', `${daten.auftraege.get(79).abstand_s} s`);
    pruefe(daten.auftraege.get(79).zustand === 'offen',
        'und ist immer noch nicht aufgegeben', daten.auftraege.get(79).zustand);

    await drossel.abarbeiten(daten.auftraege.get(78));
    pruefe(daten.auftraege.get(78).zustand === 'aufgegeben',
        'die Bearbeitung ist nach dem 5. Versuch aufgegeben', daten.auftraege.get(78).zustand);

    // -----------------------------------------------------------------------
    console.log('\nHat die Attrappe alles gesehen?');
    // -----------------------------------------------------------------------
    pruefe(unbekannteAbfragen.length === 0,
        'keine Abfrage lief an der Attrappe vorbei',
        unbekannteAbfragen.slice(0, 3).join(' | '));

    console.log(`\n${faelle} Faelle, ${abweichungen} Abweichung(en)\n`);
    process.exit(abweichungen ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
