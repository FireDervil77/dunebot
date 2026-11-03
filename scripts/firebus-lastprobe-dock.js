#!/usr/bin/env node
/**
 * FireBus, Etappe 4: das Dock-Ende der Lastprobe. Läuft nicht für sich, sondern wird
 * vom Go-Test im Daemon-Repository gestartet:
 *
 *   cd firebot_daemon
 *   FIREBUS_LASTPROBE_DOCK=/home/firedervil/dunebot_prod/scripts/firebus-lastprobe-dock.js \
 *     go test -tags lastprobe -run Lastprobe -v -timeout 10m ./internal/bahnhof/
 *
 * Angedockt wird mit dem echten `BusDock.js`. Jede Nachricht geht durch dieselbe Arbeit
 * wie im Dashboard vor dem Verteiler: JSON lesen, Name bilden, zählen
 * (`FireBusZaehler`), an der Tür prüfen (`FireBusKontrolle`). Der Verteiler dahinter
 * (`_routeMessage`, SSE an die Browser) ist nicht dabei, die Probe misst also die
 * Untergrenze dessen, was das Dashboard je Nachricht tut.
 *
 * Datenbank gibt es keine: Zähler und Tür sammeln im Speicher, geschrieben wird nie.
 *
 * Ausgabe: je Sekunde eine Zeile JSON auf stdout, je Stufe getrennt.
 */
'use strict';

const { monitorEventLoopDelay, performance } = require('perf_hooks');
const BusDock = require('../apps/dashboard/helpers/BusDock');
const FireBusZaehler = require('../apps/dashboard/helpers/FireBusZaehler');
const FireBusKontrolle = require('../apps/dashboard/helpers/FireBusKontrolle');

const pfad = process.argv[2];
if (!pfad) {
    console.error('Aufruf: firebus-lastprobe-dock.js <Socket des Bahnhofs>');
    process.exit(2);
}

const keineDb = () => ({ query: async () => [] });
const zaehler = new FireBusZaehler({ db: keineDb });
const kontrolle = new FireBusKontrolle({ db: keineDb });

/** Wie `nachrichtenName` in IPMServer.js. */
function nachrichtenName(message) {
    const typ = message.type?.toLowerCase();
    return message.namespace && message.action
        ? `${message.namespace}.${message.action}`
        : (typ === 'event' ? message.payload?.event : typ);
}

const stufen = new Map();
function stufe(name) {
    let s = stufen.get(name);
    if (!s) {
        s = { anzahl: 0, bytes: 0, gehalten: 0, laufzeiten: [] };
        stufen.set(name, s);
    }
    return s;
}

const jetztNs = () => BigInt(Math.round((performance.timeOrigin + performance.now()) * 1e6));

const ipm = {
    Logger: {
        info: (...a) => console.error('[info]', ...a),
        warn: (...a) => console.error('[warn]', ...a),
        error: (...a) => console.error('[error]', ...a),
    },
    _handleConnection(leitung) {
        let daemonId = null;
        leitung.on('message', (data) => {
            const message = JSON.parse(data);
            if (message.type === 'register') {
                daemonId = message.payload?.daemon_id || leitung.kanal;
                leitung.send(JSON.stringify({ type: 'registered', sessionToken: 'probe' }));
                return;
            }
            const name = nachrichtenName(message);
            zaehler.zaehle(daemonId, name, 'ein', data.length);
            const s = stufe(message.payload?.stufe || '-');
            if (!kontrolle.pruefe(daemonId, name, data.length)) s.gehalten++;
            s.anzahl++;
            s.bytes += data.length;
            const gesendet = message.payload?.gesendet_ns;
            if (gesendet) s.laufzeiten.push(Number(jetztNs() - BigInt(gesendet)) / 1e6);
        });
    },
};

const verzoegerung = monitorEventLoopDelay({ resolution: 10 });
verzoegerung.enable();

function quantil(sortiert, q) {
    if (!sortiert.length) return null;
    return sortiert[Math.min(sortiert.length - 1, Math.floor(q * sortiert.length))];
}

setInterval(() => {
    for (const [name, s] of stufen) {
        if (!s.anzahl) continue;
        const l = s.laufzeiten.sort((a, b) => a - b);
        process.stdout.write(JSON.stringify({
            stufe: name,
            anzahl: s.anzahl,
            bytes: s.bytes,
            gehalten: s.gehalten,
            p50_ms: quantil(l, 0.5),
            p99_ms: quantil(l, 0.99),
            max_ms: l.length ? l[l.length - 1] : null,
            schleife_max_ms: verzoegerung.max / 1e6,
        }) + '\n');
        s.anzahl = 0;
        s.bytes = 0;
        s.gehalten = 0;
        s.laufzeiten = [];
    }
    verzoegerung.reset();
}, 1000);

new BusDock(ipm, pfad).starte();
