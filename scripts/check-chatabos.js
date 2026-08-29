#!/usr/bin/env node
/**
 * Prueft den **Chat-Anschluss** (Stufe 13a, Rest) - den Schnitt aus TEIL C bis
 * hinunter zur Bestellung bei Twitch.
 *
 * Die eine Sache, die dieses Skript bewacht:
 *
 *     Ein Chat-Abo gibt es NUR fuer Kanaele, deren Inhaber eine Heim-Guild
 *     gewaehlt hat - und nur, solange diese Guild das Plugin auch ausfuehrt.
 *
 * Der Entwurf vom 2026-08-28 nahm noch *jeden beobachteten* Kanal, in dem der
 * Bot zufaellig Moderator war. Das haette den Bot in die Chats fremder
 * Streamer gesetzt, die nie einen Chatbot bestellt haben - und niemand haette
 * einen Ort gehabt, an dem er ihn wieder abstellt.
 *
 * Die zweite Sache, und sie ist genauso wichtig: **Ein Abgleich, der etwas
 * nicht wissen konnte, darf nichts abbestellen.** Eine klemmende Abfrage sieht
 * aus wie "der Bot ist nirgends mehr Mod" - und ein Lauf, der darauf handelt,
 * raeumt saemtliche Chats leer.
 *
 * Nebenwirkungsfrei: Datenbank, Twitch und Protokoll sind Attrappen. Es geht
 * nichts ins Netz und nichts in die echte Datenbank.
 *
 *   node scripts/check-chatabos.js
 *
 * Exitcode 1 bei jeder Abweichung.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');
const { ServiceManager } = require('dunebot-core');

const WURZEL = path.join(__dirname, '..');

let faelle = 0;
let abweichungen = 0;

/**
 * @param {boolean} gut Bedingung
 * @param {string} text Beschreibung
 * @param {string} [zusatz] Warum es zaehlt
 * @returns {void}
 */
function pruefe(gut, text, zusatz = '') {
    faelle++;
    if (gut) { console.log(`  ✓ ${text}`); return; }
    abweichungen++;
    console.log(`  ✗ ${text}`);
    if (zusatz) console.log(`      → ${zusatz}`);
}

/** @param {string} p Pfad ab Projektwurzel @returns {string} Inhalt */
const lies = (p) => fs.readFileSync(path.join(WURZEL, p), 'utf8');

/**
 * Ein Modul durch eine Attrappe ersetzen, bevor es jemand einbindet.
 *
 * **Ueber den Modul-Zwischenspeicher und nicht ueber einen Zeiger im Code.**
 * `chatabos.js` bindet `twitch` und den `Verbindungsspeicher` oben ein; eine
 * Attrappe, die erst danach gesetzt wird, kaeme zu spaet. Und ein Haken im
 * Code, den nur der Test benutzt, waere eine Tuer, die im Betrieb offensteht.
 *
 * @param {string} p Pfad ab Projektwurzel
 * @param {Object} attrappe Was stattdessen herauskommt
 * @returns {void}
 */
function stattdessen(p, attrappe) {
    const voll = require.resolve(path.join(WURZEL, p));
    const m = new Module(voll, null);
    m.filename = voll;
    m.loaded = true;
    m.exports = attrappe;
    require.cache[voll] = m;
}

const stillerLogger = { info() {}, warn() {}, error() {}, debug() {}, success() {} };

// =====================================================================
// Die Welt, in der der Abgleich laeuft - je Fall neu gestellt
// =====================================================================

/** @type {Object} */
let welt;

