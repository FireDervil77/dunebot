#!/usr/bin/env node
/**
 * Hält die Parameter-Referenz gegen das Paket (E-21).
 *
 * Eine von Hand gepflegte Parameterliste neben dem Paket veraltet, und irgendwann
 * glaubt jemand ihr statt dem Paket. Deshalb gehört ein Abgleich dazu. Er meldet
 * genau drei Dinge:
 *
 *   1 WEGFALL     Wir benutzen einen Parameter, den die Referenz nicht kennt.
 *                 Verdacht auf Wegfall — ansehen, BEVOR das nächste Update kommt.
 *   2 KANDIDAT    Die Referenz kennt einen Parameter, den wir nicht anbieten.
 *                 Kandidat für die Einstellungskarte.
 *   3 ALTER       Die Referenz ist älter als sechs Monate.
 *                 Wissen ohne Datum ist kein Wissen.
 *
 * Was dieses Werkzeug NICHT tut: irgendetwas übernehmen. Die Referenz ist
 * Fundstelle für Menschen, keine Quelle für Code (E-21). Ein Kandidat ist ein
 * Vorschlag an einen Menschen, kein Auftrag an den Übersetzer.
 *
 *   node scripts/check-referenz.js                 # alle Referenzen
 *   node scripts/check-referenz.js valheim         # eine, über ihr Kürzel
 *   node scripts/check-referenz.js --paket pfad/zum/paket.json
 *
 * Das Gegenstück wird in dieser Reihenfolge gesucht:
 *   packages/fbpkg/beispiele/<slug>.json  →  der jüngste Sammelband unter
 *   docs/spielpakete/bestand/uebersetzung-*.json
 * Das von Hand gepflegte Paket hat Vorrang: Es ist das maßgebliche.
 *
 * Rein lesend. Rückgabewert 0 = nichts zu tun, 1 = mindestens eine Meldung.
 *
 * @author FireDervil
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const Ajv  = require('ajv');

const WURZEL        = path.join(__dirname, '..');
const SCHEMA_PFAD   = path.join(WURZEL, 'packages/fbpkg/schema/referenz-v1.schema.json');
const REFERENZ_PFAD = path.join(WURZEL, 'packages/fbpkg/referenz');
const BEISPIEL_PFAD = path.join(WURZEL, 'packages/fbpkg/beispiele');
const BESTAND_PFAD  = path.join(WURZEL, 'docs/spielpakete/bestand');

const MONATE_BIS_ALT = 6;

// ─────────────────────────────────────────────────────────────────────────────
// Das Gegenstück finden
// ─────────────────────────────────────────────────────────────────────────────

/** Der jüngste Sammelband des Übersetzers, oder null. */
function jüngsterSammelband() {
    if (!fs.existsSync(BESTAND_PFAD)) return null;
    const treffer = fs.readdirSync(BESTAND_PFAD)
        .filter(n => /^uebersetzung-\d{4}-\d{2}-\d{2}\.json$/.test(n))
        .sort();
    return treffer.length ? path.join(BESTAND_PFAD, treffer[treffer.length - 1]) : null;
}

let sammelband = null;   // erst laden, wenn wirklich gebraucht (2,6 MB)

