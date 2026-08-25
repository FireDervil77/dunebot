#!/usr/bin/env node
/**
 * Spielt den Strom zum Browser durch - mit falschem SSEManager und falscher
 * Datenbank, ohne laufendes Dashboard.
 *
 * `check-streaming-strom.js` prueft, dass die Teile **dastehen**. Dieses
 * Skript prueft, dass sie **greifen**. Der Unterschied ist der ganze Punkt
 * von [[vorhanden-heisst-nicht-funktioniert]]: Eine Mechanik, die nie lief,
 * versagt beim ersten Einsatz lautlos - und der erste Einsatz ist hier ein
 * echter Stream, bei dem niemand hinsieht.
 *
 * Drei Fragen:
 *
 *   1. Kommt ein Signal ueberhaupt an?
 *   2. Geht es NUR an die Guilds, die den Streamer beobachten?
 *   3. Wird ein Schwall zu einem Anstupser zusammengefasst?
 *
 *   node scripts/check-streaming-strom-lauf.js
 *
 * Exitcode 1 bei jeder Abweichung.
 */
'use strict';

const { ServiceManager } = require('dunebot-core');

let faelle = 0;
let abweichungen = 0;

/** @type {Array<{guildId: string, kanal: string, daten: Object}>} */
let gesendet = [];

/** @type {Array<{sql: string, werte: Array}>} */
let abfragen = [];

/**
 * Ein Logger, der schweigt. Muss VOR allem anderen stehen - `strom.starten()`
 * schreibt eine Zeile, und ein fehlender Logger wirft.
 */
ServiceManager.register('Logger', {
    info() {}, warn() {}, error() {}, debug() {}, success() {}
});

/**
 * Ein SSEManager, der nur mitschreibt.
 */
ServiceManager.register('sseManager', {
    broadcast(guildId, kanal, daten) { gesendet.push({ guildId, kanal, daten }); }
});

/**
 * Eine Datenbank, die nur Ziele kennt: Streamer 1 wird von zwei Guilds
 * beobachtet, Streamer 2 von keiner.
 */
ServiceManager.register('dbService', {
    async query(sql, werte) {
        abfragen.push({ sql, werte });
        if (/streaming_targets/.test(sql)) {
            return String(werte[0]) === '1'
                ? [{ guild_id: '100' }, { guild_id: '200' }]
                : [];
        }
        return [];
    }
});

const { melden, signale, ZUSTAND } = require('../plugins/streaming/shared/signale');
const strom = require('../plugins/streaming/dashboard/ausgabe/strom');

/**
 * @param {string} was Beschreibung
 * @param {*} ist Ergebnis
 * @param {*} soll Erwartung
 */
function pruefe(was, ist, soll) {
    faelle++;
    if (JSON.stringify(ist) === JSON.stringify(soll)) {
        console.log(`  ✓ ${was}`);
    } else {
        abweichungen++;
        console.log(`  ✗ ${was}\n      erwartet: ${JSON.stringify(soll)}\n      bekommen: ${JSON.stringify(ist)}`);
    }
}

/**
 * @param {number} ms Wartezeit
 * @returns {Promise<void>}
 */
const warte = ms => new Promise(a => setTimeout(a, ms));

/** Zuruecksetzen zwischen den Faellen. */
function leeren() { gesendet = []; abfragen = []; }

/** Wartet, bis der Sammeltimer sicher abgelaufen ist. */
const NACH_SAMMELN = strom.SAMMELN_MS + 120;

