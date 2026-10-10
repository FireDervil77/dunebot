'use strict';

/**
 * Ein Paket einliefern — der gemeinsame Kern von Kommandozeile und Werkbank.
 *
 * Herausgelöst am 2026-09-24 aus `scripts/liefere-pakete.js` (Werkbank Stufe 4,
 * Entscheidung 2b des Betreibers: *„wenn wir den ersten damit nur erweitern /
 * und nicht blockieren. dann ist gut. sonst den 2ten weg."*). Die
 * Kommandozeile ruft dieses Modul und verhält sich wie vorher — belegt durch
 * denselben Probelauf vor und nach dem Umbau. Die Werkbank ruft es auch.
 *
 * Die Begründungen der einzelnen Regeln (unveränderliche Fassungen, Kennung
 * vom Anker, Anker vor der Fassungsprüfung, Autor nicht geraten) stehen hier
 * bei ihrem Code, nicht mehr im Skript.
 *
 * ── Die Schnittstelle zur Datenbank ─────────────────────────────────────────
 *
 * Das Skript hat eine eigene mysql2-Verbindung (`query` liefert [zeilen,
 * felder]), das Dashboard `dbService` (`query` liefert Zeilen, `transaction`
 * reicht eine rohe Verbindung durch). Hier wird nur verlangt:
 *
 *   q(sql, werte)            → Zeilen
 *   inTransaktion(fn(q))     → fn läuft in einer Transaktion
 *
 * `fuerVerbindung` und `fuerDbService` bauen das für beide Seiten.
 *
 * @module fbpkg/lib/einlieferung
 */

const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const PRUEFER = path.join(__dirname, '../../../scripts/check-pakete.js');

// ── Die Kategorien, die `packages.category` kennt ────────────────────────────
// Was das Paket sonst nennt, landet auf 'other' — mit Meldung, nicht stumm.
const KATEGORIEN = new Set(['fps', 'survival', 'sandbox', 'mmorpg', 'racing',
                            'strategy', 'horror', 'scifi', 'other']);

/** Für eine eigene mysql2-Verbindung (das Skript). */
function fuerVerbindung(verbindung) {
    const q = async (sql, werte) => (await verbindung.query(sql, werte))[0];
    return {
        q,
        async inTransaktion(fn) {
            await verbindung.beginTransaction();
            try {
                const r = await fn(q);
                await verbindung.commit();
                return r;
            } catch (err) {
                await verbindung.rollback();
                throw err;
            }
        },
    };
}

/** Für den dbService des Dashboards. */
function fuerDbService(dbService) {
    return {
        q: (sql, werte) => dbService.query(sql, werte),
        inTransaktion: (fn) => dbService.transaction(
            (verbindung) => fn(async (sql, werte) => (await verbindung.query(sql, werte))[0])),
    };
}

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
    // `Befund:` seit 2026-09-24 — die Regel zum Notausgang meldet sich so, und
    // ohne das Wort stand bei der Werkbank nur „✘ datei" ohne Grund da.
    // `Verweis:`, `files.public:`, `I2:`, `I7:` seit 2026-10-10 — so beginnen
    // die Verstöße der Invarianten (scripts/check-pakete.js). Ohne sie stand
    // bei einem Verweis ins Leere wieder nur „✘ datei" da, und dahinter die
    // offenen Punkte des Pakets statt des Grundes.
    const treffer = zeilen.filter(z => /Schema:|Befund:|Verweis:|files\.public:|\bI[27]:|✘|Fehler|fehlt|ungültig|ungueltig/i.test(z));
    return treffer.length ? treffer.slice(0, 8) : zeilen.slice(0, 8);
}

