#!/usr/bin/env node
/**
 * Sucht AdminLTE- und Bootstrap-4-Reste in den EJS-Views.
 *
 * Das Dashboard laeuft unter `firebot-tabler` auf Tabler, also auf Bootstrap 5.
 * Die Views stammen aber aus der AdminLTE-Zeit und tragen drei Sorten Altlast:
 *
 *   1. TOT      — funktioniert unter Bootstrap 5 nicht mehr. `data-toggle`
 *                 heisst dort `data-bs-toggle`; ein Modal mit dem alten
 *                 Attribut oeffnet einfach nicht. Das ist kein Schoenheits-
 *                 fehler, das ist eine kaputte Schaltflaeche.
 *   2. ADMINLTE — Bauteile, die es in Tabler gar nicht gibt (`small-box`,
 *                 `info-box`, `callout`). Sie sehen nur deshalb halbwegs aus,
 *                 weil `tokens.css` einen Uebergangsabschnitt dafuer haelt.
 *                 Der soll weg, sobald diese Zahl auf Null steht.
 *   3. BS4      — in Bootstrap 5 umbenannt (`ml-2` → `ms-2`, `float-right` →
 *                 `float-end`). Wirkungslos, aber lautlos.
 *
 * Dazu kommt die Div-Bilanz je Datei. Ein `</div>` zu viel verschluckt beim
 * Widget-Umbau lautlos die naechste Karte — der Fehler vom 2026-08-04 sah aus
 * wie ein Sortable-Problem und war ein Tippfehler in der Vorlage davor.
 *
 * Aufruf:
 *   node scripts/check-adminlte.js                 Uebersicht je Bereich
 *   node scripts/check-adminlte.js gameserver      nur ein Bereich
 *   node scripts/check-adminlte.js --liste         jede Fundstelle mit Zeile
 *   node scripts/check-adminlte.js --tot           nur die kaputten Stellen
 *
 * WICHTIG — was dieses Skript NICHT kann:
 * Es liest Text, nicht Bedeutung. Klassennamen, die in einer JS-Zeichenkette
 * zusammengesetzt werden, entgehen ihm; ein `data-toggle` in einem Kommentar
 * zaehlt es mit. Und die Div-Bilanz schlaegt falsch an, wenn eine Verzweigung
 * zwei Varianten desselben `<div>` oeffnet. Jeder Befund ist ein begruendeter
 * Verdacht, keine Diagnose.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const WURZEL = path.join(__dirname, '..');

/** Verzeichnisse, in denen Views liegen. */
const BEREICHE = [
    { name: 'theme:default', pfad: 'apps/dashboard/themes/default' },
    { name: 'theme:firebot-tabler', pfad: 'apps/dashboard/themes/firebot-tabler' },
    ...fs.readdirSync(path.join(WURZEL, 'plugins'), { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => ({ name: e.name, pfad: path.join('plugins', e.name, 'dashboard') })),
];

/**
 * Die Muster. `regex` laeuft zeilenweise, `ersatz` sagt, was stattdessen
 * hingehoert — damit der Bericht nicht nur meldet, sondern beantwortet.
 */
const MUSTER = [
    // ── 1. Tot unter Bootstrap 5 ────────────────────────────────────────────
    { schwere: 'TOT', regex: /\bdata-toggle\s*=/,        ersatz: 'data-bs-toggle' },
    { schwere: 'TOT', regex: /\bdata-target\s*=/,        ersatz: 'data-bs-target' },
    { schwere: 'TOT', regex: /\bdata-dismiss\s*=/,       ersatz: 'data-bs-dismiss' },
    { schwere: 'TOT', regex: /\bdata-parent\s*=/,        ersatz: 'data-bs-parent' },
    { schwere: 'TOT', regex: /\bdata-ride\s*=/,          ersatz: 'data-bs-ride' },
    { schwere: 'TOT', regex: /\bdata-slide(-to)?\s*=/,   ersatz: 'data-bs-slide' },
    // Der Wortanker allein reicht hier nicht: `\bclose\b` trifft auch das
    // richtige `btn-close`, weil der Bindestrich eine Wortgrenze ist.
    { schwere: 'TOT', regex: /class="[^"]*(?<![-\w])close(?![-\w])[^"]*"/, ersatz: 'btn-close' },
    { schwere: 'TOT', regex: /\bbtn-block\b/,            ersatz: 'w-100' },
    { schwere: 'TOT', regex: /\bform-group\b/,           ersatz: 'mb-3' },
    { schwere: 'TOT', regex: /\binput-group-(append|prepend)\b/, ersatz: 'direkt in .input-group' },
    { schwere: 'TOT', regex: /\bcustom-(control|checkbox|switch|select)\b/, ersatz: 'form-check / form-select' },
    { schwere: 'TOT', regex: /\bsr-only\b/,              ersatz: 'visually-hidden' },
    { schwere: 'TOT', regex: /\bbadge-(primary|secondary|success|danger|warning|info|light|dark)\b/, ersatz: 'bg-*' },
    // Die jQuery-Erweiterung von Bootstrap 4. jQuery selbst ist unter Tabler
    // geladen, diese Methoden gibt es dort aber nicht — `$('#x').modal('show')`
    // wirft, und alles danach im selben Block laeuft nicht mehr.
    { schwere: 'TOT', regex: /\$\([^)]*\)\s*\.\s*(modal|tab|tooltip|popover|collapse|carousel|dropdown|toast)\s*\(/, ersatz: 'bootstrap.Modal/Tooltip … (Bootstrap-5-Schnittstelle)' },

    // ── 2. AdminLTE-Bauteile ────────────────────────────────────────────────
    { schwere: 'ADMINLTE', regex: /\bcontent-(header|wrapper)\b/, ersatz: 'Seitenrahmen kommt aus dem Layout' },
    { schwere: 'ADMINLTE', regex: /\bsmall-box\b/,       ersatz: 'card + .card-sm / datagrid' },
    { schwere: 'ADMINLTE', regex: /\binfo-box\b/,        ersatz: 'card + .card-sm / datagrid' },
    { schwere: 'ADMINLTE', regex: /\bcallout\b/,         ersatz: 'alert' },
    { schwere: 'ADMINLTE', regex: /\bbtn-tool\b/,        ersatz: 'btn-action' },
    { schwere: 'ADMINLTE', regex: /\bcard-tools\b/,      ersatz: 'card-actions' },
    { schwere: 'ADMINLTE', regex: /\bcard-(outline|primary|success|danger|warning|info)\b/, ersatz: 'card + Statusstreifen' },
    { schwere: 'ADMINLTE', regex: /\bbox-(header|body|footer|tools|title)\b/, ersatz: 'card-*' },
    { schwere: 'ADMINLTE', regex: /\bimg-circle\b/,      ersatz: 'avatar' },
    { schwere: 'ADMINLTE', regex: /\belevation-\d\b/,    ersatz: 'ersatzlos (Tabler setzt Schatten selbst)' },
    { schwere: 'ADMINLTE', regex: /\b(main-sidebar|main-header|main-footer|nav-sidebar|brand-link|user-panel)\b/, ersatz: 'Layout des Themes' },
    { schwere: 'ADMINLTE', regex: /\bbg-gradient-\w+\b/, ersatz: 'bg-*-lt' },
    { schwere: 'ADMINLTE', regex: /\b(direct-chat|products-list|timeline-item|attachment-block)\b/, ersatz: 'eigenes Tabler-Bauteil' },

    // ── 3. Bootstrap-4-Schreibweisen ────────────────────────────────────────
    { schwere: 'BS4', regex: /\bfloat-(right|left)\b/,   ersatz: 'float-end / float-start' },
    { schwere: 'BS4', regex: /\btext-(right|left)\b/,    ersatz: 'text-end / text-start' },
    { schwere: 'BS4', regex: /\b(ml|mr|pl|pr)-(auto|\d)\b/, ersatz: 'ms/me/ps/pe' },
    { schwere: 'BS4', regex: /\btext-muted\b/,           ersatz: 'text-secondary (haengt an --fb-text-muted)' },
    { schwere: 'BS4', regex: /\bfont-weight-\w+\b/,      ersatz: 'fw-*' },
    { schwere: 'BS4', regex: /\bno-gutters\b/,           ersatz: 'g-0' },
];

const SCHWEREN = ['TOT', 'ADMINLTE', 'BS4'];

// ─────────────────────────────────────────────────────────────────────────────
// Dateien einsammeln
// ─────────────────────────────────────────────────────────────────────────────

function ejsDateien(startPfad) {
    const treffer = [];
    const voll = path.join(WURZEL, startPfad);
    if (!fs.existsSync(voll)) return treffer;

    (function laufen(verzeichnis) {
        for (const eintrag of fs.readdirSync(verzeichnis, { withFileTypes: true })) {
            const p = path.join(verzeichnis, eintrag.name);
            if (eintrag.isDirectory()) {
                if (eintrag.name === 'node_modules') continue;
                laufen(p);
            } else if (eintrag.name.endsWith('.ejs')) {
                treffer.push(p);
            }
        }
    })(voll);

    return treffer;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pruefen
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Div-Bilanz einer Datei.
 *
 * Zwei Sorten Text fliegen vorher raus, weil dort `<div>` kein Markup ist:
 *
 *   - EJS-Bloecke `<% … %>` — dort steht JavaScript
 *   - `<script>`-Bloecke — auch dort. Und zwar reichlich: `$('<div>')`,
 *     `container.innerHTML = '<div class="…">' + …`, Template-Literale mit
 *     ganzen Kartenbaeumen darin. Ohne diesen Schnitt meldete das Skript
 *     `ticket-settings.ejs` mit 11 offenen `<div>` und `moderation.ejs` mit
 *     einem zu viel — beides Fehlalarme aus dem Skriptteil.
 *
 * @returns {number} 0 = ausgeglichen, positiv = offene, negativ = zu viele
 */
function divBilanz(inhalt) {
    const nurMarkup = inhalt
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<%[\s\S]*?%>/g, '');
    const auf = (nurMarkup.match(/<div\b/g) || []).length;
    const zu  = (nurMarkup.match(/<\/div\s*>/g) || []).length;
    return auf - zu;
}

function dateiPruefen(datei) {
    const inhalt = fs.readFileSync(datei, 'utf8');
    const relativ = path.relative(WURZEL, datei);
    const zeilen = inhalt.split('\n');
    const befunde = [];

    zeilen.forEach((zeile, i) => {
        for (const muster of MUSTER) {
            const treffer = zeile.match(muster.regex);
            if (treffer) {
                befunde.push({
                    datei: relativ,
                    zeile: i + 1,
                    schwere: muster.schwere,
                    was: treffer[0].trim(),
                    ersatz: muster.ersatz,
                });
            }
        }
    });

    return { datei: relativ, befunde, bilanz: divBilanz(inhalt) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Ausgabe
// ─────────────────────────────────────────────────────────────────────────────

function main() {
    const argumente = process.argv.slice(2);
    const liste = argumente.includes('--liste');
    const nurTot = argumente.includes('--tot');
    const filter = argumente.find(a => !a.startsWith('--'));

    const bereiche = filter
        ? BEREICHE.filter(b => b.name.includes(filter))
        : BEREICHE;

    if (!bereiche.length) {
        console.error(`Kein Bereich passt auf "${filter}". Bekannt: ${BEREICHE.map(b => b.name).join(', ')}`);
        process.exit(1);
    }

    console.log('\nAdminLTE- und Bootstrap-4-Reste in den Views\n');

    let gesamt = 0;
    const proSchwere = { TOT: 0, ADMINLTE: 0, BS4: 0 };
    const schiefeDateien = [];
    const uebersicht = [];

    for (const bereich of bereiche) {
        const ergebnisse = ejsDateien(bereich.pfad).map(dateiPruefen);

        let befunde = ergebnisse.flatMap(e => e.befunde);
        if (nurTot) befunde = befunde.filter(b => b.schwere === 'TOT');

        for (const e of ergebnisse) {
            if (e.bilanz !== 0) schiefeDateien.push({ datei: e.datei, bilanz: e.bilanz });
        }

        for (const b of befunde) proSchwere[b.schwere]++;
        gesamt += befunde.length;

        const dateienMitBefund = new Set(befunde.map(b => b.datei)).size;
        uebersicht.push({ name: bereich.name, befunde: befunde.length, dateien: dateienMitBefund });

        if (liste && befunde.length) {
            console.log(`\n── ${bereich.name} ──────────────────────────────────`);
            const proDatei = {};
            for (const b of befunde) (proDatei[b.datei] ||= []).push(b);

            for (const [datei, eintraege] of Object.entries(proDatei).sort((a, b) => b[1].length - a[1].length)) {
                console.log(`\n  ${datei}  (${eintraege.length})`);
                for (const b of eintraege) {
                    console.log(`    ${String(b.zeile).padStart(5)}  [${b.schwere.padEnd(8)}] ${b.was}  →  ${b.ersatz}`);
                }
            }
        }
    }

    console.log('\n─────────────────────────────────────────────────────────');
    console.log('  Bereich                       Dateien   Fundstellen');
    console.log('─────────────────────────────────────────────────────────');
    for (const u of uebersicht.sort((a, b) => b.befunde - a.befunde)) {
        if (!u.befunde) continue;
        console.log(`  ${u.name.padEnd(28)}  ${String(u.dateien).padStart(6)}   ${String(u.befunde).padStart(11)}`);
    }
    console.log('─────────────────────────────────────────────────────────');
    console.log(`  ${'GESAMT'.padEnd(28)}  ${''.padStart(6)}   ${String(gesamt).padStart(11)}\n`);

    console.log('  nach Schwere:');
    for (const s of SCHWEREN) {
        if (nurTot && s !== 'TOT') continue;
        const hinweis = { TOT: 'funktioniert unter Bootstrap 5 nicht', ADMINLTE: 'Bauteil gibt es in Tabler nicht', BS4: 'umbenannt, wirkungslos' }[s];
        console.log(`    ${s.padEnd(10)} ${String(proSchwere[s]).padStart(5)}   ${hinweis}`);
    }

    if (schiefeDateien.length) {
        console.log(`\n  Div-Bilanz schief in ${schiefeDateien.length} Datei(en) — Verdacht, nicht Diagnose:`);
        for (const d of schiefeDateien.slice(0, 20)) {
            const richtung = d.bilanz > 0 ? `${d.bilanz} offen` : `${-d.bilanz} zu viel geschlossen`;
            console.log(`    ${d.datei}  (${richtung})`);
        }
        if (schiefeDateien.length > 20) console.log(`    … und ${schiefeDateien.length - 20} weitere`);
    }

    console.log('');
    if (!liste) console.log('  Fundstellen im Einzelnen: --liste · nur die kaputten: --tot\n');
}

main();
