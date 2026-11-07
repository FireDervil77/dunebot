'use strict';

/**
 * Was beim Loesen einer Twitch-Verknuepfung wegfaellt (Kassensturz K129,
 * Baustelle 99, 2026-11-07).
 *
 * Bis hierhin loeschte der Knopf "Verknuepfung loesen" genau eine Zeile in
 * `user_connections` (und per Fremdschluessel die Zusagen). Alles, was unter
 * der Verknuepfung entstanden war, blieb stehen: die Abonnentenliste, die mit
 * dem Schluessel des Inhabers geholt wurde, die Abo-Rollen, die Heim-Guild
 * samt Chatbot, und die Ereignis-Abos bei Twitch — die liefen sogar weiter,
 * denn Twitch kennt unser Loesen nicht.
 *
 * Betreiber am 2026-10-29: *„beim Loesen loeschen, was unter der Verknuepfung
 * entstand — schon aus Sicherheitsgruenden"*, Haken `beimLoesen`, am Knopf
 * sagen, was wegfaellt. F2: Kanaleintraege **fremder** Guilds bleiben (eine
 * Ankuendigung braucht keine Verknuepfung, F-16). Am 2026-11-07: Die
 * Chatbot-Einrichtung der Heim-Guild geht mit (*„Mitloeschen"*).
 *
 * ## Zwei Wege hinein, eine Rechnung
 *
 *   sofort       der Kern ruft `nachDemLoesen` nach dem Loeschen des Nachweises
 *                (ueber den Haken `loesen.aufraeumen` der Registry)
 *   nachgeholt   der Tageslauf ruft `nachholen` — fuer den Fall, dass das
 *                Plugin beim Loesen abgeschaltet war (der Kern loest auch
 *                dann, siehe `verbindungen.router.js`) oder Twitch klemmte
 *
 * Beide landen in `ohneNachweis(kanal)`. Die Bedingung ist dieselbe wie
 * ueberall im Plugin: `kanalInhaber()` findet niemanden. Es gibt keinen
 * gespeicherten Vermerk "wurde geloest", der davon abweichen koennte.
 *
 * ## Zuschauer
 *
 * Wer selbst keinen Kanal hat, sondern Abonnent ist, verliert seine Abo-Rolle:
 * `abonnenten.abgleichen` findet fuer sein Twitch-Konto kein Mitglied mehr und
 * nimmt zurueck, was WIR gaben. Sein Eintrag in der Abonnentenliste bleibt —
 * die gehoert dem Kanal, nicht ihm.
 *
 * @module streaming/dashboard/kern/loesen
 */

const { ServiceManager } = require('dunebot-core');
const abonnenten = require('./abonnenten');

/**
 * Die Chatbot-Einrichtung eines Kanals, je Tabelle mit Anzeigenamen.
 * Alle haengen per `streamer_id` am Kanal und entstehen nur in seiner
 * Heim-Guild — die setzen kann nur der Inhaber.
 */
const CHATBOT = [
    ['streaming_commands', 'Befehle'],
    ['streaming_variables', 'Variablen'],
    ['streaming_announcements', 'Ansagen'],
    ['streaming_lose', 'Lose'],
    ['streaming_music_queue', 'Musikwünsche']
];

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
 * Die Ereignisse, die eine Zusage des Inhabers brauchen.
 *
 * @param {string} plattform Plattform
 * @returns {Set<string>} Ereignisnamen
 */
function zusagePflichtig(plattform) {
    const adapter = require('./abos').ADAPTER[plattform];
    const alle = [...(adapter?.EREIGNISSE_ABO || []), ...(adapter?.EREIGNISSE_MELDER || [])];
    return new Set(alle.filter(b => b.scope).map(b => b.typ));
}

/**
 * Was an einem Kanal haengt, das unter der Verknuepfung entstand.
 *
 * @param {Object} kanal Zeile aus streaming_streamers
 * @returns {Promise<Object>} Zahlen und Merkmale
 */
