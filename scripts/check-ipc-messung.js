#!/usr/bin/env node
/**
 * Prueft, dass der Bot **sagt**, wie lange er gebraucht hat — und dass er
 * Discords Ratenbremse hoert.
 *
 * Beides kam am 2026-08-26 aus Baustelle 76. Dort war die Ursachensuche an
 * einer Wand geendet: Ein `streaming:edit` brauchte exakt 1200 s bis zur
 * Antwort, 23-mal hintereinander, und im Bot-Protokoll stand zwischen
 * "empfaengt IPC-Event" und der naechsten Zeile **nichts**. Es liess sich
 * nicht einmal entscheiden, ob der Handler lange rechnete oder die Antwort
 * auf dem Rueckweg verlorenging.
 *
 * Das Skript **liest nicht, es benutzt**: Es baut einen echten `IPCClient`,
 * schickt ihm eine echte Nachricht mit einem langsamen Handler und sieht nach,
 * was im Protokoll landet. Fuer die Ratenbremse wird ein echtes `REST` aus
 * `@discordjs/rest` angelegt und ein echtes `rateLimited` ausgeloest.
 *
 * Nebenwirkungsfrei: keine Datenbank, kein Netz, kein Discord-Token.
 *
 *   node scripts/check-ipc-messung.js
 *
 * Exitcode 1 bei jeder Abweichung.
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../apps/dashboard/.env'), quiet: true });

// Der IPCClient besteht im Konstruktor auf beidem, bevor irgendetwas laeuft.
process.env.IPC_SERVER_PORT = process.env.IPC_SERVER_PORT || '4500';
process.env.IPC_SERVER_HOST = process.env.IPC_SERVER_HOST || 'localhost';

const { REST } = require('@discordjs/rest');
const Ratenbremse = require('../apps/bot/helpers/Ratenbremse');
const IPCClient   = require('../apps/bot/helpers/IPCClient');

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

/** Sammelt Protokollzeilen, statt sie auszugeben. */
function sammler() {
    const zeilen = [];
    const nimm = (stufe) => (...a) => zeilen.push({ stufe, text: a.map(String).join(' ') });
    return {
        zeilen,
        info: nimm('info'), debug: nimm('debug'), warn: nimm('warn'),
        error: nimm('error'), success: nimm('success'),
        hat: (stufe, teil) => zeilen.some(z => z.stufe === stufe && z.text.includes(teil))
    };
}

/**
 * Ein IPCClient mit Attrappen ringsum — echter Code, erfundene Umgebung.
 *
 * @param {Function} handler Der Plugin-Handler, der geprueft werden soll
 * @returns {{client: Object, log: Object}} Client und Protokollsammler
 */
function bauen(handler) {
    const client = new IPCClient({
        shard: { ids: [0] },
        pluginManager: {
            getPlugin: (name) => name === 'pruef'
                ? { ipcEvents: new Map([['tu', handler]]) }
                : null
        }
    });
    const log = sammler();
    client.logger = log;
    return { client, log };
}