function suchePaket(slug) {
    const vonHand = path.join(BEISPIEL_PFAD, `${slug}.json`);
    if (fs.existsSync(vonHand)) {
        return { paket: JSON.parse(fs.readFileSync(vonHand, 'utf8')),
                 herkunft: path.relative(WURZEL, vonHand), massgeblich: true };
    }

    if (sammelband === null) {
        const datei = jüngsterSammelband();
        sammelband = datei ? { datei, inhalt: JSON.parse(fs.readFileSync(datei, 'utf8')) } : false;
    }
    if (!sammelband) return null;

    const treffer = (sammelband.inhalt.pakete || []).find(e => e.paket?.identity?.slug === slug);
    if (!treffer) return null;
    return { paket: treffer.paket, herkunft: path.relative(WURZEL, sammelband.datei), massgeblich: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// Was benutzt das Paket?
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sammelt die Startparameter, die im Paket wirklich vorkommen.
 *
 * Drei Gestalten sind zu bedienen: `form` als Zeichenkette (`"-crossplay"`),
 * `form` als Liste (`["-name", "{{value}}"]`) und `parts` (ein argv-Eintrag aus
 * Stücken). In `parts` steht kein sauberer Schalter, sondern Text — deshalb wird
 * dort gesucht statt gelesen, und das Ergebnis ist als *unsicher* gekennzeichnet.
 */
function benutzteParameter(paket) {
    const sicher = new Set();
    const unsicher = new Set();

    for (const a of paket.start?.args || []) {
        if (typeof a.form === 'string') {
            if (a.form.startsWith('-') || a.form.startsWith('+')) sicher.add(a.form);
        } else if (Array.isArray(a.form)) {
            const erstes = a.form[0];
            if (typeof erstes === 'string' && (erstes.startsWith('-') || erstes.startsWith('+'))) sicher.add(erstes);
        }
        for (const t of a.parts || []) {
            for (const [, wort] of String(t.text).matchAll(/(?:^|\s)([-+]{1,2}[A-Za-z][\w-]*)/g)) unsicher.add(wort);
        }
    }
    for (const w of sicher) unsicher.delete(w);
    return { sicher, unsicher };
}

/** Konfigurationsschlüssel, die das Paket schreibt. */
function benutzteSchluessel(paket) {
    const raus = new Set();
    for (const s of paket.settings || []) {
        for (const z of s.apply || []) {
            if (z.target === 'file' && z.path) raus.add(z.path);
        }
    }
    return raus;
}

/** Konsolenbefehle, die das Paket tatsächlich absetzt. */
function benutzteBefehle(paket) {
    const raus = new Set();
    for (const b of Object.values(paket.commands || {})) {
        const roh = b.command || b.rcon || b.console;
        if (typeof roh === 'string') {
            const erstes = roh.trim().split(/\s+/)[0];
            if (erstes) raus.add(erstes.toLowerCase());
        }
    }
    return raus;
}

// ─────────────────────────────────────────────────────────────────────────────
// Der Abgleich
// ─────────────────────────────────────────────────────────────────────────────

function gleicheAb(referenz, paket) {
    const wegfall = [], kandidaten = [], hinweise = [];

    const felder = [
        { feld: 'start_args',       benutzt: benutzteParameter(paket), was: 'Startparameter' },
        { feld: 'config_keys',      benutzt: { sicher: benutzteSchluessel(paket), unsicher: new Set() }, was: 'Konfigurationsschlüssel' },
        { feld: 'console_commands', benutzt: { sicher: benutzteBefehle(paket),   unsicher: new Set() }, was: 'Konsolenbefehl' },
    ];

    for (const { feld, benutzt, was } of felder) {
        const eintraege = referenz[feld];
        if (!Array.isArray(eintraege)) {
            hinweise.push(`${feld}: in der Referenz nicht angelegt — das ist etwas anderes als eine leere Liste. Leer heißt "geprüft, es gibt keine".`);
            continue;
        }
        const bekannt   = new Map(eintraege.map(e => [e.name.toLowerCase(), e]));
        const abgelegt  = new Set(eintraege.filter(e => e.removed_in).map(e => e.name.toLowerCase()));

        // 1 — wir benutzen etwas, das die Referenz nicht (mehr) kennt
        for (const name of benutzt.sicher) {
            const schluessel = name.toLowerCase();
            if (!bekannt.has(schluessel)) {
                wegfall.push(`${was} "${name}" wird benutzt, steht aber nicht in der Referenz. Verdacht auf Wegfall — oder die Referenz ist unvollständig.`);
            } else if (abgelegt.has(schluessel)) {
                wegfall.push(`${was} "${name}" wird benutzt, ist laut Referenz aber seit ${bekannt.get(schluessel).removed_in} entfallen.`);
            }
        }
        for (const name of benutzt.unsicher) {
            if (!bekannt.has(name.toLowerCase())) {
                hinweise.push(`${was} "${name}" steckt in einem zusammengesetzten Argument und ist der Referenz unbekannt. Aus Text gelesen, nicht aus einer Deklaration — von Hand ansehen.`);
            }
        }

        // 2 — die Referenz kennt etwas, das wir nicht anbieten
        for (const [schluessel, eintrag] of bekannt) {
            if (eintrag.removed_in) continue;
            if (benutzt.sicher.has(eintrag.name) || benutzt.unsicher.has(eintrag.name)) continue;
            if ([...benutzt.sicher].some(n => n.toLowerCase() === schluessel)) continue;
            kandidaten.push({ was, name: eintrag.name, note: eintrag.note?.de || eintrag.note?.en || '' });
        }
    }

    return { wegfall, kandidaten, hinweise };
}

/** Wie alt ist das Wissen? */
function alter(checkedAt) {
    const dann = new Date(`${checkedAt}T00:00:00Z`);
    if (Number.isNaN(dann.getTime())) return null;
    const monate = (Date.now() - dann.getTime()) / (1000 * 60 * 60 * 24 * 30.4375);
    return Math.floor(monate * 10) / 10;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hauptlauf
// ─────────────────────────────────────────────────────────────────────────────

const argumente  = process.argv.slice(2).filter(a => !a.startsWith('--'));
const paketPfad  = (() => {
    const i = process.argv.indexOf('--paket');
    return i > -1 ? process.argv[i + 1] : null;
})();

// Ein Argument ist entweder ein Kürzel (`valheim`) oder ein Pfad — letzteres,
// damit sich eine abgewandelte Fassung gegenprüfen lässt, ohne sie ins
// Referenzverzeichnis legen zu müssen.
const pfade   = argumente.filter(a => a.endsWith('.json'));
const kuerzel = argumente.filter(a => !a.endsWith('.json'));

if (!pfade.length && !fs.existsSync(REFERENZ_PFAD)) {
    console.error(`Kein Referenzverzeichnis unter ${path.relative(WURZEL, REFERENZ_PFAD)}.`);
    process.exit(2);
}

const dateien = pfade.length ? pfade : fs.readdirSync(REFERENZ_PFAD)
    .filter(n => n.endsWith('.json'))
    .filter(n => !kuerzel.length || kuerzel.includes(path.basename(n, '.json')))
    .map(n => path.join(REFERENZ_PFAD, n));

if (!dateien.length) {
    console.error(argumente.length
        ? `Keine Referenz für: ${argumente.join(', ')}`
        : 'Noch keine Referenz angelegt. Erwartet werden Dateien unter packages/fbpkg/referenz/.');
    process.exit(2);
}

const ajv = new Ajv({ allErrors: true, jsonPointers: true });
const pruefe = ajv.compile(JSON.parse(fs.readFileSync(SCHEMA_PFAD, 'utf8')));

console.log(`\nParameter-Referenz abgleichen (${dateien.length} Spiel${dateien.length === 1 ? '' : 'e'})\n`);

let meldungen = 0;
let kandidatenGesamt = 0;

for (const datei of dateien) {
    const name = path.basename(datei);
    let referenz;
    try {
        referenz = JSON.parse(fs.readFileSync(datei, 'utf8'));
    } catch (err) {
        console.log(`✘ ${name}\n    JSON nicht lesbar: ${err.message}\n`);
        meldungen++;
        continue;
    }

    if (!pruefe(referenz)) {
        console.log(`✘ ${name}`);
        for (const e of pruefe.errors) {
            console.log(`    Schema: ${e.dataPath || '/'} ${e.message}`
                + `${e.params?.additionalProperty ? ` ("${e.params.additionalProperty}")` : ''}`);
        }
        console.log();
        meldungen++;
        continue;
    }

    const gegenstueck = paketPfad
        ? { paket: JSON.parse(fs.readFileSync(paketPfad, 'utf8')), herkunft: paketPfad, massgeblich: true }
        : suchePaket(referenz.slug);

    console.log(`── ${referenz.slug} ──`);

    // 3 — Alter
    const monate = alter(referenz.checked_at);
    if (monate === null) {
        console.log(`  ⚠ checked_at ist kein Datum: "${referenz.checked_at}"`);
        meldungen++;
    } else if (monate > MONATE_BIS_ALT) {
        console.log(`  ⚠ ALTER: zuletzt am ${referenz.checked_at} geprüft — vor ${monate} Monaten.`
            + ` Gegen die Quelle halten, bevor jemand ihr glaubt.`);
        meldungen++;
    } else {
        console.log(`  Stand ${referenz.checked_at} (vor ${monate} Monaten), ${referenz.sources.length} Quelle${referenz.sources.length === 1 ? '' : 'n'}.`);
    }

    if (!gegenstueck) {
        console.log(`  ⚠ Kein Paket zu "${referenz.slug}" gefunden — ohne Gegenstück ist kein Abgleich möglich.\n`);
        meldungen++;
        continue;
    }
    console.log(`  Gegenstück: ${gegenstueck.herkunft}`
        + `${gegenstueck.massgeblich ? '' : '  (aus dem Sammelband — unfertige Übersetzung, kein maßgebliches Paket)'}`);

    const { wegfall, kandidaten, hinweise } = gleicheAb(referenz, gegenstueck.paket);

    if (wegfall.length) {
        console.log(`\n  WEGFALL (${wegfall.length}) — wir benutzen etwas, das die Referenz nicht kennt:`);
        for (const w of wegfall) console.log(`    ! ${w}`);
        meldungen += wegfall.length;
    }

    kandidatenGesamt += kandidaten.length;
    if (kandidaten.length) {
        console.log(`\n  KANDIDATEN (${kandidaten.length}) — gäbe es, bieten wir nicht an:`);
        for (const k of kandidaten) {
            console.log(`    + ${k.was} ${k.name}${k.note ? `\n        ${k.note.slice(0, 150)}` : ''}`);
        }
        // Wo das Paket ausdrücklich "nicht unterstützt" sagt, ist der Kandidat
        // keine Lücke, sondern eine beantwortete Frage. Das gehört danebengestellt,
        // sonst steht dieselbe Zeile bei jedem Lauf wieder da und niemand weiss,
        // ob sie schon jemand angesehen hat.
        const beantwortet = Object.entries(gegenstueck.paket.commands || {})
            .filter(([, b]) => b.via === 'unsupported' && b.reason)
            .map(([gruppe, b]) => `${gruppe}: ${b.reason.de || b.reason.en}`);
        if (beantwortet.length && kandidaten.some(k => k.was === 'Konsolenbefehl')) {
            console.log(`\n    Dazu sagt das Paket bereits:`);
            for (const b of beantwortet) console.log(`      · ${b}`);
        }
    }

    if (hinweise.length) {
        console.log(`\n  HINWEISE (${hinweise.length}):`);
        for (const h of hinweise) console.log(`    · ${h}`);
    }

    if (!wegfall.length && !kandidaten.length && !hinweise.length) {
        console.log('  Paket und Referenz decken sich.');
    }
    console.log();
}

// Kandidaten sind KEINE Beanstandung. Es wird immer Parameter geben, die ein
// Spiel kann und die wir bewusst nicht anbieten — täte man sie in den
// Rückgabewert, wäre der Abgleich für immer rot und damit wertlos.
console.log(`Beanstandungen: ${meldungen} · Kandidaten: ${kandidatenGesamt}`);
if (kandidatenGesamt) {
    console.log('Kandidaten sind Vorschläge an einen Menschen, kein Fehler — nichts wird von hier');
    console.log('in den Betrieb übernommen, ohne im Paket deklariert zu sein (E-21).');
}

process.exit(meldungen ? 1 : 0);
