#!/usr/bin/env node
'use strict';

/**
 * Wächter: CPU wird nur von laufenden Servern belegt (Baustelle 54).
 *
 * ── Warum es diesen Wächter braucht ─────────────────────────────────────────
 *
 * Die Liste der Zustände, die Rechenzeit belegen, steht notwendigerweise
 * **dreimal**: als JS-Konstante (`RootServer.ZUSTAENDE_MIT_CPU`), als SQL in der
 * Migration (eine View kann keine JS-Konstante lesen) und als SQL in
 * `quotas.router.js` (die Ressourcen-Seite rechnet selbst, weil sie zusätzlich
 * je Server auflistet). Driften sie auseinander, meldet **nichts** einen Fehler:
 * die Seite zeigt eine andere Zahl als der Torwächter benutzt, und wer anlegt,
 * bekommt eine Ablehnung, die der Anzeige widerspricht.
 *
 * ── Was er prüft ────────────────────────────────────────────────────────────
 *
 *  1. Die JS-Konstante existiert und hat genau die entschiedenen fünf Zustände.
 *  2. Jede Zustandsliste im SQL (Migration, quotas.router) ist dieselbe Menge.
 *  3. Alle genannten Zustände kommen im ENUM von `gameservers.status` vor —
 *     ein Tippfehler wie 'runnning' filtert sonst lautlos alles weg.
 *  4. Der Torwächter vergleicht gegen `available_cpu_cores_running`,
 *     nicht gegen `available_cpu_cores`.
 *  5. RAM und Platte bleiben streng: ihre Summen tragen **kein** CASE.
 *  6. Das Bearbeitungsformular rechnet den eigenen Anteil nur zurück, wenn der
 *     Server läuft.
 *  7. Die Ressourcen-Seite zeigt die laufende Zahl (nicht nur die gebuchte).
 *  8. Mit Datenbank: die lebende View trägt die drei neuen Spalten und dieselbe
 *     Zustandsliste. Ohne Datenbank wird dieser Teil als übersprungen gemeldet,
 *     nicht als grün.
 *
 * Der ENUM-Abgleich (3) und die lebende View (8) brauchen die Datenbank; alles
 * andere läuft ohne.
 *
 * Aufruf:  node scripts/check-cpu-buchung.js
 * Rückgabe: 0 = alles wie entschieden, 1 = mindestens eine Abweichung.
 */

const fs   = require('fs');
const path = require('path');

const WURZEL = path.join(__dirname, '..');

const DATEIEN = {
    model:     'plugins/masterserver/dashboard/models/RootServer.js',
    migration: 'plugins/masterserver/migrations/20260921_090000_cpu_zaehlt_nur_laufende.js',
    quotas:    'plugins/masterserver/dashboard/routes/quotas.router.js',
    quotasEjs: 'plugins/masterserver/dashboard/views/guild/quotas.ejs',
    edit:      'plugins/gameserver/dashboard/routes/servers.js',
};

const ERWARTET = ['installing', 'starting', 'online', 'stopping', 'updating'];

let geprueft = 0, fehler = 0, uebersprungen = 0;

function ok(text)      { geprueft++; console.log(`  ✓ ${text}`); }
function nein(text)    { geprueft++; fehler++; console.log(`  ✘ ${text}`); }
function skip(text)    { uebersprungen++; console.log(`  – ${text} (übersprungen)`); }
function pruef(bed, text, sonst) { bed ? ok(text) : nein(sonst || text); }

function lies(schluessel) {
    const p = path.join(WURZEL, DATEIEN[schluessel]);
    if (!fs.existsSync(p)) { nein(`Datei fehlt: ${DATEIEN[schluessel]}`); return null; }
    return fs.readFileSync(p, 'utf8');
}

/**
 * Kommentare entfernen, bevor gesucht wird.
 *
 * Ohne das trifft jedes grep auch die Prosa — und genau dieser Wächter erklärt
 * seine Zustandsliste in Kommentaren. Er würde sich selbst bestätigen.
 */
function ohneKommentare(quelle) {
    return quelle
        .replace(/\/\*[\s\S]*?\*\//g, ' ')   // Blockkommentare
        .replace(/^[ \t]*\/\/.*$/gm, ' ')    // ganze Zeilenkommentare
        .replace(/<%#[\s\S]*?%>/g, ' ');     // EJS-Kommentare
}

/** Findet jede `status IN ('a','b',…)`-Liste und gibt sie als Mengen zurück. */
function zustandslisten(quelle) {
    const listen = [];
    const re = /status\s+IN\s*\(([^)]*)\)/gi;
    let m;
    while ((m = re.exec(quelle)) !== null) {
        const werte = m[1].match(/'([^']+)'/g) || [];
        listen.push(werte.map(w => w.slice(1, -1)));
    }
    return listen;
}

