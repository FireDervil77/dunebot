#!/usr/bin/env node
/**
 * Ein Auge an jedem Kennwortfeld (2026-11-03): `kennwort-auge.js` stattet jedes
 * `input[type=password]` im Guild-Bereich aus, auch später eingefügte.
 *
 * Eine DOM-Bibliothek gibt es im Projekt nicht. Gefahren wird deshalb der echte Kern
 * des Skripts gegen eine kleine Attrappe, die nur kann, was er benutzt.
 *
 *   node scripts/check-kennwort-auge.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const WURZEL = path.join(__dirname, '..');
const { ausstatten, durchsuche } = require('../apps/dashboard/themes/default/assets/js/kennwort-auge.js');
const { ohneKommentare } = require('./lib/quelltext');

let fehler = 0;
function pruefe(was, tun) {
    try { tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').join('\n      ')}`); }
}

// ── Attrappe ────────────────────────────────────────────────────────────────
class Element {
    constructor(tag) {
        this.tagName = tag.toUpperCase();
        this.nodeType = 1;
        this.children = [];
        this.parentNode = null;
        this.attribute = {};
        this.dataset = {};
        this.className = '';
        this.hoerer = {};
        this.disabled = false;
        this.style = {};
    }
    get classList() {
        const el = this;
        return { contains: (k) => el.className.split(/\s+/).includes(k) };
    }
    get nextSibling() {
        if (!this.parentNode) return null;
        const g = this.parentNode.children;
        return g[g.indexOf(this) + 1] || null;
    }
    setAttribute(k, v) { this.attribute[k] = String(v); }
    hasAttribute(k) { return k in this.attribute; }
    addEventListener(art, f) { (this.hoerer[art] = this.hoerer[art] || []).push(f); }
    click() { (this.hoerer.click || []).forEach(f => f()); }
    _weg() { if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); }
    appendChild(k) { k._weg(); k.parentNode = this; this.children.push(k); return k; }
    insertBefore(k, vor) {
        if (!vor) return this.appendChild(k);
        k._weg(); k.parentNode = this;
        this.children.splice(this.children.indexOf(vor), 0, k);
        return k;
    }
    matches(sel) { return sel === 'input[type="password"]' && this.tagName === 'INPUT' && this.type === 'password'; }
    querySelectorAll(sel) {
        const aus = [];
        const geh = (e) => { for (const k of e.children) { if (k.matches(sel)) aus.push(k); geh(k); } };
        geh(this);
        return aus;
    }
}
const doc = { createElement: (t) => new Element(t) };
function feld(typ = 'password', klasse = 'form-control') {
    const i = new Element('input');
    i.type = typ;
    i.className = klasse;
    return i;
}
function in_(eltern, ...kinder) { for (const k of kinder) eltern.appendChild(k); return eltern; }
const knopfVon = (input) => input.parentNode.children.find(k => k.tagName === 'BUTTON');

// ── Prüfungen ───────────────────────────────────────────────────────────────
console.log('Das Auge');
pruefe('ein loses Feld kommt in eine Gruppe, das Auge direkt dahinter', () => {
    const i = feld();
    const box = in_(new Element('div'), i);
    assert.strictEqual(ausstatten(i, doc), true);
    assert.strictEqual(i.parentNode.className, 'input-group');
    assert.strictEqual(i.parentNode.parentNode, box);
    assert.deepStrictEqual(i.parentNode.children.map(k => k.tagName), ['INPUT', 'BUTTON']);
    assert.strictEqual(knopfVon(i).type, 'button', 'ein Submit-Knopf schickte das Formular ab');
});
pruefe('Klick zeigt das Kennwort und verbirgt es wieder, Symbol und Ansage folgen', () => {
    const i = feld();
    in_(new Element('div'), i);
    ausstatten(i, doc);
    const k = knopfVon(i);
    k.click();
    assert.strictEqual(i.type, 'text');
    assert.strictEqual(k.children[0].className, 'fa-solid fa-eye-slash');
    assert.deepStrictEqual([k.attribute['aria-pressed'], k.attribute['aria-label']], ['true', 'Kennwort verbergen']);
    k.click();
    assert.strictEqual(i.type, 'password');
    assert.strictEqual(k.children[0].className, 'fa-solid fa-eye');
});
pruefe('in einer vorhandenen Gruppe: kein zweiter Rahmen, das Auge vor dem Knopf dahinter', () => {
    const i = feld();
    const kopieren = new Element('button');
    const gruppe = in_(Object.assign(new Element('div'), { className: 'input-group' }), i, kopieren);
    ausstatten(i, doc);
    assert.strictEqual(i.parentNode, gruppe);
    assert.deepStrictEqual(gruppe.children.map(k => k === kopieren ? 'KOPIEREN' : k.tagName), ['INPUT', 'BUTTON', 'KOPIEREN']);
});
pruefe('ein kleines Feld bekommt eine kleine Gruppe, ein gesperrtes einen gesperrten Knopf', () => {
    const i = feld('password', 'form-control form-control-sm');
    i.disabled = true;
    in_(new Element('td'), i);
    ausstatten(i, doc);
    assert.strictEqual(i.parentNode.className, 'input-group input-group-sm');
    assert.strictEqual(knopfVon(i).disabled, true);
});
pruefe('ein Feld im eigenen Stil (Server-Panel) bekommt das Auge ins Feld, keine Tabler-Gruppe', () => {
    const i = feld('password', 'fb-feld');
    const zelle = in_(new Element('div'), i);
    ausstatten(i, doc);
    const huelle = i.parentNode;
    assert.strictEqual(huelle.parentNode, zelle);
    assert.strictEqual(huelle.className, '', 'eine Tabler-Gruppe um ein fb-feld');
    assert.deepStrictEqual([huelle.style.position, huelle.style.display], ['relative', 'block']);
    assert.strictEqual(i.style.paddingRight, '34px', 'der Text liefe unter das Auge');
    assert.ok(huelle.hasAttribute('data-kennwort-huelle'));
    const k = knopfVon(i);
    assert.match(k.style.cssText, /position:absolute;right:4px/);
    assert.strictEqual(k.className, '');
    k.click();
    assert.strictEqual(i.type, 'text');
});
pruefe('nie zweimal, auch nicht nach dem Umschalten', () => {
    const i = feld();
    in_(new Element('div'), i);
    ausstatten(i, doc);
    knopfVon(i).click();
    knopfVon(i).click();
    assert.strictEqual(ausstatten(i, doc), false);
    assert.strictEqual(i.parentNode.children.filter(k => k.tagName === 'BUTTON').length, 1);
});
pruefe('Textfelder und form-floating bleiben, wie sie sind', () => {
    const t = feld('text');
    in_(new Element('div'), t);
    assert.strictEqual(ausstatten(t, doc), false);
    const f = feld();
    in_(Object.assign(new Element('div'), { className: 'form-floating' }), f);
    assert.strictEqual(ausstatten(f, doc), false);
});
pruefe('durchsuche findet Felder tief im eingefügten Baum', () => {
    const a = feld();
    const b = feld();
    const baum = in_(new Element('form'), in_(new Element('div'), a), in_(new Element('div'), in_(new Element('div'), b)), feld('text'));
    durchsuche(baum, doc);
    assert.ok(knopfVon(a) && knopfVon(b));
});

pruefe('nur eine selbst angelegte Hülle trägt die Marke, eine vorhandene Gruppe nicht', () => {
    const a = feld();
    in_(new Element('div'), a);
    ausstatten(a, doc);
    assert.ok(a.parentNode.hasAttribute('data-kennwort-huelle'));
    const b = feld();
    const gruppe = in_(Object.assign(new Element('div'), { className: 'input-group' }), b);
    ausstatten(b, doc);
    assert.ok(!gruppe.hasAttribute('data-kennwort-huelle'));
});
pruefe('textregel.js findet seine Meldung auch über die Hülle hinweg', () => {
    // Die Meldung steht neben dem Feld. Steckt das Feld in der Hülle, stünde sie
    // sonst nicht mehr im Elternteil, und ein Regelverstoß bliebe still.
    // Gefahren wird die echte Datei, geladen wie in check-textregel.js.
    const fenster = {};
    require('vm').runInNewContext(
        fs.readFileSync(path.join(WURZEL, 'plugins/gameserver/dashboard/assets/js/textregel.js'), 'utf8'),
        { window: fenster, globalThis: fenster, JSON });
    const meldung = Object.assign(new Element('div'), { hidden: true, textContent: '' });
    meldung.setAttribute('data-fb-regel-meldung', '');
    const i = feld('password', 'fb-feld');
    i.value = 'kurz';
    i.getAttribute = (k) => i.attribute[k] ?? null;
    i.setAttribute('data-fb-regel', JSON.stringify({ mindestens: 8, muster: null, hinweis: '', beschrieben: false }));
    i.setCustomValidity = () => {};
    const zelle = in_(new Element('div'), i, meldung);
    ausstatten(i, doc);
    assert.notStrictEqual(i.parentNode, zelle, 'das Feld steckt nicht in einer Hülle, die Probe mässe nichts');
    for (const e of [zelle, i.parentNode]) {
        e.querySelector = (sel) => sel === '[data-fb-regel-meldung]'
            ? (e.children.find(k => k.hasAttribute('data-fb-regel-meldung')) || null) : null;
    }
    const fehler = fenster.fbTextregel.pruefe(i);
    assert.ok(fehler, 'die Regel schlug nicht an');
    assert.strictEqual(meldung.hidden, false, 'die Meldung blieb verborgen');
    assert.strictEqual(meldung.textContent, fehler);
});

console.log('\nEingebunden');
pruefe('im Guild-Bereich eingereiht, also auch unter /admin', () => {
    const theme = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'apps/dashboard/themes/default/theme.js'), 'utf8'));
    assert.match(theme, /registerScript\('kennwort-auge', 'kennwort-auge\.js'/);
    const guild = theme.slice(theme.indexOf("am.enqueueStyle('fonts-guild')"));
    assert.match(guild, /am\.enqueueScript\('kennwort-auge'\)/);
});
pruefe('im Browser beobachtet es auch später eingefügte und umgestellte Felder', () => {
    const js = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'apps/dashboard/themes/default/assets/js/kennwort-auge.js'), 'utf8'));
    assert.match(js, /MutationObserver/);
    assert.match(js, /attributeFilter: \['type'\]/);
});

console.log(fehler ? `\n✗ ${fehler} Prüfung(en) rot` : '\n✅ Jedes Kennwortfeld hat sein Auge');
process.exit(fehler ? 1 : 0);
