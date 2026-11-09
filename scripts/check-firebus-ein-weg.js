#!/usr/bin/env node
/**
 * FireBus Etappe 6 (K286, 2026-11-09): Zwei Wege bleiben nicht stehen.
 *
 * Gemessen vor dem Aufräumen, beide Arbeitsbäume:
 *   - Antworten: Der Daemon schickte nur `command_response` (fünf Stellen in
 *     client.go, alle `{type, id, payload}`; `einpacken` im Sendeweg packt den
 *     Rest ein). `response` nahmen trotzdem an: IPMServer, IPMEventRouter, das
 *     SDK (Typ, drei Bausteine, Prüfer), der Bahnhof und der Sendeweg;
 *     `NewResponse`/`NewErrorResponse` im Daemon ohne Aufrufer.
 *   - Ereignisse ohne Namensraum: `NewEvent` setzt ihn immer; der alte
 *     Verteiler `_handleDaemonEvent` lief trotzdem neben dem IPMEventRouter.
 *   - Befehle: acht nur im Daemon (`ohne_aufrufer` im Fahrplan), dazu der
 *     Rückfall „Befehlsname aus payload.action“.
 *
 *   node scripts/check-firebus-ein-weg.js
 *
 * Liest den Daemon aus ../firebot_daemon. Fehlt der Baum, ist das rot — ein
 * Wächter, der nichts findet, darf nicht grün sein.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { ohneKommentare } = require('./lib/quelltext');

const WURZEL = path.join(__dirname, '..');
const DAEMON = path.join(WURZEL, '..', 'firebot_daemon');
const lies = (p) => fs.readFileSync(path.join(WURZEL, p), 'utf8');
const liesD = (p) => fs.readFileSync(path.join(DAEMON, p), 'utf8');
let fehler = 0;
function pruefe(name, fn) {
    try { fn(); console.log(`  ✓ ${name}`); }
    catch (e) { fehler++; console.log(`  ✗ ${name}\n      ${String(e.message).split('\n').join('\n      ')}`); }
}

/** Alle Go-Quellen des Daemons ohne Tests. */
function goQuellen() {
    const aus = [];
    (function sammle(o) {
        for (const e of fs.readdirSync(path.join(DAEMON, o), { withFileTypes: true })) {
            if (['vendor', 'node_modules', '.git', 'docs_bak'].includes(e.name)) continue;
            const p = path.join(o, e.name);
            if (e.isDirectory()) sammle(p);
            else if (e.name.endsWith('.go') && !e.name.endsWith('_test.go')) aus.push(p);
        }
    })('.');
    return aus;
}

const TOTE_BEFEHLE = ['gameserver.migrate.download', 'gameserver.migrate.upload', 'gameserver.apply_config',
    'rootserver.delete_user', 'werkbank.platz', 'start', 'stop', 'restart'];

console.log('\nDaemon');

pruefe('der Daemon-Baum ist da', () => {
    assert.ok(fs.existsSync(path.join(DAEMON, 'go.mod')), `${DAEMON} fehlt`);
});

