#!/usr/bin/env node
/**
 * Werkbank: die Reiter der Sitzungsseite (2026-10-08).
 *
 * Die Seite war elf Karten lang. Seit heute liegen die Karten nach
 * Arbeitsschritt in fünf Reitern. Drei Dinge können dabei still kaputtgehen,
 * ohne dass etwas abstürzt:
 *
 *   - Eine Karte liegt in KEINEM Reiter — dann ist sie nie zu sehen. Das
 *     passiert, wenn jemand eine neue Karte zwischen zwei Hüllen setzt.
 *   - Ein Reiter in der Leiste hat keine Hülle (oder umgekehrt) — der Knopf
 *     öffnet eine leere Seite.
 *   - Das Skript der Leiste findet seinen Reiter nicht aus der Adresse — nach
 *     jedem Speichern steht man wieder im ersten.
 *
 * Geprüft wird am Quelltext der Ansicht (Reihenfolge und Zuordnung) und am
 * Skript der Leiste in einer nachgestellten Umgebung.
 *
 *   node scripts/check-werkbank-reiter.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { ohneKommentareEjs } = require('./lib/quelltext');

const WURZEL = path.join(__dirname, '..');
const DATEI = 'plugins/werkbank/dashboard/views/guild/werkbank-sitzung.ejs';
// Ohne Kommentare: Ein Reitername in einer Erklärung ist kein Reiter.
const ansicht = ohneKommentareEjs(fs.readFileSync(path.join(WURZEL, DATEI), 'utf8'));

let fehler = 0;
function pruefe(was, tun) {
    try { tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').slice(0, 3).join('\n      ')}`); }
}

// Was wohin gehört — die Absprache vom 2026-10-08. Eine Karte wird an etwas
// erkannt, das es im Quelltext genau einmal gibt.
const SOLL = {
    aufbauen:      ['<h3 class="card-title">Schritte</h3>', '<h3 class="card-title">Nächster Schritt</h3>', '<h3 class="card-title">Entwurf</h3>'],
    starten:       ['Probestart</h3>', 'id="karteVoraussetzungen"'],
    verbindung:    ['id="kartePorts"', 'id="karteFernsteuerung"'],
    einstellungen: ['id="karteEinstellungen"', 'id="karteFestzeilen"', 'id="karteHinweise"'],
    pruefen:       ['Prüfdurchlauf</h3>', 'id="formAngaben"', 'id="karteDurchgereicht"'],
};
const huellen = [...ansicht.matchAll(/<div class="col-12" data-reiter="([a-z]+)" role="tabpanel"/g)].map(m => ({ id: m[1], ab: m.index }));
const rahmenEnde = ansicht.indexOf("include('shared/medienwahl'");

console.log('\nAnsicht: jede Karte in ihrem Reiter');
pruefe('fünf Hüllen, in der Reihenfolge der Arbeit — und die Leiste nennt genau dieselben', () => {
    assert.deepStrictEqual(huellen.map(h => h.id), Object.keys(SOLL));
    const leiste = [...ansicht.matchAll(/\{ id: '([a-z]+)', titel: '[^']+', satz: '[^']+', icon: '[^']+'/g)].map(m => m[1]);
    assert.deepStrictEqual(leiste, Object.keys(SOLL), 'die Daten der Leiste (REITER) und die Hüllen laufen auseinander');
});
pruefe('jede Karte liegt in dem Reiter, in den sie gehört', () => {
    assert.ok(rahmenEnde > 0);
    huellen.forEach((h, i) => {
        const bis = i + 1 < huellen.length ? huellen[i + 1].ab : rahmenEnde;
        for (const marke of SOLL[h.id]) {
            const anzahl = ansicht.split(marke).length - 1;
            assert.strictEqual(anzahl, 1, `„${marke}" steht ${anzahl}-mal in der Ansicht — daran ist die Karte nicht mehr zu erkennen`);
            const wo = ansicht.indexOf(marke);
            assert.ok(wo > h.ab && wo < bis, `„${marke}" liegt nicht im Reiter „${h.id}"`);
        }
    });
});
pruefe('keine Karte steht ausserhalb eines Reiters — sie wäre nie zu sehen', () => {
    const karten = [...ansicht.matchAll(/class="card-title"/g)].map(m => m.index);
    const erwartet = Object.values(SOLL).reduce((n, l) => n + l.length, 0);
    assert.ok(karten.length >= erwartet, `nur ${karten.length} Karten gefunden`);
    for (const k of karten) assert.ok(k > huellen[0].ab && k < rahmenEnde, 'eine Karte steht vor dem ersten Reiter oder hinter dem letzten');
    // Jede Hülle wird geschlossen, bevor die nächste beginnt: genau fünf Enden.
    assert.strictEqual((ansicht.match(/^  <\/div><\/div>$/gm) || []).length, huellen.length, 'die Zahl der Hüllen-Enden stimmt nicht');
    // Eine neue Karte, die noch niemand einem Reiter zugeordnet hat, fällt hier auf.
    assert.strictEqual(karten.length, erwartet, `${karten.length} Karten in der Ansicht, ${erwartet} zugeordnet — die neue gehört in SOLL (und in einen Reiter)`);
});
pruefe('verborgen ist, was nicht offen ist — und für jeden Reiter gibt es die Regel, die ihn zeigt', () => {
    assert.ok(/#werkbankSitzung > \[data-reiter\] \{ display: none; \}/.test(ansicht));
    assert.ok(/REITER\.map\(function \(r\) \{ return '#werkbankSitzung\[data-aktiv="' \+ r\.id \+ '"\] > \[data-reiter="' \+ r\.id \+ '"\]'; \}\)/.test(ansicht), 'die Regel wird nicht aus REITER erzeugt');
    assert.ok(/data-aktiv="<%= reiterStart %>"/.test(ansicht), 'der Rahmen trägt keinen Reiter für den ersten Aufruf');
    const start = /const reiterStart = ([^;]+);/.exec(ansicht);
    assert.ok(start, 'reiterStart fehlt');
    for (const id of [...start[1].matchAll(/'([a-z]+)'/g)].map(m => m[1])) assert.ok(SOLL[id], `reiterStart nennt „${id}", den es nicht gibt`);
    for (const m of ansicht.matchAll(/data-reiter-sprung="<%= ([^%]+) %>"/g)) {
        for (const id of [...m[1].matchAll(/'([a-z]+)'/g)].map(x => x[1])) assert.ok(SOLL[id], `ein Sprung führt zu „${id}", den es nicht gibt`);
    }
});

// ── Das Skript der Leiste ────────────────────────────────────────────────────
console.log('\nSkript der Leiste');
const nachLeiste = ansicht.slice(ansicht.indexOf('id="reiterLeiste"'));
const skript = /<script>([\s\S]*?)<\/script>/.exec(nachLeiste)[1];

function seite(hash) {
    const ids = Object.keys(SOLL);
    const knoepfe = ids.map(id => {
        const k = { dataset: { reiterKnopf: id }, klassen: new Set(id === 'aufbauen' ? ['active'] : []), attribute: {}, hoerer: {} };
        k.classList = { toggle: (n, an) => { if (an) k.klassen.add(n); else k.klassen.delete(n); } };
        k.setAttribute = (n, v) => { k.attribute[n] = v; };
        k.addEventListener = (n, f) => { k.hoerer[n] = f; };
        return k;
    });
    const rahmen = { dataset: { aktiv: 'aufbauen' } };
    const kaesten = { liveAusgabe: { scrollTop: 0, scrollHeight: 400 }, laufKonsole: { scrollTop: 0, scrollHeight: 900 } };
    const leiste = { oben: 0, gerollt: 0, getBoundingClientRect() { return { top: this.oben }; }, scrollIntoView() { this.gerollt++; } };
    const hoerer = { dokument: {}, fenster: {} };
    const ersetzt = [];
    const umgebung = {
        location: { hash },
        history: { replaceState: (a, b, adresse) => { ersetzt.push(adresse); umgebung.location.hash = adresse; } },
        document: {
            getElementById: (id) => (id === 'werkbankSitzung' ? rahmen : id === 'reiterLeiste' ? leiste : kaesten[id] || null),
            querySelectorAll: (s) => (s === '[data-reiter-knopf]' ? knoepfe : []),
            addEventListener: (n, f) => { hoerer.dokument[n] = f; },
        },
        Array,
    };
    umgebung.window = { addEventListener: (n, f) => { hoerer.fenster[n] = f; } };
    vm.runInNewContext(skript, umgebung);
    const aktive = () => knoepfe.filter(k => k.klassen.has('active')).map(k => k.dataset.reiterKnopf);
    return { rahmen, knoepfe, kaesten, leiste, hoerer, ersetzt, aktive, umgebung };
}

pruefe('aus der Adresse: #verbindung öffnet diesen Reiter — ohne die Adresse anzufassen', () => {
    const s = seite('#verbindung');
    assert.strictEqual(s.rahmen.dataset.aktiv, 'verbindung');
    assert.deepStrictEqual(s.aktive(), ['verbindung']);
    assert.strictEqual(s.knoepfe[2].attribute['aria-selected'], 'true');
    assert.strictEqual(s.knoepfe[0].attribute['aria-selected'], 'false');
    assert.deepStrictEqual(s.ersetzt, []);
});
pruefe('ohne oder mit unbekanntem #… bleibt, was der Server gesetzt hat', () => {
    for (const hash of ['', '#', '#gibtsnicht', '#karteEinstellungen']) {
        const s = seite(hash);
        assert.strictEqual(s.rahmen.dataset.aktiv, 'aufbauen', `bei „${hash}"`);
        assert.deepStrictEqual(s.aktive(), ['aufbauen']);
    }
});
pruefe('Klick: Reiter öffnen, Adresse ERSETZEN, mitlaufende Kästen ans Ende', () => {
    const s = seite('');
    s.knoepfe[4].hoerer.click();
    assert.strictEqual(s.rahmen.dataset.aktiv, 'pruefen');
    assert.deepStrictEqual(s.aktive(), ['pruefen']);
    assert.deepStrictEqual(s.ersetzt, ['#pruefen'], 'die Adresse trägt den Reiter nicht — nach dem Speichern stünde man im ersten');
    assert.strictEqual(s.kaesten.laufKonsole.scrollTop, 900);
    assert.strictEqual(s.kaesten.liveAusgabe.scrollTop, 400);
    assert.strictEqual(s.leiste.gerollt, 0, 'zur Leiste gerollt, obwohl sie sichtbar war');
    // Steht die Leiste oberhalb des Sichtbaren, zurück zu ihr.
    s.leiste.oben = -300;
    s.knoepfe[1].hoerer.click();
    assert.strictEqual(s.leiste.gerollt, 1);
});
pruefe('Vor/Zurück und „Dorthin" in der Zustandszeile wechseln den Reiter ebenfalls', () => {
    const s = seite('#aufbauen');
    s.umgebung.location.hash = '#starten';
    s.hoerer.fenster.hashchange();
    assert.strictEqual(s.rahmen.dataset.aktiv, 'starten');
    assert.deepStrictEqual(s.ersetzt, [], 'ein Wechsel über die Adresse hat sie noch einmal geschrieben');
    s.hoerer.dokument.click({ target: { closest: (sel) => (sel === '[data-reiter-sprung]' ? { dataset: { reiterSprung: 'pruefen' } } : null) } });
    assert.strictEqual(s.rahmen.dataset.aktiv, 'pruefen');
    s.hoerer.dokument.click({ target: { closest: () => null } });
    assert.strictEqual(s.rahmen.dataset.aktiv, 'pruefen', 'ein Klick irgendwo hat den Reiter gewechselt');
});

console.log(fehler === 0 ? '\n✅ Reiter: jede Karte hat ihren Platz, und die Adresse hält ihn\n' : `\n❌ ${fehler} Abweichung(en)\n`);
process.exit(fehler === 0 ? 0 : 1);