function gleicheMenge(a, b) {
    if (a.length !== b.length) return false;
    const sa = [...a].sort().join(','), sb = [...b].sort().join(',');
    return sa === sb;
}

(async () => {
    console.log('\nWächter: CPU-Buchung zählt nur laufende Server (B54)\n');

    // ── 1. Die JS-Konstante ─────────────────────────────────────────────────
    console.log('Die eine Liste (JS)');
    let konstante = null;
    try {
        // Direkt laden geht nicht: das Model zieht `dunebot-core` und damit den
        // ServiceManager. Die Konstante wird deshalb aus dem Quelltext gelesen —
        // das prüft zugleich, dass sie dort wörtlich steht und nicht erst zur
        // Laufzeit zusammengesetzt wird.
        const quelle = lies('model');
        if (quelle) {
            const m = ohneKommentare(quelle).match(/ZUSTAENDE_MIT_CPU\s*=\s*\[([^\]]*)\]/);
            if (!m) {
                nein('RootServer.ZUSTAENDE_MIT_CPU nicht gefunden');
            } else {
                konstante = (m[1].match(/'([^']+)'/g) || []).map(w => w.slice(1, -1));
                pruef(gleicheMenge(konstante, ERWARTET),
                    `ZUSTAENDE_MIT_CPU = ${konstante.join(', ')}`,
                    `ZUSTAENDE_MIT_CPU weicht ab: ${konstante.join(', ')} — erwartet ${ERWARTET.join(', ')}`);
            }
        }
    } catch (e) {
        nein(`Konstante nicht lesbar: ${e.message}`);
    }
    const massstab = konstante && konstante.length ? konstante : ERWARTET;

    // ── 2. Dieselbe Liste im SQL ────────────────────────────────────────────
    console.log('\nDieselbe Liste im SQL');
    for (const schluessel of ['migration', 'quotas']) {
        const quelle = lies(schluessel);
        if (!quelle) continue;
        const listen = zustandslisten(ohneKommentare(quelle));
        if (listen.length === 0) {
            nein(`${DATEIEN[schluessel]}: keine \`status IN (…)\`-Liste gefunden`);
            continue;
        }
        const abweichend = listen.filter(l => !gleicheMenge(l, massstab));
        pruef(abweichend.length === 0,
            `${DATEIEN[schluessel]}: ${listen.length} Liste(n), alle gleich`,
            `${DATEIEN[schluessel]}: ${abweichend.length} von ${listen.length} Liste(n) weichen ab `
          + `(z.B. ${abweichend[0] ? abweichend[0].join(', ') : '?'})`);
    }

    // ── 4./5./6./7. Wer welche Zahl benutzt ─────────────────────────────────
    console.log('\nWer welche Zahl benutzt');
    const model = lies('model');
    if (model) {
        const nackt = ohneKommentare(model);

        // Geprüft wird der **Vergleich**, nicht die Zeile. Die erste Fassung
        // dieses Wächters suchte `available_cpu_cores_running` irgendwo in der
        // Zeile — und blieb in der Gegenprobe grün, weil derselbe Name nebenan
        // noch in der Meldung stand, während der Vergleich schon die falsche
        // Zahl nahm. Ein Wächter, der Anwesenheit misst statt Verhalten, ist
        // schlimmer als keiner.
        const vergleich = (feld) => new RegExp(`required\\.${feld}\\s*>\\s*available\\.(\\w+)`);
        const operand = (feld) => {
            const m = nackt.match(vergleich(feld));
            return m ? m[1] : null;
        };

        const cpuOperand = operand('cpuCores');
        pruef(cpuOperand === 'available_cpu_cores_running',
            'Torwächter vergleicht CPU mit available_cpu_cores_running',
            `Torwächter vergleicht CPU mit ${cpuOperand || '(kein Vergleich gefunden)'} statt available_cpu_cores_running`);

        const ramOperand  = operand('ramMB');
        const diskOperand = operand('diskGB');
        pruef(ramOperand === 'available_ram_mb',
            'RAM bleibt streng (keine laufende Sonderzahl)',
            `RAM vergleicht mit ${ramOperand || '(kein Vergleich gefunden)'} — Überbuchung endet im OOM-Killer`);
        pruef(diskOperand === 'available_disk_gb',
            'Platte bleibt streng (Dateien liegen auch bei aus)',
            `Platte vergleicht mit ${diskOperand || '(kein Vergleich gefunden)'} — voll ist voll`);
    }

    const edit = lies('edit');
    if (edit) {
        const nackt = ohneKommentare(edit);
        pruef(/available_cpu_cores_running/.test(nackt),
            'Bearbeitungsformular bietet die laufende Zahl an',
            'Bearbeitungsformular rechnet weiter mit available_cpu_cores');
        pruef(/ZUSTAENDE_MIT_CPU\.includes\(\s*server\.status\s*\)/.test(nackt),
            'Bearbeitungsformular rechnet den eigenen Anteil nur bei laufendem Server zurück',
            'Bearbeitungsformular rechnet den eigenen CPU-Anteil unbedingt zurück — '
          + 'ein ausgeschalteter Server bekäme seine Kerne zweimal angeboten');
    }

    const quotasEjs = lies('quotasEjs');
    if (quotasEjs) {
        const nackt = ohneKommentare(quotasEjs);
        pruef(/allocated_cpu_cores_running/.test(nackt),
            'Ressourcen-Seite zeigt die laufende Zahl',
            'Ressourcen-Seite zeigt nur die gebuchte Zahl — sie widerspricht dann dem Torwächter');
        pruef(/allocated_cpu_cores\b(?!_running)/.test(nackt),
            'Ressourcen-Seite zeigt die gebuchte Zahl weiterhin daneben',
            'Ressourcen-Seite zeigt die Gesamtbuchung nicht mehr — '
          + 'dann sieht ein RootServer leer aus, dessen Kerne verplant sind');
    }

    // ── 3./8. Was nur die Datenbank sagen kann ──────────────────────────────
    console.log('\nGegen die Datenbank');
    let db = null;
    try {
        require(path.join(WURZEL, 'node_modules/dotenv'))
            .config({ path: path.join(WURZEL, 'apps/dashboard/.env'), quiet: true });
        const mysql = require(path.join(WURZEL, 'node_modules/mysql2/promise'));
        db = await mysql.createConnection({
            host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT) || 3306,
            user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
            database: process.env.MYSQL_DATABASE, connectTimeout: 4000,
        });
    } catch (e) {
        skip(`Datenbank nicht erreichbar (${e.message.split('\n')[0]}) — ENUM-Abgleich und lebende View`);
    }

    if (db) {
        try {
            const [[spalte]] = await db.query("SHOW COLUMNS FROM gameservers LIKE 'status'");
            const enumWerte = (spalte?.Type?.match(/'([^']+)'/g) || []).map(w => w.slice(1, -1));
            const unbekannt = massstab.filter(z => !enumWerte.includes(z));
            pruef(unbekannt.length === 0,
                `alle ${massstab.length} Zustände stehen im ENUM von gameservers.status`,
                `Zustände, die es im ENUM nicht gibt: ${unbekannt.join(', ')} — `
              + `sie filtern lautlos alles weg (ENUM: ${enumWerte.join(', ')})`);
        } catch (e) {
            nein(`ENUM nicht lesbar: ${e.message}`);
        }

        try {
            const [[view]] = await db.query('SHOW CREATE VIEW rootserver_resource_summary');
            const sql = view['Create View'];
            for (const spalte of ['allocated_cpu_cores_running', 'available_cpu_cores_running', 'cpu_usage_percent_running']) {
                pruef(sql.includes(spalte),
                    `lebende View trägt ${spalte}`,
                    `lebende View trägt ${spalte} NICHT — Migration 20260921_090000 ist nicht gelaufen `
                  + `(sie kommt mit dem Dashboard-Neustart)`);
            }
            const listen = zustandslisten(sql);
            pruef(listen.length > 0 && listen.every(l => gleicheMenge(l, massstab)),
                `lebende View benutzt dieselbe Zustandsliste (${listen.length} Stellen)`,
                'lebende View benutzt eine andere Zustandsliste als der Code');
        } catch (e) {
            nein(`View nicht lesbar: ${e.message}`);
        }
        await db.end();
    }

    // ── Ergebnis ────────────────────────────────────────────────────────────
    console.log(`\n${fehler === 0 ? '✓' : '✘'} ${geprueft - fehler} von ${geprueft} Prüfungen bestanden`
              + `${uebersprungen ? `, ${uebersprungen} übersprungen` : ''}`);
    if (fehler === 0 && uebersprungen === 0) {
        console.log('  CPU belegt die Maschine nur, solange ein Server läuft — '
                  + 'RAM und Platte bleiben streng gebucht.\n');
    } else if (fehler === 0) {
        console.log('  Was messbar war, stimmt. Die übersprungenen Punkte sind NICHT geprüft.\n');
    } else {
        console.log('');
    }
    process.exit(fehler === 0 ? 0 : 1);
})();
