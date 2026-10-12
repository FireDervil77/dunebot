'use strict';

/**
 * Die Wissensdatenbank (`/kb`): Bereiche, Artikel, und wer was lesen darf.
 *
 * ── Warum es das gibt (Betreiber, 2026-10-08, gebaut 2026-10-11) ────────────
 *
 * Bis hierhin war die öffentliche Dokumentation ein Ordner mit 34
 * Markdown-Dateien (`documentation/`), gezeigt unter `/docs`, gepflegt in
 * einem Datei-Editor. Das trug nicht mehr: nur deutsch, keine Entwürfe, keine
 * Unterscheidung „für alle" und „für Angemeldete", und sieben Artikel
 * beschrieben Plugins, die es nicht gibt.
 *
 * Jetzt liegen Bereiche und Artikel in der Datenbank (`kb_categories`,
 * `kb_articles`), die Sprachen in der Form der anderen Inhalte
 * (`*_translations`, wie News). Die Entscheidungen E-1 bis E-6 und die vom
 * 2026-10-11 stehen in `docs/wissensdatenbank/STAND.md`.
 *
 * ── Die Regeln stehen NUR hier ──────────────────────────────────────────────
 *
 *   Sichtbarkeit  Ein Entwurf ist außen nicht da. Ein veröffentlichter
 *                 Artikel ist für Angemeldete ganz lesbar (irgendein
 *                 Discord-Login, die Adresse kennt keine Guild); ohne
 *                 Anmeldung nur, wenn er „öffentlich" ist — sonst Titel und
 *                 Kurztext mit Schloss.
 *   Sprache       Fehlt die gewünschte Fassung, gilt die deutsche.
 *   Inhalt        Markdown. Gerendert wird beim ANZEIGEN, nie beim Speichern
 *                 (die Changelog-Lehre). Rohes HTML im Artikel kommt als Text
 *                 heraus, nicht als HTML: Die Seite ist öffentlich.
 *
 * Öffentliche Seite, Verwaltung und die Weiterleitung der alten Adressen
 * fragen dieses Modul, statt selbst zu rechnen.
 *
 * @module helpers/Wissen
 */

const { ServiceManager } = require('dunebot-core');
const { Marked } = require('marked');

const SPRACHEN = ['de-DE', 'en-GB'];
const STANDARDSPRACHE = 'de-DE';
const STAENDE = ['draft', 'published'];
const RE_KUERZEL = /^[a-z0-9][a-z0-9-]{0,79}$/;

/**
 * Der Text der Startseite von `/kb` ist ein Artikel wie jeder andere — damit
 * er in der Verwaltung zu bearbeiten ist und zwei Sprachen hat. In der Liste
 * seines Bereichs steht er nicht: Er IST die Seite davor.
 */
const START = { bereich: 'allgemein', artikel: 'startseite' };

const db = () => ServiceManager.get('dbService');

/**
 * Eine Eingabe, die nicht stimmt — der Satz geht an den Menschen (400). Alles
 * andere, was hier fliegt, ist ein Fehler bei uns und bleibt im Log (500).
 * Die Verwaltung unterscheidet an der KLASSE, nicht am Wortlaut.
 */
class Eingabefehler extends Error {}

// ────────────────────────────────────────────────────────────────────────────
// Kleine Werkzeuge
// ────────────────────────────────────────────────────────────────────────────

