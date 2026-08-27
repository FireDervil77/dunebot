'use strict';

/**
 * Streaming - Melder (Stufe 12c).
 *
 * Raids, Geschenk-Abos, Bits, Follows und Abonnements als **Meldung** im
 * Discord. Sie ruehren weder Sendezustand noch Rollen an: Ein Follow aendert
 * nichts, es ist nur eine Nachricht wert.
 *
 * ## Die drei Regeln, die hier haengen
 *
 * **1. Der Adapter sagt, was ein Melder braucht — nicht dieser Kern.** Welches
 * Twitch-Ereignis hinter `bits` steht und welche Zusage es kostet, steht in
 * `EREIGNISSE_MELDER`. Hier steht nur, was der Adapter nicht wissen kann: wie
 * die Art auf Deutsch heisst und ob sie gesammelt wird. Wer die Zuordnung
 * hier zweitschreibt, hat sie beim naechsten Ereignis an einer Stelle
 * vergessen.
 *
 * **2. Ohne Zusage wird nicht bestellt.** `bits:read` und
 * `moderator:read:followers` gibt nur der Kanalinhaber. Fehlt seine Zusage,
 * wird das Ereignis gar nicht erst abonniert — Twitch lehnte es ohnehin ab,
 * und ein Abo im Zustand `fehler` sieht aus wie eine Stoerung, obwohl nur
 * niemand gefragt wurde. `raid` braucht **keine** Zusage; das ist der Grund,
 * warum Raids auch fuer fremd eingetragene Kanaele funktionieren.
 *
 * **3. Gesammelt wird im Ausgang, nicht im Speicher.** Ein Follow-Schub
 * erzeugt hunderte Ereignisse in Minuten. Statt hunderter Nachrichten wird in
 * einem Fenster von 60 Sekunden in den **schon offenen** Auftrag
 * hineingeschrieben. Das braucht keinen neuen Mechanismus: `faellig_ab` und
 * `zustand` im Ausgang tragen das Fenster.
 *
 * Raids werden **nicht** gesammelt. Ein Raid ist einmalig und der Moment
 * zaehlt; ihn 60 Sekunden liegen zu lassen, waere die eine Meldung, bei der
 * Verzug wehtut.
 *
 * ## Wovon das Zusammenlegen ausgeht
 *
 * Der Posteingang laeuft seriell (`laeuftGerade` in `takt.js`, eine
 * `for`-Schleife mit `await`) und in **einem** Dashboard-Vorgang. Deshalb
 * genuegt Lesen-und-Schreiben ohne Sperre. Kaeme je ein zweiter Vorgang dazu,
 * waere die Folge nicht Datenverlust, sondern eine zweite Nachricht — der
 * Zustand vor dem Sammeln. Benannt, damit es nicht jemand fuer einen Fehler
 * haelt.
 *
 * @module streaming/dashboard/kern/melder
 */

const { ServiceManager } = require('dunebot-core');

/**
 * Die gueltigen Melderarten.
 *
 * Der Schluessel ist derselbe Name, den der Adapter in `melder` traegt — das
 * ist die Naht, und `scripts/check-streaming-melder.js` haelt beide Seiten
 * zusammen. Reihenfolge = Anzeigereihenfolge auf der Ziele-Seite.
 *
 * `fensterMs = 0` heisst: sofort, nicht sammeln.
 *
 * @type {Object<string, {label: string, hinweis: string, fensterMs: number}>}
 */
