'use strict';

/**
 * Die Tag-Bibliothek — ein Vorrat an Tags, den mehrere Bereiche teilen
 * (Betreiber, 2026-10-07: „eine tag lib … so dass man die wiederverwenden kann
 * bei passenden tags … über ne zentrale tabelle").
 *
 * ── Warum eine Tabelle und kein Kommafeld ───────────────────────────────────
 *
 * Bis dahin stand am Spiel ein Textfeld „Tags (comma-separated)". Drei Folgen:
 *
 *   - Jeder Eintrag erfand seine Tags neu. „CO-OP", „Co-op" und „Koop" wären
 *     drei verschiedene gewesen, und niemand hätte es gesehen.
 *   - Der Adminbereich schrieb die Liste als JSON, die Spielseite der Guild
 *     zerlegte sie am Komma — angezeigt wurde `["SCI-FI"` samt Klammer und
 *     Anführungszeichen. Zwei Schreibweisen für dasselbe Feld.
 *   - Suchen ging nur als `tags LIKE '%…%'` über den rohen Text.
 *
 * Jetzt: `tags` hält jedes Tag einmal, `tag_links` sagt, woran es hängt.
 * Wiedererkannt wird ein Tag an seinem `slug` (kleingeschrieben,
 * vereinheitlicht) — angezeigt wird die Schreibweise, mit der es zuerst
 * angelegt wurde.
 *
 * ── Wer andockt ─────────────────────────────────────────────────────────────
 *
 * Ein Bereich bekommt einen Namen in `ARTEN` und benutzt `fuer`/`setze`. Heute
 * gibt es einen: `spiel` (addon_marketplace.id). Der Blog hat noch sein eigenes
 * Kommafeld (Entscheidung des Betreibers: erst die Spiele).
 *
 * Verknüpft wird nur über Zahlen (`tag_id`, `entity_id`) — kein Vergleich von
 * Text über die Grenze zwischen Kern- und Plugin-Tabellen (Kollationen).
 */

const ARTEN = ['spiel'];
const MAX_LAENGE = 40;
const MAX_JE_EINTRAG = 12;

