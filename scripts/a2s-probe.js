#!/usr/bin/env node
/**
 * A2S-Sonde: prüft, ob ein Gameserver auf einem UDP-Port Steam-Abfragen beantwortet.
 *
 * Nützlich, wenn die Live-Abfrage im Dashboard scheitert und die Frage ist, ob das
 * Spiel überhaupt auf dem erwarteten Port lauscht – oder ob es an Port-Mapping,
 * Firewall oder Konfiguration liegt.
 *
 * Läuft ohne Abhängigkeiten (nur Node-Bordmittel), also auch direkt auf dem Rootserver.
 *
 * Beispiele:
 *   node scripts/a2s-probe.js 45.131.66.91 25001 25007
 *   node scripts/a2s-probe.js 127.0.0.1 27015
 *   node scripts/a2s-probe.js 172.20.0.2 25007      # Container-IP
 */

'use strict';

const dgram = require('dgram');

const TIMEOUT_MS = 3000;
const HEADER = Buffer.from([0xFF, 0xFF, 0xFF, 0xFF]);

/** A2S_INFO-Anfrage, optional mit Challenge-Antwort */
function buildInfoRequest(challenge = null) {
    const base = Buffer.concat([HEADER, Buffer.from('TSource Engine Query\0', 'latin1')]);
    return challenge ? Buffer.concat([base, challenge]) : base;
}

/**
 * Fragt einen Port ab.
 * @returns {Promise<{ok: boolean, detail: string}>}
 */
function probe(host, port) {
    return new Promise(resolve => {
        const socket = dgram.createSocket('udp4');
        let settled = false;
        let sentChallenge = false;

        const done = (ok, detail) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            socket.close();
            resolve({ ok, detail });
        };

        const timer = setTimeout(() => done(false, 'keine Antwort (Timeout)'), TIMEOUT_MS);

        socket.on('error', err => done(false, `Socket-Fehler: ${err.message}`));

        socket.on('message', msg => {
            const type = msg[4];

            // 0x41 = Challenge → einmal mit dem Token erneut fragen
            if (type === 0x41 && !sentChallenge) {
                sentChallenge = true;
                socket.send(buildInfoRequest(msg.subarray(5, 9)), port, host);
                return;
            }

            if (type === 0x49) {  // A2S_INFO-Antwort
                // Nach Protokoll-Byte folgen nullterminierte Strings: Name, Map, Folder, Game
                const parts = msg.subarray(6).toString('utf8').split('\0');
                const [name, map, , game] = parts;
                return done(true, `antwortet — "${name}" · Map: ${map || '?'} · Spiel: ${game || '?'}`);
            }

            done(true, `antwortet (unerwarteter Typ 0x${type.toString(16)})`);
        });

        socket.send(buildInfoRequest(), port, host, err => {
            if (err) done(false, `Senden fehlgeschlagen: ${err.message}`);
        });
    });
}

async function main() {
    const [host, ...ports] = process.argv.slice(2);
    if (!host || ports.length === 0) {
        console.error('Aufruf: node scripts/a2s-probe.js <host> <port> [weitere ports…]');
        process.exit(1);
    }

    console.log(`A2S-Sonde → ${host}\n`);
    for (const port of ports) {
        const { ok, detail } = await probe(host, Number(port));
        console.log(`  ${String(port).padEnd(7)} ${ok ? '✓' : '✗'}  ${detail}`);
    }
}

main();