const ARTEN = {
    raid:        { label: 'Raids',              hinweis: 'Wenn ein anderer Kanal seine Zuschauer herschickt.', fensterMs: 0 },
    abonniert:   { label: 'Neue Abonnements',   hinweis: 'Braucht dieselbe Zusage wie die Abonnenten-Rolle.',  fensterMs: 60000 },
    verlaengert: { label: 'Verlängerte Abos',   hinweis: 'Wer sein Abo weiterführt, mit Monatszahl.',          fensterMs: 60000 },
    geschenkt:   { label: 'Geschenkte Abos',    hinweis: 'Anonyme Schenkende werden nicht benannt.',           fensterMs: 60000 },
    bits:        { label: 'Bits',               hinweis: 'Braucht eine eigene Zusage des Kanalinhabers.',      fensterMs: 60000 },
    follow:      { label: 'Neue Follower',      hinweis: 'Kommt im Schub — wird 60 Sekunden gesammelt.',       fensterMs: 60000 }
};

/**
 * Hoechstens so viele Einzelangaben stehen in einem gesammelten Auftrag.
 *
 * **Nicht die Zahl der Meldungen, sondern die Zahl der Namen.** Ein Raid mit
 * 400 Zuschauern kann 400 Follows nach sich ziehen; die Nutzlast waechst sonst
 * mit. Gezaehlt wird trotzdem alles — `anzahl` bleibt ehrlich, nur die Namen
 * hoeren nach 25 auf.
 */
const HOECHSTENS_NAMEN = 25;

/**
 * @returns {Object} Datenbankdienst
 */
function db() {
    return ServiceManager.get('dbService');
}

/**
 * @returns {Object} Protokoll
 */
function log() {
    return ServiceManager.get('Logger');
}

/**
 * Die Spalte `melder_arten` in eine Liste.
 *
 * **Unbekannte Namen fallen weg, statt durchgereicht zu werden.** Ein
 * Tippfehler in der Spalte darf nicht dazu fuehren, dass ein Ereignis
 * abonniert wird, das niemand gemeint hat — und auch nicht dazu, dass eine
 * Meldung an einer Stelle auftaucht, an der sie in der Oberflaeche nicht
 * angehakt ist.
 *
 * @param {string|null} spalte Inhalt von `melder_arten`
 * @returns {Array<string>} gueltige Arten, ohne Doppelte
 */
function artenLesen(spalte) {
    if (!spalte) return [];
    const roh = String(spalte).split(',').map(s => s.trim()).filter(Boolean);
    return [...new Set(roh.filter(a => Object.prototype.hasOwnProperty.call(ARTEN, a)))];
}

/**
 * Eine Liste in die Spalte `melder_arten`.
 *
 * @param {Array<string>} liste Arten
 * @returns {string|null} Spaltenwert; `null`, wenn nichts gewaehlt ist
 */
function artenSchreiben(liste) {
    const gut = artenLesen((liste || []).join(','));
    return gut.length ? gut.join(',') : null;
}

/**
 * Die Ereignisbeschreibung des Adapters zu einer Melderart.
 *
 * @param {Object} adapter Plattform-Adapter
 * @param {string} art Melderart
 * @returns {Object|null} Beschreibung oder null
 */
function beschreibungFuer(adapter, art) {
    const alle = [...(adapter?.EREIGNISSE_ABO || []), ...(adapter?.EREIGNISSE_MELDER || [])];
    return alle.find(b => b.melder === art) || null;
}

/**
 * Welche Melderarten braucht dieser Kanal ueberhaupt?
 *
 * Referenzzaehlung wie bei allem anderen: Es genuegt EINE Guild, die eine Art
 * will, und es braucht keine mehr, sobald die letzte sie abwaehlt.
 *
 * @param {number} streamerId Streamer
 * @returns {Promise<Array<string>>} Arten
 */
async function gewuenschteArten(streamerId) {
    const zeilen = await db().query(
        'SELECT melder_arten FROM streaming_targets WHERE streamer_id = ? AND aktiv = 1', [streamerId]);
    const alle = new Set();
    for (const z of zeilen) for (const a of artenLesen(z.melder_arten)) alle.add(a);
    return [...alle];
}

