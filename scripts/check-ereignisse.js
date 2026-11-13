#!/usr/bin/env node
/**
 * Fachereignisse, G-01 (2026-11-13): Liste, Erklärungen und Code stimmen überein.
 *
 * Die Liste `packages/dunebot-sdk/ereignisse/liste.json` ist geschlossen. Was
 * nicht darin steht, darf niemand melden oder hören. Geprüft wird:
 *
 *   - Jeder Eintrag ist vollständig: Name beginnt mit dem Absender, Version,
 *     Stand, Schwere, Feldarten aus der Liste.
 *   - Die Schutzklasse folgt aus Akteur, Betroffenem und Feldern
 *     (`schutzAus` im SDK). Eine falsch niedrige Klasse ist ein Fehler.
 *   - Jedes Plugin erklärt in `package.json` genau die Namen, die es laut Liste
 *     sendet. Der Absender `kern` erklärt sich in `plugins/core/package.json`.
 *   - Personenbezogenes und Inhalte hört nur, wer in `hoerer` des Eintrags
 *     steht, und umgekehrt hört jeder dort Genannte es auch. Zwei Stellen
 *     müssen also zustimmen, ein `*` allein reicht nicht.
 *   - Im Code zählt nur `Ereignisse.melde('name', …)` und
 *     `Ereignisse.hoere('name', …)`, mit dem Namen als Zeichenkette. Andere
 *     Schreibweisen (Variable, Zerlegen, Weiterreichen) sind ein Fehler, sonst
 *     sähe der Wächter sie nicht.
 *   - `stand: aktiv` heißt: Der Absender meldet es im Code. `geplant` heißt:
 *     Niemand meldet es. Bis G-02 gibt es `melde` nicht, also ist alles geplant.
 *
 * Danach Gegenproben im Speicher: Jede eingebaute Verletzung muss rot werden,
 * der richtige Fall (aktiv mit Aufruf) grün. Nichts wird geschrieben.
 *
 * Nicht geprüft: ob ein erklärtes Hören einen Aufruf hat. Ein Plugin erklärt,
 * was es in seinen Stufen hören wird (Leveling hört `ticket.geschlossen` erst ab
 * L4). Ob ein Abnehmer verdrahtet ist, sieht der Zusteller aus G-02 zur Laufzeit.
 *
 *   node scripts/check-ereignisse.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { ohneKommentare } = require('./lib/quelltext');
const Ereignisse = require('../packages/dunebot-sdk/ereignisse');

const WURZEL = path.join(__dirname, '..');
const PLUGINS = path.join(WURZEL, 'plugins');
const NAME = /^[a-z]+(\.[a-z_]+)+$/;
const FELDNAME = /^[a-z_]+$/;
const AKTEURE = ['mitglied', 'system', 'beides'];
const STAENDE = ['geplant', 'aktiv'];

const pluginVon = (von) => (von === 'kern' ? Ereignisse.KERN_PLUGIN : von);
const kopie = (x) => JSON.parse(JSON.stringify(x));

// ── Lesen ────────────────────────────────────────────────────────────────────
function lesePakete() {
    const pakete = new Map();
    for (const e of fs.readdirSync(PLUGINS, { withFileTypes: true })) {
        if (!e.isDirectory() || e.name.startsWith('.')) continue;
        const datei = path.join(PLUGINS, e.name, 'package.json');
        if (!fs.existsSync(datei)) continue;
        const pkg = JSON.parse(fs.readFileSync(datei, 'utf8'));
        pakete.set(e.name, { name: pkg.name, ereignisse: pkg.ereignisse });
    }
    return pakete;
}

function dateien(ordner, aus = []) {
    for (const e of fs.readdirSync(ordner, { withFileTypes: true })) {
        if (['node_modules', 'assets', 'vendor', 'public'].includes(e.name) || e.name.startsWith('.')) continue;
        const voll = path.join(ordner, e.name);
        if (e.isDirectory()) dateien(voll, aus);
        else if (e.name.endsWith('.js')) aus.push(voll);
    }
    return aus;
}

/** Wem gehört die Datei: `plugins/<name>/…` dem Plugin, alles andere dem Kern. */
function besitzer(relativ) {
    const teile = relativ.split(path.sep);
    return teile[0] === 'plugins' ? teile[1] : Ereignisse.KERN_PLUGIN;
}