pruefe('eine Antwortform: kein TypeResponse, kein "response" als Nachrichtenart', () => {
    const treffer = [];
    for (const p of goQuellen()) {
        const s = ohneKommentare(liesD(p));
        if (/\bTypeResponse\b|\bNewResponse\(|\bNewErrorResponse\(|\bIsResponse\(/.test(s)) treffer.push(p);
        if (/typ\s*[!=]=\s*"response"|EqualFold\([^)]*"response"\)|"type"\s*:\s*"response"/.test(s)) treffer.push(p + ' ("response")');
    }
    assert.deepStrictEqual(treffer, []);
});

pruefe('der Befehlsname kommt nur aus "command", ohne Rückfall auf payload.action', () => {
    const s = ohneKommentare(liesD('internal/websocket/client.go'));
    assert.ok(!/payload\["action"\]\.\(string\)/.test(s), 'Rückfall auf payload["action"] steht wieder');
});

pruefe('die acht toten Befehle und die Kurzformen haben keinen Zweig mehr', () => {
    const treffer = [];
    for (const p of goQuellen().filter(p => p.startsWith('internal/websocket'))) {
        const s = ohneKommentare(liesD(p));
        for (const n of TOTE_BEFEHLE) {
            const re = new RegExp(`case "${n.replace(/\./g, '\\.')}"|action == "${n.replace(/\./g, '\\.')}"`);
            if (re.test(s)) treffer.push(`${p}: ${n}`);
        }
    }
    assert.deepStrictEqual(treffer, []);
});

console.log('\nDashboard und SDK');

pruefe('IPMServer kennt nur command_response, mit payload', () => {
    const s = ohneKommentare(lies('apps/dashboard/helpers/IPMServer.js'));
    assert.ok(!/case 'response'/.test(s), "case 'response' steht wieder");
    assert.ok(!/=== 'response'/.test(s), "Vergleich mit 'response' steht wieder");
    assert.ok(!/message\.payload \|\| message\b/.test(s), 'der Rückfall „Antwort ohne payload“ steht wieder');
    assert.match(s, /case 'command_response':[\s\S]{0,400}this\._resolveCommand\(id, payload\)/);
});

pruefe('ein Verteiler für Ereignisse: der IPMEventRouter', () => {
    const s = ohneKommentare(lies('apps/dashboard/helpers/IPMServer.js'));
    for (const w of ['_handleDaemonEvent', '_processDashboardEvent', '_handleGameserverStatusChanged']) {
        assert.ok(!s.includes(w), `${w} steht wieder`);
    }
    // Nach dem Router geht nichts mehr in den alten Schalter.
    assert.match(s, /await eventRouter\.route\(message, \{[\s\S]*?\}\);\s*return;\s*\}/);
});

pruefe('das SDK kennt keine Antwortform response', () => {
    for (const p of ['packages/dunebot-sdk/lib/ipm/MessageTypes.js', 'packages/dunebot-sdk/lib/ipm/MessageBuilder.js',
        'packages/dunebot-sdk/lib/ipm/MessageValidator.js', 'apps/dashboard/helpers/IPMEventRouter.js']) {
        const s = ohneKommentare(lies(p));
        assert.ok(!/TYPE_RESPONSE|static (response|errorResponse|successResponse)\(/.test(s), `${p} kennt die Antwortform noch`);
    }
    const typen = require(path.join(WURZEL, 'packages/dunebot-sdk/lib/ipm/MessageTypes.js'));
    assert.strictEqual(typen.TYPE_RESPONSE, undefined);
    const MessageValidator = require(path.join(WURZEL, 'packages/dunebot-sdk/lib/ipm/MessageValidator.js'));
    const ergebnis = MessageValidator.validate({ type: 'response', id: '1', timestamp: Date.now(), success: true });
    assert.strictEqual(ergebnis.valid, false, 'der Prüfer lässt response wieder durch');
});

console.log('\nFahrplan');

pruefe('kein Befehl ohne Aufrufer, die acht Namen sind weg, beide Kopien gleich', () => {
    const fp = JSON.parse(lies('packages/firebus/fahrplan.json'));
    assert.deepStrictEqual(fp.zeilen.filter(z => z.ohne_aufrufer).map(z => z.name), []);
    assert.deepStrictEqual(fp.zeilen.filter(z => TOTE_BEFEHLE.includes(z.name)).map(z => z.name), []);
    assert.ok(fp.fassung >= 11, 'die Fassung wurde nicht hochgezählt');
    assert.strictEqual(liesD('pkg/firebus/fahrplan.json'), lies('packages/firebus/fahrplan.json'), 'Kopie im Daemon weicht ab');
});

console.log(fehler ? `\n❌ Ein Weg: ${fehler} Prüfung(en) rot` : '\n✅ Ein Weg: alles grün');
process.exit(fehler ? 1 : 0);