/**
 * Welche Ereignisse muessen fuer die Melder bestellt werden?
 *
 * **Die Zusage entscheidet mit.** Wer `bits` anhakt, ohne dass der
 * Kanalinhaber `bits:read` erteilt hat, bekommt hier nichts — und das ist
 * richtig: Twitch lehnte das Abo ab, und die Zeile stuende auf `fehler`, als
 * waere etwas kaputt.
 *
 * @param {number} streamerId Streamer
 * @param {Object} adapter Plattform-Adapter
 * @param {Array<string>} erteilteScopes Scopes des Kanalinhabers
 * @returns {Promise<{bestellen: Array<Object>, fehltZusage: Array<{art: string, scope: string}>}>} Ergebnis
 */
async function melderEreignisse(streamerId, adapter, erteilteScopes = []) {
    const haben = new Set(erteilteScopes || []);
    const bestellen = [];
    const fehltZusage = [];

    for (const art of await gewuenschteArten(streamerId)) {
        const b = beschreibungFuer(adapter, art);
        if (!b) continue;
        if (b.scope && !haben.has(b.scope)) { fehltZusage.push({ art, scope: b.scope }); continue; }
        if (!bestellen.some(x => x.typ === b.typ)) bestellen.push(b);
    }

    return { bestellen, fehltZusage };
}

/**
 * Die Ziele, die eine bestimmte Melderart wollen — mit dem Kanal, in den sie soll.
 *
 * **Der Rueckfall auf den Ankuendigungskanal ist eine Entscheidung des
 * Betreibers** (2026-08-27), kein Versehen. Der Einwand dagegen steht in der
 * Migration; entschaerft wird er auf der Ziele-Seite, die beim Anschalten
 * sagt, wohin gemeldet wird.
 *
 * @param {number} streamerId Streamer
 * @param {string} art Melderart
 * @returns {Promise<Array<Object>>} Ziele mit `kanal`
 */
async function zieleFuer(streamerId, art) {
    const zeilen = await db().query(
        'SELECT id, guild_id, channel_id, melder_channel_id, melder_arten ' +
        'FROM streaming_targets WHERE streamer_id = ? AND aktiv = 1', [streamerId]);

    return zeilen
        .filter(z => artenLesen(z.melder_arten).includes(art))
        .map(z => ({ ...z, kanal: z.melder_channel_id || z.channel_id }))
        .filter(z => Boolean(z.kanal));
}

/**
 * Zwei Nutzlasten derselben Art zusammenlegen.
 *
 * Reine Funktion, damit sich die Faelle durchspielen lassen, die im Betrieb
 * selten sind und dann wehtun: die 26. Person, eine Meldung ohne Namen, eine
 * Menge, die fehlt.
 *
 * @param {Object} alt Bestehende Nutzlast
 * @param {Object} neu Neue Nutzlast
 * @returns {Object} zusammengelegt
 */
function zusammenlegen(alt, neu) {
    const posten = [...(alt.posten || []), ...(neu.posten || [])];
    const anzahl = (Number(alt.anzahl) || 0) + (Number(neu.anzahl) || 0);

    // Mengen addieren sich nur, wo sie dasselbe zaehlen: Bits und geschenkte
    // Abos ja, Monate eines Abonnements nicht — "42 Monate" waere aus drei
    // Verlaengerungen zusammengerechnet und schlicht falsch.
    const summiert = alt.art === 'bits' || alt.art === 'geschenkt';
    const summe = summiert
        ? (Number(alt.summe) || 0) + (Number(neu.summe) || 0)
        : null;

    return {
        ...alt,
        anzahl,
        summe,
        posten: posten.slice(0, HOECHSTENS_NAMEN),
        // Ehrlich sagen, dass Namen fehlen — sonst liest sich "5 Follower:
        // A, B" wie ein Fehler.
        gekuerzt: posten.length > HOECHSTENS_NAMEN
    };
}

/**
 * Eine Meldung veranlassen.
 *
 * @param {Object} streamer Streamer
 * @param {Object} angaben Melder-Angaben des Adapters (`melderAus`)
 * @returns {Promise<string>} Klartext fuers Protokoll
 */
