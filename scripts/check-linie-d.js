#!/usr/bin/env node
/**
 * Linie D: Dateien fahren nicht im Bus, und Unterschriebenes nicht im Klartext.
 *
 * FireBus Etappe 2 (2026-11-02). Bis dahin trug `gameserver.files.write` eine Datei
 * base64-kodiert im Befehl, deshalb lag die Nachrichtengrenze bei 64 MiB, und eine
 * große Nachricht ließ nichts überholen. Der Dateiweg lief zugleich über http: Die
 * Unterschrift regelt, wer abrufen darf, mitlesen konnte jeder.
 *
 * Geprüft wird, dass beides nicht zurückkommt:
 *   - kein Aufruf und keine Fahrplanzeile für die drei alten Befehle, in keinem Repo
 *   - dieselbe Nachrichtengrenze auf beiden Seiten, und sie bleibt klein
 *   - unterschriebene Adressen beginnen mit https, das Zertifikat kommt vom Daemon
 *   - im Daemon liegen `/datei`, `/sicherung` und `/inhalt` auf dem TLS-Zweig
 *
 *   node scripts/check-linie-d.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { ohneKommentare } = require('./lib/quelltext');

const WURZEL = path.join(__dirname, '..');
const DAEMON = path.join(WURZEL, '..', 'firebot_daemon');
const ALT = ['gameserver.files.read', 'gameserver.files.write', 'gameserver.content.install'];
const GRENZE = 4 * 1024 * 1024;

let fehler = 0;
function pruefe(was, tun) {
    try { tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').slice(0, 3).join('\n      ')}`); }
}
const lies = (...teile) => fs.readFileSync(path.join(...teile), 'utf8');

function dateien(ordner, endung, aus = []) {
    for (const e of fs.readdirSync(ordner, { withFileTypes: true })) {
        if (['node_modules', 'vendor', 'public', '.git'].includes(e.name)) continue;
        const voll = path.join(ordner, e.name);
        if (e.isDirectory()) dateien(voll, endung, aus);
        else if (endung.some(x => e.name.endsWith(x)) && !e.name.endsWith('_test.go')) aus.push(voll);
    }
    return aus;
}

console.log('\nLinie D');

pruefe('die drei alten Befehle ruft niemand mehr', () => {
    const quellen = [
        ...dateien(path.join(WURZEL, 'plugins'), ['.js', '.ejs']),
        ...dateien(path.join(WURZEL, 'apps'), ['.js', '.ejs']),
        ...dateien(path.join(DAEMON, 'internal'), ['.go']),
    ];
    assert.ok(quellen.length > 100, `nur ${quellen.length} Dateien gefunden, die Suche stimmt nicht`);
    for (const datei of quellen) {
        const text = datei.endsWith('.go')
            ? lies(datei).split('\n').filter(z => !z.trim().startsWith('//')).join('\n')
            : ohneKommentare(lies(datei));
        for (const name of ALT) assert.ok(!text.includes(`${name}`), `${path.relative(WURZEL, datei)} nennt ${name}`);
    }
});

pruefe('der Fahrplan kennt sie nicht, und beide Kopien sind gleich', () => {
    const hier = lies(WURZEL, 'packages/firebus/fahrplan.json');
    assert.strictEqual(hier, lies(DAEMON, 'pkg/firebus/fahrplan.json'));
    for (const name of ALT) assert.ok(!hier.includes(`"${name}"`), name);
});

// Seit 2026-11-03 liest der Bahnhof die Leitungen, nicht mehr das Dashboard. Die
// Grenze, die dort gilt, steht in `internal/bahnhof/bahnhof.go`.
pruefe('dieselbe Nachrichtengrenze in Daemon und Bahnhof', () => {
    const bahnhof = eval(/maxNachrichtBytes = ([0-9 <]+)/.exec(lies(DAEMON, 'internal/bahnhof/bahnhof.go'))[1]);
    const daemon = eval(/const MaxNachrichtBytes = ([0-9 *]+)/.exec(lies(DAEMON, 'internal/websocket/client.go'))[1]);
    assert.strictEqual(bahnhof, GRENZE);
    assert.strictEqual(daemon, GRENZE);
});

pruefe('Dashboard: unterschriebene Adressen sind https und prüfen genau ein Zertifikat', () => {
    const abruf = ohneKommentare(lies(WURZEL, 'plugins/gameserver/dashboard/helpers/Abruf.js'));
    assert.match(abruf, /`https:\/\/\$\{wirtFuerBrowser\(maschine\)\}:\$\{maschine\.abruf_port\}`/);
    assert.match(abruf, /ca: maschine\.abruf_zertifikat/);
    assert.ok(!/rejectUnauthorized/.test(abruf), 'rejectUnauthorized ist die Abschaltung der Prüfung');
    assert.ok(!/require\('http'\)/.test(abruf), 'http ist zurück');
    const server = ohneKommentare(lies(WURZEL, 'plugins/gameserver/dashboard/routes/servers.js'));
    assert.ok(!/http:\/\/\$\{wirt\}/.test(server), 'die Sicherung läuft wieder im Klartext');
});

pruefe('Daemon: Unterschriebenes nur auf dem TLS-Zweig, FastDL nur im Klartext', () => {
    const abruf = lies(DAEMON, 'internal/sicherungsabruf/abruf.go');
    const sicher = abruf.split('\n').filter(z => z.includes('sicherMux.HandleFunc')).join('\n');
    const klar = abruf.split('\n').filter(z => z.includes('klarMux.HandleFunc')).join('\n');
    for (const pfad of ['PFAD', 'PfadDatei', 'PfadInhalt']) {
        assert.ok(sicher.includes(`HandleFunc(${pfad},`), `${pfad} fehlt auf dem TLS-Zweig`);
        assert.ok(!klar.includes(`HandleFunc(${pfad},`), `${pfad} liegt im Klartext`);
    }
    assert.ok(klar.includes('HandleFunc(PfadOeffentlich,'));
    assert.match(abruf, /MinVersion: +tls\.VersionTLS13/);
});

pruefe('die Anmeldung trägt das Zertifikat bis in die Spalte', () => {
    assert.match(lies(DAEMON, 'internal/websocket/client.go'), /registerPayload\["abruf_zertifikat"\]/);
    const ipm = lies(WURZEL, 'apps/dashboard/helpers/IPMServer.js');
    // Drei Anmeldewege im Übergang nach F20: Klartext mit JWT, Klartext mit Token,
    // versiegelt. Fällt der Klartext weg, bleibt einer.
    assert.strictEqual((ipm.match(/abrufZertifikat: abruf_zertifikat \?\? null/g) || []).length, 3);
    assert.match(lies(WURZEL, 'plugins/masterserver/dashboard/models/RootServer.js'), /fields\.push\('abruf_zertifikat = \?'\)/);
});

console.log(fehler ? `\n✗ ${fehler} Prüfung(en) rot` : '\n✅ Dateien fahren nicht im Bus, Unterschriebenes nicht im Klartext');
process.exit(fehler ? 1 : 0);