/** @returns {void} Setzt die Welt auf den Normalfall zurueck */
function weltZuruecksetzen() {
    welt = {
        // Was in `streaming_streamers` steht
        streamer: [
            { kanal_id: '77',  kanal_name: 'FireDervil', heim_guild_id: '42' },
            { kanal_id: '88',  kanal_name: 'Fremder',    heim_guild_id: null }
        ],
        // Welche Guilds laufen (Antwort der zweiten Abfrage)
        laufendeGuilds: ['42'],
        // Was Twitch ueber den Mod-Status sagt
        mod: { ok: true, abgelehnt: false, kanaele: [{ kontoId: '77' }, { kontoId: '88' }] },
        // Was bei Twitch an Abos steht
        abos: { abos: [], kosten: 0, grenze: 10, vollstaendig: true },
        // Antwort auf eine Bestellung
        bestellAntwort: () => ({ ok: true, aboId: 'neu-1', zustand: 'bestaetigt', unbekannt: null, kosten: 0, fehler: null }),
        // Was der Conduit meldet
        conduit: { conduitId: 'c-1', verbunden: true, fehler: null, chat: [] },
        // Gibt es eine Betreiber-Zusage?
        zusage: { konto_id: '999', konto_name: 'firebot_mod', scopes: 'user:bot user:read:chat' },

        // Mitschrift
        bestellt: [],
        abbestellt: [],
        gespeichert: null,
        abfragen: []
    };
}

const twitchAttrappe = {
    EREIGNIS_CHAT: { typ: 'channel.chat.message', version: '1' },
    async moderierteKanaele() { return welt.mod; },
    async abosAuflisten() { return welt.abos; },
    async chatAbonnieren(kanalId, botKontoId, conduitId) {
        welt.bestellt.push({ kanalId, botKontoId, conduitId });
        return welt.bestellAntwort(kanalId);
    },
    async abbestellen(aboId) { welt.abbestellt.push(aboId); return true; }
};

const conduitAttrappe = { zustand: () => ({ ...welt.conduit }) };

const speicherAttrappe = {
    async betreiberZusageLesen() { return welt.zusage; },
    async mitBetreiberZugang(_wozu, tun) {
        if (!welt.zusage) return null;
        return await tun('zugang-xyz');
    }
};

stattdessen('plugins/streaming/dashboard/plattformen/twitch.js', twitchAttrappe);
stattdessen('plugins/streaming/dashboard/eingang/conduit.js', conduitAttrappe);
stattdessen('apps/dashboard/helpers/Verbindungsspeicher.js', speicherAttrappe);

/**
 * Eine Datenbank-Attrappe, die auf bekannte Fragen antwortet.
 *
 * **Unbekannte Abfragen melden statt zu schweigen.** Eine Attrappe, die auf
 * alles `[]` antwortet, wird bei geaenderter Abfrage lautlos blind - und der
 * Test bleibt gruen, waehrend die Sache kaputt ist.
 */
const dbAttrappe = {
    async query(sql, werte) {
        const flach = String(sql).replace(/\s+/g, ' ').trim();
        welt.abfragen.push({ sql: flach, werte });

        if (flach.includes('FROM streaming_streamers')) {
            return welt.streamer.map(s => ({ ...s }));
        }
        if (flach.includes('FROM guilds g')) {
            // Nur die Kennungen zurueckgeben, nach denen wirklich gefragt wurde -
            // sonst pruefte der Test seine eigene Liste statt die Abfrage.
            const gefragt = (werte || []).map(String);
            return welt.laufendeGuilds
                .filter(g => gefragt.includes(String(g)))
                .map(g => ({ guild_id: g }));
        }
        throw new Error(`Attrappe kennt diese Abfrage nicht: ${flach.slice(0, 90)}`);
    },
    async setConfig(plugin, schluessel, wert) { welt.gespeichert = { plugin, schluessel, wert }; },
    async getConfig() { return welt.gespeichert?.wert ?? null; }
};

ServiceManager.register('Logger', stillerLogger);
ServiceManager.register('dbService', dbAttrappe);

const chatabos = require(path.join(WURZEL, 'plugins/streaming/dashboard/kern/chatabos.js'));

