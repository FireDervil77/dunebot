#!/usr/bin/env node
/**
 * Werkbank: was im Probestart lauscht — eingeordnet (2026-10-08).
 *
 * Anlass war 7 Days to Die. Beobachtet waren fünf Zeilen (11000/udp, 26900/tcp,
 * 26900/udp, 26902/udp, 51333/udp), übernommen wurde der falsche als Spielport,
 * und der Betreiber: „was da Query-Port ist und was nicht, lässt sich für mich
 * auch nicht immer zweifelsfrei bestimmen." Die Liste zeigte nur Nummern.
 *
 * Geprüft wird an genau diesem Fall:
 *
 *   - das Bild (Sitzungen.portBild): tcp+udp einer Nummer ist EIN Port; ein Port
 *     knapp über einem des Entwurfs bekommt den Vorschlag „gekoppelt"; die Zeile
 *     der Konsole steht dabei; der Zufallsport ist als solcher erkannt;
 *   - das Übernehmen mit Kopplung — im Probestart, also auch während das Spiel läuft;
 *   - was ein Lauf sah, bleibt nach seinem Ende;
 *   - die Zeichnung im Browser, in einer nachgestellten Seite: Sie zeigt, was das
 *     Bild sagt, und schickt beim Übernehmen die Kopplung mit.
 *
 *   node scripts/check-werkbank-portbild.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { ServiceManager } = require('dunebot-core');
const { ohneKommentare, ohneKommentareEjs } = require('./lib/quelltext');

const WURZEL = path.join(__dirname, '..');

// Die Attrappe kennt: das Schreiben des Entwurfs (merkt ihn sich) und die Ports eines Laufs.
const lager = { lauf: { id: 9, gesehen: null, ports: null } };
ServiceManager.register('dbService', {
    query: async (sql, p) => {
        const t = sql.replace(/\s+/g, ' ').trim();
        if (/^UPDATE werkbank_sitzungen SET entwurf = \? WHERE id = \?$/.test(t)) return {};
        if (/^SELECT gesehen, ports FROM werkbank_laeufe WHERE id = \?$/.test(t)) return [{ gesehen: lager.lauf.gesehen, ports: lager.lauf.ports }];
        if (/^UPDATE werkbank_laeufe SET ports = \?, gesehen = \? WHERE id = \?$/.test(t)) { lager.lauf.ports = p[0]; lager.lauf.gesehen = p[1]; return { affectedRows: 1 }; }
        throw new Error(`Attrappe kennt die Abfrage nicht: ${t.slice(0, 90)}`);
    },
});
const S = require('../plugins/werkbank/dashboard/helpers/Sitzungen');

let fehler = 0;
async function pruefe(was, tun) {
    try { await tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').slice(0, 4).join('\n      ')}`); }
}

// Der gemessene Fall: Lauf 51 der Sitzung „7 Days To Die", 2026-10-08.
const P = (port, protocol) => ({ port, protocol });
const GESEHEN = [P(11000, 'udp'), P(26900, 'tcp'), P(26900, 'udp'), P(26902, 'udp'), P(51333, 'udp')];
const KONSOLE = [
    'fb-init: Bereitschaft endet bei "Port 26902 ist offen". Ob das Spiel schon antwortet, wird nicht geprüft — das Paket verlangt keine Query.',
    '2026-10-08T08:28:39 5.757 INF Started Telnet on 8081',
    '2026-10-08T08:28:43 9.754 INF NET: LiteNetLib server started',
    'GamePref.ConnectToServerPort = 26900',
    '2026-10-08T08:29:43 69.722 INF [LANMasterServerAnnouncer] listening on 11000 and multicast group 239.192.0.1',
].join('\n');
const sitzung = (ports = [], nummern = {}) => ({ id: 5, kennung: 'wb7d', image: { ref: 'fb/steamcmd', tag: 'x' }, entwurf: {
    identity: { slug: 'sdtd', name: '7 Days', version: '1.0.0' }, ports: JSON.parse(JSON.stringify(ports)),
    start: { program: './7DaysToDieServer.x86_64', args: [{ key: 'cfg', parts: [{ text: '-configfile=serverconfig.xml' }] }], ready_when: { port: 'game' } },
    werkbank: { portnummern: { ...nummern } },
} });
const lauf = (mehr = {}) => ({ id: 51, status: 'laeuft', ports: GESEHEN, gesehen: GESEHEN, konsole: KONSOLE, ...mehr });
const zeile = (bild, port) => bild.beobachtet.find(b => b.port === port);

(async () => {
    console.log('\nDas Bild: einordnen, was sich ohne Wissen über das Spiel sagen lässt');
    await pruefe('fünf beobachtete Zeilen sind vier Ports — tcp und udp derselben Nummer gehören zusammen', async () => {
        const b = S.portBild(sitzung(), [], [lauf()]);
        assert.deepStrictEqual(b.beobachtet.map(x => [x.port, x.protocol]), [[11000, 'udp'], [26900, 'both'], [26902, 'udp'], [51333, 'udp']]);
        assert.strictEqual(b.laeuft, true); assert.strictEqual(b.stand, 'laeuft');
        assert.ok(b.beobachtet.every(x => x.zweck === null && x.vorschlag === null), 'ohne Port im Entwurf gibt es nichts zu koppeln');
    });
    await pruefe('das Spiel sagt selbst, was 11000 ist — die eigene Zeile von fb-init und ein blosser Wert zählen nicht', async () => {
        const b = S.portBild(sitzung(), [], [lauf()]);
        assert.strictEqual(zeile(b, 11000).konsole, '[LANMasterServerAnnouncer] listening on 11000 and multicast group 239.192.0.1');
        assert.strictEqual(zeile(b, 26902).konsole, null, 'die Meldung von fb-init wurde als Aussage des Spiels gezeigt');
        assert.strictEqual(zeile(b, 26900).konsole, null, '„GamePref.ConnectToServerPort = 26900" sagt nicht, dass dort etwas lauscht');
        assert.strictEqual(S.konsolenZeileZu('listening on 110000', 11000), null, 'eine längere Zahl wurde für die Nummer gehalten');
        assert.strictEqual(S.konsolenZeileZu('bound to 10.0.0.1:26900', 26900), 'bound to 10.0.0.1:26900');
        // Keine Uhrzeit, kein Nachkommateil, kein Stück einer Adresse.
        assert.strictEqual(S.konsolenZeileZu('2026-10-08T08:28:39 started something', 28), null, 'ein Teil der Uhrzeit wurde für den Port gehalten');
        assert.strictEqual(S.konsolenZeileZu('Loading took 0.722 s, listening', 722), null);
        assert.strictEqual(S.konsolenZeileZu('Server listening on 7777.', 7777), 'Server listening on 7777.');
        assert.ok(S.konsolenZeileZu('\x1b[32mServer listening on 7777\x1b[0m ' + 'x'.repeat(300), 7777).length <= 160);
    });
    await pruefe('ist 26900 als game übernommen, bekommt 26902 den Vorschlag „game + 2" — und 11000 keinen', async () => {
        const b = S.portBild(sitzung([{ purpose: 'game', protocol: 'both', assign: 'pool' }], { game: 26900 }), [], [lauf()]);
        assert.strictEqual(zeile(b, 26900).zweck, 'game');
        assert.deepStrictEqual(zeile(b, 26900).fehlt, []);
        assert.deepStrictEqual(zeile(b, 26902).vorschlag, { basis: 'game', abstand: 2 });
        assert.strictEqual(zeile(b, 11000).vorschlag, null, '11000 liegt UNTER game — das ist keine Kopplung');
        assert.strictEqual(zeile(b, 51333).vorschlag, null, 'ein Port 24 000 Nummern weiter wurde als gekoppelt vorgeschlagen');
        assert.deepStrictEqual(b.entwurf, [{ purpose: 'game', protocol: 'both', nummer: 26900, kopplung: null, lauscht: true }]);
        assert.deepStrictEqual(b.ungenutzt, ['game'], 'dass auf game nichts verweist, steht nicht im Bild');
    });
    await pruefe('nur udp übernommen, tcp lauscht auch: das Bild sagt, was fehlt', async () => {
        const b = S.portBild(sitzung([{ purpose: 'game', protocol: 'udp', assign: 'pool' }], { game: 26900 }), [], [lauf()]);
        assert.deepStrictEqual(zeile(b, 26900).fehlt, ['tcp']);
    });
    await pruefe('gekoppelt wird an einen Port mit eigener Nummer — nie an einen, der selbst hängt', async () => {
        const b = S.portBild(sitzung([{ purpose: 'game', protocol: 'both', assign: 'pool' }, { purpose: 'daten', protocol: 'udp', assign: 'game+2' }],
            { game: 26900, daten: 26902 }), [], [lauf({ ports: [...GESEHEN, P(26903, 'udp')] })]);
        assert.deepStrictEqual(zeile(b, 26903).vorschlag, { basis: 'game', abstand: 3 });
        assert.deepStrictEqual(b.entwurf[1].kopplung, { basis: 'game', abstand: 2 });
    });
    await pruefe('der Zufallsport: aus dem Bereich ausgehender Ports und im vorigen Start nicht dabei', async () => {
        const erster = S.portBild(sitzung(), [], [lauf()]);
        assert.match(zeile(erster, 51333).zufall, /Nach dem nächsten Start vergleichen/);
        assert.strictEqual(zeile(erster, 26900).zufall, null);
        // Zweiter Start: dieselben Dienste, der Zufallsport heisst jetzt 51737 (so gemessen).
        const jetzt = [P(11000, 'udp'), P(26900, 'tcp'), P(26900, 'udp'), P(26902, 'udp'), P(51737, 'udp')];
        const zweiter = S.portBild(sitzung(), [], [lauf({ id: 53, ports: jetzt, gesehen: jetzt }), lauf({ status: 'beendet', ports: [] })]);
        assert.match(zeile(zweiter, 51737).zufall, /Im vorigen Start nicht dabei/);
        // Ein hoher Port, der in BEIDEN Starts lauscht, ist ein Dienst.
        const fest = [P(40000, 'udp')];
        const dienst = S.portBild(sitzung(), [], [lauf({ ports: fest, gesehen: fest }), lauf({ status: 'beendet', ports: [], gesehen: fest })]);
        assert.strictEqual(zeile(dienst, 40000).zufall, null, 'ein Port, der jedes Mal da ist, wurde als Zufall bezeichnet');
        // Übernommen ist übernommen — dann wird nicht mehr gewarnt.
        const genommen = S.portBild(sitzung([{ purpose: 'x', protocol: 'udp', assign: 'pool' }], { x: 51333 }), [], [lauf()]);
        assert.strictEqual(zeile(genommen, 51333).zufall, null);
    });
    await pruefe('nach dem Ende: was der Lauf gesehen hat, steht noch zum Übernehmen da', async () => {
        const b = S.portBild(sitzung(), [], [lauf({ status: 'beendet', ports: [] })]);
        assert.strictEqual(b.laeuft, false); assert.strictEqual(b.stand, 'gesehen');
        assert.strictEqual(b.beobachtet.length, 4);
        // Ein Lauf von vor dieser Spalte: nichts gemerkt, nichts zu zeigen — und kein Absturz.
        const alt = S.portBild(sitzung(), [], [{ id: 1, status: 'beendet', ports: [], gesehen: null, konsole: null }]);
        assert.strictEqual(alt.stand, 'leer');
        assert.strictEqual(S.portBild(sitzung(), [], []).stand, 'leer');
    });

    console.log('\nMerken und übernehmen');
    await pruefe('was ein Lauf je sah, wird vereint — auch wenn am Ende nichts mehr lauscht', async () => {
        lager.lauf = { id: 9, gesehen: null, ports: null };
        await S.laufPortsMerken(9, [P(26900, 'udp'), P(26900, 'tcp')]);
        await S.laufPortsMerken(9, [P(26900, 'udp'), P(26902, 'udp'), { port: 'x', protocol: 'udp' }, { port: 5, protocol: 'sctp' }]);
        assert.deepStrictEqual(await S.laufPortsMerken(9, []), [P(26900, 'tcp'), P(26900, 'udp'), P(26902, 'udp')]);
        assert.strictEqual(lager.lauf.ports, '[]');
        assert.deepStrictEqual(JSON.parse(lager.lauf.gesehen), [P(26900, 'tcp'), P(26900, 'udp'), P(26902, 'udp')]);
        // Ein Lauf, der schon lief, als die Spalte kam: Was in `ports` stand, zählt mit.
        lager.lauf = { id: 9, gesehen: null, ports: JSON.stringify([P(11000, 'udp')]) };
        assert.deepStrictEqual(await S.laufPortsMerken(9, []), [P(11000, 'udp')]);
    });
    await pruefe('übernehmen mit Kopplung: 26902 als „daten", fest über game + 2', async () => {
        const s = sitzung([{ purpose: 'game', protocol: 'both', assign: 'pool' }], { game: 26900 });
        await S.portUebernehmen(s, { zweck: 'daten', protocol: 'udp', port: 26902, basis: 'game', abstand: 2 });
        assert.deepStrictEqual(s.entwurf.ports[1], { purpose: 'daten', protocol: 'udp', assign: 'game+2' });
        assert.strictEqual(s.entwurf.werkbank.portnummern.daten, 26902);
        // Ohne Kopplung bleibt es bei der eigenen Nummer, wie bisher.
        await S.portUebernehmen(s, { zweck: 'lan', protocol: 'udp', port: 11000 });
        assert.strictEqual(s.entwurf.ports[2].assign, 'pool');
    });
    await pruefe('abgelehnt: Kopplung an sich selbst, an einen unbekannten oder gekoppelten Port, falscher Abstand, widersprechende Nummer', async () => {
        const s = sitzung([{ purpose: 'game', protocol: 'both', assign: 'pool' }, { purpose: 'daten', protocol: 'udp', assign: 'game+2' }], { game: 26900, daten: 26902 });
        const vorher = JSON.stringify(s.entwurf);
        await assert.rejects(S.portUebernehmen(s, { zweck: 'x', protocol: 'udp', port: 26903, basis: 'x', abstand: 1 }), /nicht an sich selbst/);
        await assert.rejects(S.portUebernehmen(s, { zweck: 'x', protocol: 'udp', port: 26903, basis: 'nirgends', abstand: 1 }), /gibt es im Entwurf nicht/);
        await assert.rejects(S.portUebernehmen(s, { zweck: 'x', protocol: 'udp', port: 26903, basis: 'daten', abstand: 1 }), /hängt selbst an einem anderen Port/);
        await assert.rejects(S.portUebernehmen(s, { zweck: 'x', protocol: 'udp', port: 26903, basis: 'game', abstand: 0 }), /Abstand/);
        await assert.rejects(S.portUebernehmen(s, { zweck: 'x', protocol: 'udp', port: 26903, basis: 'game', abstand: 5 }), /müsste auf 26905 lauschen/);
        assert.strictEqual(JSON.stringify(s.entwurf), vorher, 'ein abgelehnter Versuch hat etwas geschrieben');
    });

    // ── Die Zeichnung ────────────────────────────────────────────────────────
    console.log('\nZeichnung im Browser (nachgestellt)');
    const ansicht = ohneKommentareEjs(fs.readFileSync(path.join(WURZEL, 'plugins/werkbank/dashboard/views/guild/werkbank-sitzung.ejs'), 'utf8'));
    const anfang = ansicht.indexOf("var portRahmen = document.getElementById('laufPortBild');");
    const ende = ansicht.indexOf("var knopfDateien = document.getElementById('knopfDateien');");
    assert.ok(anfang > 0 && ende > anfang, 'das Skript der Ports ist in der Ansicht nicht mehr zu finden');
    const skript = ansicht.slice(anfang, ende);

    /** Ein Knoten, der sich merkt, was man ihm gibt — genug für diese Zeichnung. */
    function knoten(art) {
        const k = { art, className: '', kinder: [], dataset: {}, style: {}, attribute: {}, hoerer: {}, optionen: [], _text: '' };
        Object.defineProperty(k, 'textContent', { get() { return k._text + k.kinder.map(x => x.textContent).join(''); }, set(v) { k._text = String(v); k.kinder = []; } });
        k.appendChild = (x) => { k.kinder.push(x); return x; };
        k.append = (...xs) => { k.kinder.push(...xs); };
        k.setAttribute = (n, v) => { k.attribute[n] = v; };
        k.addEventListener = (n, f) => { k.hoerer[n] = f; };
        k.add = (o) => { k.optionen.push(o); if (o.selected) k.value = o.value; };
        return k;
    }
    const alle = (k, test, aus = []) => { if (test(k)) aus.push(k); k.kinder.forEach(x => alle(x, test, aus)); return aus; };
    function seite(bild, spielLaeuft) {
        const teile = { laufPortBild: knoten('div'), laufPorts: knoten('div'), laufPortsEntwurf: knoten('div'), laufPortsTitel: knoten('div') };
        teile.laufPortBild.dataset.bild = JSON.stringify(bild);
        const gesendet = [], gemeldet = [], hoerer = {};
        let neuGeladen = 0;
        const umgebung = {
            document: { getElementById: (id) => teile[id] || null, createElement: knoten, addEventListener: (n, f) => { hoerer[n] = f; } },
            Option: function (text, value, a, selected) { return { text, value, selected: Boolean(selected) }; },
            wurzel: { dataset: { werkbankSpiel: spielLaeuft ? '1' : '0' } }, hier: '/h',
            schicke: async (pfad, nutzlast) => { gesendet.push({ pfad, nutzlast }); return { success: true, bild: umgebung.antwortBild || bild }; },
            melde: (art, text) => gemeldet.push(art + ': ' + text),
            window: { location: { reload: () => { neuGeladen++; } } },
            JSON, Number, encodeURIComponent,
        };
        vm.runInNewContext(skript + '\n;this.zeichnePortBild = zeichnePortBild;', umgebung);
        return { teile, gesendet, gemeldet, hoerer, umgebung, neuGeladen: () => neuGeladen };
    }
    const bild7d = S.portBild(sitzung([{ purpose: 'game', protocol: 'udp', assign: 'pool' }], { game: 26900 }), [], [lauf()]);

    await pruefe('gezeichnet wird, was das Bild sagt: ein Port je Nummer, Vorschlag, Zeile des Spiels, Zufall, fehlendes Protokoll', async () => {
        const s = seite(bild7d, true);
        const text = s.teile.laufPorts.textContent;
        assert.strictEqual(s.teile.laufPortsTitel.textContent, 'Beobachtet (lauscht im Container)');
        assert.strictEqual(s.teile.laufPorts.kinder.length, 4, 'nicht vier Ports gezeichnet');
        assert.ok(text.includes('26900/tcp+udp') && text.includes('im Entwurf als game'));
        assert.ok(text.includes('lauscht auch auf tcp') && text.includes('tcp dazunehmen'), 'das fehlende Protokoll wird nicht angeboten');
        assert.ok(text.includes('Das Spiel sagt: [LANMasterServerAnnouncer] listening on 11000'), 'die Zeile der Konsole fehlt');
        assert.ok(text.includes('vermutlich kein Dienst'), 'der Zufallsport ist nicht gekennzeichnet');
        const wahl = alle(s.teile.laufPorts, k => k.art === 'select');
        assert.strictEqual(wahl.length, 1, 'genau EIN Port hat einen Kopplungsvorschlag');
        assert.deepStrictEqual(wahl[0].optionen.map(o => [o.text, o.value, o.selected]), [['fest: game + 2', 'game|2', true], ['eigene Nummer', '', false]]);
        // Rechts der Entwurf — und dass auf game nichts verweist.
        const rechts = s.teile.laufPortsEntwurf.textContent;
        assert.ok(rechts.includes('game') && rechts.includes('26900/udp') && rechts.includes('verweist nichts') && rechts.includes('{{port:game}}'));
        const weg = alle(s.teile.laufPortsEntwurf, k => k.art === 'button');
        assert.ok(weg.length === 1 && !weg[0].disabled, 'Entfernen ist gesperrt, während das Spiel läuft');
    });
    await pruefe('übernehmen schickt die Kopplung mit — und zeichnet neu, statt die Seite zu laden, solange das Spiel läuft', async () => {
        const s = seite(bild7d, true);
        const f = alle(s.teile.laufPorts, k => k.art === 'form').find(x => x.dataset.port === 26902);
        f.zweck = { value: 'daten' }; f.vergabe = alle(f, k => k.art === 'select')[0];
        s.umgebung.antwortBild = S.portBild(sitzung([{ purpose: 'game', protocol: 'udp', assign: 'pool' }, { purpose: 'daten', protocol: 'udp', assign: 'game+2' }],
            { game: 26900, daten: 26902 }), [], [lauf()]);
        await s.teile.laufPorts.hoerer.submit({ target: { closest: (sel) => (sel === '[data-port-uebernehmen]' ? f : null) }, preventDefault() {} });
        // Über JSON: Die Nutzlast entsteht in der nachgestellten Seite, ihre Objekte sind von dort.
        assert.deepStrictEqual(JSON.parse(JSON.stringify(s.gesendet)), [{ pfad: '/h/ports', nutzlast: { zweck: 'daten', port: 26902, protocol: 'udp', basis: 'game', abstand: 2 } }]);
        assert.strictEqual(s.neuGeladen(), 0, 'die Seite wurde neu geladen — die Konsole wäre weg');
        assert.ok(s.teile.laufPortsEntwurf.textContent.includes('= game + 2'), 'der neue Stand ist nicht gezeichnet');
        assert.ok(s.gemeldet[0].startsWith('success:'));
        // „eigene Nummer" gewählt: keine Kopplung in der Nutzlast.
        f.vergabe = { value: '' };
        await s.teile.laufPorts.hoerer.submit({ target: { closest: () => f }, preventDefault() {} });
        assert.deepStrictEqual(Object.keys(s.gesendet[1].nutzlast), ['zweck', 'port', 'protocol']);
    });
    await pruefe('läuft nichts, lädt die Seite nach einer Änderung neu — dann stimmt auch „Verbindung"', async () => {
        const ruhend = S.portBild(sitzung(), [], [lauf({ status: 'beendet', ports: [] })]);
        const s = seite(ruhend, false);
        assert.strictEqual(s.teile.laufPortsTitel.textContent, 'Beim letzten Start gesehen');
        const f = alle(s.teile.laufPorts, k => k.art === 'form')[0];
        f.zweck = { value: 'lan' };
        await s.teile.laufPorts.hoerer.submit({ target: { closest: () => f }, preventDefault() {} });
        assert.strictEqual(s.neuGeladen(), 1);
        // Leer: der Satz, der sagt, was zu tun ist.
        const leer = seite(S.portBild(sitzung(), [], []), false);
        assert.ok(leer.teile.laufPorts.textContent.startsWith('Noch keiner.'));
        assert.ok(leer.teile.laufPortsEntwurf.textContent.startsWith('Noch kein Port.'));
    });

    console.log('\nEinbindung');
    await pruefe('Seite, Meldung und Antwort bekommen dasselbe Bild; die Karte zeichnet nicht mehr selbst im Aufbau', async () => {
        const router = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'plugins/werkbank/dashboard/routes/guild.router.js'), 'utf8'));
        assert.ok(router.includes('portBild: Sitzungen.portBild(sitzung, liste, laeufe)'), 'die Seite bekommt das Bild nicht');
        assert.strictEqual((router.match(/bild: await portBildFuer\(sitzung\)/g) || []).length, 2, 'Übernehmen und Entfernen antworten nicht beide mit dem Bild');
        const ereignisse = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'plugins/werkbank/dashboard/helpers/Ereignisse.js'), 'utf8'));
        assert.ok(/sende\(lauf\.guildId, \{ action: 'ports', sitzung_id: kennung, ports, bild \}\)/.test(ereignisse), 'die Meldung des Daemons geht ohne Bild hinaus');
        assert.ok(ansicht.includes('id="laufPortBild"') && ansicht.includes("data-bild=\"<%= JSON.stringify(locals.portBild"), 'der Rahmen trägt das Bild nicht');
        assert.ok(!/data-uebernommen|function zeichnePorts\(/.test(ansicht), 'die alte, zweite Zeichnung steht noch da');
        assert.ok(ansicht.includes('zeichnePortBild(d.bild ||'), 'die Meldung des Daemons wird nicht mit dem Bild gezeichnet');
        // Gezeichnet wird nur mit textContent — Konsolenzeilen kommen vom Spiel.
        assert.ok(!/innerHTML/.test(skript), 'die Zeichnung der Ports setzt innerHTML');
    });

    console.log(fehler === 0 ? '\n✅ Ports im Probestart: eingeordnet, gekoppelt, gemerkt\n' : `\n❌ ${fehler} Abweichung(en)\n`);
    process.exit(fehler === 0 ? 0 : 1);
})().catch((e) => { console.error('FEHLER:', e.message); process.exit(1); });
