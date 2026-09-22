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
 * Aufruf:
 *   node scripts/liefere-pakete.js                  # Probelauf, schreibt nichts
 *   node scripts/liefere-pakete.js --wirklich       # schreibt
 *   node scripts/liefere-pakete.js pfad/zu.json --wirklich
 */

require('dotenv').config({ path: require('path').join(__dirname, '../apps/dashboard/.env') });

const fs           = require('fs');
const path         = require('path');
const crypto       = require('crypto');
const { execFileSync } = require('child_process');
const mysql        = require('mysql2/promise');

const WURZEL     = path.join(__dirname, '..');
const BEISPIELE  = path.join(WURZEL, 'packages/fbpkg/beispiele');
const PRUEFER    = path.join(__dirname, 'check-pakete.js');

const args      = process.argv.slice(2);
const WIRKLICH  = args.includes('--wirklich');
const dateien   = args.filter(a => !a.startsWith('--'));
// Nur noetig, wenn `addon_marketplace` leer ist — sonst nimmt `sichereAnker`
// den Autor, den die vorhandenen Zeilen benutzen.
const AUTOR     = (args.find(a => a.startsWith('--autor=')) || '').slice('--autor='.length) || null;

// ── Die Kategorien, die `packages.category` kennt ────────────────────────────
// Was das Paket sonst nennt, landet auf 'other' — mit Meldung, nicht stumm.
const KATEGORIEN = new Set(['fps','survival','sandbox','mmorpg','racing',
                            'strategy','horror','scifi','other']);

function sammleDateien() {
    if (dateien.length) return dateien.map(d => path.resolve(d));
    if (!fs.existsSync(BEISPIELE)) return [];
    return fs.readdirSync(BEISPIELE)
        .filter(f => f.endsWith('.json'))
        .map(f => path.join(BEISPIELE, f));
}

/** Das Tor: dieselbe Prüfung wie überall. Rückgabewert 0 oder nichts geht rein. */
/**
 * Die Zeilen, die den GRUND nennen — nicht die letzten sechs.
 *
 * ── Der Fehler, gegen den das hier steht (2026-08-31) ────────────────────────
 *
 * Hier stand `tor.text.split('\n').slice(-6)`. Der Prüfer schreibt aber zuerst
 * die Beanstandungen und DANACH die Liste der offenen Punkte aus `status.open`.
 * Bei einem Paket mit neun offenen Punkten zeigte die Abweisung also neun
 * Zeilen Prosa und verschluckte die eine Zeile, die zählt:
 *
 *     Schema: /image should have required property 'digest'
 *
 * Der Betreiber sah eine Begründung, die keine war — offene Punkte sind
 * ausdrücklich KEIN Ablehnungsgrund, unvollständige Pakete werden eingeliefert.
 * Eine Ausgabe, die wie eine Erklärung aussieht und die Ursache verbirgt, ist
 * schlechter als gar keine.
 *
 * Gesucht werden deshalb die Zeilen, die eine Beanstandung tragen; nur wenn
 * keine gefunden wird, gibt es den Anfang der Ausgabe als Notnagel.
 */
function grundZeilen(text) {
    const zeilen = text.split('\n');
    const treffer = zeilen.filter(z => /Schema:|✘|Fehler|fehlt|ungültig|ungueltig/i.test(z));
    return treffer.length ? treffer.slice(0, 8) : zeilen.slice(0, 8);
}

function bestehtPruefung(datei) {
    try {
        execFileSync('node', [PRUEFER, datei], { stdio: 'pipe' });
        return { ok: true };
    } catch (err) {
        const text = (err.stdout?.toString() || '') + (err.stderr?.toString() || '');
        return { ok: false, text: text.trim() };
    }
}

/**
 * Der Text, der in der Datenbank landet — und über den die Prüfsumme geht.
 *
 * Beides über DENSELBEN String, sonst prüft die Summe etwas anderes als
 * gespeichert ist. Genau daran erkennt man später eine stille Änderung.
 */
function dokumentUndSumme(paket) {
    const text  = JSON.stringify(paket);
    const summe = 'sha256:' + crypto.createHash('sha256').update(text, 'utf8').digest('hex');
    return { text, summe };
}