(async () => {

// ---------------------------------------------------------------------
console.log('\n1. DER SCHNITT: nur Kanaele mit Heim-Guild');
// ---------------------------------------------------------------------

weltZuruecksetzen();
let soll = await chatabos.gewuenscht(welt.mod.kanaele);
pruefe(soll.length === 1 && soll[0].kanal_id === '77',
    'nur der Kanal MIT Heim-Guild wird gewuenscht',
    `bekommen: ${JSON.stringify(soll.map(s => s.kanal_id))} — der Kanal ohne Heim hat keinen Chatbot bestellt`);
pruefe(soll[0]?.heim_guild_id === '42', 'und die Heim-Guild kommt mit');

weltZuruecksetzen();
welt.streamer = welt.streamer.map(s => ({ ...s, heim_guild_id: null }));
soll = await chatabos.gewuenscht(welt.mod.kanaele);
pruefe(soll.length === 0, 'hat niemand ein Heim gewaehlt, wird nichts abonniert',
    'ein Bot in einem Chat, den niemand bestellt hat, ist ein Zugriff ohne Auftrag');

// ---------------------------------------------------------------------
console.log('\n2. Die beiden anderen Bedingungen');
// ---------------------------------------------------------------------

weltZuruecksetzen();
welt.mod.kanaele = [{ kontoId: '88' }];   // nur der ohne Heim
soll = await chatabos.gewuenscht(welt.mod.kanaele);
pruefe(soll.length === 0, 'ohne Mod-Status wird nichts bestellt',
    'jede Bestellung liefe in eine Ablehnung — Twitch verlangt Mod oder `channel:bot`');

weltZuruecksetzen();
welt.laufendeGuilds = [];                 // Heim-Guild hat das Plugin aus
soll = await chatabos.gewuenscht(welt.mod.kanaele);
pruefe(soll.length === 0,
    'laeuft das Plugin in der Heim-Guild nicht, wird nichts bestellt',
    'sonst sitzt der Bot im Chat, waehrend die einzige Stelle, die ihn bedient, weg ist');

weltZuruecksetzen();
welt.mod = { ok: true, abgelehnt: false, kanaele: [] };
soll = await chatabos.gewuenscht(welt.mod.kanaele);
pruefe(soll.length === 0 && welt.abfragen.length === 0,
    'ohne einen einzigen Mod-Kanal wird die Datenbank gar nicht erst gefragt');

// ---------------------------------------------------------------------
console.log('\n3. Kein Join ueber die Kollationsgrenze');
// ---------------------------------------------------------------------

const quelle = lies('plugins/streaming/dashboard/kern/chatabos.js');
pruefe(!/JOIN\s+guilds\s+g\s+ON\s+g\._id\s*=\s*[a-z]+\./i.test(quelle),
    'keine Plugin-Spalte wird direkt an `guilds._id` verglichen',
    '`streaming_*` ist utf8mb4_general_ci, der Kern utf8mb4_unicode_ci — so ein Join WIRFT');
pruefe(/g\._id\s+IN\s*\(/.test(quelle),
    'die Guilds werden ueber gebundene Kennungen geholt',
    'ein gebundener Wert nimmt die Kollation seiner Spalte an, da gibt es nichts zu mischen');

// ---------------------------------------------------------------------
console.log('\n4. DIE ZWEITE ZUSAGE: wer nichts weiss, raeumt nichts weg');
// ---------------------------------------------------------------------

/** @returns {void} Ein Abo, das da ist und wegkoennte */
function einAboStehtSchon() {
    welt.abos = {
        abos: [{ anbieter_abo_id: 'alt-1', ereignis: 'channel.chat.message',
                 kanal_id: '999', zustand: 'bestaetigt' }],
        kosten: 0, grenze: 10, vollstaendig: true
    };
}

weltZuruecksetzen();
einAboStehtSchon();
welt.mod = { ok: false, abgelehnt: false, kanaele: [] };
let b = await chatabos.abgleichen();
pruefe(b.abgebrochen === 'Mod-Status nicht abfragbar', 'klemmt die Mod-Abfrage, bricht der Lauf ab');
pruefe(welt.abbestellt.length === 0 && welt.bestellt.length === 0,
    'und es wird NICHTS abbestellt',
    'eine klemmende Abfrage sieht aus wie „nirgends mehr Mod" — danach waeren alle Chats leer');

weltZuruecksetzen();
einAboStehtSchon();
welt.mod = { ok: false, abgelehnt: true, kanaele: [] };
b = await chatabos.abgleichen();
pruefe(/abgelehnt/i.test(b.abgebrochen || ''), 'ein abgelehnter Schluessel wird als solcher benannt',
    '„nicht abfragbar" und „Schluessel kaputt" fuehren zu verschiedenen Handgriffen');

weltZuruecksetzen();
einAboStehtSchon();
welt.abos.vollstaendig = false;
b = await chatabos.abgleichen();
pruefe(/unvollstaendig/i.test(b.abgebrochen || '') && welt.abbestellt.length === 0,
    'bei halber Abo-Liste wird nichts abbestellt',
    'die halbe Liste sieht aus wie „die Haelfte ist weg" — ein Lauf darauf bestellt sie ab');

weltZuruecksetzen();
welt.conduit.conduitId = null;
b = await chatabos.abgleichen();
pruefe(/Conduit/i.test(b.abgebrochen || '') && welt.bestellt.length === 0,
    'ohne Conduit wird nichts bestellt',
    'ein Abo braucht ein Ziel fuer die Zustellung — der Eingang kommt zuerst');

weltZuruecksetzen();
welt.zusage = null;
b = await chatabos.abgleichen();
pruefe(/Bot-Konto/i.test(b.abgebrochen || ''), 'ohne zugelassenes Bot-Konto bricht der Lauf ab');

// ---------------------------------------------------------------------
console.log('\n5. Der gelungene Lauf');
// ---------------------------------------------------------------------

weltZuruecksetzen();
einAboStehtSchon();          // '999' steht, ist aber nicht gewuenscht
b = await chatabos.abgleichen();
pruefe(b.abgebrochen === null, 'der Normalfall laeuft durch', b.abgebrochen || '');
pruefe(welt.bestellt.length === 1 && welt.bestellt[0].kanalId === '77',
    'der gewuenschte Kanal wird bestellt');
pruefe(welt.bestellt[0]?.botKontoId === '999',
    '`user_id` ist das BOT-Konto, nicht der Kanal',
    'mit der Kanal-ID an beiden Stellen lehnt Twitch ab — dem Streamer fehlt die Zusage');
pruefe(welt.abbestellt.length === 1 && welt.abbestellt[0] === 'alt-1',
    'ein Abo ohne Heim wird abbestellt');
pruefe(b.kanaele.length === 1 && b.kanaele[0].zustand === 'bestaetigt',
    'der Bericht traegt den Zustand je Kanal');
pruefe(welt.gespeichert?.schluessel === 'CHATABO_BERICHT',
    'der Bericht wird gespeichert — die Seite liest ihn');

weltZuruecksetzen();
welt.bestellAntwort = () => ({ ok: false, aboId: null, zustand: null, unbekannt: null, kosten: 0,
                              fehler: 'subscription missing proof of authorization' });
b = await chatabos.abgleichen();
pruefe(b.fehler.length === 1 && /proof of authorization/.test(b.fehler[0]),
    'Twitchs Ablehnung wird durchgereicht, nicht gedeutet',
    'sie nennt bei diesem Ereignis meist genau, welche Zustimmung fehlt');
pruefe(b.kanaele.length === 1 && b.kanaele[0].fehler,
    'der abgelehnte Kanal bleibt in der Liste',
    'ein Kanal, der verschwindet, sieht aus wie einer, der in Ordnung ist');

// ---------------------------------------------------------------------
console.log('\n6. Der Riegel gegen den doppelten Lauf');
// ---------------------------------------------------------------------

weltZuruecksetzen();
const [erst, zweit] = await Promise.all([chatabos.abgleichen(), chatabos.abgleichen()]);
const doppelt = [erst, zweit].filter(x => x.abgebrochen === 'Es laeuft schon ein Abgleich');
pruefe(doppelt.length === 1, 'zwei gleichzeitige Laeufe: einer arbeitet, einer tritt zurueck',
    'sonst lesen beide denselben Ist-Zustand und bestellen beide');
pruefe(welt.bestellt.length === 1, 'und es wird genau einmal bestellt');

// ---------------------------------------------------------------------
console.log('\n7. Es gibt Aufrufer — die Mechanik liegt nicht brach');
// ---------------------------------------------------------------------

const takt = lies('plugins/streaming/dashboard/kern/takt.js');
pruefe(/require\('\.\/chatabos'\)\.abgleichen\(\)/.test(takt),
    'der Tageslauf gleicht die Chat-Abos ab',
    'ungenutzte Mechanik versagt beim ersten Einsatz lautlos');
pruefe(takt.indexOf("require('./aufraeumen')") < takt.indexOf("require('./chatabos')"),
    'und zwar NACH dem Aufraeumen',
    'der Aufraeumer loescht Streamer mitsamt ihrer heim_guild_id');

const hg = lies('plugins/streaming/dashboard/kern/heimguild.js');
pruefe(/chatAbosAnstossen\(\)/.test(hg) && (hg.match(/chatAbosAnstossen\(\);/g) || []).length === 2,
    'die Wahl der Heim-Guild stoesst den Anschluss an — beim Setzen UND beim Abschalten',
    'sonst bliebe der Bot einen Tag laenger sitzen, als jemand ihn haben wollte');

const router = lies('plugins/streaming/dashboard/routes/guild.router.js');
pruefe(/router\.post\('\/chatbot\/abgleich'/.test(router), 'die Seite hat einen Knopf dafuer');
pruefe(/router\.post\('\/chatbot\/abgleich',\s*requirePermission\('STREAMING\.CHAT\.MANAGE'\)/.test(router),
    'und er haengt an STREAMING.CHAT.MANAGE');
pruefe(/istHeim\(guildId\)/.test(router.slice(router.indexOf("/chatbot/abgleich"))),
    'die Route prueft ausserdem, dass diese Guild ueberhaupt ein Heim ist',
    'der Abgleich betrifft alle Kanaele der Anlage, nicht nur die dieser Guild');

// ---------------------------------------------------------------------
console.log('\n8. Der Empfang zaehlt und speichert nichts');
// ---------------------------------------------------------------------

// Die echte Datei, nicht die Attrappe von oben.
const conduitQuelle = lies('plugins/streaming/dashboard/eingang/conduit.js');

/**
 * **Ohne die Blockkommentare.** Die Datei benennt in ihrer Erklaerung genau
 * die Felder, die sie NICHT anfasst - das ist die halbe Begruendung, warum sie
 * so gebaut ist. Eine Suche ueber die ganze Datei fiele darauf herein und
 * meldete den Kommentar als Verstoss.
 *
 * Zeilenkommentare bleiben stehen: Ein `//` liesse sich hier nicht entfernen,
 * ohne die Adresse `wss://eventsub.wss.twitch.tv/ws` mitzunehmen.
 */
const ohneErklaerung = conduitQuelle.replace(/\/\*[\s\S]*?\*\//g, '');

pruefe(/chatGezaehlt\(nutz\)/.test(conduitQuelle),
    'eine Chatnachricht wird gezaehlt');
pruefe(!/message\.text|chatter_user|message_id|broadcaster_user_id/.test(ohneErklaerung),
    'der Eingang fasst weder Twitchs Feldnamen noch Text oder Absender an',
    'ob Chatverlaeufe gespeichert werden duerfen, gehoert zur Rechtspruefung — nicht in einen Zaehler');
pruefe(/chatter_user/.test(conduitQuelle),
    'und die Datei sagt ausdruecklich, dass sie es nicht tut',
    'eine Regel, die nur im Kopf des Erbauers steht, ueberlebt die naechste Aenderung nicht');

// Der Uebersetzer selbst: Er darf die Kennung mitnehmen und sonst nichts.
const twitchQuelle = lies('plugins/streaming/dashboard/plattformen/twitch.js');
const chatAus = twitchQuelle.slice(twitchQuelle.indexOf('function chatAus'),
                                  twitchQuelle.indexOf('function abbestellen'));
pruefe(/broadcaster_user_id/.test(chatAus) && !/message|chatter_user/.test(chatAus),
    '`chatAus` uebersetzt nur die Kanalkennung, nicht den Inhalt',
    'ein Uebersetzer, der schon mal alles mitnimmt, macht die Entscheidung fuer die Rechtspruefung');
pruefe(/twitch\.EREIGNIS_CHAT\.typ/.test(conduitQuelle),
    'der Ereignistyp kommt aus einer Stelle, nicht aus zwei Zeichenketten');

// ---------------------------------------------------------------------
const wort = abweichungen === 1 ? 'Abweichung' : 'Abweichungen';
console.log(`\nErgebnis: ${faelle} Pruefungen, ${abweichungen} ${wort}.\n`);
process.exit(abweichungen ? 1 : 0);

})().catch(err => {
    console.error('\nAbbruch:', err.message, '\n', err.stack);
    process.exit(1);
});
