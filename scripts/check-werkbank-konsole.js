#!/usr/bin/env node
/**
 * Werkbank: Die Konsole hält einer Flut stand (2026-10-09).
 *
 * ── Was hier geprüft wird ───────────────────────────────────────────────────
 *
 * Anlass (Betreiber, 2026-10-09): „der tab freezt immer wieder mit der konsole
 * — zu viel output?" Core Keeper mit `-nographics` schrieb rund 400 Zeilen je
 * Sekunde und hörte nie auf. Die Seite zeichnete jede Zeile einzeln (messen,
 * anhängen, rollen); der Tab fror bei jedem Öffnen wieder ein, und „Stoppen"
 * war damit unerreichbar.
 *
 * Jetzt sammelt die Seite und zeichnet in Schüben. Geprüft wird das Skript
 * SELBST — aus der Ansicht herausgelöst und gegen ein nachgebautes Dokument
 * gefahren, mit einer Uhr, die der Wächter stellt:
 *
 *   - Eine Flut kostet so viele Zeichenvorgänge wie Schübe, nicht wie Zeilen.
 *   - Je Schub wird die Höhe EINMAL gemessen.
 *   - Der Kasten wächst nicht über seine Grenze; was fehlt, steht da — mit Zahl.
 *   - Die letzte Zeile, die kam, ist die letzte, die dasteht.
 *   - Ohne Flut geht nichts verloren und nichts wird behauptet.
 *
 * Einen Browser gibt es hier nicht. Was das Nachgebaute nicht zeigt: wie lange
 * ein echter Browser für einen Schub braucht. Das misst nur ein echter Lauf.
 *
 *   node scripts/check-werkbank-konsole.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { ohneKommentareEjs } = require('./lib/quelltext');

const ANSICHT = path.join(__dirname, '../plugins/werkbank/dashboard/views/guild/werkbank-sitzung.ejs');
const roh = fs.readFileSync(ANSICHT, 'utf8');
const ansicht = ohneKommentareEjs(roh);

let fehler = 0;
function pruefe(was, tun) {
    try { tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').slice(0, 5).join('\n      ')}`); }
}

// ── Das Skript herauslösen ───────────────────────────────────────────────────
const stueck = /var AUSGABE = \{[^\n]*\n  function sammler\(kasten, alsZeilen\) \{[\s\S]*?\n  \}\n/.exec(ansicht);
if (!stueck) { console.error('FEHLER: `sammler` in der Ansicht nicht gefunden — der Wächter mässe nichts.'); process.exit(1); }

// ── Ein Dokument, gerade so viel wie das Skript braucht ──────────────────────
function welt() {
    const zaehler = { anhaengen: 0, messen: 0, rollen: 0, entfernen: 0 };
    const knoten = (art) => ({ art, kinder: [], dataset: {}, className: '', textContent: '' });
    const elemente = (k) => k.kinder.filter(x => x.art === 'div');
    const document = {
        createElement: () => knoten('div'),
        createTextNode: (t) => ({ art: 'text', textContent: String(t) }),
        createDocumentFragment: () => knoten('stueck'),
    };
    const kasten = {
        kinder: [], clientHeight: 100, _roll: 0,
        get scrollHeight() { zaehler.messen++; return 100; },
        get scrollTop() { return this._roll; },
        set scrollTop(v) { zaehler.rollen++; this._roll = v; },
        get childElementCount() { return elemente(this).length; },
        get firstElementChild() { return elemente(this)[0] || null; },
        get firstChild() { return this.kinder[0] || null; },
        appendChild(k) { zaehler.anhaengen++; if (k.art === 'stueck') this.kinder.push(...k.kinder); else this.kinder.push(k); return k; },
        removeChild(k) { zaehler.entfernen++; const i = this.kinder.indexOf(k); assert.ok(i >= 0, 'removeChild: kein Kind'); this.kinder.splice(i, 1); return k; },
        insertBefore(k, vor) { const i = vor ? this.kinder.indexOf(vor) : this.kinder.length; this.kinder.splice(i < 0 ? 0 : i, 0, k); return k; },
        get textContent() { return this.kinder.map(x => x.textContent).join(''); },
        set textContent(v) { this.kinder = v === '' ? [] : [{ art: 'text', textContent: String(v) }]; },
    };
    for (const k of ['kinder']) Object.defineProperty(kasten, k, { writable: true, enumerable: true, value: [] });
    // Fragment: appendChild sammelt nur.
    const fragAppend = function (k) { this.kinder.push(k); return k; };
    const origFrag = document.createDocumentFragment;
    document.createDocumentFragment = () => { const f = origFrag(); f.appendChild = fragAppend; return f; };
    const uhr = [];
    const setTimeout = (tu, ms) => { uhr.push({ tu, ms }); };
    const { sammler, AUSGABE } = new Function('document', 'setTimeout', `${stueck[0]}; return { sammler: sammler, AUSGABE: AUSGABE };`)(document, setTimeout);
    const tick = () => { const jetzt = uhr.splice(0); jetzt.forEach(e => e.tu()); return jetzt.length; };
    return { kasten, zaehler, sammler, AUSGABE, tick, uhr, zeilen: () => elemente(kasten) };
}

console.log('\nOhne Flut');
pruefe('zehn Zeilen: alle da, in ihrer Reihenfolge, ohne Hinweis — und in EINEM Schub gezeichnet', () => {
    const w = welt();
    const hinein = w.sammler(w.kasten, true);
    for (let i = 1; i <= 10; i++) hinein('Zeile ' + i);
    assert.strictEqual(w.zeilen().length, 0, 'gezeichnet wird, bevor der Takt um ist');
    assert.strictEqual(w.uhr.length, 1, 'je Zeile wurde ein eigener Takt geplant');
    assert.strictEqual(w.uhr[0].ms, w.AUSGABE.takt);
    w.tick();
    assert.deepStrictEqual(w.zeilen().map(z => z.textContent), Array.from({ length: 10 }, (_, i) => 'Zeile ' + (i + 1)));
    assert.ok(!w.zeilen().some(z => z.dataset.hinweis), 'ohne Flut steht ein Hinweis da');
    assert.deepStrictEqual({ a: w.zaehler.anhaengen, m: w.zaehler.messen, r: w.zaehler.rollen }, { a: 1, m: 2, r: 1 });
});
pruefe('wer nach oben gerollt hat, wird nicht nach unten gezogen', () => {
    const w = welt();
    const hinein = w.sammler(w.kasten, true);
    // scrollHeight 100, clientHeight 100: scrollTop -50 heisst „nicht unten".
    w.kasten._roll = -50;
    hinein('x'); w.tick();
    assert.strictEqual(w.zaehler.rollen, 0, 'der Kasten sprang nach unten, obwohl jemand oben las');
});

console.log('\nFlut');
pruefe('400 Zeilen je Sekunde, zehn Minuten lang: so viele Zeichenvorgänge wie Schübe — nicht wie Zeilen', () => {
    const w = welt();
    const hinein = w.sammler(w.kasten, true);
    const jeTakt = Math.round(400 * w.AUSGABE.takt / 1000), takte = Math.round(600000 / w.AUSGABE.takt);
    let n = 0;
    for (let t = 0; t < takte; t++) { for (let i = 0; i < jeTakt; i++) hinein('Z' + (++n)); w.tick(); }
    assert.strictEqual(n, 240000);
    assert.strictEqual(w.zaehler.anhaengen, takte, `${w.zaehler.anhaengen} Zeichenvorgänge für ${takte} Schübe`);
    assert.ok(w.zaehler.messen <= takte * 2, `die Höhe wurde ${w.zaehler.messen}-mal gemessen — mehr als zweimal je Schub`);
    assert.ok(w.kasten.childElementCount <= w.AUSGABE.behalten + 1, `im Kasten stehen ${w.kasten.childElementCount} Zeilen, die Grenze ist ${w.AUSGABE.behalten}`);
    const zeilen = w.zeilen();
    assert.strictEqual(zeilen[zeilen.length - 1].textContent, 'Z240000', 'die letzte Zeile, die kam, steht nicht am Ende');
    assert.strictEqual(zeilen[0].dataset.hinweis, 'oben', 'oben steht nicht, dass Älteres fehlt');
    assert.strictEqual(zeilen.filter(z => z.dataset.hinweis === 'oben').length, 1, 'der Hinweis „ältere Zeilen" stapelt sich');
    // Bei 400/s passt jeder Schub durch — übersprungen wird nichts.
    assert.ok(!zeilen.some(z => /übersprungen/.test(z.textContent)), 'bei 60 Zeilen je Schub wurde etwas übersprungen');
});
pruefe('mehr in einem Schub, als sich lesen lässt: das Ältere wird übersprungen, und die Stelle nennt die Zahl', () => {
    const w = welt();
    const hinein = w.sammler(w.kasten, true);
    const viele = w.AUSGABE.jeSchub + 1234;
    for (let i = 1; i <= viele; i++) hinein('F' + i);
    w.tick();
    const zeilen = w.zeilen();
    assert.strictEqual(zeilen.length, w.AUSGABE.jeSchub + 1);
    assert.match(zeilen[0].textContent, /1\.234 Zeilen übersprungen/);
    assert.strictEqual(zeilen[0].dataset.hinweis, '1');
    assert.strictEqual(zeilen[1].textContent, 'F1235', 'übersprungen wurde nicht das ÄLTERE');
    assert.strictEqual(zeilen[zeilen.length - 1].textContent, 'F' + viele);
});
pruefe('die Textkästen (Schritt-Ausgabe, Prüfprotokoll): ein Textknoten je Schub, mit Grenze', () => {
    const w = welt();
    const hinein = w.sammler(w.kasten, false);
    hinein('a'); hinein('b'); w.tick();
    assert.strictEqual(w.kasten.textContent, 'a\nb\n');
    assert.strictEqual(w.zaehler.anhaengen, 1);
    const lang = 'x'.repeat(1000);
    for (let t = 0; t < 600; t++) { for (let i = 0; i < 10; i++) hinein(lang); w.tick(); }
    assert.ok(w.kasten.textContent.length <= w.AUSGABE.zeichen + 11000, `der Text ist auf ${w.kasten.textContent.length} Zeichen gewachsen`);
    assert.match(w.kasten.textContent, /^… älterer Text ausgeblendet/);
});

console.log('\nIn der Seite');
pruefe('der Strom zeichnet nichts mehr selbst — jede Ausgabe geht durch einen Sammler', () => {
    const von = ansicht.indexOf("strom.addEventListener('werkbank'"), bis = ansicht.indexOf("var formF = document.getElementById('formFern')");
    assert.ok(von > 0 && bis > von);
    const strom = ansicht.slice(von, bis);
    assert.ok(!/textContent \+=/.test(ansicht), 'irgendwo wird noch per `textContent +=` angehängt');
    assert.ok(!/konsole\.appendChild|createElement\('div'\)/.test(strom), 'der Strom hängt Zeilen einzeln an');
    assert.ok(!/scrollHeight/.test(strom), 'der Strom misst je Ereignis die Höhe');
    for (const s of ["inKonsole(lesbar(d.line))", "insProtokoll(lesbar(d.line))", "inLive("]) assert.ok(strom.includes(s), `„${s}" fehlt`);
    assert.match(ansicht, /var inKonsole = sammler\(konsole, true\);/);
});
pruefe('ein Hinweis ist keine Konsolenzeile: Der Klick „als Bereitschaftszeile" übergeht ihn', () => {
    assert.ok(ansicht.includes("ev.target.closest('#laufKonsole > div:not([data-hinweis])')"));
});

console.log(fehler === 0 ? '\n✅ Konsole: zeichnet in Schüben, bleibt in ihrer Grenze, und sagt, was sie auslässt\n' : `\n❌ ${fehler} Abweichung(en)\n`);
process.exit(fehler === 0 ? 0 : 1);
