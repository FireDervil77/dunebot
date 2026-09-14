#!/usr/bin/env node
/**
 * Was würde beim nächsten Start passieren? — Probelauf ohne Wirkung.
 *
 * ── Warum es diesen Probelauf gibt ──────────────────────────────────────────
 *
 * `BasePluginManager` prüft beim Start die Abhängigkeiten zwischen Plugins. Er
 * **meldet einen Fund nicht, er handelt**: Ist die Abhängigkeit eines Plugins
 * abgeschaltet, entfernt er das Plugin aus `ENABLED_PLUGINS` und **schreibt die
 * neue Liste in die Tabelle `configs`**. Dauerhaft. Es bleibt aus, bis es
 * jemand von Hand wieder einschaltet.
 *
 * Der Betreiber am 2026-09-14: *„Wir bauen allerdings auf Production, und da
 * kann ich mir aktuell — zumindest bei den Gameservern — kein Reinstall des
 * ganzen Pakets erlauben, weil der Streamserver darüber läuft."*
 *
 * Deshalb rechnet dieses Skript dieselbe Prüfung **vorher** und zeigt, was
 * geschähe. Es öffnet die Datenbank nur lesend, startet nichts neu und ändert
 * nichts. Einzelheiten und die geplante Reihenfolge: `docs/plugin-beziehungen.md`.
 *
 * ── Drei Teile ──────────────────────────────────────────────────────────────
 *
 *   A  Wirkungsprobe     Was würde der Manager heute tun?
 *   B  Bestandsaufnahme  Welche Beziehungen gibt es WIRKLICH — erklärt oder nicht?
 *   C  Verankerung       Gilt noch, was dieser Probelauf über den Manager annimmt?
 *
 * Teil C ist der wichtigste: Ein Probelauf, der eine veraltete Annahme
 * nachrechnet, ist schlimmer als keiner.
 *
 *   node scripts/check-plugin-beziehungen.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const WURZEL = path.join(__dirname, '..');
const PLUGIN_DIR = path.join(WURZEL, 'plugins');
const MANAGER = path.join(WURZEL, 'packages/dunebot-core/lib/BasePluginManager.js');

let fehler = 0;
const melde = (ok, was, zusatz = '') => {
    console.log(`  ${ok ? '✅' : '❌'} ${was}${zusatz ? '\n       ' + zusatz : ''}`);
    if (!ok) fehler++;
};
const hinweis = (text) => console.log(`  · ${text}`);

/** Kommentare weg, bevor irgendetwas gemessen wird — sonst misst man Prosa. */
function ohneKommentare(quelle) {
    return String(quelle)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n').map(z => z.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');
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
            // Genau die Felder, die der Manager liest (BasePluginManager:516).
            abhaengig: pkg.pluginDependencies || [],
            faehigkeiten: pkg.faehigkeiten || null,
        });
    }
    return plugins;
}

/** Die eingeschalteten Plugins — nur lesend, und ohne Datenbank kein Ratespiel. */
async function leseEingeschaltet() {
    require('dotenv').config({ path: path.join(WURZEL, 'apps/dashboard/.env') });
    if (!process.env.MYSQL_USER) return { fehlt: 'keine Zugangsdaten in apps/dashboard/.env' };

    let mysql;
    try { mysql = require('mysql2/promise'); }
    catch { return { fehlt: 'mysql2 nicht verfügbar' }; }

    let verbindung;
    try {
        verbindung = await mysql.createConnection({
            host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT) || 3306,
            user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
            database: process.env.MYSQL_DATABASE, connectTimeout: 5000,
        });
        // Was der Manager liest (BasePluginManager:123) …
        const [zeilen] = await verbindung.query(
            `SELECT config_value FROM configs
              WHERE plugin_name = 'core' AND config_key = 'ENABLED_PLUGINS' AND context = 'shared'
              LIMIT 1`);
        // … und was das Dashboard TATSÄCHLICH einschaltet (app.js:316 ff.).
        // Die beiden sind seit dem Umbau auf `guild_plugins` nicht dasselbe —
        // und genau diese Lücke ist die Falle.
        const [ausGuilds] = await verbindung.query(
            `SELECT DISTINCT plugin_name FROM guild_plugins
              WHERE is_enabled = 1 AND plugin_name != 'core'`);
        const wirklich = ausGuilds.map(z => z.plugin_name).sort();

        if (!zeilen.length) return { fehlt: 'kein Eintrag ENABLED_PLUGINS in `configs`', wirklich };
        const wert = zeilen[0].config_value;
        return { liste: typeof wert === 'string' ? JSON.parse(wert) : wert, wirklich };
    } catch (e) {
        return { fehlt: e.message };
    } finally {
        if (verbindung) await verbindung.end().catch(() => {});
    }
}

