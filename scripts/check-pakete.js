#!/usr/bin/env node
/**
 * Prüft Spielpakete gegen das Schema FBPKG_v1 — und gegen die Invarianten.
 *
 * Warum beides: Ein Schema fängt Form ab, keine Bedeutung. Ein Paket kann
 * schemakonform sein und trotzdem auf eine Einstellung zeigen, die es nicht
 * gibt, oder auf einen Port, den niemand vergibt. Genau solche Verweise sind in
 * der alten Welt reihenweise ins Leere gelaufen, ohne dass etwas fehlschlug —
 * der Server startete einfach anders als gedacht.
 *
 * Geprüft werden:
 *
 *   SCHEMA      packages/fbpkg/schema/fbpkg-v1.schema.json
 *   I2          Kein Paket nennt eine Portnummer (das Schema verbietet das Feld;
 *               hier zusätzlich: jede Beziehung `x+N` zeigt auf einen echten Zweck)
 *   I7          Der Startbefehl ist eine Parameterliste, keine Zeichenkette
 *   VERWEISE    setting:/port:/content: zeigen auf etwas, das es gibt
 *   BEFUND      status.complete=false verlangt mindestens einen offenen Punkt,
 *               und ein `script`-Schritt (der Notausgang) muss dort auftauchen
 *
 *   node scripts/check-pakete.js                  # alle Beispielpakete
 *   node scripts/check-pakete.js pfad/zum/paket.json
 *   node scripts/check-pakete.js docs/spielpakete/bestand/uebersetzung-*.json
 *   node scripts/check-pakete.js … --alles        # auch bei Sammelbänden jeden offenen Punkt
 *
 * Der Sammelband des Übersetzers wird erkannt und aufgeklappt. Das ist kein
 * Zubehör: Solange die 273 übersetzten Pakete nur im Sammelband lagen und dieses
 * Werkzeug bloss Einzeldateien las, hat die strengere der beiden Prüfungen sie nie
 * gesehen — I7 hätte die Shell-Reste vom ersten Tag an gemeldet (2026-08-16).
 *
 * Rückgabewert 0 = alles sauber, 1 = mindestens ein Verstoß.
 *
 * @author FireDervil
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const Ajv  = require('ajv');

const SCHEMA_PFAD    = path.join(__dirname, '../packages/fbpkg/schema/fbpkg-v1.schema.json');
const BEISPIEL_PFAD  = path.join(__dirname, '../packages/fbpkg/beispiele');

// ─────────────────────────────────────────────────────────────────────────────
// Invarianten — was das Schema nicht sehen kann
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Prüft die Bedeutungsebene eines Pakets.
 * @returns {{verstoesse: string[], hinweise: string[]}}
 */