async function bestand(kanal) {
    const zahl = async (sql, p) => Number((await db().query(sql, p))[0]?.n || 0);
    const chatbot = [];
    for (const [tabelle, name] of CHATBOT) {
        chatbot.push({ name, n: await zahl(`SELECT COUNT(*) AS n FROM ${tabelle} WHERE streamer_id = ?`, [kanal.id]) });
    }
    const pflichtig = [...zusagePflichtig(kanal.plattform)];
    return {
        abonnenten: await zahl('SELECT COUNT(*) AS n FROM streaming_subscribers WHERE streamer_id = ?', [kanal.id]),
        aboRolle: await require('./abos').aboRollenGewuenscht(kanal.id),
        heim: kanal.heim_guild_id ? String(kanal.heim_guild_id) : null,
        ansage: Number(kanal.chat_ansage_an) === 1 || Boolean(kanal.chat_ansage_text),
        chatbot: chatbot.filter(c => c.n > 0),
        ereignisse: pflichtig.length
            ? await zahl(`SELECT COUNT(*) AS n FROM streaming_subscriptions WHERE streamer_id = ? AND ereignis IN (${pflichtig.map(() => '?').join(',')})`,
                [kanal.id, ...pflichtig])
            : 0
    };
}

/**
 * @param {Object} b Ergebnis von `bestand`
 * @returns {boolean} true, wenn etwas aufzuraeumen ist
 */
function hatReste(b) {
    return b.abonnenten > 0 || Boolean(b.heim) || b.ansage || b.chatbot.length > 0 || b.ereignisse > 0;
}

/**
 * Die Kanaele, deren Kennung dieses Konto ist.
 *
 * @param {string} plattform Plattform
 * @param {string} kontoId Kontokennung
 * @returns {Promise<Array<Object>>} Zeilen aus streaming_streamers
 */
async function eigeneKanaele(plattform, kontoId) {
    return await db().query('SELECT * FROM streaming_streamers WHERE plattform = ? AND kanal_id = ?',
        [plattform, String(kontoId)]) || [];
}

/**
 * Die Kanaele, bei denen dieses Konto als Abonnent steht und eine Guild eine
 * Abo-Rolle vergibt.
 *
 * @param {string} plattform Plattform
 * @param {string} kontoId Kontokennung
 * @returns {Promise<Array<Object>>} Zeilen aus streaming_streamers
 */
async function abonnierteKanaele(plattform, kontoId) {
    const zeilen = await db().query(`
        SELECT s.* FROM streaming_streamers s
         WHERE s.plattform = ?
           AND EXISTS (SELECT 1 FROM streaming_subscribers a WHERE a.streamer_id = s.id AND a.konto_id = ?)
    `, [plattform, String(kontoId)]) || [];
    const mitRolle = [];
    for (const z of zeilen) {
        if (await require('./abos').aboRollenGewuenscht(z.id)) mitRolle.push(z);
    }
    return mitRolle;
}

/**
 * Was beim Loesen wegfaellt — fuer den Knopf, solange die Verknuepfung noch
 * steht.
 *
 * @param {string} plattform Plattform
 * @param {Object} ctx `{ userId, kontoId }`
 * @returns {Promise<{weg: Array<string>, bleibt: Array<string>}>} Saetze
 */
async function wasWegfaellt(plattform, ctx) {
    const weg = [];
    const bleibt = [];

    for (const kanal of await eigeneKanaele(plattform, ctx.kontoId)) {
        const b = await bestand(kanal);
        const name = kanal.anzeigename || kanal.login;
        if (b.abonnenten) weg.push(`Die Abonnentenliste von ${name} (${b.abonnenten} Einträge)`);
        if (b.aboRolle) weg.push('Die Abo-Rollen deiner Abonnenten — der Bot nimmt sie zurück');
        if (b.heim) weg.push('Die Heim-Guild deines Kanals — der Chatbot verlässt deinen Twitch-Chat');
        if (b.ansage) weg.push('Die Chat-Ansage beim Streamstart');
        if (b.chatbot.length) {
            weg.push(`Die Chatbot-Einrichtung: ${b.chatbot.map(c => `${c.n} ${c.name}`).join(', ')}`);
        }
        if (b.ereignisse) weg.push(`Die Ereignis-Abos bei Twitch, die deine Erlaubnis brauchen (${b.ereignisse})`);
        bleibt.push(`Ankündigungen von ${name}, die Discord-Server eingetragen haben — dafür braucht es keine Verknüpfung`);
    }

    const abonniert = await abonnierteKanaele(plattform, ctx.kontoId);
    if (abonniert.length) {
        weg.push(`Deine Abo-Rolle bei ${abonniert.map(k => k.anzeigename || k.login).join(', ')}`);
    }

    return { weg, bleibt };
}

