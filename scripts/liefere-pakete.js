#!/usr/bin/env node
'use strict';

/**
 * Pakete einliefern — aus `packages/fbpkg/beispiele/` in die Datenbank.
 *
 * Zug 0 von Stufe 5: Damit das Dashboard ein Paket mitschicken kann, muss es
 * eines haben. Dieses Werkzeug legt die Handpakete in `packages` (Identität) und
 * `package_versions` (Inhalt) ab.
 *
 * ── Warum die Prüfung als Aufruf und nicht als Import ────────────────────────
 *
 * `check-pakete.js` ist ein Kommandozeilenwerkzeug: Es arbeitet beim Laden
 * sofort los und beendet den Prozess. Es zu importieren hiesse, es erst
 * umzubauen — und ein zweites Prüfwerkzeug daneben zu stellen wäre die
 * schlechtere Wahl (zwei Definitionen von „gültig" driften auseinander, das
 * kostete uns beim Übersetzer schon einmal einen Tag). Also wird es als
 * Werkzeug aufgerufen und sein Rückgabewert ist das Tor. Dieselbe Prüfung,
 * nachweislich, ohne Kopie.
 *
 * ── Warum Fassungen unveränderlich sind ─────────────────────────────────────
 *
 * `package_versions` ist ein Stand, keine Akte (deshalb hat die Tabelle kein
 * `updated_at`). Liegt eine Fassung mit derselben Nummer, aber anderem Inhalt
 * vor, wird NICHT überschrieben, sondern abgewiesen: Ein Server, der laut
 * Protokoll mit 1.0.0 lief, muss 1.0.0 auch später noch lesen können. Wer etwas
 * ändert, erhöht die Nummer.
 *
 * ── Warum die Kennung übernommen wird ───────────────────────────────────────
 *
 * `packages.id` bekommt, wo es geht, DIESELBE Nummer wie die Zeile in
 * `addon_marketplace`. Das ist keine Kosmetik: `addon_ratings`,
 * `addon_comments` und `addon_favorites` zeigen auf `addon_marketplace.id`, und
 * eine Bewertung gilt dem Spielpaket, nicht der Fassung 1.0.0. Werden die
 * Kennungen übernommen, ziehen sie beim Schnitt (Stufe 6) einfach mit um,
 * statt zu zerfallen — genau so steht es in der Migration 20260816_120000
 * begründet.
 *
 * Heute sind alle drei Tabellen leer, es gibt also nichts zu retten. Aber die
 * Kennung später anzugleichen hiesse, Fremdschlüssel auf lebende Daten zu
 * verbiegen. Jetzt kostet es eine Zeile.
 *
 * Gibt es keine Entsprechung in `addon_marketplace` (ein Paket, das die
 * Werkbank erzeugt hat), vergibt die Datenbank die Nummer wie sonst auch.
 *
 * ── Kanal ───────────────────────────────────────────────────────────────────
 *
 * Eingeliefert wird nach `test`. `stable` verlangt nach E-17 zwei Dinge, die
 * dieses Werkzeug nicht vergeben kann: einen bestandenen Prüfdurchlauf
 * (`test_passed_at`) und die Freigabe des Betreibers (`released_at`).
 *
 * ── Seit 2026-09-24: der Kern steht in packages/fbpkg/lib/einlieferung.js ──
 *
 * Anker, Fassung, Kanal und das Tor (check-pakete.js) leben dort, samt ihrer
 * Begründungen — die Werkbank liefert über denselben Weg ein (Entscheidung 2b
 * des Betreibers: nur, wenn dieser Weg dadurch nicht blockiert wird). Belegt:
 * derselbe Probelauf vor und nach dem Umbau, Zeile für Zeile gleich. Hier
 * bleibt, was nur die Kommandozeile braucht: Dateien sammeln, zählen, melden.
 *
 * Aufruf:
 *   node scripts/liefere-pakete.js                  # Probelauf, schreibt nichts
 *   node scripts/liefere-pakete.js --wirklich       # schreibt
 *   node scripts/liefere-pakete.js pfad/zu.json --wirklich
 */