/**
 * Das Tor: dieselbe Prüfung wie überall. Rückgabewert 0 oder nichts geht rein.
 *
 * ── Warum die Prüfung als Aufruf und nicht als Import ────────────────────────
 *
 * `check-pakete.js` ist ein Kommandozeilenwerkzeug: Es arbeitet beim Laden
 * sofort los und beendet den Prozess. Es zu importieren hiesse, es erst
 * umzubauen — und ein zweites Prüfwerkzeug daneben zu stellen wäre die
 * schlechtere Wahl (zwei Definitionen von „gültig" driften auseinander, das
 * kostete uns beim Übersetzer schon einmal einen Tag). Also wird es als
 * Werkzeug aufgerufen und sein Rückgabewert ist das Tor.
 */
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
 * kein Server dieses Spiels ueberhaupt anlegen.**
 *
 * ── Warum der Anker aus dem Paket kommt und nicht daneben ───────────────────
 *
 * Name, Beschreibung und Kategorie stehen im Paket. Der Anker schreibt sie ab,
 * er erfindet nichts: eine abgeleitete Zeile, keine zweite Wahrheit. `game_data`
 * bleibt leer (`{}`), denn dort stand das Egg — dieser Weg ist seit dem
 * 2026-09-10 entfallen. NULL darf es nicht sein (NOT NULL), also `{}`.
 *
 * Der Autor wird nicht geraten: Genommen wird der, den die vorhandenen Zeilen
 * benutzen. Ist die Tabelle leer, bricht es ab und verlangt einen Autor — eine
 * erfundene Kennung waere ein Datensatz, der auf niemanden zeigt.
 *
 * @returns {Promise<{id: number|null, neu: boolean}>} id ist null im Probelauf
 */
async function sichereAnker(q, { slug, name, besch, kategorie, version }, wirklich, autorVorgabe, log) {
    const [anker] = await q('SELECT id FROM addon_marketplace WHERE slug = ?', [slug]);
    if (anker) return { id: anker.id, neu: false };

    // Gibt es das Paket schon, MUSS der Anker dessen Kennung bekommen: Das Haus
    // sucht das Paket ueber `packages.id = addon_marketplace.id`
    // (`ladePaketFuerAddon`). Eine neue Nummer waere ein zweiter Anker daneben.
    const [paketZeile] = await q('SELECT id FROM packages WHERE slug = ?', [slug]);
    const kennung = paketZeile ? paketZeile.id : null;

    let autor = autorVorgabe;
    if (!autor) {
        const [haus] = await q(
            `SELECT author_user_id FROM addon_marketplace
              GROUP BY author_user_id ORDER BY COUNT(*) DESC LIMIT 1`);
        autor = haus ? haus.author_user_id : null;
    }
    if (!autor) {
        throw new Error('Kein Autor: `addon_marketplace` ist leer und `--autor=<discord-id>` fehlt.');
    }

    log(`    ⚑ Ankersatz in addon_marketplace fehlt — wird angelegt`
      + `${kennung ? ` mit Kennung ${kennung} (die des Pakets)` : ' (neue Kennung)'}`
      + `, Autor ${autor}.`);
    log('      Ohne ihn lässt sich kein Server dieses Spiels anlegen:'
      + ' gameservers.addon_marketplace_id ist ein Fremdschlüssel.');

    if (!wirklich) return { id: null, neu: true };

    const spalten = ['name', 'slug', 'description', 'author_user_id', 'visibility', 'status',
                     'game_data', 'category', 'version'];
    const werte   = [name, slug, besch, autor, 'public', 'approved', '{}', kategorie,
                     version || null];
    if (kennung) { spalten.unshift('id'); werte.unshift(kennung); }
    await q(`INSERT INTO addon_marketplace (${spalten.join(', ')})
             VALUES (${spalten.map(() => '?').join(', ')})`, werte);
    const [neuerAnker] = await q('SELECT id FROM addon_marketplace WHERE slug = ?', [slug]);
    return { id: neuerAnker ? neuerAnker.id : null, neu: true };
}