/**
 * Den Ankersatz in `addon_marketplace` sicherstellen — und warum es ihn braucht.
 *
 * ── Der Befund vom 2026-09-22 ───────────────────────────────────────────────
 *
 * Minecraft lag als Paket in `packages` (Kennung 1473) und hatte KEINE Zeile in
 * `addon_marketplace`. Der Betreiber wollte einen Server anlegen und kam nicht
 * durch Schritt 2: Die Spielwahl listet PAKETE, der naechste Schritt sucht aber
 * `addon_marketplace WHERE slug = ?` — und fand nichts.
 *
 * Es haette auch nichts genuetzt, das zu umgehen:
 * `gameservers.addon_marketplace_id` traegt einen Fremdschluessel auf
 * `addon_marketplace.id` (`gameservers_ibfk_2`). **Ohne Ankersatz laesst sich
 * kein Server dieses Spiels ueberhaupt anlegen.** Die POST-Route sagt es selbst:
 * „Die Addon-Zeile ist jetzt nur noch der Fremdschluessel, an dem der Server
 * haengt; gelesen wird aus dem Paket."
 *
 * Der Kopf dieser Datei kannte den Fall („ein Paket, das die Werkbank erzeugt
 * hat") und liess die Datenbank die Nummer vergeben. Gemessen wurde nie, was
 * danach passiert — das ist der Fehler, nicht die Zeile.
 *
 * ── Warum der Anker aus dem Paket kommt und nicht daneben ───────────────────
 *
 * Name, Beschreibung und Kategorie stehen im Paket. Der Anker schreibt sie ab,
 * er erfindet nichts: eine abgeleitete Zeile, keine zweite Wahrheit. `game_data`
 * bleibt leer (`{}`), denn dort stand das Egg — dieser Weg ist seit dem
 * 2026-09-10 entfallen, und ein leeres Objekt ist ehrlicher als eine Kopie des
 * Pakets in einem alten Format. NULL darf es nicht sein (NOT NULL), also `{}`.
 *
 * Der Autor wird nicht geraten: Genommen wird der, den die vorhandenen Zeilen
 * benutzen (heute alle 25 dieselbe Kennung). Ist die Tabelle leer, bricht das
 * Werkzeug ab und verlangt `--autor=<discord-id>` — eine erfundene Kennung waere
 * ein Datensatz, der auf niemanden zeigt.
 *
 * @returns {Promise<number|null>} Kennung des Ankers, oder null im Probelauf
 */