function escapeHtml(text) {
    return String(text ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** `de`, `de-DE`, `en`, `en-GB`, `en-US` … → eine der beiden gespeicherten Sprachen. */
function sprache(locale) {
    const l = String(locale || '').toLowerCase();
    return l.startsWith('en') ? 'en-GB' : STANDARDSPRACHE;
}

function alsObjekt(wert) {
    if (!wert) return {};
    if (typeof wert === 'object') return wert;
    try { return JSON.parse(wert) || {}; } catch { return {}; }
}

/** Ein Feld in der gewünschten Sprache, sonst deutsch, sonst leer. */
function text(uebersetzungen, locale) {
    const u = alsObjekt(uebersetzungen);
    return String(u[sprache(locale)] || u[STANDARDSPRACHE] || '');
}

/** `{ de, en }` aus einem Formular → das JSON für die Spalte. Leeres Englisch bleibt weg. */
function uebersetzungen(de, en) {
    const aus = { [STANDARDSPRACHE]: String(de ?? '').trim() };
    if (String(en ?? '').trim()) aus['en-GB'] = String(en).trim();
    return JSON.stringify(aus);
}

/** Aus einem Titel ein Kürzel für die Adresse: klein, a–z, 0–9, Bindestriche. */
function kuerzelAus(titel) {
    return String(titel || '')
        .toLowerCase()
        .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
        .normalize('NFKD').replace(/[^\x00-\x7f]/g, '')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
        .slice(0, 80);
}

// ────────────────────────────────────────────────────────────────────────────
// Markdown → HTML
// ────────────────────────────────────────────────────────────────────────────

/** Wohin ein Verweis im Artikel zeigen darf: die eigene Seite, http(s), mailto. */
function verweisIstHarmlos(href) {
    const h = String(href || '').trim();
    return h.startsWith('/') || h.startsWith('#') || /^(https?:|mailto:)/i.test(h)
        // relative Verweise ohne Schema (`bild.png`, `./x`) — kein Doppelpunkt vor dem ersten Schrägstrich
        || !/^[a-z][a-z0-9+.-]*:/i.test(h);
}

const markdown = new Marked({
    gfm: true,
    renderer: {
        // Rohes HTML im Artikel wird TEXT. Bis zum 2026-10-11 ging die Ausgabe
        // von `marked` ungefiltert auf die öffentliche Seite — bei Dateien im
        // Git vertretbar, bei einem Formularfeld nicht.
        html(token) {
            return escapeHtml(typeof token === 'string' ? token : token.text);
        },
        // Überschriften bekommen eine Kennung, damit `…#abschnitt` trifft.
        // `marked` vergibt seit Fassung 5 keine mehr; ein Verweis im Bestand
        // (`daemon-setup.md#troubleshooting`) lief deshalb ins Leere.
        heading(token) {
            const innen = this.parser.parseInline(token.tokens);
            const kennung = kuerzelAus(token.text);
            return `<h${token.depth}${kennung ? ` id="${kennung}"` : ''}>${innen}</h${token.depth}>\n`;
        },
    },
    walkTokens(token) {
        if ((token.type === 'link' || token.type === 'image') && !verweisIstHarmlos(token.href)) {
            token.href = '#';
        }
    },
});

/** Markdown eines Artikels als HTML — für die Anzeige, nie zum Speichern. */
function rendere(inhalt) {
    return markdown.parse(String(inhalt || ''));
}

// ────────────────────────────────────────────────────────────────────────────
// Sichtbarkeit
// ────────────────────────────────────────────────────────────────────────────

/**
 * Was ein Besucher von einem Artikel bekommt.
 *
 * @param {object} artikel   Zeile aus `kb_articles`
 * @param {boolean} angemeldet  irgendein Discord-Login
 * @returns {'ganz'|'schloss'|'nichts'}
 */
function sichtbarkeit(artikel, angemeldet) {
    if (!artikel || artikel.status !== 'published') return 'nichts';
    if (angemeldet || Number(artikel.is_public) === 1) return 'ganz';
    return 'schloss';
}

/** Ist dieser Besucher angemeldet? Die Frage steht hier, damit sie überall gleich lautet. */
function istAngemeldet(req) {
    return Boolean(req?.session?.user?.info?.id);
}

/**
 * Wohin es nach dem Login geht, wenn jemand von einem Artikel mit Schloss kam.
 *
 * Nur Adressen unter `/kb` — der Login führt sonst fest zur Serverauswahl, und
 * eine frei wählbare Rückkehradresse wäre eine offene Weiterleitung.
 *
 * @returns {string|null}
 */
function rueckkehrZiel(adresse) {
    const a = String(adresse || '');
    return /^\/kb(\/[a-z0-9-]+){0,2}\/?$/.test(a) ? a : null;
}

// ────────────────────────────────────────────────────────────────────────────
// Die alten Adressen unter /docs
// ────────────────────────────────────────────────────────────────────────────

/**
 * Die neue Adresse zu einem Pfad der alten Dokumentation.
 *
 *   ''                         → /kb
 *   'faq'  ·  'faq.md'         → /kb/allgemein/faq
 *   'gameserver'               → /kb/gameserver
 *   'gameserver/ressourcen.md' → /kb/gameserver/ressourcen
 *
 * Dieselbe Regel schreibt beim Einspielen die Verweise in den Artikeln um
 * (`migrations/kern/…_wissensdatenbank.js` trägt dafür eine eigene Fassung —
 * eine Migration hängt nicht an Code, der sich später ändert).
 */
function neueAdresse(alterPfad) {
    const teile = String(alterPfad || '').split('/').map(t => t.trim()).filter(Boolean)
        .map(t => t.replace(/\.md$/i, '').toLowerCase());
    if (teile.length && teile[teile.length - 1] === 'index') teile.pop();
    if (!teile.length) return '/kb';
    if (teile.some(t => !RE_KUERZEL.test(t))) return '/kb';
    if (teile.length === 1) return teile[0] === 'faq' ? `/kb/${START.bereich}/faq` : `/kb/${teile[0]}`;
    return `/kb/${teile[0]}/${teile[1]}`;
}

// ────────────────────────────────────────────────────────────────────────────
// Lesen
// ────────────────────────────────────────────────────────────────────────────

function bereichFuerAnzeige(zeile, locale) {
    return {
        id: zeile.id,
        kuerzel: zeile.slug,
        titel: text(zeile.title_translations, locale) || zeile.slug,
        beschreibung: text(zeile.description_translations, locale),
        symbol: zeile.icon || 'bi-journal-text',
        reihenfolge: zeile.sort_order,
        plugin: zeile.plugin || null,
        artikel: zeile.artikel === undefined ? undefined : Number(zeile.artikel),
    };
}

function artikelFuerAnzeige(zeile, locale) {
    return {
        id: zeile.id,
        bereichId: zeile.category_id,
        bereich: zeile.bereich_slug,
        kuerzel: zeile.slug,
        titel: text(zeile.title_translations, locale) || zeile.slug,
        kurztext: text(zeile.excerpt_translations, locale),
        inhalt: text(zeile.content_translations, locale),
        stand: zeile.status,
        oeffentlich: Number(zeile.is_public) === 1,
        reihenfolge: zeile.sort_order,
        autor: zeile.author || null,
        geaendert: zeile.updated_at,
        istStartseite: zeile.bereich_slug === START.bereich && zeile.slug === START.artikel,
    };
}

const ARTIKEL_SPALTEN = `a.id, a.category_id, a.slug, a.title_translations, a.excerpt_translations,
       a.content_translations, a.status, a.is_public, a.sort_order, a.author, a.created_at, a.updated_at,
       c.slug AS bereich_slug`;

/**
 * Alle Bereiche in ihrer Reihenfolge, je mit der Zahl veröffentlichter Artikel.
 * Der Startseiten-Artikel zählt nicht mit — er steht in keiner Liste.
 */
async function bereiche(locale) {
    const zeilen = await db().query(
        `SELECT c.*, (SELECT COUNT(*) FROM kb_articles a
                       WHERE a.category_id = c.id AND a.status = 'published'
                         AND NOT (c.slug = ? AND a.slug = ?)) AS artikel
           FROM kb_categories c
          ORDER BY c.sort_order, c.id`, [START.bereich, START.artikel]);
    return zeilen.map(z => bereichFuerAnzeige(z, locale));
}

async function bereich(kuerzel, locale) {
    if (!RE_KUERZEL.test(String(kuerzel || ''))) return null;
    const [zeile] = await db().query('SELECT * FROM kb_categories WHERE slug = ?', [kuerzel]);
    return zeile ? bereichFuerAnzeige(zeile, locale) : null;
}

/**
 * Die Artikel eines Bereichs, wie die öffentliche Seite sie listet:
 * veröffentlicht, ohne den Startseiten-Artikel, je mit seiner Sichtbarkeit.
 */
async function artikelImBereich(bereichId, locale, angemeldet) {
    const zeilen = await db().query(
        `SELECT ${ARTIKEL_SPALTEN}
           FROM kb_articles a JOIN kb_categories c ON c.id = a.category_id
          WHERE a.category_id = ? AND a.status = 'published'
            AND NOT (c.slug = ? AND a.slug = ?)
          ORDER BY a.sort_order, a.id`, [bereichId, START.bereich, START.artikel]);
    return zeilen.map(z => ({ ...artikelFuerAnzeige(z, locale), sichtbar: sichtbarkeit(z, angemeldet) }));
}

/** Ein Artikel über seine Adresse — auch ein Entwurf; der Aufrufer fragt `sichtbarkeit`. */
async function artikel(bereichKuerzel, artikelKuerzel, locale) {
    if (!RE_KUERZEL.test(String(bereichKuerzel || '')) || !RE_KUERZEL.test(String(artikelKuerzel || ''))) return null;
    const [zeile] = await db().query(
        `SELECT ${ARTIKEL_SPALTEN}
           FROM kb_articles a JOIN kb_categories c ON c.id = a.category_id
          WHERE c.slug = ? AND a.slug = ?`, [bereichKuerzel, artikelKuerzel]);
    return zeile ? { ...artikelFuerAnzeige(zeile, locale), status: zeile.status, is_public: zeile.is_public } : null;
}

/**
 * Suche über Titel, Kurztext und Inhalt der veröffentlichten Artikel.
 *
 * Schlichtes LIKE: Bei ein paar Dutzend Artikeln reicht das, ein Volltextindex
 * lässt sich nachrüsten. Die Spalten sind JSON (`utf8mb4_bin`) — ohne LOWER
 * fände „daemon" den „Daemon" nicht.
 */
async function suche(begriff, locale, angemeldet) {
    const q = String(begriff || '').trim().slice(0, 80);
    if (q.length < 2) return [];
    const muster = '%' + q.toLowerCase().replace(/[\\%_]/g, z => '\\' + z) + '%';
    const zeilen = await db().query(
        `SELECT ${ARTIKEL_SPALTEN}
           FROM kb_articles a JOIN kb_categories c ON c.id = a.category_id
          WHERE a.status = 'published' AND NOT (c.slug = ? AND a.slug = ?)
            AND (LOWER(CONVERT(a.title_translations USING utf8mb4)) LIKE ?
              OR LOWER(CONVERT(a.excerpt_translations USING utf8mb4)) LIKE ?
              OR LOWER(CONVERT(a.content_translations USING utf8mb4)) LIKE ?)
          ORDER BY c.sort_order, a.sort_order, a.id
          LIMIT 50`, [START.bereich, START.artikel, muster, muster, muster]);
    return zeilen.map(z => ({ ...artikelFuerAnzeige(z, locale), sichtbar: sichtbarkeit(z, angemeldet) }));
}

// ────────────────────────────────────────────────────────────────────────────
// Verwaltung
// ────────────────────────────────────────────────────────────────────────────

/** Alles für die Übersicht der Verwaltung: Bereiche mit ALLEN ihren Artikeln, auch Entwürfen. */
async function allesFuerVerwaltung() {
    const [bereichsZeilen, artikelZeilen] = await Promise.all([
        db().query('SELECT * FROM kb_categories ORDER BY sort_order, id'),
        db().query(
            `SELECT ${ARTIKEL_SPALTEN}
               FROM kb_articles a JOIN kb_categories c ON c.id = a.category_id
              ORDER BY a.sort_order, a.id`),
    ]);
    return bereichsZeilen.map(b => ({
        ...bereichFuerAnzeige(b, STANDARDSPRACHE),
        artikelListe: artikelZeilen.filter(a => a.category_id === b.id).map(a => ({
            ...artikelFuerAnzeige(a, STANDARDSPRACHE),
            hatEnglisch: Boolean(alsObjekt(a.content_translations)['en-GB']),
        })),
    }));
}

async function bereichRoh(id) {
    const [zeile] = await db().query('SELECT * FROM kb_categories WHERE id = ?', [Number(id)]);
    if (!zeile) return null;
    return { ...zeile, title_translations: alsObjekt(zeile.title_translations),
        description_translations: alsObjekt(zeile.description_translations) };
}

async function artikelRoh(id) {
    const [zeile] = await db().query(
        `SELECT ${ARTIKEL_SPALTEN}
           FROM kb_articles a JOIN kb_categories c ON c.id = a.category_id WHERE a.id = ?`, [Number(id)]);
    if (!zeile) return null;
    return { ...zeile, title_translations: alsObjekt(zeile.title_translations),
        excerpt_translations: alsObjekt(zeile.excerpt_translations),
        content_translations: alsObjekt(zeile.content_translations),
        istStartseite: zeile.bereich_slug === START.bereich && zeile.slug === START.artikel };
}

// ── Verweise ziehen mit, wenn eine Adresse sich ändert (2026-10-12) ─────────
//
// Betreiber-Befund vom selben Tag: Er verschob „Daemon installieren" und
// „Masterserver Übersicht" in einen neuen Bereich — acht Verweise aus anderen
// Artikeln zeigten danach ins Leere. Die Verwaltung warnte nur im Hilfstext.
//
// Jetzt gehört beides zusammen: Ändert sich die Adresse eines Artikels
// (Kürzel oder Bereich) oder das Kürzel eines Bereichs, werden die Verweise
// darauf in ALLEN Artikeln und Sprachen im selben Zug umgeschrieben — in
// einer Transaktion, damit es nie einen verschobenen Artikel mit alten
// Verweisen gibt.

/**
 * In einem Markdown-Text die Verweise auf `alt` durch `neu` ersetzen.
 *
 * Getroffen wird nur ein Verweisziel (`](/kb/…`), und nur die ganze Adresse:
 * `/kb/a/b` trifft `/kb/a/b`, `/kb/a/b#anker` und `/kb/a/b/`, aber nicht
 * `/kb/a/b-neu`. Für einen Bereich (`/kb/a`) heißt das: auch alles darunter.
 *
 * @returns {{ text: string, stellen: number }}
 */
function ersetzeAdresse(text, alt, neu) {
    const muster = new RegExp('(?<=\\]\\()' + alt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=[)#?/\\s"]|$)', 'g');
    let stellen = 0;
    const aus = String(text ?? '').replace(muster, () => { stellen++; return neu; });
    return { text: aus, stellen };
}

/**
 * Die Verweise auf eine Adresse in allen Artikeln umschreiben.
 *
 * @param {string} alt  bisherige Adresse, etwa `/kb/gameserver/daemon-setup`
 * @param {string} neu  neue Adresse
 * @param {(sql: string, p?: any[]) => Promise<any>} q  Abfrage der laufenden Transaktion
 * @returns {Promise<{ artikel: number, stellen: number }>}
 */
async function verweiseUmschreiben(alt, neu, q) {
    const bericht = { artikel: 0, stellen: 0 };
    if (alt === neu) return bericht;
    const zeilen = await q('SELECT id, content_translations FROM kb_articles WHERE content_translations LIKE ?', [`%](${alt}%`]);
    for (const z of zeilen) {
        const inhalt = alsObjekt(z.content_translations);
        let hier = 0;
        for (const s of Object.keys(inhalt)) {
            const e = ersetzeAdresse(inhalt[s], alt, neu);
            inhalt[s] = e.text;
            hier += e.stellen;
        }
        if (!hier) continue;
        await q('UPDATE kb_articles SET content_translations = ? WHERE id = ?', [JSON.stringify(inhalt), z.id]);
        bericht.artikel++;
        bericht.stellen += hier;
    }
    return bericht;
}

/** Mehrere Schreibvorgänge als einer: `fn` bekommt die Abfrage der Transaktion. */
function inTransaktion(fn) {
    return db().transaction(verbindung => fn(async (sql, p) => (await verbindung.query(sql, p))[0]));
}

/** `/kb/suche` ist die Suche — ein Bereich dieses Namens wäre unter seiner Adresse nie zu sehen. */
const VERGEBEN = ['suche'];

function pruefeKuerzel(wert, was) {
    const k = String(wert || '').trim();
    if (!RE_KUERZEL.test(k)) {
        throw new Eingabefehler(`${was}: Das Kürzel für die Adresse darf nur a–z, 0–9 und Bindestriche enthalten und muss mit Buchstabe oder Ziffer anfangen (etwa „erste-schritte").`);
    }
    if (was === 'Bereich' && VERGEBEN.includes(k)) {
        throw new Eingabefehler(`Bereich: „${k}" ist schon eine Adresse der Wissensdatenbank (/kb/${k}) — nimm ein anderes Kürzel.`);
    }
    return k;
}

/**
 * Bereich anlegen oder ändern. Wirft mit einem Satz, der sagt, was fehlt.
 *
 * @param {object} f  Formular: id?, slug, title_de, title_en, description_de, description_en, icon, sort_order, plugin
 * @param {object} [bericht]  bekommt `verweise` ({ artikel, stellen }), wenn das Kürzel sich geändert hat
 * @returns {Promise<number>} id des Bereichs
 */
async function bereichSpeichern(f, bericht = {}) {
    const titel = String(f.title_de || '').trim();
    if (!titel) throw new Eingabefehler('Bereich: Der deutsche Titel fehlt.');
    const slug = pruefeKuerzel(f.slug || kuerzelAus(titel), 'Bereich');
    const id = f.id ? Number(f.id) : null;

    const doppelt = await db().query('SELECT id FROM kb_categories WHERE slug = ? AND id <> ?', [slug, id || 0]);
    if (doppelt.length) throw new Eingabefehler(`Bereich: Das Kürzel „${slug}" gibt es schon.`);

    let altesKuerzel = null;
    if (id) {
        const [alt] = await db().query('SELECT slug FROM kb_categories WHERE id = ?', [id]);
        if (!alt) throw new Eingabefehler('Bereich: Diesen Bereich gibt es nicht mehr.');
        // Der Startseiten-Artikel wird über das Kürzel seines Bereichs gefunden.
        if (alt.slug === START.bereich && slug !== START.bereich) {
            throw new Eingabefehler(`Bereich: „${START.bereich}" trägt den Text der Startseite von /kb — sein Kürzel bleibt.`);
        }
        altesKuerzel = alt.slug;
    }
    const werte = [slug, uebersetzungen(titel, f.title_en), uebersetzungen(f.description_de, f.description_en),
        String(f.icon || '').trim().slice(0, 60) || null, Number.parseInt(f.sort_order, 10) || 0,
        String(f.plugin || '').trim().slice(0, 60) || null];
    if (id) {
        const sql = `UPDATE kb_categories SET slug = ?, title_translations = ?, description_translations = ?,
                    icon = ?, sort_order = ?, plugin = ? WHERE id = ?`;
        if (altesKuerzel === slug) {
            await db().query(sql, [...werte, id]);
            return id;
        }
        // Neues Kürzel = neue Adresse für den Bereich und jeden Artikel darin.
        await inTransaktion(async (q) => {
            await q(sql, [...werte, id]);
            bericht.verweise = await verweiseUmschreiben(`/kb/${altesKuerzel}`, `/kb/${slug}`, q);
        });
        return id;
    }
    const ergebnis = await db().query(
        `INSERT INTO kb_categories (slug, title_translations, description_translations, icon, sort_order, plugin)
         VALUES (?, ?, ?, ?, ?, ?)`, werte);
    return ergebnis.insertId;
}

/** Ein Bereich lässt sich nur leer entfernen — Artikel verschwinden nie nebenbei. */
async function bereichEntfernen(id) {
    const [b] = await db().query('SELECT slug FROM kb_categories WHERE id = ?', [Number(id)]);
    if (!b) throw new Eingabefehler('Diesen Bereich gibt es nicht mehr.');
    const [n] = await db().query('SELECT COUNT(*) AS n FROM kb_articles WHERE category_id = ?', [Number(id)]);
    if (Number(n.n) > 0) {
        throw new Eingabefehler(`Im Bereich „${b.slug}" liegen noch ${n.n} Artikel — erst verschieben oder entfernen.`);
    }
    await db().query('DELETE FROM kb_categories WHERE id = ?', [Number(id)]);
}

/**
 * Artikel anlegen oder ändern.
 *
 * @param {object} f  Formular: id?, category_id, slug, title_de/_en, excerpt_de/_en, content_de/_en,
 *                    status, is_public, sort_order
 * @param {string|null} autor
 * @param {object} [bericht]  bekommt `verweise` ({ artikel, stellen, von, nach }), wenn die Adresse sich geändert hat
 * @returns {Promise<number>} id des Artikels
 */
async function artikelSpeichern(f, autor = null, bericht = {}) {
    const titel = String(f.title_de || '').trim();
    if (!titel) throw new Eingabefehler('Artikel: Der deutsche Titel fehlt.');
    if (!String(f.content_de || '').trim()) throw new Eingabefehler('Artikel: Der deutsche Inhalt fehlt.');
    const bereichId = Number(f.category_id);
    const [b] = await db().query('SELECT id, slug FROM kb_categories WHERE id = ?', [bereichId]);
    if (!b) throw new Eingabefehler('Artikel: Diesen Bereich gibt es nicht.');
    const slug = pruefeKuerzel(f.slug || kuerzelAus(titel), 'Artikel');
    const stand = STAENDE.includes(f.status) ? f.status : 'draft';
    const oeffentlich = f.is_public === true || f.is_public === '1' || f.is_public === 'on' || f.is_public === 1 ? 1 : 0;
    const id = f.id ? Number(f.id) : null;

    const doppelt = await db().query(
        'SELECT id FROM kb_articles WHERE category_id = ? AND slug = ? AND id <> ?', [bereichId, slug, id || 0]);
    if (doppelt.length) throw new Eingabefehler(`Artikel: Im Bereich „${b.slug}" gibt es das Kürzel „${slug}" schon.`);

    let alteAdresse = null;
    if (id) {
        const alt = await artikelRoh(id);
        if (!alt) throw new Eingabefehler('Artikel: Diesen Artikel gibt es nicht mehr.');
        alteAdresse = `/kb/${alt.bereich_slug}/${alt.slug}`;
        // Die Startseite von /kb hängt an Bereich, Kürzel und Stand dieses einen Artikels.
        if (alt.istStartseite && (b.slug !== START.bereich || slug !== START.artikel || stand !== 'published' || !oeffentlich)) {
            throw new Eingabefehler('Artikel: Das ist der Text der Startseite von /kb — er bleibt in seinem Bereich, veröffentlicht und öffentlich. Den Text selbst kannst du ändern.');
        }
    }
    const werte = [bereichId, slug, uebersetzungen(titel, f.title_en), uebersetzungen(f.excerpt_de, f.excerpt_en),
        uebersetzungen(f.content_de, f.content_en), stand, oeffentlich, Number.parseInt(f.sort_order, 10) || 0];
    if (id) {
        const sql = `UPDATE kb_articles SET category_id = ?, slug = ?, title_translations = ?, excerpt_translations = ?,
                    content_translations = ?, status = ?, is_public = ?, sort_order = ? WHERE id = ?`;
        const neueAdresseDesArtikels = `/kb/${b.slug}/${slug}`;
        if (alteAdresse === neueAdresseDesArtikels) {
            await db().query(sql, [...werte, id]);
            return id;
        }
        // Verschoben oder umbenannt: Die Verweise aus allen Artikeln ziehen mit —
        // erst der Artikel, dann die Verweise, damit auch seine eigenen stimmen.
        await inTransaktion(async (q) => {
            await q(sql, [...werte, id]);
            bericht.verweise = { ...(await verweiseUmschreiben(alteAdresse, neueAdresseDesArtikels, q)),
                von: alteAdresse, nach: neueAdresseDesArtikels };
        });
        return id;
    }
    const ergebnis = await db().query(
        `INSERT INTO kb_articles (category_id, slug, title_translations, excerpt_translations,
                content_translations, status, is_public, sort_order, author)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [...werte, autor ? String(autor).slice(0, 100) : null]);
    return ergebnis.insertId;
}

async function artikelEntfernen(id) {
    const a = await artikelRoh(id);
    if (!a) throw new Eingabefehler('Diesen Artikel gibt es nicht mehr.');
    if (a.istStartseite) throw new Eingabefehler('Das ist der Text der Startseite von /kb — er lässt sich ändern, aber nicht entfernen.');
    await db().query('DELETE FROM kb_articles WHERE id = ?', [Number(id)]);
    return a;
}

module.exports = {
    SPRACHEN, STAENDE, START, Eingabefehler,
    sprache, text, kuerzelAus, rendere,
    sichtbarkeit, istAngemeldet, rueckkehrZiel, neueAdresse,
    bereiche, bereich, artikelImBereich, artikel, suche,
    allesFuerVerwaltung, bereichRoh, artikelRoh,
    bereichSpeichern, bereichEntfernen, artikelSpeichern, artikelEntfernen,
    ersetzeAdresse, verweiseUmschreiben, inTransaktion,
};