(async () => {
    strom.starten();

    // -----------------------------------------------------------------
    console.log('\nKommt ein Signal an?');
    leeren();
    melden({ streamerId: 1, grund: 'ging_live' });
    await warte(NACH_SAMMELN);

    pruefe('ein Streamer, zwei Guilds -> zwei Anstupser',
        gesendet.map(g => g.guildId).sort(), ['100', '200']);
    pruefe('unter dem vereinbarten Kanalnamen',
        [...new Set(gesendet.map(g => g.kanal))], [strom.KANAL]);
    pruefe('der Grund faehrt mit',
        [...new Set(gesendet.map(g => g.daten.grund))], ['ging_live']);

    // -----------------------------------------------------------------
    console.log('\nTraegt das Signal Inhalte?');
    // Die Regel, an der mehr haengt als an allen anderen: Der Strom geht an
    // JEDEN Browser mit offener Guild. Steht hier ein Titel oder ein
    // Fehlertext drin, ist er an der Rechtepruefung vorbei.
    pruefe('nur grund und zeit, sonst nichts',
        Object.keys(gesendet[0].daten).sort(), ['grund', 'zeit']);

    // -----------------------------------------------------------------
    console.log('\nGeht es nur an die richtigen Guilds?');
    leeren();
    melden({ streamerId: 2, grund: 'ging_live' });   // niemand beobachtet ihn
    await warte(NACH_SAMMELN);
    pruefe('Streamer ohne Ziel -> niemand wird angestupst', gesendet.length, 0);

    leeren();
    melden({ guildId: '999', grund: 'auftrag_aufgegeben' });
    await warte(NACH_SAMMELN);
    pruefe('bekannte Guild -> direkt, ohne Datenbankfrage',
        { guilds: gesendet.map(g => g.guildId), abfragen: abfragen.length },
        { guilds: ['999'], abfragen: 0 });

    // -----------------------------------------------------------------
    console.log('\nWird ein Schwall zusammengefasst?');
    // Der Fall aus dem Betrieb: Ein Streamer geht live, zwanzig Auftraege
    // werden nacheinander fertig. Ohne Sammeln laedt jeder offene Browser
    // zwanzig Mal nach - fuer denselben Stand.
    leeren();
    for (let i = 0; i < 20; i++) melden({ guildId: '100', grund: 'auftrag_fertig' });
    await warte(NACH_SAMMELN);
    pruefe('20 Signale in einem Zug -> 1 Anstupser', gesendet.length, 1);

    // **Der Fall, der wirklich vorkommt.** Die Drossel arbeitet Auftraege mit
    // `await` dazwischen ab - die Signale liegen also in verschiedenen Ticks,
    // nicht in einer Schleife. Die Gegenprobe am 2026-08-26 zeigte, dass der
    // Fall darueber das nicht abdeckt: Er blieb gruen, als ich SAMMELN_MS auf
    // 0 setzte, weil eine synchrone Schleife schon von der `wartend`-Sperre
    // zusammengefasst wird. Erst hier entscheidet die Wartezeit.
    leeren();
    for (let i = 0; i < 5; i++) {
        melden({ guildId: '100', grund: 'auftrag_fertig' });
        await warte(Math.floor(strom.SAMMELN_MS / 5));
    }
    await warte(NACH_SAMMELN);
    pruefe('5 Signale ueber mehrere Ticks, innerhalb der Sammelzeit -> 1 Anstupser',
        gesendet.length, 1);

    leeren();
    melden({ guildId: '100', grund: 'a' });
    await warte(NACH_SAMMELN);
    melden({ guildId: '100', grund: 'b' });
    await warte(NACH_SAMMELN);
    pruefe('zwei Signale mit Abstand -> zwei Anstupser', gesendet.length, 2);

    leeren();
    melden({ guildId: '100', grund: 'x' });
    melden({ guildId: '200', grund: 'x' });
    await warte(NACH_SAMMELN);
    pruefe('zwei Guilds gleichzeitig -> je einer, nicht einer fuer beide',
        gesendet.map(g => g.guildId).sort(), ['100', '200']);

    // -----------------------------------------------------------------
    console.log('\nWas passiert, wenn es klemmt?');
    leeren();
    melden({ grund: 'ohne alles' });   // weder Streamer noch Guild
    await warte(NACH_SAMMELN);
    pruefe('Signal ohne Empfaenger -> nichts, kein Absturz', gesendet.length, 0);

    // Ein Melder darf nie den Aufrufer mitreissen: Der steckt mitten in der
    // Verarbeitung eines echten Ereignisses.
    let ueberlebt = false;
    ServiceManager.register('sseManager', {
        broadcast() { throw new Error('SSEManager kaputt'); }
    });
    leeren();
    try {
        melden({ guildId: '100', grund: 'trotzdem' });
        await warte(NACH_SAMMELN);
        ueberlebt = true;
    } catch { ueberlebt = false; }
    pruefe('kaputter SSEManager reisst den Melder nicht mit', ueberlebt, true);

    // -----------------------------------------------------------------
    console.log('\nDoppeltes Anmelden');
    // Ohne Sperre haengt nach jedem Plugin-Neustart ein weiterer Zuhoerer am
    // selben Emitter, und jedes Signal kaeme mehrfach an.
    ServiceManager.register('sseManager', {
        broadcast(guildId, kanal, daten) { gesendet.push({ guildId, kanal, daten }); }
    });
    strom.starten();
    strom.starten();
    strom.starten();

    // **Die Anstupser zaehlen reicht hier nicht.** Genau das stand zuerst da
    // und blieb gruen, als ich die Sperre ausbaute: Vier Zuhoerer rufen
    // `anstupsen` viermal - und die Entprellung macht daraus wieder einen.
    // Der Schaden waere trotzdem da (vier Datenbankfragen je Signal, und nach
    // `anhalten()` bleiben drei haengen). Also den Emitter direkt fragen.
    pruefe('viermal starten() -> trotzdem EIN Zuhoerer',
        signale.listenerCount(ZUSTAND), 1);

    leeren();
    melden({ guildId: '100', grund: 'einmal' });
    await warte(NACH_SAMMELN);
    pruefe('und trotzdem ein Anstupser', gesendet.length, 1);

    console.log('\nNach anhalten()');
    strom.anhalten();
    pruefe('anhalten() laesst keinen Zuhoerer zurueck',
        signale.listenerCount(ZUSTAND), 0);

    leeren();
    melden({ guildId: '100', grund: 'zu spaet' });
    await warte(NACH_SAMMELN);
    pruefe('abgemeldet -> nichts mehr', gesendet.length, 0);

    console.log(abweichungen === 0
        ? `\nErgebnis: ${faelle} Faelle, 0 Abweichungen.\n`
        : `\nErgebnis: ${faelle} Faelle, ${abweichungen} Abweichung(en).\n`);

    process.exit(abweichungen === 0 ? 0 : 1);
})();