/** Woran ein Tag wiedererkannt wird: ohne Gross/Klein, ohne doppelte Leerzeichen. */
function slugVon(name) {
    return String(name ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Eine Eingabe (Liste oder Kommatext) zu sauberen Tags: getrimmt, ohne
 * Doppelte, mit Grund abgewiesen, wenn eines nicht passt.
 *
 * @param {string[]|string|null|undefined} eingabe
 * @returns {Array<{name: string, slug: string}>}
 */
function bereinige(eingabe) {
    const roh = Array.isArray(eingabe) ? eingabe
        : (typeof eingabe === 'string' ? eingabe.split(',') : []);
    const gesehen = new Set();
    const aus = [];
    for (const r of roh) {
        if (typeof r !== 'string') throw new Error('Ein Tag ist Text.');
        const name = r.normalize('NFKC').replace(/\s+/g, ' ').trim();
        if (!name) continue;
        if (name.length > MAX_LAENGE) throw new Error(`Das Tag „${name.slice(0, 20)}…" hat ${name.length} Zeichen — höchstens ${MAX_LAENGE}.`);
        if (/[,<>"]/.test(name)) throw new Error(`Das Tag „${name}" enthält ein Zeichen, das nicht geht (Komma, <, > oder ").`);
        const slug = slugVon(name);
        if (gesehen.has(slug)) continue;
        gesehen.add(slug);
        aus.push({ name, slug });
    }
    if (aus.length > MAX_JE_EINTRAG) throw new Error(`Höchstens ${MAX_JE_EINTRAG} Tags je Eintrag — es sind ${aus.length}.`);
    return aus;
}

function pruefeArt(art) {
    if (!ARTEN.includes(art)) throw new Error(`Tags: den Bereich „${art}" gibt es nicht (${ARTEN.join(', ')}).`);
}

/** Die ganze Bibliothek — mit der Zahl der Einträge, an denen jedes Tag hängt. */
async function alle(db) {
    return db.query(`
        SELECT t.id, t.name, t.slug, COUNT(l.tag_id) AS benutzt
          FROM tags t
          LEFT JOIN tag_links l ON l.tag_id = t.id
         GROUP BY t.id, t.name, t.slug
         ORDER BY t.name`);
}

/** Die Tags EINES Eintrags, nach Namen geordnet. */
async function fuer(db, art, id) {
    pruefeArt(art);
    const zeilen = await db.query(`
        SELECT t.name
          FROM tag_links l
          JOIN tags t ON t.id = l.tag_id
         WHERE l.entity_type = ? AND l.entity_id = ?
         ORDER BY t.name`, [art, id]);
    return zeilen.map(z => z.name);
}

/** Die Tags vieler Einträge in EINEM Zug: Kennung → Namen. */
async function fuerViele(db, art, ids) {
    pruefeArt(art);
    const liste = [...new Set((ids || []).filter(x => x !== null && x !== undefined))];
    const aus = {};
    for (const id of liste) aus[id] = [];
    if (!liste.length) return aus;
    const zeilen = await db.query(`
        SELECT l.entity_id, t.name
          FROM tag_links l
          JOIN tags t ON t.id = l.tag_id
         WHERE l.entity_type = ? AND l.entity_id IN (${liste.map(() => '?').join(',')})
         ORDER BY t.name`, [art, ...liste]);
    for (const z of zeilen) (aus[z.entity_id] = aus[z.entity_id] || []).push(z.name);
    return aus;
}

/**
 * Die Tags eines Eintrags setzen — genau diese, keine anderen.
 *
 * Ein Tag, das es noch nicht gibt, wird angelegt; eines, das es gibt, wird
 * wiederverwendet (und behält seine Schreibweise). Erst kommen die neuen
 * Verknüpfungen, dann gehen die überzähligen — bricht es dazwischen ab, hat der
 * Eintrag zu viele Tags, nie zu wenige.
 *
 * Ein Tag, an dem nichts mehr hängt, BLEIBT in der Bibliothek: Dafür ist sie
 * da.
 *
 * @returns {Promise<string[]>} die Tags, wie sie danach am Eintrag stehen
 */
async function setze(db, art, id, eingabe) {
    pruefeArt(art);
    const liste = bereinige(eingabe);

    for (const t of liste) {
        // `id = id`: bei vorhandenem slug nichts ändern — die erste Schreibweise gilt.
        await db.query('INSERT INTO tags (name, slug) VALUES (?, ?) ON DUPLICATE KEY UPDATE id = id', [t.name, t.slug]);
    }
    let ids = [];
    if (liste.length) {
        const zeilen = await db.query(
            `SELECT id FROM tags WHERE slug IN (${liste.map(() => '?').join(',')})`, liste.map(t => t.slug));
        ids = zeilen.map(z => z.id);
        if (ids.length !== liste.length) {
            throw new Error(`Tags: ${liste.length} erwartet, ${ids.length} in der Bibliothek gefunden — nichts verknüpft.`);
        }
        for (const tagId of ids) {
            await db.query('INSERT IGNORE INTO tag_links (tag_id, entity_type, entity_id) VALUES (?, ?, ?)', [tagId, art, id]);
        }
    }
    await db.query(
        `DELETE FROM tag_links WHERE entity_type = ? AND entity_id = ?`
        + (ids.length ? ` AND tag_id NOT IN (${ids.map(() => '?').join(',')})` : ''),
        [art, id, ...ids]);
    return fuer(db, art, id);
}

/**
 * Bedingung „ein Tag dieses Eintrags passt auf den Suchbegriff" — als
 * EXISTS-Unterabfrage mit EINEM Platzhalter (`%begriff%`).
 *
 * @param {string} art
 * @param {string} idSpalte  die Kennungsspalte des Eintrags, etwa `addon_marketplace.id`
 */
function sucheSql(art, idSpalte) {
    pruefeArt(art);
    if (!/^[a-z_][a-z0-9_.]*$/i.test(idSpalte)) throw new Error('Tags: ungültige Spalte.');
    return `EXISTS (SELECT 1 FROM tag_links tl JOIN tags tt ON tt.id = tl.tag_id
                     WHERE tl.entity_type = '${art}' AND tl.entity_id = ${idSpalte} AND tt.name LIKE ?)`;
}

module.exports = { ARTEN, MAX_LAENGE, MAX_JE_EINTRAG, slugVon, bereinige, alle, fuer, fuerViele, setze, sucheSql };