function pruefeInvarianten(paket) {
    const verstoesse = [];
    const hinweise   = [];

    const zwecke      = new Set((paket.ports || []).map(p => p.purpose));
    const einstellung = new Set((paket.settings || []).map(s => s.key));

    // ── I2: Beziehungen zwischen Ports müssen auflösbar sein ────────────────
    for (const p of paket.ports || []) {
        const bezug = /^([a-z][a-z0-9_]*)\+([0-9]+)$/.exec(p.assign || '');
        if (!bezug) continue;
        if (!zwecke.has(bezug[1])) {
            verstoesse.push(`I2: Port "${p.purpose}" bezieht sich auf "${bezug[1]}+${bezug[2]}", aber den Zweck "${bezug[1]}" gibt es nicht.`);
        }
        if (bezug[1] === p.purpose) {
            verstoesse.push(`I2: Port "${p.purpose}" bezieht sich auf sich selbst.`);
        }
    }

    // ── I7: Startbefehl ist eine Liste, keine Zeile ─────────────────────────
    if (typeof paket.start?.program === 'string' && /[\s|&><$`]/.test(paket.start.program)) {
        verstoesse.push(`I7: start.program enthält Leerzeichen oder Shell-Zeichen ("${paket.start.program}") — Programm und Argumente gehören getrennt.`);
    }
    for (const a of paket.start?.args || []) {
        const formen = a.parts
            ? a.parts.map(t => t.text)
            : (Array.isArray(a.form) ? a.form : [a.form]);
        for (const f of formen) {
            if (typeof f === 'string' && /[|&><`]|\$\(/.test(f)) {
                verstoesse.push(`I7: Parameter "${a.key}" enthält Shell-Zeichen ("${f}") — dafür ist kein Platz mehr, es gibt keine Shell.`);
            }
        }
    }

    // ── Verweise in zusammengesetzten Argumenten ({{setting:x}}, {{port:y}}) ─
    // Sie stehen im Text und bleiben trotzdem prüfbar — das ist der Grund, warum
    // `parts` einer freien Zeichenkette vorzuziehen ist.
    for (const a of paket.start?.args || []) {
        for (const teil of a.parts || []) {
            for (const [, art, ziel] of String(teil.text).matchAll(/\{\{(setting|port|content):([a-z0-9_]+)\}\}/g)) {
                if (art === 'setting' && !einstellung.has(ziel)) {
                    verstoesse.push(`Verweis: Parameter "${a.key}" verweist auf setting:${ziel} — diese Einstellung gibt es nicht.`);
                }
                if (art === 'port' && !zwecke.has(ziel)) {
                    verstoesse.push(`Verweis: Parameter "${a.key}" verweist auf port:${ziel} — diesen Portzweck gibt es nicht.`);
                }
            }
            const roh = String(teil.text).match(/\{\{([A-Z][A-Z0-9_]*)\}\}/);
            if (roh) {
                verstoesse.push(`Verweis: Parameter "${a.key}" enthält den unaufgelösten Platzhalter {{${roh[1]}}} — Verweise müssen {{setting:…}} oder {{port:…}} lauten.`);
            }
        }
    }

    // ── Verweise: zeigt from: auf etwas, das es gibt? ────────────────────────
    for (const a of paket.start?.args || []) {
        if (a.parts) continue;
        const [art, ziel] = String(a.from || '').split(':');
        if (art === 'setting' && !einstellung.has(ziel)) {
            verstoesse.push(`Verweis: Parameter "${a.key}" nimmt seinen Wert aus setting:${ziel} — diese Einstellung gibt es nicht.`);
        }
        if (art === 'port' && !zwecke.has(ziel)) {
            verstoesse.push(`Verweis: Parameter "${a.key}" nimmt seinen Wert aus port:${ziel} — diesen Portzweck gibt es nicht.`);
        }
        if (art === 'content' && !paket.content?.supported) {
            verstoesse.push(`Verweis: Parameter "${a.key}" nutzt content:${ziel}, aber das Paket erklärt content.supported = false.`);
        }
    }

    for (const feld of ['query', 'rcon']) {
        const zweck = paket.management?.[feld]?.port;
        if (zweck && !zwecke.has(zweck)) {
            verstoesse.push(`Verweis: management.${feld} zeigt auf den Portzweck "${zweck}", den es nicht gibt.`);
        }
    }
    const bereitPort = paket.start?.ready_when?.port;
    if (bereitPort && !zwecke.has(bereitPort)) {
        verstoesse.push(`Verweis: start.ready_when.port zeigt auf "${bereitPort}", diesen Zweck gibt es nicht.`);
    }

    // ── Einstellungen: Ziel muss vollständig beschrieben sein ────────────────
    for (const s of paket.settings || []) {
        for (const z of s.apply || []) {
            if (z.target === 'file' && !(z.file && z.parser && z.path)) {
                verstoesse.push(`Einstellung "${s.key}": Ziel "file" braucht file, parser und path.`);
            }
            if (z.target === 'env' && !z.variable) {
                verstoesse.push(`Einstellung "${s.key}": Ziel "env" braucht eine variable.`);
            }
            if (z.target === 'rcon' && !z.command) {
                verstoesse.push(`Einstellung "${s.key}": Ziel "rcon" braucht ein command.`);
            }
            if (z.target === 'arg') {
                const benutzt = (paket.start?.args || []).some(a =>
                    a.from === `setting:${s.key}` ||
                    (a.parts || []).some(t => String(t.text).includes(`{{setting:${s.key}}}`))
                );
                if (!benutzt) {
                    verstoesse.push(`Einstellung "${s.key}": Ziel "arg", aber kein Startparameter holt sie über setting:${s.key}. Sie wirkt nirgends.`);
                }
            }
        }
        if (!s.apply || s.apply.length === 0) {
            hinweise.push(`Einstellung "${s.key}" hat kein Ziel — sie lässt sich ausfüllen und bewirkt nichts.`);
        }
        if (s.type === 'choice' && !(s.choices || []).length) {
            verstoesse.push(`Einstellung "${s.key}": type "choice" ohne choices.`);
        }
        if (s.risk === 'world_reset' && s.role === 'player') {
            hinweise.push(`Einstellung "${s.key}" kann die Welt zurücksetzen, ist aber für die Rolle "player" freigegeben.`);
        }
    }

    // ── Rcon deklariert, aber kein Port dafür ────────────────────────────────
    const nutztRcon = Object.values(paket.commands || {}).some(c => c.via === 'rcon');
    if (nutztRcon && !paket.management?.rcon) {
        verstoesse.push(`Befehle laufen über rcon, aber management.rcon fehlt — es ist nicht beschrieben, wohin die Verbindung geht.`);
    }

    // ── Befund: Ehrlichkeit ist Pflicht ──────────────────────────────────────
    if (paket.status?.complete === false && !(paket.status.open || []).length) {
        verstoesse.push(`Befund: complete = false, aber kein offener Punkt genannt. Was fehlt denn?`);
    }
    if (paket.status?.complete === true && (paket.status.open || []).length) {
        verstoesse.push(`Befund: complete = true, obwohl ${paket.status.open.length} Punkte offen sind.`);
    }
    const hatSkript = (paket.install?.steps || []).some(s => s.type === 'script');
    if (hatSkript) {
        const erwaehnt = (paket.status?.open || []).some(t => /script|notausgang/i.test(t));
        if (!erwaehnt) {
            verstoesse.push(`Befund: Das Paket benutzt den Notausgang (install-Schritt "script"), erwähnt ihn aber nicht unter status.open.`);
        }
    }

    // ── Zweisprachigkeit: was fehlt auf Englisch? ────────────────────────────
    let ohneEnglisch = 0;
    (function suche(o) {
        if (!o || typeof o !== 'object') return;
        if (typeof o.de === 'string' && !o.en) { ohneEnglisch++; return; }
        for (const w of Object.values(o)) suche(w);
    })(paket);
    if (ohneEnglisch) {
        hinweise.push(`${ohneEnglisch} Text${ohneEnglisch === 1 ? '' : 'e'} ohne englische Fassung — die Oberfläche zeigt dort Deutsch.`);
    }

    return { verstoesse, hinweise };
}

