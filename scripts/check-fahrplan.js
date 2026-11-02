#!/usr/bin/env node
/**
 * FireBus, Etappe 0 (2026-11-01): Der Fahrplan stimmt mit dem Code überein.
 *
 * Der Fahrplan taugt nur, wenn jeder Name darin steht. Geprüft wird beides:
 *
 *   - Jeder Befehl, den der Daemon kennt, steht im Fahrplan, und umgekehrt.
 *   - Jeder Befehl, den das Dashboard ruft, steht im Fahrplan. Jede Zeile ohne
 *     `ohne_aufrufer` wird gerufen, jede mit `ohne_aufrufer` nicht.
 *   - Jedes Ereignis, das der Daemon sendet oder das Dashboard abonniert, steht
 *     im Fahrplan, und umgekehrt.
 *   - `arbeit: frei` stimmt: Der Handler gibt die Arbeit wirklich ab.
 *   - Jeder Befehl hat seine Reihe, und die Frist reist mit dem Befehl.
 *   - Die Kopie im Daemon gleicht der Datei hier aufs Byte.
 *   - Die Zählung rechnet richtig und bleibt begrenzt.
 *
 * Nichts wird geschrieben.
 *
 *   node scripts/check-fahrplan.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { ohneKommentare } = require('./lib/quelltext');

const WURZEL = path.join(__dirname, '..');
const DAEMON = path.join(WURZEL, '..', 'firebot_daemon');
require('dotenv').config({ path: path.join(WURZEL, 'apps/dashboard/.env'), quiet: true });

const { ServiceManager } = require('dunebot-core');
const warnungen = [];
ServiceManager.register('Logger', { warn: (t) => warnungen.push(t), error: () => {}, info: () => {}, debug: () => {} });

const firebus = require('../packages/firebus');
const FireBusZaehler = require('../apps/dashboard/helpers/FireBusZaehler');
const { MessageTypes } = require('dunebot-sdk');

let fehler = 0;
function pruefe(was, tun) {
    try { tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').join('\n      ')}`); }
}
const unterschied = (soll, ist) => [...soll].filter(n => !ist.has(n)).sort();

function dateien(ordner, endung, aus = []) {
    for (const e of fs.readdirSync(ordner, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === 'assets' || e.name === 'vendor') continue;
        const voll = path.join(ordner, e.name);
        if (e.isDirectory()) dateien(voll, endung, aus);
        else if (e.name.endsWith(endung) && !e.name.endsWith('_test.go')) aus.push(voll);
    }
    return aus;
}

// ── Daemon ───────────────────────────────────────────────────────────────────
const goTexte = dateien(path.join(DAEMON, 'internal'), '.go').concat(dateien(path.join(DAEMON, 'cmd'), '.go'))
    .map(d => ({ datei: d, text: ohneKommentare(fs.readFileSync(d, 'utf8')) }));
const clientText = goTexte.find(x => x.datei.endsWith('internal/websocket/client.go')).text;
const goAlle = goTexte.map(x => x.text).join('\n');

function funktion(text, kopf) {
    const start = text.indexOf(kopf);
    assert.ok(start >= 0, `${kopf} nicht gefunden`);
    const ende = text.indexOf('\n}\n', start);
    return text.slice(start, ende);
}

const verteiler = funktion(clientText, 'func (c *Client) fuehreBefehlAus(');
const hostBefehl = /hostMesswertBefehl\s*=\s*"([^"]+)"/.exec(goAlle)?.[1];
const daemonBefehle = new Set([
    ...[...verteiler.matchAll(/action == "([^"]+)"/g)].map(m => m[1]),
    ...[...verteiler.matchAll(/case "([^"]+)":/g)].map(m => m[1]),
    ...[...funktion(clientText, 'func (c *Client) handleDatenbank(').matchAll(/case "(db\.[^"]+)":/g)].map(m => m[1]),
    hostBefehl,
]);

/** Die Konstanten aus pkg/protocol: `NSInstall` → `install`. */
const konstanten = new Map([...fs.readFileSync(path.join(DAEMON, 'pkg/protocol/messages.go'), 'utf8')
    .matchAll(/^\s*([A-Z]\w+)(?:\s+Namespace)?\s*=\s*"([^"]+)"/gm)].map(m => [m[1], m[2]]));
const wert = (t) => {
    if (t.startsWith('"')) return t.slice(1, -1);
    const name = t.replace(/^protocol\./, '');
    assert.ok(konstanten.has(name), `Konstante ${t} nicht gefunden`);
    return konstanten.get(name);
};
const RE_SENDEN = /(?:SendEvent|sendEvent|NewEvent)\(\s*(?:[\w.()]+,\s*)?(protocol\.NS\w+|"[a-z]+")\s*,\s*(protocol\.\w+|"[a-z_]+")/g;
const daemonEreignisse = new Set([...goAlle.matchAll(RE_SENDEN)].map(m => `${wert(m[1])}.${wert(m[2])}`));

/**
 * Sendestellen, an denen Namensraum oder Aktion eine Variable sind. Der Ausdruck
 * sieht sie nicht, deshalb stehen die Namen hier mit ihrem Ort.
 */
const VARIABEL = {
    'gameserver.backup_fertig': 'websocket/sicherungen.go, `aktion` wird durchgereicht',
    'gameserver.restore_fertig': 'websocket/sicherungen.go, `aktion` wird durchgereicht',
    'install.status': 'gameserver/install_paket.go, `ns` ist install oder werkbank',
    'install.output': 'gameserver/install_paket.go, `ns` ist install oder werkbank',
    'werkbank.status': 'gameserver/install_paket.go, `ns` ist install oder werkbank',
    'werkbank.output': 'gameserver/install_paket.go, `ns` ist install oder werkbank',
    'werkbank.gestartet': 'gameserver/werkbank_start.go, `action` wird durchgereicht',
    'werkbank.konsole': 'gameserver/werkbank_start.go, `action` wird durchgereicht',
    'werkbank.bereitschaft': 'gameserver/werkbank_start.go, `action` wird durchgereicht',
    'werkbank.ports': 'gameserver/werkbank_start.go, `action` wird durchgereicht',
    'werkbank.pruefung': 'gameserver/werkbank_start.go, `action` wird durchgereicht',
};

// ── Dashboard ────────────────────────────────────────────────────────────────
const jsTexte = [...dateien(path.join(WURZEL, 'apps/dashboard'), '.js'), ...dateien(path.join(WURZEL, 'plugins'), '.js')]
    .map(d => ohneKommentare(fs.readFileSync(d, 'utf8'))).join('\n');

const RE_RUF = /(?:sendCommand|\bsenden|taskKommando|\bbefehl)\(\s*(?:[^,'"`()]+(?:\([^)]*\))?\s*,\s*|\{[^}]*\},\s*)?['"`]([a-zA-Z_.:]+)['"`]/g;
const aufgerufen = new Set([...jsTexte.matchAll(RE_RUF)].map(m => m[1]).filter(n => /[.:]/.test(n)));
for (const m of jsTexte.matchAll(/command = '(console:[a-z]+)'/g)) aufgerufen.add(m[1]);
// `BEFEHL` in plugins/masterserver/dashboard/helpers/Messwertbestellung.js
for (const m of jsTexte.matchAll(/const BEFEHL = '([^']+)'/g)) aufgerufen.add(m[1]);

const zeigerAus = (t) => (t.startsWith('MessageTypes.') ? MessageTypes[t.slice('MessageTypes.'.length)] : null);
const NS_KONSOLE = /const NS_CONSOLE = '([^']+)'/.exec(jsTexte)?.[1] || 'console';
const NS_WERKBANK = 'werkbank';
const abonniert = new Set();
for (const m of jsTexte.matchAll(/eventRouter\.register\(\s*([\w.']+)\s*,\s*([\w.']+)\s*,/g)) {
    const teil = (t) => {
        if (t.startsWith("'")) return t.slice(1, -1);
        if (t === 'NS_CONSOLE') return NS_KONSOLE;
        if (t === 'NS') return NS_WERKBANK;
        return zeigerAus(t);
    };
    const [ns, aktion] = [teil(m[1]), teil(m[2])];
    assert.ok(ns && aktion, `Abo nicht auflösbar: ${m[0]}`);
    abonniert.add(`${ns}.${aktion}`);
}

// ── Prüfen ───────────────────────────────────────────────────────────────────
const zeilen = firebus.zeilen;
const befehle = zeilen.filter(z => z.art === 'befehl');
const ereignisse = zeilen.filter(z => z.art === 'ereignis');

console.log('Fahrplan');
pruefe(`${zeilen.length} Zeilen, jede vollständig, kein Name doppelt`, () => {
    assert.strictEqual(new Set(zeilen.map(z => z.name)).size, zeilen.length, 'ein Name steht doppelt');
    for (const z of zeilen) {
        assert.ok(firebus.linien[z.linie], `${z.name}: Linie ${z.linie}`);
        assert.ok(['befehl', 'ereignis', 'steuerung'].includes(z.art), `${z.name}: Art ${z.art}`);
        assert.ok(['dashboard', 'daemon'].includes(z.von), `${z.name}: von ${z.von}`);
        assert.ok(['nie', 'erlaubt'].includes(z.verlust), `${z.name}: Verlust ${z.verlust}`);
        if (z.art === 'befehl') {
            assert.ok(['frei', 'bindet'].includes(z.arbeit), `${z.name}: Arbeit ${z.arbeit}`);
            assert.ok(['server', 'dateien', 'konsole', 'sitzung', 'maschine', 'keine'].includes(z.reihe), `${z.name}: Reihe ${z.reihe}`);
            assert.ok(z.schwer === undefined || z.schwer === true, `${z.name}: schwer ${z.schwer}`);
        }
    }
});
pruefe('Befehle und `crashed` dürfen nie verloren gehen', () => {
    for (const z of befehle) assert.strictEqual(z.verlust, 'nie', z.name);
    for (const n of ['gameserver.crashed', 'gameserver.status_changed', 'install.completed', 'install.failed']) {
        assert.strictEqual(firebus.zeile(n)?.verlust, 'nie', n);
    }
});
pruefe('die Kopie im Daemon gleicht der Datei hier aufs Byte', () => {
    assert.ok(fs.readFileSync(path.join(WURZEL, 'packages/firebus/fahrplan.json'))
        .equals(fs.readFileSync(path.join(DAEMON, 'pkg/firebus/fahrplan.json'))),
    'cp packages/firebus/fahrplan.json ../firebot_daemon/pkg/firebus/fahrplan.json');
});

console.log('\nBefehle');
pruefe(`der Daemon kennt ${daemonBefehle.size} Befehle, genau die des Fahrplans`, () => {
    const plan = new Set(befehle.map(z => z.name));
    assert.deepStrictEqual(unterschied(daemonBefehle, plan), [], 'im Daemon, nicht im Fahrplan');
    assert.deepStrictEqual(unterschied(plan, daemonBefehle), [], 'im Fahrplan, nicht im Daemon');
});
pruefe(`das Dashboard ruft ${aufgerufen.size} Befehle, alle stehen im Fahrplan`, () => {
    assert.deepStrictEqual(unterschied(aufgerufen, new Set(befehle.map(z => z.name))), []);
});
pruefe('`ohne_aufrufer` stimmt in beide Richtungen', () => {
    const ohne = befehle.filter(z => z.ohne_aufrufer).map(z => z.name);
    assert.deepStrictEqual(ohne.filter(n => aufgerufen.has(n)), [], 'hat doch einen Aufrufer');
    assert.deepStrictEqual(befehle.filter(z => !z.ohne_aufrufer && !aufgerufen.has(z.name)).map(z => z.name), [], 'hat keinen Aufrufer');
});
pruefe('`arbeit: frei` stimmt: Der Handler gibt die Arbeit ab', () => {
    const texte = goTexte.map(x => x.text).join('\n');
    const falsch = [];
    for (const z of befehle.filter(b => b.arbeit === 'frei')) {
        const stelle = verteiler.indexOf(`"${z.name}"`);
        assert.ok(stelle >= 0, `${z.name} nicht im Verteiler`);
        const zweig = verteiler.slice(stelle, stelle + 700).split(/\n\s*(?:if action ==|case ")/)[0];
        if (/\bgo\s/.test(zweig)) continue;
        const handler = /c\.(handle\w+)\(/.exec(zweig)?.[1];
        const kopf = handler && `func (c *Client) ${handler}(`;
        const koerper = kopf && texte.includes(kopf) ? funktion(texte, kopf) : '';
        if (!/\bgo\s|EnqueueTask/.test(koerper)) falsch.push(z.name);
    }
    assert.deepStrictEqual(falsch, []);
});

console.log('\nEreignisse');
pruefe(`der Daemon sendet ${daemonEreignisse.size} Namen, alle stehen im Fahrplan`, () => {
    assert.deepStrictEqual(unterschied(daemonEreignisse, new Set(ereignisse.map(z => z.name))), []);
});
pruefe('jedes Ereignis im Fahrplan wird gesendet', () => {
    const gesendet = new Set([...daemonEreignisse, ...Object.keys(VARIABEL)]);
    assert.deepStrictEqual(ereignisse.map(z => z.name).filter(n => !gesendet.has(n)), []);
});
pruefe(`das Dashboard abonniert ${abonniert.size} Namen, alle stehen im Fahrplan`, () => {
    assert.deepStrictEqual(unterschied(abonniert, new Set(ereignisse.map(z => z.name))), []);
});

console.log('\nZählung');
function zaehler(start = Date.parse('2026-11-01T17:20:00Z')) {
    const fragen = [];
    const uhr = { ms: start };
    const z = new FireBusZaehler({ db: () => ({ query: async (sql, p) => { fragen.push({ sql, p }); return []; } }), jetzt: () => uhr.ms });
    return { z, fragen, uhr };
}
pruefe('zählt Anzahl, Bytes, größte, Dauer; dieselbe Stunde bleibt eine Zeile', () => {
    const { z, uhr } = zaehler();
    z.zaehle('d', 'gameserver.start', 'aus', 100);
    uhr.ms += 60000;
    z.zaehle('d', 'gameserver.start', 'aus', 300, 40);
    z.zaehle('d', 'gameserver.start', 'ein', 10, 25);
    const [aus, ein] = [...z.zeilen.values()];
    assert.strictEqual(z.zeilen.size, 2);
    assert.deepStrictEqual([aus.anzahl, aus.bytes, aus.groesste, aus.dauerSumme, aus.dauerMax], [2, 400, 300, 40, 40]);
    assert.strictEqual(ein.dauerMax, 25);
});
pruefe('eine neue Stunde beginnt eine neue Zeile', () => {
    const { z, uhr } = zaehler();
    z.zaehle('d', 'heartbeat', 'ein', 1);
    uhr.ms += 3600000;
    z.zaehle('d', 'heartbeat', 'ein', 1);
    assert.strictEqual(z.zeilen.size, 2);
});
pruefe('fremde Namen füllen den Speicher nicht, und der Überlauf wird gezählt', () => {
    const { z } = zaehler();
    for (let i = 0; i < FireBusZaehler.MAX_SCHLUESSEL + 500; i++) z.zaehle('d', `erfunden.${i}`, 'ein', 1);
    assert.ok(z.zeilen.size <= FireBusZaehler.MAX_SCHLUESSEL + 1, `${z.zeilen.size} Zeilen`);
    const ueber = [...z.zeilen.values()].find(x => x.name === FireBusZaehler.UEBERLAUF);
    assert.strictEqual(ueber.anzahl, 500);
});
pruefe('ein unbekannter Name wird einmal gemeldet, ein bekannter nie', () => {
    warnungen.length = 0;
    const { z } = zaehler();
    z.zaehle('d', 'gibt.es.nicht', 'ein', 1);
    z.zaehle('d', 'gibt.es.nicht', 'ein', 1);
    z.zaehle('d', 'gameserver.start', 'aus', 1);
    assert.strictEqual(warnungen.length, 1, warnungen.join(' | '));
});
pruefe('Druck ist die Spanne: Der erste Wert ergibt keine Zahl, ein Neustart der Maschine auch nicht', () => {
    const { z, uhr } = zaehler();
    z.last('d', { druck: { cpu_some_us: 1000000, io_some_us: 0, ram_some_us: 0 } });
    uhr.ms += 30000;
    z.last('d', { druck: { cpu_some_us: 4000000, io_some_us: 15000000, ram_some_us: 0 }, hardware: { cpu: { usage_percent: 7 } } });
    uhr.ms += 30000;
    z.last('d', { druck: { cpu_some_us: 10, io_some_us: 0, ram_some_us: 0 } });
    const [a, b, c] = z.lasten;
    assert.strictEqual(a.druckCpu, null);
    assert.strictEqual(b.druckCpu, 10, '3 s von 30 s');
    assert.strictEqual(b.druckIo, 50);
    assert.strictEqual(b.cpu, 7);
    assert.strictEqual(c.druckCpu, null, 'kleinerer Zähler heißt Neustart, nicht null Prozent');
});
pruefe('ohne PSI steht NULL da, nicht 0', () => {
    const { z } = zaehler();
    z.last('d', { hardware: null });
    z.last('d', { hardware: null });
    assert.strictEqual(z.lasten[1].druckIo, null);
});
pruefe('die Belegung addiert sich je Art und nimmt das größte Maximum', () => {
    const { z } = zaehler();
    z.belegung('d', 'lesefaden', { 'gameserver.logs': { anzahl: 2, summe_ms: 50, max_ms: 40 } });
    z.belegung('d', 'lesefaden', { 'gameserver.logs': { anzahl: 1, summe_ms: 5, max_ms: 5 } });
    z.belegung('d', 'warten', { 'gameserver.logs': { anzahl: 1, summe_ms: 7, max_ms: 7 } });
    z.belegung('d', 'arbeit', undefined);
    const [l, w] = z.zeilen.values();
    assert.deepStrictEqual([l.art, l.anzahl, l.dauerSumme, l.dauerMax], ['lesefaden', 3, 55, 40]);
    assert.deepStrictEqual([w.art, w.anzahl], ['warten', 1]);
    assert.strictEqual(z.zeilen.size, 2);
});
pruefe('die Frist reist mit dem Befehl', () => {
    const quelle = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'apps/dashboard/helpers/IPMServer.js'), 'utf8'));
    assert.match(quelle, /frist_ms: timeout/);
    assert.match(fs.readFileSync(path.join(DAEMON, 'internal/websocket/fahrer.go'), 'utf8'), /msg\["frist_ms"\]/);
});

(async () => {
    const { z, fragen } = zaehler();
    z.zaehle('d', 'heartbeat', 'ein', 10);
    z.last('d', { hardware: null });
    await z.schreibe();
    pruefe('schreibt je Zeile einmal und leert den Speicher', () => {
        const ins = fragen.filter(f => /^\s*INSERT/.test(f.sql));
        assert.strictEqual(ins.length, 2);
        assert.strictEqual(z.zeilen.size, 0);
        assert.strictEqual(z.lasten.length, 0);
    });
    const anzahl = fragen.length;
    await z.schreibe();
    pruefe('ein leerer Lauf schreibt nichts', () => assert.strictEqual(fragen.length, anzahl));

    console.log('\nVerdrahtung');
    const IPMServer = require('../apps/dashboard/helpers/IPMServer');
    pruefe('eine Antwort bekommt den Namen ihres Befehls und ihre Dauer', () => {
        const gezaehlt = [];
        const fake = { pendingCommands: new Map([['a1', { command: 'gameserver.logs', gesendetAm: Date.now() - 500 }]]),
            zaehler: { zaehle: (...x) => gezaehlt.push(x) } };
        IPMServer.prototype._zaehleEingang.call(fake, 'd', { type: 'command_response', id: 'a1' }, 40);
        IPMServer.prototype._zaehleEingang.call(fake, 'd', { type: 'command_response', id: 'weg' }, 7);
        IPMServer.prototype._zaehleEingang.call(fake, 'd', { type: 'HEARTBEAT' }, 3);
        IPMServer.prototype._zaehleEingang.call(fake, 'd', { type: 'event', namespace: 'console', action: 'output' }, 3);
        assert.strictEqual(gezaehlt[0][1], 'gameserver.logs');
        assert.ok(gezaehlt[0][4] >= 500);
        assert.deepStrictEqual(gezaehlt[1].slice(1, 3), ['antwort.unbekannt', 'ein']);
        assert.strictEqual(gezaehlt[2][1], 'heartbeat');
        assert.strictEqual(gezaehlt[3][1], 'console.output');
    });
    pruefe('gezählt wird vor dem Routing, danach wäre der offene Befehl weg', () => {
        const q = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'apps/dashboard/helpers/IPMServer.js'), 'utf8'));
        assert.ok(q.indexOf('this._zaehleEingang(daemonId, message') < q.indexOf('await this._routeMessage(daemonId, message)'));
    });

    console.log(fehler ? `\n❌ ${fehler} Prüfung(en) fehlgeschlagen` : '\n✅ Fahrplan und Code stimmen überein, die Zählung rechnet richtig');
    process.exit(fehler ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