(async () => {
    console.log('\nRatenbremse — Klartext');

    // Erst die reine Rechnung: WAS gemeldet wird, ohne Zuhoerer und ohne
    // Protokoll. Sonst prueft man am Ende nur, dass irgendetwas geschah.
    const einzeln = Ratenbremse.alsMeldung({
        global: false, method: 'PATCH', route: '/channels/:id/messages/:id',
        retryAfter: 1234.7, scope: 'shared', limit: 5, majorParameter: '999'
    });
    pruefe(einzeln.stufe === 'warn', 'gebremste Einzelroute ist eine Warnung', einzeln.stufe);
    pruefe(einzeln.text.includes('1235 ms'), 'Wartezeit gerundet im Klartext',
        '1234,7 ms → 1235 ms');
    pruefe(einzeln.text.includes('PATCH /channels/:id/messages/:id'),
        'Weg und Verfahren stehen drin');

    const global = Ratenbremse.alsMeldung({
        global: true, method: 'POST', route: '/channels/:id/messages',
        retryAfter: 60000, scope: 'global', limit: 50, majorParameter: '7'
    });
    pruefe(global.stufe === 'error', 'eine GLOBALE Bremse ist eine Stufe lauter',
        'sonst geht sie zwischen Einzelrouten unter');
    pruefe(global.text.includes('GLOBAL'), 'und sagt das auch im Klartext');

    console.log('\nRatenbremse — am echten REST');

    // Kein Nachbau: ein echtes REST-Objekt, ein echtes Ereignis.
    const rest = new REST({ version: '10' });
    const log1 = sammler();
    Ratenbremse.anmelden(rest, log1);
    rest.emit('rateLimited', {
        global: false, method: 'PATCH', route: '/channels/:id/messages/:id',
        retryAfter: 5000, scope: 'shared', limit: 5, majorParameter: '42'
    });
    pruefe(log1.hat('warn', '[Discord/Ratenbremse]'),
        'ein echtes rateLimited landet im Protokoll',
        'vorher hoerte hier niemand zu');

    console.log('\nREST — was rateLimited nicht sieht (Baustelle 82, 2026-10-29)');

    // Wieder ein echtes REST, diesmal mit echtem Durchlauf: Der erste Versuch
    // haengt, bis die Frist ihn abbricht — @discordjs/rest wiederholt still.
    // Nur das Ereignis `response` der zweiten Antwort traegt `retries: 1`.
    let versuche = 0;
    const rest2 = new REST({
        version: '10', timeout: 40, retries: 3,
        makeRequest: (url, init) => new Promise((ok, nein) => {
            versuche++;
            if (versuche === 1) {
                init.signal.addEventListener('abort', () => {
                    const e = new Error('abgebrochen'); e.name = 'AbortError'; nein(e);
                });
                return;   // haengt, bis die Frist abbricht
            }
            if (url.includes('/verboten')) {
                ok(new Response(JSON.stringify({ message: 'Missing Access', code: 50001 }),
                    { status: 403, headers: { 'content-type': 'application/json' } }));
                return;
            }
            ok(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
        }),
    }).setToken('pruef');
    const log2 = sammler();
    Ratenbremse.anmelden(rest2, log2);
    await rest2.patch('/channels/1/messages/2', { body: { content: 'x' } });
    pruefe(versuche === 2, 'die Bibliothek hat still wiederholt', `${versuche} Versuche`);
    pruefe(log2.hat('warn', 'PATCH /channels/1/messages/2 → 200, nach 1 Wiederholung'),
        'die Wiederholung steht im Protokoll', 'vorher: keine Zeile');
    await rest2.get('/verboten').catch(() => {});
    pruefe(log2.hat('warn', '→ 403'), 'ein Fehlerstatus steht im Protokoll');
    const vorher = log2.zeilen.length;
    await rest2.get('/still');
    pruefe(log2.zeilen.length === vorher, 'eine glatte Antwort schreibt nichts', 'sonst rauscht es je Anfrage');
    pruefe(Ratenbremse.alsAntwort({ method: 'get', path: '/x', retries: 0 }, { status: 404 }) === null,
        '404 ist Alltag (gelöschte Nachricht) und bleibt still');
    pruefe(Ratenbremse.alsDebug('[REST x] Hash a for b swept due to lifetime being exceeded') === null
        && Boolean(Ratenbremse.alsDebug('[REST x] Encountered unexpected 429 rate limit\n  Sublimit : 1200000ms')),
        'aus restDebug nur 429 und Sublimits');
    rest2.emit('invalidRequestWarning', { count: 120, remainingTime: 420000 });
    pruefe(log2.hat('warn', '120 ungültige Anfragen'), 'die Warnung über ungültige Anfragen kommt an');

    console.log('\nIPC-Dauer — der schnelle Fall');

    const schnell = bauen(async () => ({ ok: true }));
    let geantwortet = null;
    await schnell.client.handleMessage({
        data: { event: 'pruef:tu', payload: {} },
        reply: (a) => { geantwortet = { a, zeilen: schnell.log.zeilen.length }; }
    });
    pruefe(schnell.log.hat('debug', 'pruef:tu fertig in'),
        'die Dauer steht im Protokoll', 'auch wenn nichts klemmt');
    pruefe(!schnell.log.hat('warn', 'brauchte'),
        'ein schneller Handler warnt nicht', 'sonst rauscht die Meldung zu');
    pruefe(geantwortet?.a?.success === true, 'und die Antwort geht trotzdem raus');

    console.log('\nIPC-Dauer — der Fall aus Baustelle 76');

    // Ueber der Schwelle, ohne wirklich fuenf Sekunden zu warten.
    const alteSchwelle = IPCClient.LANGSAM_MS;
    IPCClient.LANGSAM_MS = 40;

    const langsam = bauen(async () => {
        await new Promise(r => setTimeout(r, 80));
        return { ok: true };
    });
    let reihenfolge = null;
    await langsam.client.handleMessage({
        data: { event: 'pruef:tu', payload: {} },
        reply: () => { reihenfolge = langsam.log.zeilen.length; }
    });
    const warnung = langsam.log.zeilen.find(z => z.stufe === 'warn' && z.text.includes('brauchte'));
    pruefe(Boolean(warnung), 'ein langsamer Handler warnt', warnung?.text.slice(0, 60));

    // Der eigentliche Punkt: gemessen wird der HANDLER, nicht die Antwort.
    // Nur so laesst sich "der Bot rechnete lange" von "die Antwort ging auf
    // dem Rueckweg verloren" unterscheiden - und genau das fehlte.
    const gemessen = Number((warnung?.text.match(/brauchte (\d+) ms/) || [])[1]);
    pruefe(gemessen >= 80 && gemessen < 2000, 'die gemessene Zeit ist die echte',
        `${gemessen} ms fuer 80 ms Arbeit`);
    pruefe(reihenfolge !== null && reihenfolge >= langsam.log.zeilen.length,
        'gemessen wird VOR dem Antworten',
        'sonst misst man die Leitung mit und kann beide nicht trennen');

    IPCClient.LANGSAM_MS = alteSchwelle;

    console.log('\nIPC-Dauer — auch wenn der Handler wirft');

    const kaputt = bauen(async () => { throw new Error('geplatzt'); });
    let fehlerAntwort = null;
    await kaputt.client.handleMessage({
        data: { event: 'pruef:tu', payload: {} },
        reply: (a) => { fehlerAntwort = a; }
    });
    pruefe(kaputt.log.hat('debug', 'pruef:tu fertig in'),
        'ein gescheiterter Handler wird trotzdem gemessen',
        'sonst fehlt die Zeit genau dort, wo sie zaehlt');
    pruefe(fehlerAntwort?.success === false, 'und der Fehler geht zurueck');

    console.log(`\nErgebnis: ${faelle} Pruefungen, ${abweichungen} Abweichung(en).\n`);
    process.exit(abweichungen ? 1 : 0);
})().catch((err) => {
    console.error('\nFEHLER:', err);
    process.exit(1);
});