// ════════════════════════════════════════════════════════════════════════════
// A — Wirkungsprobe: dieselbe Rechnung wie der Manager, ohne zu handeln
// ════════════════════════════════════════════════════════════════════════════

function wirkungsprobe(plugins, eingeschaltet) {
    const namen = new Set(plugins.map(p => p.name));
    const uebersprungen = [];
    const abgeschaltet = [];

    for (const p of plugins) {
        // Regel 1 (BasePluginManager:144): Abhängigkeit gar nicht vorhanden.
        const fehlend = p.abhaengig.filter(d => !namen.has(d));
        if (fehlend.length) { uebersprungen.push({ p, fehlend }); continue; }

        // Regel 2 (:160): Abhängigkeit vorhanden, aber nicht eingeschaltet.
        // `core` ist ausgenommen — es ist immer da.
        if (!eingeschaltet) continue;
        const aus = p.abhaengig.filter(d => d !== 'core' && !eingeschaltet.includes(d));
        if (aus.length) abgeschaltet.push({ p, aus });
    }

    // Regel 3: Ringe. Der Manager bricht darauf ab; hier wird nur gezeigt.
    const ringe = findeRinge(plugins);
    return { uebersprungen, abgeschaltet, ringe };
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
// C — Verankerung: gilt noch, was hier über den Manager angenommen wird?
// ════════════════════════════════════════════════════════════════════════════

function verankerung() {
    if (!fs.existsSync(MANAGER)) {
        melde(false, 'Der PluginManager liegt, wo dieser Probelauf ihn erwartet',
            path.relative(WURZEL, MANAGER) + ' fehlt — die Rechnung unten ist dann Vermutung');
        return;
    }
    const quelle = ohneKommentare(fs.readFileSync(MANAGER, 'utf8'));

    melde(/pluginDependencies/.test(quelle),
        'Der Manager liest weiterhin `pluginDependencies`',
        'sonst rechnet dieser Probelauf mit einem Feld, das niemand mehr liest');
    melde(/ENABLED_PLUGINS/.test(quelle) && /INSERT INTO configs/.test(quelle),
        'Das Abschalten schreibt weiterhin in `configs` — das ist der gefährliche Teil',
        'verschwindet der Schreibvorgang, ist die Warnung unten überholt');
    melde(/dependencies \|\| \[\]\)\.filter/.test(quelle),
        'Die beiden Regeln (fehlend / abgeschaltet) stehen unverändert im Manager');
}

// ════════════════════════════════════════════════════════════════════════════

