#!/usr/bin/env node
/**
 * Beziehungen zwischen Plugins — Probelauf ohne Wirkung.
 *
 * ── Stand ───────────────────────────────────────────────────────────────────
 *
 * Bis zum 2026-09-15 hatte `BasePluginManager.init()` eine zweite
 * Einschaltrunde: Sie las `ENABLED_PLUGINS` aus `configs`, prüfte
 * `pluginDependencies` und SCHRIEB bei einer abgeschalteten Abhängigkeit eine
 * gekürzte Liste zurück — Plugins wären in der Produktion ausgegangen. Die Runde
 * lief über null Plugins, weil längst über `guild_plugins` eingeschaltet wird,
 * und wäre mit der ersten `configs`-Zeile aufgewacht. Sie ist entfernt.
 *
 * Die Fassung vom 14.09. meldete hier „Es würde ABGESCHALTET". Das war ein
 * Rechenfehler dieses Skripts: Es wandte die Regel auf ALLE Plugins an, der
 * Manager nur auf die aus der (leeren) Liste. Berichtigung in
 * `docs/plugin-beziehungen.md`.
 *
 * Grundsatz des Betreibers (2026-09-15): **Beziehungen blockieren nicht.** Dieser
 * Probelauf hält fest, dass das beim Start so bleibt, und zeigt, welche
 * Beziehungen es wirklich gibt. Er ändert nichts und öffnet keine Datenbank.
 *
 * ── Drei Teile ──────────────────────────────────────────────────────────────
 *
 *   C  Verankerung       Kommt die Abschaltrunde zurück? Liest jemand ENABLED_PLUGINS?
 *   A  Erklärungen       Was steht in `pluginDependencies` — und wo wirkt es noch?
 *   B  Bestandsaufnahme  Welche Beziehungen gibt es WIRKLICH — erklärt oder nicht?
 *
 *   node scripts/check-plugin-beziehungen.js [--wenn <plugin>=<abhaengigkeit>]
 */
'use strict';

const fs = require('fs');
const path = require('path');

const WURZEL = path.join(__dirname, '..');
const PLUGIN_DIR = path.join(WURZEL, 'plugins');
const MANAGER = path.join(WURZEL, 'packages/dunebot-core/lib/BasePluginManager.js');

let fehler = 0;
const melde = (ok, was, zusatz = '') => {
    console.log(`  ${ok ? '✅' : '❌'} ${was}${!ok && zusatz ? '\n       ' + zusatz : ''}`);
    if (!ok) fehler++;
};
const hinweis = (text) => console.log(`  · ${text}`);

/**
 * Kommentare weg, bevor irgendetwas gemessen wird — sonst misst man Prosa.
 *
 * Zeilen werden an `\r?\n` getrennt: `BasePluginManager.js` hat CRLF, und `.`
 * trifft kein `\r`. Mit `split('\n')` blieb der Kommentar stehen, und dieser
 * Probelauf meldete am 2026-09-15 einen Kommentar als Leser von `ENABLED_PLUGINS`.
 */