/**
 * Einen Kanal ohne Inhaber von allem befreien, was unter dessen
 * Verknuepfung entstand.
 *
 * **Nur wenn wirklich niemand verknuepft ist** — die Pruefung steht hier und
 * nicht beim Aufrufer, damit kein Weg hinein sie vergessen kann.
 *
 * Reihenfolge: erst die Daten, dann Twitch. Scheitert das Abbestellen,
 * bleibt die Abo-Zeile stehen (der Tageslauf versucht es wieder), und ein
 * Ereignis, das in der Luecke ankommt, legt keine Liste neu an
 * (`abonnenten.aufnehmen`).
 *
 * @param {Object} kanal Zeile aus streaming_streamers
 * @returns {Promise<Object|null>} Bericht oder null, wenn ein Inhaber da ist
 */
async function ohneNachweis(kanal) {
    if (await abonnenten.kanalInhaber(kanal)) return null;
    const abos = require('./abos');
    const heimguild = require('./heimguild');
    const bericht = { kanal: kanal.login, abonnenten: 0, rollen: 0, chatbot: 0, heim: null, abbestellt: 0 };

    const weg = await db().query('DELETE FROM streaming_subscribers WHERE streamer_id = ?', [kanal.id]);
    bericht.abonnenten = Number(weg?.affectedRows || 0);
    bericht.rollen = (await abonnenten.abgleichen(kanal)).nehmen;

    for (const [tabelle] of CHATBOT) {
        const r = await db().query(`DELETE FROM ${tabelle} WHERE streamer_id = ?`, [kanal.id]);
        bericht.chatbot += Number(r?.affectedRows || 0);
    }

    bericht.heim = kanal.heim_guild_id ? String(kanal.heim_guild_id) : null;
    await db().query(
        'UPDATE streaming_streamers SET heim_guild_id = NULL, chat_ansage_an = 0, chat_ansage_text = NULL WHERE id = ?',
        [kanal.id]);

    bericht.abbestellt += (await abos.aboEreignisseAufraeumen(kanal.id)).abbestellt;
    bericht.abbestellt += (await abos.melderEreignisseAufraeumen(kanal.id)).abbestellt;

    if (bericht.heim) {
        await heimguild.navigationAuffrischen([bericht.heim]);
        heimguild.chatAbosAnstossen();
    }

    log().info(`[Streaming] Kanal ${kanal.login} ohne Verknuepfung aufgeraeumt: `
        + `${bericht.abonnenten} Abonnenten, ${bericht.rollen} Rollen zurueck, ${bericht.chatbot} Chatbot-Zeilen, `
        + `Heim-Guild ${bericht.heim || 'keine'}, ${bericht.abbestellt} Ereignis-Abos abbestellt`);
    return bericht;
}

/**
 * Der Haken fuer den Kern: nach dem Loeschen des Nachweises.
 *
 * **Wirft durch.** Der Kern meldet dann, dass die Verknuepfung geloest ist,
 * das Aufraeumen aber nachgeholt wird — ein stilles Scheitern saehe aus wie
 * ein vollstaendiges Loesen.
 *
 * @param {string} plattform Plattform
 * @param {Object} ctx `{ userId, kontoId }`
 * @returns {Promise<{kanaele: Array<Object>, abonniert: number}>} Bericht
 */
async function nachDemLoesen(plattform, ctx) {
    const kanaele = [];
    for (const kanal of await eigeneKanaele(plattform, ctx.kontoId)) {
        const b = await ohneNachweis(kanal);
        if (b) kanaele.push(b);
    }
    const abonniert = await abonnierteKanaele(plattform, ctx.kontoId);
    for (const kanal of abonniert) await abonnenten.abgleichen(kanal);
    return { kanaele, abonniert: abonniert.length };
}

/**
 * Der Tageslauf: jeden Kanal ohne Inhaber, an dem noch etwas haengt.
 *
 * @returns {Promise<number>} aufgeraeumte Kanaele
 */
async function nachholen() {
    let n = 0;
    for (const kanal of await db().query('SELECT * FROM streaming_streamers') || []) {
        if (await abonnenten.kanalInhaber(kanal)) continue;
        if (!hatReste(await bestand(kanal))) continue;
        if (await ohneNachweis(kanal)) n++;
    }
    return n;
}

module.exports = { wasWegfaellt, nachDemLoesen, nachholen, ohneNachweis, CHATBOT };