(async () => {
    console.log('\n▸ Probelauf: Beziehungen zwischen Plugins (es wird NICHTS geändert)');

    const plugins = lesePlugins();
    console.log(`\nC — Verankerung (${path.relative(WURZEL, MANAGER)})`);
    verankerung();

    console.log(`\nA — Wirkungsprobe (${plugins.length} Plugins)`);
    const erklaert = plugins.filter(p => p.abhaengig.length);
    if (!erklaert.length) {
        hinweis(`Kein einziges Plugin erklärt eine Abhängigkeit (\`pluginDependencies\`).`);
        hinweis('Der Manager hat heute also nichts zu prüfen — und damit auch nichts,');
        hinweis('was er abschalten könnte. Das ist der Grund, warum dieser Schritt');
        hinweis('gefahrlos ist: Es gibt noch nichts, das wirken könnte.');
    } else {
        hinweis('Erklärt: ' + erklaert.map(p => `${p.name} → ${p.abhaengig.join(', ')}`).join(' · '));
    }

    const ein = await leseEingeschaltet();
    if (ein.wirklich) hinweis(`Wirklich eingeschaltet laut \`guild_plugins\` (${ein.wirklich.length}): ${ein.wirklich.join(', ')}`);

    if (ein.fehlt) {
        // ── Das ist der Fund, nicht nur eine Lücke ──────────────────────────
        //
        // Der Manager misst Regel 2 gegen `configs.ENABLED_PLUGINS`. Diese Zeile
        // gibt es hier nicht — das Dashboard schaltet seit dem Umbau ueber
        // `guild_plugins` ein (app.js:384: „ENABLED_PLUGINS wird nicht mehr aus
        // configs geladen!"). Die Liste ist damit LEER, und gegen eine leere
        // Liste ist jede Abhaengigkeit „nicht eingeschaltet".
        melde(false, 'Die Liste, gegen die Regel 2 misst, ist gefüllt',
            `${ein.fehlt}.\n`
            + '       Sie ist damit LEER — und gegen eine leere Liste gilt JEDE Abhängigkeit als\n'
            + '       abgeschaltet. Die erste harte Deklaration würde ihr eigenes Plugin abschalten\n'
            + '       und in `configs` schreiben. Eingeschaltet wird heute über `guild_plugins`\n'
            + '       (apps/dashboard/app.js:316 ff.), gemessen wird gegen `configs` — das ist die Falle.\n'
            + '       ⇒ Vor JEDER harten Deklaration gehört diese Quelle geradegezogen.');
    } else {
        hinweis(`Gemessen wird gegen \`configs.ENABLED_PLUGINS\` (${ein.liste.length}): ${ein.liste.join(', ')}`);
    }

    const probe = wirkungsprobe(plugins, ein.liste || null);
    melde(probe.uebersprungen.length === 0,
        'Kein Plugin würde beim nächsten Start ÜBERSPRUNGEN',
        probe.uebersprungen.map(u => `${u.p.name}: ${u.fehlend.join(', ')} fehlt`).join('\n       '));
    melde(probe.abgeschaltet.length === 0,
        'Kein Plugin würde ABGESCHALTET und in `configs` geschrieben',
        probe.abgeschaltet.map(a => `${a.p.name}: ${a.aus.join(', ')} ist aus`).join('\n       '));
    melde(probe.ringe.length === 0, 'Keine Ringe in den erklärten Abhängigkeiten',
        probe.ringe.join('\n       '));

    // ── Was-wäre-wenn ───────────────────────────────────────────────────────
    //
    //   node scripts/check-plugin-beziehungen.js --wenn gameserver=masterserver
    //
    // Rechnet dieselben Regeln mit einer Deklaration, die es noch NICHT gibt.
    // Damit lässt sich eine geplante Zeile prüfen, bevor sie jemand schreibt.
    const wennArg = process.argv.find(a => a.startsWith('--wenn='))
        || (process.argv.includes('--wenn') ? process.argv[process.argv.indexOf('--wenn') + 1] : null);
    if (wennArg) {
        const roh = wennArg.replace(/^--wenn=/, '');
        const [wer, was] = roh.split('=');
        const ziel = plugins.find(p => p.name === wer);
        console.log(`\nA' — Was wäre, wenn \`${wer}\` von \`${was}\` abhinge?`);
        if (!ziel) {
            melde(false, `Das Plugin \`${wer}\` gibt es`, 'Name aus der package.json, nicht der Ordnername');
        } else {
            const angenommen = plugins.map(p => p === ziel
                ? { ...p, abhaengig: [...p.abhaengig, ...String(was).split(',')] } : p);
            const wenn = wirkungsprobe(angenommen, ein.liste || []);
            const trifft = [...wenn.uebersprungen, ...wenn.abgeschaltet].some(x => x.p.name === wer);
            melde(!trifft, `\`${wer}\` bliebe eingeschaltet`,
                trifft
                    ? `Es würde ${wenn.uebersprungen.some(x => x.p.name === wer) ? 'ÜBERSPRUNGEN' : 'ABGESCHALTET und in `configs` geschrieben'}.\n`
                      + '       Genau das ist der Schritt, der auf einer laufenden Anlage nicht passieren darf.'
                    : '');
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
        ? '\n✅ Nichts würde beim nächsten Start abgeschaltet.\n'
        : `\n❌ ${fehler} Punkt(e) zum Ansehen — nichts wurde geändert.\n`);
    process.exit(fehler === 0 ? 0 : 1);
})();
