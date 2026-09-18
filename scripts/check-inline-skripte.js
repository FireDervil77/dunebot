#!/usr/bin/env node
/**
 * Laesst sich jedes Inline-`<script>` einer Vorlage ueberhaupt uebersetzen?
 *
 * ── Der Befund, der dazu fuehrte (2026-09-18) ───────────────────────────────
 *
 * Der Betreiber, seit dem 2026-09-07 mehrfach: *„der start und stop button auf
 * der seite hat noch nie funktioniert."*
 *
 * Gesucht wurde an den Routen, am CSRF-Token, an den Rechten und am Rendern der
 * Knoepfe — alles in Ordnung. Die Ursache stand in der Vorlage selbst:
 * `gameserver-dashboard.ejs` hatte seit `59c0a0c` (**2026-03-18**) eine
 * Funktion ohne schliessende Klammer. Entfernt werden sollte nur ein `alert()`;
 * mitgegangen ist die `}` darunter.
 *
 * **Ein Syntaxfehler in einem Inline-Skript nimmt den GANZEN Block mit.** Der
 * Browser uebersetzt `<script>…</script>` als Einheit: Faellt sie durch, wird
 * *nichts* darin ausgefuehrt. In dem Fall waren das 270 Zeilen — die
 * Start/Stopp-Knoepfe, die Live-Anzeige ueber SSE und die Spielerzahl. Sechs
 * Monate lang, ohne eine einzige Zeile im Server-Protokoll: Der Fehler steht in
 * der Browser-Konsole, und dorthin sieht niemand, der nicht schon sucht.
 *
 * **Kein anderes Werkzeug findet das.** `node --check` liest keine `.ejs`,
 * `ejs.compile()` prueft nur die Vorlage (der Block ist fuer EJS blosser Text),
 * und `check-undefiniert.js` liest nur `.js`.
 *
 * ── Wie geprueft wird ───────────────────────────────────────────────────────
 *
 * Die EJS-Anteile werden ersetzt, bevor uebersetzt wird:
 *
 *   `<%= x %>` / `<%- x %>` → ein Bezeichner. Er steht mal in einer
 *   Zeichenkette (`'<%= guildId %>'`), mal als Ausdruck — ein Bezeichner passt
 *   an beiden Stellen, eine Zahl oder Zeichenkette nicht immer.
 *
 *   `<% if (x) { %>` → der Inhalt bleibt stehen, denn das IST JavaScript und
 *   traegt die Klammern des erzeugten Blocks.
 *
 *   node scripts/check-inline-skripte.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WURZEL = path.join(__dirname, '..');

/** Verzeichnisse mit Vorlagen. */
const ORTE = [
    'apps/dashboard/themes',
    'plugins'
];

/** Was kein JavaScript ist und deshalb nicht uebersetzt wird. */
const KEIN_JS = /type\s*=\s*['"](?!text\/javascript|application\/javascript|module)[^'"]*['"]/i;

function dateien(verzeichnis, treffer = []) {
    if (!fs.existsSync(verzeichnis)) return treffer;
    for (const eintrag of fs.readdirSync(verzeichnis, { withFileTypes: true })) {
        const voll = path.join(verzeichnis, eintrag.name);
        if (eintrag.isDirectory()) {
            if (eintrag.name === 'node_modules' || eintrag.name === 'backups') continue;
            dateien(voll, treffer);
        } else if (eintrag.name.endsWith('.ejs')) {
            treffer.push(voll);
        }
    }
    return treffer;
}

/**
 * EJS-Kommentare raus, Zeilenzahl behalten.
 *
 * **Das muss VOR dem Ausschneiden der Bloecke geschehen.** Ein Kommentar der
 * Vorlage darf alles enthalten — in `server-detail-variables.ejs` steht in
 * einem die Zeichenfolge `</script>`, als Erklaerung. Wer die Bloecke zuerst
 * ausschneidet, hoert dort auf und meldet den abgeschnittenen Rest als
 * Syntaxfehler. Das war der erste Fehlalarm dieses Skripts; EJS entfernt den
 * Kommentar, bevor der Browser die Seite ueberhaupt sieht.
 *
 * Ersetzt wird durch ebenso viele Zeilenumbrueche, sonst zeigt jede gemeldete
 * Zeile darunter auf die falsche Stelle.
 */
function ohneVorlagenKommentare(text) {
    return text.replace(/<%#[\s\S]*?%>/g, (treffer) => treffer.replace(/[^\n]/g, ''));
}

/** EJS raus, JavaScript stehen lassen. */
function nurJavaScript(block) {
    return block
        // Ausgaben: ein Bezeichner passt in Zeichenkette UND Ausdruck
        .replace(/<%[=-]\s*[\s\S]*?%>/g, 'EJS_WERT')
        // Steuerung: der Inhalt IST JavaScript und traegt die Klammern
        .replace(/<%\s*([\s\S]*?)\s*%>/g, '$1');
}

console.log('\n▸ Laesst sich jedes Inline-Skript einer Vorlage uebersetzen?\n');

let fehler = 0;
let bloecke = 0;
let gepruefteDateien = 0;
const uebersprungen = [];

for (const ort of ORTE) {
    for (const datei of dateien(path.join(WURZEL, ort))) {
        const quelle = ohneVorlagenKommentare(fs.readFileSync(datei, 'utf8'));
        if (!quelle.includes('<script')) continue;
        gepruefteDateien++;

        const muster = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
        let treffer;
        while ((treffer = muster.exec(quelle)) !== null) {
            const attribute = treffer[1] || '';
            const block = treffer[2] || '';

            // Ein Skript von aussen hat hier keinen Rumpf.
            if (/\bsrc\s*=/i.test(attribute)) continue;
            if (!block.trim()) continue;

            if (KEIN_JS.test(attribute)) {
                // **Keine stille Ausnahme.** Vorlagen und JSON-Bloecke sind
                // kein JavaScript — das gehoert in die Liste, nicht in ein
                // `continue`, sonst meldet dieses Skript gruen, weil es
                // weggesehen hat.
                uebersprungen.push({
                    datei: path.relative(WURZEL, datei),
                    zeile: quelle.slice(0, treffer.index).split('\n').length,
                    grund: `kein JavaScript (${attribute.trim().slice(0, 40)})`
                });
                continue;
            }

            bloecke++;
            const zeile = quelle.slice(0, treffer.index).split('\n').length;

            try {
                // `new vm.Script` uebersetzt, ohne auszufuehren — genau das,
                // was der Browser beim Laden des Blocks tut.
                new vm.Script(nurJavaScript(block), { filename: datei });
            } catch (ausnahme) {
                fehler++;
                console.log(`  ❌ ${path.relative(WURZEL, datei)}:${zeile}`);
                console.log(`       ${ausnahme.message}`);
                console.log('       ⚠ Der Browser fuehrt von diesem Block GAR NICHTS aus.');
            }
        }
    }
}

if (uebersprungen.length) {
    console.log(`\n▸ Nicht uebersetzt (${uebersprungen.length}) — kein JavaScript`);
    for (const u of uebersprungen) console.log(`  · ${u.datei}:${u.zeile}  ${u.grund}`);
}

console.log(`\n▸ ${bloecke} Inline-Bloecke in ${gepruefteDateien} Vorlagen geprueft.`);
console.log(fehler === 0
    ? '\n✅ Jeder Inline-Block laesst sich uebersetzen\n'
    : `\n❌ ${fehler} Block/Bloecke fallen durch — dort laeuft kein einziges Skript\n`);
process.exit(fehler === 0 ? 0 : 1);
