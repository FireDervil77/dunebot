#!/usr/bin/env node
'use strict';

/**
 * Wächter: jede Adresse in einem Inline-Skript trifft eine echte Route.
 *
 * ── Woher er kommt (2026-09-22) ──────────────────────────────────────────────
 *
 * Die Modpack-Suche auf Schritt 3 rief
 *
 *     /guild/<id>/plugins/gameserver/inhalte/modpacks/suche
 *
 * benannt nach der DATEI, in der die Routen stehen (`routes/inhalte.js`).
 * Eingehängt sind sie aber unter `/servers`:
 *
 *     this.guildRouter.use('/servers', require('./routes/inhalte'));
 *
 * Und das fällt nicht auf: `fetch` auf eine fehlende Route **wirft nicht**. Es
 * liefert eine Antwort — die Fehlerseite des Dashboards — und erst
 * `response.json()` scheitert daran, dass sie kein JSON ist. Im Panel sieht das
 * aus wie „die Suche findet nichts".
 *
 * Aufgefallen ist es nur, weil zwei Blöcke weiter oben dieselbe Adresse RICHTIG
 * steht (die Mod-Suche). Genau das prüft dieser Wächter von nun an, statt auf
 * ein gutes Auge zu hoffen.
 *
 * ── Was er prüft ─────────────────────────────────────────────────────────────
 *
 * Jeder Pfad `/guild/…/plugins/<plugin>/<rest>` aus einem Inline-Skript wird
 * gegen die Einhängepunkte des Plugins und die dort angemeldeten Routen
 * gehalten. Geprüft wird der ERSTE Abschnitt nach dem Plugin — er entscheidet,
 * welche Routendatei überhaupt gefragt wird.
 *
 * Aufruf:  node scripts/check-adressen-inline.js
 * Rückgabe: 0 = jede Adresse trifft.
 */

const fs = require('fs');
const path = require('path');
const { ohneKommentare, ohneKommentareEjs } = require('./lib/quelltext');

const WURZEL = path.join(__dirname, '..');
const PLUGINS = path.join(WURZEL, 'plugins');

let geprueft = 0, fehler = 0;
const pruefe = (ok, was, zusatz = '') => {
    geprueft++;
    if (!ok) fehler++;
    console.log(`  ${ok ? '✅' : '❌'} ${was}${!ok && zusatz ? '\n       ' + zusatz : ''}`);
};

/** Alle .ejs unterhalb eines Verzeichnisses. */
function vorlagen(verzeichnis, treffer = []) {
    if (!fs.existsSync(verzeichnis)) return treffer;
    for (const e of fs.readdirSync(verzeichnis, { withFileTypes: true })) {
        const p = path.join(verzeichnis, e.name);
        if (e.isDirectory()) vorlagen(p, treffer);
        else if (e.name.endsWith('.ejs')) treffer.push(p);
    }
    return treffer;
}

console.log('\n▸ Jede Adresse im Inline-Skript trifft eine echte Route\n');

// ── Was KEINE Route ist ─────────────────────────────────────────────────────
//
// Unter `/plugins/<name>/` liegen auch die Dateien eines Plugins — Skripte,
// Stile, Bilder. Sie werden nicht vom Router bedient, sondern von der
// Dateiauslieferung. Eine Liste mit Namen statt einer Vermutung: Was hier
// fehlt, wird geprueft, und das ist die sichere Richtung.
const KEINE_ROUTE = new Set(['js', 'css', 'img', 'images', 'assets', 'vendor', 'fonts']);

