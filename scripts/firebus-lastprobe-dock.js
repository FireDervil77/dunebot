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
 * wie im Dashboard vor dem Verteiler: JSON lesen. Tür und Zählung laufen seit Paket 4
 * (2026-11-03) im Bahnhof und zählen dort mit, was er die Probe kostet. Der Verteiler
 * dahinter (`_routeMessage`, SSE an die Browser) ist nicht dabei, die Probe misst also
 * die Untergrenze dessen, was das Dashboard je Nachricht tut.
 *
 * `gehalten` bleibt hier 0: Was die Tür hält, kommt gar nicht erst an. Der Bahnhof
 * meldet es im Takt als `kontrolle`, die Probe gibt es auf stderr aus.
 *
 * Ausgabe: je Sekunde eine Zeile JSON auf stdout, je Stufe getrennt.
 */
'use strict';

const { monitorEventLoopDelay, performance } = require('perf_hooks');
const BusDock = require('../apps/dashboard/helpers/BusDock');

const pfad = process.argv[2];
if (!pfad) {
    console.error('Aufruf: firebus-lastprobe-dock.js <Socket des Bahnhofs>');
    process.exit(2);
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
    _vomBahnhof(art, inhalt) {
        if (art === 'kontrolle') console.error('[kontrolle]', JSON.stringify(inhalt.meldungen));
    },
    _handleConnection(leitung) {
        leitung.on('message', (data) => {
            const message = JSON.parse(data);
            if (message.type === 'register') {
                leitung.send(JSON.stringify({ type: 'registered' }));
                return;
            }
            const s = stufe(message.payload?.stufe || '-');
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