// ─────────────────────────────────────────────────────────────────────────────
// Hauptlauf
// ─────────────────────────────────────────────────────────────────────────────

const schema = JSON.parse(fs.readFileSync(SCHEMA_PFAD, 'utf8'));
const ajv    = new Ajv({ allErrors: true, jsonPointers: true });
let pruefe;
try {
    pruefe = ajv.compile(schema);
} catch (err) {
    console.error(`Das Schema selbst ist fehlerhaft: ${err.message}`);
    process.exit(2);
}

const argumente     = process.argv.slice(2).filter(a => !a.startsWith('--'));
const AUSFUEHRLICH  = process.argv.includes('--alles');
const dateien = argumente.length
    ? argumente
    : (fs.existsSync(BEISPIEL_PFAD)
        ? fs.readdirSync(BEISPIEL_PFAD).filter(n => n.endsWith('.json')).map(n => path.join(BEISPIEL_PFAD, n))
        : []);

if (!dateien.length) {
    console.error('Keine Pakete gefunden. Pfad angeben oder Beispiele unter packages/fbpkg/beispiele/ ablegen.');
    process.exit(2);
}

/**
 * Eine Datei enthält entweder ein Paket — oder den Sammelband des Übersetzers.
 * @returns {Array<{name: string, paket: object}>}
 */
function ladePakete(datei) {
    const inhalt = JSON.parse(fs.readFileSync(datei, 'utf8'));
    if (Array.isArray(inhalt.pakete)) {
        return inhalt.pakete.map(e => ({
            name: `${e.paket?.identity?.slug || '?'} (${e.quelle})`,
            paket: e.paket,
        }));
    }
    return [{ name: path.basename(datei), paket: inhalt }];
}

const eintraege = [];
let unlesbar = 0;
for (const datei of dateien) {
    try {
        eintraege.push(...ladePakete(datei));
    } catch (err) {
        console.log(`✘ ${path.basename(datei)}\n    JSON nicht lesbar: ${err.message}`);
        unlesbar++;
    }
}

// Bei einem Sammelband würde jede offene Stelle den Bericht unlesbar machen.
// Verstöße erscheinen immer — sie sind der Grund, warum es dieses Werkzeug gibt.
const KNAPP = eintraege.length > 20 && !AUSFUEHRLICH;

console.log(`\nSpielpakete prüfen — Schema FBPKG_v1 (${eintraege.length} Paket${eintraege.length === 1 ? '' : 'e'}`
    + `${KNAPP ? ', knapp — mit --alles auch die offenen Punkte' : ''})\n`);

let fehlerhaft = unlesbar;
let unvollstaendig = 0;

for (const { name, paket } of eintraege) {
    const schemaOk = pruefe(paket);
    const { verstoesse, hinweise } = pruefeInvarianten(paket);

    const schemaFehler = schemaOk ? [] : pruefe.errors.map(e =>
        `Schema: ${e.dataPath || '/'} ${e.message}${e.params?.additionalProperty ? ` ("${e.params.additionalProperty}")` : ''}`
    );

    const alleFehler = [...schemaFehler, ...verstoesse];
    const offen      = paket.status?.open || [];

    if (alleFehler.length) {
        fehlerhaft++;
        console.log(`✘ ${name}`);
        for (const f of alleFehler) console.log(`    ${f}`);
    } else {
        if (!paket.status?.complete) unvollstaendig++;
        if (KNAPP) continue;
        console.log(`${paket.status?.complete ? '✔' : '○'} ${name.padEnd(24)} ${paket.identity?.name || '?'} `
            + `— ${(paket.ports || []).length} Ports, ${(paket.settings || []).length} Einstellungen, `
            + `${Object.keys(paket.commands || {}).length} Befehle`);
    }

    if (!KNAPP) {
        for (const h of hinweise) console.log(`    ⚠ ${h}`);
        if (offen.length) {
            console.log(`    offen (${offen.length}):`);
            for (const o of offen) console.log(`      · ${o}`);
        }
    }
    console.log();
}

console.log(`Geprüft: ${eintraege.length} · fehlerhaft: ${fehlerhaft} · unvollständig: ${unvollstaendig}`);
if (!fehlerhaft && unvollstaendig) {
    console.log('Unvollständig heisst nicht kaputt — es heisst, das Paket sagt selbst, was ihm fehlt.');
}

process.exit(fehlerhaft ? 1 : 0);