/** Der erste Abschnitt eines Pfades — `/servers/195/x` → `servers`. */
const ersterAbschnitt = (pfad) => String(pfad || '').replace(/^\//, '').split('/')[0];

for (const plugin of fs.readdirSync(PLUGINS, { withFileTypes: true })) {
    if (!plugin.isDirectory()) continue;
    const index = path.join(PLUGINS, plugin.name, 'dashboard/index.js');
    if (!fs.existsSync(index)) continue;
    // Ohne Kommentare: Ein auskommentiertes `Router.use('/alt', …)` zaehlte
    // sonst als erreichbar — und der Waechter waere zu NACHSICHTIG. Das ist die
    // gefaehrlichere Richtung: Er winkt eine Adresse durch, die ins Leere geht.
    const quelle = ohneKommentare(fs.readFileSync(index, 'utf8'));

    // ── Erreichbar ist mehr als der Einhängepunkt ───────────────────────────
    //
    // Die erste Fassung dieses Waechters verglich nur gegen die Punkte aus
    // `Router.use('/x', …)`. Damit schlug er bei 26 Adressen an, die in Ordnung
    // sind: Die meisten Plugins haengen einen Router auf `/` ein, und DESSEN
    // Pfade (`/befehle`, `/rollen`, …) sind dann genauso erreichbar.
    //
    // Ein Waechter, der Richtiges anmeckert, wird abgeschaltet. Also wird die
    // Kette zu Ende gegangen: Einhaengepunkt, und bei `/` zusaetzlich die
    // Pfade der dort eingehaengten Datei.
    const erreichbar = new Set();
    // Der Einhaengepunkt darf MEHRTEILIG sein: `use('/api/tasks', …)`. Die
    // erste Fassung liess nur einen Abschnitt zu (`[a-z0-9-]*` ohne
    // Schraegstrich) und uebersah diesen Punkt komplett — vier richtige
    // Adressen des Masterservers galten deshalb als kaputt. Gezaehlt wird der
    // erste Abschnitt, denn der entscheidet, welche Datei ueberhaupt gefragt
    // wird.
    for (const m of quelle.matchAll(/Router\.use\(\s*'(\/[a-z0-9/-]*)'\s*,\s*([^)]+)\)/gi)) {
        const punkt = ersterAbschnitt(m[1]);
        if (punkt) { erreichbar.add(punkt); continue; }

        // Auf `/` eingehaengt: die Pfade der Datei zaehlen.
        const verweis = m[2];
        // Ohne die schliessende Klammer im Ausdruck: Der Schnitt oben
        // (`[^)]+`) hat sie schon weggenommen — mit ihr fand dieser Ausdruck
        // nie etwas, und die Routen der auf `/` eingehaengten Datei fehlten
        // komplett. Vierzehn Adressen des Streaming-Plugins galten deshalb zu
        // Unrecht als unerreichbar.
        const datei = (verweis.match(/require\('\.\/([^']+)'/) || [])[1]
            // `this.guildRouter.use('/', filesRouter)` — der Name kommt von oben.
            || (() => {
                // Nur ein blanker Name wird nachgeschlagen. Die erste Fassung
                // baute den Ausdruck aus dem ganzen Verweis — der konnte selbst
                // ein `require('./x')` sein, und daraus wurde ein ungueltiger
                // regulaerer Ausdruck („Unterminated group"). Ein Waechter, der
                // an seiner eigenen Eingabe zerbricht, prueft nichts.
                const name = verweis.trim();
                if (!/^[A-Za-z_$][\w$]*$/.test(name)) return null;
                const zu = quelle.match(new RegExp(`${name}\\s*=\\s*require\\('\\./([^']+)'\\)`));
                return zu ? zu[1] : null;
            })();
        if (!datei) continue;
        const pfad = path.join(PLUGINS, plugin.name, 'dashboard', datei.endsWith('.js') ? datei : datei + '.js');
        if (!fs.existsSync(pfad)) continue;
        const inhalt = ohneKommentare(fs.readFileSync(pfad, 'utf8'));
        for (const r of inhalt.matchAll(/router\.(?:get|post|put|patch|delete)\(\s*'([^']+)'/gi)) {
            const a = ersterAbschnitt(r[1]);
            if (a && !a.startsWith(':')) erreichbar.add(a);
        }
    }
    // ── Routen direkt am Router, ohne `use` ────────────────────────────────
    //
    // `dunemap` meldet seine Pfade unmittelbar an: `this.guildRouter.get(
    // '/settings', …)`. Die erste Fassung sah nur `use()` und erklaerte diese
    // Adressen fuer unerreichbar — sie sind es nicht.
    for (const m of quelle.matchAll(/Router\.(?:get|post|put|patch|delete)\(\s*'([^']+)'/gi)) {
        const a = ersterAbschnitt(m[1]);
        if (a && !a.startsWith(':')) erreichbar.add(a);
    }

    if (!erreichbar.size) continue;

    const ansichten = vorlagen(path.join(PLUGINS, plugin.name, 'dashboard/views'));
    const gefunden = new Set();
    for (const datei of ansichten) {
        // ── Ohne Kommentare, und zwar aus eigener Erfahrung ─────────────
        //
        // Die erste Fassung las den rohen Text — und schlug sofort an meinem
        // eigenen Kommentar an: Er ZITIERT den falschen Pfad, um zu erklaeren,
        // warum er falsch war. Ein Waechter, der die Begruendung fuer einen
        // behobenen Fehler als den Fehler meldet, misst die Prosa.
        const text = ohneKommentareEjs(fs.readFileSync(datei, 'utf8'));
        const muster = new RegExp(`/plugins/${plugin.name}/([a-z0-9-]+)`, 'gi');
        for (const m of text.matchAll(muster)) {
            if (KEINE_ROUTE.has(m[1].toLowerCase())) continue;
            gefunden.add(`${m[1]}\u0000${path.relative(WURZEL, datei)}`);
        }
    }
    if (!gefunden.size) continue;

    for (const eintrag of [...gefunden].sort()) {
        const [abschnitt, datei] = eintrag.split('\u0000');
        pruefe(erreichbar.has(abschnitt),
            `${plugin.name}: „/${abschnitt}" ist erreichbar (${path.basename(datei)})`,
            `Erreichbar sind: ${[...erreichbar].sort().map(x => '/' + x).join(', ')}.\n       `
          + 'Ein `fetch` auf eine fehlende Route wirft NICHT — es liefert die Fehlerseite, und erst '
          + '`.json()` scheitert. Im Panel sieht das aus wie „findet nichts".');
    }
}

console.log(`\n${fehler === 0 ? '✅' : '❌'} ${geprueft - fehler} von ${geprueft} Prüfungen bestanden`);
console.log(fehler === 0 ? '   Die Adressen zeigen dorthin, wo wirklich etwas antwortet.\n' : '');
process.exit(fehler === 0 ? 0 : 1);