async function sichereAnker(db, { slug, name, besch, kategorie, version }, wirklich, autorVorgabe) {
    const [[anker]] = await db.query(
        'SELECT id FROM addon_marketplace WHERE slug = ?', [slug]);
    if (anker) return anker.id;

    // Gibt es das Paket schon, MUSS der Anker dessen Kennung bekommen: Das Haus
    // sucht das Paket ueber `packages.id = addon_marketplace.id`
    // (`ladePaketFuerAddon`). Eine neue Nummer waere ein zweiter Anker daneben.
    const [[paketZeile]] = await db.query('SELECT id FROM packages WHERE slug = ?', [slug]);
    const kennung = paketZeile ? paketZeile.id : null;

    let autor = autorVorgabe;
    if (!autor) {
        const [[haus]] = await db.query(
            `SELECT author_user_id FROM addon_marketplace
              GROUP BY author_user_id ORDER BY COUNT(*) DESC LIMIT 1`);
        autor = haus ? haus.author_user_id : null;
    }
    if (!autor) {
        throw new Error('Kein Autor: `addon_marketplace` ist leer und `--autor=<discord-id>` fehlt.');
    }

    console.log(`    \u2691 Ankersatz in addon_marketplace fehlt \u2014 wird angelegt`
              + `${kennung ? ` mit Kennung ${kennung} (die des Pakets)` : ' (neue Kennung)'}`
              + `, Autor ${autor}.`);
    console.log('      Ohne ihn l\u00e4sst sich kein Server dieses Spiels anlegen:'
              + ' gameservers.addon_marketplace_id ist ein Fremdschl\u00fcssel.');

    if (!wirklich) return null;

    const spalten = ['name', 'slug', 'description', 'author_user_id', 'visibility', 'status',
                     'game_data', 'category', 'version'];
    const werte   = [name, slug, besch, autor, 'public', 'approved', '{}', kategorie,
                     version || null];
    if (kennung) { spalten.unshift('id'); werte.unshift(kennung); }
    await db.query(
        `INSERT INTO addon_marketplace (${spalten.join(', ')})
         VALUES (${spalten.map(() => '?').join(', ')})`, werte);
    const [[neuerAnker]] = await db.query(
        'SELECT id FROM addon_marketplace WHERE slug = ?', [slug]);
    return neuerAnker ? neuerAnker.id : null;
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

    const db = await mysql.createConnection({
        host:     process.env.MYSQL_HOST,
        port:     Number(process.env.MYSQL_PORT) || 3306,
        user:     process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE,
    });

    let neu = 0, unveraendert = 0, abgewiesen = 0, ankerNeu = 0;

    try {
        for (const datei of alle) {
            const kurz = path.basename(datei);

            const tor = bestehtPruefung(datei);
            if (!tor.ok) {
                console.log(`✘ ${kurz}\n    Prüfung nicht bestanden — nicht eingeliefert.`);
                for (const z of grundZeilen(tor.text)) console.log(`    ${z}`);
                abgewiesen++;
                continue;
            }

            const paket = JSON.parse(fs.readFileSync(datei, 'utf8'));
            const id    = paket.identity || {};
            if (!id.slug || !id.version) {
                console.log(`✘ ${kurz}\n    identity.slug oder identity.version fehlt.`);
                abgewiesen++;
                continue;
            }

            let kategorie = id.category || 'other';
            if (!KATEGORIEN.has(kategorie)) {
                console.log(`  ⚠ ${kurz}: Kategorie "${kategorie}" kennt die Tabelle nicht — 'other'.`);
                kategorie = 'other';
            }

            const { text, summe } = dokumentUndSumme(paket);
            const name  = id.name || id.slug;
            const besch = typeof id.description === 'object'
                        ? (id.description.de || id.description.en || null)
                        : (id.description || null);

            // ── Der Ankersatz, VOR der Fassungspruefung ──────────────────────
            //
            // Vor der Pruefung und nicht danach: Ein Paket, das schon liegt
            // (gleiche Nummer, gleicher Inhalt), springt unten per `continue`
            // heraus — und genau das war der Zustand von Minecraft am
            // 2026-09-22: Paket da, Anker fehlt, Server nicht anlegbar. Wer den
            // Anker erst beim Einliefern einer NEUEN Fassung setzt, reicht dem
            // Betreiber eine Nummer zum Hochzaehlen, um einen Satz nachzutragen.
            //
            // Ausserhalb der Transaktion unten: Der Anker muss auch dann
            // entstehen, wenn es an der Fassung nichts zu tun gibt.
            const vorher = await db.query(
                'SELECT id FROM addon_marketplace WHERE slug = ?', [id.slug]);
            const ankerId = await sichereAnker(
                db, { slug: id.slug, name, besch, kategorie, version: id.version },
                WIRKLICH, AUTOR);
            if (!vorher[0].length) ankerNeu++;

            // ── Gibt es die Fassung schon? ───────────────────────────────────
            const [[vorhanden]] = await db.query(
                `SELECT pv.id, pv.checksum, pv.channel
                   FROM package_versions pv
                   JOIN packages p ON p.id = pv.package_id
                  WHERE p.slug = ? AND pv.version = ?`, [id.slug, id.version]);

            if (vorhanden) {
                if (vorhanden.checksum === summe) {
                    console.log(`= ${kurz.padEnd(20)} ${id.slug} ${id.version} liegt bereits `
                              + `unverändert vor (${vorhanden.channel})`);
                    unveraendert++;
                } else {
                    console.log(`✘ ${kurz}\n    ${id.slug} ${id.version} liegt bereits mit ANDEREM `
                              + `Inhalt vor.\n    Eine Fassung ist ein Stand, keine Akte — `
                              + `erhöhe die Nummer, statt sie zu überschreiben.`);
                    abgewiesen++;
                }
                continue;
            }

            const offen = (paket.status?.open || []).length;
            const hinweis = paket.status?.complete ? 'vollständig'
                          : `${offen} offene${offen === 1 ? 'r' : ''} Punkt${offen === 1 ? '' : 'e'}`;
            const [[vorgaenger]] = await db.query(
                'SELECT id FROM addon_marketplace WHERE slug = ?', [id.slug]);
            console.log(`+ ${kurz.padEnd(20)} ${id.slug} ${id.version} → Kanal test  (${hinweis})`);
            console.log(`    ${summe.slice(0, 26)}…  ${text.length.toLocaleString('de-DE')} Zeichen`
                      + (vorgaenger ? `  ·  Kennung ${vorgaenger.id} vom Vorgänger übernommen` : ''));

            if (!WIRKLICH) { neu++; continue; }

            // Die Kennung des Ankers übernehmen — `sichereAnker` hat sie oben
            // entweder gefunden oder angelegt.
            const alt = ankerId ? { id: ankerId } : null;

            await db.beginTransaction();
            try {
                if (alt) {
                    await db.query(
                        `INSERT INTO packages (id, slug, name, description, category)
                         VALUES (?, ?, ?, ?, ?)
                         ON DUPLICATE KEY UPDATE
                             name = VALUES(name),
                             description = VALUES(description),
                             category = VALUES(category)`,
                        [alt.id, id.slug, name, besch, kategorie]);
                } else {
                    await db.query(
                        `INSERT INTO packages (slug, name, description, category)
                         VALUES (?, ?, ?, ?)
                         ON DUPLICATE KEY UPDATE
                             name = VALUES(name),
                             description = VALUES(description),
                             category = VALUES(category)`,
                        [id.slug, name, besch, kategorie]);
                }
                const [[p]] = await db.query('SELECT id FROM packages WHERE slug = ?', [id.slug]);
                await db.query(
                    `INSERT INTO package_versions (package_id, version, fbpkg, checksum, channel)
                     VALUES (?, ?, ?, ?, 'test')`,
                    [p.id, id.version, text, summe]);
                await db.commit();
                neu++;
            } catch (err) {
                await db.rollback();
                console.log(`    ✘ Schreiben fehlgeschlagen: ${err.message}`);
                abgewiesen++;
            }
        }
    } finally {
        await db.end();
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