/**
 * Ein geprüftes Paket einliefern.
 *
 * Die Prüfung (`bestehtPruefung`) macht der Aufrufer VORHER — das Skript hat
 * eine Datei, die Werkbank schreibt sich eine. Hier geht es um das Schreiben.
 *
 * @param {object} db         aus fuerVerbindung / fuerDbService
 * @param {object} paket      das Paket (FBPKG_v1)
 * @param {object} o
 * @param {boolean} o.wirklich       false = Probelauf, nichts wird geschrieben
 * @param {string}  [o.etikett]      Name in den Meldungen (Dateiname)
 * @param {string}  [o.autor]        Autor, falls addon_marketplace leer ist
 * @param {Date}    [o.testBestanden] setzt `test_passed_at` — nur die Werkbank
 *                                    kann das belegen (Prüfdurchlauf)
 * @param {object}  [o.praesentation] { icon_url, banner_url } an den Anker;
 *                                    fehlende Felder bleiben, wie sie sind
 * @param {function}[o.log]           eine Zeile ausgeben
 * @returns {Promise<{art:'neu'|'unveraendert'|'abgewiesen', grund?:string, ankerNeu:boolean, paketId?:number}>}
 */
async function liefereEin(db, paket, o = {}) {
    const log = o.log || (() => {});
    const kurz = o.etikett || paket?.identity?.slug || '?';
    const id = paket.identity || {};
    if (!id.slug || !id.version) {
        log(`✘ ${kurz}\n    identity.slug oder identity.version fehlt.`);
        return { art: 'abgewiesen', grund: 'identity.slug oder identity.version fehlt.', ankerNeu: false };
    }

    let kategorie = id.category || 'other';
    if (!KATEGORIEN.has(kategorie)) {
        log(`  ⚠ ${kurz}: Kategorie "${kategorie}" kennt die Tabelle nicht — 'other'.`);
        kategorie = 'other';
    }

    const { text, summe } = dokumentUndSumme(paket);
    const name  = id.name || id.slug;
    const besch = typeof id.description === 'object'
                ? (id.description.de || id.description.en || null)
                : (id.description || null);

    // ── Der Ankersatz, VOR der Fassungspruefung ──────────────────────────────
    //
    // Vor der Pruefung und nicht danach: Ein Paket, das schon liegt (gleiche
    // Nummer, gleicher Inhalt), springt unten heraus — und genau das war der
    // Zustand von Minecraft am 2026-09-22: Paket da, Anker fehlt, Server nicht
    // anlegbar. Ausserhalb der Transaktion: Der Anker muss auch dann
    // entstehen, wenn es an der Fassung nichts zu tun gibt.
    const anker = await sichereAnker(db.q,
        { slug: id.slug, name, besch, kategorie, version: id.version },
        o.wirklich, o.autor, log);

    // Praesentation an den Anker — dort lesen Spielwahl, Serverliste und
    // Startseite (am.icon_url). `packages.icon_url` hat keinen Leser.
    if (o.wirklich && anker.id && o.praesentation) {
        const setzen = Object.entries({ icon_url: o.praesentation.icon_url, banner_url: o.praesentation.banner_url })
            .filter(([, v]) => typeof v === 'string' && v.trim());
        if (setzen.length) {
            await db.q(`UPDATE addon_marketplace SET ${setzen.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`,
                [...setzen.map(([, v]) => v.trim()), anker.id]);
        }
    }

    // ── Gibt es die Fassung schon? ───────────────────────────────────────────
    //
    // `package_versions` ist ein Stand, keine Akte. Liegt eine Fassung mit
    // derselben Nummer, aber anderem Inhalt vor, wird NICHT ueberschrieben: Ein
    // Server, der laut Protokoll mit 1.0.0 lief, muss 1.0.0 auch spaeter noch
    // lesen koennen. Wer etwas aendert, erhoeht die Nummer.
    const [vorhanden] = await db.q(
        `SELECT pv.id, pv.checksum, pv.channel
           FROM package_versions pv
           JOIN packages p ON p.id = pv.package_id
          WHERE p.slug = ? AND pv.version = ?`, [id.slug, id.version]);

    if (vorhanden) {
        if (vorhanden.checksum === summe) {
            log(`= ${kurz.padEnd(20)} ${id.slug} ${id.version} liegt bereits `
              + `unverändert vor (${vorhanden.channel})`);
            return { art: 'unveraendert', ankerNeu: anker.neu };
        }
        const grund = `${id.slug} ${id.version} liegt bereits mit ANDEREM Inhalt vor. `
                    + 'Eine Fassung ist ein Stand, keine Akte — erhöhe die Nummer, statt sie zu überschreiben.';
        log(`✘ ${kurz}\n    ${id.slug} ${id.version} liegt bereits mit ANDEREM `
          + `Inhalt vor.\n    Eine Fassung ist ein Stand, keine Akte — `
          + `erhöhe die Nummer, statt sie zu überschreiben.`);
        return { art: 'abgewiesen', grund, ankerNeu: anker.neu };
    }

    const offen = (paket.status?.open || []).length;
    const hinweis = paket.status?.complete ? 'vollständig'
                  : `${offen} offene${offen === 1 ? 'r' : ''} Punkt${offen === 1 ? '' : 'e'}`;
    const [vorgaenger] = await db.q('SELECT id FROM addon_marketplace WHERE slug = ?', [id.slug]);
    log(`+ ${kurz.padEnd(20)} ${id.slug} ${id.version} → Kanal test  (${hinweis})`);
    log(`    ${summe.slice(0, 26)}…  ${text.length.toLocaleString('de-DE')} Zeichen`
      + (vorgaenger ? `  ·  Kennung ${vorgaenger.id} vom Vorgänger übernommen` : ''));

    if (!o.wirklich) return { art: 'neu', ankerNeu: anker.neu };

    // Kennung vom Anker: `addon_ratings`, `addon_comments` und `addon_favorites`
    // zeigen auf `addon_marketplace.id`, und eine Bewertung gilt dem Spielpaket,
    // nicht der Fassung — mit derselben Kennung ziehen sie beim Schnitt mit.
    const alt = anker.id ? { id: anker.id } : null;
    try {
        const paketId = await db.inTransaktion(async (tq) => {
            if (alt) {
                await tq(`INSERT INTO packages (id, slug, name, description, category)
                          VALUES (?, ?, ?, ?, ?)
                          ON DUPLICATE KEY UPDATE
                              name = VALUES(name),
                              description = VALUES(description),
                              category = VALUES(category)`,
                    [alt.id, id.slug, name, besch, kategorie]);
            } else {
                await tq(`INSERT INTO packages (slug, name, description, category)
                          VALUES (?, ?, ?, ?)
                          ON DUPLICATE KEY UPDATE
                              name = VALUES(name),
                              description = VALUES(description),
                              category = VALUES(category)`,
                    [id.slug, name, besch, kategorie]);
            }
            const [p] = await tq('SELECT id FROM packages WHERE slug = ?', [id.slug]);
            // `stable` verlangt nach E-17 einen bestandenen Pruefdurchlauf
            // (`test_passed_at`) UND die Freigabe des Betreibers
            // (`released_at`). Den Durchlauf kann nur die Werkbank belegen.
            await tq(`INSERT INTO package_versions (package_id, version, fbpkg, checksum, channel, test_passed_at)
                      VALUES (?, ?, ?, ?, 'test', ?)`,
                [p.id, id.version, text, summe, o.testBestanden || null]);
            return p.id;
        });
        return { art: 'neu', ankerNeu: anker.neu, paketId };
    } catch (err) {
        log(`    ✘ Schreiben fehlgeschlagen: ${err.message}`);
        return { art: 'abgewiesen', grund: `Schreiben fehlgeschlagen: ${err.message}`, ankerNeu: anker.neu };
    }
}

module.exports = {
    KATEGORIEN, fuerVerbindung, fuerDbService, grundZeilen, bestehtPruefung,
    dokumentUndSumme, sichereAnker, liefereEin,
};
