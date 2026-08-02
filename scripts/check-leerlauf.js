#!/usr/bin/env node
/**
 * Sucht Leerlauf: Code, der da ist, aber nichts tut.
 *
 * Alle Befunde der Sanierung vom 2026-08-02 liessen sich auf wenige Muster
 * zurueckfuehren — etwas ist deklariert, aber die Kette endet vorher. Eine
 * Methode ohne Aufrufer, eine Tabelle ohne INSERT, ein Payload-Feld ohne Leser,
 * ein Recht ohne Waechter, ein Uebersetzungsschluessel ohne Verwendung.
 *
 * Dieses Skript sucht genau danach, damit aus "vermutlich gibt es davon 100"
 * eine Zahl wird.
 *
 * Aufruf:
 *   node scripts/check-leerlauf.js                  alles
 *   node scripts/check-leerlauf.js gameserver       nur ein Bereich
 *   node scripts/check-leerlauf.js --bericht        zusaetzlich nach docs/audit/
 *
 * WICHTIG — was dieses Skript NICHT kann:
 * Es liest Text, nicht Bedeutung. Dynamisch zusammengesetzte Namen
 * (`render('guild/' + x)`), Aufrufe ueber Zwischenvariablen und alles, was ueber
 * Systemgrenzen laeuft (Dashboard → Daemon), entgehen ihm. Jeder Befund ist ein
 * begruendeter Verdacht und braucht einen Blick, bevor etwas geloescht wird.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const WURZEL = path.join(__dirname, '..');

/** Verzeichnisse, die nie Eigencode enthalten. */
const AUSGESCHLOSSEN = [
    'node_modules', '.git', 'vendor', 'monaco-editor',
    'downloads', 'uploads', 'logs', 'docs', 'docs_OLD', 'build', 'dist',
];