function ohneKommentare(quelle) {
    return String(quelle)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split(/\r?\n/).map(z => z.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');
}

function dateienUnter(wurzel) {
    const treffer = [];
    const gehe = (ordner) => {
        for (const eintrag of fs.readdirSync(ordner, { withFileTypes: true })) {
            if (eintrag.name === 'node_modules' || eintrag.name === 'vendor') continue;
            const voll = path.join(ordner, eintrag.name);
            if (eintrag.isDirectory()) gehe(voll);
            else if (eintrag.name.endsWith('.js')) treffer.push(voll);
        }
    };
    gehe(wurzel);
    return treffer;
}

// ════════════════════════════════════════════════════════════════════════════
// Die Plugins und ihre Erklärungen
// ════════════════════════════════════════════════════════════════════════════

function lesePlugins() {
    const plugins = [];
    for (const name of fs.readdirSync(PLUGIN_DIR).sort()) {
        const datei = path.join(PLUGIN_DIR, name, 'package.json');
        if (!fs.existsSync(datei)) continue;
        let pkg;
        try { pkg = JSON.parse(fs.readFileSync(datei, 'utf8')); }
        catch (e) { melde(false, `${name}: package.json unlesbar`, e.message); continue; }
        plugins.push({
            ordner: name,
            name: pkg.name || name,
            // Das Feld, das der Manager noch liest (getPluginsMeta → installPlugin).
            abhaengig: pkg.pluginDependencies || [],
            faehigkeiten: pkg.faehigkeiten || null,
        });
    }
    return plugins;
}

// ════════════════════════════════════════════════════════════════════════════
// A — Erklärungen: stimmen sie, und wo wirken sie noch?
// ════════════════════════════════════════════════════════════════════════════

/**
 * Die einzige verbliebene Wirkung von `pluginDependencies` ist
 * `installPlugin`: Fehlt eine erklärte Abhängigkeit, lehnt es ab. Beim Start
 * passiert nichts mehr. Ringe haben keine Wirkung, sind aber ein Fehler in
 * den Erklärungen.
 */
function erklaerungen(plugins) {
    const namen = new Set(plugins.map(p => p.name));
    const fehlend = [];
    for (const p of plugins) {
        const f = p.abhaengig.filter(d => d !== 'core' && !namen.has(d));
        if (f.length) fehlend.push({ p, fehlend: f });
    }
    return { fehlend, ringe: findeRinge(plugins) };
}

function findeRinge(plugins) {
    const graph = new Map(plugins.map(p => [p.name, p.abhaengig.slice()]));
    const gesehen = new Set(), stapel = new Set(), ringe = [];

    const lauf = (knoten, pfad) => {
        gesehen.add(knoten); stapel.add(knoten);
        for (const nachbar of graph.get(knoten) || []) {
            if (!graph.has(nachbar)) continue;
            if (stapel.has(nachbar)) { ringe.push([...pfad, nachbar].join(' → ')); continue; }
            if (!gesehen.has(nachbar)) lauf(nachbar, [...pfad, nachbar]);
        }
        stapel.delete(knoten);
    };
    for (const p of plugins) if (!gesehen.has(p.name)) lauf(p.name, [p.name]);
    return ringe;
}

// ════════════════════════════════════════════════════════════════════════════
// B — Bestandsaufnahme: welche Beziehungen gibt es wirklich?
// ════════════════════════════════════════════════════════════════════════════

/**
 * Harte Griffe über Plugin-Grenzen.
 *
 * Gesucht wird ein `require`, dessen Pfad in einen ANDEREN Plugin-Ordner zeigt.
 * `apps/` und `packages/` zählen nicht: Kern und SDK sind für alle da, das ist
 * der vorgesehene Weg.
 */
function harteGriffe(plugins) {
    const ordner = new Set(plugins.map(p => p.ordner));
    const funde = [];
    const muster = /require\(\s*['"]([^'"]+)['"]\s*\)/g;

    for (const p of plugins) {
        for (const datei of dateienUnter(path.join(PLUGIN_DIR, p.ordner))) {
            const quelle = ohneKommentare(fs.readFileSync(datei, 'utf8'));
            let m;
            while ((m = muster.exec(quelle))) {
                const ziel = m[1];
                if (!ziel.startsWith('.')) continue;
                const aufgeloest = path.resolve(path.dirname(datei), ziel);
                if (!aufgeloest.startsWith(PLUGIN_DIR + path.sep)) continue;
                const fremd = aufgeloest.slice(PLUGIN_DIR.length + 1).split(path.sep)[0];
                if (fremd === p.ordner || !ordner.has(fremd)) continue;
                funde.push({ von: p.ordner, nach: fremd,
                    wo: path.relative(WURZEL, datei) + ':' + (quelle.slice(0, m.index).split('\n').length) });
            }
        }
    }
    return funde;
}

/**
 * Weiche Beziehungen über die Registrierungsstellen des SDK.
 *
 * Wer `.register(` ruft, BIETET an; wer die Stelle sonst anfasst, NUTZT sie.
 * Die Namen der Stellen stehen hier ausgeschrieben statt aus dem SDK gelesen:
 * Kommt eine neue dazu, soll dieser Probelauf sie NICHT stillschweigend
 * mitzählen, sondern hier ergänzt werden.
 */
const STELLEN = ['LosquellenRegistry', 'MusikablageRegistry', 'VerbindungsRegistry', 'WebhookRegistry'];

function weicheBeziehungen(plugins) {
    const karte = new Map(STELLEN.map(s => [s, { bietet: new Set(), nutzt: new Set() }]));

    for (const p of plugins) {
        for (const datei of dateienUnter(path.join(PLUGIN_DIR, p.ordner))) {
            const quelle = ohneKommentare(fs.readFileSync(datei, 'utf8'));
            for (const stelle of STELLEN) {
                const ruf = new RegExp(stelle + '\\.([a-zA-Z]+)\\(', 'g');
                let m;
                while ((m = ruf.exec(quelle))) {
                    // Genannt wird, WAS gerufen wird — nicht gedeutet, ob das
                    // „bieten" oder „nutzen" ist. Bei den Losquellen tun beide
                    // Plugins beides, und eine Einteilung waere dort erfunden.
                    const eintrag = karte.get(stelle);
                    const topf = /^(register|unregister|dienstSetzen|dienstEntfernen)$/.test(m[1])
                        ? eintrag.bietet : eintrag.nutzt;
                    topf.add(`${p.ordner} (${m[1]})`);
                }
            }
        }
    }
    return karte;
}

// ════════════════════════════════════════════════════════════════════════════
// C — Verankerung: bleibt es dabei, dass beim Start nichts blockiert?
// ════════════════════════════════════════════════════════════════════════════

function verankerung() {
    if (!fs.existsSync(MANAGER)) {
        melde(false, 'Der PluginManager liegt, wo dieser Probelauf ihn erwartet',
            path.relative(WURZEL, MANAGER) + ' fehlt — die Prüfungen unten sind dann Vermutung');
        return;
    }
    const quelle = ohneKommentare(fs.readFileSync(MANAGER, 'utf8'));

    melde(!/ENABLED_PLUGINS/.test(quelle),
        'Der Manager liest `ENABLED_PLUGINS` nicht mehr',
        'die Abschaltrunde ist zurück — sie misst gegen eine Liste, die es nicht gibt, und wacht mit der ersten `configs`-Zeile auf');
    melde(!/INSERT\s+INTO\s+configs/i.test(quelle),
        'Der Manager schreibt nichts nach `configs`',
        'genau dieser Schreibvorgang schaltete Plugins dauerhaft ab');
    melde(/pluginDependencies/.test(quelle),
        'Der Manager liest weiterhin `pluginDependencies`',
        'sonst prüft Teil A ein Feld, das niemand mehr liest');

    hinweis(/missingDeps/.test(quelle) && /Please install them first/.test(quelle)
        ? '`installPlugin` lehnt ab, wenn eine erklärte Abhängigkeit fehlt — die einzige verbliebene Wirkung'
        : '`installPlugin` prüft `pluginDependencies` nicht mehr');

    // Die zweite Quelle für „ist eingeschaltet" darf nicht über einen anderen
    // Leser zurückkommen. Kommentare zählen nicht — dort steht sie als Verlauf.
    const leser = [];
    for (const wurzel of ['apps', 'packages', 'plugins']) {
        for (const datei of dateienUnter(path.join(WURZEL, wurzel))) {
            if (/ENABLED_PLUGINS/.test(ohneKommentare(fs.readFileSync(datei, 'utf8')))) {
                leser.push(path.relative(WURZEL, datei));
            }
        }
    }
    melde(!leser.length, 'Kein Code in apps/, packages/, plugins/ liest `ENABLED_PLUGINS`',
        leser.join('\n       '));
}

// ════════════════════════════════════════════════════════════════════════════

console.log('\n▸ Probelauf: Beziehungen zwischen Plugins (es wird NICHTS geändert)');

const plugins = lesePlugins();
console.log(`\nC — Verankerung (${path.relative(WURZEL, MANAGER)})`);
verankerung();

console.log(`\nA — Erklärungen (${plugins.length} Plugins)`);
const erklaert = plugins.filter(p => p.abhaengig.length);
hinweis(erklaert.length
    ? 'Erklärt: ' + erklaert.map(p => `${p.name} → ${p.abhaengig.join(', ')}`).join(' · ')
    : 'Kein Plugin erklärt eine Abhängigkeit (`pluginDependencies`).');

const a = erklaerungen(plugins);
melde(a.fehlend.length === 0, 'Jede erklärte Abhängigkeit gibt es als Plugin',
    a.fehlend.map(f => `${f.p.name}: ${f.fehlend.join(', ')} fehlt`).join('\n       ')
    + '\n       Wirkung: `installPlugin` lehnt die Installation ab. Beim Start passiert nichts.');
melde(a.ringe.length === 0, 'Keine Ringe in den erklärten Abhängigkeiten', a.ringe.join('\n       '));

// ── Was-wäre-wenn ───────────────────────────────────────────────────────────
//
//   node scripts/check-plugin-beziehungen.js --wenn gameserver=masterserver
//
// Prüft eine Erklärung, die es noch NICHT gibt, bevor sie jemand schreibt.
const wennArg = process.argv.find(x => x.startsWith('--wenn='))
    || (process.argv.includes('--wenn') ? process.argv[process.argv.indexOf('--wenn') + 1] : null);
if (wennArg) {
    const [wer, was] = wennArg.replace(/^--wenn=/, '').split('=');
    const ziel = plugins.find(p => p.name === wer);
    console.log(`\nA' — Was wäre, wenn \`${wer}\` von \`${was}\` abhinge?`);
    if (!ziel) {
        melde(false, `Das Plugin \`${wer}\` gibt es`, 'Name aus der package.json, nicht der Ordnername');
    } else {
        const angenommen = plugins.map(p => p === ziel
            ? { ...p, abhaengig: [...p.abhaengig, ...String(was).split(',')] } : p);
        const w = erklaerungen(angenommen);
        const fehlt = w.fehlend.some(x => x.p.name === wer);
        const ring = w.ringe.length > a.ringe.length;
        melde(!fehlt && !ring, `\`${wer}\` → \`${was}\` wäre eine gültige Erklärung`,
            fehlt ? `\`${was}\` gibt es nicht als Plugin — \`installPlugin\` lehnte \`${wer}\` ab`
                  : `es entstünde ein Ring: ${w.ringe.join(' | ')}`);
        hinweis('Beim Start schaltet eine Erklärung nichts ab — die Runde dafür gibt es nicht mehr.');
    }
}

console.log('\nB — Bestandsaufnahme: die Beziehungen, die es wirklich gibt');

const griffe = harteGriffe(plugins);
if (!griffe.length) {
    melde(true, 'Kein Plugin greift hart in ein anderes');
} else {
    const paare = new Map();
    for (const g of griffe) {
        const schluessel = `${g.von} → ${g.nach}`;
        if (!paare.has(schluessel)) paare.set(schluessel, []);
        paare.get(schluessel).push(g.wo);
    }
    console.log(`  ⚠ ${griffe.length} harte(r) Griff(e) über Plugin-Grenzen — unerklärt:`);
    for (const [paar, orte] of paare) {
        const p = plugins.find(x => x.ordner === paar.split(' → ')[0]);
        const nach = paar.split(' → ')[1];
        const gedeckt = p && p.abhaengig.includes(nach);
        console.log(`     ${paar}  (${orte.length}×)${gedeckt ? ' — erklärt' : ' — NICHT erklärt'}`);
        for (const ort of orte.slice(0, 3)) console.log(`        ${ort}`);
        if (orte.length > 3) console.log(`        … und ${orte.length - 3} weitere`);
    }
    console.log('     Ohne das andere Plugin fliegt die Datei beim Laden.');
}

console.log('\n  Weiche Beziehungen über die Registrierungsstellen:');
for (const [stelle, e] of weicheBeziehungen(plugins)) {
    const bietet = [...e.bietet];
    const nutzt = [...e.nutzt];
    if (!bietet.length && !nutzt.length) { console.log(`     ${stelle}: niemand`); continue; }
    console.log(`     ${stelle}: bietet ${bietet.join(', ') || '—'} · nutzt ${nutzt.join(', ') || '—'}`);
}
console.log('     Diese Beziehungen laufen, sind aber nirgends erklärt —');
console.log('     der Manager weiß nichts davon (docs/plugin-beziehungen.md).');

console.log(fehler === 0
    ? '\n✅ Beim Start blockiert keine Beziehung, und die alte Liste liest niemand.\n'
    : `\n❌ ${fehler} Punkt(e) zum Ansehen — nichts wurde geändert.\n`);
process.exit(fehler === 0 ? 0 : 1);