const quelle = (relativ, roh) => ({ datei: relativ, plugin: besitzer(relativ), text: ohneKommentare(roh) });

function leseQuellen() {
    return ['apps', 'packages', 'plugins']
        .flatMap(o => dateien(path.join(WURZEL, o)))
        .map(d => quelle(path.relative(WURZEL, d), fs.readFileSync(d, 'utf8')));
}

// ── Aufrufe im Code ──────────────────────────────────────────────────────────
const RE_AUFRUF = /\bEreignisse\s*\.\s*(melde|hoere)\s*\(\s*(['"])([^'"\n]*)\2/g;
const RE_JEDER = /\bEreignisse\s*\.\s*(melde|hoere)\s*\(/g;
const RE_OHNE_KLAMMER = /\bEreignisse\s*\.\s*(melde|hoere)\b(?!\s*\()/g;
const RE_ZERLEGT = /\{[^{}]*\b(melde|hoere)\b[^{}]*\}\s*=\s*[^;\n]*\bEreignisse\b/g;

function aufrufe(quellen) {
    const treffer = [];
    const fehler = [];
    for (const q of quellen) {
        const gefunden = [...q.text.matchAll(RE_AUFRUF)];
        for (const m of gefunden) treffer.push({ art: m[1], name: m[3], datei: q.datei, plugin: q.plugin });
        const alle = [...q.text.matchAll(RE_JEDER)].length;
        if (alle > gefunden.length) fehler.push(`${q.datei}: ${alle - gefunden.length} Aufruf(e) ohne Namen als Zeichenkette`);
        for (const m of q.text.matchAll(RE_OHNE_KLAMMER)) fehler.push(`${q.datei}: \`Ereignisse.${m[1]}\` wird weitergereicht statt gerufen`);
        for (const m of q.text.matchAll(RE_ZERLEGT)) fehler.push(`${q.datei}: \`${m[1]}\` aus Ereignisse herausgelöst`);
    }
    return { treffer, fehler };
}

// ── Prüfen ───────────────────────────────────────────────────────────────────
/**
 * @returns {Object<string, string[]>} Fehler je Abschnitt
 */
function pruefeVertrag({ liste, pakete, quellen }) {
    const f = { liste: [], erklaerung: [], schutz: [], code: [] };
    const eintraege = liste.ereignisse;
    const nachName = new Map(eintraege.map(e => [e.name, e]));
    const erklaert = (p) => pakete.get(p)?.ereignisse || { sendet: [], hoert: [] };

    // Liste
    if (nachName.size !== eintraege.length) f.liste.push('ein Name steht doppelt');
    for (const e of eintraege) {
        const w = (t) => f.liste.push(`${e.name}: ${t}`);
        if (!NAME.test(e.name)) w('Name nicht in der Form `absender.ding.handlung`');
        if (e.name.split('.')[0] !== e.von) w(`beginnt nicht mit dem Absender ${e.von}`);
        if (!pakete.has(pluginVon(e.von))) w(`Absender ${e.von}: kein Plugin ${pluginVon(e.von)} mit package.json`);
        if (!Number.isInteger(e.version) || e.version < 1) w(`Version ${e.version}`);
        if (!STAENDE.includes(e.stand)) w(`Stand ${e.stand}`);
        if (!liste.schweren[e.schwere]) w(`Schwere ${e.schwere}`);
        if (!liste.schutzklassen[e.schutz]) w(`Schutzklasse ${e.schutz}`);
        if (!AKTEURE.includes(e.akteur)) w(`Akteur ${e.akteur}`);
        if (!(e.betroffen === null || e.betroffen === 'mitglied')) w(`Betroffen ${e.betroffen}`);
        if (!e.text || typeof e.text !== 'string') w('ohne Text');
        if (!e.felder || typeof e.felder !== 'object' || Array.isArray(e.felder)) w('Felder fehlen');
        for (const [feld, art] of Object.entries(e.felder || {})) {
            if (!FELDNAME.test(feld)) w(`Feldname ${feld}`);
            if (!liste.feldarten[Ereignisse.feldart(art)]) w(`Feld ${feld}: Art ${art}`);
        }
    }

    // Erklärungen
    for (const [plugin, pkg] of pakete) {
        if (pkg.name !== plugin) f.erklaerung.push(`plugins/${plugin}: package.json heißt ${pkg.name}`);
        const erk = pkg.ereignisse;
        if (erk === undefined) continue;
        if (!Array.isArray(erk.sendet) || !Array.isArray(erk.hoert)) { f.erklaerung.push(`${plugin}: \`ereignisse\` braucht \`sendet\` und \`hoert\` als Listen`); continue; }
        for (const [art, namen] of [['sendet', erk.sendet], ['hoert', erk.hoert]]) {
            if (new Set(namen).size !== namen.length) f.erklaerung.push(`${plugin}: ${art} nennt einen Namen doppelt`);
        }
    }
    for (const plugin of pakete.keys()) {
        const soll = eintraege.filter(e => pluginVon(e.von) === plugin).map(e => e.name).sort();
        const ist = [...(erklaert(plugin).sendet || [])].sort();
        for (const n of ist.filter(x => !soll.includes(x))) f.erklaerung.push(`${plugin} sendet ${n}, laut Liste nicht`);
        for (const n of soll.filter(x => !ist.includes(x))) f.erklaerung.push(`${plugin} sendet ${n} laut Liste, erklärt es nicht`);
        for (const m of erklaert(plugin).hoert || []) {
            const gueltig = m === '*' || NAME.test(m) || NAME.test(m.slice(0, -2) + '.x');
            if (!gueltig) f.erklaerung.push(`${plugin} hört ${m}: kein Name und kein Muster`);
            else if (!eintraege.some(e => Ereignisse.passt(m, e.name))) f.erklaerung.push(`${plugin} hört ${m}: steht nicht in der Liste`);
        }
    }

    // Schutz
    for (const e of eintraege) {
        const soll = Ereignisse.schutzAus(e);
        if (e.schutz !== soll) f.schutz.push(`${e.name}: Schutzklasse ${e.schutz}, aus Akteur und Feldern folgt ${soll}`);
        if (e.schutz === 'allgemein') {
            if (e.hoerer !== undefined) f.schutz.push(`${e.name}: allgemein, braucht kein \`hoerer\``);
            continue;
        }
        if (!Array.isArray(e.hoerer)) { f.schutz.push(`${e.name}: ${e.schutz} ohne \`hoerer\``); continue; }
        if (new Set(e.hoerer).size !== e.hoerer.length) f.schutz.push(`${e.name}: ein Hörer steht doppelt`);
        for (const h of e.hoerer) {
            if (!pakete.has(h)) f.schutz.push(`${e.name}: Hörer ${h} ist kein Plugin`);
            else if (!(erklaert(h).hoert || []).some(m => Ereignisse.passt(m, e.name))) f.schutz.push(`${e.name}: ${h} steht in \`hoerer\`, erklärt das Hören aber nicht`);
        }
    }
    for (const plugin of pakete.keys()) {
        for (const e of eintraege) {
            if (e.schutz === 'allgemein' || (e.hoerer || []).includes(plugin)) continue;
            if ((erklaert(plugin).hoert || []).some(m => Ereignisse.passt(m, e.name))) {
                f.schutz.push(`${plugin} hört ${e.name} (${e.schutz}), steht dort aber nicht in \`hoerer\``);
            }
        }
    }

    // Code
    const { treffer, fehler } = aufrufe(quellen);
    f.code.push(...fehler);
    for (const t of treffer) {
        const erk = erklaert(t.plugin);
        if (t.art === 'melde') {
            const e = nachName.get(t.name);
            if (!e) f.code.push(`${t.datei}: meldet ${t.name}, steht nicht in der Liste`);
            else if (pluginVon(e.von) !== t.plugin) f.code.push(`${t.datei}: meldet ${t.name}, das gehört ${e.von}`);
            else if (!(erk.sendet || []).includes(t.name)) f.code.push(`${t.datei}: meldet ${t.name}, ${t.plugin} erklärt es nicht`);
            else if (e.stand !== 'aktiv') f.code.push(`${t.datei}: meldet ${t.name}, das steht auf ${e.stand}`);
        } else if (!(erk.hoert || []).some(m => m === t.name || (NAME.test(t.name) && Ereignisse.passt(m, t.name)))) {
            f.code.push(`${t.datei}: hört ${t.name}, ${t.plugin} erklärt es nicht`);
        }
    }
    const gemeldet = new Set(treffer.filter(t => t.art === 'melde').map(t => t.name));
    for (const e of eintraege.filter(x => x.stand === 'aktiv' && !gemeldet.has(x.name))) {
        f.code.push(`${e.name}: steht auf aktiv, niemand meldet es`);
    }
    return { fehler: f, treffer };
}

// ── Lauf ─────────────────────────────────────────────────────────────────────
let rot = 0;
function zeile(was, liste) {
    if (!liste.length) { console.log(`  ✓ ${was}`); return; }
    rot++;
    console.log(`  ✗ ${was}\n      ${liste.join('\n      ')}`);
}

const echt = { liste: Ereignisse.liste, pakete: lesePakete(), quellen: leseQuellen() };
const { fehler, treffer } = pruefeVertrag(echt);
const eintraege = echt.liste.ereignisse;
const aktiv = eintraege.filter(e => e.stand === 'aktiv').length;
const erklaerend = [...echt.pakete.values()].filter(p => p.ereignisse).length;

console.log('Liste');
zeile(`${eintraege.length} Einträge (${aktiv} aktiv, ${eintraege.length - aktiv} geplant), jeder vollständig`, fehler.liste);
console.log('\nErklärungen');
zeile(`${erklaerend} von ${echt.pakete.size} Plugins erklären sich, sendet stimmt mit der Liste`, fehler.erklaerung);
console.log('\nSchutz');
zeile('Schutzklassen folgen aus den Feldern, Personenbezogenes hört nur, wer in `hoerer` steht', fehler.schutz);
console.log('\nCode');
zeile(`${echt.quellen.length} Dateien, ${treffer.length} Aufrufe, alle erklärt`, fehler.code);

// ── Gegenproben ──────────────────────────────────────────────────────────────
console.log('\nGegenproben');
const alleFehler = (r) => Object.values(r.fehler).flat();
function mit(aendern, zusatz = []) {
    const d = { liste: kopie(echt.liste), pakete: new Map([...echt.pakete].map(([k, v]) => [k, kopie(v)])), quellen: [...echt.quellen, ...zusatz] };
    aendern(d);
    return alleFehler(pruefeVertrag(d));
}
const eintrag = (d, name) => d.liste.ereignisse.find(e => e.name === name);
const erk = (d, p) => d.pakete.get(p).ereignisse;
const rotProbe = (was, fehlerliste, enthaelt) => {
    try {
        assert.ok(fehlerliste.some(t => t.includes(enthaelt)), `blieb grün oder meldete anderes: ${fehlerliste.join(' | ') || '—'}`);
        console.log(`  ✓ rot: ${was}`);
    } catch (e) { rot++; console.log(`  ✗ ${was}\n      ${e.message}`); }
};
const gruenProbe = (was, fehlerliste) => {
    if (!fehlerliste.length) console.log(`  ✓ grün: ${was}`);
    else { rot++; console.log(`  ✗ ${was} müsste grün sein\n      ${fehlerliste.join('\n      ')}`); }
};

rotProbe('erfundener Name im Aufruf', mit(() => {}, [quelle('plugins/ticket/x.js', "Ereignisse.melde('ticket.erfunden', {})")]), 'steht nicht in der Liste');
rotProbe('erfundener Name in der Erklärung', mit(d => erk(d, 'leveling').hoert.push('ticket.erfunden')), 'steht nicht in der Liste');
rotProbe('Meldung eines geplanten Ereignisses', mit(() => {}, [quelle('plugins/ticket/x.js', "Ereignisse.melde('ticket.geschlossen', {})")]), 'steht auf geplant');
rotProbe('aktiv ohne Aufruf', mit(d => { eintrag(d, 'ticket.geschlossen').stand = 'aktiv'; }), 'niemand meldet es');
gruenProbe('aktiv mit Aufruf', mit(d => { eintrag(d, 'ticket.geschlossen').stand = 'aktiv'; },
    [quelle('plugins/ticket/bot/x.js', "await Ereignisse.melde('ticket.geschlossen', { ticket: 1 })")]));
rotProbe('fremdes Ereignis melden', mit(d => { eintrag(d, 'ticket.geschlossen').stand = 'aktiv'; },
    [quelle('plugins/ticket/x.js', "Ereignisse.melde('ticket.geschlossen', {})"), quelle('plugins/giveaway/x.js', "Ereignisse.melde('ticket.geschlossen', {})")]), 'das gehört ticket');
rotProbe('Name als Variable', mit(() => {}, [quelle('plugins/ticket/x.js', 'Ereignisse.melde(name, {})')]), 'ohne Namen als Zeichenkette');
rotProbe('melde herausgelöst', mit(() => {}, [quelle('plugins/ticket/x.js', 'const { melde } = Ereignisse;')]), 'herausgelöst');
rotProbe('melde weitergereicht', mit(() => {}, [quelle('plugins/ticket/x.js', 'const m = Ereignisse.melde;')]), 'weitergereicht');
gruenProbe('Aufruf nur im Kommentar', mit(() => {}, [quelle('plugins/ticket/x.js', "// Ereignisse.melde('ticket.erfunden', {})\n/* Ereignisse.melde(x) */")]));
rotProbe('Schutzklasse zu niedrig', mit(d => { eintrag(d, 'ticket.geschlossen').schutz = 'personenbezogen'; }), 'folgt inhalt');
rotProbe('Hören ohne Freigabe in `hoerer`', mit(d => erk(d, 'clan').hoert.push('ticket.geschlossen')), 'steht dort aber nicht in `hoerer`');
rotProbe('Freigabe in `hoerer` ohne Erklärung', mit(d => eintrag(d, 'kern.mitglied.verlassen').hoerer.push('giveaway')), 'erklärt das Hören aber nicht');
rotProbe('`*` ohne Freigabe', mit(d => erk(d, 'ticket').hoert.push('*')), 'ticket hört kern.mitglied.verlassen');
rotProbe('Erklärung fehlt', mit(d => { erk(d, 'ticket').sendet = erk(d, 'ticket').sendet.filter(n => n !== 'ticket.geoeffnet'); }), 'erklärt es nicht');
rotProbe('Hören im Code ohne Erklärung', mit(() => {}, [quelle('plugins/clan/x.js', "Ereignisse.hoere('ticket.geschlossen', fn)")]), 'clan erklärt es nicht');
gruenProbe('Hören im Code mit Erklärung, auch über `*`', mit(() => {}, [
    quelle('plugins/leveling/x.js', "Ereignisse.hoere('ticket.geschlossen', fn)"),
    quelle('plugins/logging/x.js', "Ereignisse.hoere('*', fn)")]));
rotProbe('Kern meldet aus apps/', mit(() => {}, [quelle(path.join('apps', 'bot', 'x.js'), "Ereignisse.melde('kern.mitglied.verlassen', {})")]), 'steht auf geplant');
rotProbe('unbekannte Feldart', mit(d => { eintrag(d, 'ticket.geschlossen').felder.x = 'irgendwas'; }), 'Art irgendwas');

console.log(rot ? `\n❌ ${rot} Prüfung(en) fehlgeschlagen` : '\n✅ Liste, Erklärungen und Code stimmen überein, die Gegenproben schlagen an');
process.exit(rot ? 1 : 0);