require('dotenv').config({ path: require('path').join(__dirname, '../apps/dashboard/.env') });

const fs    = require('fs');
const path  = require('path');
const mysql = require('mysql2/promise');
const einlieferung = require('../packages/fbpkg/lib/einlieferung');

const WURZEL     = path.join(__dirname, '..');
const BEISPIELE  = path.join(WURZEL, 'packages/fbpkg/beispiele');

const args      = process.argv.slice(2);
const WIRKLICH  = args.includes('--wirklich');
const dateien   = args.filter(a => !a.startsWith('--'));
// Nur noetig, wenn `addon_marketplace` leer ist — sonst nimmt `sichereAnker`
// den Autor, den die vorhandenen Zeilen benutzen.
const AUTOR     = (args.find(a => a.startsWith('--autor=')) || '').slice('--autor='.length) || null;

function sammleDateien() {
    if (dateien.length) return dateien.map(d => path.resolve(d));
    if (!fs.existsSync(BEISPIELE)) return [];
    return fs.readdirSync(BEISPIELE)
        .filter(f => f.endsWith('.json'))
        .map(f => path.join(BEISPIELE, f));
}

(async () => {
    const alle = sammleDateien();
    if (!alle.length) {
        console.error('Keine Pakete gefunden. Pfad angeben oder Dateien unter '
                    + 'packages/fbpkg/beispiele/ ablegen.');
        process.exit(2);
    }

    console.log(`\nPakete einliefern — ${alle.length} Datei${alle.length === 1 ? '' : 'en'}`
              + `${WIRKLICH ? '' : '  (PROBELAUF — es wird nichts geschrieben)'}\n`);

    const verbindung = await mysql.createConnection({
        host:     process.env.MYSQL_HOST,
        port:     Number(process.env.MYSQL_PORT) || 3306,
        user:     process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE,
    });
    const db = einlieferung.fuerVerbindung(verbindung);

    let neu = 0, unveraendert = 0, abgewiesen = 0, ankerNeu = 0;

    try {
        for (const datei of alle) {
            const kurz = path.basename(datei);

            const tor = einlieferung.bestehtPruefung(datei);
            if (!tor.ok) {
                console.log(`✘ ${kurz}\n    Prüfung nicht bestanden — nicht eingeliefert.`);
                for (const z of einlieferung.grundZeilen(tor.text)) console.log(`    ${z}`);
                abgewiesen++;
                continue;
            }

            const paket = JSON.parse(fs.readFileSync(datei, 'utf8'));
            const r = await einlieferung.liefereEin(db, paket, {
                wirklich: WIRKLICH, etikett: kurz, autor: AUTOR, log: (z) => console.log(z),
            });
            if (r.ankerNeu) ankerNeu++;
            if (r.art === 'neu') neu++;
            else if (r.art === 'unveraendert') unveraendert++;
            else abgewiesen++;
        }
    } finally {
        await verbindung.end();
    }

    console.log(`\nNeu: ${neu} · unverändert: ${unveraendert} · abgewiesen: ${abgewiesen}`
              + (ankerNeu ? ` · Ankersätze fehlten: ${ankerNeu}` : ''));
    // Auch ein fehlender Anker ist etwas zu tun — sonst sagt der Probelauf
    // „unverändert: 1" und klingt wie „alles in Ordnung", während sich der
    // Server nicht anlegen lässt.
    if (!WIRKLICH && (neu || ankerNeu)) {
        console.log('Das war ein Probelauf. Mit --wirklich wird geschrieben.');
    }
    process.exit(abgewiesen ? 1 : 0);
})().catch(e => { console.error('FEHLER:', e.message); process.exit(1); });