/** Bereiche, die geprueft werden. */
const BEREICHE = [
    ...fs.readdirSync(path.join(WURZEL, 'plugins'), { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => ({ name: e.name, pfad: path.join('plugins', e.name) })),
    { name: 'apps', pfad: 'apps' },
    { name: 'packages', pfad: 'packages' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Dateien einsammeln
// ─────────────────────────────────────────────────────────────────────────────

function dateienSammeln(startPfad, endungen = ['.js', '.ejs', '.json']) {
    const treffer = [];
    const voll = path.join(WURZEL, startPfad);
    if (!fs.existsSync(voll)) return treffer;

    (function laufen(verzeichnis) {
        let eintraege;
        try {
            eintraege = fs.readdirSync(verzeichnis, { withFileTypes: true });
        } catch (_) {
            return;
        }
        for (const eintrag of eintraege) {
            const p = path.join(verzeichnis, eintrag.name);
            if (eintrag.isDirectory()) {
                if (AUSGESCHLOSSEN.includes(eintrag.name)) continue;
                laufen(p);
            } else if (endungen.includes(path.extname(eintrag.name))) {
                if (eintrag.name.endsWith('.min.js')) continue;
                treffer.push(p);
            }
        }
    })(voll);

    return treffer;
}

/** Liest alle Dateien einmal ein — jede Pruefung sucht im selben Korpus. */
function korpusBauen(dateien) {
    const inhalte = new Map();
    for (const d of dateien) {
        try {
            inhalte.set(d, fs.readFileSync(d, 'utf8'));
        } catch (_) { /* unlesbar = nicht vorhanden */ }
    }
    return inhalte;
}

const relativ = (p) => path.relative(WURZEL, p);

// ─────────────────────────────────────────────────────────────────────────────
// Pruefung 1: Doppelt vergebene Routen
//
// Express bedient bei gleichem Methode+Pfad immer den zuerst registrierten
// Handler. Der zweite ist unerreichbar — und traegt oft die vollstaendigere
// Logik, wie das `DELETE /rootservers/:id` im Masterserver.
// ─────────────────────────────────────────────────────────────────────────────
function doppelteRouten(korpus) {
    const befunde = [];

    for (const [datei, inhalt] of korpus) {
        if (!datei.endsWith('.js')) continue;
        if (!/router\.(get|post|put|delete|patch)\s*\(/.test(inhalt)) continue;

        const gesehen = new Map();
        const zeilen = inhalt.split('\n');

        zeilen.forEach((zeile, i) => {
            const treffer = zeile.match(/^\s*router\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]*)['"`]/);
            if (!treffer) return;
            const schluessel = `${treffer[1].toUpperCase()} ${treffer[2]}`;
            if (gesehen.has(schluessel)) {
                befunde.push({
                    datei: relativ(datei),
                    zeile: i + 1,
                    was: schluessel,
                    hinweis: `verdeckt von Zeile ${gesehen.get(schluessel)}`,
                });
            } else {
                gesehen.set(schluessel, i + 1);
            }
        });
    }

    return befunde;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pruefung 2: Routen ohne Rechtepruefung
//
// Gezaehlt werden nur Guild-Router von Plugins — dort greift `CheckGuildAccess`,
// das aber nur die Mitgliedschaft prueft, nicht die Berechtigung.
// ─────────────────────────────────────────────────────────────────────────────
function routenOhneRecht(korpus) {
    const befunde = [];

    for (const [datei, inhalt] of korpus) {
        if (!datei.endsWith('.js')) continue;
        if (!datei.includes(`${path.sep}routes${path.sep}`)) continue;
        if (!datei.includes(`${path.sep}plugins${path.sep}`)) continue;

        const zeilen = inhalt.split('\n');
        const WAECHTER = /requirePermission|requireAnyPermission|requireAllPermissions|requireGuildOwner/;

        zeilen.forEach((zeile, i) => {
            const treffer = zeile.match(/^\s*router\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]*)['"`]/);
            if (!treffer) return;

            // Routen werden oft mehrzeilig geschrieben, mit dem Waechter in der
            // naechsten Zeile. Die Handler-Kette bis zum `async (req, res)`
            // gehoert noch zur Definition.
            const kette = zeilen.slice(i, i + 5).join('\n');
            const bisHandler = kette.split(/async\s*\(|\(req\s*,\s*res/)[0];
            if (WAECHTER.test(bisHandler)) return;

            // Bewusst offene Routen kennzeichnen sich durch einen Kommentar
            // ueber der Definition. Gemeldet werden sie trotzdem — nur mit
            // Hinweis, damit niemand sie versehentlich zuschliesst.
            const davor = zeilen.slice(Math.max(0, i - 6), i).join('\n');
            const absichtlich = /öffentlich|oeffentlich|public|ohne Anmeldung|Token|kein Schutz|nicht geschützt|absichtlich offen/i.test(davor);

            befunde.push({
                datei: relativ(datei),
                zeile: i + 1,
                was: `${treffer[1].toUpperCase()} ${treffer[2]}`,
                hinweis: absichtlich
                    ? 'kein Waechter — Kommentar deutet auf Absicht (pruefen)'
                    : 'kein Waechter in der Definition',
            });
        });
    }

    return befunde;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pruefung 3: Views, die keine Route rendert
// ─────────────────────────────────────────────────────────────────────────────
function toteViews(korpus) {
    const befunde = [];
    const jsInhalt = [...korpus.entries()]
        .filter(([d]) => d.endsWith('.js'))
        .map(([, i]) => i).join('\n');
    const ejsInhalt = [...korpus.entries()]
        .filter(([d]) => d.endsWith('.ejs'))
        .map(([, i]) => i).join('\n');

    for (const datei of korpus.keys()) {
        if (!datei.endsWith('.ejs')) continue;
        // Partials und Layouts werden per include eingebunden, nicht gerendert
        if (/partials|layouts|components/.test(datei)) continue;

        const name = path.basename(datei, '.ejs');
        const ordner = path.basename(path.dirname(datei));
        const kandidaten = [name, `${ordner}/${name}`];

        const gerendert = kandidaten.some(k => jsInhalt.includes(`'${k}'`) || jsInhalt.includes(`"${k}"`) || jsInhalt.includes(`\`${k}\``));
        const eingebunden = ejsInhalt.includes(`'${name}'`) || ejsInhalt.includes(`"${name}"`) || ejsInhalt.includes(`/${name}'`);

        if (!gerendert && !eingebunden) {
            const zeilen = korpus.get(datei).split('\n').length;
            befunde.push({
                datei: relativ(datei),
                zeile: 1,
                was: `${zeilen} Zeilen`,
                hinweis: 'kein render() und kein include gefunden',
            });
        }
    }

    return befunde;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pruefung 4: Uebersetzungsschluessel ohne Verwendung
// ─────────────────────────────────────────────────────────────────────────────
function toteUebersetzungen(korpus) {
    const befunde = [];
    const suchraum = [...korpus.entries()]
        .filter(([d]) => d.endsWith('.js') || d.endsWith('.ejs'))
        .map(([, i]) => i).join('\n');

    const flach = (o, praefix = '') => {
        const raus = [];
        for (const [k, v] of Object.entries(o || {})) {
            if (v && typeof v === 'object' && !Array.isArray(v)) raus.push(...flach(v, praefix + k + '.'));
            else raus.push(praefix + k);
        }
        return raus;
    };

    for (const [datei, inhalt] of korpus) {
        if (!datei.includes(`${path.sep}locales${path.sep}`)) continue;
        if (!datei.endsWith('.json')) continue;
        // Nur die Leitsprache pruefen; die anderen spiegeln sie
        if (!/de-DE\.json$/.test(datei)) continue;

        let daten;
        try { daten = JSON.parse(inhalt); } catch (_) { continue; }

        const schluessel = flach(daten);
        const tot = schluessel.filter(k => !suchraum.includes(k));

        if (tot.length) {
            befunde.push({
                datei: relativ(datei),
                zeile: 1,
                was: `${tot.length} von ${schluessel.length} Schluesseln`,
                hinweis: tot.slice(0, 5).join(', ') + (tot.length > 5 ? ' …' : ''),
            });
        }
    }

    return befunde;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pruefung 5: Config-Schluessel, die niemand liest
// ─────────────────────────────────────────────────────────────────────────────
function toteConfigSchluessel(korpus) {
    const befunde = [];
    const suchraum = [...korpus.entries()]
        .filter(([d]) => !d.endsWith('config.json'))
        .map(([, i]) => i).join('\n');

    for (const [datei, inhalt] of korpus) {
        if (path.basename(datei) !== 'config.json') continue;

        let daten;
        try { daten = JSON.parse(inhalt); } catch (_) { continue; }

        const tot = Object.keys(daten).filter(k => !suchraum.includes(k));
        if (tot.length) {
            befunde.push({
                datei: relativ(datei),
                zeile: 1,
                was: `${tot.length} von ${Object.keys(daten).length} Schluesseln`,
                hinweis: tot.join(', '),
            });
        }
    }

    return befunde;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pruefung 6: Modell- und Helfer-Methoden ohne Aufrufer
//
// Sucht `static async name(` bzw. `static name(` in models/ und helpers/ und
// prueft, ob irgendwo `Etwas.name(` steht.
// ─────────────────────────────────────────────────────────────────────────────
function methodenOhneAufrufer(korpus) {
    const befunde = [];
    const suchraum = [...korpus.entries()]
        .filter(([d]) => d.endsWith('.js') || d.endsWith('.ejs'))
        .map(([d, i]) => ({ d, i }));

    for (const [datei, inhalt] of korpus) {
        if (!datei.endsWith('.js')) continue;
        const istModell = datei.includes(`${path.sep}models${path.sep}`) || datei.includes(`${path.sep}helpers${path.sep}`);
        if (!istModell) continue;

        const zeilen = inhalt.split('\n');
        zeilen.forEach((zeile, i) => {
            const treffer = zeile.match(/^\s*static\s+(?:async\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/);
            if (!treffer) return;
            const name = treffer[1];
            if (['constructor', 'toString', 'from', 'of'].includes(name)) return;

            // Aufrufe ausserhalb der Definitionsdatei suchen
            const aufrufe = suchraum.filter(({ d, i: inh }) =>
                d !== datei && new RegExp(`\\.${name}\\s*\\(`).test(inh)
            );
            // Auch Aufrufe in der eigenen Datei zaehlen (this.name / Klasse.name)
            const eigen = (inhalt.match(new RegExp(`\\.${name}\\s*\\(`, 'g')) || []).length;

            if (aufrufe.length === 0 && eigen === 0) {
                befunde.push({
                    datei: relativ(datei),
                    zeile: i + 1,
                    was: `${name}()`,
                    hinweis: 'kein Aufruf gefunden',
                });
            }
        });
    }

    return befunde;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pruefung 7: Tabellen ohne Schreiber oder ohne Leser
//
// Tabellennamen stammen aus den CREATE-TABLE-Anweisungen der Migrationen.
// ─────────────────────────────────────────────────────────────────────────────
function tabellenOhneNutzung(korpus) {
    const befunde = [];

    const tabellen = new Map();   // name -> definierende Datei
    const gedroppt = new Set();   // spaeter wieder entfernt

    for (const [datei, inhalt] of korpus) {
        if (!datei.includes(`${path.sep}migrations${path.sep}`)) continue;

        for (const t of inhalt.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?`?([a-z_][a-z0-9_]*)`?/gi)) {
            if (!tabellen.has(t[1])) tabellen.set(t[1], relativ(datei));
        }
        // Eine spaetere Migration kann eine Tabelle der Baseline wieder
        // entfernen. Die Baseline beschreibt den historischen Ausgangszustand
        // und wird nicht rueckwirkend geaendert — ohne diese Ausnahme meldete
        // das Skript jede aufgeloeste Tabelle als Leerlauf.
        // `down()` legt sie fuer den Rueckbau erneut an; das zaehlt nicht.
        for (const t of inhalt.matchAll(/DROP TABLE (?:IF EXISTS )?`?([a-z_][a-z0-9_]*)`?/gi)) {
            gedroppt.add(t[1]);
        }
    }

    for (const t of gedroppt) tabellen.delete(t);

    // Suchraum: alles ausser Migrationen (die definieren nur)
    const codeInhalt = [...korpus.entries()]
        .filter(([d]) => !d.includes(`${path.sep}migrations${path.sep}`))
        .map(([, i]) => i).join('\n');

    for (const [tabelle, quelle] of tabellen) {
        const schreibt = new RegExp(`(INSERT\\s+(?:IGNORE\\s+)?INTO|UPDATE|REPLACE\\s+INTO)\\s+\`?${tabelle}\`?`, 'i').test(codeInhalt);
        const liest = new RegExp(`(FROM|JOIN)\\s+\`?${tabelle}\`?`, 'i').test(codeInhalt);

        if (!schreibt && !liest) {
            befunde.push({ datei: quelle, zeile: 1, was: tabelle, hinweis: 'weder gelesen noch geschrieben' });
        } else if (!schreibt) {
            befunde.push({ datei: quelle, zeile: 1, was: tabelle, hinweis: 'wird gelesen, aber nie geschrieben' });
        } else if (!liest) {
            befunde.push({ datei: quelle, zeile: 1, was: tabelle, hinweis: 'wird geschrieben, aber nie gelesen' });
        }
    }

    return befunde;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pruefung 8: Auffaelligkeiten im Code
//
// Debug-Ausgaben am Logger vorbei und liegengebliebene Marker.
// ─────────────────────────────────────────────────────────────────────────────
function auffaelligkeiten(korpus) {
    const befunde = [];

    for (const [datei, inhalt] of korpus) {
        if (!datei.endsWith('.js')) continue;
        // Theme-Assets laufen im Browser, dort ist console.log normal
        if (datei.includes(`${path.sep}assets${path.sep}`) || datei.includes(`${path.sep}themes${path.sep}`)) continue;
        if (datei.includes(`${path.sep}scripts${path.sep}`)) continue;

        inhalt.split('\n').forEach((zeile, i) => {
            if (/^\s*(\/\/|\*)/.test(zeile)) return;   // Kommentare ueberspringen

            if (/console\.(log|debug)\s*\(/.test(zeile)) {
                befunde.push({ datei: relativ(datei), zeile: i + 1, was: 'console.log', hinweis: 'Ausgabe am Logger vorbei' });
            }
            const marker = zeile.match(/(?:\/\/|\/\*)\s*(TODO|FIXME|HACK|XXX)\b[:\s]*(.{0,60})/);
            if (marker) {
                befunde.push({ datei: relativ(datei), zeile: i + 1, was: marker[1], hinweis: marker[2].trim() || '(ohne Text)' });
            }
        });
    }

    return befunde;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ausfuehrung
// ─────────────────────────────────────────────────────────────────────────────

const PRUEFUNGEN = [
    { name: 'Doppelt vergebene Routen',        schwere: 'hoch',   fn: doppelteRouten },
    { name: 'Routen ohne Rechtepruefung',      schwere: 'hoch',   fn: routenOhneRecht },
    { name: 'Tabellen ohne Schreiber/Leser',   schwere: 'hoch',   fn: tabellenOhneNutzung },
    { name: 'Methoden ohne Aufrufer',          schwere: 'mittel', fn: methodenOhneAufrufer },
    { name: 'Views ohne Route',                schwere: 'mittel', fn: toteViews },
    { name: 'Config-Schluessel ohne Leser',    schwere: 'niedrig', fn: toteConfigSchluessel },
    { name: 'Uebersetzungen ohne Verwendung',  schwere: 'niedrig', fn: toteUebersetzungen },
    { name: 'Debug-Ausgaben und Marker',       schwere: 'niedrig', fn: auffaelligkeiten },
];

function main() {
    const argumente = process.argv.slice(2);
    const berichtSchreiben = argumente.includes('--bericht');
    const filter = argumente.filter(a => !a.startsWith('--'));

    const zuPruefen = filter.length
        ? BEREICHE.filter(b => filter.includes(b.name))
        : BEREICHE;

    if (!zuPruefen.length) {
        console.error(`Kein Bereich gefunden. Verfuegbar: ${BEREICHE.map(b => b.name).join(', ')}`);
        process.exit(1);
    }

    // Ein gemeinsamer Korpus ueber ALLE Bereiche — ein Aufrufer kann in einem
    // anderen Plugin sitzen, wie `RootServer` im IPMServer.
    const alleDateien = BEREICHE.flatMap(b => dateienSammeln(b.pfad));
    const korpus = korpusBauen(alleDateien);

    console.log(`\nGeprueft: ${korpus.size} Dateien in ${BEREICHE.length} Bereichen\n`);

    const ergebnisse = [];
    for (const pruefung of PRUEFUNGEN) {
        const alle = pruefung.fn(korpus);
        // Auf gewuenschte Bereiche einschraenken
        const befunde = alle.filter(b =>
            zuPruefen.some(z => b.datei.startsWith(z.pfad + path.sep) || b.datei.startsWith(z.pfad + '/'))
        );
        ergebnisse.push({ ...pruefung, befunde });
    }

    // Konsolenausgabe
    for (const e of ergebnisse) {
        const kopf = `${e.name} (${e.schwere})`;
        if (!e.befunde.length) {
            console.log(`  ✔ ${kopf}: nichts gefunden`);
            continue;
        }
        console.log(`\n  ▸ ${kopf}: ${e.befunde.length} Befund(e)`);
        const proBereich = {};
        for (const b of e.befunde) {
            const bereich = b.datei.split('/').slice(0, 2).join('/');
            (proBereich[bereich] ||= []).push(b);
        }
        for (const [bereich, liste] of Object.entries(proBereich).sort((a, b) => b[1].length - a[1].length)) {
            console.log(`      ${bereich.padEnd(28)} ${liste.length}`);
        }
    }

    const gesamt = ergebnisse.reduce((s, e) => s + e.befunde.length, 0);
    console.log(`\n  Gesamt: ${gesamt} Befund(e)\n`);

    if (berichtSchreiben) {
        const ziel = berichtSchreibenNach(ergebnisse, korpus.size);
        console.log(`  Bericht: ${ziel}\n`);
    } else {
        console.log('  (mit --bericht landet die vollstaendige Liste in docs/audit/)\n');
    }
}

function berichtSchreibenNach(ergebnisse, dateiZahl) {
    const heute = new Date().toISOString().slice(0, 10);
    const ordner = path.join(WURZEL, 'docs', 'audit');
    fs.mkdirSync(ordner, { recursive: true });
    const ziel = path.join(ordner, `leerlauf-${heute}.md`);

    const zeilen = [];
    zeilen.push(`# Leerlauf-Bericht ${heute}`);
    zeilen.push('');
    zeilen.push(`Erzeugt von \`scripts/check-leerlauf.js\` ueber ${dateiZahl} Dateien.`);
    zeilen.push('');
    zeilen.push('**Jeder Eintrag ist ein Verdacht, kein Urteil.** Das Skript liest Text, nicht');
    zeilen.push('Bedeutung: dynamisch gebaute Namen, Aufrufe ueber Zwischenvariablen und alles,');
    zeilen.push('was ueber Systemgrenzen laeuft (Dashboard → Daemon), entgehen ihm. Vor dem');
    zeilen.push('Loeschen also immer nachsehen.');
    zeilen.push('');

    zeilen.push('## Uebersicht');
    zeilen.push('');
    zeilen.push('| Pruefung | Schwere | Befunde |');
    zeilen.push('|---|---|---|');
    for (const e of ergebnisse) {
        zeilen.push(`| ${e.name} | ${e.schwere} | ${e.befunde.length} |`);
    }
    zeilen.push(`| **Gesamt** | | **${ergebnisse.reduce((s, e) => s + e.befunde.length, 0)}** |`);
    zeilen.push('');

    for (const e of ergebnisse) {
        if (!e.befunde.length) continue;
        zeilen.push(`## ${e.name}`);
        zeilen.push('');
        zeilen.push(`Schwere: ${e.schwere} · ${e.befunde.length} Befund(e)`);
        zeilen.push('');

        const proBereich = {};
        for (const b of e.befunde) {
            const bereich = b.datei.split('/').slice(0, 2).join('/');
            (proBereich[bereich] ||= []).push(b);
        }

        for (const [bereich, liste] of Object.entries(proBereich).sort((a, b) => b[1].length - a[1].length)) {
            zeilen.push(`### ${bereich} — ${liste.length}`);
            zeilen.push('');
            for (const b of liste.slice(0, 60)) {
                zeilen.push(`- \`${b.datei}:${b.zeile}\` — **${b.was}** · ${b.hinweis}`);
            }
            if (liste.length > 60) zeilen.push(`- … und ${liste.length - 60} weitere`);
            zeilen.push('');
        }
    }

    fs.writeFileSync(ziel, zeilen.join('\n') + '\n');
    return path.relative(WURZEL, ziel);
}

main();