async function melden(streamer, angaben) {
    const art = angaben?.was;
    if (!art || !ARTEN[art]) return `Melderart "${art}" ist unbekannt`;

    const ziele = await zieleFuer(streamer.id, art);
    if (!ziele.length) return `${ARTEN[art].label}: niemand will sie`;

    const fensterMs = ARTEN[art].fensterMs;
    let neu = 0;
    let ergaenzt = 0;

    for (const ziel of ziele) {
        const nutzlast = {
            streamer_id: streamer.id,
            art,
            kanal: ziel.kanal,
            anzahl: 1,
            summe: (art === 'bits' || art === 'geschenkt') ? (Number(angaben.menge) || 0) : null,
            posten: [{
                person: angaben.person || null,
                menge: Number(angaben.menge) || null,
                stufe: angaben.stufe || null,
                geschenkt: Boolean(angaben.geschenkt)
            }],
            gekuerzt: false
        };

        const offener = fensterMs > 0 ? await offenerAuftrag(ziel.id, art) : null;

        if (offener) {
            await db().query('UPDATE streaming_outbox SET nutzlast = ? WHERE id = ?',
                [JSON.stringify(zusammenlegen(offener.nutzlast, nutzlast)), offener.id]);
            ergaenzt++;
            continue;
        }

        await db().query(`
            INSERT INTO streaming_outbox (target_id, guild_id, aktion, nutzlast, faellig_ab)
            VALUES (?, ?, 'melden', ?, DATE_ADD(NOW(3), INTERVAL ? MICROSECOND))
        `, [ziel.id, ziel.guild_id, JSON.stringify(nutzlast), fensterMs * 1000]);
        neu++;
    }

    return `${ARTEN[art].label}${angaben.person ? ` (${angaben.person})` : ''}`
         + ` - ${neu} Auftrag/Auftraege, ${ergaenzt} ergaenzt`;
}

/**
 * Ein noch wartender Melde-Auftrag derselben Art fuer dasselbe Ziel.
 *
 * **`faellig_ab > NOW(3)` ist die Bedingung, nicht `zustand = 'offen'`
 * allein.** Ein Auftrag, dessen Zeit gekommen ist, kann im selben Augenblick
 * vom Ausgang gegriffen werden; ihn dann noch zu ergaenzen hiesse, in eine
 * Nachricht zu schreiben, die schon unterwegs ist.
 *
 * @param {number} zielId Ziel
 * @param {string} art Melderart
 * @returns {Promise<{id: number, nutzlast: Object}|null>} Auftrag oder null
 */
async function offenerAuftrag(zielId, art) {
    const zeilen = await db().query(`
        SELECT id, nutzlast FROM streaming_outbox
         WHERE target_id = ? AND aktion = 'melden' AND zustand = 'offen'
           AND faellig_ab > NOW(3)
         ORDER BY id DESC LIMIT 5
    `, [zielId]);

    for (const z of zeilen) {
        let nutzlast;
        try {
            nutzlast = typeof z.nutzlast === 'string' ? JSON.parse(z.nutzlast) : z.nutzlast;
        } catch (err) {
            // Eine unlesbare Nutzlast ist ein Befund, kein Grund zu schweigen.
            // Sie wird uebersprungen, nicht ueberschrieben - der Ausgang soll
            // seinen eigenen Fehler melden duerfen.
            log().warn(`[Streaming/Melder] Auftrag ${z.id} hat eine unlesbare Nutzlast: ${err.message}`);
            continue;
        }
        if (nutzlast && nutzlast.art === art) return { id: z.id, nutzlast };
    }

    return null;
}

module.exports = {
    ARTEN, HOECHSTENS_NAMEN,
    artenLesen, artenSchreiben, beschreibungFuer,
    gewuenschteArten, melderEreignisse, zieleFuer,
    zusammenlegen, melden, offenerAuftrag
};
